<template>
  <div class="pure-checkbox filter">
    <h3 class="checkboxTitle">
      {{ title }}
      <FtSyncedSettingIndicator :setting-key="settingKey" />
    </h3>
    <template
      v-for="(label, index) in labels"
      :key="values[index]"
    >
      <input
        :id="id + values[index]"
        :name="id"
        :value="values[index]"
        :checked="isChecked(values[index])"
        :disabled="isDisabled(values[index])"
        class="checkbox"
        type="checkbox"
        @change="toggle(values[index], $event.target.checked)"
      >
      <label
        :for="id + values[index]"
      >
        <span class="checkboxLabelText">{{ label }}</span>
        <FtTooltip
          v-if="tooltips[values[index]]"
          class="checkboxTooltip"
          :tooltip="tooltips[values[index]]"
        />
      </label>
    </template>
  </div>
</template>

<script setup>
import { useId } from 'vue'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

const id = useId()

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  labels: {
    type: Array,
    required: true
  },
  values: {
    type: Array,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  disabledValues: {
    type: Array,
    default: () => []
  },
  tooltips: {
    type: Object,
    default: () => ({})
  },
  settingKey: {
    type: String,
    default: ''
  },
})

const modelValue = defineModel({ type: Array, required: true })

/**
 * @param {string} value
 */
function isDisabled(value) {
  return props.disabled || props.disabledValues.includes(value)
}

/**
 * @param {string} value
 */
function isChecked(value) {
  // A disabled option always renders unchecked, even if it's still stored in the model
  return !isDisabled(value) && modelValue.value.includes(value)
}

/**
 * @param {string} value
 * @param {boolean} checked
 */
function toggle(value, checked) {
  const next = new Set(modelValue.value)
  if (checked) {
    next.add(value)
  } else {
    next.delete(value)
  }
  modelValue.value = [...next]
}
</script>

<style scoped src="./FtCheckboxList.css" />
