import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getQuickBookmarkIconValue,
  QUICK_BOOKMARK_ICONS
} from '../../src/renderer/helpers/quickBookmarkIcons.js'

test('keeps supported built-in quick bookmark icons', () => {
  for (const icon of QUICK_BOOKMARK_ICONS) {
    assert.equal(getQuickBookmarkIconValue({ quickBookmarkIcon: icon }), icon)
  }
})

test('keeps valid custom quick bookmark icons', () => {
  const emoji = { type: 'emoji', value: '❤️‍🔥' }
  const image = { type: 'image', value: 'data:image/webp;base64,AA==' }

  assert.deepEqual(getQuickBookmarkIconValue({ quickBookmarkIcon: emoji }), emoji)
  assert.deepEqual(getQuickBookmarkIconValue({ quickBookmarkIcon: image }), image)
})

test('falls back for malformed or unsupported quick bookmark icons', () => {
  const invalidIcons = [
    undefined,
    'unknown',
    { type: 'emoji', value: '' },
    { type: 'image', value: 'https://example.com/icon.png' },
    { type: 'image', value: 'data:image/svg+xml;base64,PHN2Zy8+' }
  ]

  for (const quickBookmarkIcon of invalidIcons) {
    assert.equal(getQuickBookmarkIconValue({ quickBookmarkIcon }), 'bookmark')
  }
})
