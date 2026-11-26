<template>
  <div
    class="settingChips"
    role="group"
    :aria-labelledby="labelledby || undefined"
  >
    <!-- Each chip is a checkbox named after the setting's full label, such as
         Hide Video Views, while it shows the shorter name of what it hides. -->
    <label
      v-for="item in items"
      :key="item.settingKey"
      class="settingChip"
      :class="{ checked: item.value, disabled: item.disabled }"
      :data-setting-key="item.settingKey"
      :title="item.tooltip || undefined"
    >
      <input
        type="checkbox"
        class="settingChipInput"
        :checked="item.value"
        :disabled="item.disabled"
        :aria-label="item.label"
        @change="change(item, $event)"
      >
      <FtIcon
        class="settingChipIcon"
        :icon="['fas', item.value ? checkedIcon : uncheckedIcon]"
        aria-hidden="true"
      />
      <span class="settingChipText">{{ item.shortLabel }}</span>
      <!-- Inside the label like a switch's: the indicators stop their clicks
           from reaching the checkbox. -->
      <FtSyncedSettingIndicator
        :setting-key="item.settingKey"
        :disabled="item.disabled"
      />
    </label>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

/**
 * @typedef {object} SettingChip
 * @property {string} settingKey
 * @property {string} label the setting's full label, read as the chip's name
 * @property {string} shortLabel shown on the chip
 * @property {boolean} value
 * @property {boolean} [disabled]
 * @property {string} [tooltip]
 */

defineProps({
  /** @type {import('vue').PropType<SettingChip[]>} */
  items: {
    type: Array,
    required: true
  },
  labelledby: {
    type: String,
    default: ''
  },
  checkedIcon: {
    type: String,
    default: 'eye-slash'
  },
  uncheckedIcon: {
    type: String,
    default: 'eye'
  }
})

const emit = defineEmits(['change'])

/**
 * @param {SettingChip} item
 * @param {Event} event
 */
function change(item, event) {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const value = input.checked
  // The store decides the state, so a chip it keeps unchanged doesn't flip.
  input.checked = item.value
  emit('change', item, value)
}
</script>

<style scoped src="./FtSettingChips.css" />
