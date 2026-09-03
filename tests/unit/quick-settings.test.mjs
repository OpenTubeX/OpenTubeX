import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_QUICK_SETTINGS,
  isQuickSettingPaired,
  normalizeQuickSettings,
  QUICK_SETTING_DEFINITIONS,
} from '../../src/renderer/helpers/quickSettings.js'

test('keeps the original quick settings as defaults', () => {
  assert.deepEqual(DEFAULT_QUICK_SETTINGS, [
    'baseTheme',
    'mainColor',
    'uiScale',
    'thumbnailSize',
    'defaultQuality',
    'playNextVideo',
    'enableSubtitlesByDefault',
    'listType',
    'playlistViewType',
    'hideRecommendedVideos',
    'hideComments',
    'currentLocale',
    'region',
  ])
})

test('gives every customizable setting an icon', () => {
  for (const setting of QUICK_SETTING_DEFINITIONS) {
    assert.equal(Array.isArray(setting.icon) && setting.icon.length, 2, setting.id)
  }
})

test('pairs adjacent selects without leaving an odd select in a half-row', () => {
  const select = { control: 'select' }
  const toggle = { control: 'toggle' }

  assert.deepEqual(
    [select, select, toggle, select, select, select].map((_, index, settings) => (
      isQuickSettingPaired(settings, index)
    )),
    [true, true, false, true, true, false]
  )
})

test('keeps valid quick settings in the selected order', () => {
  assert.deepEqual(
    normalizeQuickSettings(['useProxy', 'baseTheme', 'hideComments']),
    ['useProxy', 'baseTheme', 'hideComments']
  )
})

test('removes unknown setting identifiers and duplicates', () => {
  assert.deepEqual(
    normalizeQuickSettings(['useProxy', 'removedSetting', 'useProxy']),
    ['useProxy']
  )
})

test('removes values that cannot identify a setting', () => {
  assert.deepEqual(normalizeQuickSettings(['baseTheme', '', null, 4]), ['baseTheme'])
})

test('falls back to defaults only when the stored value is invalid', () => {
  assert.deepEqual(normalizeQuickSettings(null), DEFAULT_QUICK_SETTINGS)
  assert.deepEqual(normalizeQuickSettings([]), [])
})
