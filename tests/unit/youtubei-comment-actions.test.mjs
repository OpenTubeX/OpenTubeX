import assert from 'node:assert/strict'
import test from 'node:test'

import { ProtoUtils } from 'youtubei.js'

test('encodes comment translation actions as URL-safe base64', () => {
  const japaneseAction = ProtoUtils.encodeCommentActionParams(22, {
    text: 'これは日本語です',
    target_language: 'en'
  })
  const koreanAction = ProtoUtils.encodeCommentActionParams(22, {
    text: '이것은 한국어 댓글',
    target_language: 'en'
  })

  assert.doesNotMatch(japaneseAction, /%2F/i)
  assert.doesNotMatch(koreanAction, /%2B/i)
  assert.match(japaneseAction, /_/)
  assert.match(koreanAction, /-/)
})
