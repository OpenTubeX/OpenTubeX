<template>
  <FtMobileSheet
    :enabled="phoneLayout"
    :open="sheetOpen"
    :title="title"
    compact
    bottom
    @close="sheetOpen = false"
    @closed="finish"
  >
    <div class="moreActionsList">
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
  </FtMobileSheet>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { inject, ref } from 'vue'

import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'

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

function finish() {
  closeIconDropdown()
  if (chosen !== null) emit('select', chosen)
}
</script>

<style scoped src="./WatchVideoMoreActions.css" />
