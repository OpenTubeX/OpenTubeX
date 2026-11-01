import { shallowRef } from 'vue'

import store from '../store/index'
import { resolveYtDlpCreatorAvatarUrl } from '../../main/ytDlpCreatorAvatar'

const FETCH_TIMEOUT_MS = 15_000
const MAX_ITEMS_PER_FEED = 50

/**
 * @typedef {{ url: string, title: string, avatar?: string }} RssFeed
 * @typedef {{
 *   id: string,
 *   url: string,
 *   title: string,
 *   author: string,
 *   thumbnail: string,
 *   published: number | null,
 *   feedUrl: string
 * }} RssFeedItem
 */

/**
 * Feed items and images load from the user's own servers. Only plain web URLs
 * without embedded credentials are accepted.
 * @param {unknown} value
 * @param {string} [base]
 * @returns {string | null}
 */
export function normalizeHttpUrl(value, base) {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value.trim(), base)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * @param {Element} parent
 * @param {string[]} names
 */
function childElements(parent, names) {
  return Array.from(parent.children).filter(child => names.includes(child.localName))
}

/**
 * @param {Element} parent
 * @param {string[]} names
 */
function childText(parent, names) {
  for (const child of childElements(parent, names)) {
    const text = child.textContent?.trim()
    if (text) return text
  }
  return ''
}

/**
 * Atom text constructs can contain HTML. Only the text of the inert parsed
 * document is kept, so supplied markup never renders.
 * @param {Element} parent
 * @param {string[]} names
 */
function childPlainText(parent, names) {
  const element = childElements(parent, names).find(child => child.textContent?.trim())
  const text = element?.textContent?.trim() ?? ''
  return element?.getAttribute('type') === 'html'
    ? new DOMParser().parseFromString(text, 'text/html').body.textContent?.trim() ?? ''
    : text
}

/**
 * @param {Element} item
 * @param {string} base
 */
