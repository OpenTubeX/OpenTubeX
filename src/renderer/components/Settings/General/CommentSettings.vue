<template>
  <FtSettingsSection
    :title="t('Comments.Comments')"
  >
    <div class="commentSettings">
      <!-- Side by side when there is room, like the general switches. -->
      <div
        class="commentSwitches"
        :class="{ 'switchColumnGrid switchFlowGrid': canNotifyReplies }"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Auto Load Comments.Label')"
          :default-value="store.getters.getAutoLoadComments"
          setting-key="autoLoadComments"
          :compact="true"
          :tooltip="t('Settings.General Settings.Auto Load Comments.Tooltip')"
          @change="store.dispatch('updateAutoLoadComments', $event)"
        />
        <FtToggleSwitch
          v-if="canNotifyReplies"
          :label="t('Settings.General Settings.Reply Notifications')"
          :default-value="store.getters.getCommentReplyNotifications"
          setting-key="commentReplyNotifications"
          :compact="true"
          :tooltip="t('Tooltips.General Settings.Reply Notifications')"
          @change="updateReplyNotifications"
        />
      </div>
      <FtButton
        v-if="canNotifyReplies && store.getters.getCommentReplyNotifications"
        :label="t('Settings.General Settings.Watched Comments')"
        :icon="['fas', 'bell']"
        @click="watchedCommentsOpen = true"
      />
    </div>
    <div
      v-if="SUPPORTS_LOCAL_API"
      class="commentSettings"
    >
      <FtToggleSwitch
        :label="t('Settings.General Settings.Comment Translation.Enable')"
        :default-value="commentTranslationsEnabled"
        setting-key="enableCommentTranslations"
        :compact="true"
        @change="updateCommentTranslationsEnabled"
      />
      <p
        :id="descriptionId"
        class="commentTranslationDescription"
      >
        {{ t('Settings.General Settings.Comment Translation.Description') }}
      </p>
      <FtSelect
        class="commentTranslationLanguageSelect"
        :placeholder="t('Settings.General Settings.Comment Translation.Never Translate')"
        value=""
        setting-key="commentTranslationIgnoredLanguages"
        :select-names="languageNames"
        :select-values="languageValues"
        :describe-by-id="descriptionId"
        :disabled="!commentTranslationsEnabled"
        :icon="['fas', 'language']"
        :is-locale-selector="true"
        @change="addLanguage"
      />
      <ul
        v-if="selectedLanguages.length > 0"
        class="commentTranslationLanguages"
        :aria-label="t('Settings.General Settings.Comment Translation.Never Translate')"
      >
        <li
          v-for="language in selectedLanguages"
          :key="language.code"
          class="commentTranslationLanguage"
        >
          <bdi :lang="language.code">{{ language.name }}</bdi>
          <button
            type="button"
            class="commentTranslationLanguageRemove"
            :disabled="!commentTranslationsEnabled"
            :aria-label="t('Settings.General Settings.Comment Translation.Remove Language', { language: language.name })"
            :title="t('Settings.General Settings.Comment Translation.Remove Language', { language: language.name })"
            @click="removeLanguage(language.code)"
          >
            <FtIcon :icon="['fas', 'xmark']" />
          </button>
        </li>
      </ul>
    </div>
    <WatchedCommentsPrompt
      v-if="watchedCommentsOpen"
      @close="watchedCommentsOpen = false"
    />
  </FtSettingsSection>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import WatchedCommentsPrompt from './WatchedCommentsPrompt.vue'

import {
  COMMENT_TRANSLATION_LANGUAGE_CODES,
  normalizeCommentTranslationLanguageCode,
} from '../../../helpers/comment-translations'
import { supportsNotificationHistory } from '../../../helpers/notificationHistory'
import { requestCapacitorNotificationPermission } from '../../../helpers/platformFeed'
import store from '../../../store/index'

const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API

const { locale, t } = useI18n()
const watchedCommentsOpen = ref(false)
const canNotifyReplies = computed(() => supportsNotificationHistory && store.getters.getNotificationMode !== 'off')
const descriptionId = useId()
const commentTranslationsEnabled = computed(() => store.getters.getEnableCommentTranslations)

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

/** @param {boolean} value */
function updateReplyNotifications(value) {
  store.dispatch('updateCommentReplyNotifications', value)
  if (process.env.IS_CAPACITOR && value) requestCapacitorNotificationPermission()
}

function updateCommentTranslationsEnabled(value) {
  store.dispatch('updateEnableCommentTranslations', value)
}
</script>

<style scoped src="./CommentSettings.css" />
