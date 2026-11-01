<template>
  <FtSettingsSection
    :title="t('Settings.Player Settings.Caption Appearance.Captions')"
  >
    <div class="captionSettings">
      <div
        class="captionPreview"
        :class="previewPosition"
      >
        <span :style="[captionStyle.text, { backgroundColor: captionStyle.background }]">
          {{ t('Video.Player.Caption Appearance.Sample') }}
        </span>
      </div>
      <div class="captionControls">
        <div class="captionControl">
          <FtSelect
            :placeholder="t('Settings.Player Settings.Caption Appearance.Preferred Language')"
            :value="preferredCaptionSelectValue"
            setting-key="preferredCaptionLocale"
            :select-names="captionLocaleNames"
            :select-values="captionLocaleValues"
            :icon="['fas', 'language']"
            :is-locale-selector="true"
            @change="updatePreferredCaptionLocale"
          />
        </div>
        <div class="captionControl">
          <FtToggleSwitch
            :label="t('Settings.Player Settings.Caption Appearance.Enable Translations')"
            :compact="true"
            :default-value="enableCaptionTranslations"
            setting-key="enableCaptionTranslations"
            :tooltip="t('Tooltips.Player Settings.Enable Caption Translations')"
            @change="updateEnableCaptionTranslations"
          />
        </div>
        <div
          v-for="control in styleControls"
          :key="control.setting"
          class="captionControl"
        >
          <FtSelect
            :placeholder="control.label"
            :value="String(captionSettings[control.setting] ?? '')"
            setting-key="defaultCaptionSettings"
            :is-changed="isCaptionSettingChanged(control.setting)"
            :select-names="control.names"
            :select-values="control.values"
            :option-colors="control.colors"
            :icon="['fas', control.icon]"
            @change="updateCaptionSetting(control.setting, findOptionValue(control, $event))"
            @preview="previewCaptionSetting(control.setting, $event === null ? undefined : findOptionValue(control, $event))"
            @reset="resetCaptionSetting(control.setting)"
          />
        </div>
      </div>
      <div class="captionActions">
        <FtButton
          :label="t('Settings.Player Settings.Caption Appearance.Reset')"
          :icon="['fas', 'undo']"
          :disabled="areCaptionSettingsDefault(captionSettings)"
          @click="resetCaptionSettings"
        />
      </div>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import {
  areCaptionSettingsDefault,
  CAPTION_BACKGROUND_OPACITIES,
  CAPTION_COLORS,
  CAPTION_EDGE_STYLES,
  CAPTION_FONT_FAMILIES,
  CAPTION_FONT_OPACITIES,
  CAPTION_FONT_SCALE_FACTORS,
  CAPTION_POSITION_AREAS,
  DEFAULT_CAPTION_SETTINGS,
  getCaptionStyle,
  parseCaptionSettings,
} from '../../../helpers/player/caption-settings'
import {
  getCaptionColorName,
  getCaptionEdgeStyleName,
  getCaptionFontFamilyName,
  getCaptionPositionName,
} from '../../../helpers/player/caption-setting-names'
import {
  normalizeYouTubeCaptionLanguageCode,
  YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES,
} from '../../../helpers/player/youtubeCaptionLanguages'
import store from '../../../store/index'

const { t, locale } = useI18n()

/** @type {import('vue').ComputedRef<import('../../../helpers/player/caption-settings').CaptionSettings>} */
const captionSettings = computed(() => parseCaptionSettings(store.getters.getDefaultCaptionSettings))

/** @typedef {{ setting: keyof typeof DEFAULT_CAPTION_SETTINGS, value: string | number | null }} CaptionPreview */
/**
 * The option highlighted in an open list, shown on the sample before it is chosen.
 * @type {import('vue').ShallowRef<CaptionPreview | null>}
 */
const preview = shallowRef(null)
/**
 * The chosen option, shown until it is saved, as the list closes before that.
 * @type {import('vue').ShallowRef<CaptionPreview | null>}
 */
const savingPreview = shallowRef(null)
const previewedSettings = computed(() => {
  const settings = { ...captionSettings.value }
  for (const shown of [savingPreview.value, preview.value]) {
    if (shown !== null) settings[shown.setting] = shown.value
  }
  return settings
})
const captionStyle = computed(() => getCaptionStyle(previewedSettings.value))
const previewPosition = computed(() => {
  const [row, column] = previewedSettings.value.positionArea === 'DEFAULT'
    ? ['BOTTOM', 'CENTER']
    : previewedSettings.value.positionArea.split('_')
  return [`captionRow-${row.toLowerCase()}`, `captionColumn-${(column ?? 'CENTER').toLowerCase()}`]
})

/**
 * @param {number | null} opacity
 * @returns {string}
 */
function getOpacityName(opacity) {
  return opacity === null
    ? t('Settings.Player Settings.Caption Appearance.Default')
    : `${Math.round(opacity * 100)}%`
}

/**
 * Opacities that aren't offered, which the settings allowed before, stay selectable.
 * @param {readonly (number | null)[]} opacities
 * @param {number | null} opacity
 */
function getOpacityOptions(opacities, opacity) {
  const values = opacities.includes(opacity) ? [...opacities] : [...opacities, opacity]
  return values.map(value => ({ value, name: getOpacityName(value) }))
}

/**
 * Colors that aren't in the palette, which the settings offered before, stay selectable.
 * The default color has no swatch of its own, so it gets an empty one.
 * @param {string} color
 */
function getColorOptions(color) {
  const colors = Object.keys(CAPTION_COLORS)
  if (!colors.includes(color)) colors.push(color)
  return {
    options: colors.map(value => ({ value, name: getCaptionColorName(value, t) })),
    colors: colors.map(value => value === '' ? null : value),
  }
}

