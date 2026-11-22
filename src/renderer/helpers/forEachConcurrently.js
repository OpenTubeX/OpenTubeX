// @ts-check

/**
 * Runs the task for every value until the signal aborts, at most `limit` at a
 * time, and at most `perGroup` at a time for the values of one group, so that
 * a slow group, such as an unresponsive server, holds up only its own values.
 * @template T
 * @param {T[]} values
 * @param {AbortSignal} signal
 * @param {(value: T) => Promise<void>} task
 * @param {{ limit: number, perGroup: number, group: (value: T) => string }} options
 */
export async function forEachConcurrently(values, signal, task, { limit, perGroup, group }) {
  /** @type {Map<string, T[]>} */
  const groups = new Map()
  for (const value of values) {
    const key = group(value)
    groups.set(key, [...groups.get(key) ?? [], value])
  }

  let active = 0
  /** @type {(() => void)[]} */
  const waiting = []
  const acquire = () => active < limit
    ? (active++, Promise.resolve())
    : new Promise(resolve => waiting.push(() => resolve(undefined)))
  // Hands the slot on to the next waiting value, in the order they asked
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  await Promise.all([...groups.values()].map(async (members) => {
    let next = 0
    const worker = async () => {
      while (next < members.length && !signal.aborted) {
        const value = members[next++]
        await acquire()
        try {
          if (!signal.aborted) await task(value)
        } finally {
          release()
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(perGroup, members.length) }, worker))
  }))
}
