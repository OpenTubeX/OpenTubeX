// @ts-check

/**
 * Rumble has no public API, so this module reads its web pages. Channel pages
 * embed their video lists as JSON for a web component; search pages are plain
 * HTML. There is no DOMParser in Node, so the HTML is read with regular
 * expressions, one result at a time, and results that don't parse are skipped.
 *
 * @typedef {import('./types.js').Platform} Platform
 * @typedef {import('./types.js').PlatformChannel} PlatformChannel
 * @typedef {import('./types.js').PlatformChannelTab} PlatformChannelTab
 * @typedef {import('./types.js').PlatformFetch} PlatformFetch
 * @typedef {import('./types.js').PlatformItem} PlatformItem
 * @typedef {import('./types.js').PlatformPage} PlatformPage
 * @typedef {import('./types.js').PlatformResult} PlatformResult
 * @typedef {import('./types.js').PlatformSearchType} PlatformSearchType
 */

const PLATFORM = 'rumble'
const ORIGIN = 'https://rumble.com'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_PAGE = 10_000
const RUMBLE_HOSTS = ['rumble.com', 'www.rumble.com']
/** Rumble's own image hosts. Some avatars link to other sites, such as Facebook, which the app shouldn't contact. */
const IMAGE_HOST_PATTERN = /(?:^|\.)rumble\.(?:com|cloud)$/
const CHANNEL_ID_PATTERN = /^(c|user)\/[\w.-]{1,100}$/
const VIDEO_PATH_PATTERN = /^\/(v[a-z\d]{1,20})(?:-[^/]*)?\.html$/i
/** The `livestream_status` values, which match the `live` values that yt-dlp reads from Rumble */
const LIVE_STATUS_UPCOMING = 1
const LIVE_STATUS_LIVE = 2
const SEARCH_PATHS = /** @type {Partial<Record<PlatformSearchType, string>>} */ ({
  videos: '/search/video',
  channels: '/search/channel'
})
const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' })
const COUNT_SUFFIXES = /** @type {Record<string, number>} */ ({ k: 1e3, m: 1e6, b: 1e9 })

/**
 * @returns {PlatformPage}
 */
function emptyPage() {
  return { results: [], continuation: null }
}

/**
 * Text that only looks like an entity, such as a lone `&` in a title, stays as it is.
 * @param {string} text
 */
function decodeEntities(text) {
  return text.replaceAll(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]{2,6}));/gi, (entity, decimal, hex, name) => {
    if (name) return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : entity
    const code = decimal ? Number(decimal) : Number.parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : entity
  })
}

/**
 * The text of an HTML fragment. Icons go first, since their titles, such as
 * "Verified", aren't part of names. Removing a block can join the parts of
 * another one, so the removal repeats until none is left.
 * @param {string} html
 */
