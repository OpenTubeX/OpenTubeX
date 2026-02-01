<template>
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
  <div
    ref="elementRef"
    class="tab"
    :class="{ active: tab.isActive, loading: tab.isLoading, playing: tab.isPlaying, dragging: isDragging }"
    :title="displayTitle"
    role="button"
    tabindex="-1"
    @click="handleClick"
    @auxclick.prevent="handleAuxClick"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @pointermove="handlePointerMove"
  >
    <span class="tabTitle">
      <span
        v-if="tab.isLoading"
        class="loadingDot"
        aria-hidden="true"
      />
      <FontAwesomeIcon
        v-else-if="tab.isPlaying"
        :icon="['fas', 'play']"
        class="playingIcon"
        aria-hidden="true"
      />
      {{ displayTitle }}
    </span>
    <button
      class="closeButton"
      :aria-label="closeLabel"
      :title="closeLabel"
      @click.stop="$emit('close', tab.id)"
      @pointerdown.stop
    >
      <FontAwesomeIcon
        :icon="['fas', 'times']"
        class="closeIcon"
      />
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, ref } from 'vue'
import { useDraggable } from '@vue-dnd-kit/core'
import packageDetails from '@root/package.json'

const props = defineProps({
  tab: {
    type: Object,
    required: true
  },
  closeLabel: {
    type: String,
    default: 'Close Tab'
  },
  index: {
    type: Number,
    required: true
  }
})

const emit = defineEmits(['activate', 'close', 'middleClick'])

// Drag delay implementation
const dragDelayTimeout = ref(null)
const dragStartPosition = ref(null)
const hasDragged = ref(false)
const DRAG_DELAY_MS = 200 // Delay before drag starts
const DRAG_THRESHOLD_PX = 5 // Minimum movement to start drag

const {
  elementRef,
  isDragging,
  handleDragStart: originalHandleDragStart
} = useDraggable({
  id: props.tab.id,
  data: {
    index: props.index,
    tabId: props.tab.id
  },
  containerProps: {
    style: {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      fontWeight: 'inherit',
      fontStyle: 'inherit',
      textRendering: 'auto',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale'
    }
  },
  events: {
    onStart: () => {
      hasDragged.value = true
    },
    onEnd: () => {
      // Reset after a short delay to allow click event to be prevented
      setTimeout(() => {
        hasDragged.value = false
      }, 100)
    }
  }
})

/**
 * Wrapper for handleDragStart that sets the dragged flag
 * @param {PointerEvent} event
 */
function handleDragStart(event) {
  hasDragged.value = true
  originalHandleDragStart(event)
}

/**
 * Handle pointer down - start delay timer for drag
 * @param {PointerEvent} event
 */
function handlePointerDown(event) {
  // Don't start drag if clicking on close button
  if (event.target.closest('.closeButton')) {
    return
  }

  // Reset drag flag
  hasDragged.value = false
  dragStartPosition.value = {
    x: event.clientX,
    y: event.clientY
  }

  // Clear any existing timeout
  if (dragDelayTimeout.value) {
    clearTimeout(dragDelayTimeout.value)
  }

  // Set timeout to start drag after delay
  dragDelayTimeout.value = setTimeout(() => {
    dragDelayTimeout.value = null
    handleDragStart(event)
  }, DRAG_DELAY_MS)
}

/**
 * Handle pointer move - cancel drag if moved too much before delay
 * @param {PointerEvent} event
 */
function handlePointerMove(event) {
  if (!dragStartPosition.value || !dragDelayTimeout.value) {
    return
  }

  const deltaX = Math.abs(event.clientX - dragStartPosition.value.x)
  const deltaY = Math.abs(event.clientY - dragStartPosition.value.y)

  // If moved beyond threshold, start drag immediately
  if (deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX) {
    if (dragDelayTimeout.value) {
      clearTimeout(dragDelayTimeout.value)
      dragDelayTimeout.value = null
    }
    handleDragStart(event)
  }
}

/**
 * Handle pointer up - cancel drag delay if it was just a click
 * @param {PointerEvent} event
 */
function handlePointerUp(event) {
  if (dragDelayTimeout.value) {
    clearTimeout(dragDelayTimeout.value)
    dragDelayTimeout.value = null
  }
  dragStartPosition.value = null
}

