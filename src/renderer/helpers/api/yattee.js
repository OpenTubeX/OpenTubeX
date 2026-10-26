import { mapConcurrently } from '../concurrent-map.js'
import { calculatePublishedDate, escapeHTML } from '../feed-metadata.js'

// yattee-server (https://github.com/yattee/yattee-server) mostly follows the
// Invidious API. These helpers adapt the parts where its responses differ.

/** The channel tabs yattee-server implements, using OpenTubeX's tab names. */
export const YATTEE_CHANNEL_TABS = ['videos', 'shorts', 'live', 'playlists', 'about']

// The server builds absolute URLs for these routes from the request's Host
// header, which is wrong when a reverse proxy doesn't forward it.
const SERVER_ROUTE_REGEX = /\/(?:proxy\/(?:relay|fast\/)|api\/v1\/(?:captions|thumbnails)\/|api\/v1\/channels\/[^/]+\/avatar\/)/

// Characters of the VTT that buildVTTFileLocally generates synchronously
const MAX_STORYBOARD_VTT_LENGTH = 16_000_000

export class YatteeUnsupportedError extends Error {
  constructor(feature) {
    super(`The Yattee server does not support ${feature}.`)
    this.name = 'YatteeUnsupportedError'
  }
}

/**
 * @param {string} value
 * @returns {string} the server URL without credentials or a trailing slash, or an empty string if it is invalid
 */
export function normalizeYatteeServerUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/**
 * Android's WebView, which plays the streams, blocks plain HTTP from its HTTPS origin
 * unless the server is on the device itself.
 * @param {string} serverUrl
 */
export function isYatteeServerPlayableOnAndroid(serverUrl) {
  try {
    const { protocol, hostname } = new URL(serverUrl)
    return protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost')
  } catch {
    return false
  }
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {string | null}
 */
export function createYatteeAuthorization(username, password) {
  if (!username && !password) return null

  const bytes = new TextEncoder().encode(`${username}:${password}`)
  return `Basic ${btoa(String.fromCharCode(...bytes))}`
}

/**
 * Resolves relative and protocol-relative URLs and moves server routes to the
 * configured server URL. Query strings, which carry the server's signatures, are kept.
 * @param {string} url
 * @param {string} serverUrl
 */
export function resolveYatteeUrl(url, serverUrl) {
  if (typeof url !== 'string' || url === '') return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return serverUrl + url
  if (url.startsWith(`${serverUrl}/`)) return url

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const match = SERVER_ROUTE_REGEX.exec(parsed.pathname)
  return match ? serverUrl + parsed.pathname.slice(match.index) + parsed.search : url
}

/**
 * @param {string} url
 * @returns {string} the YouTube URL behind a signed relay URL
 */
export function getYatteeUpstreamUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/proxy/relay')) {
      return parsed.searchParams.get('url') ?? url
    }
  } catch { }
  return url
}

/**
 * Relay URLs expire on their own schedule, in addition to the YouTube URL they wrap.
 * @param {string} url
 * @returns {Date | null}
 */
export function getYatteeStreamExpiry(url) {
  const timestamps = []

  try {
    const relayUrl = new URL(url)
    if (relayUrl.pathname.endsWith('/proxy/relay')) {
      timestamps.push(Number(relayUrl.searchParams.get('exp')))
    }

    const upstreamUrl = new URL(getYatteeUpstreamUrl(url))
    // Manifest URLs carry their parameters in the path
    timestamps.push(Number(upstreamUrl.searchParams.get('expire') ?? /\/expire\/(\d+)/.exec(upstreamUrl.pathname)?.[1]))
  } catch {
    return null
  }

  const valid = timestamps.filter(timestamp => Number.isFinite(timestamp) && timestamp > 0)
  return valid.length > 0 ? new Date(Math.min(...valid) * 1000) : null
}

/**
 * @param {{url: string}[] | undefined} thumbnails
 * @param {string} serverUrl
 */
