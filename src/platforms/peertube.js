// @ts-check

/**
 * PeerTube instances and SepiaSearch, the search index across them. Channels
 * and playlists carry the instance that hosts them in their ID, as
 * `name@host`, and requests only go to `https://<host>`.
 *
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformChannelTab} PlatformChannelTab
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformPlaylist} PlatformPlaylist
 * @typedef {import('./types.js').PlatformResult} PlatformResult
 * @typedef {import('./types.js').PlatformSearchType} PlatformSearchType
 */

const PLATFORM = 'peertube'
const SEARCH_URL = 'https://sepiasearch.org/api/v1/search'
const REQUEST_TIMEOUT_MS = 15_000
const PAGE_SIZE = 20
/** Minimum image widths. PeerTube 8 lists several sizes, up to 1920 pixels for previews and 1500 for avatars. */
const THUMBNAIL_WIDTH = 480
const AVATAR_WIDTH = 300
const BANNER_WIDTH = 1200
/** PeerTube's privacy ID of public videos and playlists */
const PUBLIC = 1

/** Actor names as PeerTube allows them, without dot-only names that would climb API paths */
const NAME_PATTERN = /^(?!\.+$)[\w.:-]{1,100}$/
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
/** Short UUIDs are base58 */
const SHORT_UUID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{10,24}$/
/** DNS names with a dot and a top-level label that isn't a number */
const HOST_PATTERN = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?=[a-z\d-]*[a-z])[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/
/** Names that only resolve in the local network */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa']
/** Sites that aren't PeerTube but also have `/c/` pages */
const OTHER_PLATFORM_HOSTS = new Set(['youtube.com', 'youtu.be', 'twitch.tv', 'rumble.com', 'odysee.com', 'soundcloud.com'])

/** @type {Partial<Record<PlatformSearchType, string>>} */
const SEARCH_ENDPOINTS = { videos: 'videos', channels: 'video-channels', playlists: 'video-playlists' }

/**
 * The lowercase host of an instance, or null for IP addresses, local names,
 * ports, credentials and other platforms.
 * @param {unknown} value
 * @returns {string | null}
 */
function peerTubeHost(value) {
  if (typeof value !== 'string') return null
  const host = value.toLowerCase()
  try {
    // The URL parser turns numbers such as 0x7f.1 into IP addresses, and separates ports, paths and credentials
    if (new URL(`https://${host}`).hostname !== host) return null
  } catch {
    return null
  }
  return host.length <= 253 && HOST_PATTERN.test(host) &&
    !LOCAL_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`)) &&
    !OTHER_PLATFORM_HOSTS.has(host.replace(/^(?:www|m)\./, ''))
    ? host
    : null
}

/**
 * @param {unknown} value
 * @returns {string} the URL if it is https on an instance host, or empty
 */
function peerTubeUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && peerTubeHost(url.hostname)
      ? url.href
      : ''
  } catch {
    return ''
  }
}

/**
 * A path on the instance that answered, since instances serve their own
 * copies of the images of remote videos.
 * @param {string} host
 * @param {unknown} path
 */
function pathUrl(host, path) {
  return typeof path === 'string' && path.startsWith('/') ? `https://${host}${path}` : ''
}

/**
 * @param {unknown} value
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
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
 * @param {unknown} value
 */
function isMediaId(value) {
  return typeof value === 'string' && (UUID_PATTERN.test(value) || SHORT_UUID_PATTERN.test(value))
}

/**
 * @param {unknown} value
 */
function isName(value) {
  return typeof value === 'string' && NAME_PATTERN.test(value)
}

/**
 * Splits `name@host` IDs of channels and playlists.
 * @param {unknown} id
 * @param {(name: string) => boolean} isValid
 * @returns {{ name: string, host: string } | null}
 */
function splitId(id, isValid) {
  if (typeof id !== 'string') return null
  const at = id.indexOf('@')
  const name = id.slice(0, at)
  const host = at > 0 ? peerTubeHost(id.slice(at + 1)) : null
  return host && isValid(name) ? { name, host } : null
}

/**
 * @param {any} channel a channel in an API response
 * @returns {string | null}
 */
function apiChannelId(channel) {
  const parsed = typeof channel?.name === 'string' && typeof channel.host === 'string'
    ? splitId(`${channel.name}@${channel.host}`, isName)
    : null
  return parsed ? `${parsed.name}@${parsed.host}` : null
}

/**
 * Public, or without privacy information
 * @param {any} data
 */
function isPublic(data) {
  return data?.privacy?.id === undefined || data.privacy.id === PUBLIC
}

/**
 * The smallest image that is at least `minWidth` wide, or the largest.
 * @param {unknown} images
 * @param {number} minWidth
 * @param {string} host
 */
function pickImage(images, minWidth, host) {
  const usable = (Array.isArray(images) ? images : []).flatMap(image => {
    const url = peerTubeUrl(image?.fileUrl) || peerTubeUrl(image?.url) || pathUrl(host, image?.path)
    return url ? [{ url, width: count(image.width) ?? 0 }] : []
  }).sort((a, b) => a.width - b.width)
  return (usable.find(image => image.width >= minWidth) ?? usable.at(-1))?.url ?? ''
}

/**
 * Avatars and banners, as lists or as the single image of older instances.
 * @param {unknown} list
 * @param {unknown} single
 */
function imageList(list, single) {
  return Array.isArray(list) && list.length > 0 ? list : single ? [single] : []
}

/**
 * @param {any} media a video or playlist
 * @param {string} host
 */
function thumbnail(media, host) {
  return pickImage(media.thumbnails, THUMBNAIL_WIDTH, host) ||
    peerTubeUrl(media.previewUrl) || pathUrl(host, media.previewPath) ||
    peerTubeUrl(media.thumbnailUrl) || pathUrl(host, media.thumbnailPath)
}

/**
 * @param {any} data
 * @param {string} host the instance that answered
 * @param {string | null} id
 * @returns {PlatformChannel | null}
 */
function parseChannel(data, host, id) {
  const parsed = data && typeof data === 'object' ? splitId(id, isName) : null
  if (!id || !parsed) return null
  /** @type {PlatformChannel} */
  const channel = {
    platform: PLATFORM,
    id,
    name: text(data.displayName) || parsed.name,
    url: peerTubeUrl(data.url) || `https://${parsed.host}/c/${encodeURIComponent(parsed.name)}`
  }
  const avatar = pickImage(imageList(data.avatars, data.avatar), AVATAR_WIDTH, host)
  const banner = pickImage(imageList(data.banners, data.banner), BANNER_WIDTH, host)
  const description = text(data.description)
  const followerCount = count(data.followersCount)
  if (avatar) channel.avatar = avatar
  if (banner) channel.banner = banner
  if (description) channel.description = description
  if (followerCount !== undefined) channel.followerCount = followerCount
  return channel
}

/**
 * @param {any} video
 * @param {string} host the instance that answered
 * @returns {PlatformItem | null}
 */
function parseVideo(video, host) {
  if (!video || typeof video !== 'object' || !isPublic(video)) return null
  const uuid = typeof video.uuid === 'string' && UUID_PATTERN.test(video.uuid) ? video.uuid : ''
  const shortUUID = typeof video.shortUUID === 'string' && SHORT_UUID_PATTERN.test(video.shortUUID) ? video.shortUUID : ''
  if (!uuid && !shortUUID) return null
  const author = text(video.channel?.displayName) || text(video.account?.displayName)
  /** @type {PlatformItem} */
  const item = {
    platform: PLATFORM,
    id: uuid || shortUUID,
    url: peerTubeUrl(video.url) || `https://${host}/w/${shortUUID || uuid}`,
    title: text(video.name) || author,
    author,
    channelId: apiChannelId(video.channel) ?? '',
    thumbnail: thumbnail(video, host),
    published: timestamp(video.originallyPublishedAt) ?? timestamp(video.publishedAt)
  }
  const duration = count(video.duration)
  const viewCount = count(video.views)
  if (video.isLive === true) {
    item.isLive = true
  } else if (duration !== undefined) {
    item.duration = duration
  }
  if (viewCount !== undefined) item.viewCount = viewCount
  return item
}

/**
 * @param {any} data
 * @param {string} host the instance that answered, which the ID points to
 * @returns {PlatformPlaylist | null}
 */
function parsePlaylist(data, host) {
  if (!data || typeof data !== 'object') return null
  const uuid = typeof data.uuid === 'string' && UUID_PATTERN.test(data.uuid) ? data.uuid : ''
  const shortUUID = typeof data.shortUUID === 'string' && SHORT_UUID_PATTERN.test(data.shortUUID) ? data.shortUUID : ''
  if (!uuid && !shortUUID) return null
  /** @type {PlatformPlaylist} */
  const playlist = {
    platform: PLATFORM,
    id: `${uuid || shortUUID}@${host}`,
    url: peerTubeUrl(data.url) || `https://${host}/w/p/${shortUUID || uuid}`,
    title: text(data.displayName),
    author: text(data.videoChannel?.displayName) || text(data.ownerAccount?.displayName),
    channelId: apiChannelId(data.videoChannel) ?? '',
    thumbnail: thumbnail(data, host)
  }
  const itemCount = count(data.videosLength)
  if (itemCount !== undefined) playlist.itemCount = itemCount
  return playlist
}

/**
 * @param {any} video
 * @param {string | null} host
 * @returns {PlatformResult | null}
 */
function videoResult(video, host) {
  const item = host ? parseVideo(video, host) : null
  return item ? { kind: 'item', item } : null
}

/**
 * @param {any} data
 * @param {string | null} host
 * @returns {PlatformResult | null}
 */
function playlistResult(data, host) {
  const playlist = host && isPublic(data) ? parsePlaylist(data, host) : null
  return playlist ? { kind: 'playlist', playlist } : null
}

/**
 * @param {any} data
 * @param {string | null} host
 * @returns {PlatformResult | null}
 */
function channelResult(data, host) {
  const channel = host ? parseChannel(data, host, apiChannelId(data)) : null
  return channel ? { kind: 'channel', channel } : null
}

/**
 * @returns {PlatformPage}
 */
function emptyPage() {
  return { results: [], continuation: null }
}

/**
 * @param {string | null} continuation
 */
function offset(continuation) {
  return typeof continuation === 'string' && /^\d{1,7}$/.test(continuation) ? Number(continuation) : 0
}

/**
 * A page of a list response, which has its entries in `data` and their number in `total`.
 * @param {any} data
 * @param {number} start
 * @param {(entry: any) => PlatformResult | null} toResult
 * @returns {PlatformPage}
 */
function listPage(data, start, toResult) {
  const entries = Array.isArray(data?.data) ? data.data : []
  const total = count(data?.total)
  const next = start + PAGE_SIZE
  const hasMore = entries.length > 0 && (total === undefined ? entries.length >= PAGE_SIZE : next < total)
  return {
    results: entries.flatMap(entry => toResult(entry) ?? []),
    continuation: hasMore ? String(next) : null
  }
}

/**
 * @param {string} base
 * @param {Record<string, string | number>} params
 */
function withParams(base, params) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return url.href
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<any>} the response, or null for unknown channels, playlists and hosts without the API
 */
