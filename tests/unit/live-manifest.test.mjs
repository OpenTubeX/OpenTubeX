import assert from 'node:assert/strict'
import test from 'node:test'
import { FormatUtils, Misc } from 'youtubei.js'

import {
  getAndroidLiveDashManifestUrl,
  getAndroidLiveHlsManifestUrl,
  getLiveDvrEnabled,
  getLiveHeadSegment,
  toLiveDashManifest
} from '../../src/renderer/helpers/player/liveManifest.js'

test('preserves explicit DVR metadata and leaves missing metadata unknown', () => {
  assert.equal(getLiveDvrEnabled({ isLiveDvrEnabled: false }), false)
  assert.equal(getLiveDvrEnabled({ isLiveDvrEnabled: true }), true)
  for (const details of [undefined, null, {}, { isLiveDvrEnabled: null }]) {
    assert.equal(getLiveDvrEnabled(details), undefined)
  }
})

test('uses the Android HLS manifest when its live player response provides one', () => {
  assert.equal(getAndroidLiveHlsManifestUrl({
    data: {
      streamingData: {
        hlsManifestUrl: 'https://manifest.googlevideo.com/api/manifest/hls_variant/id/test'
      }
    }
  }), 'https://manifest.googlevideo.com/api/manifest/hls_variant/id/test')
})

test('rejects missing and non-HTTPS Android live manifests', () => {
  assert.equal(getAndroidLiveHlsManifestUrl({ data: {} }), null)
  assert.equal(getAndroidLiveHlsManifestUrl({
    data: { streamingData: { hlsManifestUrl: 'http://example.com/live.m3u8' } }
  }), null)
  assert.equal(getAndroidLiveDashManifestUrl({ data: {} }), null)
  assert.equal(getAndroidLiveDashManifestUrl({
    data: { streamingData: { dashManifestUrl: 'http://example.com/live.mpd' } }
  }), null)
})

test('reads the Android DASH fallback for recently ended streams independently of HLS', () => {
  assert.equal(getAndroidLiveDashManifestUrl({
    data: {
      streamingData: {
        hlsManifestUrl: 'https://example.com/manifest_duration/30/live.m3u8',
        dashManifestUrl: 'https://example.com/post-live.mpd'
      }
    }
  }), 'https://example.com/post-live.mpd')
})

test('anchors a live DASH manifest of sq segments at the head segment', async () => {
  const head = getLiveHeadSegment(new Headers({
    'X-Head-Seqnum': '4100807',
    'X-Head-Time-Millis': '20503031733'
  }), Date.parse('2026-11-09T14:00:00.000Z'))
  // The Post-Live-DVR manifest youtubei.js generates for these formats
  const manifest = await FormatUtils.toDash({
    adaptive_formats: [
      new Misc.Format({ itag: 315, mimeType: 'video/webm; codecs="vp9"', bitrate: 18016000, width: 3840, height: 2160, fps: 60, targetDurationSec: 5, url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=315&live=1' }),
      new Misc.Format({ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 144000, audioQuality: 'AUDIO_QUALITY_MEDIUM', audioSampleRate: 44100, audioChannels: 2, targetDurationSec: 5, url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=140&live=1' })
    ]
  }, true, undefined, undefined, undefined, undefined, {
    session: { http: { fetch_function: async () => ({ headers: new Headers({ 'X-Head-Time-Millis': '20503031733', 'X-Head-Seqnum': '4100807' }) }) } }
  })

  const live = toLiveDashManifest(manifest, head, 5)

  // Four hours of 5 second segments, ending with the head segment when the head was read
  assert.match(live, / type="dynamic" availabilityStartTime="2026-11-09T10:00:00.000Z" publishTime="2026-11-09T14:00:00.000Z" timeShiftBufferDepth="PT14400.000S" /)
  assert.doesNotMatch(live, /mediaPresentationDuration|SegmentTimeline/)
  const templates = [...live.matchAll(/<SegmentTemplate [^>]*\/>/g)].map(([template]) => template)
  assert.equal(templates.length, 2)
  for (const template of templates) {
    assert.match(template, / startNumber="4097928" timescale="1000" duration="5000" presentationTimeOffset="20488636733" /)
    assert.match(template, /&amp;sq=\$Number\$"/)
  }
  // A young stream keeps growing into the full window, as the manifest is never refreshed
  const young = toLiveDashManifest(manifest, { ...head, sequenceNumber: 120, mediaTimeMs: 600000 }, 5)
  assert.match(young, / timeShiftBufferDepth="PT14400.000S" /)
  assert.match(young, / startNumber="0" timescale="1000" duration="5000" presentationTimeOffset="0" /)
})
