<template>
  <div
    ref="root"
    class="materialTabs"
    :class="{ segmented: props.variant === 'segmented' }"
    role="tablist"
  >
    <slot />
  </div>
</template>

<script setup>
import { onMounted, onUpdated, useTemplateRef } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'pills',
    validator: value => ['pills', 'segmented'].includes(value)
  }
})

const root = useTemplateRef('root')
let previousSelected = null

function updateSelection() {
  const container = root.value
  const selected = container.querySelector('[role="tab"][aria-selected="true"]')
  if (selected && previousSelected && !container.contains(previousSelected)) {
    // A removed selection has no outgoing highlight to crossfade against.
    selected.style.setProperty('--material-tab-highlight-transition', 'none')
    // Commit the fallback opacity before restoring normal selection fades.
    getComputedStyle(selected, '::before').getPropertyValue('opacity')
    selected.style.removeProperty('--material-tab-highlight-transition')
  }
  previousSelected = selected
}

onMounted(updateSelection)
onUpdated(updateSelection)
</script>

<style scoped src="./FtTabs.css" />
