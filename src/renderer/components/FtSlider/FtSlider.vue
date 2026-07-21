<template>
  <label
    class="pure-material-slider"
    :for="id"
  >
    <input
      :id="id"
      v-model.number="currentValue"
      class="input"
      :disabled="disabled"
      type="range"
      :min="minValue"
      :max="maxValue"
      :step="step"
      @input="input"
      @change="change"
    >
    <span class="label">
      {{ $t('Display Label', {label: label, value: displayLabel}) }}
      <FtSyncedSettingIndicator :setting-key="settingKey" />
    </span>
    <FtTooltip
      v-if="tooltip !== ''"
      class="selectTooltip"
      :tooltip="tooltip"
    />
  </label>
</template>

<script setup>
import { computed, ref, useId, watch } from 'vue'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  defaultValue: {
    type: Number,
    required: true
  },
  minValue: {
    type: Number,
    required: true
  },
  maxValue: {
    type: Number,
    required: true
  },
  step: {
    type: Number,
    required: true
  },
  valueExtension: {
    type: String,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  },
  tooltip: {
    type: String,
    default: ''
  },
  settingKey: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['change', 'input'])

const id = useId()
const currentValue = ref(props.defaultValue)

watch(() => props.defaultValue, (value) => {
  if (currentValue.value !== value) {
    currentValue.value = value
  }
})

const displayLabel = computed(() => {
  if (props.valueExtension === null) {
    return currentValue.value
  } else {
    return `${currentValue.value}${props.valueExtension}`
  }
})

function change() {
  emit('change', currentValue.value)
}

/**
 * @param {Event} event
 */
function input(event) {
  emit('input', event.target.valueAsNumber)
}

</script>
<style scoped src="./FtSlider.css" />
