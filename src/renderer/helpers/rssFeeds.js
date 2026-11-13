import { computed, shallowRef } from 'vue'

import store from '../store/index'
import i18n from '../i18n/index'
import { startProgressBarOperation } from './progressBar'
import { shouldShowProgressStartToast } from './progressPresentation'
import { showToastOnAllTabs } from './utils'
import { appFetch } from './rssHub'
import { supportsYtDlp } from './ytDlpCapabilities'
import { isRssFeedItemSeen, onRssFeedSeenItemsSynced, parseRssFeedSeenItems, toRssFeedSeenMarks } from './rssFeedSeenItems'
import { unmarkExternalMediaWatchedBefore } from './externalMediaPosition'
import { resolveYtDlpCreatorAvatarUrl } from '../../main/ytDlpCreatorAvatar'
import { holdAndroidBackgroundWork } from './androidBackgroundSync.js'

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
 *   feedUrl: string,
 *   isNew?: boolean
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

/** The site only lets browsers through after a check, such as a Cloudflare challenge */
export class RssFeedBrowserCheckError extends Error {}

/**
 * @param {Response} response
 */
async function isBrowserCheck(response) {
  if (response.headers.get('cf-mitigated') === 'challenge') return true
  if (!response.headers.get('content-type')?.includes('text/html')) return false
  return /challenges\.cloudflare\.com|_cf_chl_opt|<title>Just a moment\.\.\.<\/title>/i.test(await response.text())
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
  if (!response.ok) {
    if (await isBrowserCheck(response)) throw new RssFeedBrowserCheckError(`Feed requires a browser check (HTTP ${response.status})`)
    throw new Error(`Feed returned HTTP ${response.status}`)
  }
  return parseRssFeed(await response.text(), url, response.url || url)
}

const ITEMS_STORAGE_KEY = 'rssFeedItems'
const NEXT_AUTO_REFRESH_STORAGE_KEY = 'rssFeedsNextAutoRefresh'
const LAST_REFRESH_STORAGE_KEY = 'rssFeedsLastRefresh'
const SEEN_HISTORY_STORAGE_KEY = 'rssFeedSeenHistory'
const MAX_SEEN_HISTORY_PER_FEED = 500

/**
 * @returns {Map<string, boolean>} whether each marked item is seen
 */
function loadRssFeedSeenMarks() {
  return toRssFeedSeenMarks(store.getters.getRssFeedSeenItems)
}

/**
 * The last loaded items, so that they show right away after a restart and
 * stay when their feed fails to refresh.
 * @returns {RssFeedItem[]}
 */
function loadStoredItems() {
  try {
    const items = JSON.parse(localStorage.getItem(ITEMS_STORAGE_KEY) ?? '[]')
    return Array.isArray(items) ? applySeenMarks(items, loadRssFeedSeenMarks()) : []
  } catch {
    return []
  }
}

/**
 * Items marked as seen are no longer new, items marked as unseen are new again.
 * @param {RssFeedItem[]} items
 * @param {Map<string, boolean>} marks whether each marked item is seen
 */
function applySeenMarks(items, marks) {
  if (marks.size === 0) return items
  let changed = false
  const marked = items.map((item) => {
    const seen = marks.get(getRssFeedItemKey(item))
    if (seen === undefined || seen === (item.isNew !== true)) return item
    changed = true
    return { ...item, isNew: !seen }
  })
  return changed ? marked : items
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

/**
 * The IDs of the items that weren't new in each feed that loaded before,
 * newest first. Unlike the cached items, they outlast items that leave their
 * feed, so that the items keep their state when they come back. A feed that
 * loaded empty, such as a live stream feed, has no IDs, so that its first item
 * still becomes new.
 * @returns {Map<string, string[]>}
 */
function loadSeenHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(SEEN_HISTORY_STORAGE_KEY) ?? '{}')
    if (history === null || typeof history !== 'object' || Array.isArray(history)) return new Map()
    return new Map(Object.entries(history).filter(([, ids]) => Array.isArray(ids)))
  } catch {
    return new Map()
  }
}

/**
 * @param {Map<string, string[]>} history
 */
function setSeenHistory(history) {
  seenHistory = history
  try {
    localStorage.setItem(SEEN_HISTORY_STORAGE_KEY, JSON.stringify(Object.fromEntries(history)))
  } catch (error) {
    console.error('Failed to save the seen RSS feed history', error)
  }
}

