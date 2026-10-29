// All isolates of a renderer share one V8 heap reservation, so a full heap
// crashes the window. Unload old tabs well before that point.
const CHECK_INTERVAL_MS = 30_000
// Unloaded pages are only reclaimed by a later garbage collection.
const UNLOAD_COOLDOWN_MS = 2 * 60_000

/**
 * Chromium WebViews report their JavaScript heap; WebKit does not.
 * @returns {{ usedHeapSize: number, heapSizeLimit: number } | null}
 */
export function getWebViewHeapStatistics() {
  const memory = globalThis.performance?.memory
  return memory ? { usedHeapSize: memory.usedJSHeapSize, heapSizeLimit: memory.jsHeapSizeLimit } : null
}

/**
 * @param {object} options
 * @param {() => { usedHeapSize: number, heapSizeLimit: number }} options.getHeapStatistics
 * @param {() => { enabled: boolean, memoryThreshold: number, tabPercentage: number }} [options.getSettings]
 * @param {(percentage: number) => Promise<number>} options.unloadTabs Resolves with the number of unloaded tabs
 * @param {(count: number) => void} options.notify
 * @returns {() => void} Stops monitoring
 */
export function startMemoryPressureMonitor({ getHeapStatistics, unloadTabs, notify, getSettings = () => ({ enabled: true, memoryThreshold: 50, tabPercentage: 50 }) }) {
  let cooldownUntil = 0
  let checking = false

  const check = async () => {
    if (checking || Date.now() < cooldownUntil) return
    const { enabled, memoryThreshold, tabPercentage } = getSettings()
    if (!enabled) return
    const threshold = Number.isFinite(memoryThreshold) && memoryThreshold >= 10 && memoryThreshold <= 90 ? memoryThreshold : 50
    const { usedHeapSize, heapSizeLimit } = getHeapStatistics()
    if (usedHeapSize < heapSizeLimit * threshold / 100) return

    checking = true
    try {
      const count = await unloadTabs(tabPercentage)
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
