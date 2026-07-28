import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const AUTO_REFRESH_CLOCK_INTERVAL_MS = 30000

/**
 * A coarse clock for "next auto refresh in ..." labels, which only need to be
 * accurate to the minute. The ticker runs only while `isNeeded` is true: tabs
 * stay mounted while not presented, so an unconditional timer would churn
 * reactivity in every open feed tab even with auto refresh turned off.
 *
 * @param {import('vue').ComputedRef<boolean> | (() => boolean)} isNeeded
 * @returns {import('vue').Ref<number>} the current time, updated periodically
 */
export function useAutoRefreshClock(isNeeded) {
  const now = ref(Date.now())
  /** @type {ReturnType<typeof setInterval> | null} */
  let ticker = null

  function start() {
    if (ticker !== null) {
      return
    }

    now.value = Date.now()
    ticker = setInterval(() => {
      now.value = Date.now()
    }, AUTO_REFRESH_CLOCK_INTERVAL_MS)
  }

  function stop() {
    if (ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
  }

  watch(isNeeded, (needed) => {
    if (needed) {
      start()
    } else {
      stop()
    }
  })

  onMounted(() => {
    if (typeof isNeeded === 'function' ? isNeeded() : isNeeded.value) {
      start()
    }
  })

  onBeforeUnmount(stop)

  return now
}
