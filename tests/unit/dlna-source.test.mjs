import assert from 'node:assert/strict'
import test from 'node:test'

import { selectDlnaSource, selectDlnaTracks } from '../../src/renderer/helpers/player/dlnaSource.js'

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

test('selects iOS registered progressive MP4 URLs and rejects unrelated native assets', () => {
  const registered = {
    url: 'capacitor://localhost/_opentubex_media/5CD72AC0-BA1B-402B-9BA3-81455F753D8A',
    mimeType: 'video/mp4', height: 480
  }
  assert.equal(selectDlnaSource([
    { url: 'capacitor://localhost/private.mp4', mimeType: 'video/mp4', height: 1080 },
    registered
  ]), registered)
  assert.equal(selectDlnaSource([{ ...registered, requiresSeparateAudio: true }]), null)
})


test('selects high-resolution H.264 and original AAC over WebM, AV1, HE-AAC and DRC', () => {
  const video = { url: 'https://media.test/1080', protocol: 'https', ext: 'mp4', acodec: 'none', vcodec: 'avc1.64002a', height: 1080, fps: 60 }
  const audio = { url: 'https://media.test/audio', protocol: 'https', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', bitrate: 128000, formatId: '140' }
  assert.deepEqual(selectDlnaTracks([
    { ...video, height: 2160, vcodec: 'av01.0.08M.08' },
    { ...video, height: 1440, ext: 'webm', vcodec: 'vp9' },
    { ...video, url: 'https://media.test/720', height: 720 }, video,
    { ...audio, url: 'https://media.test/drc', formatId: '140-drc', bitrate: 192000 },
    { ...audio, acodec: 'mp4a.40.5' }, audio
  ]), { url: video.url, audioUrl: audio.url, height: 1080 })
  assert.equal(selectDlnaTracks([video]), null)
  assert.equal(selectDlnaTracks([{ ...video, protocol: 'm3u8_native' }, audio]), null)
})
