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
    >
      <input
        type="checkbox"
        class="settingChipInput"
        :checked="item.value"
        :disabled="item.disabled"
        :aria-label="accessibleName(item)"
        @change="change(item, $event)"
      >
      <FtIcon
        class="settingChipIcon"
        :icon="['fas', item.value ? checkedIcon : uncheckedIcon]"
        aria-hidden="true"
      />
      <span class="settingChipText">{{ item.shortLabel }}</span>
      <!-- Inside the label like a switch's. Buttons don't pass their clicks
           to the checkbox, and stay usable while the chip is disabled, so the
           tooltip explains why and a locked value can still be reset. -->
      <FtTooltip
        v-if="item.tooltip"
        class="settingChipTooltip"
        :tooltip="item.tooltip"
      />
      <FtSyncedSettingIndicator :setting-key="item.settingKey" />
    </label>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'

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
 * The setting's full label, which Settings search and screen reader users
 * know it by. A chip whose visible text the label doesn't contain, such as Up
 * Next for Hide Recommended Videos, adds that text, so speech input users can
 * name the chip by what they see.
 * @param {SettingChip} item
 * @returns {string}
 */
function accessibleName(item) {
  return item.label.toLocaleLowerCase().includes(item.shortLabel.toLocaleLowerCase())
    ? item.label
    : `${item.label}: ${item.shortLabel}`
}

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