function resolveThumbnails(thumbnails, serverUrl) {
  return (thumbnails ?? []).map(thumbnail => ({ ...thumbnail, url: resolveYatteeUrl(thumbnail.url, serverUrl) }))
}

/**
 * Converts a video response into the Invidious shape. With proxying enabled, media that
 * the server returned without wrapping it in its relay is dropped, so that playback can't
 * silently connect to YouTube directly.
 * @param {object} video
 * @param {string} serverUrl
 * @param {boolean} proxyVideos
 */
export function normalizeYatteeVideo(video, serverUrl, proxyVideos) {
  const resolve = url => resolveYatteeUrl(url, serverUrl)
  const isAllowed = url => typeof url === 'string' && url !== '' && (!proxyVideos || url.startsWith(`${serverUrl}/`))
  const isHls = format => format.container === 'hls' || /mpegurl/i.test(format.type ?? '')

  const formatStreams = (video.formatStreams ?? [])
    .map(format => ({ ...format, url: resolve(format.url) }))
    .filter(format => isAllowed(format.url))

  const hlsUrl = [resolve(video.hlsUrl), ...formatStreams.filter(isHls).map(format => format.url)]
    .find(isAllowed) ?? null

  const description = video.description ?? ''

  return {
    ...video,
    description,
    descriptionHtml: video.descriptionHtml ?? escapeHTML(description).replaceAll('\n', '<br>'),
    keywords: video.keywords ?? [],
    isListed: video.isListed ?? true,
    authorThumbnails: resolveThumbnails(video.authorThumbnails, serverUrl),
    videoThumbnails: resolveThumbnails(video.videoThumbnails, serverUrl),
    // The server leaves the channel IDs of recommendations empty
    recommendedVideos: (video.recommendedVideos ?? []).map(recommendation => ({ ...recommendation, authorId: recommendation.authorId || null })),
    hlsUrl,
    dashUrl: null,
    formatStreams: formatStreams
      .filter(format => !isHls(format))
      .map(format => ({
        ...format,
        size: format.width && format.height ? `${format.width}x${format.height}` : '0x0',
        qualityLabel: format.qualityLabel ?? format.resolution ?? format.quality,
      })),
    adaptiveFormats: (video.adaptiveFormats ?? [])
      .map(format => ({ ...format, url: resolve(format.url) }))
      .filter(format => isAllowed(format.url)),
    captions: (video.captions ?? [])
      .map(caption => ({
        label: caption.label,
        language_code: caption.languageCode ?? caption.language_code,
        url: resolve(caption.url),
      }))
      .filter(caption => isAllowed(caption.url)),
    storyboards: (video.storyboards ?? []).map(storyboard => ({
      ...storyboard,
      templateUrl: resolve(storyboard.templateUrl),
    })),
  }
}

/**
 * @param {{templateUrl: string, width: number, height: number, count: number, interval: number, storyboardWidth: number, storyboardHeight: number}[]} storyboards
 * @returns the largest storyboard that is at most 90 pixels high, in the shape of YouTube.js' storyboards
 */
export function getYatteeStoryboard(storyboards) {
  // The server's counts decide how many cues buildVTTFileLocally generates synchronously
  const hasUsableSize = ({ templateUrl, width, height, count, storyboardWidth, storyboardHeight }) => {
    if (![width, height, count, storyboardWidth, storyboardHeight].every(value => Number.isSafeInteger(value) && value > 0)) {
      return false
    }
    const thumbnailsPerSheet = storyboardWidth * storyboardHeight
    // Every cue has a timing line and repeats the sheet URL
    return Math.ceil(count / thumbnailsPerSheet) * thumbnailsPerSheet * (templateUrl.length + 64) <= MAX_STORYBOARD_VTT_LENGTH
  }

  const storyboard = storyboards
    .filter(storyboard => storyboard.templateUrl?.includes('$M') && storyboard.height <= 90 && hasUsableSize(storyboard))
    .sort((a, b) => b.height - a.height)[0]

  if (!storyboard) return null

  return {
    template_url: storyboard.templateUrl,
    thumbnail_width: storyboard.width,
    thumbnail_height: storyboard.height,
    thumbnail_count: storyboard.count,
    interval: storyboard.interval,
    columns: storyboard.storyboardWidth,
    rows: storyboard.storyboardHeight,
  }
}

