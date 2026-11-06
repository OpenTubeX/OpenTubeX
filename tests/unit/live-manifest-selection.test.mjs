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

test('ongoing streams and premieres use WEB HLS even when DASH is available', () => {
  for (const isPremiere of [true, false]) {
    for (const duration of [30, 21600]) {
      const watch = { isLive: true, isPremiere, isPostLiveDvr: false }
      const hls = `https://example.com/manifest_duration/${duration}/live.m3u8`
      selectManifest.call(watch, { streaming_data: {
        hls_manifest_url: hls,
        dash_manifest_url: 'https://example.com/live.mpd'
      } }, 'https://example.com/android.m3u8', 'https://example.com/android.mpd')
      assert.equal(watch.manifestSrc, hls)
      assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
    }
  }
})

test('uses Android HLS when WEB omits its live manifest', () => {
  const watch = { isLive: true }
  selectManifest.call(watch, {}, 'https://example.com/android.m3u8')
  assert.equal(watch.manifestSrc, 'https://example.com/android.m3u8')
  assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
})

test('keeps a missing live HLS source null so playback engine fallback can recover', () => {
  const watch = { isLive: true }
  selectManifest.call(watch, { streaming_data: { dash_manifest_url: 'https://example.com/live.mpd' } }, null, 'https://example.com/android.mpd')
  assert.equal(watch.manifestSrc, null)
  assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
})

test('recently ended streams retain their remote DASH fallback', () => {
  const watch = { isLive: false, isPostLiveDvr: true }
  selectManifest.call(watch, { streaming_data: {
    dash_manifest_url: 'https://example.com/post-live.mpd',
    hls_manifest_url: 'https://example.com/post-live.m3u8'
  } }, null)
  assert.equal(watch.manifestSrc, 'https://example.com/post-live.mpd')
  assert.equal(watch.manifestMimeType, 'application/dash+xml')
})

test('recently ended streams retain HLS when no remote DASH is available', () => {
  const watch = { isLive: false, isPostLiveDvr: true }
  selectManifest.call(watch, {}, 'https://example.com/post-live.m3u8')
  assert.equal(watch.manifestSrc, 'https://example.com/post-live.m3u8')
  assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
})

test('recently ended streams retain Android DASH when WEB DASH is missing and HLS is limited or absent', () => {
  for (const hls of [null, 'https://example.com/manifest_duration/30/post-live.m3u8']) {
    const watch = { isLive: false, isPostLiveDvr: true }
    selectManifest.call(watch, { streaming_data: { hls_manifest_url: hls } }, null, 'https://example.com/android-post-live.mpd')
    assert.equal(watch.manifestSrc, 'https://example.com/android-post-live.mpd')
    assert.equal(watch.manifestMimeType, 'application/dash+xml')
  }
})

test('recently ended streams keep longer HLS windows instead of substituting Android DASH', () => {
  const watch = { isLive: false, isPostLiveDvr: true }
  const hls = 'https://example.com/manifest_duration/21600/post-live.m3u8'
  selectManifest.call(watch, { streaming_data: { hls_manifest_url: hls } }, null, 'https://example.com/android-post-live.mpd')
  assert.equal(watch.manifestSrc, hls)
  assert.equal(watch.manifestMimeType, 'application/x-mpegurl')
})
