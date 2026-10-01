import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = source.indexOf('          if (useRemoteManifest) {')
const end = source.indexOf('          this.streamingDataExpiryDate', start)
const selectManifest = vm.runInNewContext(`(function (result, androidLiveHlsManifestUrl, androidLiveDashManifestUrl) {
  const useRemoteManifest = true
  ${source.slice(start, end)}
})`, { MANIFEST_TYPE_DASH: 'application/dash+xml', MANIFEST_TYPE_HLS: 'application/x-mpegurl' })

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