function text(html) {
  let content = html
  for (let previous; content !== previous;) {
    previous = content
    content = content.replaceAll(/<(svg|script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  }
  return decodeEntities(content.replaceAll(/<[^>]*>/g, ' '))
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/**
 * Rumble mixes quoted and unquoted attributes.
 * @param {string | undefined} tag an opening tag
 * @param {string} name
 * @returns {string | undefined}
 */
function attribute(tag, name) {
  const match = tag && new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(tag)
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * @param {string} tag
 * @param {string} className
 */
function hasClass(tag, className) {
  return (attribute(tag, 'class') ?? '').split(/\s+/).includes(className)
}

/**
 * The first element with the class: its opening tag and its content up to the
 * first closing tag of its kind, which suits elements without nested ones of
 * the same kind.
 * @param {string} html
 * @param {string} tagName
 * @param {string} className
 * @returns {{ tag: string, content: string } | null}
 */
function element(html, tagName, className) {
  for (const match of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))) {
    if (!hasClass(match[0], className)) continue
    const start = (match.index ?? 0) + match[0].length
    const close = new RegExp(`</${tagName}\\s*>`, 'gi')
    close.lastIndex = start
    return { tag: match[0], content: html.slice(start, close.exec(html)?.index ?? html.length) }
  }
  return null
}

/**
 * All class names used in an HTML fragment.
 * @param {string} html
 */
function classNames(html) {
  const names = new Set()
  for (const match of html.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    for (const name of (match[1] ?? match[2] ?? match[3]).split(/\s+/)) names.add(name)
  }
  return names
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function imageUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && IMAGE_HOST_PATTERN.test(url.hostname) ? value : ''
  } catch {
    return ''
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function timestamp(value) {
  const time = typeof value === 'string' && value ? Date.parse(value) : Number.NaN
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
 * @param {unknown} value
 * @returns {string | undefined}
 */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Reads counts like "1,234", "1.2K" and "3M".
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parseCount(value) {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*([kmb])?(?![a-z])/i.exec(value ?? '')
  if (!match) return undefined
  const number = Number(match[1].replaceAll(',', '')) * (COUNT_SUFFIXES[match[2]?.toLowerCase() ?? ''] ?? 1)
  return Number.isFinite(number) ? Math.round(number) : undefined
}

/**
 * Reads durations like "1:09:51" and "4:05".
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parseDuration(value) {
  const parts = /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})\s*$/.exec(value ?? '')
  return parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) : undefined
}

/**
 * @param {string | null} continuation
 * @returns {number | null} null for continuations this module didn't make
 */
function pageNumber(continuation) {
  if (continuation === null) return 1
  const page = /^\d{1,5}$/.test(continuation) ? Number(continuation) : 0
  return page >= 2 && page <= MAX_PAGE ? page : null
}

/**
 * The ID of the channel a page belongs to.
 * @param {string} url
 * @returns {string | null}
 */
function parseChannelUrl(url) {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url.trim())
    if (!['https:', 'http:'].includes(parsed.protocol) || !RUMBLE_HOSTS.includes(parsed.hostname) ||
      parsed.username || parsed.password) return null
    const [, kind, name] = parsed.pathname.split('/')
    const id = `${kind}/${name}`
    return CHANNEL_ID_PATTERN.test(id) ? id : null
  } catch {
    return null
  }
}

/**
 * @param {string | undefined} href a link on a Rumble page, which can be relative
 */
function channelIdFromLink(href) {
  if (!href) return null
  try {
    return parseChannelUrl(new URL(href, ORIGIN).href)
  } catch {
    return null
  }
}

/**
 * The page yt-dlp plays, without tracking parameters such as `e9s`.
 * @param {unknown} href a link on a Rumble page, which can be relative
 * @returns {{ id: string, url: string } | null}
 */
function parseVideoLink(href) {
  if (typeof href !== 'string' || !href) return null
  try {
    const url = new URL(href, ORIGIN)
    const match = VIDEO_PATH_PATTERN.exec(url.pathname)
    return match && ['https:', 'http:'].includes(url.protocol) && RUMBLE_HOSTS.includes(url.hostname)
      ? { id: match[1], url: `${ORIGIN}${url.pathname}` }
      : null
  } catch {
    return null
  }
}

/**
 * Whether the page links to another page of the same listing, as its
 * pagination does.
 * @param {string} html
 * @param {string} path such as `/search/video` or `/c/Name`
 * @param {number} page
 */
function linksToPage(html, path, page) {
  for (const [tag] of html.matchAll(/<(?:a|link)\b[^>]*>/gi)) {
    if (!tag.includes('page=')) continue
    const href = attribute(tag, 'href')
    if (!href) continue
    try {
      const url = new URL(href, ORIGIN)
      if (RUMBLE_HOSTS.includes(url.hostname) && url.pathname.toLowerCase() === path.toLowerCase() &&
        url.searchParams.get('page') === String(page)) return true
    } catch {
      // Not a link to follow
    }
  }
  return false
}

/**
 * Loads a page, or returns null when Rumble doesn't know it.
 * @param {PlatformFetch} fetcher
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function request(fetcher, url, signal) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetcher(url, {
    // Rumble's Cloudflare front answers requests without its cookie with a
    // redirect to the same page, so the session has to keep and send it
    credentials: 'include',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'text/html' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Rumble returned HTTP ${response.status}`)
  return response.text()
}

/**
 * @param {string} html a channel page
 * @param {string} id the requested channel ID
 * @returns {PlatformChannel}
 */
function parseChannelPage(html, id) {
  // Rumble redirects channel addresses in other letter case to the canonical
  // one, so the ID takes its case and matches the IDs in search results
  const canonical = channelIdFromLink(attribute(/<link\b[^>]*\srel\s*=\s*["']?canonical\b[^>]*>/i.exec(html)?.[0], 'href'))
  const channelId = canonical && canonical.toLowerCase() === id.toLowerCase() ? canonical : id

  const start = html.search(/<div\b[^>]*\sclass\s*=\s*["']?channel-header--container\b/i)
  const end = start === -1 ? -1 : html.indexOf('<section', start)
  const header = start === -1 ? '' : html.slice(start, end === -1 ? start + 30_000 : end)
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(header)
  const avatar = imageUrl(attribute(element(header, 'img', 'channel-header--img')?.tag, 'src'))
  const banner = imageUrl(attribute(element(header, 'img', 'channel-header--backsplash-img')?.tag, 'src'))
  const followerCount = parseCount(/(\d[\d,.]*\s*[kmb]?)\s*followers?\b/i.exec(text(header))?.[1])
  return {
    platform: PLATFORM,
    id: channelId,
    name: (heading && text(heading[1])) || channelId.split('/')[1],
    url: `${ORIGIN}/${channelId}`,
    ...(avatar ? { avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(followerCount === undefined ? {} : { followerCount })
  }
}

/**
 * @param {any} video an entry of a channel page's video list
 * @param {PlatformChannel} channel
 * @param {number} now
 * @returns {PlatformItem | null}
 */
function parseListedVideo(video, channel, now) {
  if (!video || typeof video !== 'object' || (video.object_type !== undefined && video.object_type !== 'video')) return null
  const link = parseVideoLink(video.url) ?? parseVideoLink(video.relative_url)
  if (!link) return null
  // Channel pages can list videos of other channels, such as reposts
  const byId = channelIdFromLink(nonEmpty(video.by?.url) ?? nonEmpty(video.by?.relative_url))
  const own = !byId || byId.toLowerCase() === channel.id.toLowerCase()
  const isLive = video.livestream_status === LIVE_STATUS_LIVE
  const scheduled = timestamp(video.live_datetime) ?? timestamp(video.upload_date)
  const isUpcoming = !isLive && video.livestream_status === LIVE_STATUS_UPCOMING && scheduled !== null && scheduled > now
  const viewCount = count(isLive ? video.watching_now : video.views)
  const duration = isLive || isUpcoming ? undefined : count(video.duration)
  return {
    platform: PLATFORM,
    id: link.id,
    url: link.url,
    title: nonEmpty(video.title) ?? link.id,
    author: own ? channel.name || (nonEmpty(video.by?.name) ?? '') : nonEmpty(video.by?.name) ?? '',
    channelId: own ? channel.id : /** @type {string} */ (byId),
    thumbnail: imageUrl(video.thumb),
    published: isUpcoming ? scheduled : timestamp(video.upload_date),
    ...(duration ? { duration } : {}),
    ...(viewCount === undefined ? {} : { viewCount }),
    ...(isLive ? { isLive: /** @type {true} */ (true) } : {}),
    ...(isUpcoming ? { isUpcoming: /** @type {true} */ (true) } : {})
  }
}

/**
 * The videos of a channel page. They're in JSON for the page's video grids,
 * which the page renders in the browser.
 * @param {string} html
 * @param {PlatformChannel} channel
 * @returns {PlatformItem[]}
 */
function parseChannelVideos(html, channel) {
  const now = Date.now()
  /** @type {Map<string, PlatformItem>} */
  const items = new Map()
  const grids = /<rum-videos-grid\b[^>]*>\s*<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  for (const [, json] of html.matchAll(grids)) {
    let videos
    try {
      videos = JSON.parse(json)?.items
    } catch {
      continue
    }
    if (!Array.isArray(videos)) continue
    for (const video of videos) {
      const item = parseListedVideo(video, channel, now)
      if (item && !items.has(item.id)) items.set(item.id, item)
    }
  }
  return [...items.values()]
}

/**
 * @param {string} block a video search result
 * @returns {PlatformItem | null}
 */
function parseVideoResult(block) {
  const link = [...block.matchAll(/<a\b[^>]*>/gi)]
    .map(([tag]) => parseVideoLink(attribute(tag, 'href')))
    .find(Boolean)
  if (!link) return null
  const classes = classNames(block)
  const isLive = classes.has('video-item--live') || classes.has('video-item--img-wrapper--live')
  const isUpcoming = !isLive && (classes.has('video-item--upcoming') || classes.has('video-item--img-wrapper--upcoming'))
  const image = element(block, 'img', 'video-item--img')?.tag
  const heading = element(block, 'h3', 'video-item--title')
  const byLink = element(block, 'a', 'video-item--by-a')
  const duration = isLive || isUpcoming ? undefined : parseDuration(attribute(element(block, 'span', 'video-item--duration')?.tag, 'data-value'))
  const views = element(block, 'div', 'video-item--views')
  const watching = element(block, 'span', 'video-item--watching')
  const viewCount = parseCount(text((isLive && watching ? watching : views)?.content ?? ''))
  return {
    platform: PLATFORM,
    id: link.id,
    url: link.url,
    title: (heading && text(heading.content)) || nonEmpty(attribute(image, 'alt')) || link.id,
    author: byLink ? text(byLink.content) : '',
    channelId: channelIdFromLink(attribute(byLink?.tag, 'href')) ?? '',
    thumbnail: imageUrl(attribute(image, 'src')),
    published: timestamp(attribute(/<time\b[^>]*>/i.exec(block)?.[0], 'datetime')),
    ...(duration ? { duration } : {}),
    ...(viewCount === undefined ? {} : { viewCount }),
    ...(isLive ? { isLive: /** @type {true} */ (true) } : {}),
    ...(isUpcoming ? { isUpcoming: /** @type {true} */ (true) } : {})
  }
}

/**
 * @param {string} html
 * @returns {PlatformResult[]}
 */
function parseVideoResults(html) {
  /** @type {PlatformResult[]} */
  const results = []
  for (const [, tag, block] of html.matchAll(/(<article\b[^>]*>)([\s\S]*?)<\/article\s*>/gi)) {
    if (!hasClass(tag, 'video-item')) continue
    const item = parseVideoResult(block)
    if (item && !results.some(result => result.kind === 'item' && result.item.id === item.id)) results.push({ kind: 'item', item })
  }
  return results
}

/**
 * Channel search shows avatars as background images of classes like
 * `user-image--img--id-0`, defined in the page's styles.
 * @param {string} html
 * @returns {PlatformResult[]}
 */
function parseChannelResults(html) {
  /** @type {Map<string, string>} */
  const avatars = new Map()
  for (const [, key, url] of html.matchAll(/\.user-image--img--id-([\w-]+)\s*\{\s*background-image:\s*url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
    avatars.set(key, imageUrl(url))
  }

  /** @type {PlatformResult[]} */
  const results = []
  for (const [block] of html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article\s*>/gi)) {
    const id = [...block.matchAll(/<a\b[^>]*>/gi)]
      .map(([tag]) => channelIdFromLink(attribute(tag, 'href')))
      .find(Boolean)
    if (!id || results.some(result => result.kind === 'channel' && result.channel.id === id)) continue
    const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/i.exec(block)
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(block)
    const avatarKey = /\buser-image--img--id-([\w-]+)/.exec(block)?.[1]
    const avatar = avatarKey ? avatars.get(avatarKey) : undefined
    const description = paragraph ? text(paragraph[1]) : ''
    const followerCount = parseCount(/(\d[\d,.]*\s*[kmb]?)\s*followers?\b/i.exec(text(block))?.[1])
    results.push({
      kind: 'channel',
      channel: {
        platform: PLATFORM,
        id,
        name: (heading && text(heading[1])) || id.split('/')[1],
        url: `${ORIGIN}/${id}`,
        ...(avatar ? { avatar } : {}),
        ...(description ? { description } : {}),
        ...(followerCount === undefined ? {} : { followerCount })
      }
    })
  }
  return results
}

/**
 * @param {PlatformFetch} fetcher
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformChannel | null>}
 */
async function getChannel(fetcher, id, signal) {
  if (!CHANNEL_ID_PATTERN.test(id)) return null
  const html = await request(fetcher, `${ORIGIN}/${id}`, signal)
  return html === null ? null : parseChannelPage(html, id)
}

/**
 * The channel's main page, since its videos tab leaves out live streams and
 * recorded broadcasts.
 * @param {PlatformFetch} fetcher
 * @param {PlatformChannel} channel
 * @param {PlatformChannelTab} tab
 * @param {string | null} continuation
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformPage>}
 */
async function getChannelPage(fetcher, channel, tab, continuation, signal) {
  const page = pageNumber(continuation)
  if (tab !== 'videos' || page === null || !CHANNEL_ID_PATTERN.test(channel.id)) return emptyPage()
  const path = `/${channel.id}`
  // Pages after the last one are missing
  const html = await request(fetcher, `${ORIGIN}${path}${page > 1 ? `?page=${page}` : ''}`, signal)
  if (html === null) return emptyPage()
  return {
    results: parseChannelVideos(html, channel).map(item => ({ kind: 'item', item })),
    continuation: linksToPage(html, path, page + 1) ? String(page + 1) : null
  }
}

/**
 * @param {PlatformFetch} fetcher
 * @param {PlatformChannel} channel
 * @param {AbortSignal} [signal]
 * @returns {Promise<PlatformItem[]>}
 */
async function getLatestItems(fetcher, channel, signal) {
  const { results } = await getChannelPage(fetcher, channel, 'videos', null, signal)
  return results
    .flatMap(result => result.kind === 'item' ? [result.item] : [])
    // Live streams keep the date they were created, which can be years ago
    .sort((a, b) => Number(Boolean(b.isLive)) - Number(Boolean(a.isLive)) || (b.published ?? 0) - (a.published ?? 0))
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
  const path = SEARCH_PATHS[type]
  const page = pageNumber(continuation)
  const terms = query.trim()
  if (!path || page === null || !terms) return emptyPage()
  const url = new URL(path, ORIGIN)
  url.searchParams.set('q', terms)
  if (page > 1) url.searchParams.set('page', String(page))
  const html = await request(fetcher, url.href, signal)
  if (html === null) return emptyPage()
  return {
    results: type === 'videos' ? parseVideoResults(html) : parseChannelResults(html),
    continuation: linksToPage(html, path, page + 1) ? String(page + 1) : null
  }
}

/** @type {Platform} */
const rumble = {
  id: PLATFORM,
  name: 'Rumble',
  channelTabs: ['videos'],
  searchTypes: ['videos', 'channels'],
  liveStreams: true,
  parseChannelUrl,
  // Rumble's playlists aren't supported
  parsePlaylistUrl: () => null,
  getChannel,
  getChannelPage,
  getLatestItems,
  search,
  getPlaylist: async () => ({ playlist: null, page: emptyPage() })
}

export default rumble
