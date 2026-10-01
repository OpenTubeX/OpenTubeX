import assert from 'node:assert/strict'
import test from 'node:test'
import { selectCastSource } from '../../src/renderer/helpers/player/castSource.js'
import { castSourceAvailable } from '../../src/main/chromecast.js'

test('selects a complete H.264 MP4 rather than an adaptive track or an unsupported codec', () => {
  const formats = [
    { url: 'https://media.test/av1', mimeType: 'video/mp4; codecs="av01, mp4a.40.2"', height: 1080 },
    { url: 'https://media.test/video-only', mimeType: 'video/mp4; codecs="avc1"', height: 1080, requiresSeparateAudio: true },
    { url: 'https://media.test/mp4', mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"', height: 720 },
    { url: 'https://media.test/low', mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"', height: 360 }
  ]
  assert.deepEqual(selectCastSource(formats), { url: 'https://media.test/mp4', contentType: 'video/mp4' })
  assert.equal(formats[0].height, 1080, 'selection must not reorder the player formats')
})

test('allows local DASH and remote HLS but excludes SABR, blobs and files', () => {
  for (const [url, type] of [
    ['data:application/dash+xml;charset=UTF-8,%3CMPD%3E%3CAdaptationSet%20mimeType%3D%22video%2Fmp4%22%2F%3E%3C%2FMPD%3E', 'application/dash+xml'],
    ['https://media.test/live', 'application/x-mpegurl'],
    ['https://media.test/vod.mpd', 'application/dash+xml']
  ]) {
    const source = selectCastSource([], url, type)
    assert.deepEqual(source, { url, contentType: type })
    assert.equal(castSourceAvailable(source), true)
  }
  for (const [url, type] of [
    ['https://media.test/sabr', 'application/x-sabr'],
    ['blob:local-video', 'video/mp4'],
    ['file:///video.mp4', 'video/mp4'],
    ['data:text/html,hello', 'application/dash+xml']
  ]) {
    assert.equal(selectCastSource([], url, type), null)
    assert.equal(castSourceAvailable({ url, contentType: type }), false)
  }
  assert.equal(castSourceAvailable({ url: 'https://user:password@media.test/video', contentType: 'video/mp4' }), false)
})


test('prefers adaptive manifests over a lower-quality progressive fallback', () => {
  const source = selectCastSource([{ url: 'https://media.test/360', mimeType: 'video/mp4', height: 360 }],
    'https://media.test/4k.mpd', 'application/dash+xml')
  assert.deepEqual(source, { url: 'https://media.test/4k.mpd', contentType: 'application/dash+xml' })
})


test('does not replace video with an audio-only DASH manifest', () => {
  const url = 'https://media.test/video.mp4'
  const manifest = `data:application/dash+xml,${encodeURIComponent('<MPD><AdaptationSet mimeType="audio/mp4"/></MPD>')}`
  assert.deepEqual(selectCastSource([{ url, mimeType: 'video/mp4' }], manifest, 'application/dash+xml'),
    { url, contentType: 'video/mp4' })
})
