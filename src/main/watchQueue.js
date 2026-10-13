import { createWatchQueueState, watchQueueMutations, PERSISTED_MUTATIONS } from '../renderer/store/modules/watch-queue.js'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

// All Electron windows share one queue. Only main assigns its item IDs and
// applies operations, so delayed renderer updates cannot overwrite changes.
export function createSharedWatchQueue(storage) {
  let state
  let revision = 0
  return request => {
    if (!state) {
      state = createWatchQueueState()
      try {
        watchQueueMutations.restoreWatchQueue(state, storage.read())
      } catch (error) {
        console.warn('Could not restore the watch queue', error)
      }
    }
    if (PERSISTED_MUTATIONS.has(request.type)) {
      watchQueueMutations[request.type](state, request.payload)
      revision++
      try {
        storage.write(state.items)
      } catch (error) {
        console.warn('Could not save the watch queue', error)
      }
    }
    return { items: structuredClone(state.items), revision }
  }
}

export function createFileWatchQueue(filename) {
  return createSharedWatchQueue({
    read: () => {
      try {
        return JSON.parse(readFileSync(filename, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    write: items => {
      writeFileSync(`${filename}.tmp`, JSON.stringify(items))
      renameSync(`${filename}.tmp`, filename)
    }
  })
}
