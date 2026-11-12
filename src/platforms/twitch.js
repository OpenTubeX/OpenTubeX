// @ts-check
import {
  fetchTwitchChannels,
  getTwitchChannelUrl,
  parseChannel,
  parseTwitchChannelLogin,
  parseTwitchClip,
  parseTwitchUser,
  parseTwitchVideo,
  requestTwitch
} from '../twitchFollows.js'

/**
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 */

const PAGE_SIZE = 20
// Twitch requires a browser integrity token for later pages of videos and
// clips, so channel pages load as many as one request allows
const CHANNEL_PAGE_SIZE = 100
const ID_PATTERN = /^\d{1,20}$/
const CURSOR_PATTERN = /^[\w|:=+/.-]{1,300}$/
const CHANNEL_FIELDS = 'id login displayName profileImageURL(width: 300) bannerImageURL description followers { totalCount }'
const STREAM_FIELDS = 'stream { id title createdAt viewersCount previewImageURL(width: 640, height: 360) game { displayName } archiveVideo { id } }'
const VIDEO_FIELDS = 'id title publishedAt createdAt lengthSeconds viewCount previewThumbnailURL(width: 640, height: 360) game { displayName }'
const CLIP_FIELDS = 'slug title createdAt durationSeconds viewCount thumbnailURL(width: 480, height: 272) game { displayName }'

/**
 * @param {unknown} value
 */
function httpsUrl(value) {
  if (typeof value !== 'string') return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {any} user
 * @returns {PlatformChannel | null}
 */
function toPlatformChannel(user) {
  const channel = parseChannel(user)
  if (!channel) return null
  const banner = httpsUrl(user.bannerImageURL)
  const description = typeof user.description === 'string' ? user.description.trim() : ''
  const followerCount = user.followers?.totalCount
  return {
    platform: 'twitch',
    id: channel.id,
    name: channel.name,
    url: getTwitchChannelUrl(channel.login),
    ...(channel.avatar ? { avatar: channel.avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(description ? { description } : {}),
    ...(Number.isFinite(followerCount) ? { followerCount } : {})
  }
}

/**
 * Twitch identifies channels by login in URLs and by ID for following.
 * @param {PlatformChannel} channel
 */
function channelLogin(channel) {
  return parseTwitchChannelLogin(channel.url) ?? ''
}

/**
 * @param {any} connection
 */
function nodes(connection) {
  return Array.isArray(connection?.edges) ? connection.edges.map(edge => edge?.node).filter(Boolean) : []
}

/**
 * @param {PlatformItem} item
 * @returns {import('./types.js').PlatformResult}
 */
function itemResult(item) {
  return { kind: 'item', item }
}

/** @type {Platform} */
const twitch = {
  id: 'twitch',
  name: 'Twitch',
  channelTabs: ['videos', 'clips'],
  searchTypes: ['videos', 'channels'],
  liveStreams: true,

  parseChannelUrl(url) {
    // Names alone are logins too, but here only addresses identify the platform
    const login = /^https?:\/\//i.test(url) ? parseTwitchChannelLogin(url) : null
    // All-digit logins exist, and an @ keeps them apart from user IDs
    return login && ID_PATTERN.test(login) ? `@${login}` : login
  },

  parsePlaylistUrl() {
    return null
  },

  async getChannel(fetch, id, signal) {
    const variable = !id.startsWith('@') && ID_PATTERN.test(id) ? { id } : { login: parseTwitchChannelLogin(id) }
    if (!variable.id && !variable.login) return null
    const data = await requestTwitch(fetch,
      `query($id: ID, $login: String) { user(id: $id, login: $login) { ${CHANNEL_FIELDS} } }`,
      variable, signal)
    return toPlatformChannel(data.user)
  },

  async getChannelPage(fetch, channel, tab, continuation, signal) {
    if (!ID_PATTERN.test(channel.id) || continuation !== null) return { results: [], continuation: null }
    const twitchChannel = { id: channel.id, login: channelLogin(channel), name: channel.name }
    if (tab === 'clips') {
      const data = await requestTwitch(fetch,
        `query($id: ID!) { user(id: $id) { clips(first: ${CHANNEL_PAGE_SIZE}, criteria: { period: ALL_TIME, sort: VIEWS_DESC }) { edges { node { ${CLIP_FIELDS} } } } } }`,
        { id: channel.id }, signal)
      return { results: nodes(data.user?.clips).flatMap(clip => parseTwitchClip(clip, twitchChannel)).map(itemResult), continuation: null }
    }
    const data = await requestTwitch(fetch,
      `query($id: ID!) { user(id: $id) { ${CHANNEL_FIELDS} ${STREAM_FIELDS} videos(first: ${CHANNEL_PAGE_SIZE}, sort: TIME) { edges { node { ${VIDEO_FIELDS} } } } } }`,
      { id: channel.id }, signal)
    const parsed = parseTwitchUser(data.user)
    // The live stream comes first, without the video recording it
    return { results: parsed ? [...parsed.feed.live, ...parsed.feed.videos].map(itemResult) : [], continuation: null }
  },

  async getLatestItems(fetch, channel, signal) {
    const { feed } = await fetchTwitchChannels(fetch, [channel.id], { signal })
    return [...feed.live, ...feed.videos]
  },

  async getFeed(fetch, channels, signal) {
    const { channels: current, feed } = await fetchTwitchChannels(fetch, channels.map(channel => channel.id), { signal })
    return {
      channels: current.map(channel => ({
        platform: 'twitch',
        id: channel.id,
        name: channel.name,
        url: getTwitchChannelUrl(channel.login),
        ...(channel.avatar ? { avatar: channel.avatar } : {})
      })),
      items: [...feed.live, ...feed.videos],
      clips: feed.clips
    }
  },

  async search(fetch, query, type, continuation, signal) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 ||
      (continuation !== null && !CURSOR_PATTERN.test(continuation))) return { results: [], continuation: null }
    const index = type === 'channels' ? 'CHANNEL' : 'VOD'
    const fields = type === 'channels'
      ? `channels { cursor items { ${CHANNEL_FIELDS} } }`
      : `videos { cursor items { ${VIDEO_FIELDS} owner { id login displayName profileImageURL(width: 70) } } }`
    const data = await requestTwitch(fetch,
      `query($query: String!, $cursor: String) { searchFor(userQuery: $query, platform: "web", target: { index: ${index}, cursor: $cursor, limit: ${PAGE_SIZE} }) { ${fields} } }`,
      { query: query.trim(), cursor: continuation }, signal)
    const section = type === 'channels' ? data.searchFor?.channels : data.searchFor?.videos
    const items = Array.isArray(section?.items) ? section.items : []
    const results = type === 'channels'
      ? items.flatMap(user => {
          const channel = toPlatformChannel(user)
          return channel ? [{ kind: /** @type {const} */ ('channel'), channel }] : []
        })
      : items.flatMap(video => {
          const owner = parseChannel(video?.owner)
          return owner ? parseTwitchVideo(video, owner).map(itemResult) : []
        })
    // The cursor keeps coming at the end, so a short page is the last one
    const cursor = typeof section?.cursor === 'string' && items.length >= PAGE_SIZE ? section.cursor : null
    return { results, continuation: cursor }
  },

  async getPlaylist() {
    return { playlist: null, page: { results: [], continuation: null } }
  }
}

export default twitch
