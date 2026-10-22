import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { load } from 'js-yaml'

import {
  CONTROL_BAR_BUTTON_DEFINITIONS,
  getControlBarButtonDefinitions,
  getDefaultControlBarButtons,
  getPreviewMenuControlBarButtons,
  getRemovedControlBarButtons,
  normalizeControlBarButtons,
} from '../../src/renderer/helpers/controlBarButtons.js'

const faIconMap = JSON.parse(readFileSync(new URL('../../src/renderer/icons/faIconMap.json', import.meta.url), 'utf8'))

test('defaults match the control bar of each platform', () => {
  assert.deepEqual(getDefaultControlBarButtons(false), [
    'autoplay', 'captions', 'menu', 'pictureInPicture', 'theatreMode', 'fullWindow', 'fullscreen',
  ])
  assert.deepEqual(getDefaultControlBarButtons(true), ['captions', 'pictureInPicture', 'menu', 'fullscreen'])
  for (const mobile of [false, true]) {
    assert.deepEqual(normalizeControlBarButtons(null, mobile), getDefaultControlBarButtons(mobile))
    assert.deepEqual(normalizeControlBarButtons({}, mobile), getDefaultControlBarButtons(mobile))
  }
})

test('mobile only offers the buttons of its compact control bar', () => {
  assert.deepEqual(getControlBarButtonDefinitions(true).map(({ id }) => id), ['captions', 'menu', 'pictureInPicture', 'fullscreen'])
  assert.deepEqual(getControlBarButtonDefinitions(false).map(({ id }) => id), CONTROL_BAR_BUTTON_DEFINITIONS.map(({ id }) => id))
  assert.deepEqual(normalizeControlBarButtons(['fullscreen', 'theatreMode', 'menu', 'autoplay'], true), ['fullscreen', 'menu'])
})

test('the player menu offers the buttons that are not on the full control bar', () => {
  assert.deepEqual(getRemovedControlBarButtons(getDefaultControlBarButtons(false), false), [])
  assert.deepEqual(getRemovedControlBarButtons(['captions', 'menu', 'fullscreen'], false), ['autoplay', 'pictureInPicture', 'theatreMode', 'fullWindow'])
  // Capacitor tablets and TVs use the full control bar with the compact buttons,
  // and have no full-window mode
  assert.deepEqual(getRemovedControlBarButtons(getDefaultControlBarButtons(true), true), ['autoplay', 'theatreMode'])
})

test('the customizer previews the removed buttons that the player menu offers', () => {
  // Desktop: every removed button except captions and fullscreen, as before
  assert.deepEqual(getPreviewMenuControlBarButtons(['menu'], false), ['autoplay', 'pictureInPicture', 'theatreMode', 'fullWindow'])
  assert.deepEqual(getPreviewMenuControlBarButtons(getDefaultControlBarButtons(false), false), [])
  // Capacitor: autoplay is in the menu of phones and of wide players
  assert.deepEqual(getPreviewMenuControlBarButtons(getDefaultControlBarButtons(true), true), ['autoplay'])
  assert.deepEqual(getPreviewMenuControlBarButtons(['menu'], true), ['autoplay', 'pictureInPicture'])
})

test('keeps a custom order, discards invalid entries and always keeps the menu', () => {
  assert.deepEqual(normalizeControlBarButtons(['fullscreen', null, 'captions', 'fullscreen', 'unknown', 1, 'menu'], false), ['fullscreen', 'captions', 'menu'])
  assert.deepEqual(normalizeControlBarButtons(['fullscreen'], false), ['fullscreen', 'menu'])
  assert.deepEqual(normalizeControlBarButtons([], true), ['menu'])
})

test('every control bar button has a registered icon and English and German labels', () => {
  for (const locale of ['en-US', 'de-DE']) {
    const messages = load(readFileSync(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    for (const { id, labelKey, icon } of CONTROL_BAR_BUTTON_DEFINITIONS) {
      assert.ok(faIconMap[icon[1]], `${id}: ${icon[1]}`)
      assert.equal(typeof labelKey.split('.').reduce((value, key) => value?.[key], messages), 'string', `${locale}: ${labelKey}`)
    }
  }
})
