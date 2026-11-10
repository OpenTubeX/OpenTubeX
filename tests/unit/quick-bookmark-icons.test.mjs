import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getQuickBookmarkIconValue
} from '../../src/renderer/helpers/quickBookmarkIcons.js'

test('falls back for malformed or unsupported quick bookmark icons', () => {
  const invalidIcons = [
    undefined,
    'unknown',
    { type: 'emoji', value: '' },
    { type: 'image', value: 'data:image/png;base64,' },
    { type: 'image', value: 'data:image/png;base64,not-base64' },
    { type: 'image', value: 'https://example.com/icon.png' },
    { type: 'image', value: 'data:image/svg+xml;base64,PHN2Zy8+' }
  ]

  for (const quickBookmarkIcon of invalidIcons) {
    assert.equal(getQuickBookmarkIconValue({ quickBookmarkIcon }), 'bookmark')
  }
})
