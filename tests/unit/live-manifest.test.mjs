import assert from 'node:assert/strict'
import test from 'node:test'

import { getAndroidLiveHlsManifestUrl } from '../../src/renderer/helpers/player/liveManifest.js'

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
})
