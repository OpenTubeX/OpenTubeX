/** Apply refresh broadcasts while keeping progress monotonic for the active feed. */
export function createSubscriptionRefreshState(store) {
  /** @param {{inProgress: boolean, percentage: number, tab?: string | null}} state */
  function applyState(state) {
    const wasInProgress = store.getters.getSubscriptionFeedRefreshInProgress
    const previousTab = store.getters.getSubscriptionFeedRefreshTab
    const nextTab = state.inProgress ? state.tab ?? null : null
    let percentage = normalizeProgress(state.percentage)

    // The refresh owner updates locally before an older main-process broadcast arrives.
    if (state.inProgress && wasInProgress && nextTab === previousTab) {
      percentage = Math.max(store.getters.getSubscriptionFeedRefreshProgress, percentage)
    }

    store.commit('setSubscriptionFeedRefreshInProgress', state.inProgress)
    store.commit('setSubscriptionFeedRefreshTab', nextTab)
    store.commit('setSubscriptionFeedRefreshProgress', percentage)
  }

  return { applyState, parseStorageProgress: parseSubscriptionRefreshProgress, normalizeProgress }
}

/** @param {string | null} value */
export function parseSubscriptionRefreshProgress(value) {
  if (value === null) return null
  try {
    const state = JSON.parse(value)
    return { ...state, percentage: normalizeProgress(state.percentage) }
  } catch {
    return null
  }
}

/** @param {number} percentage */
function normalizeProgress(percentage) {
  return Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0
}
