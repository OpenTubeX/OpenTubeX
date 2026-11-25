import { onActivated, onBeforeUnmount, onDeactivated, onMounted, readonly, ref } from 'vue'

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
 * Returns a shared clock for relative timestamps. A single timer updates every
 * mounted consumer together.
 *
 * @returns {Readonly<import('vue').Ref<number>>}
 */
export function useRelativeTimeClock() {
  let active = false

  function activate() {
    if (active) return

    active = true
    subscriberCount += 1
    startClock()
  }

  function deactivate() {
    if (!active) return

    active = false
    subscriberCount -= 1
    if (subscriberCount === 0) stopClock()
  }

  onMounted(activate)
  onActivated(activate)
  onDeactivated(deactivate)
  onBeforeUnmount(deactivate)

  return readonly(now)
}
