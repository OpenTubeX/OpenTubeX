import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldUseGoogleVideoPostRequest
} from '../../src/renderer/helpers/player/playbackRequestPolicy.js'

test('keeps Capacitor googlevideo segments as GET requests for the native proxy', () => {
  const videoUrl = new URL('https://example.googlevideo.com/videoplayback')

  assert.equal(shouldUseGoogleVideoPostRequest(videoUrl, false, true), false)
  assert.equal(shouldUseGoogleVideoPostRequest(videoUrl, false, false), true)
  assert.equal(shouldUseGoogleVideoPostRequest(videoUrl, true, false), false)
})
