<template>
  <FtSettingsSection :title="t('Settings.Player Settings.Buffering.Buffering')">
    <div class="bufferNotes">
      <p>{{ t('Settings.Player Settings.Buffering.Description') }}</p>
      <ul>
        <li>{{ t('Settings.Player Settings.Buffering.Buffer Ahead Hint') }}</li>
        <li>{{ t('Settings.Player Settings.Buffering.Rewind Buffer Hint') }}</li>
        <li>{{ t('Settings.Player Settings.Buffering.Buffer Before Playing Hint') }}</li>
      </ul>
    </div>
    <FtFlexBox>
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Buffering.Preset')"
        :value="preset"
        :select-names="presetNames"
        :select-values="presetValues"
        :icon="['fas', 'sliders-h']"
        :is-changed="preset !== 'default'"
        @change="applyPreset"
        @reset="applyPreset('default')"
      />
    </FtFlexBox>
    <FtSliderGrid>
      <FtSlider
        v-for="slider in sliders"
        :key="slider.key"
        :label="slider.label"
        :default-value="settings[slider.key]"
        :setting-key="slider.key"
        :min-value="BUFFER_SETTING_RANGES[slider.key].min"
        :max-value="BUFFER_SETTING_RANGES[slider.key].max"
        :step="BUFFER_SETTING_RANGES[slider.key].step"
        value-extension="s"
        :tooltip="slider.tooltip"
        @change="store.dispatch(slider.action, $event)"
      />
    </FtSliderGrid>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtSliderGrid from '../../FtSliderGrid/FtSliderGrid.vue'

import store from '../../../store/index'
import {
  BUFFER_PRESETS,
  BUFFER_SETTING_RANGES,
  findBufferPreset,
} from '../../../helpers/player/buffering'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<import('../../../helpers/player/buffering').BufferSettings>} */
const settings = computed(() => ({
  bufferAhead: store.getters.getBufferAhead,
  bufferBehind: store.getters.getBufferBehind,
  bufferBeforePlaying: store.getters.getBufferBeforePlaying,
}))

const preset = computed(() => findBufferPreset(settings.value))

// Custom is only an option while the values don't match a preset, picking it wouldn't change anything
const presetValues = computed(() => {
  const values = Object.keys(BUFFER_PRESETS)
  return preset.value === 'custom' ? [...values, 'custom'] : values
})

const presetNames = computed(() => {
  const names = {
    dataSaver: t('Settings.Player Settings.Buffering.Presets.Data Saver'),
    default: t('Settings.Player Settings.Buffering.Presets.Default'),
    smooth: t('Settings.Player Settings.Buffering.Presets.Smooth Playback'),
    custom: t('Settings.Player Settings.Buffering.Presets.Custom'),
  }
  return presetValues.value.map(value => names[value])
})

const sliders = computed(() => [{
  key: 'bufferAhead',
  label: t('Settings.Player Settings.Buffering.Buffer Ahead'),
  tooltip: t('Settings.Player Settings.Buffering.Buffer Ahead Tooltip', { value: defaultValueLabel('bufferAhead') }),
  action: 'updateBufferAhead',
}, {
  key: 'bufferBehind',
  label: t('Settings.Player Settings.Buffering.Rewind Buffer'),
  tooltip: t('Settings.Player Settings.Buffering.Rewind Buffer Tooltip', { value: defaultValueLabel('bufferBehind') }),
  action: 'updateBufferBehind',
}, {
  key: 'bufferBeforePlaying',
  label: t('Settings.Player Settings.Buffering.Buffer Before Playing'),
  tooltip: t('Settings.Player Settings.Buffering.Buffer Before Playing Tooltip', { value: defaultValueLabel('bufferBeforePlaying') }),
  action: 'updateBufferBeforePlaying',
}])

/**
 * @param {keyof import('../../../helpers/player/buffering').BufferSettings} key
 */
function defaultValueLabel(key) {
  return `${BUFFER_PRESETS.default[key]}s`
}

/**
 * @param {string} value
 */
function applyPreset(value) {
  const values = BUFFER_PRESETS[value]
  if (values === undefined) return

  for (const { key, action } of sliders.value) {
    if (settings.value[key] !== values[key]) {
      store.dispatch(action, values[key])
    }
  }
}
</script>

<style scoped src="./BufferSettings.css" />
