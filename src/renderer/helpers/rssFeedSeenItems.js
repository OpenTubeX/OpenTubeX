// @ts-check

/**
 * Seen and unseen marks of RSS feed items, so that items marked on one device
 * are marked on the others too. They are saved in the `rssFeedSeenItems`
 * setting and sync with history through the `seenRssItems` collection.
 */

export const MAX_RSS_FEED_SEEN_ITEMS = 10000

/**
 * @typedef {{ key: string, seenAt?: number, unseenAt?: number }} RssFeedSeenItem
 * `key` is the feed URL and the item ID, separated by a line feed. The later of
 * `seenAt` and `unseenAt` decides whether the item is seen.
 */

/** @type {Set<(entries: RssFeedSeenItem[]) => void>} */
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

/**
 * Marks for items marked now. They stay ahead of the saved marks, which can
 * come from a device whose clock is ahead.
 * @param {RssFeedSeenItem[]} saved
 * @param {unknown} keys
 * @param {boolean} seen
 * @param {number} [timestamp]
 * @returns {RssFeedSeenItem[]}
 */
export function createRssFeedSeenMarks(saved, keys, seen, timestamp = Date.now()) {
  if (!Array.isArray(keys)) return []
  const latestByKey = new Map(saved.map(entry => [entry.key, latestMark(entry)]))
  return keys.filter(key => typeof key === 'string' && key.length > 0).map((key) => {
    const markedAt = Math.max(timestamp, (latestByKey.get(key) ?? 0) + 1)
    return seen ? { key, seenAt: markedAt } : { key, unseenAt: markedAt }
  })
}

/**
 * @param {unknown} value A JSON string or an array
 * @returns {Map<string, boolean>} whether each marked item is seen
 */
export function toRssFeedSeenMarks(value) {
  return new Map(parseRssFeedSeenItems(value).map(entry => [entry.key, isRssFeedItemSeen(entry)]))
}

/**
 * Called with the merged marks after a sync.
 * @param {(entries: RssFeedSeenItem[]) => void} listener
 */
export function onRssFeedSeenItemsSynced(listener) {
  listeners.add(listener)
}

/**
 * Syncs the marks with the `seenRssItems` collection.
 * @param {{ getSeenRssItems: () => Promise<unknown>, putSeenRssItems: (entries: RssFeedSeenItem[]) => Promise<void> }} client
 * @param {{ dispatch: (action: string, payload: unknown) => Promise<unknown>, state: { settings: { rssFeedSeenItems: string } } }} store
 * @returns {Promise<number>} the number of synced marks
 */
export async function syncRssFeedSeenItems(client, store) {
  const remote = await client.getSeenRssItems()
  await store.dispatch('mergeRssFeedSeenItems', remote)
  const merged = parseRssFeedSeenItems(store.state.settings.rssFeedSeenItems)
  for (const listener of listeners) listener(merged)
  await client.putSeenRssItems(merged)
  return merged.length
}
