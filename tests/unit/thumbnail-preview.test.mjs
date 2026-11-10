import assert from 'node:assert/strict'
import test from 'node:test'

import { getThumbnailPreviewUrl } from '../../src/renderer/helpers/thumbnailPreview.js'

test('reads moving thumbnails from regular YouTube video results', () => {
  assert.equal(getThumbnailPreviewUrl({
    rich_thumbnail: [{
      url: 'https://i.ytimg.com/an_webp/video/mqdefault_6s.webp',
      width: 320,
      height: 180
    }]
  }), 'https://i.ytimg.com/an_webp/video/mqdefault_6s.webp')
})

test('reads moving thumbnails from YouTube lockup results', () => {
  assert.equal(getThumbnailPreviewUrl({
    content_image: {
      overlays: [{
        type: 'ThumbnailBottomOverlayView'
      }, {
        type: 'AnimatedThumbnailOverlayView',
        thumbnail: [{
          url: 'https://i.ytimg.com/an_webp/lockup/mqdefault_6s.webp'
        }]
      }]
    }
  }), 'https://i.ytimg.com/an_webp/lockup/mqdefault_6s.webp')
})

test('ignores video results without a usable moving thumbnail', () => {
  assert.equal(getThumbnailPreviewUrl(null), null)
  assert.equal(getThumbnailPreviewUrl({ rich_thumbnail: [] }), null)
  assert.equal(getThumbnailPreviewUrl({
    content_image: {
      overlays: [{
        type: 'AnimatedThumbnailOverlayView',
        thumbnail: [{}]
      }]
    }
  }), null)
})
