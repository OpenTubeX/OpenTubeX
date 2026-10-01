import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { getLiveDvrWindowSeconds } from '../../src/renderer/helpers/player/liveManifest.js'

const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = source.indexOf('          if (useRemoteManifest) {')
const end = source.indexOf('          this.streamingDataExpiryDate', start)
const selectManifest = vm.runInNewContext(`(function (result, androidLiveHlsManifestUrl, androidLiveDashManifestUrl) {
  const useRemoteManifest = true
  ${source.slice(start, end)}
})`, { MANIFEST_TYPE_DASH: 'application/dash+xml', MANIFEST_TYPE_HLS: 'application/x-mpegurl', getLiveDvrWindowSeconds })

test('running premieres use Android DASH instead of a limited WEB HLS manifest', () => {
  const watch = {}
  selectManifest.call(watch, { streaming_data: { hls_manifest_url: 'https://example.com/manifest_duration/30/live.m3u8' } }, null, 'https://example.com/dvr.mpd')
  assert.equal(watch.manifestSrc, 'https://example.com/dvr.mpd')
  assert.equal(watch.manifestMimeType, 'application/dash+xml')
})

test('keeps WEB DASH first and HLS available when neither client has DASH', () => {
  const watch = {}
  selectManifest.call(watch, { streaming_data: { dash_manifest_url: 'https://example.com/web.mpd' } }, null, 'https://example.com/android.mpd')
  assert.equal(watch.manifestSrc, 'https://example.com/web.mpd')
  selectManifest.call(watch, {}, 'https://example.com/android.m3u8', null)
  assert.equal(watch.manifestSrc, 'https://example.com/android.m3u8')
  assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
})

test('preserves a long WEB HLS rewind window instead of replacing it with Android DASH', () => {
  const watch = {}
  const hls = 'https://example.com/manifest_duration/21600/live.m3u8'
  selectManifest.call(watch, { streaming_data: { hls_manifest_url: hls } }, null, 'https://example.com/recent-only.mpd')
  assert.equal(watch.manifestSrc, hls)
  assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
})

test('uses Android DASH when built-in HLS has no seekable duration marker', () => {
  for (const hls of ['https://example.com/live.m3u8', 'https://example.com/live.m3u8?manifest_duration=3600']) {
    const watch = {}
    selectManifest.call(watch, { streaming_data: { hls_manifest_url: hls } }, null, 'https://example.com/dvr.mpd')
    assert.equal(watch.manifestSrc, 'https://example.com/dvr.mpd')
    assert.equal(watch.manifestMimeType, 'application/dash+xml')
  }
})
