import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getThumbnailGridStyles,
  getThumbnailListStyles
} from '../../src/renderer/constants/thumbnailSize.js'

test('scales YouTube-style Shorts cards with the thumbnail size setting', () => {
  assert.equal(
    getThumbnailGridStyles(60)['--shorts-thumbnail-grid-min-size'],
    '114px'
  )
  assert.equal(
    getThumbnailGridStyles(100)['--shorts-thumbnail-grid-min-size'],
    '190px'
  )
  assert.equal(
    getThumbnailGridStyles(180)['--shorts-thumbnail-grid-min-size'],
    '342px'
  )
})

// Only the grid properties depend on the measured grid width; keeping the list
// ones separate is what lets them live on the document body.
test('keeps the grid and list properties separate', () => {
  assert.deepEqual(Object.keys(getThumbnailGridStyles(100, 800)), [
    '--thumbnail-grid-size',
    '--shorts-thumbnail-grid-min-size'
  ])
  assert.deepEqual(getThumbnailListStyles(50), {
    '--thumbnail-list-size': '168px',
    '--thumbnail-list-max-size': '12.5vw',
    '--thumbnail-list-mobile-max-size': '15vw'
  })
})
