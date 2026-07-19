<template>
  <TransitionGroup
    tag="div"
    name="toast"
    class="toast-holder"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      tabindex="0"
      role="status"
      @click="performAction(toast)"
      @keydown.enter.prevent="performAction(toast)"
      @keydown.space.prevent="performAction(toast)"
    >
      <p class="message">
        {{ toast.message }}
      </p>
    </div>
  </TransitionGroup>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import { showToast, ToastEventBus } from '../../helpers/utils'

let idCounter = 0
let removeShowToastListener = null

/**
 * @typedef Toast
 * @property {string | (({elapsedMs: number, remainingMs: number}) => string)} message
 * @property {Function | null} action
 * @property {NodeJS.Timeout | number} timeout
 * @property {NodeJS.Timeout | number} interval
 * @property {number} id
 */

/** @type {import('vue').Reactive<Toast[]>} */
const toasts = reactive([])

/**
 * @param {CustomEvent<{ message: string | (({elapsedMs: number, remainingMs: number}) => string), time: number | null, action: Function | null, abortSignal: AbortSignal | null }>} event
 */
function open({ detail: { message, time, action, abortSignal } }) {
  const id = idCounter++

  /** @type {Toast} */
  const toast = {
    id,
    message,
    action,
    timeout: 0,
    interval: 0
  }
  time ||= 3000
  let elapsed = 0
  const updateDelay = 1000

  if (typeof message === 'function') {
    toast.message = message({ elapsedMs: elapsed, remainingMs: time - elapsed })
    toast.interval = setInterval(() => {
      elapsed += updateDelay
      // Skip last update
      if (elapsed >= time) { return }

      // We need to locate the object in the array so we get the reactive proxy,
      // as modifying the original object won't trigger reactive effects such as updating the DOM
      const toast = toasts.find(t => t.id === id)

      if (toast) {
        toast.message = message({ elapsedMs: elapsed, remainingMs: time - elapsed })
      }
    }, updateDelay)
  }

  toast.timeout = setTimeout(remove, time, toast)
  if (abortSignal != null) {
    abortSignal.addEventListener('abort', () => {
      remove(toast)
    })
  }

  if (toasts.length > 4) {
    remove(toasts[0])
  }
  toasts.push(toast)
}

/**
 * @param {Toast} toast
 */
function performAction(toast) {
  toast.action?.()
  remove(toast)
}

/**
 * @param {Toast} toast
 */
function remove(toast) {
  const index = toasts.indexOf(toast)

  if (index !== -1) {
    toasts.splice(index, 1)
    cleanup(toast)
  }
}

/**
 * @param {Toast} toast
 */
function cleanup(toast) {
  // assumes `toasts.indexOf(toast) !== -1`
  clearTimeout(toast.timeout)
  clearInterval(toast.interval)
}

onMounted(() => {
  ToastEventBus.addEventListener('toast-open', open)

  if (process.env.IS_ELECTRON) {
    removeShowToastListener = window.ftElectron.handleShowToast(showToast)
  }
})

onBeforeUnmount(() => {
  ToastEventBus.removeEventListener('toast-open', open)
  removeShowToastListener?.()
  toasts.forEach(cleanup)
})
</script>

<style scoped src="./FtToast.css" />
