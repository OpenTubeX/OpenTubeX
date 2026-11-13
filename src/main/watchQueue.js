// @ts-check
import { createWatchQueueState, watchQueueMutations, PERSISTED_MUTATIONS } from '../watchQueue.js'
import { constants } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { createSerialQueue } from './serialQueue.js'
import { writeFileAtomic } from './writeFileAtomic.js'

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
  const enqueue = createSerialQueue()
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
  return request => enqueue(() => apply(request))
}

export function createFileWatchQueue(filename) {
  return createSharedWatchQueue({
    read: async () => {
      try {
        return JSON.parse(await readFile(filename, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return []
        // Without this, every request would retry the read and the queue
        // would stay unusable until the file is deleted by hand.
        if (error instanceof SyntaxError) {
          console.error('The saved watch queue is corrupt, starting with an empty queue', error)
          // Keep it for recovery, as the next change saves over it. A copy
          // never replaces an earlier one, and if it fails, the error keeps
          // the queue from saving over the file.
          await copyFile(filename, `${filename}.corrupt-${Date.now()}`, constants.COPYFILE_EXCL)
          return []
        }
        throw error
      }
    },
    write: items => writeFileAtomic(filename, JSON.stringify(items))
  })
}
