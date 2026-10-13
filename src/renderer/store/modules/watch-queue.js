import { createWatchQueueState, watchQueueGetters, watchQueueMutations, PERSISTED_MUTATIONS } from '../../../watchQueue.js'
import { createBrowserWatchQueue } from '../../helpers/browserWatchQueue.js'

export { createWatchQueueState, watchQueueGetters, watchQueueMutations, PERSISTED_MUTATIONS }

const STORAGE_KEY = 'opentubex-watch-queue'

export function persistWatchQueue(store, storage, sharedQueue) {
  if (!sharedQueue) {
    if (process.env.IS_ELECTRON) sharedQueue = window.ftElectron.watchQueue
    else if (!process.env.IS_CAPACITOR && typeof indexedDB !== 'undefined') sharedQueue = createBrowserWatchQueue()
  }
  let items = []
  try {
    if (!sharedQueue) {
      storage ??= localStorage
      items = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    }
  } catch (error) {
    console.warn('Could not restore the watch queue', error)
  }

  let latest = { revision: -1, items: [] }
  const pending = []
  const applySharedQueue = (snapshot, settled = false) => {
    if (snapshot.revision > latest.revision) latest = snapshot
    else if (!settled) return
    // Keep local edits visible until their transactions commit, including
    // when an earlier reply or another tab's update arrives in the meantime.
    const state = { items: JSON.parse(JSON.stringify(latest.items)) }
    for (const request of pending) {
      if (PERSISTED_MUTATIONS.has(request.type)) watchQueueMutations[request.type](state, request.payload)
    }
    store.commit('setWatchQueue', state.items)
  }
  const updateSharedQueue = request => {
    const result = sharedQueue.update(request)
    if (result instanceof Promise) {
      pending.push(request)
      result.then(snapshot => {
        pending.splice(pending.indexOf(request), 1)
        applySharedQueue(snapshot, true)
      }).catch(error => {
        const index = pending.indexOf(request)
        if (index !== -1) pending.splice(index, 1)
        applySharedQueue(latest, true)
        console.warn('Could not persist the watch queue', error)
      })
    } else applySharedQueue(result)
  }
  if (sharedQueue) {
    sharedQueue.onUpdated(applySharedQueue)
    try {
      updateSharedQueue({})
    } catch (error) {
      console.warn('Could not restore the watch queue', error)
    }
  } else {
    store.commit('restoreWatchQueue', items)
  }

  store.subscribe((mutation, state) => {
    if (!PERSISTED_MUTATIONS.has(mutation.type)) return
    try {
      if (sharedQueue) {
        const payload = mutation.type === 'addVideoToWatchQueue'
          ? { ...mutation.payload, queueItemId: state.watchQueue.items[mutation.payload.playNext ? 0 : state.watchQueue.items.length - 1].queueItemId }
          : mutation.payload
        updateSharedQueue(JSON.parse(JSON.stringify({ type: mutation.type, payload })))
        return
      }
      storage ??= localStorage
      storage.setItem(STORAGE_KEY, JSON.stringify(state.watchQueue.items))
    } catch (error) {
      console.warn('Could not save the watch queue', error)
    }
  })
}

export default {
  state: createWatchQueueState,
  getters: watchQueueGetters,
  mutations: watchQueueMutations
}
