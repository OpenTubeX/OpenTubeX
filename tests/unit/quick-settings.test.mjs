import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_QUICK_SETTINGS,
  normalizeQuickSettings,
} from '../../src/renderer/helpers/quickSettings.js'

test('keeps valid quick settings in the selected order', () => {
  assert.deepEqual(
    normalizeQuickSettings(['useProxy', 'baseTheme', 'hideComments']),
    ['useProxy', 'baseTheme', 'hideComments']
  )
})

test('removes unknown setting identifiers and duplicates', () => {
  assert.deepEqual(
    normalizeQuickSettings(['useProxy', 'musicMode', 'removedSetting', 'useProxy']),
    ['useProxy']
  )
})

test('falls back to defaults only when the stored value is invalid', () => {
  assert.deepEqual(normalizeQuickSettings(null), DEFAULT_QUICK_SETTINGS)
  assert.deepEqual(normalizeQuickSettings([]), [])
})
