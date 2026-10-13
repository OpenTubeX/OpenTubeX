<template>
  <div
    ref="root"
    class="materialTabs"
    :class="{ segmented: props.variant === 'segmented' }"
    role="tablist"
  >
    <slot />
    <Transition
      name="tabFade"
      @before-leave="markOutgoing"
    >
      <span
        v-if="indicatorStyle"
        :key="selectionKey"
        class="tabsIndicator"
        aria-hidden="true"
        dir="ltr"
        data-animation-speed-managed
        :style="[indicatorStyle, { transitionDuration }]"
      />
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUpdated, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { useTabContext } from '../../tabs/TabContext'
import store from '../../store'

const props = defineProps({
  variant: {
    type: String,
    default: 'pills',
    validator: value => ['pills', 'segmented'].includes(value)
  }
})

const root = useTemplateRef('root')
const { locale } = useI18n()
const { isTabPresented } = useTabContext()
const indicatorStyle = ref(null)
const selectionKey = ref(0)
const transitionDuration = computed(() => `${140 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)}ms`)
let resizeObserver
let observedTabs = []
let previousSelected = null
let inactive = false

function markOutgoing(element) {
  element.classList.replace('tabsIndicator', 'tabsIndicatorOutgoing')
  element.style.transitionProperty = 'opacity'
}

function hideIndicator() {
  indicatorStyle.value = null
  previousSelected = null
}

/** Animate selection changes; place the pill immediately after layout changes. */
function updateIndicator() {
  const container = root.value
  const selected = container?.querySelector('[role="tab"][aria-selected="true"]')
  if (inactive || isTabPresented?.value === false) {
    // Retain the pill while its page is hidden to avoid replaying its entrance.
    // Browsing pages behind Watch still have layout boxes: measure them so the
    // minimize preview reveals an aligned pill, without a selection crossfade.
    previousSelected = null
    if (inactive || !container?.getClientRects().length) return
  }
  if (!selected?.getClientRects().length) {
    hideIndicator()
    return
  }

  const bounds = container.getBoundingClientRect()
  const tab = selected.getBoundingClientRect()
  const style = getComputedStyle(container)
  // Dialog entrance transforms scale both boxes. Convert their measurements
  // back to local CSS pixels without rounding fractional Electron zoom values.
  const scaleX = bounds.width / Number.parseFloat(style.width)
  const scaleY = bounds.height / Number.parseFloat(style.height)
  const width = tab.width / scaleX
  const height = tab.height / scaleY
  const x = (tab.left - bounds.left) / scaleX - Number.parseFloat(style.borderLeftWidth)
  const radius = Math.min(
    Number.parseFloat(getComputedStyle(selected).borderBottomLeftRadius),
    height / 2, width / 2
  )
  const y = (tab.top - bounds.top) / scaleY - Number.parseFloat(style.borderTopWidth)
  const transform = `translate(${x}px, ${y}px)`
  const animate = previousSelected && previousSelected !== selected && container.contains(previousSelected)
  previousSelected = selected
  if (animate) {
    selectionKey.value++
  }
  // A ResizeObserver notification after a click must not cancel its transition.
  const geometry = {
    width: `${width}px`,
    height: `${height}px`,
    borderRadius: `${radius}px`,
    transform
  }
  if (Object.entries(geometry).every(([key, value]) => indicatorStyle.value?.[key] === value)) return
  indicatorStyle.value = {
    ...geometry,
    ...(!animate ? { transitionProperty: 'none' } : {})
  }
}

function observeTabs() {
  const tabs = [...root.value.querySelectorAll('[role="tab"]')]
  if (tabs.length === observedTabs.length && tabs.every((tab, index) => tab === observedTabs[index])) return
  resizeObserver.disconnect()
  resizeObserver.observe(root.value)
  tabs.forEach(tab => resizeObserver.observe(tab))
  observedTabs = tabs
}

function updateTabs() {
  if (inactive || !root.value || !resizeObserver) return
  observeTabs()
  updateIndicator()
}

onMounted(() => {
  resizeObserver = new ResizeObserver(updateIndicator)
  resizeObserver.observe(root.value)
  updateTabs()
})
onUpdated(updateTabs)
watch([locale, () => props.variant, () => store.getters.getUiRoundness, () => isTabPresented?.value], () => nextTick(updateIndicator))
onActivated(() => {
  inactive = false
  nextTick(updateTabs)
})
onDeactivated(() => {
  inactive = true
  resizeObserver?.disconnect()
  observedTabs = []
  previousSelected = null
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped src="./FtTabs.css" />
