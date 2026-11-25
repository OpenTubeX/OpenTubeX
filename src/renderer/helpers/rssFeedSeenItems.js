// @ts-check
import { isSeenMarksState, mergeSeenMarks, parseSeenMarks } from '../../seenMarks.js'

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

/** @type {import('../../seenMarks.js').SeenMarkKind<RssFeedSeenItem>} */
export const RSS_FEED_SEEN_ITEM_MARKS = {
  idKey: 'key',
  max: MAX_RSS_FEED_SEEN_ITEMS,
  parse: entries => entries
    .filter(entry => (
      typeof (/** @type {any} */ (entry)?.key) === 'string' && /** @type {any} */ (entry).key.length > 0 &&
      (isTimestamp(/** @type {any} */ (entry).seenAt) || isTimestamp(/** @type {any} */ (entry).unseenAt))
    ))
    .map(entry => {
      const { key, seenAt, unseenAt } = /** @type {RssFeedSeenItem} */ (entry)
      return {
        key,
        ...(isTimestamp(seenAt) ? { seenAt } : {}),
        ...(isTimestamp(unseenAt) ? { unseenAt } : {})
      }
    }),
  merge(previous, entry) {
    const seenAt = Math.max(previous?.seenAt ?? 0, entry.seenAt ?? 0)
    const unseenAt = Math.max(previous?.unseenAt ?? 0, entry.unseenAt ?? 0)
    return {
      key: entry.key,
      ...(seenAt > 0 ? { seenAt } : {}),
      ...(unseenAt > 0 ? { unseenAt } : {})
    }
  },
  latest: entry => latestMark(entry),
}

/**
 * @param {unknown} value A JSON string, an array, or the store's marks
 * @returns {RssFeedSeenItem[]}
 */
export function parseRssFeedSeenItems(value) {
  return parseSeenMarks(RSS_FEED_SEEN_ITEM_MARKS, value)
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
  return mergeSeenMarks(RSS_FEED_SEEN_ITEM_MARKS, local, remote)
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
 * Whether each marked item is seen.
 * @typedef {{ readonly size: number, get: (key: string) => boolean | undefined }} RssFeedSeenMarks
 */

/**
 * @param {unknown} value A JSON string, an array, or the store's marks, which
 *   it looks up without copying them
 * @returns {RssFeedSeenMarks}
 */
export function toRssFeedSeenMarks(value) {
  if (isSeenMarksState(value)) {
    const { byId } = value
    return {
      get size() { return byId.size },
      get: key => {
        const entry = byId.get(key)
        return entry && isRssFeedItemSeen(entry)
      },
    }
  }
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
 * @param {{ dispatch: (action: string, payload: unknown) => Promise<unknown>, state: { settings: { rssFeedSeenItems: unknown } } }} store
 * @returns {Promise<number>} the number of synced marks
 */
export async function syncRssFeedSeenItems(client, store) {
  const remote = await client.getSeenRssItems()
  await store.dispatch('mergeRssFeedSeenItems', remote)
  const merged = mergeRssFeedSeenItems(store.state.settings.rssFeedSeenItems, [])
  for (const listener of listeners) listener(merged)
  await client.putSeenRssItems(merged)
  return merged.length
}
