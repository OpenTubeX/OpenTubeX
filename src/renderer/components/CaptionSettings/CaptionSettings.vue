<template>
  <FtSettingsSection
    :title="t('Settings.Player Settings.Caption Appearance.Captions')"
  >
    <div class="captionSettings">
      <div
        :class="['captionPreview', `captionAnchor-${captionSettings.anchor}`]"
        :style="captionCssVariables"
      >
        <span>{{ t('Video.Player.Caption Appearance.Sample') }}</span>
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
        <FtColorPicker
          class="captionControl captionColorControl"
          :label="t('Settings.Player Settings.Caption Appearance.Text Color')"
          :model-value="captionSettings.textColor"
          :allow-alpha="false"
          @update:model-value="updateCaptionSetting('textColor', $event)"
        >
          <template #label>
            {{ t('Settings.Player Settings.Caption Appearance.Text Color') }}
            <FtSyncedSettingIndicator
              setting-key="defaultCaptionSettings"
              :is-changed="isCaptionSettingChanged('textColor')"
              @reset="resetCaptionSetting('textColor')"
            />
          </template>
        </FtColorPicker>
        <FtColorPicker
          class="captionControl captionColorControl"
          :label="t('Settings.Player Settings.Caption Appearance.Background Color')"
          :model-value="captionSettings.backgroundColor"
          :allow-alpha="false"
          @update:model-value="updateCaptionSetting('backgroundColor', $event)"
        >
          <template #label>
            {{ t('Settings.Player Settings.Caption Appearance.Background Color') }}
            <FtSyncedSettingIndicator
              setting-key="defaultCaptionSettings"
              :is-changed="isCaptionSettingChanged('backgroundColor')"
              @reset="resetCaptionSetting('backgroundColor')"
            />
          </template>
        </FtColorPicker>
        <div class="captionControl">
          <FtSlider
            :label="t('Settings.Player Settings.Caption Appearance.Background Opacity')"
            :default-value="Math.round(captionSettings.backgroundOpacity * 100)"
            setting-key="defaultCaptionSettings"
            :is-changed="isCaptionSettingChanged('backgroundOpacity')"
            :min-value="0"
            :max-value="100"
            :step="5"
            value-extension="%"
            @input="updateCaptionSetting('backgroundOpacity', $event / 100)"
            @reset="resetCaptionSetting('backgroundOpacity')"
          />
        </div>
        <div class="captionControl">
          <FtSlider
            :label="t('Settings.Player Settings.Caption Appearance.Font Size')"
            :default-value="Math.round(captionSettings.fontScale * 100)"
            setting-key="defaultCaptionSettings"
            :is-changed="isCaptionSettingChanged('fontScale')"
            :min-value="MIN_CAPTION_FONT_SCALE * 100"
            :max-value="MAX_CAPTION_FONT_SCALE * 100"
            :step="10"
            value-extension="%"
            @input="updateCaptionSetting('fontScale', $event / 100)"
            @reset="resetCaptionSetting('fontScale')"
          />
        </div>
        <div class="captionControl">
          <FtSelect
            :placeholder="t('Settings.Player Settings.Caption Appearance.Anchor.Anchor')"
            :value="captionSettings.anchor"
            setting-key="defaultCaptionSettings"
            :is-changed="isCaptionSettingChanged('anchor')"
            :select-names="captionAnchorNames"
            :select-values="CAPTION_ANCHORS"
            :icon="['fas', 'border-all']"
            @change="updateCaptionSetting('anchor', $event)"
            @reset="resetCaptionSetting('anchor')"
          />
        </div>
        <div class="captionControl">
          <FtSlider
            :label="t('Settings.Player Settings.Caption Appearance.Vertical Position')"
            :default-value="Math.round(captionSettings.verticalPosition * 100)"
            setting-key="defaultCaptionSettings"
            :is-changed="isCaptionSettingChanged('verticalPosition')"
            :min-value="0"
            :max-value="50"
            :step="1"
            value-extension="%"
            @input="updateCaptionSetting('verticalPosition', $event / 100)"
            @reset="resetCaptionSetting('verticalPosition')"
          />
        </div>
        <div class="captionControl">
          <FtSelect
            :placeholder="t('Settings.Player Settings.Caption Appearance.Edge Style.Edge Style')"
            :value="captionSettings.edgeStyle"
            setting-key="defaultCaptionSettings"
            :is-changed="isCaptionSettingChanged('edgeStyle')"
            :select-names="captionEdgeStyleNames"
            :select-values="CAPTION_EDGE_STYLES"
            :icon="['fas', 'palette']"
            @change="updateCaptionSetting('edgeStyle', $event)"
            @reset="resetCaptionSetting('edgeStyle')"
          />
        </div>
        <FtColorPicker
          v-if="captionSettings.edgeStyle !== 'none'"
          class="captionControl captionColorControl"
          :label="t('Settings.Player Settings.Caption Appearance.Edge Color')"
          :model-value="captionSettings.edgeColor"
          :allow-alpha="false"
          @update:model-value="updateCaptionSetting('edgeColor', $event)"
        >
          <template #label>
            {{ t('Settings.Player Settings.Caption Appearance.Edge Color') }}
            <FtSyncedSettingIndicator
              setting-key="defaultCaptionSettings"
              :is-changed="isCaptionSettingChanged('edgeColor')"
              @reset="resetCaptionSetting('edgeColor')"
            />
          </template>
        </FtColorPicker>
      </div>
      <div class="captionActions">
        <FtButton
          :label="t('Settings.Player Settings.Caption Appearance.Reset')"
          :icon="['fas', 'undo']"
          :disabled="isCaptionAppearanceDefault"
          @click="resetCaptionSettings"
        />
      </div>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtColorPicker from '../FtColorPicker/FtColorPicker.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

