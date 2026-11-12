// @ts-check

/**
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPlaylist} PlatformPlaylist
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformResult} PlatformResult
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 */

const API_URL = 'https://api.na-backend.odysee.com/api/v1/proxy'
const SEARCH_URL = 'https://lighthouse.odysee.tv/search'
const WEB_URL = 'https://odysee.com'
const WEB_HOSTS = ['odysee.com', 'www.odysee.com']
const REQUEST_TIMEOUT_MS = 15_000
const PAGE_SIZE = 20

const CLAIM_ID_PATTERN = /^[0-9a-f]{40}$/
/**
 * Claim names as the LBRY URL spec allows them. Names are at most 255 bytes,
 * and channel names start with @.
 */
const NAME_PATTERN = /^[^=&#:$@%?;"/\\<>{}|^~`[\]\p{Cc}\u0020\uFFFE\uFFFF]{1,254}$/u
const CHANNEL_REFERENCE_PATTERN = /^@([^:#]+)(?:[:#]([0-9a-f]{1,40}))?$/i
const URL_PART_PATTERN = /^(@?)([^#]+)#([0-9a-f]{1,40})$/
const CONTINUATION_PATTERN = /^\d{1,6}$/

/** yt-dlp plays these, but not documents, images or other files */
const STREAM_TYPES = ['video', 'audio']
/** Tags of claims that Odysee hides from channel pages or that need a membership */
const HIDDEN_TAGS = ['c:unlisted', 'c:private', 'c:members-only']
/** The tag of a channel's list of featured channels, which the Odysee app keeps as a collection */
const FEATURED_CHANNELS_TAG = '__section__featured__'
const PAID_TAG_PATTERN = /^(?:c:)?(?:purchase|rental):/
const SCHEDULED_HIDDEN_TAG = 'c:scheduled:hide'

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isClaimId(value) {
  return typeof value === 'string' && CLAIM_ID_PATTERN.test(value)
}

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
    return new URL(value).protocol === 'https:' ? value : ''
  } catch {
    return ''
  }
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function count(value) {
  return Number.isFinite(value) && /** @type {number} */ (value) >= 0 ? /** @type {number} */ (value) : undefined
}

/**
 * Release times are strings in claims, timestamps are numbers.
 * @param {unknown} value
 * @returns {number | null} seconds
 */
function seconds(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null
}

/**
 * @param {any} claim
 * @returns {string[]}
 */
function tags(claim) {
  return Array.isArray(claim?.value?.tags) ? claim.value.tags.filter(tag => typeof tag === 'string') : []
}

/**
 * @param {string | null} continuation
 * @returns {number | null} null for continuations this module didn't make
 */
function parseContinuation(continuation) {
  if (continuation === null) return 0
  return CONTINUATION_PATTERN.test(continuation) ? Number(continuation) : null
}

/**
 * `@Name`, `@Name:prefix` or `@Name#prefix` in the form getChannel takes.
 * @param {string} reference
 */
function parseChannelReference(reference) {
  const [, name, prefix] = CHANNEL_REFERENCE_PATTERN.exec(reference) ?? []
  if (!name || !NAME_PATTERN.test(name)) return null
  return prefix ? `@${name}:${prefix.toLowerCase()}` : `@${name}`
}

/**
 * A `name#prefix` part of an `lbry://` URL as a segment of an Odysee page path.
 * @param {string} part
 */
function webPathSegment(part) {
  const [, at, name, prefix] = URL_PART_PATTERN.exec(part) ?? []
  // Names can't contain the URL delimiters that encodeURI keeps, such as / ? # :
  return name && NAME_PATTERN.test(name) ? `${at}${encodeURI(name)}:${prefix}` : null
}

/**
 * The Odysee page of a claim, built from its canonical `lbry://` URL, which
 * holds the shortest unique claim ID prefixes, or else from its full claim ID.
 * @param {any} claim
 */
function webUrl(claim) {
  const canonical = typeof claim.canonical_url === 'string' && claim.canonical_url.startsWith('lbry://')
    ? claim.canonical_url.slice('lbry://'.length).split('/')
    : []
  const segments = canonical.length === 1 || canonical.length === 2
    ? canonical.map(webPathSegment)
    : [typeof claim.name === 'string' ? webPathSegment(`${claim.name}#${claim.claim_id}`) : null]
  return segments.includes(null) ? '' : `${WEB_URL}/${segments.join('/')}`
}

/**
 * @param {any} channel the signing channel of a claim
 * @returns {{ author: string, channelId: string }}
 */
function author(channel) {
  if (!isClaimId(channel?.claim_id)) return { author: '', channelId: '' }
  const name = typeof channel.name === 'string' ? channel.name.replace(/^@/, '') : ''
  return { author: text(channel.value?.title) || name, channelId: channel.claim_id }
}

/**
 * @param {any} claim
 * @returns {PlatformChannel | null}
 */
function parseChannel(claim) {
  if (claim?.value_type !== 'channel' || !isClaimId(claim.claim_id) ||
    typeof claim.name !== 'string' || !claim.name.startsWith('@')) return null
  const url = webUrl(claim)
  if (!url) return null
  const avatar = httpsUrl(claim.value?.thumbnail?.url)
  const banner = httpsUrl(claim.value?.cover?.url)
  const description = text(claim.value?.description)
  return {
    platform: 'odysee',
    id: claim.claim_id,
    name: text(claim.value?.title) || claim.name.slice(1),
    url,
    ...(avatar ? { avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(description ? { description } : {})
  }
}

/**
 * A playable video or audio stream. Paid, members-only and hidden claims are
 * left out, since yt-dlp can't play them, as are reposts of deleted claims.
 * @param {any} claim
 * @param {number} now seconds
 * @returns {PlatformItem | null}
 */
function parseItem(claim, now) {
  const content = claim?.value_type === 'repost' ? claim.reposted_claim : claim
  const value = content?.value
  if (content?.value_type !== 'stream' || !isClaimId(content.claim_id) || !value?.source ||
    !STREAM_TYPES.includes(value.stream_type)) return null
  const claimTags = tags(content)
  if (Number(value.fee?.amount) > 0 || claimTags.some(tag => HIDDEN_TAGS.includes(tag) || PAID_TAG_PATTERN.test(tag))) return null
  const url = webUrl(content)
  if (!url) return null

  const released = seconds(value.release_time) ?? seconds(content.timestamp)
  const isUpcoming = released !== null && released > now
  // Scheduled uploads stay hidden until their release when the creator asks for it
  if (isUpcoming && claimTags.includes(SCHEDULED_HIDDEN_TAG)) return null
  const duration = count(value.video?.duration) ?? count(value.audio?.duration)
  return {
    platform: 'odysee',
    id: content.claim_id,
    url,
    title: text(value.title) || content.name,
    ...author(content.signing_channel),
    thumbnail: httpsUrl(value.thumbnail?.url),
    published: released === null ? null : released * 1000,
    ...(duration === undefined ? {} : { duration }),
    ...(isUpcoming ? { isUpcoming: true } : {}),
    ...(value.stream_type === 'audio' ? { isAudio: true } : {})
  }
}

/**
 * @param {any} claim
 * @returns {PlatformPlaylist | null}
 */
function parsePlaylist(claim) {
  if (claim?.value_type !== 'collection' || !isClaimId(claim.claim_id) || tags(claim).includes(FEATURED_CHANNELS_TAG)) return null
  const value = claim.value
  return {
    platform: 'odysee',
    id: claim.claim_id,
    // The playlist page, since collection pages look like video pages
    url: `${WEB_URL}/$/playlist/${claim.claim_id}`,
    title: text(value?.title) || (typeof claim.name === 'string' ? claim.name : ''),
    ...author(claim.signing_channel),
    thumbnail: httpsUrl(value?.thumbnail?.url),
    itemCount: Array.isArray(value?.claims) ? value.claims.length : 0
  }
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} url
 * @param {RequestInit} init
 * @param {AbortSignal} [signal]
 */
async function request(fetch, url, init, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(url, {
    ...init,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (!response.ok) throw new Error(`Odysee returned HTTP ${response.status}`)
  return response.json()
}

/**
 * @param {PlatformFetch} fetch
 * @param {'resolve' | 'claim_search'} method
 * @param {Record<string, unknown>} params
 * @param {AbortSignal} [signal]
 * @returns {Promise<any>}
 */
async function call(fetch, method, params, signal) {
  const data = await request(fetch, `${API_URL}?m=${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params })
  }, signal)
  if (data?.error) throw new Error(`Odysee returned an error: ${text(data.error.message) || 'unknown'}`)
  if (!data?.result || typeof data.result !== 'object') throw new Error('Odysee returned no result')
  return data.result
}

/**
 * @param {PlatformFetch} fetch
 * @param {Record<string, unknown>} params
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ items: any[], totalPages: number }>}
 */
async function claimSearch(fetch, params, signal) {
  const result = await call(fetch, 'claim_search', params, signal)
  return { items: Array.isArray(result.items) ? result.items : [], totalPages: count(result.total_pages) ?? 0 }
}

/**
 * Loads claims by ID in the order of the IDs, which claim_search doesn't keep.
 * @param {PlatformFetch} fetch
 * @param {string[]} ids
 * @param {Record<string, unknown>} params
 * @param {AbortSignal} [signal]
 */
async function claimsById(fetch, ids, params, signal) {
  if (ids.length === 0) return []
  const { items } = await claimSearch(fetch, { ...params, claim_ids: ids, page_size: ids.length, no_totals: true }, signal)
  const byId = new Map(items.map(claim => [claim?.claim_id, claim]))
  return ids.map(id => byId.get(id)).filter(Boolean)
}

/**
 * @param {PlatformResult[]} results
 * @param {string | null} continuation
 * @returns {PlatformPage}
 */
function page(results, continuation) {
  return { results, continuation }
}

/**
 * @param {any[]} claims
 * @returns {PlatformResult[]}
 */
function itemResults(claims) {
  const now = Date.now() / 1000
  return claims.flatMap(claim => {
    const item = parseItem(claim, now)
    return item ? [{ kind: /** @type {const} */ ('item'), item }] : []
  })
}

/**
 * @param {PlatformFetch} fetch
 * @param {string} channelId
 * @param {'stream' | 'collection'} claimType
 * @param {number} pageNumber
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function getChannelClaims(fetch, channelId, claimType, pageNumber, signal) {
  const { items, totalPages } = await claimSearch(fetch, {
    channel_ids: [channelId],
    claim_type: [claimType],
    ...(claimType === 'stream'
      ? { stream_types: STREAM_TYPES, has_source: true, not_tags: HIDDEN_TAGS }
      : { not_tags: [FEATURED_CHANNELS_TAG] }),
    order_by: ['release_time'],
    page: pageNumber,
    page_size: PAGE_SIZE
  }, signal)
  const results = claimType === 'stream'
    ? itemResults(items)
    : items.flatMap(claim => {
        const playlist = parsePlaylist(claim)
        return playlist ? [{ kind: /** @type {const} */ ('playlist'), playlist }] : []
      })
  return page(results, pageNumber < totalPages ? String(pageNumber + 1) : null)
}

/** @type {Platform} */
const odysee = {
  id: 'odysee',
  name: 'Odysee',
  channelTabs: ['videos', 'playlists'],
  searchTypes: ['videos', 'channels'],
  liveStreams: false,

  parseChannelUrl(input) {
    if (typeof input !== 'string') return null
    const value = input.trim()
    if (/^(?:lbry:\/\/)?@/i.test(value)) {
      // References with a claim after the channel aren't channels
      return parseChannelReference(value.replace(/^lbry:\/\//i, '').replace(/\?.*$/, '').replace(/\/$/, ''))
    }
    try {
      const url = new URL(value)
      if (!['https:', 'http:'].includes(url.protocol) || !WEB_HOSTS.includes(url.hostname.toLowerCase()) ||
        url.username || url.password) return null
      // Video pages have a second segment
      const segments = url.pathname.replace(/\/$/, '').split('/').slice(1)
      if (segments.length !== 1) return null
      const segment = decodeURIComponent(segments[0])
      // `@Name#prefix` arrives with the prefix as the fragment
      const prefix = !segment.includes(':') && /^#[0-9a-f]{1,40}$/i.test(url.hash) ? url.hash : ''
      return parseChannelReference(segment + prefix)
    } catch {
      return null
    }
  },

  parsePlaylistUrl(input) {
    if (typeof input !== 'string') return null
    try {
      const url = new URL(input.trim())
      if (!['https:', 'http:'].includes(url.protocol) || !WEB_HOSTS.includes(url.hostname.toLowerCase()) ||
        url.username || url.password) return null
      // Collection claims have URLs like videos, so only playlist pages are recognized
      const [, id] = /^\/\$\/(?:playlist|list)\/([0-9a-f]{40})\/?$/.exec(url.pathname) ?? []
      return id ?? null
    } catch {
      return null
    }
  },

  async getChannel(fetch, id, signal) {
    if (isClaimId(id)) {
      const [claim] = await claimsById(fetch, [id], { claim_type: ['channel'] }, signal)
      return parseChannel(claim)
    }
    const reference = typeof id === 'string' ? parseChannelReference(id) : null
    if (!reference) return null
    const url = `lbry://${reference.replace(':', '#')}`
    const result = await call(fetch, 'resolve', { urls: [url] }, signal)
    // Unknown channels have an error in place of the claim
    return parseChannel(result[url])
  },

  async getChannelPage(fetch, channel, tab, continuation, signal) {
    const offset = parseContinuation(continuation)
    if (!isClaimId(channel.id) || offset === null || (tab !== 'videos' && tab !== 'playlists')) return page([], null)
    return getChannelClaims(fetch, channel.id, tab === 'videos' ? 'stream' : 'collection', Math.max(offset, 1), signal)
  },

  async getLatestItems(fetch, channel, signal) {
    if (!isClaimId(channel.id)) return []
    const { results } = await getChannelClaims(fetch, channel.id, 'stream', 1, signal)
    return results.flatMap(result => result.kind === 'item' ? [result.item] : [])
  },

  async search(fetch, query, type, continuation, signal) {
    const from = parseContinuation(continuation)
    const terms = typeof query === 'string' ? query.trim() : ''
    if (!terms || from === null || (type !== 'videos' && type !== 'channels')) return page([], null)

    const params = new URLSearchParams({
      s: terms,
      size: String(PAGE_SIZE),
      from: String(from),
      claimType: type === 'videos' ? 'file' : 'channel',
      nsfw: 'false',
      ...(type === 'videos' ? { free_only: 'true', mediaType: STREAM_TYPES.join(',') } : {})
    })
    const hits = await request(fetch, `${SEARCH_URL}?${params}`, { method: 'GET' }, signal)
    if (!Array.isArray(hits)) throw new Error('Odysee returned no search results')
    const ids = [...new Set(hits.map(hit => hit?.claimId).filter(isClaimId))]
    const claims = await claimsById(fetch, ids, { claim_type: [type === 'videos' ? 'stream' : 'channel'] }, signal)

    /** @type {PlatformResult[]} */
    const results = type === 'videos'
      ? itemResults(claims)
      : claims.flatMap(claim => {
          const channel = parseChannel(claim)
          return channel ? [{ kind: /** @type {const} */ ('channel'), channel }] : []
        })
    return page(results, hits.length >= PAGE_SIZE ? String(from + PAGE_SIZE) : null)
  },

  async getPlaylist(fetch, id, continuation, signal) {
    const offset = parseContinuation(continuation)
    if (!isClaimId(id) || offset === null) return { playlist: null, page: page([], null) }
    const [claim] = await claimsById(fetch, [id], { claim_type: ['collection'] }, signal)
    const playlist = parsePlaylist(claim)
    if (!playlist) return { playlist: null, page: page([], null) }

    const ids = Array.isArray(claim.value?.claims) ? claim.value.claims.filter(isClaimId) : []
    // Without a claim type, so that reposts in the playlist are found too
    const claims = await claimsById(fetch, ids.slice(offset, offset + PAGE_SIZE), {}, signal)
    return {
      playlist,
      page: page(itemResults(claims), offset + PAGE_SIZE < ids.length ? String(offset + PAGE_SIZE) : null)
    }
  }
}

export default odysee
