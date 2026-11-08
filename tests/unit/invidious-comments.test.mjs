import assert from 'node:assert/strict'
import test from 'node:test'

import { getInvidiousCommentAuthorThumbnail } from '../../src/renderer/helpers/api/invidious-comments.js'

test('returns the Invidious comment author thumbnail', () => {
  assert.equal(getInvidiousCommentAuthorThumbnail({
    authorThumbnail: 'author.jpg'
  }), 'author.jpg')
})

test('returns the largest Invidious comment author thumbnail', () => {
  assert.equal(getInvidiousCommentAuthorThumbnail({
    authorThumbnails: [
      { url: 'small.jpg' },
      { url: 'large.jpg' }
    ]
  }), 'large.jpg')
})

test('handles Invidious comments without author thumbnails', () => {
  assert.equal(getInvidiousCommentAuthorThumbnail({}), null)
  assert.equal(getInvidiousCommentAuthorThumbnail({ authorThumbnails: [] }), null)
})
