<template>
  <div
    class="select"
    :class="{ containsTooltip: tooltip !== '' }"
  >
    <select
      :id="id"
      :aria-describedby="describeById"
      class="select-text"
      :class="{ disabled }"
      :value="value"
      :name="id"
      :disabled="disabled"
      @change="change"
    >
      <option
        v-for="(name, index) in selectNames"
        :key="selectValues[index]"
        :dir="isLocaleSelector ? 'auto' : null"
        :value="selectValues[index]"
        :lang="isLocaleSelector && selectValues[index] !== 'system' && selectValues[index] !== '' ? selectValues[index] : null"
      >
        {{ name }}
      </option>
    </select>
    <FontAwesomeIcon
      :icon="['fas', 'angle-down']"
      class="iconSelect"
    />
    <span class="select-highlight" />
    <span class="select-bar" />
    <label
      class="select-label"
      :for="id"
    >
      <FontAwesomeIcon
        :icon="icon"
        class="select-icon"
        :color="iconColor"
      />
      <span class="select-label-text">
        {{ placeholder }}
        <FtSyncedSettingIndicator
          v-if="tooltip === ''"
          :setting-key="settingKey"
          :is-changed="isChanged"
          @reset="emit('reset')"
        />
      </span>
    </label>
    <span
      v-if="tooltip !== ''"
      class="selectIndicators"
    >
      <FtTooltip
        class="selectTooltip"
        :tooltip="tooltip"
      />
      <FtSyncedSettingIndicator
        :setting-key="settingKey"
        :is-changed="isChanged"
        @reset="emit('reset')"
      />
    </span>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useId } from 'vue'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

defineProps({
  placeholder: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  selectNames: {
    type: Array,
    required: true
  },
  selectValues: {
    type: Array,
    required: true
  },
  tooltip: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  describeById: {
    type: String,
    default: null
  },
  icon: {
    type: Array,
    required: true
  },
  iconColor: {
    type: String,
    default: null
  },
  isLocaleSelector: {
    type: Boolean,
    default: false
  },
  settingKey: {
    type: String,
    default: ''
  },
  isChanged: {
    type: Boolean,
    default: null
  }
})

const emit = defineEmits(['change', 'reset'])

const id = useId()

/**
 * @param {Event} event
 */
function change(event) {
  emit('change', event.target.value)
}
</script>

<style scoped src="./FtSelect.css" />