import {
  CAPTION_ANCHORS,
  CAPTION_EDGE_STYLES,
  DEFAULT_CAPTION_SETTINGS,
  getCaptionCssVariables,
  MAX_CAPTION_FONT_SCALE,
  MIN_CAPTION_FONT_SCALE,
  parseCaptionSettings,
} from '../../helpers/player/caption-settings'
import {
  normalizeYouTubeCaptionLanguageCode,
  YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES,
} from '../../helpers/player/youtubeCaptionLanguages'
import store from '../../store/index'

const { t, locale } = useI18n()

const captionSettings = computed(() => parseCaptionSettings(store.getters.getDefaultCaptionSettings))
const isCaptionAppearanceDefault = computed(() => (
  Object.entries(DEFAULT_CAPTION_SETTINGS).every(([setting, defaultValue]) => (
    Object.is(captionSettings.value[setting], defaultValue)
  ))
))
const captionCssVariables = computed(() => getCaptionCssVariables(captionSettings.value))
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
const captionAnchorNames = computed(() => [
  t('Settings.Player Settings.Caption Appearance.Anchor.Top Left'),
  t('Settings.Player Settings.Caption Appearance.Anchor.Top Center'),
  t('Settings.Player Settings.Caption Appearance.Anchor.Top Right'),
  t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Left'),
  t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Center'),
  t('Settings.Player Settings.Caption Appearance.Anchor.Bottom Right'),
])
const captionEdgeStyleNames = computed(() => [
  t('Settings.Player Settings.Caption Appearance.Edge Style.None'),
  t('Settings.Player Settings.Caption Appearance.Edge Style.Outline'),
  t('Settings.Player Settings.Caption Appearance.Edge Style.Drop Shadow'),
])

/**
 * @param {'textColor' | 'backgroundColor' | 'backgroundOpacity' | 'fontScale' | 'verticalPosition' | 'anchor' | 'edgeStyle' | 'edgeColor'} setting
 * @param {string | number} value
 */
function updateCaptionSetting(setting, value) {
  store.dispatch('updateDefaultCaptionSettings', JSON.stringify({
    ...captionSettings.value,
    [setting]: value,
  }))
}

/**
 * @param {'textColor' | 'backgroundColor' | 'backgroundOpacity' | 'fontScale' | 'verticalPosition' | 'anchor' | 'edgeStyle' | 'edgeColor'} setting
 * @returns {boolean}
 */
function isCaptionSettingChanged(setting) {
  return !Object.is(captionSettings.value[setting], DEFAULT_CAPTION_SETTINGS[setting])
}

/**
 * @param {'textColor' | 'backgroundColor' | 'backgroundOpacity' | 'fontScale' | 'verticalPosition' | 'anchor' | 'edgeStyle' | 'edgeColor'} setting
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
