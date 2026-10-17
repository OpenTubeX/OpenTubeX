// All isolates of a renderer share one V8 heap reservation, so a full heap
// crashes the window. Unload old tabs well before that point.
const UNLOAD_HEAP_RATIO = 0.5
const CHECK_INTERVAL_MS = 30_000
// Unloaded pages are only reclaimed by a later garbage collection.
const UNLOAD_COOLDOWN_MS = 2 * 60_000

/**
 * @param {object} options
 * @param {() => { usedHeapSize: number, heapSizeLimit: number }} options.getHeapStatistics
 * @param {() => Promise<number>} options.unloadTabs Resolves with the number of unloaded tabs
 * @param {(count: number) => void} options.notify
 * @returns {() => void} Stops monitoring
 */
export function startMemoryPressureMonitor({ getHeapStatistics, unloadTabs, notify }) {
  let cooldownUntil = 0
  let checking = false

  const check = async () => {
    if (checking || Date.now() < cooldownUntil) return
    const { usedHeapSize, heapSizeLimit } = getHeapStatistics()
    if (usedHeapSize < heapSizeLimit * UNLOAD_HEAP_RATIO) return

    checking = true
    try {
      const count = await unloadTabs()
      if (count > 0) {
        cooldownUntil = Date.now() + UNLOAD_COOLDOWN_MS
        notify(count)
      }
    } catch (error) {
      console.error('Failed to unload tabs under memory pressure:', error)
    } finally {
      checking = false
    }
  }

  const intervalId = setInterval(check, CHECK_INTERVAL_MS)
  return () => clearInterval(intervalId)
}