async function request(fetch, url, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`PeerTube returned HTTP ${response.status}`)
  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!data || typeof data !== 'object') throw new Error('PeerTube returned no data')
  return data
}

/**
 * The host and path segments of a page on an instance.
 * @param {unknown} input
 * @returns {{ host: string, segments: string[] } | null}
 */
function parsePage(input) {
  if (typeof input !== 'string') return null
  try {
    const url = new URL(input.trim())
    const host = peerTubeHost(url.hostname)
    if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password || !host) return null
    return { host, segments: url.pathname.split('/').slice(1).map(decodeURIComponent) }
  } catch {
    return null
  }
}

/**
 * @param {string} url
 * @returns {string | null}
 */
function parseChannelUrl(url) {
  const page = parsePage(url)
  const [section, handle] = page?.segments ?? []
  if (!page || (section !== 'c' && section !== 'video-channels') || !handle) return null
  // Instances show remote channels as name@host, which live on that host
  const channel = splitId(handle.includes('@') ? handle : `${handle}@${page.host}`, isName)
  return channel ? `${channel.name}@${channel.host}` : null
}

/**
 * @param {string} url
 * @returns {string | null}
 */
function parsePlaylistUrl(url) {
  const page = parsePage(url)
  const [first, second, third, fourth] = page?.segments ?? []
  const id = first === 'w' && second === 'p'
    ? third
    : first === 'videos' && second === 'watch' && third === 'playlist'
      ? fourth
      : first === 'video-playlists' ? second : undefined
  return page && isMediaId(id) ? `${id}@${page.host}` : null
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformChannel | null>}
 */
