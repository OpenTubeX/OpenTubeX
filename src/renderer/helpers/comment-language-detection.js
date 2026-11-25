const MIN_LANGUAGE_SCORE_MARGIN = 0.3
// eld calls a result unreliable below 75% of the language's average score by
// default, which rejects most real Korean text: names and a few English words
// keep it well below that average. The margin against the target language
// still keeps ambiguous text button-free.
const MIN_RELIABILITY_RATIO = 0.5

const CJK_CHARACTERS = String.raw`\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\u3000-\u303F\uFF00-\uFFEF`
/**
 * A URL in text, without sentence punctuation after it. URLs may contain
 * letters like `ü`, but end at CJK text, which these languages write right
 * after a URL and which URLs usually percent-encode.
 */
export const URL_PATTERN_SOURCE = String.raw`\b(?:https?:\/\/|www\.)[^\s${CJK_CHARACTERS}]*[^\s.,;:!?'")\]${CJK_CHARACTERS}]`
// URLs, domains without a scheme, `@handles` and `#hashtags`, which are mostly
// Latin and would outweigh short text in other scripts.
const IGNORED_FOR_DETECTION_PATTERN = new RegExp([
  String.raw`(?:^|\s)@\S+`,
  URL_PATTERN_SOURCE,
  String.raw`(?<![\p{L}\p{N}_@.])(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}\b(?:\/[^\s${CJK_CHARACTERS}]*)?`,
  String.raw`(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+`,
].join('|'), 'gu')
const LATIN_WORD_PATTERN = /[\p{scx=Latin}\p{M}\p{N}_'’-]*\p{scx=Latin}[\p{scx=Latin}\p{M}\p{N}_'’-]*/gu
const NON_LATIN_LETTER_PATTERN = /[^\P{L}\p{scx=Latin}]/gu
// About a short sentence in Korean, so that a single foreign word in an
// English comment doesn't offer a translation.
const MIN_NON_LATIN_LETTERS = 12

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

  const normalizedIgnoredLanguages = new Set(
    ignoredLanguages.map(normalizeCommentTranslationLanguageCode)
  )
  const offersTranslation = (detectedText) => {
    const result = detector.detect(detectedText)
    if (
      !result.language ||
      !result.isReliable(MIN_RELIABILITY_RATIO) ||
      result.language === normalizedTarget ||
      normalizedIgnoredLanguages.has(result.language)
    ) {
      return false
    }

    const scores = result.getScores()
    return scores[result.language] - (scores[normalizedTarget] ?? 0) >= MIN_LANGUAGE_SCORE_MARGIN
  }

  const detectedText = text.replaceAll(IGNORED_FOR_DETECTION_PATTERN, ' ')
  if (offersTranslation(detectedText)) {
    return true
  }

  // Latin labels, names and brands can outweigh the actual text, such as a
  // Korean description with a list of social media links.
  const nonLatinText = detectedText.replaceAll(LATIN_WORD_PATTERN, ' ')
  return nonLatinText !== detectedText &&
    (nonLatinText.match(NON_LATIN_LETTER_PATTERN)?.length ?? 0) >= MIN_NON_LATIN_LETTERS &&
    offersTranslation(nonLatinText)
}
