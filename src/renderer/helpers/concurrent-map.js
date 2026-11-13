/**
 * Maps items with bounded concurrency. After a mapper fails, no further items
 * start, and the returned promise rejects with the first error once the items
 * in flight have settled, so no mapper outlives the call.
 * @template T, U
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<U>} mapper
 * @returns {Promise<U[]>}
 * @throws {RangeError} If concurrency is not a positive integer
 */
export async function mapConcurrently(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer')
  }

  const results = new Array(items.length)
  let nextIndex = 0
  /** @type {{ error: unknown } | null} */
  let failure = null

  const mapNext = async () => {
    while (failure === null && nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = await mapper(items[index], index)
      } catch (error) {
        failure ??= { error }
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, mapNext))

  if (failure !== null) throw failure.error
  return results
}
