// @ts-check
/**
 * Tracks datastore requests while they run. A request can take several
 * queued steps, so waiting for a single datastore queue is not enough.
 */
export function createDatastoreRequestTracker() {
  const pending = new Set()
  return {
    /**
     * @template T
     * @param {Promise<T>} request
     * @returns {Promise<T>}
     */
    track(request) {
      pending.add(request)
      request.finally(() => pending.delete(request)).catch(() => {})
      return request
    },
    /** Resolves once every request that already started has finished. */
    async settled() {
      await Promise.allSettled(pending)
    },
  }
}