/**
 * @param {Map<string, string[]>} history updated in place
 * @param {string} feedUrl
 * @param {RssFeedItem[]} items the freshly loaded items of the feed
 * @param {RssFeedItem[]} previousItems the items of the feed it replaces
 */
function recordSeenHistory(history, feedUrl, items, previousItems) {
  // Items seen since the last refresh may have left the feed already
  const seenIds = new Set([...items, ...previousItems].filter(item => item.isNew !== true).map(item => item.id))
  const ids = new Set(items.map(item => item.id))
  history.set(feedUrl, [
    ...seenIds,
    ...(history.get(feedUrl) ?? []).filter(id => !seenIds.has(id) && !ids.has(id))
  ].slice(0, MAX_SEEN_HISTORY_PER_FEED))
}

/**
 * @param {string} key
 * @returns {number | null}
 */
function loadStoredTimestamp(key) {
  try {
    const timestamp = Number(localStorage.getItem(key))
    return timestamp > 0 ? timestamp : null
  } catch {
    return null
  }
}

/** @returns {number | null} */
export function loadRssFeedsNextAutoRefresh() {
  return loadStoredTimestamp(NEXT_AUTO_REFRESH_STORAGE_KEY)
}

/**
 * The deadline is shared, so that only one window refreshes the feeds.
 * @param {number | null} timestamp
 */
export function setRssFeedsNextAutoRefresh(timestamp) {
  rssFeedsNextAutoRefresh.value = timestamp
  try {
    if (timestamp === null) {
      localStorage.removeItem(NEXT_AUTO_REFRESH_STORAGE_KEY)
    } else {
      localStorage.setItem(NEXT_AUTO_REFRESH_STORAGE_KEY, String(timestamp))
    }
  } catch (error) {
    console.error('Failed to save the next RSS feed refresh', error)
  }
}

/**
 * The auto refresh interval in milliseconds, 0 while it doesn't apply.
 */
export function getRssFeedsAutoRefreshInterval() {
  if (!supportsYtDlp || !store.getters.getEnableRssFeeds || store.getters.getFollowedRssFeeds.length === 0) {
    return 0
  }
  return Math.max(Number.parseInt(store.getters.getRssFeedsAutoRefreshInterval, 10) || 0, 0)
}

export const rssFeedItems = shallowRef(loadStoredItems())
/** URLs of the feeds that failed in the last refresh */
export const rssFeedErrors = shallowRef(/** @type {string[]} */ ([]))
/** Whether the user closed the banner for the current failed feeds */
export const rssFeedErrorsDismissed = shallowRef(false)
/** When any window last refreshed every feed, kept across restarts like the items */
export const rssFeedsLastRefresh = shallowRef(loadStoredTimestamp(LAST_REFRESH_STORAGE_KEY))
/** Whether this window refreshed every feed */
let refreshedAllHere = false
const refreshingHere = shallowRef(false)
/** The locks that other windows hold while they refresh the feeds */
const otherWindowRefreshes = shallowRef(/** @type {Set<string>} */ (new Set()))
/** Whether this or another window refreshes the feeds */
export const rssFeedsRefreshing = computed(() => refreshingHere.value || otherWindowRefreshes.value.size > 0)
export const rssFeedsNextAutoRefresh = shallowRef(loadRssFeedsNextAutoRefresh())
/** The feeds that the cached items belong to */
let refreshedFeedUrls = new Set()
let seenHistory = loadSeenHistory()
let activeRefresh = null
/** Names this window's running refresh to the others */
let activeRefreshLockName = null
/** Feeds that were added or retried on their own during the active refresh, with their items cached */
let loadedDuringRefresh = new Set()

const REFRESH_LOCK_PREFIX = 'opentubex-rss-feeds-refresh:'
/** @type {BroadcastChannel | null} */
let refreshChannel = null

/**
 * @param {string} lockName held by another window until its refresh ends
 */
function trackOtherWindowRefresh(lockName) {
  if (otherWindowRefreshes.value.has(lockName)) return
  otherWindowRefreshes.value = new Set([...otherWindowRefreshes.value, lockName])
  // Granted once the refresh ends, also when its window closes or crashes
  navigator.locks.request(lockName, () => {
    otherWindowRefreshes.value = new Set([...otherWindowRefreshes.value].filter(name => name !== lockName))
  })
}

