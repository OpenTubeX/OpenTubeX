import assert from 'node:assert/strict'
import test from 'node:test'

import { THEME_BG_COLOR, THEME_TEXT_COLOR } from '../../src/constants.js'
import {
  getProfileSyncSignature,
  getMergedProfileBackground,
  getMergedProfileTextColor,
  getSyncProfileBackground,
  getSyncProfileTextColor
} from '../../src/renderer/helpers/profile-sync.js'

test('syncs an opaque fallback for transparent profile backgrounds', () => {
  assert.equal(getSyncProfileBackground('transparent'), '#000000')
  assert.equal(getSyncProfileBackground('transparent', 'transparent'), '#000000')
  assert.equal(getSyncProfileBackground('transparent', '#123456'), '#123456')
  assert.equal(getSyncProfileBackground(null, null), '#000000')
  assert.equal(getSyncProfileBackground('#123456'), '#123456')
})

test('keeps transparency whenever the local image is retained', () => {
  const imageProfile = {
    bgColor: 'transparent',
    icon: { type: 'image', value: 'data:image/webp;base64,AA==' }
  }

  assert.equal(getMergedProfileBackground(imageProfile, '#000000'), 'transparent')
  assert.equal(getMergedProfileBackground(imageProfile, '#123456'), 'transparent')
  assert.equal(getMergedProfileBackground({ bgColor: 'transparent' }, '#000000'), '#000000')
})

test('syncs a concrete color instead of the theme color placeholders', () => {
  assert.equal(getSyncProfileBackground(THEME_BG_COLOR), '#000000')
  assert.equal(getSyncProfileBackground(THEME_BG_COLOR, THEME_BG_COLOR), '#000000')
  assert.equal(getSyncProfileBackground(THEME_BG_COLOR, '#123456'), '#123456')

  assert.equal(getSyncProfileTextColor(THEME_TEXT_COLOR), '#FFFFFF')
  assert.equal(getSyncProfileTextColor(THEME_TEXT_COLOR, THEME_TEXT_COLOR), '#FFFFFF')
  assert.equal(getSyncProfileTextColor(THEME_TEXT_COLOR, '#123456'), '#123456')
  assert.equal(getSyncProfileTextColor('#123456'), '#123456')
})

test('keeps following the theme color when a synced color comes back', () => {
  const themeProfile = { bgColor: THEME_BG_COLOR }

  assert.equal(getMergedProfileBackground(themeProfile, '#123456'), THEME_BG_COLOR)
  assert.equal(getMergedProfileTextColor(themeProfile, '#123456'), THEME_TEXT_COLOR)

  assert.equal(getMergedProfileBackground({ bgColor: '#abcdef' }, '#123456'), '#123456')
  assert.equal(getMergedProfileTextColor({ bgColor: '#abcdef' }, '#123456'), '#123456')
})


for (const subscriptions of [null, false, [null, false, 42, 'retained', {}, { id: 42 }, { id: '' }, { id: 'channel', unknown: new Date(1) }]]) {
  test(`profile sync signatures ignore opaque memberships without rewriting them: ${JSON.stringify(subscriptions)}`, () => {
    const profile = { _id: 'allChannels', subscriptions, unknown: new Date(2) }
    const before = structuredClone(profile)
    assert.equal(getProfileSyncSignature([profile]), JSON.stringify([['allChannels', Array.isArray(subscriptions) ? ['channel'] : []]]))
    assert.deepEqual(profile, before)
  })
}
