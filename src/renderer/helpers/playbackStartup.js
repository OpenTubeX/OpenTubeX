// Starting a video needs the renderer thread, which a large subscription
// refresh keeps busy parsing and storing feeds. Refreshes wait between channels
// while a player loads its first media. A load that never settles releases its
// hold after this long, so it cannot stop the refresh.
const MAX_HOLD_MS = 15_000

const holds = new Set()
/** @type {Set<() => void>} */
const waiters = new Set()

/**
 * Pauses subscription refreshes between channels until the returned function
 * is called, or until the hold expires.
 * @returns {() => void} releases the hold
 */
export function holdForPlaybackStartup() {
  const hold = {}
  holds.add(hold)
  const timer = setTimeout(release, MAX_HOLD_MS)

  function release() {
    clearTimeout(timer)
    if (!holds.delete(hold) || holds.size > 0) return
    for (const resume of waiters) resume()
    waiters.clear()
  }

  return release
}

/**
 * Resolves once no player is loading its first media, or when the signal aborts.
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function waitForPlaybackStartup(signal) {
  // The Watch page hands its hold to the player in the same tick it releases
  // it, so check again after waking up.
  while (holds.size > 0 && !signal?.aborted) {
    await new Promise(resolve => {
      const resume = () => {
        waiters.delete(resume)
        signal?.removeEventListener('abort', resume)
        resolve()
      }
      waiters.add(resume)
      signal?.addEventListener('abort', resume, { once: true })
    })
  }
}
