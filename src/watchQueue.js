export const PERSISTED_MUTATIONS = new Set([
  'addVideoToWatchQueue',
  'removeVideoFromWatchQueue',
  'moveVideoInWatchQueue',
  'clearWatchQueue',
  'removeYtDlpDownload'
])

// A queued item keeps its identity across tabs, including while its write is
// pending. Random IDs avoid collisions between independently running stores.
function createQueueItemId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
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
      .map(item => ({ ...item, queueItemId: createQueueItemId() }))
  },

  addVideoToWatchQueue(state, { video, playNext = false, queueItemId = createQueueItemId() }) {
    if (state.items.some(item => item.queueItemId === queueItemId)) return
    const item = {
      ...video,
      queueItemId
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

  moveVideoInWatchQueue(state, { queueItemId, targetQueueItemId, after = false }) {
    const index = state.items.findIndex(item => item.queueItemId === queueItemId)
    if (index === -1 || queueItemId === targetQueueItemId || !state.items.some(item => item.queueItemId === targetQueueItemId)) {
      return
    }

    const [item] = state.items.splice(index, 1)
    const targetIndex = state.items.findIndex(item => item.queueItemId === targetQueueItemId) + (after ? 1 : 0)
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
