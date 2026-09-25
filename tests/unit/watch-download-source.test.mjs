import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/watchDownloadPlayback.js', import.meta.url), 'utf8')
const { cacheOnlinePlaybackSource, restoreOnlinePlaybackSource } = runInNewContext(`({
  ${source.slice(source.indexOf('  cacheOnlinePlaybackSource:'), source.indexOf('  playbackSourceRouteBase:'))}
})`, { MANIFEST_TYPE_SABR: 'sabr' })

test('returning from a downloaded file restores the cached online source', () => {
  const watch = {
    cacheOnlinePlaybackSource,
    restoreOnlinePlaybackSource,
    localFilePlayback: false,
    onlinePlaybackSource: null,
    manifestSrc: 'https://example.com/manifest',
    manifestMimeType: 'sabr',
    sabrData: { token: 'sample' },
    legacyFormats: [{ url: 'https://example.com/legacy' }],
    streamingDataExpiryDate: null,
    activeFormat: 'sabr',
    activePlaybackEngine: 'built-in',
    activePlaybackEngineVersion: 1,
    sabrPlaybackLoaded: false,
    playbackSourceKey: 0,
    localPlaybackDownloadId: 7,
  }

  watch.cacheOnlinePlaybackSource()
  watch.localFilePlayback = true
  watch.manifestSrc = 'downloadmedia://file/7/video'
  assert.equal(watch.restoreOnlinePlaybackSource(), true)
  assert.equal(watch.manifestSrc, 'https://example.com/manifest')
  assert.equal(watch.activeFormat, 'legacy', 'an unstarted SABR stream resumes with its legacy fallback')
  assert.equal(watch.localFilePlayback, false)
  assert.equal(watch.localPlaybackDownloadId, null)
  assert.equal(watch.playbackSourceKey, 1)
})

test('an expired online source is not restored', () => {
  const watch = {
    onlinePlaybackSource: {
      manifestSrc: 'https://example.com/expired', legacyFormats: [],
      streamingDataExpiryDate: new Date(0),
    },
  }
  assert.equal(restoreOnlinePlaybackSource.call(watch), false)
})
