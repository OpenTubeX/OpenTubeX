<template>
  <div
    class="accentColorSettings"
    role="group"
    :aria-label="label"
  >
    <div class="accentColorHeader">
      <span>{{ label }}</span>
      <code>{{ systemSelected ? systemLabel : modelValue }}</code>
    </div>
    <div class="accentColorSwatches">
      <button
        v-if="systemScheme"
        type="button"
        class="accentColorSwatch"
        :aria-label="systemLabel"
        :title="systemLabel"
        :aria-pressed="systemSelected"
        :style="swatchStyle(systemScheme)"
        @click="emit('update:modelValue', MATERIAL_SYSTEM_SEED)"
      >
        <span
          class="accentSwatchPalette"
          aria-hidden="true"
        >
          <FtIcon
            :icon="['fas', androidDynamicColors.supported ? 'wallpaper' : 'display']"
            class="accentSwatchCheck"
            aria-hidden="true"
          />
        </span>
      </button>
      <button
        v-for="preset in presets"
        :key="preset.color"
        type="button"
        class="accentColorSwatch"
        :aria-label="colorNames[preset.name] ?? preset.name"
        :title="colorNames[preset.name] ?? preset.name"
        :aria-pressed="modelValue.toLowerCase() === preset.color"
        :style="swatchStyle(preset.scheme)"
        @click="emit('update:modelValue', preset.color)"
      >
        <span
          class="accentSwatchPalette"
          aria-hidden="true"
        >
          <FtIcon
            v-if="modelValue.toLowerCase() === preset.color"
            :icon="['fas', 'check']"
            class="accentSwatchCheck"
            aria-hidden="true"
          />
        </span>
      </button>
      <FtColorPicker
        class="accentCustomSwatch"
        :data-setting-key="settingKey"
        :model-value="customColor"
        :label="label"
        :allow-alpha="false"
        @update:model-value="updateCustomColor"
        @change="flushCustomColor"
        @apply="applyCustomColor"
        @cancel="cancelCustomColor"
      >
        <template #trigger>
          <span
            class="accentCustomColor"
            :style="{ backgroundColor: customColor }"
            aria-hidden="true"
          >
            <FtIcon
              :icon="['fas', 'pencil']"
              class="accentSwatchEdit"
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
import { computed, onBeforeUnmount, ref } from 'vue'
import FtColorPicker from '../../FtColorPicker/FtColorPicker.vue'
import FtIcon from '../../FtIcon/FtIcon.vue'
import { DEFAULT_MATERIAL_SEED_COLOR, MATERIAL_SEED_PRESETS, MATERIAL_SYSTEM_SEED, materialColorScheme, materialSeedPalette } from '../../../../materialTheme.js'
import { DEFAULT_SIGNAL_ACCENT_COLOR, SIGNAL_ACCENT_PRESETS } from '../../../../signalTheme.js'
import { androidDynamicColors, desktopSystemAccentColor, getMaterialPalette, getSystemAccentColor } from '../../../helpers/dynamicColors.js'
import { calculateColorLuminance } from '../../../helpers/colors.js'

const props = defineProps({
  modelValue: { type: String, required: true },
  /** Material swatches preview the seed's tonal palette, Signal swatches the color itself. */
  variant: { type: String, default: 'material', validator: value => ['material', 'signal'].includes(value) },
})
const emit = defineEmits(['update:modelValue'])

const { t, tm } = useI18n()
const colorNames = computed(() => tm('Settings.Theme Settings.Main Color Theme'))
const material = props.variant === 'material'
const label = computed(() => material
  ? t('Settings.Theme Settings.Material Accent Color')
  : t('Settings.Theme Settings.Signal Accent Color'))
const settingKey = material ? 'materialSeedColor' : 'signalAccentColor'

/** A solid swatch with a readable check mark. */
function flatScheme(color) {
  return {
    primary: color,
    onPrimary: calculateColorLuminance(color),
    primaryContainer: color,
    secondaryContainer: color,
    tertiaryContainer: color,
  }
}
const presets = (material ? MATERIAL_SEED_PRESETS : SIGNAL_ACCENT_PRESETS).map(preset => ({
  ...preset,
  scheme: material ? materialColorScheme(materialSeedPalette(preset.color), false) : flatScheme(preset.color),
}))

// Android offers its wallpaper palette, desktops their accent color.
const systemScheme = computed(() => {
  if (!androidDynamicColors.value.supported && !desktopSystemAccentColor.value) return null
  return material
    ? materialColorScheme(getMaterialPalette(MATERIAL_SYSTEM_SEED), false)
    : flatScheme(getSystemAccentColor())
})
const systemLabel = computed(() => androidDynamicColors.value.supported
  ? t('Settings.Theme Settings.Material Wallpaper Colors')
  : t('Settings.Theme Settings.Material System Accent Color'))
const systemSelected = computed(() => props.modelValue === MATERIAL_SYSTEM_SEED)
const draftColor = ref(null)
const customColor = computed(() => draftColor.value ?? (systemSelected.value
  ? systemScheme.value?.primary ?? (material ? DEFAULT_MATERIAL_SEED_COLOR : DEFAULT_SIGNAL_ACCENT_COLOR)
  : props.modelValue))

