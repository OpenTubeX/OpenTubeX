// @ts-check

/**
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPlaylist} PlatformPlaylist
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformResult} PlatformResult
 * @typedef {import('./types.js').PlatformChannelTab} PlatformChannelTab
 * @typedef {import('./types.js').PlatformSearchType} PlatformSearchType
 */

const PLATFORM = 'soundcloud'
const WEB_URL = 'https://soundcloud.com'
const API_ORIGIN = 'https://api-v2.soundcloud.com'
const REQUEST_TIMEOUT_MS = 15_000
const PAGE_SIZE = 20
/** Requests for one page of a list at most, when pages come back empty */
const MAX_REQUESTS_PER_PAGE = 4
/** Tracks per playlist page, also the most that /tracks?ids= answers at once */
const PLAYLIST_PAGE_SIZE = 50

const ID_PATTERN = /^\d{1,20}$/
const PERMALINK_PATTERN = /^[\w-]{1,100}$/
const PLAYLIST_PATH_PATTERN = /^[\w-]{1,100}\/sets\/[\w-]{1,255}$/
const OFFSET_PATTERN = /^\d{1,6}$/
const SCRIPT_PATTERN = /<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[\w.-]+\.js)"/g
const CLIENT_ID_PATTERN = /client_id\s*:\s*"([0-9a-zA-Z]{32})"/
const HOSTS = ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']
/** First path segments of SoundCloud pages that aren't users */
const RESERVED_PATHS = new Set([
  'apps', 'artists', 'charts', 'checkout', 'community-guidelines', 'connect', 'creators', 'discover', 'embed',
  'feed', 'for', 'go', 'help', 'imprint', 'jobs', 'legal', 'library', 'login', 'logout', 'messages', 'mobile',
  'notifications', 'oauth', 'pages', 'people', 'player', 'popular', 'premium', 'press', 'pro', 'search',
  'settings', 'signin', 'signup', 'stations', 'stream', 'tags', 'terms-of-use', 'upgrade', 'upload', 'you'
])
/** Pages below a user's page that still show the user */
const USER_SUBPAGES = new Set([
  'albums', 'comments', 'followers', 'following', 'likes', 'popular-tracks', 'reposts', 'sets', 'spotlight', 'tracks'
])

/** @type {Record<string, (id: string) => string>} */
const CHANNEL_TAB_PATHS = {
  tracks: id => `/users/${id}/tracks`,
  // Includes albums, which the single playlists tab also lists
  playlists: id => `/users/${id}/playlists`
}

/** @type {Record<string, string>} */
const SEARCH_PATHS = {
  tracks: '/search/tracks',
  channels: '/search/users',
  playlists: '/search/playlists'
}

/** The client ID of SoundCloud's web app, which the API requires */
let clientId = ''
/** @type {Promise<string> | null} */
let pendingClientId = null

