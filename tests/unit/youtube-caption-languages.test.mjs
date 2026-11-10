import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeYouTubeCaptionLanguageCode } from '../../src/renderer/helpers/player/youtubeCaptionLanguages.js'

test('normalizes legacy regional caption preferences to YouTube language codes', () => {
  assert.equal(normalizeYouTubeCaptionLanguageCode('en-US'), 'en')
  assert.equal(normalizeYouTubeCaptionLanguageCode('de-DE'), 'de')
  assert.equal(normalizeYouTubeCaptionLanguageCode('es-AR'), 'es')
  assert.equal(normalizeYouTubeCaptionLanguageCode('pt-BR'), 'pt')
  assert.equal(normalizeYouTubeCaptionLanguageCode('zh-CN'), 'zh-Hans')
  assert.equal(normalizeYouTubeCaptionLanguageCode('zh-TW'), 'zh-Hant')
  assert.equal(normalizeYouTubeCaptionLanguageCode('nb-NO'), 'no')
  assert.equal(normalizeYouTubeCaptionLanguageCode('nn'), 'no')
})
