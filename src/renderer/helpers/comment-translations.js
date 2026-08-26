import Autolinker from 'autolinker'

import {
  detectCommentTranslationAvailability,
} from './comment-language-detection.js'

export {
  COMMENT_TRANSLATION_LANGUAGE_CODES,
  normalizeCommentTranslationLanguageCode,
} from './comment-language-detection.js'

let languageDetectorPromise
let languageDetectorWorker
let nextLanguageDetectionId = 0
const pendingLanguageDetections = new Map()

async function getLanguageDetector() {
  languageDetectorPromise ??= import('eld/extrasmall').then(({ eld }) => eld)
  return await languageDetectorPromise
}

function getLanguageDetectorWorker() {
  if (languageDetectorWorker) return languageDetectorWorker

  languageDetectorWorker = new Worker(
    new URL('../workers/comment-language-detector.worker.js', import.meta.url),
    { type: 'module' }
  )
  languageDetectorWorker.addEventListener('message', ({ data }) => {
    const pending = pendingLanguageDetections.get(data.id)
    if (!pending) return

    pendingLanguageDetections.delete(data.id)
    if (data.error) {
      pending.reject(new Error(data.error))
    } else {
      pending.resolve(data.available === true)
    }
  })
  languageDetectorWorker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Comment language detection worker failed')
    for (const { reject } of pendingLanguageDetections.values()) {
      reject(error)
    }
    pendingLanguageDetections.clear()
    languageDetectorWorker?.terminate()
    languageDetectorWorker = undefined
  })

  return languageDetectorWorker
}

/**
 * Stop language detection and release the worker that owns the eld library.
 */
export function terminateCommentTranslationLanguageDetector() {
  languageDetectorWorker?.terminate()
  languageDetectorWorker = undefined

  for (const { resolve } of pendingLanguageDetections.values()) {
    resolve(false)
  }
  pendingLanguageDetections.clear()
}

/**
 * Only offer translation when local detection can confidently distinguish the
 * comment from the target language. Ambiguous and unsupported text stays
 * button-free instead of prompting for a translation it may not need.
 * @param {string} text
 * @param {string} targetLanguage
 * @param {string[]} [ignoredLanguages]
 * @returns {Promise<boolean>}
 */
export async function shouldOfferCommentTranslation(text, targetLanguage, ignoredLanguages = []) {
  if (typeof Worker === 'undefined') {
    const detector = await getLanguageDetector()
    return detectCommentTranslationAvailability(
      detector,
      text,
      targetLanguage,
      ignoredLanguages
    )
  }

  const id = ++nextLanguageDetectionId
  const worker = getLanguageDetectorWorker()
  return await new Promise((resolve, reject) => {
    pendingLanguageDetections.set(id, { resolve, reject })
    try {
      worker.postMessage({
        id,
        text,
        targetLanguage,
        ignoredLanguages: [...ignoredLanguages],
      })
    } catch (error) {
      pendingLanguageDetections.delete(id)
      reject(error)
    }
  })
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
