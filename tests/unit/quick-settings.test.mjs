import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { load } from 'js-yaml'

import {
  createQuickSettingSections,
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

test('localizes every quick setting, select option, and category in English and German', () => {
  for (const locale of ['en-US', 'de-DE']) {
    const messages = load(readFileSync(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    const translate = key => {
      const value = key.split('.').reduce((object, part) => object?.[part], messages)
      assert.equal(typeof value, 'string', `${locale}: ${key}`)
      assert.ok(value.length > 0, `${locale}: ${key}`)
      return value
    }
    const sections = createQuickSettingSections(translate, true)
    assert.ok(sections.some(section => section.id === 'privacy'))
    for (const setting of QUICK_SETTING_DEFINITIONS) {
      for (const key of setting.optionLabelKeys ?? []) translate(key)
    }
  }
})

test('gives every customizable setting an icon', () => {
  for (const setting of QUICK_SETTING_DEFINITIONS) {
    assert.equal(Array.isArray(setting.icon) && setting.icon.length, 2, setting.id)
  }
})

test('uses the settings category icons for quick setting sections', () => {
  const sectionIcons = Object.fromEntries(
    createQuickSettingSections(key => key, true).map(section => [section.id, section.icon])
  )

  assert.deepEqual(sectionIcons, {
    appearance: ['fas', 'display'],
    playback: ['fas', 'circle-play'],
    content: ['fas', 'eye-slash'],
    language: ['fas', 'globe'],
    advanced: ['fas', 'flask'],
    'add-ons': ['fas', 'puzzle-piece'],
    privacy: ['fas', 'lock'],
  })
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
    normalizeQuickSettings(['useProxy', 'musicMode', 'removedSetting', 'useProxy']),
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


test('UI Scale and proxy are available in Android quick settings but not the web build', () => {
  const android = createQuickSettingSections(key => key, false, true).flatMap(section => section.settings)
  assert.ok(android.some(setting => setting.id === 'uiScale'))
  assert.ok(android.some(setting => setting.id === 'useProxy'))
  const web = createQuickSettingSections(key => key, false).flatMap(section => section.settings)
  assert.ok(!web.some(setting => setting.id === 'uiScale'))
  assert.ok(!web.some(setting => setting.id === 'useProxy'))
  assert.ok(!web.some(setting => setting.id === 'useAiSlopList'))
  assert.ok(android.some(setting => setting.id === 'useAiSlopList'))
})

test('iOS quick settings do not offer the unavailable proxy toggle', () => {
  const ios = createQuickSettingSections(key => key, false, true, true).flatMap(section => section.settings)
  assert.ok(ios.some(setting => setting.id === 'uiScale'))
  assert.ok(!ios.some(setting => setting.id === 'useProxy'))
})

test('keeps categories adjacent in first-seen order, preserving order within each category', () => {
  assert.deepEqual(
    normalizeQuickSettings(['hideComments', 'baseTheme', 'defaultQuality', 'listType', 'mainColor', 'hideComments']),
    ['hideComments', 'listType', 'baseTheme', 'mainColor', 'defaultQuality']
  )
})

test('adds a setting to its existing category instead of splitting the category', () => {
  assert.deepEqual(
    normalizeQuickSettings([...DEFAULT_QUICK_SETTINGS, 'iconPack']),
    [...DEFAULT_QUICK_SETTINGS.slice(0, 4), 'iconPack', ...DEFAULT_QUICK_SETTINGS.slice(4)]
  )
})

test('Android quick settings do not offer Remember Volume, which the mobile player ignores', () => {
  const android = createQuickSettingSections(key => key, false, true).flatMap(section => section.settings)
  assert.ok(!android.some(setting => setting.id === 'rememberVolume'))
  const desktop = createQuickSettingSections(key => key, true).flatMap(section => section.settings)
  assert.ok(desktop.some(setting => setting.id === 'rememberVolume'))
})

test('disables quick settings whose parent setting turns them off', () => {
  const definitions = new Map(QUICK_SETTING_DEFINITIONS.map(setting => [setting.id, setting]))
  assert.equal(definitions.get('loopShorts').disabledWhen({ useCustomShortsPlayer: false }), true)
  assert.equal(definitions.get('loopShorts').disabledWhen({ useCustomShortsPlayer: true }), false)
  assert.equal(definitions.get('hideSubscriptionsLive').disabledWhen({ hideLiveStreams: true }), true)
  assert.equal(definitions.get('enableSkipSilenceByDefault').disabledWhen({ showSkipSilenceButton: false }), true)
  assert.equal(definitions.get('hideSubscriptionsLive').effectiveValue({ hideLiveStreams: true, hideSubscriptionsLive: false }), true)
  assert.equal(definitions.get('toastPosition').effectiveValue({ toastPosition: 'middle' }), 'bottom-left')
})
