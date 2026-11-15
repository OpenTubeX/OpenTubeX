// @ts-check

/**
 * media.ccc.de, the recordings of the Chaos Computer Club and other events.
 * Conferences are the channels, identified by their acronym, and their talks
 * are the items.
 *
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformResult} PlatformResult
 */

const PLATFORM = 'mediaccc'
const API_URL = 'https://api.media.ccc.de/public'
const WEB_URL = 'https://media.ccc.de'
const WEB_HOSTS = ['media.ccc.de', 'www.media.ccc.de']
const REQUEST_TIMEOUT_MS = 15_000
/** The talks of a conference the subscription feed gets */
const LATEST_COUNT = 20
/** The talks per page of search results */
const SEARCH_PAGE_SIZE = 25

/** Acronyms are case-sensitive, and some have spaces. Dot-only ones would climb API paths. */
const ACRONYM_PATTERN = /^(?!\.+$)[\w. -]{1,100}$/
const PAGE_PATTERN = /^[1-9]\d{0,5}$/

/**
 * @param {unknown} value
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {unknown} value
 */
function httpsUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

/**
 * yt-dlp plays this page, so only talk pages on the site qualify.
 * @param {unknown} value
 */
function talkUrl(value) {
  const url = httpsUrl(value)
  if (!url) return ''
  const { hostname, port, pathname } = new URL(url)
  return WEB_HOSTS.includes(hostname) && !port && pathname.startsWith('/v/') ? url : ''
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
 * @returns {value is string}
 */
function isAcronym(value) {
  return typeof value === 'string' && ACRONYM_PATTERN.test(value)
}

/**
 * The acronym at the end of a conference's API URL.
 * @param {unknown} value
 */
function conferenceAcronym(value) {
  const url = httpsUrl(value)
  const prefix = `${API_URL}/conferences/`
  if (!url.startsWith(prefix)) return ''
  try {
    const acronym = decodeURIComponent(url.slice(prefix.length))
    return isAcronym(acronym) ? acronym : ''
  } catch {
    return ''
  }
}

/**
 * @param {string} acronym
 */
function conferencePage(acronym) {
  return `${WEB_URL}/c/${encodeURIComponent(acronym)}`
}

/**
 * @param {any} data a conference in an API response
 * @returns {PlatformChannel | null}
 */
function parseConference(data) {
  if (!data || typeof data !== 'object' || !isAcronym(data.acronym)) return null
  /** @type {PlatformChannel} */
  const channel = {
    platform: PLATFORM,
    id: data.acronym,
    name: text(data.title) || data.acronym,
    url: conferencePage(data.acronym)
  }
  const avatar = httpsUrl(data.logo_url)
  const description = text(data.description)
  if (avatar) channel.avatar = avatar
  if (description) channel.description = description
  return channel
}

/**
 * @param {any} event a talk in an API response
 * @param {{ id: string, name: string } | null} conference the conference that lists it
 * @returns {PlatformItem | null}
 */
function parseEvent(event, conference) {
  if (!event || typeof event !== 'object' || typeof event.guid !== 'string' || !event.guid) return null
  const url = talkUrl(event.frontend_link)
  if (!url) return null
  const author = conference?.name || text(event.conference_title)
  /** @type {PlatformItem} */
  const item = {
    platform: PLATFORM,
    id: event.guid,
    url,
    title: text(event.title) || author,
    author,
    channelId: conference?.id ?? conferenceAcronym(event.conference_url),
    thumbnail: httpsUrl(event.thumb_url) || httpsUrl(event.poster_url),
    // Recordings come out after the talk, and may come out again later
    published: timestamp(event.release_date) ?? timestamp(event.date)
  }
  const duration = count(event.length) || count(event.duration)
  const viewCount = count(event.view_count)
  if (duration) item.duration = duration
  if (viewCount !== undefined) item.viewCount = viewCount
  return item
}

/**
 * @param {PlatformItem} item
 * @returns {PlatformResult}
 */
function itemResult(item) {
  return { kind: 'item', item }
}

/**
 * @returns {PlatformPage}
 */
function emptyPage() {
  return { results: [], continuation: null }
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ data: any, headers: Headers } | null>} null for unknown conferences
 */
async function request(fetch, url, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`media.ccc.de returned HTTP ${response.status}`)
  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!data || typeof data !== 'object') throw new Error('media.ccc.de returned no data')
  return { data, headers: response.headers }
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} acronym
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ channel: PlatformChannel, items: PlatformItem[] } | null>} its talks newest first
 */
