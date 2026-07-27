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

// Keep the tooltip inside whatever would otherwise cut it off horizontally. It
// is positioned purely with CSS relative to its icon, so an icon near the start
// of a clipping container (the settings page clips with `overflow-x: hidden`)
// left part of the tooltip unreachable. We compute its shown horizontal extent
// and offset it back into view via a CSS variable.
// `offsetLeft`/`offsetWidth` are used because, unlike `getBoundingClientRect()`,
// they are unaffected by the CSS transform (and its transition), so the shown
// fade/slide animation is preserved.
const EDGE_MARGIN = 8

/**
 * The horizontal bounds the tooltip has to stay within: the nearest ancestor
 * that clips horizontally, falling back to the viewport.
 *
 * @param {HTMLElement} el
 * @returns {{ min: number, max: number }}
 */
function getHorizontalBounds(el) {
  for (let node = el.parentElement; node != null; node = node.parentElement) {
    const overflowX = getComputedStyle(node).overflowX
    if (overflowX !== 'visible') {
      const rect = node.getBoundingClientRect()
      return {
        min: Math.max(0, rect.left),
        max: Math.min(window.innerWidth, rect.right)
      }
    }
  }

  return { min: 0, max: window.innerWidth }
}

function clampToViewport() {
  const el = textRef.value
  const offsetParent = el?.offsetParent
  if (!el || !offsetParent) {
    return
  }

  // Measure the unshifted position, so repeated hovers don't compound the shift.
  el.style.setProperty('--ft-tooltip-shift-x', '0px')

  const width = el.offsetWidth
  const parentLeft = offsetParent.getBoundingClientRect().left
  const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1

  // The visible transform's static horizontal translate: centered variants shift
  // by -50% (times the writing-direction coefficient), edge variants by 0.
  const centered = el.classList.contains('bottom') ||
    el.classList.contains('bottom-left') ||
    el.classList.contains('top')
  const staticTranslateX = centered ? -0.5 * width * dir : 0

  const left = parentLeft + el.offsetLeft + staticTranslateX
  const right = left + width
  const { min, max } = getHorizontalBounds(el)

  let shift = 0
  if (left < min + EDGE_MARGIN) {
    shift = Math.ceil(min + EDGE_MARGIN - left)
  } else if (right > max - EDGE_MARGIN) {
    shift = Math.floor(max - EDGE_MARGIN - right)
  }

  el.style.setProperty('--ft-tooltip-shift-x', `${shift}px`)
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
