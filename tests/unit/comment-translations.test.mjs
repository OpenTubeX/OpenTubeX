import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMMENT_TRANSLATION_LANGUAGE_CODES,
  formatCommentTranslation,
  getCommentTranslationSource,
  normalizeCommentTranslationLanguageCode,
  requestCommentTranslation,
  sanitizeCommentTranslationSource,
  shouldOfferCommentTranslation,
  terminateCommentTranslationLanguageDetector,
} from '../../src/renderer/helpers/comment-translations.js'

test('does not offer translation for the target language or ambiguous text', async () => {
  assert.equal(await shouldOfferCommentTranslation('This comment is already in English.', 'en'), false)
  assert.equal(await shouldOfferCommentTranslation('Das ist bereits ein deutscher Kommentar.', 'de'), false)
  assert.equal(await shouldOfferCommentTranslation('Cool', 'en'), false)
})

test('offers translation for a confidently detected different language', async () => {
  assert.equal(await shouldOfferCommentTranslation('Das ist ein deutscher Kommentar.', 'en'), true)
  assert.equal(await shouldOfferCommentTranslation('Este comentario está escrito en español.', 'en'), true)
})

test('does not offer translation for an ignored language', async () => {
  assert.equal(
    await shouldOfferCommentTranslation('Das ist ein deutscher Kommentar.', 'en', ['de']),
    false
  )
  assert.equal(
    await shouldOfferCommentTranslation('Este comentario está escrito en español.', 'en', ['de']),
    true
  )
})

test('normalizes app locales to supported comment detection languages', () => {
  assert.equal(normalizeCommentTranslationLanguageCode('de-DE'), 'de')
  assert.equal(normalizeCommentTranslationLanguageCode('nb-NO'), 'no')
  assert.equal(normalizeCommentTranslationLanguageCode('fil'), 'tl')
  assert.ok(COMMENT_TRANSLATION_LANGUAGE_CODES.includes('de'))
})

test('terminates in-flight language detection with its worker', async (t) => {
  const OriginalWorker = globalThis.Worker
  let worker

  class LanguageDetectorWorker {
    constructor() {
      this.listeners = new Map()
      this.terminated = false
      worker = this
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener)
    }

    postMessage() {}

    terminate() {
      this.terminated = true
    }
  }

  globalThis.Worker = LanguageDetectorWorker
  t.after(() => {
    terminateCommentTranslationLanguageDetector()
    globalThis.Worker = OriginalWorker
  })

  const detection = shouldOfferCommentTranslation(
    'Das ist ein deutscher Kommentar.',
    'en'
  )
  assert.equal(worker.terminated, false)

  terminateCommentTranslationLanguageDetector()

  assert.equal(worker.terminated, true)
  assert.equal(await detection, false)
})

test('keeps plain comment text as the translation source', () => {
  assert.equal(getCommentTranslationSource([
    { text: 'Hallo ' },
    { text: 'Welt' }
  ]), 'Hallo Welt')
})

test('removes characters rejected by YouTube comment translations', () => {
  assert.equal(
    sanitizeCommentTranslationSource('Thanks 💗 and 💙‼️'),
    'Thanks  and ‼'
  )
})

test('does not request a translation without supported text', async () => {
  let requestCount = 0

  await assert.rejects(
    requestCommentTranslation('💗💙', 'en', async () => {
      requestCount++
      return { translated_content: 'unused' }
    }),
    /YouTube did not return a comment translation/
  )
  assert.equal(requestCount, 0)
})

test('requests a translation with sanitized text', async () => {
  const requests = []
  const translatedText = await requestCommentTranslation(
    'Danke 💗',
    'en',
    async (text, targetLanguage) => {
      requests.push({ text, targetLanguage })
      return { translated_content: 'Thanks' }
    }
  )

  assert.equal(translatedText, 'Thanks')
  assert.deepEqual(requests, [{ text: 'Danke ', targetLanguage: 'en' }])
})

test('escapes translated markup and links translated URLs', () => {
  const formatted = formatCommentTranslation('<script>alert(1)</script> https://example.com')

  assert.equal(formatted.includes('<script>'), false)
  assert.match(formatted, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(formatted, /<a href="https:\/\/example\.com"/)
})

test('rejects an empty translation response', () => {
  assert.throws(
    () => formatCommentTranslation('  '),
    /YouTube did not return a comment translation/
  )
})
