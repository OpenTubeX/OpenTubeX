<template>
  <Teleport
    :to="fullscreenTarget || 'body'"
    :disabled="fullscreenTarget === null"
  >
    <TransitionGroup
      tag="div"
      name="toast"
      class="toast-holder"
      :class="`position-${toastPosition}`"
      @before-leave="onBeforeLeave"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-slot"
        :class="toast.dismissDirection && `dismiss-${toast.dismissDirection}`"
        @pointerenter="pause(toast, $event.currentTarget)"
        @pointerleave="resume(toast)"
      >
        <div
          v-overlay-scrollbars
          class="toast"
          :class="{ hasImage: toast.image, dragging: toast.dragging }"
          :style="dragStyle(toast)"
          tabindex="0"
          role="status"
          @click="onClick(toast)"
          @keydown.enter.prevent="performAction(toast)"
          @keydown.space.prevent="performAction(toast)"
          @keydown.esc.prevent="dismiss(toast)"
          @pointerdown="onPointerDown(toast, $event)"
          @pointermove="onPointerMove(toast, $event)"
          @pointerup="onPointerUp(toast, $event)"
          @pointercancel="onPointerUp(toast, $event)"
        >
          <img
            v-if="toast.image"
            :src="toast.image"
            class="image"
            alt=""
            draggable="false"
          >
          <FontAwesomeIcon
            v-else-if="toast.icon"
            :icon="toast.icon"
            class="icon"
            fixed-width
          />
          <p class="message">
            {{ toast.message }}
          </p>
        </div>
        <div
          v-if="showTimeoutIndicator"
          class="timeout-indicator-track"
          :class="{ dragging: toast.dragging }"
          :style="dragStyle(toast)"
          aria-hidden="true"
        >
          <div
            class="timeout-indicator"
            :style="{ animationDuration: `${toast.duration}ms` }"
            @animationstart="onIndicatorAnimationStart(toast, $event)"
          />
        </div>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { normalizeToastPosition } from '../../constants/toastPosition'
import { showToast, ToastEventBus } from '../../helpers/utils'
import store from '../../store'

let idCounter = 0
let removeShowToastListener = null

/**
 * @typedef Toast
 * @property {string | (({elapsedMs: number, remainingMs: number}) => string)} message
 * @property {Function | null} action
 * @property {string | null} image
 * @property {[string, string] | null} icon
 * @property {NodeJS.Timeout | number} timeout
 * @property {NodeJS.Timeout | number} interval
 * @property {number} id
 * @property {number} duration lifetime of the toast in milliseconds
 * @property {number} remainingMs lifetime remaining when the toast was paused
 * @property {number} expiresAt timestamp the toast is due to auto-dismiss at, used to reschedule after a drag
 * @property {boolean} hovered
 * @property {boolean} dragging
 * @property {boolean} pointerMoved whether the pointer moved enough to count as a drag (suppresses the click action)
 * @property {number} dragOffset current horizontal drag offset in px
 * @property {'left' | 'right' | null} dismissDirection side through which the toast is being dismissed
 * @property {number} [dragStartX] pointer x position where the current drag started
 */

/** Distance in px a toast must be dragged before it slides away instead of snapping back */
const DRAG_DISMISS_THRESHOLD = 80

/** @type {import('vue').Reactive<Toast[]>} */
const toasts = reactive([])
/** @type {Map<number, Animation>} */
const indicatorAnimations = new Map()
/** @type {import('vue').Ref<Element|null>} */
const fullscreenTarget = ref(null)
/** @type {import('vue').ComputedRef<'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'>} */
const toastPosition = computed(() => {
  return normalizeToastPosition(store.getters.getToastPosition)
})
/** @type {import('vue').ComputedRef<boolean>} */
const showTimeoutIndicator = computed(() => store.getters.getShowToastTimeoutIndicator)

function updateFullscreenTarget() {
  fullscreenTarget.value = document.fullscreenElement
}

/**
 * @param {CustomEvent<{ message: string | (({elapsedMs: number, remainingMs: number}) => string), time: number | null, action: Function | null, abortSignal: AbortSignal | null, image: string | null, icon: [string, string] | null }>} event
 */