async function getConference(fetch, acronym, signal) {
  if (!isAcronym(acronym)) return null
  const response = await request(fetch, `${API_URL}/conferences/${encodeURIComponent(acronym)}`, signal)
  const channel = parseConference(response?.data)
  if (!channel) return null
  const events = Array.isArray(response?.data.events) ? response.data.events : []
  const items = events.flatMap(event => parseEvent(event, channel) ?? [])
    .sort((a, b) => (b.published ?? 0) - (a.published ?? 0))
  return { channel, items }
}

/**
 * Conference pages, also when they show the talks of one of its tracks.
 * @param {string} url
 * @returns {string | null}
 */
function parseChannelUrl(url) {
  try {
    const page = new URL(url.trim())
    if (!['https:', 'http:'].includes(page.protocol) || page.port || page.username || page.password ||
      !WEB_HOSTS.includes(page.hostname.toLowerCase())) return null
    const [section, acronym] = page.pathname.split('/').slice(1).map(decodeURIComponent)
    return section === 'c' && isAcronym(acronym) ? acronym : null
  } catch {
    return null
  }
}

/**
 * Conferences whose title, acronym or path has every word of the query. The API
 * only searches talks, so this filters the list of all conferences.
 * @param {PlatformFetch} fetch
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function searchConferences(fetch, query, signal) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const response = await request(fetch, `${API_URL}/conferences`, signal)
  const conferences = Array.isArray(response?.data.conferences) ? response.data.conferences : []
  const results = conferences
    .filter(data => {
      // Paths like congress/2024 find conferences of a series
      const name = `${text(data?.title)} ${text(data?.acronym)} ${text(data?.slug)}`.toLowerCase()
      return words.every(word => name.includes(word))
    })
    // The newest conferences first
    .sort((a, b) => (timestamp(b.event_last_released_at) ?? 0) - (timestamp(a.event_last_released_at) ?? 0))
    .flatMap(data => {
      const channel = parseConference(data)
      return channel ? [{ kind: /** @type {const} */ ('channel'), channel }] : []
    })
  return { results, continuation: null }
}

/** @type {Platform} */
const mediaccc = {
  id: PLATFORM,
  name: 'media.ccc.de',
  channelTabs: ['videos'],
  searchTypes: ['videos', 'channels'],
  liveStreams: false,
  parseChannelUrl,

  async getChannel(fetch, id, signal) {
    return (await getConference(fetch, id, signal))?.channel ?? null
  },

  // Conferences list all their talks at once
  async getChannelPage(fetch, channel, tab, continuation, signal) {
    if (tab !== 'videos' || continuation !== null) return emptyPage()
    const conference = await getConference(fetch, channel.id, signal)
    return { results: conference?.items.map(itemResult) ?? [], continuation: null }
  },

  async getChannelWithPage(fetch, id, tab, signal) {
    const conference = await getConference(fetch, id, signal)
    return conference && {
      channel: conference.channel,
      page: Promise.resolve(tab === 'videos' ? { results: conference.items.map(itemResult), continuation: null } : emptyPage())
    }
  },

  async getLatestItems(fetch, channel, signal) {
    return (await getConference(fetch, channel.id, signal))?.items.slice(0, LATEST_COUNT) ?? []
  },

  async search(fetch, query, type, continuation, signal) {
    const terms = typeof query === 'string' ? query.trim() : ''
    if (!terms || terms.length > 200) return emptyPage()
    if (type === 'channels') return continuation === null ? searchConferences(fetch, terms, signal) : emptyPage()
    if (type !== 'videos' || (continuation !== null && !PAGE_PATTERN.test(continuation))) return emptyPage()
    const page = continuation === null ? 1 : Number(continuation)
    const url = new URL(`${API_URL}/events/search`)
    url.searchParams.set('q', terms)
    url.searchParams.set('page', String(page))
    const response = await request(fetch, url.href, signal)
    const events = Array.isArray(response?.data.events) ? response.data.events : []
    const total = Number.parseInt(response?.headers.get('total') ?? '', 10)
    const perPage = Number.parseInt(response?.headers.get('per-page') ?? '', 10) || SEARCH_PAGE_SIZE
    const hasMore = events.length > 0 && (Number.isNaN(total) ? events.length >= perPage : page * perPage < total)
    return {
      results: events.flatMap(event => {
        const item = parseEvent(event, null)
        return item ? [itemResult(item)] : []
      }),
      continuation: hasMore ? String(page + 1) : null
    }
  },

  async getPlaylist() {
    return { playlist: null, page: emptyPage() }
  }
}

export default mediaccc
