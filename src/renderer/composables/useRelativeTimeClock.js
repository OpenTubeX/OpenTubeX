import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import store from '../store/index'

const RELATIVE_TIME_CLOCK_INTERVAL_MS = 30000

const now = ref(Date.now())
let subscriberCount = 0
/** @type {ReturnType<typeof setInterval> | null} */
let ticker = null

function updateNow() {
  now.value = Date.now()
}

function startClock() {
  if (ticker !== null) return

  updateNow()
  ticker = setInterval(updateNow, RELATIVE_TIME_CLOCK_INTERVAL_MS)
  document.addEventListener('visibilitychange', updateNow)
}

function stopClock() {
  if (ticker === null) return

  clearInterval(ticker)
  ticker = null
  document.removeEventListener('visibilitychange', updateNow)
}

/**
 * Returns a shared clock for relative timestamps. When enabled, a single timer
 * updates every mounted consumer together. When disabled, each consumer keeps
 * the time at which it was mounted (or the setting was disabled).
 *
 * @returns {Readonly<import('vue').Ref<number>>}
 */
export function useRelativeTimeClock() {
  const frozenNow = ref(Date.now())
  const updatesEnabled = computed(() => store.getters.getUpdateRelativeTimestamps)

  watch(updatesEnabled, (enabled) => {
    if (enabled && subscriberCount > 0) {
      startClock()
    } else {
      frozenNow.value = Date.now()
      stopClock()
    }
  })

  onMounted(() => {
    subscriberCount += 1
    if (updatesEnabled.value) startClock()
  })

  onBeforeUnmount(() => {
    subscriberCount -= 1
    if (subscriberCount === 0) stopClock()
  })

  return computed(() => updatesEnabled.value ? now.value : frozenNow.value)
}