function open({ detail: { message, time, action, abortSignal, image, icon } }) {
  const id = idCounter++

  time ||= 3000

  /** @type {Toast} */
  const toast = {
    id,
    message,
    action,
    image: image ?? null,
    icon: icon ?? null,
    timeout: 0,
    interval: 0,
    duration: time,
    remainingMs: time,
    expiresAt: Date.now() + time,
    hovered: false,
    dragging: false,
    pointerMoved: false,
    dragOffset: 0,
    dismissDirection: null
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
 * Dismisses a toast without running its action, for users who want it out of
 * the way. Flags it for the appropriate horizontal leave animation, then removes
 * it on the next tick so the dismiss class is rendered before the leave starts.
 * Removing promptly (rather than after a timeout) lets the toasts above start
 * animating into the freed space without any delay.
 * @param {Toast} toast
 */
function dismiss(toast, direction = toastPosition.value.endsWith('right') ? 'right' : 'left') {
  toast.dismissDirection = direction
  nextTick(() => remove(toast))
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
 * Pauses auto-dismiss while a toast is hovered.
 * @param {Toast} toast
 * @param {HTMLElement} element
 */
function pause(toast, element) {
  if (toast.hovered) { return }

  toast.hovered = true
  toast.remainingMs = Math.max(0, toast.expiresAt - Date.now())
  clearTimeout(toast.timeout)

  const animation = indicatorAnimations.get(toast.id) ??
    element.querySelector('.timeout-indicator')?.getAnimations()[0]
  if (animation) {
    animation.currentTime = toast.duration - toast.remainingMs
    animation.pause()
    indicatorAnimations.set(toast.id, animation)
  }
}

/**
 * Resumes auto-dismiss once the toast is no longer hovered.
 * @param {Toast} toast
 */
function resume(toast) {
  if (!toast.hovered) { return }

  toast.hovered = false
  toast.expiresAt = Date.now() + toast.remainingMs
  indicatorAnimations.get(toast.id)?.play()

  if (!toast.dragging) {
    toast.timeout = setTimeout(remove, toast.remainingMs, toast)
  }
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

  // Hold off auto-dismiss so the toast can't vanish mid-drag. The deadline in
  // `expiresAt` keeps running, so this can't be used to keep a toast alive.
  clearTimeout(toast.timeout)

  event.currentTarget.setPointerCapture(event.pointerId)
}

/**
 * @param {Toast} toast
 * @param {PointerEvent} event
 */
function onPointerMove(toast, event) {
  if (!toast.dragging) { return }

  const offset = event.clientX - toast.dragStartX

  if (toastPosition.value.endsWith('left')) {
    toast.dragOffset = Math.min(0, offset)
  } else if (toastPosition.value.endsWith('right')) {
    toast.dragOffset = Math.max(0, offset)
  } else {
    toast.dragOffset = offset
  }

  if (Math.abs(offset) > 5) {
    toast.pointerMoved = true
  }
}

/**
 * @param {Toast} toast
 * @param {PointerEvent} event
 */
function onPointerUp(toast, event) {
  if (!toast.dragging) { return }

  toast.dragging = false

  if (Math.abs(toast.dragOffset) > DRAG_DISMISS_THRESHOLD) {
    dismiss(toast, toast.dragOffset < 0 ? 'left' : 'right')
  } else {
    // Snap back into place and resume the auto-dismiss countdown for whatever
    // is left of the original lifetime. Keeping the deadline absolute matters
    // for toasts whose action expires on its own schedule (e.g. the playlist
    // undo toast), which must not stay clickable after that deadline passes.
    toast.dragOffset = 0
    if (!toast.hovered) {
      toast.timeout = setTimeout(remove, Math.max(0, toast.expiresAt - Date.now()), toast)
    }
  }

  // Pointer capture can suppress the leave event when a drag ends outside the
  // toast. Recheck after capture is released so hover cannot remain stuck.
  const element = event.currentTarget.parentElement
  requestAnimationFrame(() => {
    if (!toasts.includes(toast)) { return }

    if (element.matches(':hover')) {
      pause(toast, element)
    } else {
      resume(toast)
    }
  })
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
    opacity: Math.max(0, 1 - Math.abs(toast.dragOffset) / 200)
  }
}

/**
 * Associates the browser-managed animation with its toast and seeks it to the
 * true remaining lifetime. Seeking matters if the indicator is enabled while
 * an existing toast is already partway through its lifetime.
 * @param {Toast} toast
 * @param {AnimationEvent} event
 */
function onIndicatorAnimationStart(toast, event) {
  const animation = event.target.getAnimations()[0]
  if (!animation) { return }

  const remainingMs = toast.hovered
    ? toast.remainingMs
    : Math.max(0, toast.expiresAt - Date.now())

  animation.currentTime = toast.duration - remainingMs
  if (toast.hovered) {
    animation.pause()
  }
  indicatorAnimations.set(toast.id, animation)
}

/**
 * @param {Toast} toast
 */
function remove(toast) {
  const index = toasts.indexOf(toast)

  if (index !== -1) {
    toasts.splice(index, 1)
    indicatorAnimations.delete(toast.id)
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
    removeShowToastListener = window.ftElectron.handleShowToast((message, time, icon) => {
      showToast({ message, time, icon })
    })
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
