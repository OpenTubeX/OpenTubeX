import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatCommentTranslation,
  getCommentTranslationSource,
  shouldOfferCommentTranslation
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

test('keeps plain comment text as the translation source', () => {
  assert.equal(getCommentTranslationSource([
    { text: 'Hallo ' },
    { text: 'Welt' }
  ]), 'Hallo Welt')
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
