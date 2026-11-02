<template>
  <component
    :is="tag"
    ref="row"
    :class="{ windowedListShell: !visible }"
    :style="visible ? undefined : { boxSizing: 'border-box', blockSize: shellHeight ? `${shellHeight}px` : undefined }"
  >
    <slot v-if="visible" />
  </component>
</template>

<script setup>
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

import { observeNestedWindowedListItem } from '../../helpers/windowedList'

// A row of a long list inside its own scroller, such as the watch queue.
// Distant rows keep only an empty shell with their measured border box, or
// the size the list estimates for rows that never mounted.
const props = defineProps({
  tag: { type: String, default: 'div' },
  // Rows that are visible when the list opens, so it doesn't flash empty.
  initiallyVisible: { type: Boolean, default: false },
  // Mounts the row and keeps it, for example while it is dragged or holds
  // the element the list scrolls to.
  keepMounted: { type: Boolean, default: false },
})

const windowed = process.env.IS_CAPACITOR || process.env.IS_ELECTRON
const visible = ref(!windowed || props.initiallyVisible || props.keepMounted)
const shellHeight = ref(0)
const row = useTemplateRef('row')

if (windowed) {
  let windowItem = null
  watch(row, element => {
    windowItem?.dispose()
    windowItem = null
    if (!element) return
    windowItem = observeNestedWindowedListItem(element, {
      mount: () => { visible.value = true },
      unmount: height => { shellHeight.value = height; visible.value = false },
      isMounted: () => visible.value,
      isProtected: () => props.keepMounted || element.contains(document.activeElement) ||
        !!element.querySelector('[aria-expanded="true"], [role="dialog"]'),
    })
  }, { flush: 'post' })
  onBeforeUnmount(() => windowItem?.dispose())
  watch(() => props.keepMounted, keep => { if (keep) visible.value = true })
}
</script>
