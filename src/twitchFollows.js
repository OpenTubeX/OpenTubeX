// @ts-check
import { TWITCH_CHAT_CLIENT_ID } from './twitchChatReplayRequest.js'

const GQL_URL = 'https://gql.twitch.tv/gql'
const REQUEST_TIMEOUT_MS = 15_000
/** Channels per request. Twitch answers more, but its clip service starts failing. */
const BATCH_SIZE = 20
const VIDEOS_PER_CHANNEL = 10
const CLIPS_PER_CHANNEL = 5

const LOGIN_PATTERN = /^[a-zA-Z0-9_]{1,25}$/
const ID_PATTERN = /^\d{1,20}$/
const STREAM_ID_PATTERN = /^[\w-]{1,40}$/
const CLIP_SLUG_PATTERN = /^[\w-]{1,100}$/
const TWITCH_HOSTS = ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv']
/** First path segments of Twitch pages that aren't channels */
const RESERVED_PATHS = new Set([
  'directory', 'downloads', 'drops', 'friends', 'inventory', 'jobs', 'login', 'messages', 'moderator',
  'p', 'popout', 'search', 'settings', 'signup', 'subscriptions', 'turbo', 'u', 'videos', 'wallet'
])

const STREAM_FIELDS = 'stream { id title createdAt viewersCount previewImageURL(width: 640, height: 360) game { displayName } archiveVideo { id } }'
const CHANNEL_FIELDS = 'id login displayName profileImageURL(width: 300)'
const VIDEO_FIELDS = `videos(first: ${VIDEOS_PER_CHANNEL}, sort: TIME) { edges { node { id title publishedAt lengthSeconds viewCount previewThumbnailURL(width: 640, height: 360) game { displayName } } } }`
const CLIP_FIELDS = `clips(first: ${CLIPS_PER_CHANNEL}, criteria: { period: LAST_WEEK, sort: VIEWS_DESC }) { edges { node { slug title createdAt durationSeconds viewCount thumbnailURL(width: 480, height: 272) game { displayName } } } }`

/**
 * @typedef {{ id: string, login: string, name: string, avatar?: string }} TwitchChannel
 * @typedef {import('./platforms/types.js').PlatformItem & { category?: string }} TwitchFeedItem
 * `archiveId` is the video that records a live stream
 * @typedef {{ live: TwitchFeedItem[], videos: TwitchFeedItem[], clips: TwitchFeedItem[] }} TwitchFeed
 * @typedef {(url: string, options: RequestInit) => Promise<Response>} Fetcher
 */

/**
 * The login of a channel from its name or the address of one of its pages.
 * @param {unknown} input
 * @returns {string | null}
 */