/**
 * Handle pointer cancel - cleanup
 */
function handlePointerCancel() {
  if (dragDelayTimeout.value) {
    clearTimeout(dragDelayTimeout.value)
    dragDelayTimeout.value = null
  }
  dragStartPosition.value = null
}

const displayTitle = computed(() => {
  const title = props.tab.title
  if (!title) return title
  const suffix = ` - ${packageDetails.productName}`
  if (title.endsWith(suffix)) {
    return title.slice(0, -suffix.length)
  }
  return title
})

/**
 * Handle click to activate tab
 */
function handleClick() {
  // Don't activate if we're currently dragging or just finished dragging
  if (!isDragging.value && !hasDragged.value) {
    emit('activate', props.tab.id)
  }
}

/**
 * Handle middle click to close tab
 * @param {MouseEvent} event
 */
function handleAuxClick(event) {
  if (event.button === 1) {
    emit('middleClick', event, props.tab.id)
  }
}
</script>

<style scoped>
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline: 10px;
  padding-block: 6px;
  background-color: var(--bg-color);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  min-inline-size: 100px;
  max-inline-size: 200px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-block-end: 0;
  transition: background-color 0.15s ease;
  position: relative;
  user-select: none;
}

.tab::after {
  content: '';
  position: absolute;
  inset-block-end: -1px;
  inset-inline: 0;
  block-size: 1px;
  background-color: var(--bg-color);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tab:hover {
  background-color: var(--card-bg-color);
}

.tab.active {
  background-color: var(--card-bg-color);
  border-color: var(--tertiary-text-color);
}

.tab.loading {
  opacity: 0.8;
}

.tab.active::after {
  opacity: 1;
}

.tab.dragging {
  opacity: 0.5;
  z-index: 10;
  cursor: grabbing !important;
}

.tab.dragging .tabTitle {
  font-family: inherit;
  font-size: 12px;
  font-weight: inherit;
  font-style: inherit;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.tabTitle {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--primary-text-color);
  font-family: inherit;
  font-weight: inherit;
  font-style: inherit;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.loadingDot {
  display: inline-block;
  inline-size: 6px;
  block-size: 6px;
  border-radius: 50%;
  margin-inline-end: 6px;
  background-color: var(--accent-color, var(--primary-text-color));
  animation: tab-loading-pulse 0.9s ease-in-out infinite;
  vertical-align: middle;
}

@keyframes tab-loading-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.5;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(0.7);
    opacity: 0.5;
  }
}

.playingIcon {
  font-size: 8px;
  margin-inline-end: 6px;
  color: var(--accent-color, var(--primary-text-color));
  flex-shrink: 0;
}

.closeButton {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  color: var(--tertiary-text-color);
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.closeButton:hover {
  background-color: var(--destructive-color);
  color: var(--destructive-text-color);
}

.tab:hover .closeButton,
.tab.active .closeButton {
  opacity: 1;
}

.closeIcon {
  font-size: 10px;
}
</style>

<style>
/* Global styles for drag operations */
body.vue-dnd-dragging {
  cursor: grabbing !important;
}

body.vue-dnd-dragging * {
  cursor: grabbing !important;
}

/* Prevent font changes in drag overlays - target all possible drag overlay elements */
body.vue-dnd-dragging .tab,
body.vue-dnd-dragging [data-vue-dnd-kit-draggable],
body.vue-dnd-dragging [class*="drag"],
body.vue-dnd-dragging [class*="overlay"] {
  font-family: inherit !important;
  font-size: inherit !important;
  font-weight: inherit !important;
  font-style: inherit !important;
  text-rendering: auto !important;
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
  transform: none !important;
  will-change: auto !important;
}

body.vue-dnd-dragging .tab .tabTitle,
body.vue-dnd-dragging [data-vue-dnd-kit-draggable] .tabTitle,
body.vue-dnd-dragging [class*="drag"] .tabTitle,
body.vue-dnd-dragging [class*="overlay"] .tabTitle,
body.vue-dnd-dragging span.tabTitle {
  font-family: inherit !important;
  font-size: 12px !important;
  font-weight: inherit !important;
  font-style: inherit !important;
  text-rendering: auto !important;
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
  transform: none !important;
}
</style>
