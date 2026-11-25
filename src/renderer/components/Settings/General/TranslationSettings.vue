<template>
  <FtSettingsSection
    :title="t('Settings.General Settings.Comment Translation.Translation')"
    :icon="['fas', 'language']"
  >
    <div class="translationSettings">
      <FtCheckboxList
        v-model="enabledTranslations"
        :title="t('Settings.General Settings.Comment Translation.Offer Translations For')"
        :labels="translationLabels"
        :values="TRANSLATION_SETTING_KEYS"
        :sync-setting-keys="TRANSLATION_SETTING_KEYS"
        :is-changed="translationsChanged"
        @reset="resetTranslations"
      />
      <p
        :id="descriptionId"
        class="translationDescription"
      >
        {{ t('Settings.General Settings.Comment Translation.Description') }}
      </p>
      <FtSelect
        class="translationLanguageSelect"
        :placeholder="t('Settings.General Settings.Comment Translation.Never Translate')"
        value=""
        setting-key="commentTranslationIgnoredLanguages"
        :select-names="languageNames"
        :select-values="languageValues"
        :describe-by-id="descriptionId"
        :disabled="!anyTranslationEnabled"
        :icon="['fas', 'language']"
        :is-locale-selector="true"
        @change="addLanguage"
      />
      <ul
        v-if="selectedLanguages.length > 0"
        class="translationLanguages"
        :aria-label="t('Settings.General Settings.Comment Translation.Never Translate')"
      >
        <li
          v-for="language in selectedLanguages"
          :key="language.code"
          class="translationLanguage"
        >
          <bdi :lang="language.code">{{ language.name }}</bdi>
          <button
            type="button"
            class="translationLanguageRemove"
            :disabled="!anyTranslationEnabled"
            :aria-label="t('Settings.General Settings.Comment Translation.Remove Language', { language: language.name })"
            :title="t('Settings.General Settings.Comment Translation.Remove Language', { language: language.name })"
            @click="removeLanguage(language.code)"
          >
            <FtIcon :icon="['fas', 'xmark']" />
          </button>
        </li>
      </ul>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtCheckboxList from '../../FtCheckboxList/FtCheckboxList.vue'

import {
  COMMENT_TRANSLATION_LANGUAGE_CODES,
  normalizeCommentTranslationLanguageCode,
} from '../../../helpers/comment-translations'
import store from '../../../store/index'
import { DEFAULT_SETTINGS, defaultUpdaterId } from '../../../store/modules/settings'

const { locale, t } = useI18n()
const descriptionId = useId()
const TRANSLATION_SETTING_KEYS = ['enableCommentTranslations', 'enableDescriptionTranslations', 'enablePostTranslations']

const translationLabels = computed(() => [
  t('Comments.Comments'),
  t('Settings.General Settings.Comment Translation.Descriptions'),
  t('Global.Posts'),
])
const enabledTranslations = computed({
  get: () => TRANSLATION_SETTING_KEYS.filter(key => store.state.settings[key]),
  set: (values) => {
    const enabled = new Set(values)
    for (const key of TRANSLATION_SETTING_KEYS) {
      if (store.state.settings[key] !== enabled.has(key)) store.dispatch(defaultUpdaterId(key), enabled.has(key))
    }
  }
})
const anyTranslationEnabled = computed(() => enabledTranslations.value.length > 0)
const translationsChanged = computed(() => TRANSLATION_SETTING_KEYS.some(key => store.state.settings[key] !== DEFAULT_SETTINGS[key]))

function resetTranslations() {
  for (const key of TRANSLATION_SETTING_KEYS) {
    if (store.state.settings[key] !== DEFAULT_SETTINGS[key]) store.dispatch('resetSettingToDefault', key)
  }
}

const displayNames = computed(() => new Intl.DisplayNames([locale.value, 'en'], {
  type: 'language',
  languageDisplay: 'standard',
}))
const languageCollator = computed(() => new Intl.Collator(locale.value))
const appLanguage = computed(() => normalizeCommentTranslationLanguageCode(locale.value))
const ignoredLanguages = computed(() => {
  const savedLanguages = store.getters.getCommentTranslationIgnoredLanguages
  if (!Array.isArray(savedLanguages)) return []

  const supportedLanguages = new Set(COMMENT_TRANSLATION_LANGUAGE_CODES)
  return [...new Set(savedLanguages.map(normalizeCommentTranslationLanguageCode))]
    .filter(language => supportedLanguages.has(language))
})
const ignoredLanguageSet = computed(() => new Set(ignoredLanguages.value))

function getLanguageName(code) {
  const name = displayNames.value.of(code)
  return name && name !== code ? name : code
}

const availableLanguages = computed(() => COMMENT_TRANSLATION_LANGUAGE_CODES
  .filter(code => code !== appLanguage.value && !ignoredLanguageSet.value.has(code))
  .map(code => ({ code, name: getLanguageName(code) }))
  .sort((a, b) => languageCollator.value.compare(a.name, b.name)))

const languageValues = computed(() => ['', ...availableLanguages.value.map(({ code }) => code)])
const languageNames = computed(() => [
  t('Settings.General Settings.Comment Translation.Choose Language'),
  ...availableLanguages.value.map(({ name }) => name),
])

const selectedLanguages = computed(() => ignoredLanguages.value
  .filter(code => code !== appLanguage.value)
  .map(code => ({ code, name: getLanguageName(code) }))
  .sort((a, b) => languageCollator.value.compare(a.name, b.name)))

function addLanguage(language) {
  if (language === '' || ignoredLanguageSet.value.has(language)) return
  store.dispatch('updateCommentTranslationIgnoredLanguages', [
    ...ignoredLanguages.value,
    language,
  ])
}

function removeLanguage(language) {
  store.dispatch(
    'updateCommentTranslationIgnoredLanguages',
    ignoredLanguages.value.filter(code => code !== language)
  )
}
</script>

<style scoped src="./TranslationSettings.css" />