if (typeof window !== 'undefined') {
  // Other windows refresh the feeds and mark their items as seen too
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === ITEMS_STORAGE_KEY) rssFeedItems.value = loadStoredItems()
    if (event.key === null || event.key === SEEN_HISTORY_STORAGE_KEY) seenHistory = loadSeenHistory()
    if (event.key === null || event.key === NEXT_AUTO_REFRESH_STORAGE_KEY) rssFeedsNextAutoRefresh.value = loadRssFeedsNextAutoRefresh()
    if (event.key === null || event.key === LAST_REFRESH_STORAGE_KEY) rssFeedsLastRefresh.value = loadStoredTimestamp(LAST_REFRESH_STORAGE_KEY)
  })

  // Every window shows the refreshes of the others and can cancel them
  if (navigator.locks && typeof BroadcastChannel !== 'undefined') {
    refreshChannel = new BroadcastChannel('opentubex-rss-feeds-refresh')
    refreshChannel.addEventListener('message', ({ data }) => {
      if (data?.type === 'started' && typeof data.lockName === 'string') trackOtherWindowRefresh(data.lockName)
      // Only the refreshes the other window saw, not one that started since
      if (data?.type === 'cancel' && data.lockNames?.includes(activeRefreshLockName)) activeRefresh?.abort()
    })
    navigator.locks.query().then(({ held }) => {
      for (const { name } of held ?? []) {
        if (name?.startsWith(REFRESH_LOCK_PREFIX)) trackOtherWindowRefresh(name)
      }
    })
  }
}

/**
 * @param {RssFeedItem} item
 */
export function getRssFeedItemKey(item) {
  return `${item.feedUrl}\n${item.id}`
}

/**
 * Items that appeared since the previous load of their feed are new until
 * they are seen. The first load of a feed has nothing to compare to.
 * @param {string} feedUrl
 * @param {RssFeedItem[]} items
 * @param {RssFeedItem[]} previousItems the cached items of the same feed
 */
function reconcileNewItems(feedUrl, items, previousItems) {
  // Items can be marked on another device before they load here
  const entries = parseRssFeedSeenItems(store.getters.getRssFeedSeenItems)
  unwatchItemsMarkedUnseen(items, entries)
  const marks = toRssFeedSeenMarks(entries)
  const seenIds = seenHistory.get(feedUrl)
  if (seenIds === undefined && previousItems.length === 0) return applySeenMarks(items, marks)
  const previousById = new Map(previousItems.map(item => [item.id, item]))
  const seenBefore = new Set(seenIds)
  return items.map((item) => {
    const previous = previousById.get(item.id)
    const seen = marks.get(getRssFeedItemKey(item))
    return (seen === undefined ? (previous ? previous.isNew === true : !seenBefore.has(item.id)) : !seen)
      ? { ...item, isNew: true }
      : item
  })
}

/**
 * @param {RssFeedItem[]} items
 */
export function markRssFeedItemsAsSeen(items) {
  setRssFeedItemsSeen(items, true)
}

/**
 * @param {RssFeedItem[]} items
 */
export function markRssFeedItemsAsUnseen(items) {
  setRssFeedItemsSeen(items, false)
}

/**
 * @param {RssFeedItem[]} items
 * @param {boolean} seen
 */
function setRssFeedItemsSeen(items, seen) {
  const keys = new Set(items.map(getRssFeedItemKey))
  // A fresh unseen mark also outlasts an older seen mark from another device,
  // even for a new item that is only out of the New feed because it was watched
  const changedKeys = rssFeedItems.value
    .filter(item => (!seen || item.isNew === true) && keys.has(getRssFeedItemKey(item)))
    .map(getRssFeedItemKey)
  if (changedKeys.length === 0) return
  store.dispatch('mergeRssFeedSeenItems', { keys: changedKeys, seen }).catch((error) => {
    console.error('Failed to save the seen RSS feed items', error)
  })
  setRssFeedItems(applySeenMarks(rssFeedItems.value, new Map(changedKeys.map(key => [key, seen]))))
}

// Marks also change in other windows and with syncs
store.watch((_, getters) => getters.getRssFeedSeenItems, () => {
  const items = applySeenMarks(rssFeedItems.value, loadRssFeedSeenMarks())
  if (items !== rssFeedItems.value) setRssFeedItems(items)
})

