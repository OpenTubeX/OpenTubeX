import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getThumbnailSizeStyles
} from '../../src/renderer/constants/thumbnailSize.js'

test('scales YouTube-style Shorts cards with the thumbnail size setting', () => {
  assert.equal(
    getThumbnailSizeStyles(60)['--shorts-thumbnail-grid-min-size'],
    '114px'
  )
  assert.equal(
    getThumbnailSizeStyles(100)['--shorts-thumbnail-grid-min-size'],
    '190px'
  )
  assert.equal(
    getThumbnailSizeStyles(180)['--shorts-thumbnail-grid-min-size'],
    '342px'
  )
})
