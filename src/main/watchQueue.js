import { createWatchQueueState, watchQueueMutations, PERSISTED_MUTATIONS } from '../watchQueue.js'
import { readFile, writeFile, rename } from 'node:fs/promises'

// All Electron windows share one queue. Main applies every operation in
// order, so delayed renderer updates cannot overwrite changes.
export function createSharedWatchQueue(storage) {
  let state
  let revision = 0
  let previousRequest = Promise.resolve()
  const apply = async request => {
    if (!state) {
      const restoredState = createWatchQueueState()
      watchQueueMutations.restoreWatchQueue(restoredState, await storage.read())
      state = restoredState
    }
    if (PERSISTED_MUTATIONS.has(request.type)) {
      const previousItems = structuredClone(state.items)
      watchQueueMutations[request.type](state, request.payload)
      // Every window forwards shared events such as download removals.
      // Only the first one changes the queue, so skip the others.
      if (JSON.stringify(state.items) !== JSON.stringify(previousItems)) {
        revision++
        try {
          await storage.write(state.items)
        } catch (error) {
          state.items = previousItems
          console.warn('Could not save the watch queue', error)
        }
      }
    }
    return { items: structuredClone(state.items), revision }
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
