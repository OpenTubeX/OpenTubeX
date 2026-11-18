import { createWatchQueueState, watchQueueGetters, watchQueueMutations, PERSISTED_MUTATIONS } from '../../../watchQueue.js'
import { createBrowserWatchQueue } from '../../helpers/browserWatchQueue.js'

export { createWatchQueueState, watchQueueGetters, watchQueueMutations, PERSISTED_MUTATIONS }

const STORAGE_KEY = 'opentubex-watch-queue'

/** @param {string | null} scope */
function storageKey(scope) {
  return scope === null ? STORAGE_KEY : `${STORAGE_KEY}:${scope}`
}

/** Switches the queue to that of a data scope, see `getDataScope` */
let switchScope = async (_scope) => {}
/** Deletes a separate profile's queue */
let forgetScope = async (_scope) => {}

export function forgetWatchQueueScope(scope) {
  return forgetScope(scope)
}

export function persistWatchQueue(store, storage, sharedQueue) {
  if (!sharedQueue) {
    if (process.env.IS_ELECTRON) sharedQueue = window.ftElectron.watchQueue
    else if (!process.env.IS_CAPACITOR && typeof indexedDB !== 'undefined') sharedQueue = createBrowserWatchQueue()
  }
  /** Each separate profile has its own queue */
  let scope = null
  const readStoredItems = () => {
    try {
      storage ??= localStorage
      return JSON.parse(storage.getItem(storageKey(scope)) ?? '[]')
    } catch (error) {
      console.warn('Could not restore the watch queue', error)
      return []
    }
  }

  let latest = { revision: -1, items: [] }
  const pending = []
  const applySharedQueue = (snapshot, settled = false) => {
    // Other windows and tabs can show another profile's queue.
    if ((snapshot.scope ?? null) !== scope) return
    if (snapshot.revision > latest.revision) latest = snapshot
    else if (!settled) return
    // Keep local edits visible until their transactions commit, including
    // when an earlier reply or another tab's update arrives in the meantime.
    // Mutations never edit an item, so the snapshot's items can be shared.
    const state = { items: latest.items.slice() }
    for (const request of pending) {
      if (PERSISTED_MUTATIONS.has(request.type)) watchQueueMutations[request.type](state, request.payload)
    }
    // An item never changes after it is queued, so keep the current object
    // for each ID. Its card then only updates if the item itself is new.
    const current = store.getters.getWatchQueue
    const currentItems = new Map(current.map(item => [item.queueItemId, item]))
    const items = state.items.map(item => currentItems.get(item.queueItemId) ?? item)
    if (items.length !== current.length || items.some((item, index) => item !== current[index])) {
      store.commit('setWatchQueue', items)
    }
  }
  const updateSharedQueue = request => {
    const requestScope = scope
    const result = sharedQueue.update(request, requestScope)
    if (result instanceof Promise) {
      pending.push(request)
      // After a profile switch, the pending list and queue are another profile's.
      const settle = () => {
        if (scope !== requestScope) return false
        const index = pending.indexOf(request)
        if (index !== -1) pending.splice(index, 1)
        return true
      }
      result.then(snapshot => {
        if (settle()) applySharedQueue(snapshot, true)
      }).catch(error => {
        if (settle()) applySharedQueue({ ...latest, scope }, true)
        console.warn('Could not persist the watch queue', error)
      })
    } else applySharedQueue(result)
  }
  const restore = () => {
    if (sharedQueue) {
      try {
        updateSharedQueue({})
      } catch (error) {
        console.warn('Could not restore the watch queue', error)
      }
    } else {
      store.commit('restoreWatchQueue', readStoredItems())
    }
  }
  if (sharedQueue) sharedQueue.onUpdated(applySharedQueue)
  restore()

  switchScope = async (nextScope) => {
    // Snapshots of the shared queue carry a null scope.
    nextScope ??= null
    if (nextScope === scope) return
    scope = nextScope
    latest = { revision: -1, items: [] }
    // Requests made before the switch keep their own scope.
    pending.length = 0
    store.commit('setWatchQueue', [])
    restore()
  }
  forgetScope = async (forgottenScope) => {
    // Electron deletes the queue file with the profile's other data.
    if (process.env.IS_ELECTRON) return
    if (sharedQueue) await sharedQueue.forget?.(forgottenScope)
    else {
      try {
        storage ??= localStorage
        storage.removeItem(storageKey(forgottenScope))
      } catch (error) {
        console.warn('Could not delete the watch queue', error)
      }
    }
  }

  store.subscribe((mutation, state) => {
    if (!PERSISTED_MUTATIONS.has(mutation.type)) return
    try {
      if (sharedQueue) {
        const { items } = state.watchQueue
        let payload = mutation.payload
        if (mutation.type === 'addVideoToWatchQueue') {
          payload = { ...payload, queueItemId: items[payload.playNext ? 0 : items.length - 1].queueItemId }
        } else if (mutation.type === 'addVideosToWatchQueue' && !payload.queueItemIds) {
          payload = { ...payload, queueItemIds: items.slice(items.length - payload.videos.length).map(item => item.queueItemId) }
        }
        updateSharedQueue(JSON.parse(JSON.stringify({ type: mutation.type, payload })))
        return
      }
      storage ??= localStorage
      storage.setItem(storageKey(scope), JSON.stringify(state.watchQueue.items))
    } catch (error) {
      console.warn('Could not save the watch queue', error)
    }
  })
}

export default {
  state: createWatchQueueState,
  getters: watchQueueGetters,
  mutations: watchQueueMutations,
  actions: {
    loadWatchQueueScope(_context, scope) {
      return switchScope(scope)
    },
  },
}
