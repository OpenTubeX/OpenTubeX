// @ts-check

/**
 * Seen and unseen marks of RSS feed items, so that items marked on one device
 * are marked on the others too. They sync with history through the
 * `seenRssItems` collection.
 */

export const RSS_FEED_SEEN_ITEMS_STORAGE_KEY = 'rssFeedSeenItems'
export const MAX_RSS_FEED_SEEN_ITEMS = 10000

/**
 * @typedef {{ key: string, seenAt?: number, unseenAt?: number }} RssFeedSeenItem
 * `key` is the feed URL and the item ID, separated by a line feed. The later of
 * `seenAt` and `unseenAt` decides whether the item is seen.
 */

/** @type {Set<(marks: Map<string, boolean>) => void>} */
const listeners = new Set()

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * @param {unknown} value A JSON string or an array
 * @returns {RssFeedSeenItem[]}
 */
export function parseRssFeedSeenItems(value) {
  try {
    const entries = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(entries)) return []
    return entries
      .filter(entry => (
        typeof entry?.key === 'string' && entry.key.length > 0 &&
        (isTimestamp(entry.seenAt) || isTimestamp(entry.unseenAt))
      ))
      .map(({ key, seenAt, unseenAt }) => ({
        key,
        ...(isTimestamp(seenAt) ? { seenAt } : {}),
        ...(isTimestamp(unseenAt) ? { unseenAt } : {})
      }))
  } catch {
    return []
  }
}

/**
 * @param {RssFeedSeenItem} entry
 */
function latestMark(entry) {
  return Math.max(entry.seenAt ?? 0, entry.unseenAt ?? 0)
}

/**
 * @param {RssFeedSeenItem} entry
 */
export function isRssFeedItemSeen(entry) {
  return (entry.seenAt ?? 0) > (entry.unseenAt ?? 0)
}

/**
 * Keeps the latest seen and unseen times of each item, and the most recently
 * marked items.
 * @param {unknown} local
 * @param {unknown} remote
 * @returns {RssFeedSeenItem[]}
 */
export function mergeRssFeedSeenItems(local, remote) {
  /** @type {Map<string, RssFeedSeenItem>} */
  const byKey = new Map()
  for (const entry of [...parseRssFeedSeenItems(local), ...parseRssFeedSeenItems(remote)]) {
    const current = byKey.get(entry.key)
    const seenAt = Math.max(current?.seenAt ?? 0, entry.seenAt ?? 0)
    const unseenAt = Math.max(current?.unseenAt ?? 0, entry.unseenAt ?? 0)
    byKey.set(entry.key, {
      key: entry.key,
      ...(seenAt > 0 ? { seenAt } : {}),
      ...(unseenAt > 0 ? { unseenAt } : {})
    })
  }
  /** @param {RssFeedSeenItem} a @param {RssFeedSeenItem} b */
  const byItemKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  return [...byKey.values()]
    .sort((a, b) => latestMark(b) - latestMark(a) || byItemKey(a, b))
    .slice(0, MAX_RSS_FEED_SEEN_ITEMS)
    .sort(byItemKey)
}

/** @returns {RssFeedSeenItem[]} */
export function loadRssFeedSeenItems() {
  try {
    return parseRssFeedSeenItems(localStorage.getItem(RSS_FEED_SEEN_ITEMS_STORAGE_KEY))
  } catch {
    return []
  }
}

/**
 * @param {RssFeedSeenItem[]} entries
 * @returns {Map<string, boolean>} whether each marked item is seen
 */
function toMarks(entries) {
  return new Map(entries.map(entry => [entry.key, isRssFeedItemSeen(entry)]))
}

/**
 * @returns {Map<string, boolean>} whether each marked item is seen
 */
export function loadRssFeedSeenMarks() {
  return toMarks(loadRssFeedSeenItems())
}

/**
 * @param {RssFeedSeenItem[]} entries
 */
function saveRssFeedSeenItems(entries) {
  try {
    localStorage.setItem(RSS_FEED_SEEN_ITEMS_STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.error('Failed to save the seen RSS feed items', error)
  }
}

/**
 * @param {string[]} keys
 * @param {boolean} seen
 * @param {number} [timestamp]
 */
export function recordRssFeedSeenItems(keys, seen, timestamp = Date.now()) {
  if (keys.length === 0) return
  const saved = loadRssFeedSeenItems()
  const latestByKey = new Map(saved.map(entry => [entry.key, latestMark(entry)]))
  // Stay ahead of earlier marks, which can come from a device whose clock is ahead
  const marks = keys.map((key) => {
    const markedAt = Math.max(timestamp, (latestByKey.get(key) ?? 0) + 1)
    return seen ? { key, seenAt: markedAt } : { key, unseenAt: markedAt }
  })
  saveRssFeedSeenItems(mergeRssFeedSeenItems(saved, marks))
}

/**
 * Called with the downloaded marks after a sync.
 * @param {(marks: Map<string, boolean>) => void} listener
 */
export function onRssFeedSeenItemsSynced(listener) {
  listeners.add(listener)
}

/**
 * Syncs the marks with the `seenRssItems` collection.
 * @param {{ getSeenRssItems: () => Promise<unknown>, putSeenRssItems: (entries: RssFeedSeenItem[]) => Promise<void> }} client
 * @returns {Promise<number>} the number of synced marks
 */
export async function syncRssFeedSeenItems(client) {
  const remote = await client.getSeenRssItems()
  // Read after the download, so that marks recorded meanwhile are kept
  const merged = mergeRssFeedSeenItems(loadRssFeedSeenItems(), remote)
  saveRssFeedSeenItems(merged)
  const marks = toMarks(merged)
  for (const listener of listeners) listener(marks)
  await client.putSeenRssItems(merged)
  return merged.length
}
