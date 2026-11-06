<template>
  <slot
    name="anchor"
    :bindings="triggerBindings"
  />
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { tabTooltipKey } from './useTabTooltip'

const props = defineProps({
  title: { type: String, required: true },
  tabs: { type: Array, required: true },
  group: { type: Object, default: null },
  isGroup: { type: Boolean, default: false },
  isActive: { type: Boolean, default: false },
  tabBarPosition: { type: String, default: 'top' },
  disableTooltips: { type: Boolean, default: false },
  closeTooltipsSignal: { type: Number, default: 0 },
  showPreview: { type: Boolean, default: true },
  showIcon: { type: Boolean, default: true }
})

const tooltip = inject(tabTooltipKey)
const tabRef = ref(null)
const tooltipId = useId()
let suppressTooltipUntilPointerLeave = false
const triggerBindings = computed(() => ({
  ref: element => { tabRef.value = element },
  'aria-describedby': tooltip.active.value?.id === tooltipId ? tooltipId : undefined,
  onPointerenter: handlePointerEnter,
  onPointerleave: handlePointerLeave,
  onFocusin: showTooltip,
  onFocusout: hideTooltip,
  onPointerdown: handlePointerDown
}))

function showTooltip() {
  if (props.disableTooltips || suppressTooltipUntilPointerLeave) return
  tooltip.show({ id: tooltipId, element: tabRef.value, props })
}

function handlePointerEnter() {
  suppressTooltipUntilPointerLeave = false
  showTooltip()
}

function handlePointerLeave() {
  if (document.hasFocus()) suppressTooltipUntilPointerLeave = false
  tooltip.leave(tooltipId)
}

function handlePointerDown() {
  suppressTooltipUntilPointerLeave = true
  hideTooltip()
}

function handleWindowBlur() {
  suppressTooltipUntilPointerLeave = true
  hideTooltip()
}

function hideTooltip() {
  tooltip.hide(tooltipId)
}

onMounted(() => window.addEventListener('blur', handleWindowBlur))
onBeforeUnmount(() => {
  window.removeEventListener('blur', handleWindowBlur)
  hideTooltip()
})
watch(() => props.closeTooltipsSignal, hideTooltip)
watch(() => props.isActive, active => { if (active) hideTooltip() })
watch(() => props.disableTooltips, disabled => { if (disabled) hideTooltip() })
watch(() => props.tabBarPosition, hideTooltip)
watch(() => props.showPreview, enabled => {
  if (enabled && tooltip.active.value?.id === tooltipId) {
    hideTooltip()
    showTooltip()
  }
})
</script>
