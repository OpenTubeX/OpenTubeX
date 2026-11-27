<template>
  <svg
    ref="svg"
    class="embeddedProgress"
    :data-progress="clampedProgress"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
  >
    <path
      class="embeddedProgressPath"
      :d="path"
      :style="{ strokeDasharray: `${visibleLength}px ${pathLength * 2}px` }"
    />
  </svg>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { isRendered } from '../../helpers/rendered'

const props = defineProps({
  progress: {
    type: Number,
    default: 100,
  },
  cornerRadius: {
    type: Number,
    required: true,
  },
  lineWidth: {
    type: Number,
    default: 2,
  },
  startArcFraction: {
    type: Number,
    default: 1,
  },
  endArcFraction: {
    type: Number,
    default: 1,
  },
})

const svg = useTemplateRef('svg')
const width = ref(1)
const height = ref(1)

const clampedProgress = computed(() => Math.min(100, Math.max(0, props.progress)))

const geometry = computed(() => {
  const strokeInset = props.lineWidth / 2
  const radius = Math.min(
    Math.max(props.cornerRadius, strokeInset),
    width.value / 2,
    height.value / 2
  )
  const arcRadius = Math.max(0, radius - strokeInset)
  const startArcAngle = Math.PI / 2 * Math.min(1, Math.max(0, props.startArcFraction))
  const endArcAngle = Math.PI / 2 * Math.min(1, Math.max(0, props.endArcFraction))
  const bottom = height.value - strokeInset
  const startInset = radius - arcRadius * Math.sin(startArcAngle)
  const startTop = height.value - radius + arcRadius * Math.cos(startArcAngle)
  const endInset = width.value - radius + arcRadius * Math.sin(endArcAngle)
  const endTop = height.value - radius + arcRadius * Math.cos(endArcAngle)

  return {
    arcRadius,
    bottom,
    endArcAngle,
    endInset,
    endTop,
    radius,
    startArcAngle,
    startInset,
    startTop,
  }
})

const pathLength = computed(() => {
  return Math.max(
    0,
    width.value - 2 * geometry.value.radius +
      geometry.value.arcRadius *
        (geometry.value.startArcAngle + geometry.value.endArcAngle)
  )
})
/**
 * Distances in px from the inline start and end edges to the outermost painted
 * points of the line, round caps included, so a clip can sweep across exactly
 * the part of the box the line covers.
 */
const lineInsets = computed(() => ({
  start: Math.max(0, geometry.value.startInset - props.lineWidth / 2),
  end: Math.max(0, width.value - geometry.value.endInset - props.lineWidth / 2),
}))
const visibleLength = computed(() => pathLength.value * clampedProgress.value / 100)

const path = computed(() => {
  const {
    arcRadius,
    bottom,
    endInset,
    endTop,
    radius,
    startInset,
    startTop,
  } = geometry.value

  return [
    `M ${startInset} ${startTop}`,
    `A ${arcRadius} ${arcRadius} 0 0 0 ${radius} ${bottom}`,
    `H ${width.value - radius}`,
    `A ${arcRadius} ${arcRadius} 0 0 0 ${endInset} ${endTop}`,
  ].join(' ')
})

/**
 * Sizes the viewBox from the layout box reported by the observer. Deliberately
 * not `getBoundingClientRect()`: that includes ancestor transforms, so an
 * element measured while its container is mid transition (the toast enter
 * animation scales to 0.95) would keep a permanently mis-scaled viewBox.
 * @param {ResizeObserverEntry} entry
 */
function updateGeometry(entry) {
  if (!svg.value || !isRendered(svg.value)) return
  const box = entry.borderBoxSize?.[0]
  const nextWidth = box ? box.inlineSize : entry.contentRect.width
  const nextHeight = box ? box.blockSize : entry.contentRect.height
  if (nextWidth <= 0 || nextHeight <= 0) return
  width.value = Math.max(1, nextWidth)
  height.value = Math.max(1, nextHeight)
}

defineExpose({ lineInsets })

onMounted(() => {
  if (svg.value) observeProgressResize(svg.value, updateGeometry)
})

onBeforeUnmount(() => {
  if (svg.value) unobserveProgressResize(svg.value)
})
</script>

<script>
/** @type {ResizeObserver | null} */
let sharedProgressResizeObserver = null
/** @type {WeakMap<Element, (entry: ResizeObserverEntry) => void>} */
const progressResizeHandlers = new WeakMap()

function observeProgressResize(element, handler) {
  sharedProgressResizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      progressResizeHandlers.get(entry.target)?.(entry)
    }
  })
  progressResizeHandlers.set(element, handler)
  sharedProgressResizeObserver.observe(element)
}

function unobserveProgressResize(element) {
  progressResizeHandlers.delete(element)
  sharedProgressResizeObserver?.unobserve(element)
}
</script>

<style scoped>
.embeddedProgress {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
  pointer-events: none;
}

.embeddedProgressPath {
  fill: none;
  stroke: var(--primary-color);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: v-bind(lineWidth);
}

.embeddedProgress:dir(rtl) .embeddedProgressPath {
  transform: scaleX(-1);
  transform-origin: center;
  transform-box: view-box;
}
</style>