async function getChannel(fetch, id, signal) {
  const channel = splitId(id, isName)
  if (!channel) return null
  const data = await request(fetch, `https://${channel.host}/api/v1/video-channels/${encodeURIComponent(channel.name)}`, signal)
  return parseChannel(data, channel.host, `${channel.name}@${channel.host}`)
}

/**
 * @param {PlatformFetch} fetch
 * @param {PlatformChannel} channel
 * @param {PlatformChannelTab} tab
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function getChannelPage(fetch, channel, tab, continuation, signal) {
  const parsed = splitId(channel.id, isName)
  if (!parsed || (tab !== 'videos' && tab !== 'playlists')) return emptyPage()
  const { name, host } = parsed
  const start = offset(continuation)
  const base = `https://${host}/api/v1/video-channels/${encodeURIComponent(name)}`
  if (tab === 'videos') {
    const data = await request(fetch, withParams(`${base}/videos`, { start, count: PAGE_SIZE, sort: '-publishedAt' }), signal)
    return listPage(data, start, video => videoResult(video, host))
  }
  const data = await request(fetch, withParams(`${base}/video-playlists`, { start, count: PAGE_SIZE }), signal)
  return listPage(data, start, playlist => playlistResult(playlist, host))
}

/**
 * Lives come in upload order, since lists don't say which ones are on air.
 * @param {PlatformFetch} fetch
 * @param {PlatformChannel} channel
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformItem[]>}
 */
