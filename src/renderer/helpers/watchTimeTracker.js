// Ticks further apart than this mean a suspended or heavily delayed timer, not playback.
const MAX_TICK_GAP_MS = 5000
const FLUSH_THRESHOLD_MS = 10000

/**
 * @param {number} time
 */
function localDateKey(time) {
  const date = new Date(time)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Accumulates played time per local day for the watch statistics.
 *
 * @param {() => boolean} isCounting whether elapsed time currently counts as watched
 * @param {(date: string, seconds: number) => Promise<unknown>} record persists watched seconds for a day
 * @param {() => number} [now]
 */
export function createWatchTimeTracker(isCounting, record, now = Date.now) {
  /** @type {number|null} */
  let lastTick = null
  /** @type {Record<string, number>} */
  let pendingByDate = {}

  function persistPending() {
    const pending = Object.entries(pendingByDate)
    pendingByDate = {}
    return Promise.all(pending.map(([date, milliseconds]) => record(date, milliseconds / 1000)))
  }

  const tracker = {
    get lastTick() {
      return lastTick
    },
    get pendingMilliseconds() {
      return Object.values(pendingByDate).reduce((total, milliseconds) => total + milliseconds, 0)
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
      if (tracker.pendingMilliseconds >= FLUSH_THRESHOLD_MS) {
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
    },
  }

  return tracker
}
