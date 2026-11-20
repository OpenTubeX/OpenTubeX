import { SyncEvents } from '../../constants'
import { DBFeedCacheHandlers } from '../../datastores/handlers/index'
import { diffFeedCacheDocuments } from '../../feedCache'

/**
 * @typedef {Record<string, unknown>} FeedCacheDocument
 * @typedef {(changes: Map<string, FeedCacheDocument | null> | null) => void} RemoteChangeListener
 * receives the documents that another window changed, by key, `null` for the
 * removed ones, or `null` once the cache was cleared
 */

/** @type {Set<{ prefix: string, onChange: RemoteChangeListener }>} */
const mirrors = new Set()

/**
 * The stored documents by ID, as this window last read or wrote them
 * @type {Promise<Map<string, FeedCacheDocument>> | null}
 */
let storedDocuments = null
// Writes run one at a time, so a later write never reaches the datastore first
let writes = Promise.resolve()

/**
 * @param {Map<string, FeedCacheDocument>} documents
 * @param {{ docs: FeedCacheDocument[], removed: string[] } | null} change
 */
function applyRemoteChange(documents, change) {
  if (change === null) {
    documents.clear()
    for (const mirror of mirrors) mirror.onChange(null)
    return
  }
  /** @type {Map<string, FeedCacheDocument | null>} */
  const changes = new Map()
  for (const { _id, ...doc } of change.docs) {
    documents.set(/** @type {string} */ (_id), doc)
    changes.set(/** @type {string} */ (_id), doc)
  }
  for (const id of change.removed) {
    documents.delete(id)
    changes.set(id, null)
  }
  for (const { prefix, onChange } of mirrors) {
    const own = new Map([...changes].filter(([id]) => id.startsWith(prefix)).map(([id, doc]) => [id.slice(prefix.length), doc]))
    if (own.size > 0) onChange(own)
  }
}

function readStoredDocuments() {
  storedDocuments ??= DBFeedCacheHandlers.find().catch((error) => {
    console.error('Failed to load the feed cache', error)
    return []
  }).then((docs) => {
    const documents = new Map(docs.map(({ _id, ...doc }) => [_id, doc]))
    // Only changes after the read
    DBFeedCacheHandlers.onChange((event, change) => applyRemoteChange(documents, event === SyncEvents.GENERAL.DELETE_ALL ? null : change))
    return documents
  })
  return storedDocuments
}

/**
 * Keeps the documents whose IDs start with `prefix` in sync with a window's
 * state, which is the source of truth: it is loaded once, then written back
 * whenever it changes, so only the documents that differ are written.
 * @param {string} prefix
 * @param {RemoteChangeListener} onChange
 */
export function createFeedCacheMirror(prefix, onChange) {
  mirrors.add({ prefix, onChange })
  /** @type {(() => Map<string, FeedCacheDocument>) | null} */
  let pendingBuild = null
  /** @type {Promise<void>} */
  let pendingWrite = Promise.resolve()

  return {
    /** @type {Promise<Map<string, FeedCacheDocument>>} the stored documents, by key */
    loaded: readStoredDocuments().then(documents => new Map(
      [...documents].filter(([id]) => id.startsWith(prefix)).map(([id, doc]) => [id.slice(prefix.length), doc])
    )),

    /**
     * Saves the documents that `build` returns, by key. Saves that are made
     * before the previous one starts write once, with the latest state.
     * @param {() => Map<string, FeedCacheDocument>} build
     * @returns {Promise<void>} once the documents are written
     */
    save(build) {
      const queued = pendingBuild !== null
      pendingBuild = build
      if (queued) return pendingWrite
      pendingWrite = writes = writes.then(async () => {
        const documents = await readStoredDocuments()
        const current = /** @type {() => Map<string, FeedCacheDocument>} */ (pendingBuild)()
        pendingBuild = null
        const stored = new Map([...documents].filter(([id]) => id.startsWith(prefix)))
        const change = diffFeedCacheDocuments(stored, new Map([...current].map(([key, doc]) => [prefix + key, doc])))
        if (change.docs.length === 0 && change.removed.length === 0) return
        await DBFeedCacheHandlers.write(change)
        // Only once written, so that the next save retries a failed write. The
        // window's own objects, which its next save compares with.
        for (const { _id } of change.docs) documents.set(_id, current.get(_id.slice(prefix.length)))
        for (const id of change.removed) documents.delete(id)
      }).catch((error) => {
        console.error('Failed to save the feed cache', error)
      })
      return pendingWrite
    }
  }
}

/**
 * Removes the items and history of every feed and channel. The windows
 * forget theirs, and load them again on their next refresh.
 */
export async function clearFeedCache() {
  for (const mirror of mirrors) mirror.onChange(null)
  const cleared = writes.then(async () => {
    const documents = await readStoredDocuments()
    await DBFeedCacheHandlers.deleteAll()
    documents.clear()
  })
  writes = cleared.catch(() => {})
  await cleared
}
