<template>
  <FtSettingsSection
    :title="`${t('Settings.Player Settings.Voice-over Translation.Title')} ${t('Settings.Player Settings.Voice-over Translation.Attribution')}`"
  >
    <div class="switchGrid">
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Voice-over Translation.Enable')"
        compact
        :default-value="useVoiceOverTranslation"
        setting-key="useVoiceOverTranslation"
        :tooltip="t('Tooltips.Player Settings.Voice-over Translation')"
        @change="updateUseVoiceOverTranslation"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Voice-over Translation.Prepare in Background')"
        compact
        :disabled="!useVoiceOverTranslation"
        :default-value="voiceOverTranslationPrepareInBackground"
        setting-key="voiceOverTranslationPrepareInBackground"
        :tooltip="t('Settings.Player Settings.Voice-over Translation.Background Preparation Tooltip')"
        @change="updateVoiceOverTranslationPrepareInBackground"
      />
    </div>
    <div class="voiceOverTranslationControls">
      <FtSelect
        :placeholder="t('Settings.Player Settings.Voice-over Translation.Language')"
        :value="voiceOverTranslationLanguage"
        setting-key="voiceOverTranslationLanguage"
        :select-names="voiceOverTranslationLanguageNames"
        :select-values="VOICE_OVER_TRANSLATION_LANGUAGE_VALUES"
        :icon="['fas', 'language']"
        :disabled="!useVoiceOverTranslation"
        @change="updateVoiceOverTranslationLanguage"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Voice-over Translation.Voice Volume')"
        :default-value="voiceOverTranslationVolume"
        setting-key="voiceOverTranslationVolume"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="!useVoiceOverTranslation"
        @change="updateVoiceOverTranslationVolume"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Voice-over Translation.Original Volume')"
        :default-value="voiceOverTranslationOriginalVolume"
        setting-key="voiceOverTranslationOriginalVolume"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="!useVoiceOverTranslation"
        @change="updateVoiceOverTranslationOriginalVolume"
      />
      <p
        class="voiceOverTranslationLanguageHint"
        :class="{ disabled: !useVoiceOverTranslation }"
      >
        {{ t('Settings.Player Settings.Voice-over Translation.Supported Source Languages') }}
      </p>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSelect from './FtSelect/FtSelect.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'

import store from '../store/index'

const { t } = useI18n()

const useVoiceOverTranslation = computed(() => store.getters.getUseVoiceOverTranslation)
const voiceOverTranslationPrepareInBackground = computed(() => {
  return store.getters.getVoiceOverTranslationPrepareInBackground
})

const VOICE_OVER_TRANSLATION_LANGUAGE_VALUES = ['en', 'ru', 'kk']
const voiceOverTranslationLanguageNames = computed(() => [
  t('Settings.Player Settings.Voice-over Translation.English'),
  t('Settings.Player Settings.Voice-over Translation.Russian'),
  t('Settings.Player Settings.Voice-over Translation.Kazakh')
])
const voiceOverTranslationLanguage = computed(() => {
  const language = store.getters.getVoiceOverTranslationLanguage
  return VOICE_OVER_TRANSLATION_LANGUAGE_VALUES.includes(language) ? language : 'en'
})
const voiceOverTranslationVolume = computed(() => store.getters.getVoiceOverTranslationVolume)
const voiceOverTranslationOriginalVolume = computed(() => {
  return store.getters.getVoiceOverTranslationOriginalVolume
})

function updateUseVoiceOverTranslation(value) {
  store.dispatch('updateUseVoiceOverTranslation', value)
}

function updateVoiceOverTranslationPrepareInBackground(value) {
  store.dispatch('updateVoiceOverTranslationPrepareInBackground', value)
}

function updateVoiceOverTranslationLanguage(value) {
  store.dispatch('updateVoiceOverTranslationLanguage', value)
}

function updateVoiceOverTranslationVolume(value) {
  store.dispatch('updateVoiceOverTranslationVolume', value)
}

function updateVoiceOverTranslationOriginalVolume(value) {
  store.dispatch('updateVoiceOverTranslationOriginalVolume', value)
}
</script>

<style scoped>
.voiceOverTranslationControls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  align-items: start;
  gap: 1rem 2rem;
  inline-size: 100%;
  margin-block-end: 1rem;
  padding-inline: 8px;
  box-sizing: border-box;
  user-select: none;
}

.voiceOverTranslationControls :deep(.select),
.voiceOverTranslationControls :deep(.pure-material-slider) {
  box-sizing: border-box;
  inline-size: 100%;
  margin-inline: 0;
}

.voiceOverTranslationControls :deep(.pure-material-slider) {
  margin-block: 5px 0;
}

.voiceOverTranslationLanguageHint {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--secondary-text-color);
  font-size: 0.9em;
  text-align: center;
}

.voiceOverTranslationLanguageHint.disabled {
  opacity: 0.38;
}
</style>
