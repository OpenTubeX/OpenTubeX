const operationsByStore = new WeakMap()

function showProgress(store, progress) {
  store.commit('setProgressBarIcon', progress.icon)
  store.commit('setProgressBarMessage', progress.message)
  store.commit('setProgressBarPercentage', progress.percentage)
  store.commit('setShowProgressBar', true)
}

function clearProgress(store) {
  store.commit('setShowProgressBar', false)
  store.commit('setProgressBarPercentage', 0)
  store.commit('setProgressBarMessage', '')
  store.commit('setProgressBarIcon', ['fas', 'sync'])
}

/**
 * Keeps the most recently started playlist preload visible while allowing an
 * earlier preload to resume ownership if the newer one finishes first.
 * @param {{ commit: (mutation: string, value: unknown) => void }} store
 * @param {{ icon: string[], message: string, percentage: number }} initialProgress
 * @returns {{
 *   update: (progress: { icon?: string[], message?: string, percentage?: number }) => void,
 *   finish: () => void,
 * }}
 */
export function startYtDlpPlaybackPreloadProgress(store, initialProgress) {
  const operations = operationsByStore.get(store) ?? []
  operationsByStore.set(store, operations)

  const operation = { ...initialProgress }
  operations.push(operation)
  showProgress(store, operation)

  return {
    update(progress) {
      Object.assign(operation, progress)
      if (operations.at(-1) === operation) {
        showProgress(store, operation)
      }
    },
    finish() {
      const operationIndex = operations.indexOf(operation)
      if (operationIndex === -1) return

      const wasVisible = operationIndex === operations.length - 1
      operations.splice(operationIndex, 1)
      if (!wasVisible) return

      const previousOperation = operations.at(-1)
      if (previousOperation == null) {
        operationsByStore.delete(store)
        clearProgress(store)
      } else {
        showProgress(store, previousOperation)
      }
    },
  }
}
