import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeYouTubeCaptionLanguageCode,
  YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES,
} from '../../src/renderer/helpers/player/youtubeCaptionLanguages.js'

test('provides readable names when Intl.DisplayNames returns a language code', () => {
  assert.equal(YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES.aa, 'Afar')
  assert.equal(YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES.ab, 'Abkhazian')
  assert.equal(YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES.gaa, 'Ga')
  assert.equal(YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES.ga, 'Irish')
  assert.equal(YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES.ja, 'Japanese')
})

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

test('preserves current YouTube caption language codes', () => {
  assert.equal(normalizeYouTubeCaptionLanguageCode('fr'), 'fr')
  assert.equal(normalizeYouTubeCaptionLanguageCode('ja'), 'ja')
  assert.equal(normalizeYouTubeCaptionLanguageCode('zh-Hant'), 'zh-Hant')
  assert.equal(normalizeYouTubeCaptionLanguageCode(''), '')
})

test('falls back to the application language for malformed values', () => {
  assert.equal(normalizeYouTubeCaptionLanguageCode('not_a_locale'), '')
})
