import assert from 'node:assert/strict'
import test from 'node:test'

import { getBestQualityImageUrl } from '../../src/renderer/helpers/images.js'

test('returns an empty URL when no images are available', () => {
  assert.equal(getBestQualityImageUrl([]), '')
})

test('ignores malformed image arrays', () => {
  assert.equal(getBestQualityImageUrl(null), '')
  assert.equal(getBestQualityImageUrl({ url: 'not-an-array.jpg' }), '')
  assert.equal(getBestQualityImageUrl([null, {}, { width: 200 }, { url: 42 }]), '')
  assert.equal(getBestQualityImageUrl([null, { width: 200 }, { width: 'bad', url: 'fallback.jpg' }]), 'fallback.jpg')
})

test('returns a single raw image URL without rewriting it', () => {
  assert.equal(getBestQualityImageUrl([
    { width: 88, url: '//yt3.ggpht.com/channel-avatar' }
  ]), '//yt3.ggpht.com/channel-avatar')
})

test('returns the largest image URL without mutating the array', () => {
  const images = [
    { url: 'fallback.jpg' },
    { width: 88, url: 'small.jpg' },
    { width: '176', url: 'largest.jpg' },
    { width: 176, url: 'same-size.jpg' },
    { width: 'invalid', url: 'invalid-width.jpg' }
  ]
  const originalImages = structuredClone(images)

  assert.equal(getBestQualityImageUrl(images), 'largest.jpg')
  assert.deepEqual(images, originalImages)
})
