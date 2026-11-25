let nextOperationId = 0

/**
 * Adds an operation to the progress shown in the progress bar or as progress
 * toasts. Every running operation stays listed until it finishes.
 * @param {{ commit: (mutation: string, value: unknown) => void }} store
 * @param {{ icon: string[], message: string, percentage: number }} initialProgress
 * @returns {{
 *   update: (progress: { icon?: string[], message?: string, percentage?: number }) => void,
 *   finish: () => void,
 * }}
 */
export function startProgressBarOperation(store, initialProgress) {
  const id = ++nextOperationId
  let finished = false
  store.commit('addProgressOperation', { ...initialProgress, id })

  return {
    update(progress) {
      if (finished) return
      store.commit('updateProgressOperation', { ...progress, id })
    },
    finish() {
      if (finished) return
      finished = true
      store.commit('removeProgressOperation', id)
    },
  }
}
