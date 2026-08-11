import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMergedProfileBackground,
  getSyncProfileBackground
} from '../../src/renderer/helpers/profile-sync.js'

test('syncs an opaque fallback for transparent profile backgrounds', () => {
  assert.equal(getSyncProfileBackground('transparent'), '#000000')
  assert.equal(getSyncProfileBackground('transparent', 'transparent'), '#000000')
  assert.equal(getSyncProfileBackground(null, null), '#000000')
  assert.equal(getSyncProfileBackground('#123456'), '#123456')
})

test('keeps transparency only with an authoritative local image', () => {
  const imageProfile = {
    bgColor: 'transparent',
    icon: { type: 'image', value: 'data:image/webp;base64,AA==' }
  }

  assert.equal(getMergedProfileBackground(imageProfile, true, '#000000'), 'transparent')
  assert.equal(getMergedProfileBackground(imageProfile, false, '#123456'), '#123456')
  assert.equal(getMergedProfileBackground({ bgColor: 'transparent' }, true, '#000000'), '#000000')
})
