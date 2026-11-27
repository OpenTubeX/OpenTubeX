<template>
  <FtSettingsSection
    :title="`${t('Settings.Player Settings.Voice-over Translation.Title')} ${t('Settings.Player Settings.Voice-over Translation.Attribution')}`"
    :icon="['fas', 'headphones']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        :description="t('Tooltips.Player Settings.Voice-over Translation')"
        :title="t('Settings.Player Settings.Voice-over Translation.Enable')"
        :icon="['fas', 'headphones']"
      >
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Voice-over Translation.Enable')"
          hide-label
          :default-value="useVoiceOverTranslation"
          setting-key="useVoiceOverTranslation"
          @change="updateUseVoiceOverTranslation"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Settings.Player Settings.Voice-over Translation.Background Preparation Tooltip')"
        :title="t('Settings.Player Settings.Voice-over Translation.Prepare in Background')"
        :icon="['fas', 'downloading']"
      >
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Voice-over Translation.Prepare in Background')"
          hide-label
          :disabled="!useVoiceOverTranslation"
          :default-value="voiceOverTranslationPrepareInBackground"
          setting-key="voiceOverTranslationPrepareInBackground"
          @change="updateVoiceOverTranslationPrepareInBackground"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Player Settings.Voice-over Translation.Language')"
        :icon="['fas', 'language']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Player Settings.Voice-over Translation.Language')"
          :value="voiceOverTranslationLanguage"
          setting-key="voiceOverTranslationLanguage"
          :select-names="voiceOverTranslationLanguageNames"
          :select-values="VOICE_OVER_TRANSLATION_LANGUAGE_VALUES"
          :disabled="!useVoiceOverTranslation"
          @change="updateVoiceOverTranslationLanguage"
        />
      </FtSettingsRow>
    </div>
    <FtSliderGrid>
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
    </FtSliderGrid>
    <p
      class="voiceOverTranslationLanguageHint"
      :class="{ disabled: !useVoiceOverTranslation }"
    >
      {{ t('Settings.Player Settings.Voice-over Translation.Supported Source Languages') }}
    </p>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtSliderGrid from '../../FtSliderGrid/FtSliderGrid.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'

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
.voiceOverTranslationLanguageHint {
  margin-block: 1rem 0;
  padding-inline: 20px;
  user-select: none;
  color: var(--secondary-text-color);
  font-size: 0.9em;
  text-align: center;
}

.voiceOverTranslationLanguageHint.disabled {
  opacity: 0.38;
}
</style>
