import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatCommentTranslation,
  requestCommentTranslation,
  shouldOfferCommentTranslation,
  terminateCommentTranslationLanguageDetector,
  translateTextKeepingLayout,
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

test('requests a translation with sanitized text', async () => {
  const requests = []
  const translatedText = await requestCommentTranslation(
    'Danke 💗\nनमस्ते',
    'en',
    async (text, targetLanguage) => {
      requests.push({ text, targetLanguage })
      return { translated_content: 'Thanks' }
    }
  )

  assert.equal(translatedText, 'Thanks')
  assert.deepEqual(requests, [{ text: 'Danke  नमस्ते', targetLanguage: 'en' }])
})

test('escapes translated markup and links translated URLs', () => {
  const formatted = formatCommentTranslation('<script>alert(1)</script> https://example.com')

  assert.equal(formatted.includes('<script>'), false)
  assert.match(formatted, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(formatted, /<a href="https:\/\/example\.com"/)
})

test('translates descriptions line by line, keeping blank lines and links', async () => {
  const requests = []
  const translated = await translateTextKeepingLayout(
    'Hallo zusammen!\n\n0:00 Einleitung\nRezept: https://example.com/rezept #brot @kanal\n',
    async (text) => {
      requests.push(text)
      // The service translates the words in links and adds blank lines.
      return 'Hello everyone!\n\n0:00 Introduction\n\nRecipe: https://example.com/recipe #bread @channel'
    }
  )

  assert.deepEqual(requests, ['Hallo zusammen!\n0:00 Einleitung\nRezept: https://example.com/rezept #brot @kanal'])
  assert.equal(translated, 'Hello everyone!\n\n0:00 Introduction\nRecipe: https://example.com/rezept #brot @kanal\n')
})

test('keeps merged translated lines and only restores links it can match', async () => {
  const translated = await translateTextKeepingLayout(
    'Erste Zeile\nzweite Zeile https://example.com/a',
    async () => 'First line, second line https://example.com/b'
  )
  assert.equal(translated, 'First line, second line https://example.com/a')

  await assert.rejects(translateTextKeepingLayout('Text', async () => ' '))
})

test('ignores URLs when detecting the language', async () => {
  const description = [
    'Heute backen wir Brot.',
    'https://example.com/how-to-bake-bread-at-home',
    'https://shop.example.com/products/best-flour-for-baking',
    'https://example.com/the-ultimate-sourdough-starter-guide',
  ].join('\n')
  assert.equal(await shouldOfferCommentTranslation(description, 'en'), true)
})
