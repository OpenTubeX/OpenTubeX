import assert from 'node:assert/strict'
import test from 'node:test'

import { getAndroidLiveDashManifestUrl, getAndroidLiveHlsManifestUrl, getLiveDvrEnabled } from '../../src/renderer/helpers/player/liveManifest.js'

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
    data: { streamingData: {
      hlsManifestUrl: 'https://example.com/manifest_duration/30/live.m3u8',
      dashManifestUrl: 'https://example.com/post-live.mpd'
    } }
  }), 'https://example.com/post-live.mpd')
})