/**
 * Devices can watch an item and mark it as unseen without knowing about each
 * other. The later change wins, so an unseen mark after the item was last
 * saved as watched unmarks it as watched, and brings it back to the New feed.
 * Items that are out of their feed when a mark syncs catch up when they load.
 * @param {RssFeedItem[]} items
 * @param {import('./rssFeedSeenItems').RssFeedSeenItem[]} entries
 */
function unwatchItemsMarkedUnseen(items, entries) {
  const unseenAt = new Map(entries.filter(entry => !isRssFeedItemSeen(entry)).map(entry => [entry.key, entry.unseenAt ?? 0]))
  if (unseenAt.size === 0) return
  for (const item of items) {
    const timestamp = unseenAt.get(getRssFeedItemKey(item))
    if (timestamp !== undefined) unmarkExternalMediaWatchedBefore(item.url, timestamp)
  }
}

onRssFeedSeenItemsSynced(entries => unwatchItemsMarkedUnseen(rssFeedItems.value, entries))

/**
 * The feeds whose cached items don't need a refresh. Removed feeds are filtered
 * out of the cached items, added ones need a refresh. Before the first refresh
 * in a window, the items cached by earlier sessions cover the feeds that loaded
 * before (those with a seen history), unless feeds are fetched on startup.
 * @returns {Set<string>}
 */
