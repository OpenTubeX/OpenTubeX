import Autolinker from 'autolinker'

import {
  detectCommentTranslationAvailability,
  URL_PATTERN_SOURCE,
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
 * @param {string} text
 * @returns {string}
 */
export function sanitizeCommentTranslationSource(text) {
  // InnerTube rejects emoji and other symbols with HTTP 400. Match the
  // character set used by youtubei.js' CommentView translation method, plus
  // combining marks, which many scripts such as Devanagari need. Line breaks
  // become spaces so that words on separate lines stay separate.
  return text.replaceAll(/\s/gu, ' ').replaceAll(/[^\p{L}\p{M}\p{N}\p{P}\p{Z}]/gu, '')
}

/**
 * @param {string} text
 * @param {string} targetLanguage
 * @param {(text: string, targetLanguage: string) => Promise<{translated_content: unknown}>} translate
 * @returns {Promise<string>}
 */
export async function requestCommentTranslation(text, targetLanguage, translate) {
  const source = sanitizeCommentTranslationSource(text)
  if (source.trim() === '') {
    return formatCommentTranslation(source)
  }

  const response = await translate(source, targetLanguage)
  return formatCommentTranslation(response.translated_content)
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

// URLs, e-mail addresses, `#hashtags` and `@handles`. The translation service
// translates the words in them too, which would break their links. Sentence
// punctuation after a handle stays outside of it.
const PROTECTED_TOKEN_PATTERN = new RegExp([
  URL_PATTERN_SOURCE,
  String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
  String.raw`(?<![\p{L}\p{N}_])[#@][\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?`,
].join('|'), 'gu')
// The service keeps numbered placeholders like `{0}` in place, even when it reorders the sentence.
const PLACEHOLDER_PATTERN = /\{(\d+)\}/g

/**
 * Translate multiline text, such as a description, keeping its links and,
 * unless the translation merges or splits lines, its blank lines, which the
 * translation service adds and drops at will.
 * @param {string} text
 * @param {(text: string) => Promise<string>} translate translates newline-separated lines
 * @returns {Promise<string>} plain text
 */
export async function translateTextKeepingLayout(text, translate) {
  const lines = text.split(/\r?\n/)
  const lineIndexes = lines.flatMap((line, index) => line.trim() === '' ? [] : [index])
  if (lineIndexes.length === 0) return text

  // Text that already contains placeholders is sent as is.
  const tokens = []
  const protect = !/\{\d+\}/.test(text)
  const sources = lineIndexes.map((index) => {
    const line = lines[index].trim()
    return protect ? line.replaceAll(PROTECTED_TOKEN_PATTERN, token => `{${tokens.push(token) - 1}}`) : line
  })

  const translated = (await translate(sources.join('\n'))).trim()
  if (translated === '') throw new Error('YouTube did not return a translation')

  const translatedLines = translated.split('\n').map(line => line.trim()).filter(line => line !== '')
  let result
  if (translatedLines.length === sources.length) {
    lineIndexes.forEach((lineIndex, index) => {
      lines[lineIndex] = /^\s*/.exec(lines[lineIndex])[0] + translatedLines[index]
    })
    result = lines.join('\n')
  } else {
    // Merged or split lines can no longer be matched to their source lines.
    result = translated
  }
  if (!protect) return result

  const restored = new Set()
  result = result.replaceAll(PLACEHOLDER_PATTERN, (placeholder, index, offset, string) => {
    const token = tokens[index]
    if (token === undefined) return placeholder
    restored.add(Number(index))
    // Keep words the translation attached directly, as in Japanese, out of the link.
    return /^[\p{L}\p{N}_]/u.test(string.slice(offset + placeholder.length)) ? `${token} ` : token
  })
  // Links the translation dropped are added at the end rather than lost.
  const dropped = tokens.filter((_token, index) => !restored.has(index))
  return dropped.length > 0 ? `${result} ${dropped.join(' ')}` : result
}
