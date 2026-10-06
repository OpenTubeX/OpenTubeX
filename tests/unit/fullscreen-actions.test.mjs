import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { load } from 'js-yaml'

import {
  DEFAULT_FULLSCREEN_ACTIONS,
  FULLSCREEN_ACTION_DEFINITIONS,
  getAvailableFullscreenActions,
  normalizeFullscreenActions,
} from '../../src/renderer/helpers/fullscreenActions.js'

test('includes queue by default while leaving download and recommendations optional', () => {
  assert.deepEqual(DEFAULT_FULLSCREEN_ACTIONS, [
    'queue', 'playlist', 'liveChat', 'comments', 'sponsorBlock', 'transcript', 'share', 'addToPlaylist', 'quickBookmark',
  ])
  assert.deepEqual(normalizeFullscreenActions(null), DEFAULT_FULLSCREEN_ACTIONS)
  assert.deepEqual(normalizeFullscreenActions({}), DEFAULT_FULLSCREEN_ACTIONS)
})

test('keeps a custom order or an empty selection and discards invalid entries', () => {
  assert.deepEqual(normalizeFullscreenActions(['share', null, 'comments', 'share', 'unknown', 1]), ['share', 'comments'])
  assert.deepEqual(normalizeFullscreenActions([]), [])
  assert.deepEqual(normalizeFullscreenActions(['download', 'recommendations']), ['download', 'recommendations'])
})

test('unavailable actions leave no gaps and return in the selected order', () => {
  const selected = ['liveChat', 'share', 'comments', 'transcript']
  assert.deepEqual(getAvailableFullscreenActions(selected, { share: true, comments: true }), ['share', 'comments'])
  assert.deepEqual(getAvailableFullscreenActions(selected, { liveChat: true, share: true }), ['liveChat', 'share'])
  assert.deepEqual(getAvailableFullscreenActions(selected, {}), [])
  assert.deepEqual(selected, ['liveChat', 'share', 'comments', 'transcript'])
})

test('every fullscreen action has an icon and English and German labels', () => {
  for (const locale of ['en-US', 'de-DE']) {
    const messages = load(readFileSync(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    for (const { id, labelKey, icon } of FULLSCREEN_ACTION_DEFINITIONS) {
      assert.equal(icon.length, 2, id)
      assert.equal(typeof labelKey.split('.').reduce((value, key) => value?.[key], messages), 'string', `${locale}: ${labelKey}`)
    }
  }
})
