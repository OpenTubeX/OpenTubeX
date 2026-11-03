// @ts-check
import { createWatchQueueState, watchQueueMutations, PERSISTED_MUTATIONS } from '../watchQueue.js'
import { readFile, writeFile, rename } from 'node:fs/promises'

/** @typedef {{ items: object[], revision: number }} WatchQueueSnapshot */

// All Electron windows share one queue. Main applies every operation in
// order, so delayed renderer updates cannot overwrite changes.
/**
 * @param {{ read: () => Promise<unknown>, write: (items: object[]) => Promise<void> }} storage
 * @returns {(request: any) => Promise<WatchQueueSnapshot>}
 */
export function createSharedWatchQueue(storage) {
  let state
  let revision = 0
  /** @type {Promise<unknown>} */
  let previousRequest = Promise.resolve()
  const apply = async request => {
    if (!state) {
      const restoredState = createWatchQueueState()
      watchQueueMutations.restoreWatchQueue(restoredState, await storage.read())
      state = restoredState
    }
    if (PERSISTED_MUTATIONS.has(request.type)) {
      // Mutations only add, remove and reorder items and never edit one, so
      // the previous order is enough to detect changes and roll them back.
      const previousItems = state.items.slice()
      watchQueueMutations[request.type](state, request.payload)
      // Every window forwards shared events such as download removals.
      // Only the first one changes the queue, so skip the others.
      if (state.items.length !== previousItems.length || state.items.some((item, index) => item !== previousItems[index])) {
        revision++
        try {
          await storage.write(state.items)
        } catch (error) {
          state.items = previousItems
          console.warn('Could not save the watch queue', error)
        }
      }
    }
    // IPC serializes the reply, so it only needs the current order.
    return { items: state.items.slice(), revision }
  }
  return request => {
    const result = previousRequest.then(() => apply(request))
    previousRequest = result.catch(() => {})
    return result
  }
}

export function createFileWatchQueue(filename) {
  return createSharedWatchQueue({
    read: async () => {
      try {
        return JSON.parse(await readFile(filename, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    write: async items => {
      await writeFile(`${filename}.tmp`, JSON.stringify(items))
      await rename(`${filename}.tmp`, filename)
    }
  })
}
