import assert from 'node:assert/strict'
import test from 'node:test'

import { getInvidiousCommentAuthorThumbnail } from '../../src/renderer/helpers/api/invidious-comments.js'

test('handles Invidious comments without author thumbnails', () => {
  assert.equal(getInvidiousCommentAuthorThumbnail({}), null)
  assert.equal(getInvidiousCommentAuthorThumbnail({ authorThumbnails: [] }), null)
})
