<template>
  <div class="tooltip">
    <button
      ref="buttonRef"
      :aria-labelledby="id"
      class="button"
      type="button"
      @mouseenter="setHovered(true)"
      @mouseleave="setHovered(false)"
      @focus="setFocused(true)"
      @blur="setFocused(false)"
    >
      <FtIcon :icon="['fas', 'question-circle']" />
    </button>
    <Teleport :to="tooltipTarget">
      <p
        v-show="visible"
        :id="id"
        ref="textRef"
        class="text"
        :class="{
          [position]: true,
          allowNewlines,
        }"
        role="tooltip"
        :style="tooltipStyle"
      >
        {{ tooltip }}
      </p>
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef } from 'vue'

const buttonRef = useTemplateRef('buttonRef')
const textRef = useTemplateRef('textRef')
const tooltipTarget = shallowRef(document.fullscreenElement ?? document.body)
const tooltipStyle = ref({})
const visible = ref(false)
const EDGE_MARGIN = 8
const TOOLTIP_GAP = 16
let hovered = false
let focused = false
let positionAnimationFrame = null

/**
 * @param {boolean} value
 */
function setHovered(value) {
  hovered = value
  updateVisibility()
}

/**
 * @param {boolean} value
 */
function setFocused(value) {
  focused = value
  updateVisibility()
}

function updateVisibility() {
  visible.value = hovered || focused
  if (visible.value) {
    nextTick(() => {
      if (!visible.value) return
      positionTooltip()
      startTrackingPosition()
    })
  } else {
    stopTrackingPosition()
  }
}

function startTrackingPosition() {
  if (!visible.value || positionAnimationFrame !== null) return
  const trackPosition = () => {
    positionTooltip()
    positionAnimationFrame = requestAnimationFrame(trackPosition)
  }
  positionAnimationFrame = requestAnimationFrame(trackPosition)
}

function stopTrackingPosition() {
  if (positionAnimationFrame !== null) {
    cancelAnimationFrame(positionAnimationFrame)
    positionAnimationFrame = null
  }
}

function positionTooltip() {
  const button = buttonRef.value
  const text = textRef.value
  if (!visible.value || !button || !text) return

  const buttonRect = button.getBoundingClientRect()
  const width = text.offsetWidth
  const height = text.offsetHeight
  const isRtl = getComputedStyle(button).direction === 'rtl'
  let left
  let top

  switch (props.position) {
    case 'left':
      left = isRtl ? buttonRect.right + TOOLTIP_GAP : buttonRect.left - width - TOOLTIP_GAP
      top = buttonRect.top + (buttonRect.height - height) / 2
      break
    case 'right':
      left = isRtl ? buttonRect.left - width - TOOLTIP_GAP : buttonRect.right + TOOLTIP_GAP
      top = buttonRect.top + (buttonRect.height - height) / 2
      break
    case 'top':
      left = buttonRect.left + (buttonRect.width - width) / 2
      top = buttonRect.top - height - TOOLTIP_GAP
      break
    case 'bottom-left':
      left = isRtl ? buttonRect.left : buttonRect.right - width
      top = buttonRect.bottom + TOOLTIP_GAP
      break
    default:
      left = buttonRect.left + (buttonRect.width - width) / 2
      top = buttonRect.bottom + TOOLTIP_GAP
  }

  left = Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - width - EDGE_MARGIN))
  top = Math.max(EDGE_MARGIN, Math.min(top, window.innerHeight - height - EDGE_MARGIN))
  tooltipStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  }
}

function handleViewportChange() {
  if (visible.value) positionTooltip()
}

async function handleFullscreenChange() {
  tooltipTarget.value = document.fullscreenElement ?? document.body
  if (visible.value) {
    await nextTick()
    positionTooltip()
  }
}

onMounted(() => {
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

onBeforeUnmount(() => {
  stopTrackingPosition()
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
})

const props = defineProps({
  position: {
    type: String,
    default: 'bottom',
    validator: (value) => value === 'bottom' || value === 'left' || value === 'right' || value === 'top' || value === 'bottom-left'
  },
  tooltip: {
    type: String,
    required: true
  },
  allowNewlines: {
    type: Boolean,
    default: false,
  },
})

const id = useId()
</script>

<style scoped src="./FtTooltip.css" />
