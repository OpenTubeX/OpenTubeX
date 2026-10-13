import { createWatchQueueState, watchQueueMutations, PERSISTED_MUTATIONS } from '../watchQueue.js'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

// All Electron windows share one queue. Main applies every operation, so
// delayed renderer updates cannot overwrite changes.
export function createSharedWatchQueue(storage) {
  let state
  let revision = 0
  return request => {
    if (!state) {
      const restoredState = createWatchQueueState()
      watchQueueMutations.restoreWatchQueue(restoredState, storage.read())
      state = restoredState
    }
    if (PERSISTED_MUTATIONS.has(request.type)) {
      const previousItems = structuredClone(state.items)
      watchQueueMutations[request.type](state, request.payload)
      revision++
      try {
        storage.write(state.items)
      } catch (error) {
        state.items = previousItems
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