/**
 * yattee-server puts the handle where Invidious puts the subscriber count,
 * and the subscriber count where Invidious puts the video count.
 * @param {object} item
 */
export function normalizeYatteeSearchItem(item) {
  if (item.type === 'channel' && item.subCountText?.startsWith('@')) {
    return { ...item, channelHandle: item.subCountText, subCount: item.subCount ?? item.videoCount, videoCount: null }
  }
  return item
}

/**
 * Videos in channel tabs come without the channel's details.
 * @param {{author: string, authorId: string}[]} videos
 * @param {string} channelId
 * @param {string} [channelName]
 */
export function fillYatteeVideoAuthors(videos, channelId, channelName = '') {
  for (const video of videos) {
    video.author ||= channelName
    video.authorId ||= channelId
    video.authorUrl ||= `/channel/${channelId}`
  }
  return videos
}

/**
 * Yattee servers return Shorts without the publication dates that subscriptions need
 * for their order and New badges. Dates come from earlier refreshes, and only Shorts
 * that appeared since then are looked up, because each lookup makes the server
 * extract the whole video. Failed lookups are marked, so the next refresh retries them.
 * @param {{ videoId: string, published?: number, isYatteePublicationDateMissing?: boolean }[]} shorts
 * @param {{ videoId: string, published?: number, isYatteePublicationDateMissing?: boolean }[] | undefined} cachedShorts the channel's Shorts from the previous refresh
 * @param {(videoId: string) => Promise<{ published?: number }>} getVideo
 */
export async function fillYatteeShortDates(shorts, cachedShorts, getVideo) {
  if (!cachedShorts) return shorts

  const cached = new Map(cachedShorts.map(short => [short.videoId, short]))
  return await mapConcurrently(shorts, 3, async short => {
    if (Number.isFinite(short.published)) return short

    const cachedShort = cached.get(short.videoId)
    if (cachedShort && !cachedShort.isYatteePublicationDateMissing) {
      return Number.isFinite(cachedShort.published) ? { ...short, published: cachedShort.published } : short
    }

    try {
      const seconds = (await getVideo(short.videoId)).published
      if (Number.isFinite(seconds)) return { ...short, published: seconds * 1000 }
    } catch { }
    return { ...short, isYatteePublicationDateMissing: true }
  })
}

/**
 * @param {object} channel
 * @param {string} serverUrl
 */
export function normalizeYatteeChannel(channel, serverUrl) {
  const description = channel.description ?? ''

  return {
    authorUrl: `/channel/${channel.authorId}`,
    autoGenerated: false,
    isFamilyFriendly: true,
    joined: 0,
    allowedRegions: [],
    latestVideos: [],
    relatedChannels: [],
    tags: [],
    ...channel,
    authorThumbnails: resolveThumbnails(channel.authorThumbnails, serverUrl),
    authorBanners: resolveThumbnails(channel.authorBanners, serverUrl),
    description,
    descriptionHtml: channel.descriptionHtml ?? escapeHTML(description).replaceAll('\n', '<br>'),
    tabs: YATTEE_CHANNEL_TABS,
  }
}

/**
 * The server returns the whole playlist at once and ignores the page parameter.
 * @param {object} playlist
 */
export function normalizeYatteePlaylist(playlist) {
  const description = playlist.description ?? ''

  return {
    author: '',
    authorId: '',
    authorThumbnails: [],
    viewCount: -1,
    updated: null,
    ...playlist,
    description,
    descriptionHtml: escapeHTML(description).replaceAll('\n', '<br>'),
    videos: (playlist.videos ?? []).map((video, index) => ({ index, ...video })),
  }
}

