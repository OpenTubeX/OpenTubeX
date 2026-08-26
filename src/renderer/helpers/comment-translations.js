import Autolinker from 'autolinker'

const MIN_LANGUAGE_SCORE_MARGIN = 0.3
let languageDetectorPromise

function normalizeDetectedLanguageTarget(language) {
  const baseLanguage = language.split('-')[0]
  if (baseLanguage === 'nb' || baseLanguage === 'nn') {
    return 'no'
  }

  return baseLanguage
}

async function getLanguageDetector() {
  languageDetectorPromise ??= import('eld/extrasmall').then(({ eld }) => eld)
  return await languageDetectorPromise
}

/**
 * Only offer translation when local detection can confidently distinguish the
 * comment from the target language. Ambiguous and unsupported text stays
 * button-free instead of prompting for a translation it may not need.
 * @param {string} text
 * @param {string} targetLanguage
 * @returns {Promise<boolean>}
 */
export async function shouldOfferCommentTranslation(text, targetLanguage) {
  if (!text.trim() || !targetLanguage) {
    return false
  }

  const detector = await getLanguageDetector()
  const normalizedTarget = normalizeDetectedLanguageTarget(targetLanguage)
  const supportedLanguages = Object.values(detector.info().Languages)
  if (!supportedLanguages.includes(normalizedTarget)) {
    return false
  }

  const result = detector.detect(text.replaceAll(/(?:^|\s)@\S+/g, ' '))
  if (!result.language || !result.isReliable() || result.language === normalizedTarget) {
    return false
  }

  const scores = result.getScores()
  return scores[result.language] - (scores[normalizedTarget] ?? 0) >= MIN_LANGUAGE_SCORE_MARGIN
}

/**
 * Keep the text sent for translation separate from the rendered comment HTML.
 * @param {{text?: string}[]} runs
 * @returns {string}
 */
export function getCommentTranslationSource(runs) {
  return runs.map(run => run.text ?? '').join('')
}

/**
 * Escape translated text before adding links and passing it to the comment renderer.
 * @param {unknown} translatedText
 * @returns {string}
 */
export function formatCommentTranslation(translatedText) {
  if (typeof translatedText !== 'string' || translatedText.trim() === '') {
    throw new Error('YouTube did not return a comment translation')
  }

  const escapedText = translatedText
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

  return Autolinker.link(escapedText)
}
