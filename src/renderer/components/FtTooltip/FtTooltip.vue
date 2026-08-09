<template>
  <div
    class="tooltip"
    @mouseenter="clampToViewport"
    @focusin="clampToViewport"
  >
    <button
      :aria-labelledby="id"
      class="button"
      type="button"
    >
      <FontAwesomeIcon :icon="['fas', 'question-circle']" />
    </button>
    <p
      :id="id"
      ref="textRef"
      class="text"
      :class="{
        [position]: true,
        allowNewlines,
      }"
      role="tooltip"
    >
      {{ tooltip }}
    </p>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useId, useTemplateRef } from 'vue'

const textRef = useTemplateRef('textRef')

// Keep the tooltip inside whatever would otherwise cut it off. It
// is positioned purely with CSS relative to its icon, so an icon near the start
// of a clipping container (the settings page clips with `overflow-x: hidden`)
// can leave part of the tooltip unreachable. We compute its shown extent and
// offset it back into view via CSS variables.
// Offset geometry is used because, unlike `getBoundingClientRect()`,
// they are unaffected by the CSS transform (and its transition), so the shown
// fade/slide animation is preserved.
const EDGE_MARGIN = 8

/**
 * The bounds the tooltip has to stay within, intersecting the viewport with
 * every ancestor that clips either axis.
 *
 * @param {HTMLElement} el
 * @returns {{ left: number, right: number, top: number, bottom: number }}
 */
function getClippingBounds(el) {
  const bounds = {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight
  }
  for (let node = el.parentElement; node != null; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const rect = node.getBoundingClientRect()
      if (style.overflowX !== 'visible') {
        bounds.left = Math.max(bounds.left, rect.left)
        bounds.right = Math.min(bounds.right, rect.right)
      }
      if (style.overflowY !== 'visible') {
        bounds.top = Math.max(bounds.top, rect.top)
        bounds.bottom = Math.min(bounds.bottom, rect.bottom)
      }
    }
  }
  return bounds
}

function clampToViewport() {
  const el = textRef.value
  const offsetParent = el?.offsetParent
  if (!el || !offsetParent) {
    return
  }

  // Measure the unshifted position, so repeated hovers don't compound the shift.
  el.style.setProperty('--ft-tooltip-shift-x', '0px')
  el.style.setProperty('--ft-tooltip-shift-y', '0px')

  const width = el.offsetWidth
  const height = el.offsetHeight
  const parentRect = offsetParent.getBoundingClientRect()
  const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1

  // The visible transform's static horizontal translate: centered variants shift
  // by -50% (times the writing-direction coefficient), edge variants by 0.
  const centered = el.classList.contains('bottom') ||
    el.classList.contains('bottom-left') ||
    el.classList.contains('top')
  const staticTranslateX = centered ? -0.5 * width * dir : 0
  const staticTranslateY = centered ? 0 : -0.5 * height

  const left = parentRect.left + el.offsetLeft + staticTranslateX
  const right = left + width
  const top = parentRect.top + el.offsetTop + staticTranslateY
  const bottom = top + height
  const bounds = getClippingBounds(el)

  let shiftX = 0
  let shiftY = 0
  if (left < bounds.left + EDGE_MARGIN) {
    shiftX = Math.ceil(bounds.left + EDGE_MARGIN - left)
  } else if (right > bounds.right - EDGE_MARGIN) {
    shiftX = Math.floor(bounds.right - EDGE_MARGIN - right)
  }
  if (top < bounds.top + EDGE_MARGIN) {
    shiftY = Math.ceil(bounds.top + EDGE_MARGIN - top)
  } else if (bottom > bounds.bottom - EDGE_MARGIN) {
    shiftY = Math.floor(bounds.bottom - EDGE_MARGIN - bottom)
  }

  el.style.setProperty('--ft-tooltip-shift-x', `${shiftX}px`)
  el.style.setProperty('--ft-tooltip-shift-y', `${shiftY}px`)
}

defineProps({
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