/**
 * @param {{comments: object[]}} response
 */
export function normalizeYatteeComments(response) {
  for (const comment of response.comments ?? []) {
    if (typeof comment.published !== 'number') {
      const published = calculatePublishedDate(comment.publishedText)
      comment.published = published === undefined ? Date.now() / 1000 : published / 1000
    }

    if (comment.isHearted && comment.creatorHeart === undefined) {
      comment.creatorHeart = {}
    }

    comment.contentHtml ??= escapeHTML(comment.content ?? '')
  }

  return response
}

/**
 * @param {string[] | {suggestions: string[]}} response
 * @param {string} query
 */
export function normalizeYatteeSuggestions(response, query) {
  return Array.isArray(response) ? { query, suggestions: response } : response
}

/**
 * @param {Response} response
 * @param {any} body the parsed response body
 * @returns {Error}
 */
export function createYatteeResponseError(response, body) {
  let detail = body?.error ?? `HTTP ${response.status}`
  if (typeof body?.detail === 'string') {
    detail = body.detail
  } else if (body?.detail != null) {
    // FastAPI reports validation errors as a list
    detail = JSON.stringify(body.detail)
  }
  const error = new Error(detail)
  error.status = response.status
  return error
}

/** @typedef {'invalid-url' | 'unreachable' | 'not-yattee' | 'credentials-required' | 'invalid-credentials' | 'rate-limited' | 'server-error' | 'cors' | 'https-required'} YatteeConnectionError */

/**
 * Verifies that the server is a Yattee server and accepts the credentials.
 * @param {string} serverUrl
 * @param {string | null} authorization
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] for the API requests
 * @param {typeof fetch | null} [options.mediaFetch] checks that the player may load the server's streams
 * @param {boolean} [options.requireHttps] whether the player needs HTTPS, see {@link isYatteeServerPlayableOnAndroid}
 * @param {number} [options.timeout] milliseconds to wait for each response
 * @returns {Promise<{ ok: true, version: string | null } | { ok: false, error: YatteeConnectionError, status?: number }>}
 */
export async function checkYatteeServer(serverUrl, authorization, { fetch: fetchFunction = fetch, mediaFetch = null, requireHttps = false, timeout = 15_000 } = {}) {
  if (serverUrl === '') return { ok: false, error: 'invalid-url' }

  let response
  try {
    // A server that drops packets would otherwise keep the test running until the system gives up
    response = await fetchFunction(`${serverUrl}/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
      ...(authorization ? { headers: { Authorization: authorization } } : {}),
    })
  } catch {
    return { ok: false, error: 'unreachable' }
  }

  if (response.status === 401) return { ok: false, error: 'invalid-credentials', status: 401 }
  if (response.status === 429) return { ok: false, error: 'rate-limited', status: 429 }

  let info = null
  try {
    info = await response.json()
  } catch { }

  if (!response.ok) {
    return { ok: false, error: response.status >= 500 ? 'server-error' : 'not-yattee', status: response.status }
  }

  // Without credentials, a server that requires them only reports its name
  if (info?.name === 'yattee-server') return { ok: false, error: 'credentials-required' }
  if (info?.name !== 'Yattee Server') return { ok: false, error: 'not-yattee' }

  if (requireHttps && !isYatteeServerPlayableOnAndroid(serverUrl)) {
    return { ok: false, error: 'https-required' }
  }

  // The player's requests need CORS headers, unlike the API requests on mobile
  if (mediaFetch) {
    try {
      await mediaFetch(`${serverUrl}/health`, { cache: 'no-store', signal: AbortSignal.timeout(timeout) })
    } catch (error) {
      // A slow server is not a CORS problem
      return { ok: false, error: error?.name === 'TimeoutError' ? 'unreachable' : 'cors' }
    }
  }

  return { ok: true, version: typeof info.version === 'string' ? info.version.split('-')[0] : null }
}
