import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../../store/index'
import { translateCommentText } from '../../../helpers/api/local'
import { normalizeYouTubeCaptionLanguageCode } from '../../../helpers/player/youtubeCaptionLanguages'
import { showApiErrorToast } from '../../../helpers/utils'

/** @typedef {import('../../../helpers/api/local').LocalComment | import('../../../helpers/api/invidious').InvidiousComment} Comment */

/**
 * Translates comments and replies into the UI language on request.
 */
export function useCommentTranslation() {
  const { locale, t } = useI18n()
  const loadingTranslationIds = ref(new Set())

  const translationEnabled = computed(() => (
    process.env.SUPPORTS_LOCAL_API && store.getters.getEnableCommentTranslations
  ))

  const translationLanguage = computed(() => {
    return normalizeYouTubeCaptionLanguageCode(locale.value)
  })

  const translationLanguageName = computed(() => {
    const language = translationLanguage.value
    if (!language) {
      return locale.value
    }

    return new Intl.DisplayNames([locale.value, 'en'], { type: 'language' }).of(language) ?? language
  })

  const commentTranslationIgnoredLanguages = computed(() => {
    const languages = store.getters.getCommentTranslationIgnoredLanguages
    return Array.isArray(languages) ? languages : []
  })

  /**
   * @param {Comment} comment
   */
  async function toggleCommentTranslation(comment) {
    if (comment.showTranslated && comment.translatedLanguage === translationLanguage.value) {
      comment.showTranslated = false
      return
    }

    const targetLanguage = translationLanguage.value
    if (!targetLanguage || loadingTranslationIds.value.has(comment.id)) {
      return
    }

    if (comment.translatedText && comment.translatedLanguage === targetLanguage) {
      comment.showTranslated = true
      return
    }

    loadingTranslationIds.value = new Set(loadingTranslationIds.value).add(comment.id)

    try {
      comment.translatedText = await translateCommentText(comment.translationText, targetLanguage)
      comment.translatedLanguage = targetLanguage
      comment.showTranslated = true
    } catch (error) {
      console.error(error)
      showApiErrorToast(t('Comments.Comment translation failed'), error)
    } finally {
      const nextLoadingTranslationIds = new Set(loadingTranslationIds.value)
      nextLoadingTranslationIds.delete(comment.id)
      loadingTranslationIds.value = nextLoadingTranslationIds
    }
  }

  /**
   * @param {Comment} comment
   */
  function restoreCommentTranslation(comment) {
    comment.showTranslated = false
  }

  return {
    commentTranslationIgnoredLanguages,
    loadingTranslationIds,
    restoreCommentTranslation,
    toggleCommentTranslation,
    translationEnabled,
    translationLanguage,
    translationLanguageName
  }
}
