import { localDateKey } from './digitalWellbeing.js'

// Ticks further apart than this mean a suspended or heavily delayed timer, not playback.
const MAX_TICK_GAP_MS = 5000
const FLUSH_THRESHOLD_MS = 10000

/**
 * Accumulates played time per local day for the watch statistics.
 *
 * @param {() => boolean} isCounting whether elapsed time currently counts as watched
 * @param {(date: string, seconds: number, retry: boolean) => Promise<unknown>} record persists watched seconds
 *   for a day and resolves to `false` when the write failed. `retry` marks seconds that were already counted
 *   once and are only written again.
 * @param {() => number} [now]
 */
export function createWatchTimeTracker(isCounting, record, now = Date.now) {
  /** @type {number|null} */
  let lastTick = null
  /** @type {Record<string, number>} */
  let pendingByDate = {}
  // Time that was counted but failed to save.
  /** @type {Record<string, number>} */
  let unsavedByDate = {}
  // Writes that fail after a clear() must not restore the cleared time.
  let generation = 0

  function persistPending() {
    const batches = [
      ...Object.entries(pendingByDate).map(([date, milliseconds]) => ({ date, milliseconds, retry: false })),
      ...Object.entries(unsavedByDate).map(([date, milliseconds]) => ({ date, milliseconds, retry: true })),
    ]
    pendingByDate = {}
    unsavedByDate = {}
    const written = generation
    return Promise.all(batches.map(async ({ date, milliseconds, retry }) => {
      if (await record(date, milliseconds / 1000, retry) === false && written === generation) {
        unsavedByDate[date] = (unsavedByDate[date] ?? 0) + milliseconds
      }
    }))
  }

  /** @param {Record<string, number>} byDate */
  function sum(byDate) {
    return Object.values(byDate).reduce((total, milliseconds) => total + milliseconds, 0)
  }

  const tracker = {
    get lastTick() {
      return lastTick
    },
    get pendingMilliseconds() {
      return sum(pendingByDate) + sum(unsavedByDate)
    },
    /** Call on every playback time update. */
    track() {
      if (!isCounting()) {
        lastTick = null
        return
      }

      const time = now()
      if (lastTick !== null) {
        const elapsed = time - lastTick
        if (elapsed > 0 && elapsed <= MAX_TICK_GAP_MS) {
          const date = localDateKey(time)
          pendingByDate[date] = (pendingByDate[date] ?? 0) + elapsed
        }
      }
      lastTick = time

      // Keep the baseline so continuous playback does not lose the next interval.
      // Only new time triggers a write, so failed writes retry with the next batch instead of on every tick.
      if (sum(pendingByDate) >= FLUSH_THRESHOLD_MS) {
        persistPending()
      }
    },
    /** Persists pending time and starts a new baseline, e.g. when playback stops. */
    flush() {
      lastTick = null
      return persistPending()
    },
    clear() {
      lastTick = null
      pendingByDate = {}
      unsavedByDate = {}
      generation++
    },
  }

  return tracker
}
