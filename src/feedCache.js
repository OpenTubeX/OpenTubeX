// @ts-check

/**
 * The feed cache keeps one document per followed RSS feed and per followed
 * channel on another platform. The prefix of a document's ID tells which.
 */
export const RSS_FEED_CACHE_PREFIX = 'rss:'
export const PLATFORM_FEED_CACHE_PREFIX = 'platform:'

/**
 * @param {unknown} id
 * @returns {id is string}
 */
function isFeedCacheId(id) {
  return typeof id === 'string' && (id.startsWith(RSS_FEED_CACHE_PREFIX) || id.startsWith(PLATFORM_FEED_CACHE_PREFIX))
}

/**
 * Whether a window's write names only feed cache documents.
 * @param {any} change
 * @returns {change is { docs: { _id: string }[], removed: string[] }}
 */
export function isFeedCacheChange(change) {
  return change !== null && typeof change === 'object' &&
    Array.isArray(change.docs) && Array.isArray(change.removed) &&
    change.docs.every(doc => doc !== null && typeof doc === 'object' && !Array.isArray(doc) && isFeedCacheId(doc._id)) &&
    change.removed.every(isFeedCacheId)
}

/**
 * Arrays are equal when they hold the same elements. Unchanged items keep
 * their objects, so a document is only written when one of its items changed.
 * @param {unknown} a
 * @param {unknown} b
 */
function sameValue(a, b) {
  if (a === b) return true
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function sameDocument(a, b) {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}

/**
 * The documents to write so that the stored ones match `current`.
 * @param {Map<string, Record<string, unknown>>} stored the documents as last written or read, by ID
 * @param {Map<string, Record<string, unknown>>} current every document as it should be, by ID
 * @returns {{ docs: Record<string, unknown>[], removed: string[] }}
 */
export function diffFeedCacheDocuments(stored, current) {
  const docs = []
  for (const [id, document] of current) {
    const previous = stored.get(id)
    if (!previous || !sameDocument(previous, document)) docs.push({ ...document, _id: id })
  }
  return { docs, removed: [...stored.keys()].filter(id => !current.has(id)) }
}
