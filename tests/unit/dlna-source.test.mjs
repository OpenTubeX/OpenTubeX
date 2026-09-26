import assert from 'node:assert/strict'
import test from 'node:test'

import { selectDlnaSource } from '../../src/renderer/helpers/player/dlnaSource.js'

test('selects the best complete MP4 stream for DLNA playback', () => {
  assert.deepEqual(selectDlnaSource([
    { url: 'https://example.test/video-only', mimeType: 'video/mp4', height: 1080, requiresSeparateAudio: true },
    { url: 'https://example.test/webm', mimeType: 'video/webm', height: 720 },
    { url: 'https://example.test/low', mimeType: 'video/mp4', height: 360 },
    { url: 'https://example.test/high', mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', height: 480 }
  ]), {
    url: 'https://example.test/high',
    mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
    height: 480
  })
  assert.equal(selectDlnaSource([{ url: 'https://example.test/video', mimeType: 'video/mp4', requiresSeparateAudio: true }]), null)
})
