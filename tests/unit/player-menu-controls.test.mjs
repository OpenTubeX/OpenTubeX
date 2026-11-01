import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { load } from 'js-yaml'

import {
  PLAYER_MENU_CONTROL_DEFINITIONS,
  getDefaultPlayerMenuControls,
  getPlayerMenuControlDefinitions,
  normalizeHiddenPlayerMenuControls,
  normalizePlayerMenuControls,
  withoutControlBarButtons,
} from '../../src/renderer/helpers/playerMenuControls.js'

const faIconMap = JSON.parse(readFileSync(new URL('../../src/renderer/icons/faIconMap.json', import.meta.url), 'utf8'))

test('defaults keep the menu order each platform had', () => {
  assert.deepEqual(getDefaultPlayerMenuControls(false).slice(0, 7), [
    'audioTracks', 'captions', 'playbackRate', 'quality', 'sleepTimer', 'autoplay', 'seekHistory',
  ])
  assert.deepEqual(getDefaultPlayerMenuControls(true).slice(0, 8), [
    'quality', 'playbackRate', 'captions', 'audioTracks', 'sleepTimer', 'seekHistory', 'autoplay', 'chapters',
  ])
  for (const mobile of [false, true]) {
    assert.deepEqual(normalizePlayerMenuControls(null, mobile), getDefaultPlayerMenuControls(mobile))
    assert.equal(new Set(getDefaultPlayerMenuControls(mobile)).size, PLAYER_MENU_CONTROL_DEFINITIONS.length)
  }
})

test('keeps a custom order and adds missing controls after their default neighbor', () => {
  const order = normalizePlayerMenuControls(['loop', 'unknown', 'loop', 'audioTracks', 1], false)
  assert.deepEqual(order.slice(0, 7), ['loop', 'abRepeat', 'screenshot', 'pictureInPicture', 'theatreMode', 'fullWindow', 'audioTracks'])
  assert.equal(order.at(-1), 'monoAudio')
  assert.deepEqual([...order].sort(), getDefaultPlayerMenuControls(false).sort())
})

test('hides only known controls without a setting of their own', () => {
  assert.deepEqual(normalizeHiddenPlayerMenuControls(null), [])
  assert.deepEqual(normalizeHiddenPlayerMenuControls(['ambientMode', 'unknown', 'lightsOff', 'ambientMode', 'sleepTimer']), ['ambientMode', 'sleepTimer'])
})

test('controls on the control bar are never hidden', () => {
  assert.deepEqual(withoutControlBarButtons(['quality', 'captions', 'ambientMode'], ['quality', 'captions', 'menu']), ['ambientMode'])
})

test('each platform offers only the controls its player has', () => {
  const ids = (mobile, ios) => getPlayerMenuControlDefinitions(mobile, ios).map(({ id }) => id)
  assert.equal(ids(false, false).length, PLAYER_MENU_CONTROL_DEFINITIONS.length)
  assert.equal(ids(true, false).includes('theatreMode'), false)
  assert.equal(ids(true, false).includes('volumeBoost'), true)
  for (const id of ['skipSilence', 'voiceOverTranslation', 'volumeBoost', 'monoAudio', 'fullWindow']) {
    assert.equal(ids(true, true).includes(id), false, id)
  }
})

test('every player menu control has a registered icon and English and German labels', () => {
  for (const locale of ['en-US', 'de-DE']) {
    const messages = load(readFileSync(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    for (const { id, labelKey, icon } of PLAYER_MENU_CONTROL_DEFINITIONS) {
      assert.ok(faIconMap[icon[1]], `${id}: ${icon[1]}`)
      assert.equal(typeof labelKey.split('.').reduce((value, key) => value?.[key], messages), 'string', `${locale}: ${id}`)
    }
  }
})
