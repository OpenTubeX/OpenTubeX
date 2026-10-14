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
import { onMounted, onUpdated, useTemplateRef } from 'vue'

const props = defineProps({
  variant: {
    type: String,
    default: 'pills',
    validator: value => ['pills', 'segmented'].includes(value)
  }
})

const root = useTemplateRef('root')
let previousSelected
let userSelection = false

function markUserSelection(event) {
  if (!event.target.closest('[role="tab"]')) return
  if (event.type === 'keydown' && !['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  userSelection = true
  // Keep the flag through native event handlers and Vue's selection update.
  setTimeout(() => { userSelection = false }, 0)
}

function updateSelection() {
  const container = root.value
  const selected = container.querySelector('[role="tab"][aria-selected="true"]')
  if (previousSelected !== undefined && selected !== previousSelected && !userSelection) {
    // Automatic changes snap both outgoing and incoming highlights.
    container.style.setProperty('--material-tab-highlight-transition', 'none')
    // Commit the opacity before restoring normal selection fades.
    getComputedStyle(selected ?? previousSelected, '::before').getPropertyValue('opacity')
    container.style.removeProperty('--material-tab-highlight-transition')
  }
  previousSelected = selected
}

onMounted(updateSelection)
onUpdated(updateSelection)
</script>

<style scoped src="./FtTabs.css" />
