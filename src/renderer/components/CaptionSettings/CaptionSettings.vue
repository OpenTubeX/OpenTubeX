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
        <label class="captionControl captionColorControl">
          <span>{{ t('Settings.Player Settings.Caption Appearance.Text Color') }}</span>
          <input
            type="color"
            :value="captionSettings.textColor"
            @input="updateCaptionSetting('textColor', $event.target.value)"
          >
        </label>
        <label class="captionControl captionColorControl">
          <span>{{ t('Settings.Player Settings.Caption Appearance.Background Color') }}</span>
          <input
            type="color"
            :value="captionSettings.backgroundColor"
            @input="updateCaptionSetting('backgroundColor', $event.target.value)"
          >
        </label>
        <div class="captionControl">
          <FtSlider
            :label="t('Settings.Player Settings.Caption Appearance.Background Opacity')"
            :default-value="Math.round(captionSettings.backgroundOpacity * 100)"
            :min-value="0"
            :max-value="100"
            :step="5"
            value-extension="%"
            @input="updateCaptionSetting('backgroundOpacity', $event / 100)"
          />
        </div>
        <div class="captionControl">
          <FtSlider
            :label="t('Settings.Player Settings.Caption Appearance.Font Size')"
            :default-value="Math.round(captionSettings.fontScale * 100)"
            :min-value="50"
            :max-value="200"
            :step="10"
            value-extension="%"
            @input="updateCaptionSetting('fontScale', $event / 100)"
          />
        </div>
        <div class="captionControl">
          <FtSelect
            :placeholder="t('Settings.Player Settings.Caption Appearance.Anchor.Anchor')"
            :value="captionSettings.anchor"
            :select-names="captionAnchorNames"
            :select-values="CAPTION_ANCHORS"
            :icon="['fas', 'border-all']"
            @change="updateCaptionSetting('anchor', $event)"
          />
        </div>
        <div class="captionControl">
          <FtSlider
            :label="t('Settings.Player Settings.Caption Appearance.Vertical Position')"
            :default-value="Math.round(captionSettings.verticalPosition * 100)"
            :min-value="0"
            :max-value="50"
            :step="1"
            value-extension="%"
            @input="updateCaptionSetting('verticalPosition', $event / 100)"
          />
        </div>
        <div class="captionControl">
          <FtSelect
            :placeholder="t('Settings.Player Settings.Caption Appearance.Edge Style.Edge Style')"
            :value="captionSettings.edgeStyle"
            :select-names="captionEdgeStyleNames"
            :select-values="CAPTION_EDGE_STYLES"
            :icon="['fas', 'palette']"
            @change="updateCaptionSetting('edgeStyle', $event)"
          />
        </div>
        <label
          v-if="captionSettings.edgeStyle !== 'none'"
          class="captionControl captionColorControl"
        >
          <span>{{ t('Settings.Player Settings.Caption Appearance.Edge Color') }}</span>
          <input
            type="color"
            :value="captionSettings.edgeColor"
            @input="updateCaptionSetting('edgeColor', $event.target.value)"
          >
        </label>
      </div>
      <div class="captionActions">
        <FtButton
          :label="t('Settings.Player Settings.Caption Appearance.Reset')"
          :icon="['fas', 'undo']"
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
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../FtSlider/FtSlider.vue'

import {
  CAPTION_ANCHORS,
  CAPTION_EDGE_STYLES,
  DEFAULT_CAPTION_SETTINGS,
  getCaptionCssVariables,
  parseCaptionSettings,
} from '../../helpers/player/caption-settings'
import store from '../../store/index'

const { t } = useI18n()

const captionSettings = computed(() => parseCaptionSettings(store.getters.getDefaultCaptionSettings))
const captionCssVariables = computed(() => getCaptionCssVariables(captionSettings.value))
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

function resetCaptionSettings() {
  store.dispatch('updateDefaultCaptionSettings', JSON.stringify(DEFAULT_CAPTION_SETTINGS))
}
</script>

<style scoped src="./CaptionSettings.css" />
