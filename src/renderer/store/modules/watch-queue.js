let nextQueueItemId = 1
const STORAGE_KEY = 'opentubex-watch-queue'
export const PERSISTED_MUTATIONS = new Set([
  'addVideoToWatchQueue',
  'removeVideoFromWatchQueue',
  'moveVideoInWatchQueue',
  'clearWatchQueue',
  'removeYtDlpDownload'
])

export function persistWatchQueue(store, storage, sharedQueue) {
  sharedQueue ??= process.env.IS_ELECTRON ? window.ftElectron.watchQueue : null
  let items = []
  try {
    if (!sharedQueue) {
      storage ??= localStorage
      items = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    }
  } catch (error) {
    console.warn('Could not restore the watch queue', error)
  }

  let revision = -1
  const applySharedQueue = snapshot => {
    if (snapshot.revision <= revision) return
    revision = snapshot.revision
    store.commit('setWatchQueue', snapshot.items)
  }
  if (sharedQueue) {
    applySharedQueue(sharedQueue.update({}))
    sharedQueue.onUpdated(applySharedQueue)
  } else {
    store.commit('restoreWatchQueue', items)
  }

  store.subscribe((mutation, state) => {
    if (!PERSISTED_MUTATIONS.has(mutation.type)) return
    try {
      // Main applies and saves each operation before replying, rather than
      // accepting a stale window's whole snapshot.
      if (sharedQueue) {
        applySharedQueue(sharedQueue.update(mutation))
        return
      }
      storage ??= localStorage
      storage.setItem(STORAGE_KEY, JSON.stringify(state.watchQueue.items))
    } catch (error) {
      console.warn('Could not save the watch queue', error)
    }
  })
}

export function createWatchQueueState() {
  return {
    items: []
  }
}

export const watchQueueGetters = {
  getWatchQueue: state => state.items,
  getWatchQueueLength: state => state.items.length,
  getNextQueuedVideo: state => state.items[0] ?? null
}

export const watchQueueMutations = {
  setWatchQueue(state, items) {
    state.items = items
  },

  restoreWatchQueue(state, items) {
    state.items = (Array.isArray(items) ? items : [])
      .filter(item => typeof item?.videoId === 'string' && item.videoId.length > 0)
      .map(item => ({ ...item, queueItemId: nextQueueItemId++ }))
  },

  addVideoToWatchQueue(state, { video, playNext = false }) {
    const item = {
      ...video,
      queueItemId: nextQueueItemId++
    }

    if (playNext) {
      state.items.unshift(item)
    } else {
      state.items.push(item)
    }
  },

  removeVideoFromWatchQueue(state, queueItemId) {
    const index = state.items.findIndex(item => item.queueItemId === queueItemId)
    if (index !== -1) {
      state.items.splice(index, 1)
    }
  },

  moveVideoInWatchQueue(state, { queueItemId, offset }) {
    const index = state.items.findIndex(item => item.queueItemId === queueItemId)
    const targetIndex = index + offset
    if (index === -1 || targetIndex < 0 || targetIndex >= state.items.length) {
      return
    }

    const [item] = state.items.splice(index, 1)
    state.items.splice(targetIndex, 0, item)
  },

  clearWatchQueue(state) {
    state.items.splice(0)
  },

  // Vuex broadcasts this mutation to both downloads and the watch queue, so
  // clearing history or deleting files also discards their queued copies.
  removeYtDlpDownload(state, id) {
    for (let index = state.items.length - 1; index >= 0; index--) {
      if (state.items[index].route?.query?.downloadId === String(id)) {
        state.items.splice(index, 1)
      }
    }
  }
}

export default {
  state: createWatchQueueState,
  getters: watchQueueGetters,
  mutations: watchQueueMutations
}
