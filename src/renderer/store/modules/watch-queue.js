let nextQueueItemId = 1

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
  }
}

export default {
  state: createWatchQueueState,
  getters: watchQueueGetters,
  mutations: watchQueueMutations
}
