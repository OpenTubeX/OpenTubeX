import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_APP_FONT,
  normalizeAppFont
} from '../../src/renderer/helpers/appFont.js'

test('falls back from invalid app font settings', () => {
  assert.equal(normalizeAppFont(null), DEFAULT_APP_FONT)
  assert.equal(normalizeAppFont(''), DEFAULT_APP_FONT)
  assert.equal(normalizeAppFont('Invalid\nFont'), DEFAULT_APP_FONT)
  assert.equal(normalizeAppFont('a'.repeat(201)), DEFAULT_APP_FONT)
})
