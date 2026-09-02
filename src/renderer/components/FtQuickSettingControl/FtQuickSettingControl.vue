<template>
  <FtToggleSwitch
    v-if="definition.control === 'toggle'"
    :label="label"
    :default-value="value"
    :setting-key="definition.id"
    compact
    @change="emitUpdate"
  />
  <FtSelect
    v-else-if="definition.control === 'select'"
    class="quickSelect"
    :placeholder="label"
    :value="value"
    :setting-key="definition.id"
    :select-names="selectNames"
    :select-values="definition.values"
    @change="emitUpdate"
  />
  <FtSlider
    v-else-if="definition.control === 'slider'"
    :label="label"
    :default-value="value"
    :setting-key="definition.id"
    :min-value="definition.min"
    :max-value="definition.max"
    :step="definition.step"
    :value-extension="definition.extension"
    @change="emitUpdate"
  />
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSelect from '../FtSelect/FtSelect.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'

const props = defineProps({
  definition: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['update'])
const { t } = useI18n()

// Catalog entries use translation keys so the same descriptor stays localized.
// eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
const label = computed(() => t(props.definition.labelKey))
const value = computed(() => store.state.settings[props.definition.id])
const selectNames = computed(() => props.definition.optionLabelKeys?.map((key) => {
  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  return t(key)
}) ?? [])

function emitUpdate(value) {
  emit('update', props.definition.id, value)
}
</script>