async function getLatestItems(fetch, channel, signal) {
  const { results } = await getChannelPage(fetch, channel, 'videos', null, signal)
  return results.flatMap(result => result.kind === 'item' ? [result.item] : [])
}

/**
 * SepiaSearch results link to their own instances, which serve their images.
 * @param {PlatformFetch} fetch
 * @param {string} query
 * @param {PlatformSearchType} type
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function search(fetch, query, type, continuation, signal) {
  const endpoint = SEARCH_ENDPOINTS[type]
  const terms = query.trim()
  if (!endpoint || !terms) return emptyPage()
  const start = offset(continuation)
  const data = await request(fetch, withParams(`${SEARCH_URL}/${endpoint}`, { search: terms, start, count: PAGE_SIZE, nsfw: 'false' }), signal)
  return listPage(data, start, entry => {
    if (type === 'channels') return channelResult(entry, peerTubeHost(entry?.host))
    if (type === 'playlists') return playlistResult(entry, peerTubeHost(entry?.ownerAccount?.host) ?? peerTubeHost(entry?.videoChannel?.host))
    return videoResult(entry, peerTubeHost(entry?.channel?.host) ?? peerTubeHost(entry?.account?.host))
  })
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} id
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ playlist: PlatformPlaylist | null, page: PlatformPage }>}
 */
async function getPlaylist(fetch, id, continuation, signal) {
  const parsed = splitId(id, isMediaId)
  if (!parsed) return { playlist: null, page: emptyPage() }
  const { name: key, host } = parsed
  const start = offset(continuation)
  const base = `https://${host}/api/v1/video-playlists/${encodeURIComponent(key)}`
  const [data, elements] = await Promise.all([
    request(fetch, base, signal),
    request(fetch, withParams(`${base}/videos`, { start, count: PAGE_SIZE }), signal)
  ])
  const playlist = parsePlaylist(data, host)
  if (!playlist) return { playlist: null, page: emptyPage() }
  // Keep the ID the playlist was opened with, which may be its short UUID
  playlist.id = `${key}@${host}`
  // Removed videos stay in playlists without their video
  return { playlist, page: listPage(elements, start, element => videoResult(element?.video, host)) }
}

/** @type {Platform} */
const peertube = {
  id: PLATFORM,
  name: 'PeerTube',
  channelTabs: ['videos', 'playlists'],
  searchTypes: ['videos', 'channels', 'playlists'],
  liveStreams: true,
  parseChannelUrl,
  parsePlaylistUrl,
  getChannel,
  getChannelPage,
  getLatestItems,
  search,
  getPlaylist
}

export default peertube
