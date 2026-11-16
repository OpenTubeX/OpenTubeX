// @ts-check
import {
  fetchTwitchChannels,
  getTwitchChannelUrl,
  parseChannel,
  parseTwitchChannelLogin,
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
 * @typedef {import('./types.js').PlatformCategory} PlatformCategory
 */

const PAGE_SIZE = 20
// Twitch requires a browser integrity token for later pages of videos and
// clips, so channel pages load as many as one request allows
const CHANNEL_PAGE_SIZE = 100
const ID_PATTERN = /^\d{1,20}$/
/** Clip and video pages name their channel, but aren't its pages */
const CONTENT_PAGE_PATTERN = /^https?:\/\/[^/?#]+\/[^/?#]+\/(?:clip|v|video)(?:[/?#]|$)/i
const CURSOR_PATTERN = /^[\w|:=+/.-]{1,300}$/
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
// Later pages of streams and categories need a browser integrity token too,
// so these lists are as long as one request allows
const CATEGORY_STREAMS = 100
const BROWSE_CATEGORIES = 100
const BROWSE_STREAMS = 30
const CHANNEL_FIELDS = 'id login displayName profileImageURL(width: 300) bannerImageURL description followers { totalCount }'
const STREAM_FIELDS = 'stream { id title createdAt viewersCount previewImageURL(width: 640, height: 360) game { displayName } archiveVideo { id } }'
const VIDEO_FIELDS = 'id title publishedAt createdAt lengthSeconds viewCount previewThumbnailURL(width: 640, height: 360) game { displayName }'
const CLIP_FIELDS = 'slug title createdAt durationSeconds viewCount thumbnailURL(width: 480, height: 272) game { displayName }'
const CATEGORY_FIELDS = 'slug displayName viewersCount boxArtURL(width: 285, height: 380)'
const STREAM_NODE_FIELDS = 'id title createdAt viewersCount previewImageURL(width: 640, height: 360) game { displayName } archiveVideo { id } broadcaster { id login displayName profileImageURL(width: 70) }'

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
 * @param {PlatformItem} item
 * @returns {import('./types.js').PlatformResult}
 */
function itemResult(item) {
  return { kind: 'item', item }
}

/**
 * @param {any} game
 * @returns {PlatformCategory | null}
 */
function toPlatformCategory(game) {
  if (typeof game?.slug !== 'string' || !CATEGORY_PATTERN.test(game.slug)) return null
  const name = typeof game.displayName === 'string' && game.displayName.trim() ? game.displayName.trim() : game.slug
  const viewerCount = game.viewersCount
  return {
    platform: 'twitch',
    id: game.slug,
    name,
    url: `https://www.twitch.tv/directory/category/${game.slug}`,
    thumbnail: httpsUrl(game.boxArtURL) ?? '',
    ...(Number.isFinite(viewerCount) && viewerCount >= 0 ? { viewerCount } : {})
  }
}

/**
 * The live streams of a connection of streams, each with its channel.
 * @param {any} connection
 * @returns {PlatformItem[]}
 */
function streamItems(connection) {
  const edges = Array.isArray(connection?.edges) ? connection.edges : []
  return edges.flatMap(edge => {
    const stream = edge?.node
    return stream ? parseTwitchUser({ ...stream.broadcaster, stream })?.feed.live ?? [] : []
  })
}

/**
 * Selects a user by ID, or by login for `@login` and logins with letters.
 * @param {string} id
 * @returns {{ id: string } | { login: string } | null}
 */
function userVariables(id) {
  if (!id.startsWith('@') && ID_PATTERN.test(id)) return { id }
  const login = parseTwitchChannelLogin(id)
  return login ? { login } : null
}

/**
 * @param {string} fields what the query loads besides the channel
 */
function userQuery(fields) {
  return `query($id: ID, $login: String) { user(id: $id, login: $login) { ${CHANNEL_FIELDS} ${fields} } }`
}

/**
 * @param {import('./types.js').PlatformChannelTab} tab
 */
function tabFields(tab) {
  return tab === 'clips'
    ? `clips(first: ${CHANNEL_PAGE_SIZE}, criteria: { period: ALL_TIME, sort: VIEWS_DESC }) { edges { node { ${CLIP_FIELDS} } } }`
    : `${STREAM_FIELDS} videos(first: ${CHANNEL_PAGE_SIZE}, sort: TIME) { edges { node { ${VIDEO_FIELDS} } } }`
}

/**
 * @param {any} user
 * @param {import('./types.js').PlatformChannelTab} tab
 * @returns {PlatformPage}
 */
function tabPage(user, tab) {
  const parsed = parseTwitchUser(user)
  // The live stream comes first, without the video recording it
  const items = !parsed ? [] : tab === 'clips' ? parsed.feed.clips : [...parsed.feed.live, ...parsed.feed.videos]
  return { results: items.map(itemResult), continuation: null }
}

/** @type {Platform} */
const twitch = {
  id: 'twitch',
  name: 'Twitch',
  channelTabs: ['videos', 'clips'],
  searchTypes: ['videos', 'channels', 'categories'],
  liveStreams: true,

  parseChannelUrl(url) {
    // Names alone are logins too, but here only addresses identify the platform
    const login = /^https?:\/\//i.test(url) && !CONTENT_PAGE_PATTERN.test(url) ? parseTwitchChannelLogin(url) : null
    // All-digit logins exist, and an @ keeps them apart from user IDs
    return login && ID_PATTERN.test(login) ? `@${login}` : login
  },

  async getChannel(fetch, id, signal) {
    const variables = userVariables(id)
    if (!variables) return null
    const data = await requestTwitch(fetch, userQuery(''), variables, signal)
    return toPlatformChannel(data.user)
  },

  // One query has the channel and the whole tab
  async getChannelWithPage(fetch, id, tab, signal) {
    const variables = userVariables(id)
    if (!variables) return null
    const data = await requestTwitch(fetch, userQuery(tabFields(tab)), variables, signal)
    const channel = toPlatformChannel(data.user)
    return channel && { channel, page: Promise.resolve(tabPage(data.user, tab)) }
  },

  async getChannelPage(fetch, channel, tab, continuation, signal) {
    if (!ID_PATTERN.test(channel.id) || continuation !== null) return { results: [], continuation: null }
    const data = await requestTwitch(fetch, userQuery(tabFields(tab)), { id: channel.id }, signal)
    return tabPage(data.user, tab)
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
    const { index, section, fields } = {
      channels: { index: 'CHANNEL', section: 'channels', fields: CHANNEL_FIELDS },
      categories: { index: 'GAME', section: 'games', fields: CATEGORY_FIELDS }
    }[type] ?? { index: 'VOD', section: 'videos', fields: `${VIDEO_FIELDS} owner { id login displayName profileImageURL(width: 70) }` }
    const data = await requestTwitch(fetch,
      `query($query: String!, $cursor: String) { searchFor(userQuery: $query, platform: "web", target: { index: ${index}, cursor: $cursor, limit: ${PAGE_SIZE} }) { ${section} { cursor items { ${fields} } } } }`,
      { query: query.trim(), cursor: continuation }, signal)
    const found = data.searchFor?.[section]
    const items = Array.isArray(found?.items) ? found.items : []
    /** @type {import('./types.js').PlatformResult[]} */
    const results = items.flatMap(entry => {
      if (type === 'channels') {
        const channel = toPlatformChannel(entry)
        return channel ? [{ kind: /** @type {const} */ ('channel'), channel }] : []
      }
      if (type === 'categories') {
        const category = toPlatformCategory(entry)
        return category ? [{ kind: /** @type {const} */ ('category'), category }] : []
      }
      const owner = parseChannel(entry?.owner)
      return owner ? parseTwitchVideo(entry, owner).map(itemResult) : []
    })
    // The cursor keeps coming at the end, so a short page is the last one
    const cursor = typeof found?.cursor === 'string' && items.length >= PAGE_SIZE ? found.cursor : null
    return { results, continuation: cursor }
  },

  async getCategory(fetch, id, signal) {
    if (!CATEGORY_PATTERN.test(id)) return null
    const data = await requestTwitch(fetch,
      `query($slug: String!) { game(slug: $slug) { ${CATEGORY_FIELDS} streams(first: ${CATEGORY_STREAMS}, options: { sort: VIEWER_COUNT }) { edges { node { ${STREAM_NODE_FIELDS} } } } } }`,
      { slug: id }, signal)
    const category = toPlatformCategory(data.game)
    if (!category) return null
    // A failed streams field must not look like a category nobody streams
    if (!Array.isArray(data.game.streams?.edges)) throw new Error('Twitch returned no streams')
    return { category, items: streamItems(data.game.streams) }
  },

  async getBrowse(fetch, signal) {
    const data = await requestTwitch(fetch,
      `query { games(first: ${BROWSE_CATEGORIES}) { edges { node { ${CATEGORY_FIELDS} } } } streams(first: ${BROWSE_STREAMS}) { edges { node { ${STREAM_NODE_FIELDS} } } } }`,
      {}, signal)
    // A list fails on its own and leaves its field null, which must not look
    // like an empty list that a retry can't load again
    if (!Array.isArray(data.games?.edges) || !Array.isArray(data.streams?.edges)) {
      throw new Error('Twitch returned no categories or streams')
    }
    const categories = data.games.edges.flatMap(edge => toPlatformCategory(edge?.node) ?? [])
    return { categories, items: streamItems(data.streams) }
  },

  async getPlaylist() {
    return { playlist: null, page: { results: [], continuation: null } }
  }
}

export default twitch
