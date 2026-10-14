<template>
  <!-- Child tabs receive focus; the tablist only delegates their events. -->
  <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
  <div
    ref="root"
    class="materialTabs"
    :class="{ segmented: props.variant === 'segmented' }"
    role="tablist"
    @click.capture="markUserSelection"
    @keydown.capture="markUserSelection"
  >
    <slot />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, onUpdated, useTemplateRef } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'pills',
    validator: value => ['pills', 'segmented'].includes(value)
  }
})

const root = useTemplateRef('root')
let previousSelected
let userSelection
let selectionResetTimer

function markUserSelection(event) {
  const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null
  const onTab = tab && root.value.contains(tab)
  if (event.type === 'click' && !onTab) return
  const keys = onTab ? ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight']
  if (event.type === 'keydown' && !keys.includes(event.key)) return
  userSelection = event
  // Keep the event through native handlers and Vue's selection update.
  clearTimeout(selectionResetTimer)
  selectionResetTimer = setTimeout(() => { userSelection = undefined }, 0)
}

function updateSelection() {
  const container = root.value
  const selected = container.querySelector('[role="tab"][aria-selected="true"]')
  // Panel/document navigation consumes arrow keys before changing selection.
  const deliberateSelection = userSelection && (container.contains(userSelection.target) || userSelection.defaultPrevented)
  if (previousSelected !== undefined && selected !== previousSelected && !deliberateSelection) {
    // Automatic changes snap both outgoing and incoming highlights.
    container.style.setProperty('--material-tab-highlight-transition', 'none')
    // Commit the opacity before restoring normal selection fades.
    getComputedStyle(selected ?? previousSelected, '::before').getPropertyValue('opacity')
    container.style.removeProperty('--material-tab-highlight-transition')
  }
  previousSelected = selected
}

onMounted(() => {
  updateSelection()
  document.addEventListener('keydown', markUserSelection, true)
})
onUpdated(updateSelection)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', markUserSelection, true)
  clearTimeout(selectionResetTimer)
})
</script>

<style scoped src="./FtTabs.css" />
