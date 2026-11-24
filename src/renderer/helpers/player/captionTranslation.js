import { isYouTubeSubtitleUrl } from '../../../youtubeSubtitle.js'

// A batch whose lines can't be mapped back is spread over its cues by length,
// so its size bounds how far the text can drift from the speech.
const MAX_BATCH_CHARACTERS = 1000
const MAX_PARALLEL_REQUESTS = 4
const MAX_CACHED_TRANSLATIONS = 8

/** @type {Map<string, Promise<string>>} */
const translations = new Map()

/**
 * YouTube refuses `tlang` caption requests without a signed-in account (HTTP 429),
 * so these are translated from the original track instead.
 * @param {string} url
 * @returns {string | null} the target language, `null` for other requests
 */
export function getCaptionTranslationLanguage(url) {
  if (!isYouTubeSubtitleUrl(url)) return null
  const params = new URL(url).searchParams
  const targetLanguage = params.get('tlang')
  if (!targetLanguage) return null
  // yt-dlp can name a translation after both languages, e.g. `de-en`
  const sourceSuffix = `-${params.get('lang')}`
  return targetLanguage.endsWith(sourceSuffix) && targetLanguage !== sourceSuffix.slice(1)
    ? targetLanguage.slice(0, -sourceSuffix.length)
    : targetLanguage
}

/**
 * @param {string} text
 * @returns {{ start: string, end: string, text: string }[]}
 */
export function parseSrt(text) {
  const cues = []
  for (const block of text.replace(/^\uFEFF/, '').split(/\r?\n(?:[ \t]*\r?\n)+/)) {
    const lines = block.trim().split(/\r?\n/)
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex === -1) continue
    const [start, end] = lines[timingIndex].split('-->').map(time => time.trim().split(/\s/)[0])
    cues.push({ start, end, text: lines.slice(timingIndex + 1).join(' ').trim() })
  }
  return cues
}

/**
 * @param {{ start: string, end: string, text: string }[]} cues
 * @param {'srt' | 'vtt'} format
 * @returns {string}
 */
