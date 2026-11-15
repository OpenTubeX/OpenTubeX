const MIN_LANGUAGE_SCORE_MARGIN = 0.3

// Languages included in eld's extrasmall (XS60) detector. Keeping the list
// here lets Settings offer only languages that comment detection can identify.
export const COMMENT_TRANSLATION_LANGUAGE_CODES = Object.freeze([
  'am', 'ar', 'az', 'be', 'bg', 'bn', 'ca', 'cs', 'da', 'de',
  'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fr', 'gu', 'he',
  'hi', 'hr', 'hu', 'hy', 'is', 'it', 'ja', 'ka', 'kn', 'ko',
  'ku', 'lo', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no', 'or',
  'pa', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sq', 'sr', 'sv',
  'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yo', 'zh'
])

const COMMENT_TRANSLATION_LANGUAGE_CODE_SET = new Set(COMMENT_TRANSLATION_LANGUAGE_CODES)

/**
 * Normalize app locales and saved preferences to the codes used by eld.
 * @param {unknown} language
 * @returns {string}
 */
export function normalizeCommentTranslationLanguageCode(language) {
  if (typeof language !== 'string' || language === '') {
    return ''
  }

  const baseLanguage = language.split('-')[0]
  if (baseLanguage === 'nb' || baseLanguage === 'nn') {
    return 'no'
  }
  if (baseLanguage === 'fil') {
    return 'tl'
  }

  return baseLanguage
}

/**
 * @param {import('eld')} detector
 * @param {string} text
 * @param {string} targetLanguage
 * @param {string[]} ignoredLanguages
 * @returns {boolean}
 */
export function detectCommentTranslationAvailability(
  detector,
  text,
  targetLanguage,
  ignoredLanguages
) {
  if (!text.trim() || !targetLanguage) {
    return false
  }

  const normalizedTarget = normalizeCommentTranslationLanguageCode(targetLanguage)
  if (!COMMENT_TRANSLATION_LANGUAGE_CODE_SET.has(normalizedTarget)) {
    return false
  }

  const result = detector.detect(text.replaceAll(/(?:^|\s)@\S+/g, ' '))
  const normalizedIgnoredLanguages = new Set(
    ignoredLanguages.map(normalizeCommentTranslationLanguageCode)
  )
  if (
    !result.language ||
    !result.isReliable() ||
    result.language === normalizedTarget ||
    normalizedIgnoredLanguages.has(result.language)
  ) {
    return false
  }

  const scores = result.getScores()
  return scores[result.language] - (scores[normalizedTarget] ?? 0) >= MIN_LANGUAGE_SCORE_MARGIN
}
