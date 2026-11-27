<template>
  <div class="tooltip">
    <button
      ref="buttonRef"
      :aria-labelledby="id"
      class="button"
      type="button"
      :style="{ anchorName: visible ? tooltipAnchor : null }"
      @mouseenter="setHovered(true)"
      @mouseleave="setHovered(false)"
      @focus="setFocused(true)"
      @blur="setFocused(false)"
      @click="dialogOpen = noHover"
    >
      <FtIcon :icon="['fas', 'circle-question']" />
    </button>
    <!-- Touch screens cannot hover, and a tap would leave a focus tooltip stuck open. -->
    <FtPrompt
      v-if="dialogOpen"
      autosize
      theme="slim"
      :option-names="[t('Close')]"
      :option-values="[null]"
      :option-icons="[['fas', 'xmark']]"
      @click="dialogOpen = false"
    >
      <template #label="{ labelId }">
        <p
          :id="labelId"
          class="dialogText"
          :class="{ allowNewlines }"
        >
          {{ tooltip }}
        </p>
      </template>
    </FtPrompt>
    <Teleport :to="tooltipTarget">
      <p
        :id="id"
        ref="textRef"
        class="text"
        :class="{
          [placement]: true,
          allowNewlines,
          open: visible && settingsOverlayActive,
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
import { useI18n } from 'vue-i18n'
import { getAnchoredPosition, getUntransformedRect, supportsAnchorPositioning } from '../../helpers/anchoredPosition'
import { useAnchoredViewportBounds } from '../../composables/useAnchoredViewportBounds'
import { useSettingsOverlay } from '../../composables/useSettingsOverlay'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

const { t } = useI18n()

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

const buttonRef = useTemplateRef('buttonRef')
const textRef = useTemplateRef('textRef')
const tooltipTarget = shallowRef(document.fullscreenElement ?? document.body)
const tooltipStyle = ref({})
const placement = ref(props.position)
const visible = ref(false)
const settingsOverlayActive = useSettingsOverlay(() => {
  setHovered(false)
  setFocused(false)
})
useAnchoredViewportBounds(buttonRef, textRef, visible)
const noHover = usePhoneLayout('(hover: none)')
const dialogOpen = ref(false)
const EDGE_MARGIN = 8
const TOOLTIP_GAP = 16
const FALLBACK_PLACEMENTS = {
  bottom: ['bottom', 'top', 'right', 'left'],
  'bottom-left': ['bottom-left', 'top-left', 'left', 'right'],
  top: ['top', 'bottom', 'right', 'left'],
  left: ['left', 'right', 'bottom', 'top'],
  right: ['right', 'left', 'bottom', 'top'],
}
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
  if (value && (!settingsOverlayActive.value || noHover.value)) return
  hovered = value
  updateVisibility()
}

/**
 * @param {boolean} value
 */
function setFocused(value) {
  if (value && (!settingsOverlayActive.value || noHover.value)) return
  focused = value
  updateVisibility()
}

function updateVisibility() {
  visible.value = hovered || focused
  if (visible.value) {
    tooltipTarget.value = document.fullscreenElement ?? document.body
    nextTick(() => {
      if (!settingsOverlayActive.value || !visible.value) return
      positionTooltip()
      startTrackingPosition()
    })
  } else {
    stopTrackingPosition()
    freezePosition()
  }
}

/**
 * The trigger loses its anchor-name once the tooltip closes, so keep the
 * tooltip where it is while the close animation plays.
 */
function freezePosition() {
  const text = textRef.value
  if (!text || !tooltipStyle.value.positionAnchor) return
  const rect = getUntransformedRect(text)
  tooltipStyle.value = { left: `${rect.left}px`, top: `${rect.top}px` }
}

function startTrackingPosition() {
  if (!visible.value || trackingPosition) return
  trackingPosition = true
  window.addEventListener('resize', schedulePositionUpdate)
  document.addEventListener('fullscreenchange', handleFullscreenChange)

  if (!supportsAnchorPositioning) {
    window.addEventListener('scroll', schedulePositionUpdate, true)
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
  }

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
  const limits = {
    minLeft: EDGE_MARGIN,
    maxLeft: window.innerWidth - width - EDGE_MARGIN,
    minTop: EDGE_MARGIN,
    maxTop: window.innerHeight - height - EDGE_MARGIN
  }

  // Clamping a tooltip into the viewport on its preferred side would slide it
  // over its trigger and the pointer, so use the first side where it fits,
  // or the side it overflows least.
  let best
  for (const side of FALLBACK_PLACEMENTS[props.position] ?? FALLBACK_PLACEMENTS.bottom) {
    const { left, top } = getPlacementPosition(side, buttonRect, width, height, isRtl)
    const vertical = side !== 'left' && side !== 'right'
    const overflow = vertical
      ? Math.max(limits.minTop - top, top - limits.maxTop, 0)
      : Math.max(limits.minLeft - left, left - limits.maxLeft, 0)
    if (!best || overflow < best.overflow) best = { side, left, top, overflow }
    if (overflow === 0) break
  }

  placement.value = best.side
  tooltipStyle.value = getAnchoredPosition(tooltipAnchor, buttonRect, Math.round(best.left), Math.round(best.top), limits)
}

/**
 * @param {string} side
 * @param {DOMRect} buttonRect
 * @param {number} width
 * @param {number} height
 * @param {boolean} isRtl
 * @returns {{left: number, top: number}}
 */
function getPlacementPosition(side, buttonRect, width, height, isRtl) {
  const centerLeft = buttonRect.left + (buttonRect.width - width) / 2
  const centerTop = buttonRect.top + (buttonRect.height - height) / 2
  const endLeft = isRtl ? buttonRect.left : buttonRect.right - width
  const above = buttonRect.top - height - TOOLTIP_GAP
  const below = buttonRect.bottom + TOOLTIP_GAP

  switch (side) {
    case 'left':
      return { left: isRtl ? buttonRect.right + TOOLTIP_GAP : buttonRect.left - width - TOOLTIP_GAP, top: centerTop }
    case 'right':
      return { left: isRtl ? buttonRect.left - width - TOOLTIP_GAP : buttonRect.right + TOOLTIP_GAP, top: centerTop }
    case 'top':
      return { left: centerLeft, top: above }
    case 'top-left':
      return { left: endLeft, top: above }
    case 'bottom-left':
      return { left: endLeft, top: below }
    default:
      return { left: centerLeft, top: below }
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

const id = useId()
const tooltipAnchor = `--tooltip-${id}`

defineExpose({ id })
</script>

<style scoped src="./FtTooltip.css" />
