<template>
  <div class="toast-slot">
    <div
      v-overlay-scrollbars
      class="toast"
      :class="{ hasImage: toast.image, actionable: toast.action }"
      :tabindex="toast.action ? 0 : null"
      role="status"
      @click="onClick"
      @keydown.enter.prevent="performAction"
      @keydown.space.prevent="performAction"
      @keydown.esc.prevent="close"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
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
      :class="{ paused: isPaused }"
      aria-hidden="true"
    >
      <FtEmbeddedProgress
        class="timeout-indicator"
        :corner-radius="toastProgressRadius"
        :end-arc-fraction="0.5"
        :line-width="toastProgressLineWidth"
        :start-arc-fraction="0.5"
        :style="{ '--toast-duration': `${toast.duration}ms` }"
      />
    </div>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import store from '../../store'
import FtEmbeddedProgress from '../FtEmbeddedProgress/FtEmbeddedProgress.vue'

/** Distance in px the pointer may travel before a click counts as the tail end of a swipe */
const CLICK_SLOP = 5

const props = defineProps({
  /**
   * The toast's live state, as built by `FtToast`. Mutable so messages built
   * from a function can be refreshed while the toast is on screen.
   */
  toast: {
    type: Object,
    required: true
  },
  /**
   * Set by vue-sonner while its timer is on hold: the pointer is over the
   * toaster, a toast has focus, or the document is hidden. The timeout
   * indicator follows the same clock, so it freezes with it.
   */
  isPaused: {
    type: Boolean,
    default: false
  }
})

// vue-sonner passes its dismiss handler in as `onCloseToast`
const emit = defineEmits(['closeToast'])

/** @type {number | null} */
let pointerDownX = null
let pointerMoved = false

const showTimeoutIndicator = computed(() => store.getters.getShowToastTimeoutIndicator)
const toastProgressRadius = computed(() => 12 * store.getters.getUiRoundness / 100)
const toastProgressLineWidth = computed(() => Math.min(4, Math.max(2, 2 * store.getters.getUiRoundness / 100)))

function close() {
  emit('closeToast')
}

function performAction() {
  if (!props.toast.action) { return }

  props.toast.action()
  close()
}

/**
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  pointerDownX = event.clientX
  pointerMoved = false
}

/**
 * @param {PointerEvent} event
 */
function onPointerUp(event) {
  pointerMoved = pointerDownX !== null && Math.abs(event.clientX - pointerDownX) > CLICK_SLOP
  pointerDownX = null
}

/**
 * Runs an available toast action on click, unless the pointer was dragged (in
 * which case the click is the tail end of a swipe gesture and should be ignored).
 */
function onClick() {
  if (pointerMoved) {
    pointerMoved = false
    return
  }

  performAction()
}
</script>