// Each seed change restyles the whole document, so dragging previews the app
// at a limited rate while the picker follows every frame.
const PREVIEW_INTERVAL_MS = 150
let previewTimeout = null
function emitDraftColor() {
  if (draftColor.value !== null && draftColor.value !== props.modelValue) emit('update:modelValue', draftColor.value)
}
function previewDraftColor() {
  emitDraftColor()
  const previewedDraft = draftColor.value
  previewTimeout = setTimeout(() => {
    previewTimeout = null
    // A seed changed elsewhere since this preview is newer than a draft left by an interrupted drag.
    if (props.modelValue === previewedDraft && draftColor.value !== previewedDraft) previewDraftColor()
  }, PREVIEW_INTERVAL_MS)
}
function flushCustomColor() {
  clearTimeout(previewTimeout)
  previewTimeout = null
  emitDraftColor()
  draftColor.value = null
}
onBeforeUnmount(flushCustomColor)

// Canceling an edit that started from the system palette must keep following it.
let seedBeforeEdit = null
function updateCustomColor(color) {
  seedBeforeEdit ??= props.modelValue
  draftColor.value = color
  if (previewTimeout === null) previewDraftColor()
}
// Drags interrupted by pointercancel or blur end without a change event.
function applyCustomColor() {
  flushCustomColor()
  seedBeforeEdit = null
}
function cancelCustomColor() {
  flushCustomColor()
  if (seedBeforeEdit === MATERIAL_SYSTEM_SEED) emit('update:modelValue', MATERIAL_SYSTEM_SEED)
  seedBeforeEdit = null
}

function swatchStyle(scheme) {
  return {
    '--swatch-primary': scheme.primary,
    '--swatch-on-primary': scheme.onPrimary,
    '--swatch-primary-container': scheme.primaryContainer,
    '--swatch-secondary-container': scheme.secondaryContainer,
    '--swatch-tertiary-container': scheme.tertiaryContainer,
  }
}
</script>

<style scoped>
.accentColorSettings[role='group'] {
  box-sizing: border-box;
  inline-size: min(100%, 640px);
  margin-inline: auto;
  margin-block: 12px 8px;
  padding: 24px;
  border-radius: var(--shape-corner-extra-large);
  background: var(--md-sys-color-primary-container, var(--card-bg-color));
  color: var(--md-sys-color-on-primary-container, var(--primary-text-color));
}

.accentColorHeader {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.accentColorHeader code {
  font-size: 0.78rem;
}

.accentColorSwatches {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-block-start: 16px;
}

.accentColorSwatch,
.accentCustomSwatch :deep(.colorFieldTrigger) {
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
  transition:
    border-color var(--motion-fast-effects),
    border-radius var(--motion-fast-spatial);
}

/* Selected swatches settle into a rounded square; presses squish further. */
.accentColorSwatch[aria-pressed='true'] {
  border-color: var(--primary-color);
  border-radius: var(--shape-corner-large);
}

.accentColorSwatch:active,
.accentCustomSwatch :deep(.colorFieldTrigger:active) {
  border-radius: var(--shape-corner-medium);
}

.accentColorSwatch:focus-visible,
.accentCustomSwatch :deep(.colorFieldTrigger:focus-visible) {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.accentColorSwatch:hover .accentSwatchPalette,
.accentCustomSwatch :deep(.colorFieldTrigger:hover) .accentCustomColor {
  box-shadow: 0 0 0 2px var(--md-sys-color-on-primary-container, var(--primary-text-color));
}

.accentSwatchPalette {
  display: grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  border-radius: 50%;
  transition:
    box-shadow var(--motion-fast-effects),
    border-radius var(--motion-fast-spatial);
  background: conic-gradient(
    var(--swatch-primary-container) 0deg 90deg,
    var(--swatch-tertiary-container) 90deg 180deg,
    var(--swatch-primary) 180deg 270deg,
    var(--swatch-secondary-container) 270deg 360deg
  );
}

/* The palette sits 6px inside the swatch, so it follows with smaller corners. */
.accentColorSwatch[aria-pressed='true'] .accentSwatchPalette {
  border-radius: var(--shape-corner-medium);
}

.accentColorSwatch:active .accentSwatchPalette {
  border-radius: var(--shape-corner-small);
}

.accentSwatchCheck {
  box-sizing: border-box;
  padding: 3px;
  inline-size: 24px;
  block-size: 24px;
  border-radius: 50%;
  color: var(--swatch-on-primary);
  background: var(--swatch-primary);
}

.accentCustomSwatch :deep(.colorFieldTrigger) {
  grid-template-columns: 1fr;
  min-block-size: 48px;
  border-radius: var(--shape-corner-large);
  transition: border-radius var(--motion-fast-spatial);
}

.accentCustomColor {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  border: 1px solid var(--md-sys-color-on-primary-container, var(--primary-text-color));
  border-radius: var(--shape-corner-small);
  transition:
    box-shadow var(--motion-fast-effects),
    border-radius var(--motion-fast-spatial);
}

.accentCustomSwatch :deep(.colorFieldTrigger:active) .accentCustomColor {
  border-radius: var(--shape-corner-extra-small);
}

.accentSwatchEdit {
  box-sizing: border-box;
  inline-size: 24px;
  block-size: 24px;
  padding: 4px;
  border-radius: 50%;
  color: var(--md-sys-color-on-primary, var(--text-with-main-color));
  background: var(--md-sys-color-primary, var(--primary-color));
}
</style>
