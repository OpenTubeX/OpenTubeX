<template>
  <button
    class="btn ripple"
    :style="{
      color: textColor,
      backgroundColor: backgroundColor,
      borderColor: backgroundColor
    }"
    @click="click"
  >
    <slot>
      <FontAwesomeIcon
        v-if="icon"
        :icon="icon"
      />
      {{ label }}
      <FtSyncedSettingIndicator :setting-key="settingKey" />
    </slot>
  </button>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

defineProps({
  label: {
    type: String,
    default: ''
  },
  textColor: {
    type: String,
    default: 'var(--text-with-accent-color)'
  },
  backgroundColor: {
    type: String,
    default: 'var(--accent-color)'
  },
  icon: {
    type: Array,
    default: null
  },
  settingKey: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['click'])

function click() {
  emit('click')
}
</script>

<style scoped src="./FtButton.css" />