export function parseTwitchChannelLogin(input) {
  if (typeof input !== 'string') return null
  const text = input.trim().replace(/^@/, '')
  if (LOGIN_PATTERN.test(text)) return text.toLowerCase()
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    if (!['https:', 'http:'].includes(url.protocol) || !TWITCH_HOSTS.includes(url.hostname.toLowerCase()) ||
      url.username || url.password) return null
    const login = url.pathname.split('/')[1] ?? ''
    return LOGIN_PATTERN.test(login) && !RESERVED_PATHS.has(login.toLowerCase()) ? login.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * @param {string} login
 */
export function getTwitchChannelUrl(login) {
  return `https://www.twitch.tv/${login}`
}

/**
 * Where the notification about a live stream leads. The stream is part of the
 * target, so that dismissing the notification about one broadcast doesn't
 * dismiss the ones about later broadcasts of the channel.
 * @param {unknown} login
 * @param {unknown} streamId
 * @returns {{ kind: 'live', path: string, query: { url: string, stream: string } } | null}
 */
export function getTwitchLiveNotificationTarget(login, streamId) {
  if (typeof login !== 'string' || !LOGIN_PATTERN.test(login) ||
    typeof streamId !== 'string' || !STREAM_ID_PATTERN.test(streamId)) return null
  return { kind: 'live', path: '/external-media', query: { url: getTwitchChannelUrl(login.toLowerCase()), stream: streamId } }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function httpsUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    return new URL(value).protocol === 'https:' ? value : ''
  } catch {
    return ''
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function timestamp(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? null : time
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function count(value) {
  return Number.isFinite(value) && /** @type {number} */ (value) >= 0 ? /** @type {number} */ (value) : undefined
}

/**
 * @param {any} game
 */
function category(game) {
  return typeof game?.displayName === 'string' && game.displayName ? { category: game.displayName } : {}
}

/**
 * @param {any} user
 * @returns {TwitchChannel | null}
 */
export function parseChannel(user) {
  if (typeof user?.id !== 'string' || !ID_PATTERN.test(user.id) ||
    typeof user.login !== 'string' || !LOGIN_PATTERN.test(user.login)) return null
  const avatar = httpsUrl(user.profileImageURL)
  return {
    id: user.id,
    login: user.login.toLowerCase(),
    name: typeof user.displayName === 'string' && user.displayName.trim() ? user.displayName.trim() : user.login,
    ...(avatar ? { avatar } : {})
  }
}

/**
 * @param {any} connection
 * @returns {any[]}
 */
function nodes(connection) {
  return Array.isArray(connection?.edges) ? connection.edges.map(edge => edge?.node).filter(Boolean) : []
}

/**
 * The items of a channel. Its archive of the running broadcast is left out,
 * since the stream itself is listed.
 * @param {any} user
 * @returns {{ channel: TwitchChannel, feed: TwitchFeed } | null}
 */
export function parseTwitchUser(user) {
  const channel = parseChannel(user)
  if (!channel) return null
  const base = { platform: 'twitch', author: channel.name, channelId: channel.id }

  const stream = user.stream
  const runningArchive = typeof stream?.archiveVideo?.id === 'string' && ID_PATTERN.test(stream.archiveVideo.id)
    ? stream.archiveVideo.id
    : undefined
  /** @type {TwitchFeedItem[]} */
  const live = typeof stream?.id === 'string' && STREAM_ID_PATTERN.test(stream.id)
    ? [{
        ...base,
        id: stream.id,
        isLive: true,
        url: getTwitchChannelUrl(channel.login),
        title: typeof stream.title === 'string' && stream.title.trim() ? stream.title.trim() : channel.name,
        thumbnail: httpsUrl(stream.previewImageURL),
        published: timestamp(stream.createdAt),
        ...(count(stream.viewersCount) === undefined ? {} : { viewCount: count(stream.viewersCount) }),
        ...category(stream.game),
        ...(runningArchive ? { archiveId: runningArchive } : {})
      }]
    : []

  const videos = nodes(user.videos).flatMap(video => video.id === runningArchive ? [] : parseTwitchVideo(video, channel))
  const clips = nodes(user.clips).flatMap(clip => parseTwitchClip(clip, channel))
  return { channel, feed: { live, videos, clips } }
}

/**
 * @param {any} video
 * @param {TwitchChannel} channel
 * @returns {TwitchFeedItem[]}
 */
export function parseTwitchVideo(video, channel) {
  if (typeof video?.id !== 'string' || !ID_PATTERN.test(video.id)) return []
  return [{
    platform: 'twitch',
    author: channel.name,
    channelId: channel.id,
    id: video.id,
    url: `https://www.twitch.tv/videos/${video.id}`,
    title: typeof video.title === 'string' && video.title.trim() ? video.title.trim() : channel.name,
    thumbnail: httpsUrl(video.previewThumbnailURL),
    published: timestamp(video.publishedAt ?? video.createdAt),
    ...(count(video.lengthSeconds) === undefined ? {} : { duration: count(video.lengthSeconds) }),
    ...(count(video.viewCount) === undefined ? {} : { viewCount: count(video.viewCount) }),
    ...category(video.game)
  }]
}

/**
 * @param {any} clip
 * @param {TwitchChannel} channel
 * @returns {TwitchFeedItem[]}
 */
export function parseTwitchClip(clip, channel) {
  if (typeof clip?.slug !== 'string' || !CLIP_SLUG_PATTERN.test(clip.slug)) return []
  return [{
    platform: 'twitch',
    author: channel.name,
    channelId: channel.id,
    id: clip.slug,
    url: `https://www.twitch.tv/${channel.login}/clip/${clip.slug}`,
    title: typeof clip.title === 'string' && clip.title.trim() ? clip.title.trim() : channel.name,
    thumbnail: httpsUrl(clip.thumbnailURL),
    published: timestamp(clip.createdAt),
    ...(count(clip.durationSeconds) === undefined ? {} : { duration: count(clip.durationSeconds) }),
    ...(count(clip.viewCount) === undefined ? {} : { viewCount: count(clip.viewCount) }),
    ...category(clip.game)
  }]
}

/**
 * @param {Fetcher} fetcher
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @param {AbortSignal} [signal]
 */
export async function requestTwitch(fetcher, query, variables, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetcher(GQL_URL, {
    method: 'POST',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { 'Client-ID': TWITCH_CHAT_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (!response.ok) throw new Error(`Twitch returned HTTP ${response.status}`)
  const data = (await response.json())?.data
  // Fields such as clips fail on their own, with the rest of the data intact
  if (!data || typeof data !== 'object') throw new Error('Twitch returned no data')
  return data
}

/**
 * Looks up a channel to follow.
 * @param {Fetcher} fetcher
 * @param {string} login
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ channel: TwitchChannel, feed: TwitchFeed } | null>} null for unknown channels
 */
export async function findTwitchChannel(fetcher, login, signal) {
  if (!LOGIN_PATTERN.test(login)) return null
  const data = await requestTwitch(fetcher,
    `query($login: String!) { user(login: $login) { ${CHANNEL_FIELDS} ${STREAM_FIELDS} ${VIDEO_FIELDS} ${CLIP_FIELDS} } }`,
    { login }, signal)
  return parseTwitchUser(data.user)
}

/**
 * Loads the channels in batches. Channels that Twitch doesn't know anymore,
 * for example because they were deleted, have no result.
 * @param {Fetcher} fetcher
 * @param {string[]} ids
 * @param {{ liveOnly?: boolean, signal?: AbortSignal }} [options] `liveOnly` skips videos and clips
 * @returns {Promise<{ channels: TwitchChannel[], feed: TwitchFeed }>}
 */
export async function fetchTwitchChannels(fetcher, ids, { liveOnly = false, signal } = {}) {
  const validIds = [...new Set(ids)].filter(id => ID_PATTERN.test(id))
  const query = `query($ids: [ID!]) { users(ids: $ids) { ${CHANNEL_FIELDS} ${STREAM_FIELDS} ${liveOnly ? '' : `${VIDEO_FIELDS} ${CLIP_FIELDS}`} } }`
  const batches = []
  for (let index = 0; index < validIds.length; index += BATCH_SIZE) {
    batches.push(validIds.slice(index, index + BATCH_SIZE))
  }
  const results = await Promise.all(batches.map(async batch => {
    const users = (await requestTwitch(fetcher, query, { ids: batch }, signal)).users
    // Deleted channels are null entries, but without the list nothing was checked
    if (!Array.isArray(users)) throw new Error('Twitch returned no channels')
    return users.map(parseTwitchUser).filter(result => result !== null)
  }))

  const parsed = results.flat()
  return {
    channels: parsed.map(result => result.channel),
    feed: {
      live: parsed.flatMap(result => result.feed.live).sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)),
      videos: sortNewestFirst(parsed.flatMap(result => result.feed.videos)),
      clips: sortNewestFirst(parsed.flatMap(result => result.feed.clips))
    }
  }
}

/** Stream IDs kept per channel, so that a stream is announced once */
const KNOWN_STREAMS_PER_CHANNEL = 20

/**
 * Records the live streams of the followed channels and returns the ones that
 * started since the last check. The first check of a channel only records its
 * stream, so following a channel that is live announces nothing. Mirrored by
 * TwitchLiveNotifications.java.
 * @param {Record<string, string[]>} known stream IDs by channel ID, updated in place
 * @param {string[]} channelIds the followed channels that were checked
 * @param {TwitchFeedItem[]} live their live streams
 * @returns {TwitchFeedItem[]}
 */
export function takeNewTwitchStreams(known, channelIds, live) {
  const followed = new Set(channelIds)
  for (const channelId of Object.keys(known)) {
    if (!followed.has(channelId)) delete known[channelId]
  }
  const fresh = []
  for (const channelId of followed) {
    const streams = live.filter(stream => stream.channelId === channelId)
    const previous = Array.isArray(known[channelId]) ? known[channelId] : null
    if (previous) fresh.push(...streams.filter(stream => !previous.includes(stream.id)))
    // Streams that drop out of a response for a moment aren't announced again
    known[channelId] = [...new Set([...streams.map(stream => stream.id), ...previous ?? []])].slice(0, KNOWN_STREAMS_PER_CHANNEL)
  }
  return fresh
}

/**
 * Identifies a Twitch notification on Android, which keeps the channel with the stream.
 * @param {string} login
 * @param {string} streamId
 */
export function getTwitchNotificationId(login, streamId) {
  return `${login}/${streamId}`
}

/**
 * @param {unknown} id
 */
export function parseTwitchNotificationId(id) {
  const [login, streamId] = typeof id === 'string' ? id.split('/') : []
  return getTwitchLiveNotificationTarget(login, streamId)
}

/**
 * @param {TwitchFeedItem[]} items
 */
export function sortNewestFirst(items) {
  return items.sort((a, b) => (b.published ?? -Infinity) - (a.published ?? -Infinity))
}
