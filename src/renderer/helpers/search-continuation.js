const EMPTY_SEARCH_CONTINUATION_ERROR = 'No contents found in search response'

/**
 * YouTube returns a response without contents when a filtered search has
 * reached its end. youtubei.js represents that terminal state as an error.
 *
 * @template T
 * @param {() => Promise<T>} loadContinuation
 * @returns {Promise<T | null>}
 */
export async function loadSearchContinuation(loadContinuation) {
  try {
    return await loadContinuation()
  } catch (error) {
    if (error instanceof Error && error.message === EMPTY_SEARCH_CONTINUATION_ERROR) {
      return null
    }

    throw error
  }
}
