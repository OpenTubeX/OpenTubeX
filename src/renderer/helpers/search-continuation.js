const EXHAUSTED_SEARCH_CONTINUATION_ERRORS = [
  'No contents found in search response',
  'There are no continuations'
]

/**
 * youtubei.js reports an exhausted filtered search as an error when the
 * response has no contents or when the current feed has no continuation.
 *
 * @template T
 * @param {() => Promise<T>} loadContinuation
 * @returns {Promise<T | null>}
 */
export async function loadSearchContinuation(loadContinuation) {
  try {
    return await loadContinuation()
  } catch (error) {
    const isExpectedContinuationError = error instanceof Error &&
      EXHAUSTED_SEARCH_CONTINUATION_ERRORS.includes(error.message)

    if (isExpectedContinuationError) {
      return null
    }

    throw error
  }
}
