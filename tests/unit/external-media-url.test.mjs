import assert from 'node:assert/strict'
import test from 'node:test'

import { findPlatformChannel } from '../../src/platforms/index.js'
import { getExternalUrlRoute, isExternalMediaUrl, isYouTubeMediaUrl, shouldOpenExternalMediaUrl } from '../../src/renderer/helpers/externalMediaUrl.js'

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

test('identifies YouTube download URLs without matching unrelated hosts', () => {
  assert.equal(isYouTubeMediaUrl('https://www.youtube.com/watch?v=abcdefghijk'), true)
  assert.equal(isYouTubeMediaUrl('https://youtu.be/abcdefghijk'), true)
  assert.equal(isYouTubeMediaUrl('https://youtube.com.evil.test/watch?v=abcdefghijk'), false)
  assert.equal(isYouTubeMediaUrl('https://vimeo.com/12345'), false)
})

test('opens channel pages of supported platforms instead of playing them with yt-dlp', () => {
  assert.deepEqual(getExternalUrlRoute('https://www.twitch.tv/example'),
    { path: '/external-channel', query: { platform: 'twitch', id: 'example' } })
  assert.deepEqual(getExternalUrlRoute('https://peertube.example/c/example/videos'),
    { path: '/external-channel', query: { platform: 'peertube', id: 'example@peertube.example' } })
  assert.deepEqual(getExternalUrlRoute('https://media.ccc.de/c/exc24'),
    { path: '/external-channel', query: { platform: 'mediaccc', id: 'exc24' } })
  assert.deepEqual(getExternalUrlRoute('https://www.twitch.tv/videos/123456789'),
    { path: '/external-media', query: { url: 'https://www.twitch.tv/videos/123456789' } })
})

test('can skip PeerTube channel paths, which other sites use too', () => {
  assert.equal(findPlatformChannel('https://lemmy.example/c/example', { anyHost: false }), null)
  assert.deepEqual(findPlatformChannel('https://www.twitch.tv/example', { anyHost: false }), { platform: 'twitch', id: 'example' })
  // media.ccc.de conferences also have /c/ paths, but only on their own host
  assert.deepEqual(findPlatformChannel('https://media.ccc.de/c/exc24', { anyHost: false }), { platform: 'mediaccc', id: 'exc24' })
})