/** Forgets the client ID, for tests. */
export function resetSoundCloudClientId() {
  clientId = ''
  pendingClientId = null
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function object(value) {
  return value !== null && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {}
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * SoundCloud IDs are numbers in its JSON.
 * @param {unknown} value
 * @returns {string}
 */
function idString(value) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value
  return typeof id === 'string' && ID_PATTERN.test(id) ? id : ''
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
 * Pages that yt-dlp and the app open, so they must be SoundCloud's own.
 * @param {unknown} value
 * @returns {string}
 */
function soundCloudUrl(value) {
  const url = httpsUrl(value)
  try {
    return url && new URL(url).hostname === 'soundcloud.com' ? url : ''
  } catch {
    return ''
  }
}

/**
 * Artwork and avatars come in their small `-large` size of 100 px.
 * @param {unknown} value
 * @returns {string}
 */
function image(value) {
  return httpsUrl(value).replace(/-large(\.\w+)$/, '-t500x500$1')
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
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * @param {Record<string, unknown>} value
 */
function isPrivate(value) {
  return value.public === false || value.sharing === 'private'
}

/**
 * @param {unknown} value
 * @returns {PlatformChannel | null}
 */
function parseUser(value) {
  const user = object(value)
  const id = idString(user.id)
  const url = soundCloudUrl(user.permalink_url)
  if (user.kind !== 'user' || !id || !url) return null
  const avatar = image(user.avatar_url)
  const visuals = object(user.visuals).visuals
  const banner = httpsUrl(Array.isArray(visuals) ? object(visuals[0]).visual_url : '')
  const description = text(user.description)
  const followerCount = count(user.followers_count)
  return {
    platform: PLATFORM,
    id,
    name: text(user.username) || text(user.permalink) || id,
    url,
    ...(avatar ? { avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(description ? { description } : {}),
    ...(followerCount === undefined ? {} : { followerCount })
  }
}

/**
 * @param {unknown} value
 * @returns {PlatformItem | null}
 */
function parseTrack(value) {
  const track = object(value)
  const id = idString(track.id)
  const url = soundCloudUrl(track.permalink_url)
  if (track.kind !== 'track' || !id || !url || isPrivate(track)) return null
  const user = object(track.user)
  const author = text(user.username)
  const duration = count(track.duration)
  const viewCount = count(track.playback_count)
  return {
    platform: PLATFORM,
    id,
    url,
    title: text(track.title) || author,
    author,
    channelId: idString(user.id) || idString(track.user_id),
    thumbnail: image(track.artwork_url) || image(user.avatar_url),
    published: timestamp(track.display_date) ?? timestamp(track.created_at),
    ...(duration === undefined ? {} : { duration: Math.round(duration / 1000) }),
    ...(viewCount === undefined ? {} : { viewCount }),
    isAudio: true
  }
}

/**
 * @param {unknown} value
 * @returns {PlatformPlaylist | null}
 */
function parsePlaylist(value) {
  const playlist = object(value)
  const id = idString(playlist.id)
  const url = soundCloudUrl(playlist.permalink_url)
  if (playlist.kind !== 'playlist' || !id || !url || isPrivate(playlist)) return null
  const user = object(playlist.user)
  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : []
  // Like SoundCloud, sets without artwork show the artwork of their first track
  const trackArtwork = tracks.map(track => image(object(track).artwork_url)).find(Boolean)
  const itemCount = count(playlist.track_count)
  return {
    platform: PLATFORM,
    id,
    url,
    title: text(playlist.title) || text(playlist.permalink) || id,
    author: text(user.username),
    channelId: idString(user.id) || idString(playlist.user_id),
    thumbnail: image(playlist.artwork_url) || trackArtwork || image(user.avatar_url),
    ...(itemCount === undefined ? {} : { itemCount })
  }
}

/**
 * @param {unknown} value
 * @returns {PlatformResult | null}
 */
function parseResult(value) {
  switch (object(value).kind) {
    case 'track': {
      const item = parseTrack(value)
      return item && { kind: 'item', item }
    }
    case 'user': {
      const channel = parseUser(value)
      return channel && { kind: 'channel', channel }
    }
    case 'playlist': {
      const playlist = parsePlaylist(value)
      return playlist && { kind: 'playlist', playlist }
    }
    default:
      return null
  }
}

/**
 * @param {PlatformFetch} fetcher
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
function get(fetcher, url, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return fetcher(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
}

/**
 * Finds the client ID in the scripts of SoundCloud's web app, like yt-dlp.
 * The later scripts hold it, so they are searched first.
 * @param {PlatformFetch} fetcher
 * @returns {Promise<string>}
 */
async function scrapeClientId(fetcher) {
  const response = await get(fetcher, `${WEB_URL}/`)
  if (!response.ok) throw new Error(`SoundCloud returned HTTP ${response.status}`)
  const scripts = [...(await response.text()).matchAll(SCRIPT_PATTERN)].map(match => match[1]).reverse()
  for (const script of new Set(scripts)) {
    const scriptResponse = await get(fetcher, script).catch(() => null)
    if (!scriptResponse?.ok) continue
    const match = CLIENT_ID_PATTERN.exec(await scriptResponse.text())
    if (match) return match[1]
  }
  throw new Error('SoundCloud client ID not found')
}

/**
 * The cached client ID, or a new one when there is none or the API rejected
 * `rejected`. Concurrent callers share one lookup, which isn't tied to any of
 * their signals, so that one caller giving up doesn't fail the others.
 * @param {PlatformFetch} fetcher
 * @param {string} [rejected]
 * @returns {Promise<string>}
 */
async function getClientId(fetcher, rejected = '') {
  if (clientId && clientId !== rejected) return clientId
  if (!pendingClientId) {
    /** @type {Promise<string>} */
    const pending = scrapeClientId(fetcher)
      .then(id => {
        if (pendingClientId === pending) clientId = id
        return id
      })
      .finally(() => {
        if (pendingClientId === pending) pendingClientId = null
      })
    pendingClientId = pending
  }
  return pendingClientId
}

/**
 * Requests the API with the client ID, and once more with a new one when
 * SoundCloud rejects it, since it changes with each release of the web app.
 * @param {PlatformFetch} fetcher
 * @param {URL} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>} null for things that don't exist
 */
async function api(fetcher, url, signal) {
  /** @param {string} id */
  const attempt = id => {
    const request = new URL(url)
    request.searchParams.set('client_id', id)
    return get(fetcher, request.href, signal)
  }
  const id = await getClientId(fetcher)
  let response = await attempt(id)
  if (response.status === 401 || response.status === 403) response = await attempt(await getClientId(fetcher, id))
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`SoundCloud returned HTTP ${response.status}`)
  return response.json()
}

/**
 * @param {string} path
 * @param {Record<string, string>} [params]
 */
function apiUrl(path, params = {}) {
  const url = new URL(path, API_ORIGIN)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

/**
 * @param {unknown} value
 * @param {string} pathname
 * @returns {URL | null}
 */
function nextPageUrl(value, pathname) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.origin === API_ORIGIN && url.pathname === pathname && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

/**
 * Loads a page of a list. `continuation` is the `next_href` of the previous
 * page, which must lead to the same list.
 * @param {PlatformFetch} fetcher
 * @param {string} pathname
 * @param {Record<string, string>} params
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function listPage(fetcher, pathname, params, continuation, signal) {
  let url = continuation === null ? apiUrl(pathname, params) : nextPageUrl(continuation, pathname)
  if (!url) throw new Error('Invalid SoundCloud continuation')
  // SoundCloud picks a page before it leaves out what it doesn't show, such as
  // private sets, so pages can be empty in the middle of a list. A few of them
  // are skipped in one go, and after that the next page is still offered.
  for (let request = 1; ; request++) {
    url.searchParams.set('limit', String(PAGE_SIZE))
    url.searchParams.set('linked_partitioning', '1')
    const data = object(await api(fetcher, url, signal))
    const collection = Array.isArray(data.collection) ? data.collection : []
    const results = collection.map(parseResult).filter(result => result !== null)
    const next = nextPageUrl(data.next_href, pathname)
    if (results.length > 0 || !next || request === MAX_REQUESTS_PER_PAGE) return { results, continuation: next ? next.href : null }
    url = next
  }
}

/**
 * The user a page belongs to, for the pages of the user itself. All-digit
 * permalinks such as soundcloud.com/123 exist, so they get an `@` to keep them
 * apart from user IDs.
 * @param {string} input
 * @returns {string | null}
 */
function parseChannelUrl(input) {
  const segments = soundCloudPath(input)
  if (!segments || segments.length < 1 || segments.length > 2) return null
  const [permalink, subpage] = segments
  if (!PERMALINK_PATTERN.test(permalink) || RESERVED_PATHS.has(permalink) ||
    (subpage !== undefined && !USER_SUBPAGES.has(subpage))) return null
  return ID_PATTERN.test(permalink) ? `@${permalink}` : permalink
}

/**
 * The lowercase path segments of a SoundCloud page.
 * @param {unknown} input
 * @returns {string[] | null}
 */
function soundCloudPath(input) {
  if (typeof input !== 'string') return null
  const value = input.trim()
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`)
    if (!['https:', 'http:'].includes(url.protocol) || !HOSTS.includes(url.hostname.toLowerCase()) ||
      url.port || url.username || url.password) return null
    return url.pathname.toLowerCase().split('/').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Takes a user ID, or a permalink from `parseChannelUrl`.
 * @param {PlatformFetch} fetcher
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformChannel | null>}
 */
async function getChannel(fetcher, id, signal) {
  if (typeof id !== 'string') return null
  const permalink = id.replace(/^@/, '').toLowerCase()
  let url
  if (ID_PATTERN.test(id)) {
    url = apiUrl(`/users/${id}`)
  } else if (PERMALINK_PATTERN.test(permalink) && !RESERVED_PATHS.has(permalink)) {
    url = apiUrl('/resolve', { url: `${WEB_URL}/${encodeURIComponent(permalink)}` })
  } else {
    return null
  }
  return parseUser(await api(fetcher, url, signal))
}

/**
 * @param {PlatformFetch} fetcher
 * @param {PlatformChannel} channel
 * @param {PlatformChannelTab} tab
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function getChannelPage(fetcher, channel, tab, continuation, signal) {
  const path = Object.hasOwn(CHANNEL_TAB_PATHS, tab) ? CHANNEL_TAB_PATHS[tab] : null
  if (!path) throw new Error(`SoundCloud channels have no ${tab} tab`)
  if (!ID_PATTERN.test(channel.id)) return { results: [], continuation: null }
  return listPage(fetcher, path(channel.id), {}, continuation, signal)
}

/**
 * @param {PlatformFetch} fetcher
 * @param {PlatformChannel} channel
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformItem[]>}
 */
async function getLatestItems(fetcher, channel, signal) {
  const { results } = await getChannelPage(fetcher, channel, 'tracks', null, signal)
  return results.flatMap(result => result.kind === 'item' ? [result.item] : [])
    .sort((a, b) => (b.published ?? -Infinity) - (a.published ?? -Infinity))
}

/**
 * @param {PlatformFetch} fetcher
 * @param {string} query
 * @param {PlatformSearchType} type
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function search(fetcher, query, type, continuation, signal) {
  const path = Object.hasOwn(SEARCH_PATHS, type) ? SEARCH_PATHS[type] : null
  if (!path) throw new Error(`SoundCloud can't search for ${type}`)
  const q = typeof query === 'string' ? query.trim() : ''
  if (!q) return { results: [], continuation: null }
  return listPage(fetcher, path, { q }, continuation, signal)
}

/**
 * Loads a set and a page of its tracks. SoundCloud only sends the first few
 * tracks in full and the others as bare IDs, which are looked up per page.
 * `continuation` is the position of the page.
 * @param {PlatformFetch} fetcher
 * @param {string} id a playlist ID, or a set path such as `user/sets/name`
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ playlist: PlatformPlaylist | null, page: PlatformPage }>}
 */
async function getPlaylist(fetcher, id, continuation, signal) {
  const empty = { playlist: null, page: { results: [], continuation: null } }
  if (continuation !== null && !OFFSET_PATTERN.test(continuation)) throw new Error('Invalid SoundCloud continuation')
  let url
  if (ID_PATTERN.test(id)) {
    url = apiUrl(`/playlists/${id}`)
  } else if (typeof id === 'string' && PLAYLIST_PATH_PATTERN.test(id.toLowerCase())) {
    url = apiUrl('/resolve', { url: `${WEB_URL}/${id.toLowerCase().split('/').map(encodeURIComponent).join('/')}` })
  } else {
    return empty
  }

  const data = await api(fetcher, url, signal)
  const playlist = parsePlaylist(data)
  if (!playlist) return empty

  const trackList = object(data).tracks
  /** @type {unknown[]} */
  const tracks = Array.isArray(trackList) ? trackList : []
  /** @param {unknown} track */
  const isStub = track => typeof object(track).permalink_url !== 'string'
  // Like empty pages of lists, a few slices whose tracks are all gone are skipped
  let offset = continuation === null ? 0 : Number(continuation)
  for (let requests = 0; ;) {
    const slice = tracks.slice(offset, offset + PLAYLIST_PAGE_SIZE)
    const missing = [...new Set(slice.filter(isStub).map(track => idString(object(track).id)).filter(Boolean))]

    /** @type {Map<string, unknown>} */
    const filled = new Map()
    if (missing.length > 0) {
      requests++
      // Tracks that were deleted or made private are left out of the answer
      const found = await api(fetcher, apiUrl('/tracks', { ids: missing.join(',') }), signal)
      for (const track of Array.isArray(found) ? found : []) filled.set(idString(object(track).id), track)
    }

    const results = slice
      .map(track => parseTrack(isStub(track) ? filled.get(idString(object(track).id)) : track))
      .flatMap(item => item ? [{ kind: /** @type {const} */ ('item'), item }] : [])
    offset += PLAYLIST_PAGE_SIZE
    const next = offset < tracks.length ? String(offset) : null
    if (results.length > 0 || next === null || requests >= MAX_REQUESTS_PER_PAGE) {
      return { playlist, page: { results, continuation: next } }
    }
  }
}

/** @type {Platform} */
export default {
  id: PLATFORM,
  name: 'SoundCloud',
  channelTabs: ['tracks', 'playlists'],
  searchTypes: ['tracks', 'channels', 'playlists'],
  liveStreams: false,
  parseChannelUrl,
  getChannel,
  getChannelPage,
  getLatestItems,
  search,
  getPlaylist
}
