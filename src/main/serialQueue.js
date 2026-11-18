// @ts-check

/**
 * Runs operations one at a time, in the order they were added. A failed
 * operation rejects only its own promise and does not stop later ones.
 * @param {(error: unknown) => void} [onError] also reports each failure
 * @returns {<T>(operation: () => T | PromiseLike<T>) => Promise<T>}
 */
export function createSerialQueue(onError = () => {}) {
  /** @type {Promise<unknown>} */
  let pending = Promise.resolve()
  return operation => {
    const result = pending.then(operation)
    pending = result.catch(onError)
    return result
  }
}