function itemLink(item, base) {
  const links = childElements(item, ['link'])
  // Podcast episodes play from their media, their page often only has show notes
  const media = [
    ...childElements(item, ['enclosure']).map(element => [element.getAttribute('url'), element.getAttribute('type')]),
    ...links.filter(link => link.getAttribute('rel') === 'enclosure').map(link => [link.getAttribute('href'), link.getAttribute('type')])
  ].find(([url, type]) => /^(?:audio|video)\//.test(type ?? '') && normalizeHttpUrl(url, base))
  if (media) return normalizeHttpUrl(media[0], base)

  // Atom links carry their target in `href`, preferring the alternate page
  const atomLink = links.find(link => link.hasAttribute('href') && (link.getAttribute('rel') ?? 'alternate') === 'alternate')
  const link = normalizeHttpUrl(atomLink?.getAttribute('href') ?? links.find(link => !link.hasAttribute('href'))?.textContent, base)
  if (link) return link

  const guid = childElements(item, ['guid'])[0]
  if (guid && guid.getAttribute('isPermaLink') !== 'false') {
    const permalink = normalizeHttpUrl(guid.textContent, base)
    if (permalink) return permalink
  }

  // Podcast feeds without a page link still point to their media
  return normalizeHttpUrl(childElements(item, ['enclosure'])[0]?.getAttribute('url'), base)
}

/**
 * @param {Element} item
 * @param {string} base
 */
function itemThumbnail(item, base) {
  const descendants = Array.from(item.getElementsByTagName('*'))
  const candidates = [
    ...descendants.filter(element => element.localName === 'thumbnail').map(element => element.getAttribute('url')),
    ...descendants.filter(element => element.localName === 'content' &&
      (element.getAttribute('medium') === 'image' || element.getAttribute('type')?.startsWith('image/')))
      .map(element => element.getAttribute('url')),
    ...childElements(item, ['enclosure']).filter(element => element.getAttribute('type')?.startsWith('image/'))
      .map(element => element.getAttribute('url')),
    ...childElements(item, ['image']).map(element => element.getAttribute('href'))
  ]
  for (const candidate of candidates) {
    const url = normalizeHttpUrl(candidate, base)
    if (url) return url
  }

  // Feeds such as RSSHub put the thumbnail into the HTML description. The
  // parsed document is inert, so its images don't load.
  for (const html of childElements(item, ['encoded', 'content', 'description', 'summary'])) {
    const source = html.getAttribute('type') === 'xhtml' ? html.innerHTML : html.textContent
    if (!source?.includes('<img')) continue
    const image = new DOMParser().parseFromString(source, 'text/html').querySelector('img[src]')
    const url = normalizeHttpUrl(image?.getAttribute('src'), base)
    if (url) return url
  }
  return ''
}

/**
 * @param {Element} item
 */
function itemAuthor(item) {
  const atomAuthor = childElements(item, ['author']).find(author => author.children.length > 0)
  if (atomAuthor) return childText(atomAuthor, ['name'])
  // RSS 2.0 authors are email addresses, usually followed by the name
  const author = childText(item, ['creator', 'author'])
  return author.match(/^\S+@\S+\s+\((.+)\)$/)?.[1] ?? author
}

/**
 * @param {Element} item
 */
function itemPublished(item) {
  // Publication dates win over update dates, whatever their order in the feed
  for (const name of ['published', 'pubDate', 'issued', 'date', 'updated']) {
    const published = Date.parse(childText(item, [name]))
    if (!Number.isNaN(published)) return published
  }
  return null
}

/**
 * The feed's own image, for example a podcast cover or a channel avatar.
 * @param {Element} channel
 * @param {string} base
 */
function feedImage(channel, base) {
  const candidates = [
    ...childElements(channel, ['image']).flatMap(image => [image.getAttribute('href'), childText(image, ['url'])]),
    childText(channel, ['icon']),
    childText(channel, ['logo'])
  ]
  for (const candidate of candidates) {
    const url = normalizeHttpUrl(candidate, base)
    if (url) return url
  }
  return null
}

/**
 * RSSHub routes that belong to a single creator. RSSHub instances run on any
 * host, so the routes only apply to feeds that RSSHub generated.
 * @type {{ pattern: RegExp, creator: (match: RegExpMatchArray) => Record<string, string> }[]}
 */
const RSSHUB_CREATOR_ROUTES = [
  {
    pattern: /^\/twitch\/(?:video|live|schedule)\/([a-zA-Z0-9_]+)(?:\/|$)/,
    creator: ([, login]) => ({ webpage_url: `https://www.twitch.tv/${login.toLowerCase()}`, channel: login.toLowerCase() })
  }
]

/**
 * The creator of an RSSHub feed, in the shape of yt-dlp metadata for the
 * creator avatar lookup.
 * @param {string} feedUrl
 */
export function getRssHubCreator(feedUrl) {
  try {
    const { pathname } = new URL(feedUrl)
    for (const route of RSSHUB_CREATOR_ROUTES) {
      const match = pathname.match(route.pattern)
      if (match) return route.creator(match)
    }
  } catch { }
  return null
}

/**
 * Reads RSS 2.0, RSS 1.0 (RDF) and Atom feeds.
 * @param {string} source
 * @param {string} feedUrl the followed address, which identifies the feed's items
 * @param {string} [baseUrl] the address after redirects, for relative links
 * @returns {{ title: string, items: RssFeedItem[], image: string | null, isRssHub: boolean }}
 */
export function parseRssFeed(source, feedUrl, baseUrl = feedUrl) {
  const document = new DOMParser().parseFromString(source, 'application/xml')
  const root = document.documentElement
  if (document.getElementsByTagName('parsererror').length > 0 || !['rss', 'RDF', 'feed'].includes(root.localName)) {
    throw new Error('Not an RSS or Atom feed')
  }

  const channel = root.localName === 'feed' ? root : childElements(root, ['channel'])[0]
  if (!channel) throw new Error('Not an RSS or Atom feed')

  const title = childPlainText(channel, ['title']) || new URL(feedUrl).hostname
  const entries = root.localName === 'feed'
    ? childElements(root, ['entry'])
    : childElements(root.localName === 'RDF' ? root : channel, ['item'])

  const items = entries.flatMap(entry => {
    const url = itemLink(entry, baseUrl)
    if (!url) return []
    return [{
      id: childText(entry, ['id', 'guid']) || url,
      url,
      title: childPlainText(entry, ['title']) || url,
      author: itemAuthor(entry) || title,
      thumbnail: itemThumbnail(entry, baseUrl),
      published: itemPublished(entry),
      feedUrl
    }]
  })
  items.sort(compareFeedItems)
  return {
    title,
    items: items.slice(0, MAX_ITEMS_PER_FEED),
    image: feedImage(channel, baseUrl),
    isRssHub: childText(channel, ['generator']).startsWith('RSSHub')
  }
}

/**
 * Newest first, undated items last.
 * @param {RssFeedItem} a
 * @param {RssFeedItem} b
 */
function compareFeedItems(a, b) {
  return (b.published ?? -Infinity) - (a.published ?? -Infinity)
}

/**
 * @param {string} url
 * @param {RequestInit} options
 */
async function appFetch(url, options) {
  if (process.env.IS_CAPACITOR) {
    const { capacitorHttpFetch } = await import('./api/capacitor-http')
    // Self-hosted feeds don't always use HTTPS
    return await capacitorHttpFetch(url, { ...options, allowHttp: true })
  }
  return await fetch(url, options)
}

/**
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
export async function fetchRssFeed(url, signal) {
  const response = await appFetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`)
  return parseRssFeed(await response.text(), url, response.url || url)
}

const ITEMS_STORAGE_KEY = 'rssFeedItems'

/**
 * The last loaded items, so that they show right away after a restart and
 * stay when their feed fails to refresh.
 * @returns {RssFeedItem[]}
 */
function loadStoredItems() {
  try {
    const items = JSON.parse(localStorage.getItem(ITEMS_STORAGE_KEY) ?? '[]')
    return Array.isArray(items) ? items : []
  } catch {
    return []
  }
}

/**
 * @param {RssFeedItem[]} items
 */
function setRssFeedItems(items) {
  rssFeedItems.value = items
  try {
    localStorage.setItem(ITEMS_STORAGE_KEY, JSON.stringify(items))
  } catch (error) {
    console.error('Failed to cache the RSS feed items', error)
  }
}

export const rssFeedItems = shallowRef(loadStoredItems())
/** URLs of the feeds that failed in the last refresh */
export const rssFeedErrors = shallowRef(/** @type {string[]} */ ([]))
export const rssFeedsLastRefresh = shallowRef(/** @type {number | null} */ (null))
export const rssFeedsRefreshing = shallowRef(false)
/** The feeds that the cached items belong to */
let refreshedFeedUrls = new Set()
let activeRefresh = null
/** Feeds that were added or retried on their own during the active refresh, with their items cached */
let loadedDuringRefresh = new Set()

/**
 * Removed feeds are filtered out of the cached items, added ones need a refresh.
 * @param {RssFeed[]} feeds
 */
export function rssFeedCacheCovers(feeds) {
  return rssFeedsLastRefresh.value !== null && feeds.every(feed => refreshedFeedUrls.has(feed.url))
}

/**
 * Creator avatars of RSSHub feeds come from the creator's platform, other
 * feeds can supply their own image.
 * @param {string} feedUrl
 * @param {{ image: string | null, isRssHub: boolean }} feed
 * @returns {Promise<string | null>}
 */
export async function resolveRssFeedAvatar(feedUrl, { image, isRssHub }) {
  const creator = isRssHub ? getRssHubCreator(feedUrl) : null
  const avatar = creator ? await resolveYtDlpCreatorAvatarUrl(creator, appFetch) : null
  return avatar ?? image
}

/** Feeds whose avatar was already looked up in this window */
const avatarLookups = new Set()

/**
 * Looks up the avatars of followed feeds that don't have one yet, once per window.
 * @param {[RssFeed, { image: string | null, isRssHub: boolean }][]} results
 */
export async function updateMissingRssFeedAvatars(results) {
  const pending = results.filter(([feed]) => !feed.avatar && !avatarLookups.has(feed.url))
  if (pending.length === 0) return
  pending.forEach(([feed]) => avatarLookups.add(feed.url))

  const avatars = new Map()
  await Promise.all(pending.map(async ([feed, result]) => {
    const avatar = await resolveRssFeedAvatar(feed.url, result).catch(() => null)
    if (avatar) avatars.set(feed.url, avatar)
  }))
  if (avatars.size === 0) return

  // Feeds can change while the lookups run
  await store.dispatch('updateFollowedRssFeeds', store.getters.getFollowedRssFeeds.map(feed => (
    avatars.has(feed.url) && !feed.avatar ? { ...feed, avatar: avatars.get(feed.url) } : feed
  )))
}

/**
 * Adds a freshly loaded feed to the cached items, so that adding or retrying a
 * feed doesn't reload the others.
 * @param {RssFeed} feed
 * @param {{ items: RssFeedItem[], image: string | null, isRssHub: boolean }} result
 */
export function addLoadedRssFeed(feed, result) {
  setRssFeedItems([...rssFeedItems.value.filter(item => item.feedUrl !== feed.url), ...result.items]
    .sort(compareFeedItems))
  refreshedFeedUrls.add(feed.url)
  loadedDuringRefresh.add(feed.url)
  rssFeedErrors.value = rssFeedErrors.value.filter(url => url !== feed.url)
}

/**
 * @param {RssFeed} feed
 */
export async function retryRssFeed(feed) {
  const result = await fetchRssFeed(feed.url)
  addLoadedRssFeed(feed, result)
  updateMissingRssFeedAvatars([[feed, result]])
}

/**
 * @param {RssFeed[]} feeds
 */
export async function refreshRssFeeds(feeds) {
  activeRefresh?.abort()
  const controller = new AbortController()
  activeRefresh = controller
  loadedDuringRefresh = new Set()
  rssFeedsRefreshing.value = true

  try {
    const results = await Promise.allSettled(feeds.map(feed => fetchRssFeed(feed.url, controller.signal)))
    if (controller.signal.aborted) return

    // Feeds added or retried while this refresh ran keep their own, newer result,
    // and feeds that fail keep their previous items
    const loadedUrls = loadedDuringRefresh
    const failedUrls = new Set(feeds.filter((feed, index) => results[index].status === 'rejected' && !loadedUrls.has(feed.url))
      .map(feed => feed.url))
    setRssFeedItems([
      ...rssFeedItems.value.filter(item => loadedUrls.has(item.feedUrl) || failedUrls.has(item.feedUrl)),
      ...results.flatMap((result, index) => (
        result.status === 'fulfilled' && !loadedUrls.has(feeds[index].url) ? result.value.items : []
      ))
    ].sort(compareFeedItems))
    rssFeedErrors.value = [...failedUrls]
    rssFeedsLastRefresh.value = Date.now()
    refreshedFeedUrls = new Set([...feeds.map(feed => feed.url), ...loadedUrls])
    updateMissingRssFeedAvatars(feeds.flatMap((feed, index) => {
      const result = results[index]
      return result.status === 'fulfilled' ? [[feed, result.value]] : []
    }))
  } finally {
    if (activeRefresh === controller) {
      activeRefresh = null
      rssFeedsRefreshing.value = false
    }
  }
}

export function openRssFeedManager() {
  store.commit('setSettingsWindowSection', { section: 'subscriptions', subpage: 'rss-feeds' })
  store.dispatch('showSettingsWindow')
}
