<template>
  <Teleport
    :to="fullscreenTarget || 'body'"
    :disabled="fullscreenTarget === null"
  >
    <TransitionGroup
      tag="div"
      name="toast"
      class="toast-holder"
      @before-leave="onBeforeLeave"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-slot"
        :class="{ 'dismiss-left': toast.dismissing }"
      >
        <div
          class="toast"
          :class="{ hasImage: toast.image, dragging: toast.dragging }"
          :style="dragStyle(toast)"
          tabindex="0"
          role="status"
          @click="onClick(toast)"
          @keydown.enter.prevent="performAction(toast)"
          @keydown.space.prevent="performAction(toast)"
          @pointerdown="onPointerDown(toast, $event)"
          @pointermove="onPointerMove(toast, $event)"
          @pointerup="onPointerUp(toast)"
          @pointercancel="onPointerUp(toast)"
        >
          <img
            v-if="toast.image"
            :src="toast.image"
            class="image"
            alt=""
            draggable="false"
          >
          <p class="message">
            {{ toast.message }}
          </p>
        </div>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { showToast, ToastEventBus } from '../../helpers/utils'

let idCounter = 0
let removeShowToastListener = null

/**
 * @typedef Toast
 * @property {string | (({elapsedMs: number, remainingMs: number}) => string)} message
 * @property {Function | null} action
 * @property {string | null} image
 * @property {NodeJS.Timeout | number} timeout
 * @property {NodeJS.Timeout | number} interval
 * @property {number} id
 * @property {number} expiresAt timestamp the toast is due to auto-dismiss at, used to reschedule after a drag
 * @property {boolean} dragging
 * @property {boolean} pointerMoved whether the pointer moved enough to count as a drag (suppresses the click action)
 * @property {number} dragOffset current horizontal (leftward, <= 0) drag offset in px
 * @property {boolean} dismissing whether the toast is being swiped off to the left (picks the slide-left leave animation)
 * @property {number} [dragStartX] pointer x position where the current drag started
 */

/** Distance in px a toast must be dragged before it slides away instead of snapping back */
const DRAG_DISMISS_THRESHOLD = 80

/** @type {import('vue').Reactive<Toast[]>} */
const toasts = reactive([])
/** @type {import('vue').Ref<Element|null>} */
const fullscreenTarget = ref(null)

function updateFullscreenTarget() {
  fullscreenTarget.value = document.fullscreenElement
}

/**
 * @param {CustomEvent<{ message: string | (({elapsedMs: number, remainingMs: number}) => string), time: number | null, action: Function | null, abortSignal: AbortSignal | null, image: string | null }>} event
 */
function open({ detail: { message, time, action, abortSignal, image } }) {
  const id = idCounter++

  time ||= 3000

  /** @type {Toast} */
  const toast = {
    id,
    message,
    action,
    image: image ?? null,
    timeout: 0,
    interval: 0,
    expiresAt: Date.now() + time,
    dragging: false,
    pointerMoved: false,
    dragOffset: 0,
    dismissing: false
  }
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
 * Runs the toast action on click, unless the pointer was dragged (in which case
 * the click is the tail end of a drag gesture and should be ignored).
 * @param {Toast} toast
 */
function onClick(toast) {
  if (toast.pointerMoved) {
    toast.pointerMoved = false
    return
  }
  performAction(toast)
}

/**
 * @param {Toast} toast
 * @param {PointerEvent} event
 */
function onPointerDown(toast, event) {
  // Only start dragging with the primary (left) mouse button or touch/pen
  if (event.pointerType === 'mouse' && event.button !== 0) { return }

  toast.dragging = true
  toast.pointerMoved = false
  toast.dragStartX = event.clientX
  toast.dragOffset = 0

  // Freeze auto-dismiss while the user is interacting with the toast
  clearTimeout(toast.timeout)

  event.currentTarget.setPointerCapture(event.pointerId)
}

/**
 * @param {Toast} toast
 * @param {PointerEvent} event
 */
function onPointerMove(toast, event) {
  if (!toast.dragging) { return }

  // Only allow dragging towards the left; ignore any rightward movement
  toast.dragOffset = Math.min(0, event.clientX - toast.dragStartX)

  if (toast.dragOffset < -5) {
    toast.pointerMoved = true
  }
}

/**
 * @param {Toast} toast
 */
function onPointerUp(toast) {
  if (!toast.dragging) { return }

  toast.dragging = false

  if (toast.dragOffset < -DRAG_DISMISS_THRESHOLD) {
    // Flag the toast for the slide-left leave animation, then remove it on the
    // next tick so the `dismiss-left` class is rendered before the leave starts.
    // Removing promptly (rather than after a timeout) lets the toasts above
    // start animating down into the freed space without any delay.
    toast.dismissing = true
    nextTick(() => remove(toast))
  } else {
    // Snap back into place and resume the auto-dismiss countdown for whatever
    // is left of the original lifetime. Keeping the deadline absolute matters
    // for toasts whose action expires on its own schedule (e.g. the playlist
    // undo toast), which must not stay clickable after that deadline passes.
    toast.dragOffset = 0
    toast.timeout = setTimeout(remove, Math.max(0, toast.expiresAt - Date.now()), toast)
  }
}

/**
 * Pin a leaving toast to the exact viewport spot it occupied before it is taken
 * out of flow, so the remaining toasts can animate up to fill the gap without
 * the leaving one jumping. Fixed positioning keeps it put even though the
 * bottom-anchored holder shrinks as soon as this toast leaves the flow.
 * @param {HTMLElement} el the `.toast-slot` element being removed
 */
function onBeforeLeave(el) {
  const { top, left, width, height } = el.getBoundingClientRect()

  el.style.position = 'fixed'
  el.style.top = `${top}px`
  el.style.left = `${left}px`
  el.style.width = `${width}px`
  el.style.height = `${height}px`
  el.style.margin = '0'
}

/**
 * @param {Toast} toast
 * @returns {Record<string, string | number>}
 */
function dragStyle(toast) {
  if (toast.dragOffset === 0) { return {} }

  return {
    transform: `translateX(${toast.dragOffset}px)`,
    opacity: Math.max(0, 1 + toast.dragOffset / 200)
  }
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
  document.addEventListener('fullscreenchange', updateFullscreenTarget)
  updateFullscreenTarget()

  if (process.env.IS_ELECTRON) {
    removeShowToastListener = window.ftElectron.handleShowToast(showToast)
  }
})

onBeforeUnmount(() => {
  ToastEventBus.removeEventListener('toast-open', open)
  document.removeEventListener('fullscreenchange', updateFullscreenTarget)
  removeShowToastListener?.()
  toasts.forEach(cleanup)
})
</script>

<style scoped src="./FtToast.css" />
