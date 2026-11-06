import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_APP_FONT,
  getAppFontFamily,
  normalizeAppFont,
  SYSTEM_APP_FONT
} from '../../src/renderer/helpers/appFont.js'

test('normalizes valid app font settings', () => {
  assert.equal(normalizeAppFont('  Noto Sans  '), 'Noto Sans')
  assert.equal(normalizeAppFont(SYSTEM_APP_FONT), SYSTEM_APP_FONT)
})

test('falls back from invalid app font settings', () => {
  assert.equal(normalizeAppFont(null), DEFAULT_APP_FONT)
  assert.equal(normalizeAppFont(''), DEFAULT_APP_FONT)
  assert.equal(normalizeAppFont('Invalid\nFont'), DEFAULT_APP_FONT)
  assert.equal(normalizeAppFont('a'.repeat(201)), DEFAULT_APP_FONT)
})

test('uses the operating system UI font stack for the system default', () => {
  assert.match(getAppFontFamily(SYSTEM_APP_FONT), /^system-ui, sans-serif/)
})

test('quotes selected font families safely', () => {
  assert.match(getAppFontFamily('Noto Sans'), /^"Noto Sans", system-ui/)
  assert.match(getAppFontFamily('Font "Name"'), /^"Font \\"Name\\"", system-ui/)
  assert.match(getAppFontFamily('Font\\Name'), /^"Font\\\\Name", system-ui/)
})
