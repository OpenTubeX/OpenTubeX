/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<T>}
 */
export function withTimeout(promise, timeoutMs, message) {
  let timeoutId

  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timeoutId))
}
