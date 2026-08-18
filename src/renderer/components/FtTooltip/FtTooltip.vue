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
import { nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef } from 'vue'

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
let positionMutationObserver = null
let positionResizeObserver = null
let trackingPosition = false

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
    tooltipTarget.value = document.fullscreenElement ?? document.body
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
  if (!visible.value || trackingPosition) return
  trackingPosition = true
  window.addEventListener('resize', schedulePositionUpdate)
  window.addEventListener('scroll', schedulePositionUpdate, true)
  document.addEventListener('fullscreenchange', handleFullscreenChange)

  positionMutationObserver ??= new MutationObserver((records) => {
    const tooltip = textRef.value
    if (tooltip && records.every(({ target }) => target === tooltip || tooltip.contains(target))) {
      return
    }
    schedulePositionUpdate()
  })
  positionMutationObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style'],
    childList: true,
    subtree: true,
  })

  positionResizeObserver ??= new ResizeObserver(schedulePositionUpdate)
  if (buttonRef.value) {
    positionResizeObserver.observe(buttonRef.value)
  }
  if (textRef.value) {
    positionResizeObserver.observe(textRef.value)
  }
  schedulePositionUpdate()
}

function stopTrackingPosition() {
  trackingPosition = false
  window.removeEventListener('resize', schedulePositionUpdate)
  window.removeEventListener('scroll', schedulePositionUpdate, true)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  positionMutationObserver?.disconnect()
  positionResizeObserver?.disconnect()
  if (positionAnimationFrame !== null) {
    cancelAnimationFrame(positionAnimationFrame)
    positionAnimationFrame = null
  }
}

function schedulePositionUpdate() {
  if (!visible.value || positionAnimationFrame !== null) return
  positionAnimationFrame = requestAnimationFrame(() => {
    positionAnimationFrame = null
    positionTooltip()
  })
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

async function handleFullscreenChange() {
  tooltipTarget.value = document.fullscreenElement ?? document.body
  if (visible.value) {
    await nextTick()
    positionResizeObserver?.disconnect()
    if (buttonRef.value) positionResizeObserver?.observe(buttonRef.value)
    if (textRef.value) positionResizeObserver?.observe(textRef.value)
    schedulePositionUpdate()
  }
}

onBeforeUnmount(() => {
  stopTrackingPosition()
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