/**
 * @param {{ options: { value: string | number | null }[], values: string[] }} control
 * @param {string} selectValue
 */
function findOptionValue(control, selectValue) {
  return control.options[control.values.indexOf(selectValue)].value
}

// The lists are built once per change of the settings, as a select treats new lists as new options.
const styleControls = computed(() => [
  {
    setting: 'fontFamily',
    label: t('Settings.Player Settings.Caption Appearance.Font Family.Font Family'),
    icon: 'font',
    options: Object.keys(CAPTION_FONT_FAMILIES).map(value => ({ value, name: getCaptionFontFamilyName(value, t) })),
  },
  {
    setting: 'fontColor',
    label: t('Settings.Player Settings.Caption Appearance.Text Color'),
    icon: 'text-color',
    ...getColorOptions(captionSettings.value.fontColor),
  },
  {
    setting: 'fontOpacity',
    label: t('Settings.Player Settings.Caption Appearance.Text Opacity'),
    icon: 'opacity',
    options: getOpacityOptions(CAPTION_FONT_OPACITIES, captionSettings.value.fontOpacity),
  },
  {
    setting: 'fontScaleFactor',
    label: t('Settings.Player Settings.Caption Appearance.Font Size'),
    icon: 'text-size',
    options: CAPTION_FONT_SCALE_FACTORS.map(value => ({ value, name: `${value * 100}%` })),
  },
  {
    setting: 'backgroundColor',
    label: t('Settings.Player Settings.Caption Appearance.Background Color'),
    icon: 'fill-color',
    ...getColorOptions(captionSettings.value.backgroundColor),
  },
  {
    setting: 'backgroundOpacity',
    label: t('Settings.Player Settings.Caption Appearance.Background Opacity'),
    icon: 'opacity',
    options: getOpacityOptions(CAPTION_BACKGROUND_OPACITIES, captionSettings.value.backgroundOpacity),
  },
  {
    setting: 'characterEdgeStyle',
    label: t('Settings.Player Settings.Caption Appearance.Edge Style.Edge Style'),
    icon: 'palette',
    options: CAPTION_EDGE_STYLES.map(value => ({ value, name: getCaptionEdgeStyleName(value, t) })),
  },
  {
    setting: 'positionArea',
    label: t('Settings.Player Settings.Caption Appearance.Anchor.Anchor'),
    icon: 'border-all',
    options: CAPTION_POSITION_AREAS.map(value => ({ value, name: getCaptionPositionName(value, t) })),
  },
].map(control => ({
  ...control,
  names: control.options.map(option => option.name),
  values: control.options.map(option => String(option.value ?? '')),
})))

const enableCaptionTranslations = computed(() => store.getters.getEnableCaptionTranslations)
const preferredCaptionLocale = computed(() => store.getters.getPreferredCaptionLocale)
const captionLocaleOptions = computed(() => {
  const displayNames = new Intl.DisplayNames([locale.value, 'en'], {
    type: 'language',
    languageDisplay: 'standard',
  })
  const collator = new Intl.Collator(locale.value)

  return store.getters.getYouTubeCaptionLanguageCodes
    .map(code => {
      const localizedName = displayNames.of(code)
      return {
        code,
        name: localizedName && localizedName !== code
          ? localizedName
          : YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES[code] ?? code,
      }
    })
    .sort((a, b) => collator.compare(a.name, b.name))
})
const captionLocaleValues = computed(() => [
  '',
  ...captionLocaleOptions.value.map(({ code }) => code),
])
const captionLocaleNames = computed(() => [
  t('Settings.Player Settings.Caption Appearance.Application Language'),
  ...captionLocaleOptions.value.map(({ name }) => name),
])
const preferredCaptionSelectValue = computed(() => {
  const canonical = normalizeYouTubeCaptionLanguageCode(preferredCaptionLocale.value)
  const supportedCodes = new Set(captionLocaleValues.value)
  return supportedCodes.has(canonical) ? canonical : ''
})

/**
 * @param {keyof typeof DEFAULT_CAPTION_SETTINGS} setting
 * @param {string | number | null} value
 */
async function updateCaptionSetting(setting, value) {
  const saving = { setting, value }
  savingPreview.value = saving
  try {
    await store.dispatch('updateDefaultCaptionSettings', JSON.stringify({
      ...captionSettings.value,
      [setting]: value,
    }))
  } finally {
    if (savingPreview.value === saving) savingPreview.value = null
  }
}

/**
 * @param {keyof typeof DEFAULT_CAPTION_SETTINGS} setting
 * @param {string | number | null | undefined} value `undefined` once the list closes
 */
function previewCaptionSetting(setting, value) {
  preview.value = value === undefined ? null : { setting, value }
}

/**
 * @param {keyof typeof DEFAULT_CAPTION_SETTINGS} setting
 * @returns {boolean}
 */
function isCaptionSettingChanged(setting) {
  return !Object.is(captionSettings.value[setting], DEFAULT_CAPTION_SETTINGS[setting])
}

/**
 * @param {keyof typeof DEFAULT_CAPTION_SETTINGS} setting
 */
function resetCaptionSetting(setting) {
  updateCaptionSetting(setting, DEFAULT_CAPTION_SETTINGS[setting])
}

/** @param {string} value */
function updatePreferredCaptionLocale(value) {
  store.dispatch('updatePreferredCaptionLocale', value)
}

/** @param {boolean} value */
function updateEnableCaptionTranslations(value) {
  store.dispatch('updateEnableCaptionTranslations', value)
}

function resetCaptionSettings() {
  store.dispatch('updateDefaultCaptionSettings', JSON.stringify(DEFAULT_CAPTION_SETTINGS))
}
</script>

<style scoped src="./CaptionSettings.css" />