export function serializeSubtitle(cues, format) {
  if (format === 'srt') {
    return cues.map((cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}\n`).join('\n')
  }
  const toVttTime = time => time.replace(',', '.')
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return 'WEBVTT\n\n' + cues.map(cue => `${toVttTime(cue.start)} --> ${toVttTime(cue.end)}\n${escape(cue.text)}\n`).join('\n')
}

const SENTENCE_END = /[.!?…。！？][\s"'”’»)\]]*$/u
// Unpunctuated captions are cut into pieces of about this length instead
const MAX_SENTENCE_CHARACTERS = 250

/**
 * Automatic captions split sentences across cues, and a translation joins
 * the fragments of a sentence again, so whole sentences are translated.
 * @param {string[]} texts
 * @returns {number[][]} the indices of each sentence's cues
 */
export function groupSentences(texts) {
  const sentences = []
  let sentence = []
  let length = 0
  texts.forEach((text, index) => {
    sentence.push(index)
    length += text.length + 1
    if (SENTENCE_END.test(text) || length >= MAX_SENTENCE_CHARACTERS) {
      sentences.push(sentence)
      sentence = []
      length = 0
    }
  })
  if (sentence.length > 0) sentences.push(sentence)
  return sentences
}

/**
 * Spreads a translated sentence over its cues in proportion to their original
 * lengths, giving every cue at least one word (or character, for scripts
 * written without spaces).
 * @param {string} text
 * @param {number[]} weights
 * @returns {string[]}
 */
export function distributeText(text, weights) {
  const trimmed = text.trim()
  const separator = /\s/.test(trimmed) ? ' ' : ''
  const units = separator ? trimmed.split(/\s+/) : Array.from(trimmed)
  if (units.length < weights.length) return weights.map((_, index) => index === 0 ? trimmed : '')

  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cumulative = 0
  let used = 0
  return weights.map((weight, index) => {
    cumulative += weight
    const remainingCues = weights.length - index - 1
    const end = index === weights.length - 1
      ? units.length
      : Math.min(Math.max(Math.round(units.length * cumulative / total), used + 1), units.length - remainingCues)
    const part = units.slice(used, end).join(separator)
    used = end
    return part
  })
}

/**
 * Translates caption cues a few sentences at a time.
 * @param {string[]} texts the cues' non-empty texts
 * @param {(text: string) => Promise<string>} translate
 * @returns {Promise<string[]>} the translated text of each cue, empty for cues the translation got too short for
 */
export async function translateCues(texts, translate) {
  const batches = [[]]
  let length = 0
  for (const sentence of groupSentences(texts)) {
    const sentenceLength = sentence.reduce((sum, index) => sum + texts[index].length + 1, 0)
    if (batches.at(-1).length > 0 && length + sentenceLength > MAX_BATCH_CHARACTERS) {
      batches.push([])
      length = 0
    }
    batches.at(-1).push(sentence)
    length += sentenceLength
  }

  const translated = [...texts]
  const translateBatch = async (sentences) => {
    const sources = sentences.map(indices => indices.map(index => texts[index]).join(' '))
    const lines = (await translate(sources.join('\n'))).split('\n').map(line => line.trim()).filter(line => line !== '')
    // Unpunctuated captions come back as one punctuated paragraph
    const parts = lines.length === sources.length
      ? sentences.flatMap((indices, sentenceIndex) => distributeText(lines[sentenceIndex], indices.map(index => texts[index].length)))
      : distributeText(lines.join(' '), sentences.flat().map(index => texts[index].length))
    if (parts.every(part => part === '')) return
    sentences.flat().forEach((index, partIndex) => { translated[index] = parts[partIndex] })
  }

  let next = 0
  const worker = async () => {
    while (next < batches.length) await translateBatch(batches[next++])
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, batches.length) }, worker))
  return translated
}

/**
 * Loads the untranslated track and translates its cues.
 * @param {string} url a translated YouTube caption URL
 * @param {string} targetLanguage
 * @param {(text: string, targetLanguage: string) => Promise<string>} translate
 * @param {typeof fetch} [fetchFunc]
 * @returns {Promise<string>} a data URL in the format the URL requested
 */
async function loadTranslatedCaption(url, targetLanguage, translate, fetchFunc) {
  const originalUrl = new URL(url)
  const format = originalUrl.searchParams.get('fmt') === 'srt' ? 'srt' : 'vtt'
  originalUrl.searchParams.delete('tlang')
  // YouTube's SRT holds each automatic caption line once, unlike its rolling WebVTT
  originalUrl.searchParams.set('fmt', 'srt')

  const response = await fetchFunc(originalUrl.toString())
  if (!response.ok) throw new Error(`Original captions request failed with HTTP ${response.status}`)
  const cues = parseSrt(await response.text())
  const translatable = cues.filter(cue => /[\p{L}\p{N}]/u.test(cue.text))
  if (translatable.length === 0) throw new Error('The original captions have no text to translate')

  const translated = await translateCues(translatable.map(cue => cue.text), text => translate(text, targetLanguage))
  translatable.forEach((cue, index) => { cue.text = translated[index] })

  const mimeType = format === 'srt' ? 'text/srt' : 'text/vtt'
  // A translation with fewer words than its sentence has cues leaves some of them empty
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(serializeSubtitle(cues.filter(cue => cue.text !== ''), format))}`
}

/**
 * Picking the same translation again, or as secondary captions, reuses the result.
 * @param {string} url a translated YouTube caption URL
 * @param {string} targetLanguage
 * @param {(text: string, targetLanguage: string) => Promise<string>} translate
 * @param {typeof fetch} [fetchFunc]
 * @returns {Promise<string>}
 */
export function getTranslatedCaptionUrl(url, targetLanguage, translate, fetchFunc = fetch) {
  let translation = translations.get(url)
  if (!translation) {
    translation = loadTranslatedCaption(url, targetLanguage, translate, fetchFunc)
    translations.set(url, translation)
    translation.catch(() => {
      if (translations.get(url) === translation) translations.delete(url)
    })
    if (translations.size > MAX_CACHED_TRANSLATIONS) {
      translations.delete(translations.keys().next().value)
    }
  }
  return translation
}
