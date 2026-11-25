import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../store/index'
import { shouldOfferCommentTranslation } from '../helpers/comment-translations'
import { normalizeYouTubeCaptionLanguageCode } from '../helpers/player/youtubeCaptionLanguages'
import { showApiErrorToast } from '../helpers/utils'

/**
 * The settings shared by the translations of comments, descriptions and posts.
 */
export function useTextTranslationSettings() {
  const { locale } = useI18n()

  const enabled = computed(() => !!process.env.SUPPORTS_LOCAL_API && store.getters.getEnableCommentTranslations)

  const targetLanguage = computed(() => normalizeYouTubeCaptionLanguageCode(locale.value))

  const targetLanguageName = computed(() => {
    const language = targetLanguage.value
    if (!language) return locale.value
    return new Intl.DisplayNames([locale.value, 'en'], { type: 'language' }).of(language) ?? language
  })

  /** @type {import('vue').ComputedRef<string[]>} */
  const ignoredLanguages = computed(() => {
    const languages = store.getters.getCommentTranslationIgnoredLanguages
    return Array.isArray(languages) ? languages : []
  })

  return { enabled, targetLanguage, targetLanguageName, ignoredLanguages }
}

/**
 * Offers a translation of plain text, such as a description or post, when it
 * is in a language other than the app language and the ignored ones.
 * @param {() => string} getText
 */
export function useTextTranslation(getText) {
  const { t } = useI18n()
  const { enabled, targetLanguage, targetLanguageName, ignoredLanguages } = useTextTranslationSettings()

  const available = ref(false)
  const loading = ref(false)
  const showTranslation = ref(false)
  /** @type {import('vue').ShallowRef<{ source: string, language: string, text: string } | null>} */
  const translation = shallowRef(null)
  let detectionGeneration = 0

  watch([getText, targetLanguage, ignoredLanguages, enabled], async ([text, language, ignored, isEnabled], previous) => {
    const generation = ++detectionGeneration
    available.value = false
    if (previous && previous[0] !== text) showTranslation.value = false
    if (!isEnabled || !language || text.trim() === '') return

    try {
      const offer = await shouldOfferCommentTranslation(text, language, ignored)
      if (generation === detectionGeneration) available.value = offer
    } catch (error) {
      console.error('Text language detection failed', error)
    }
  }, { immediate: true })

  /** The translated plain text while it is shown, otherwise `null`. */
  const translatedText = computed(() => {
    const current = translation.value
    if (!available.value || !showTranslation.value || current === null) return null
    if (current.language !== targetLanguage.value || current.source !== getText()) return null
    return current.text
  })

  async function toggleTranslation() {
    if (translatedText.value !== null) {
      showTranslation.value = false
      return
    }

    const source = getText()
    const language = targetLanguage.value
    if (translation.value?.source === source && translation.value.language === language) {
      showTranslation.value = true
      return
    }
    if (loading.value) return

    loading.value = true
    try {
      // Loaded on demand, as most pages never translate anything.
      const { translateDescriptionText } = await import('../helpers/api/local')
      const text = await translateDescriptionText(source, language)
      translation.value = { source, language, text }
      // The text may have changed meanwhile, in which case the translation stays hidden.
      showTranslation.value = getText() === source
    } catch (error) {
      console.error(error)
      showApiErrorToast(t('Text Translation.Translation failed'), error)
    } finally {
      loading.value = false
    }
  }

  return { available, loading, translatedText, targetLanguageName, toggleTranslation }
}