export function getCachedRssFeedUrls() {
  if (refreshedAllHere) return new Set(refreshedFeedUrls)
  if (store.getters.getFetchSubscriptionsAutomatically) return new Set()
  return new Set([...seenHistory.keys(), ...refreshedFeedUrls])
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
  await store.dispatch('updateFollowedRssFeeds', feeds => feeds.map(feed => (
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
  const previousItems = rssFeedItems.value.filter(item => item.feedUrl === feed.url)
  const items = reconcileNewItems(feed.url, result.items, previousItems)
  setRssFeedItems([...rssFeedItems.value.filter(item => item.feedUrl !== feed.url), ...items].sort(compareFeedItems))
  const history = new Map(seenHistory)
  recordSeenHistory(history, feed.url, items, previousItems)
  setSeenHistory(history)
  refreshedFeedUrls.add(feed.url)
  loadedDuringRefresh.add(feed.url)
  setRssFeedErrors(rssFeedErrors.value.filter(url => url !== feed.url))
}

/**
 * A closed banner stays closed until the set of failed feeds changes.
 * @param {string[]} urls
 */
function setRssFeedErrors(urls) {
  const previous = new Set(rssFeedErrors.value)
  if (urls.length !== previous.size || urls.some(url => !previous.has(url))) {
    rssFeedErrorsDismissed.value = false
  }
  rssFeedErrors.value = urls
}

/**
 * @param {RssFeed} feed
 */
export async function retryRssFeed(feed) {
  const releaseBackgroundHold = holdAndroidBackgroundWork()
  try {
    const result = await fetchRssFeed(feed.url)
    addLoadedRssFeed(feed, result)
    updateMissingRssFeedAvatars([[feed, result]])
  } finally {
    releaseBackgroundHold()
  }
}

const AUTO_REFRESH_TOAST_DURATION = 5000

/**
 * @param {RssFeed[]} feeds
 * @param {{ automatic?: boolean, cachedUrls?: Set<string> }} [options] `cachedUrls`
 * are feeds that keep their cached items instead of loading, such as the
 * feeds that loaded in an earlier session. The refresh then only loads the
 * others, and doesn't count as a refresh of all feeds.
 */
export async function refreshRssFeeds(feeds, { automatic = false, cachedUrls = new Set() } = {}) {
  activeRefresh?.abort()
  const controller = new AbortController()
  activeRefresh = controller
  loadedDuringRefresh = new Set()
  refreshingHere.value = true
  let finish
  const finished = new Promise(resolve => { finish = resolve })
  if (refreshChannel) {
    const lockName = REFRESH_LOCK_PREFIX + crypto.randomUUID()
    activeRefreshLockName = lockName
    navigator.locks.request(lockName, () => {
      refreshChannel.postMessage({ type: 'started', lockName })
      return finished
    })
  }
  // Shown as a notification or in the progress bar, like subscription refreshes
  const message = i18n.global.t('Subscriptions.RSS Feeds.Refreshing')
  const progress = startProgressBarOperation(store, { icon: ['fas', 'rss'], message, percentage: 0 })
  if (automatic && shouldShowProgressStartToast(store.getters.getEffectiveShowProgressBarToast)) {
    showToastOnAllTabs(message, AUTO_REFRESH_TOAST_DURATION, ['fas', 'rss'])
  }

  // Keep a hidden Android app running until the refresh ends. Subscription
  // refresh batches must not wait for RSS feeds, so this holds on its own.
  const releaseBackgroundHold = holdAndroidBackgroundWork()
  try {
    const cachedFeedUrls = new Set(feeds.filter(feed => cachedUrls.has(feed.url)).map(feed => feed.url))
    const fetchedFeeds = feeds.filter(feed => !cachedFeedUrls.has(feed.url))
    let settledCount = 0
    const results = await Promise.allSettled(fetchedFeeds.map(feed => fetchRssFeed(feed.url, controller.signal).finally(() => {
      if (!controller.signal.aborted) progress.update({ percentage: (++settledCount / fetchedFeeds.length) * 100 })
    })))
    if (controller.signal.aborted) return

    // Feeds added or retried while this refresh ran keep their own, newer result,
    // and cached feeds and feeds that fail keep their previous items
    const loadedUrls = loadedDuringRefresh
    const failedUrls = new Set(fetchedFeeds.filter((feed, index) => results[index].status === 'rejected' && !loadedUrls.has(feed.url))
      .map(feed => feed.url))
    const previousItems = rssFeedItems.value
    /** @type {Map<string, RssFeedItem[]>} */
    const refreshedItems = new Map(results.flatMap((result, index) => (
      result.status === 'fulfilled' && !loadedUrls.has(fetchedFeeds[index].url)
        ? [[fetchedFeeds[index].url, reconcileNewItems(fetchedFeeds[index].url, result.value.items, previousItems.filter(item => item.feedUrl === fetchedFeeds[index].url))]]
        : []
    )))
    setRssFeedItems([
      ...rssFeedItems.value.filter(item => cachedFeedUrls.has(item.feedUrl) || loadedUrls.has(item.feedUrl) || failedUrls.has(item.feedUrl)),
      ...[...refreshedItems.values()].flat()
    ].sort(compareFeedItems))
    setRssFeedErrors([...rssFeedErrors.value.filter(url => cachedFeedUrls.has(url)), ...failedUrls])
    if (cachedFeedUrls.size === 0) {
      refreshedAllHere = true
      rssFeedsLastRefresh.value = Date.now()
      try {
        localStorage.setItem(LAST_REFRESH_STORAGE_KEY, String(rssFeedsLastRefresh.value))
      } catch (error) {
        console.error('Failed to save the last RSS feed refresh', error)
      }
      const interval = getRssFeedsAutoRefreshInterval()
      setRssFeedsNextAutoRefresh(interval > 0 ? Date.now() + interval : null)
    }
    refreshedFeedUrls = new Set([...feeds.map(feed => feed.url), ...loadedUrls])
    // Removed feeds start over when they are added again
    const feedUrls = new Set(feeds.map(feed => feed.url))
    const history = new Map([...seenHistory].filter(([url]) => feedUrls.has(url) || loadedUrls.has(url)))
    for (const [url, items] of refreshedItems) recordSeenHistory(history, url, items, previousItems.filter(item => item.feedUrl === url))
    setSeenHistory(history)
    updateMissingRssFeedAvatars(fetchedFeeds.flatMap((feed, index) => {
      const result = results[index]
      return result.status === 'fulfilled' ? [[feed, result.value]] : []
    }))
  } finally {
    releaseBackgroundHold()
    finish()
    progress.finish()
    if (activeRefresh === controller) {
      activeRefresh = null
      activeRefreshLockName = null
      refreshingHere.value = false
    }
  }
}

/**
 * Stops the running refreshes of every window. Their feeds keep their previous
 * items and errors.
 */
export function cancelRssFeedsRefresh() {
  activeRefresh?.abort()
  refreshChannel?.postMessage({ type: 'cancel', lockNames: [...otherWindowRefreshes.value] })
}

export function openRssFeedManager() {
  store.commit('setSettingsWindowSection', { section: 'subscriptions', subpage: 'rss-feeds' })
  store.dispatch('showSettingsWindow')
}
