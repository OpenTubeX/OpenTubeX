<template>
  <FtMobileSheet
    :enabled="phoneLayout"
    :open="sheetOpen"
    :title="title"
    compact
    bottom
    @close="close"
    @closed="finish"
  >
    <div
      ref="list"
      v-overlay-scrollbars="phoneLayout"
      class="moreActionsList"
    >
      <div
        ref="content"
        class="moreActionsContent"
      >
        <button
          v-for="action in actions"
          :key="action.value"
          type="button"
          class="moreAction"
          :aria-pressed="action.active ?? null"
          @click="choose(action.value)"
        >
          <FtIcon
            :icon="action.icon"
            aria-hidden="true"
          />
          <span class="moreActionLabel">{{ action.label }}</span>
          <FtIcon
            v-if="action.active"
            class="moreActionCheck"
            :icon="['fas', 'check']"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  </FtMobileSheet>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { inject, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

defineProps({
  title: { type: String, required: true },
  // Objects with value, label, icon and an optional active state
  actions: { type: Array, required: true }
})

const emit = defineEmits(['select'])

const phoneLayout = usePhoneLayout()
const closeIconDropdown = inject('closeIconDropdown', () => {})
const sheetOpen = ref(true)
let chosen = null

const list = useTemplateRef('list')
const content = useTemplateRef('content')
// Actions leave the open sheet when they go away or fit into the toolbar again
const listResizeObserver = new ResizeObserver(() => {
  if (phoneLayout.value) clampOverlayScrollTop(list.value, content.value)
})

onMounted(() => {
  listResizeObserver.observe(list.value)
  listResizeObserver.observe(content.value)
})

onBeforeUnmount(() => listResizeObserver.disconnect())

/** @param {string} value */
function choose(value) {
  if (phoneLayout.value) {
    // Act once the sheet has closed, so that a sheet the action opens does not
    // compete with this one
    chosen = value
    sheetOpen.value = false
  } else {
    closeIconDropdown()
    emit('select', value)
  }
}

function close() {
  if (phoneLayout.value) {
    sheetOpen.value = false
  } else {
    // The sheet is only a wrapper inside the dropdown, so it never closes itself
    closeIconDropdown()
  }
}

function finish() {
  closeIconDropdown()
  if (chosen !== null) emit('select', chosen)
}
</script>

<style scoped src="./WatchVideoMoreActions.css" />
