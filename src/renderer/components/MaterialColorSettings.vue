<template>
  <div
    class="materialColorSettings"
    role="group"
    :aria-label="t('Settings.Theme Settings.Material Accent Color')"
  >
    <div class="materialColorHeader">
      <span>{{ t('Settings.Theme Settings.Material Accent Color') }}</span>
      <code>{{ modelValue }}</code>
    </div>
    <div class="materialColorSwatches">
      <button
        v-for="preset in presets"
        :key="preset.color"
        type="button"
        class="materialColorSwatch"
        :aria-label="colorNames[preset.name] ?? preset.name"
        :title="colorNames[preset.name] ?? preset.name"
        :aria-pressed="modelValue.toLowerCase() === preset.color"
        :style="{
          '--swatch-primary': preset.scheme.primary,
          '--swatch-on-primary': preset.scheme.onPrimary,
          '--swatch-primary-container': preset.scheme.primaryContainer,
          '--swatch-secondary-container': preset.scheme.secondaryContainer,
          '--swatch-tertiary-container': preset.scheme.tertiaryContainer,
        }"
        @click="emit('update:modelValue', preset.color)"
      >
        <span
          class="materialSwatchPalette"
          aria-hidden="true"
        >
          <FtIcon
            v-if="modelValue.toLowerCase() === preset.color"
            :icon="['fas', 'check']"
            class="materialSwatchCheck"
            aria-hidden="true"
          />
        </span>
      </button>
      <FtColorPicker
        class="materialCustomSwatch"
        data-setting-key="materialSeedColor"
        :model-value="modelValue"
        :label="t('Settings.Theme Settings.Material Accent Color')"
        :allow-alpha="false"
        @update:model-value="emit('update:modelValue', $event)"
      >
        <template #trigger>
          <span
            class="materialCustomColor"
            :style="{ backgroundColor: modelValue }"
            aria-hidden="true"
          >
            <FtIcon
              :icon="['fas', 'pencil']"
              class="materialSwatchEdit"
              aria-hidden="true"
            />
          </span>
        </template>
      </FtColorPicker>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import FtColorPicker from './FtColorPicker/FtColorPicker.vue'
import FtIcon from './FtIcon/FtIcon.vue'
import { MATERIAL_SEED_PRESETS, materialColorScheme, materialSeedPalette } from '../../materialTheme.js'

const { t, tm } = useI18n()
const colorNames = computed(() => tm('Settings.Theme Settings.Main Color Theme'))
const presets = MATERIAL_SEED_PRESETS.map(preset => ({
  ...preset,
  scheme: materialColorScheme(materialSeedPalette(preset.color), false),
}))

defineProps({ modelValue: { type: String, required: true } })
const emit = defineEmits(['update:modelValue'])
</script>

<style scoped>
.materialColorSettings[role='group'] {
  box-sizing: border-box;
  inline-size: min(100%, 640px);
  margin-inline: auto;
  margin-block: 12px 8px;
  padding: 24px;
  border-radius: calc(24px * var(--ui-roundness));
  background: var(--md-sys-color-primary-container, var(--card-bg-color));
  color: var(--md-sys-color-on-primary-container, var(--primary-text-color));
}

.materialColorHeader {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.materialColorHeader code {
  font-size: 0.78rem;
}

.materialColorSwatches {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-block-start: 16px;
}

.materialColorSwatch,
.materialCustomSwatch :deep(.colorFieldTrigger) {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  flex: 0 0 48px;
  inline-size: 48px;
  block-size: 48px;
  padding: 4px;
  border: 2px solid transparent;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.materialColorSwatch[aria-pressed='true'] {
  border-color: var(--primary-color);
}

.materialColorSwatch:focus-visible,
.materialCustomSwatch :deep(.colorFieldTrigger:focus-visible) {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.materialColorSwatch:hover .materialSwatchPalette,
.materialCustomSwatch :deep(.colorFieldTrigger:hover) .materialCustomColor {
  box-shadow: 0 0 0 2px var(--md-sys-color-on-primary-container, var(--primary-text-color));
}

.materialSwatchPalette {
  display: grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  border-radius: 50%;
  background: conic-gradient(
    var(--swatch-primary-container) 0deg 90deg,
    var(--swatch-tertiary-container) 90deg 180deg,
    var(--swatch-primary) 180deg 270deg,
    var(--swatch-secondary-container) 270deg 360deg
  );
}

.materialSwatchCheck {
  box-sizing: border-box;
  padding: 3px;
  inline-size: 24px;
  block-size: 24px;
  border-radius: 50%;
  color: var(--swatch-on-primary);
  background: var(--swatch-primary);
}

.materialCustomSwatch :deep(.colorFieldTrigger) {
  grid-template-columns: 1fr;
  min-block-size: 48px;
  border-radius: calc(14px * var(--ui-roundness));
}

.materialCustomColor {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  border: 1px solid var(--md-sys-color-on-primary-container, var(--primary-text-color));
  border-radius: calc(8px * var(--ui-roundness));
}

.materialSwatchEdit {
  box-sizing: border-box;
  inline-size: 24px;
  block-size: 24px;
  padding: 4px;
  border-radius: 50%;
  color: var(--md-sys-color-on-primary, var(--text-with-main-color));
  background: var(--md-sys-color-primary, var(--primary-color));
}
</style>
