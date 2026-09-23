import assert from 'node:assert/strict'
import test from 'node:test'

import { isExternalMediaUrl, shouldOpenExternalMediaUrl } from '../../src/renderer/helpers/externalMediaUrl.js'

test('accepts only web media URLs without embedded credentials', () => {
  assert.equal(isExternalMediaUrl('https://example.org/video'), true)
  assert.equal(isExternalMediaUrl('http://example.org/video'), true)
  assert.equal(isExternalMediaUrl('file:///tmp/video.mp4'), false)
  assert.equal(isExternalMediaUrl('https://user:secret@example.org/video'), false)
  assert.equal(isExternalMediaUrl('a search query'), false)
})

test('sends external video paths to yt-dlp before YouTube channel parsing', () => {
  assert.equal(shouldOpenExternalMediaUrl('https://vimeo.com/12345'), true)
  assert.equal(shouldOpenExternalMediaUrl('https://www.youtube.com/watch?v=abcdefghijk'), false)
  assert.equal(shouldOpenExternalMediaUrl('https://www.youtube.com./watch?v=abcdefghijk'), false)
  assert.equal(shouldOpenExternalMediaUrl('https://invidious.example/watch?v=abcdefghijk', 'https://invidious.example'), false)
  assert.equal(shouldOpenExternalMediaUrl('https://invidious.example/other/video', 'https://invidious.example/base'), true)
  assert.equal(shouldOpenExternalMediaUrl('https://invidious.example/base/video', 'https://invidious.example/base'), false)
  assert.equal(shouldOpenExternalMediaUrl('https://invidious.example:8443/base/video', 'https://invidious.example/base'), true)
})
