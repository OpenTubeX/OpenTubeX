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
  assert.equal(await shouldOfferCommentTranslation('Shoutout to my Korean friends 안녕하세요 여러분', 'en'), false)
})

test('offers translation for a confidently detected different language', async () => {
  assert.equal(await shouldOfferCommentTranslation('Das ist ein deutscher Kommentar.', 'en'), true)
  assert.equal(await shouldOfferCommentTranslation('Este comentario está escrito en español.', 'en'), true)
  // eld's default reliability threshold rejects most Korean text.
  assert.equal(await shouldOfferCommentTranslation('오늘의 주인공은 바로 나! 생일 축하해 줘서 고마워요', 'en'), true)
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
    'Hallo zusammen!\n\n0:00 Einleitung\nRezept: https://example.com/über-uns. #brot @kanal\n',
    async (text) => {
      requests.push(text)
      // The service adds blank lines.
      return 'Hello everyone!\n\n0:00 Introduction\n\nRecipe: {0}. {1} {2}'
    }
  )

  assert.deepEqual(requests, ['Hallo zusammen!\n0:00 Einleitung\nRezept: {0}. {1} {2}'])
  assert.equal(translated, 'Hello everyone!\n\n0:00 Introduction\nRecipe: https://example.com/über-uns. #brot @kanal\n')
})

test('restores links that the translation moved or attached words to', async () => {
  const translated = await translateTextKeepingLayout(
    'Folge @kanal und vergleiche https://example.com/a mit https://example.com/b',
    async () => '{0}をフォローして、{2}と{1}を比較してください。'
  )
  assert.equal(translated, '@kanal をフォローして、https://example.com/b とhttps://example.com/a を比較してください。')
})

test('ends URLs before Japanese text that follows them', async () => {
  const requests = []
  await translateTextKeepingLayout('詳しくは https://example.com/helpをご覧ください。', async (text) => {
    requests.push(text)
    return 'See {0} for details.'
  })
  assert.deepEqual(requests, ['詳しくは {0}をご覧ください。'])
})

test('detects the language of CJK text that follows a URL', async () => {
  assert.equal(await shouldOfferCommentTranslation('https://example.com/helpをご覧ください。詳しい説明はこちらです。', 'en'), true)
})

test('keeps merged lines and the links the translation dropped', async () => {
  const translated = await translateTextKeepingLayout(
    'Erste Zeile #eins\nzweite Zeile https://example.com/a',
    async () => 'First line {0}, second line'
  )
  assert.equal(translated, 'First line #eins, second line https://example.com/a')

  await assert.rejects(translateTextKeepingLayout('Text', async () => ' '))
})

test('ignores links, hashtags and Latin labels when detecting the language', async () => {
  const description = [
    'Heute backen wir Brot.',
    'https://example.com/how-to-bake-bread-at-home',
    'https://shop.example.com/products/best-flour-for-baking',
    'https://example.com/the-ultimate-sourdough-starter-guide',
  ].join('\n')
  assert.equal(await shouldOfferCommentTranslation(description, 'en'), true)

  const koreanDescription = [
    '새 노래 연습 영상을 지금 공개합니다',
    '#BAND #새노래',
    '[Example Band Official SNS]',
    '•Instagram : instagram.com/example_band',
    '•TikTok : tiktok.com/@example_band',
    '•Facebook : facebook.com/ExampleBand',
    '•Weibo : weibo.com/n/example_band',
  ].join('\n')
  assert.equal(await shouldOfferCommentTranslation(koreanDescription, 'en'), true)
})
