/**
 * @template T, U
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<U>} mapper
 * @returns {Promise<U[]>}
 */
export async function mapConcurrently(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  const mapNext = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, mapNext))

  return results
}
