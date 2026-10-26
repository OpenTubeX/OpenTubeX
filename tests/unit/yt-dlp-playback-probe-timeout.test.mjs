import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'

import { FormatUtils, Misc } from 'youtubei.js'
import { getCompatibleAdaptiveFormats } from '../../src/renderer/helpers/player/compatibleAdaptiveFormats.js'
import { waitForYtDlpFormatAvailability } from '../../src/renderer/helpers/player/ytDlpFormatAvailability.js'
import { getEarliestYtDlpFormatExpiry, isYtDlpPlaybackSourceCacheable, YtDlpPlaybackSourceCache } from '../../src/renderer/helpers/player/ytDlpPlaybackCache.js'
import { preloadYtDlpPlaybackSources } from '../../src/renderer/helpers/player/ytDlpPlaybackPreload.js'

const code = (await readFile(new URL('../../src/renderer/helpers/player/ytDlpPlayback.js', import.meta.url), 'utf8'))
  .replace(/^import .+$/gm, '')
  .replace(/^export /gm, '')

function playbackLoader({ audioSampleRate = 44_100, timeoutAttempts = Infinity, timeoutFormatId = '137', probeError = new DOMException('signal timed out', 'TimeoutError'), panorama = false, hlsProbeResult = () => true, incompleteAfterAttempt = Infinity, legacyProbeGate } = {}) {
  const extractions = []
  const saved = []
  const hlsProbes = []
  const dependencies = {
    ytDlp: {
      ytDlpPlaybackCacheGet: async () => null,
      ytDlpPlaybackCacheSet: async (videoId, _key, _expiry, source) => saved.push({ videoId, source }),
      ytDlpGetPlaybackInfo: async videoId => {
        extractions.push(videoId)
        const incomplete = extractions.filter(id => id === videoId).length > incompleteAfterAttempt
        return {
          isLive: false, liveStatus: 'not_live', duration: 60, storyboardVtt: null,
          hlsManifestUrl: panorama ? 'https://media.test/panorama.m3u8?expire=4102444800' : null, incomplete,
          formats: [
            { formatId: '18', height: 360, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2' },
            { formatId: '134', height: 360, vcodec: 'avc1.42001E', acodec: 'none' },
            { formatId: '137', height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
            { formatId: '140', height: null, vcodec: 'none', acodec: 'mp4a.40.2' },
          ].filter(format => !incomplete || format.formatId !== '137').map(format => ({
            ...format, protocol: 'https', ext: 'mp4',
            width: format.height === null ? null : format.height * 16 / 9,
            fps: 30, dynamicRange: 'SDR', language: null,
            formatNote: panorama && format.height !== null ? 'mesh' : null,
            audioSampleRate, audioChannels: 2, bitrate: 100_000,
            url: `https://media.test/${videoId}/${format.formatId}?expire=4102444800`,
          })),
        }
      },
    },
    probeStreamByteRanges: async url => {
      checkProbe(url)
      return { initRange: { start: 0, end: 99 }, indexRange: { start: 100, end: 199 } }
    },
    fetchGoogleVideo: async url => {
      await legacyProbeGate
      checkProbe(url)
      return { ok: true, body: { cancel: async () => {} } }
    },
    console: { error() {}, warn() {} },
    FormatUtils,
    Misc,
    MANIFEST_TYPE_DASH: 'application/dash+xml',
    MANIFEST_TYPE_HLS: 'application/x-mpegurl',
    getCompatibleAdaptiveFormats,
    getEarliestYtDlpFormatExpiry,
    YtDlpPlaybackSourceCache,
    waitForYtDlpFormatAvailability,
    probeYtDlpHlsManifest: async url => {
      hlsProbes.push(url)
      return hlsProbeResult(hlsProbes.length)
    },
  }
  function checkProbe(url) {
    if (url.includes(`/video000001/${timeoutFormatId}?`) && extractions.filter(id => id === 'video000001').length <= timeoutAttempts) {
      throw probeError
    }
  }
  const getSource = compileFunction(`${code}\nreturn getYtDlpPlaybackSource`, Object.keys(dependencies))(...Object.values(dependencies))
  return { getSource, extractions, saved, hlsProbes }
}

for (const [kind, timeoutFormatId] of [['adaptive', '137'], ['progressive', '18']]) {
  test(`does not cache a partial source after ${kind} format probe timeouts`, async () => {
    const { getSource, saved } = playbackLoader({ timeoutFormatId })
    const source = await getSource('video000001')

    assert.equal(source.incomplete, true)
    assert.equal(isYtDlpPlaybackSourceCacheable(source), false)
    assert.equal(saved.length, 0)
  })
}

test('omits unknown audio sample rates from DASH manifests', async () => {
  // ExoPlayer, used by FCast's Android receiver, rejects audioSamplingRate="NaN".
  const { getSource } = playbackLoader({ audioSampleRate: null })
  const manifest = decodeURIComponent((await getSource('video000001')).manifestSrc)
  assert.match(manifest, /<AdaptationSet[^>]*contentType="audio"/)
  assert.doesNotMatch(manifest, /NaN/)
})

test('keeps usable formats cacheable when another format is rejected without a timeout', async () => {
  const { getSource, extractions, saved } = playbackLoader({ probeError: new Error('403 Forbidden') })
  const source = await getSource('video000001')

  assert.equal(source.incomplete, false)
  assert.equal(isYtDlpPlaybackSourceCacheable(source), true)
  assert.equal(saved.length, 1)
  assert.deepEqual(extractions, ['video000001'])
})

test('recovers timed-out formats after the bulk playlist preload before reporting completion', async () => {
  const { getSource, extractions, saved } = playbackLoader({ timeoutAttempts: 3 })
  const progressUpdates = []
  const result = await preloadYtDlpPlaybackSources(['video000001', 'video000002'], {
    concurrency: 1,
    loadSource: getSource,
    onProgress: progress => progressUpdates.push(progress),
  })

  assert.deepEqual(result, { requested: 2, preloaded: 2, failed: 0 })
  assert.deepEqual(extractions, ['video000001', 'video000001', 'video000001', 'video000002', 'video000001'])
  const recovered = saved.find(entry => entry.videoId === 'video000001').source
  assert.match(decodeURIComponent(recovered.manifestSrc), /height="1080"/)
  assert.equal(recovered.incomplete, false)
  assert.ok(progressUpdates.slice(0, -1).every(progress => progress.completed < 2))
  assert.equal(progressUpdates.at(-1).completed, 2)
})

test('reports persistent format timeouts as a preload failure after bounded retries', async () => {
  const { getSource, extractions, saved } = playbackLoader()
  const result = await preloadYtDlpPlaybackSources(['video000001'], { loadSource: getSource })

  assert.deepEqual(result, { requested: 1, preloaded: 0, failed: 1 })
  assert.equal(extractions.length, 9)
  assert.equal(saved.length, 0)
})

test('keeps a working panoramic HLS source when an unrelated adaptive format probe times out', async () => {
  const { getSource, hlsProbes } = playbackLoader({ panorama: true })
  const source = await getSource('video000001')

  assert.equal(source.vrProjection, 'EQUIRECTANGULAR')
  assert.equal(source.manifestSrc, 'https://media.test/panorama.m3u8?expire=4102444800')
  assert.equal(source.incomplete, false)
  assert.equal(hlsProbes.length, 1)
})

test('preserves a panoramic fallback when legacy format probes keep timing out', async () => {
  const { getSource, saved, hlsProbes } = playbackLoader({ panorama: true, timeoutFormatId: '18' })
  const source = await getSource('video000001')

  assert.equal(source.vrProjection, 'EQUIRECTANGULAR')
  assert.equal(source.manifestSrc, 'https://media.test/panorama.m3u8?expire=4102444800')
  assert.equal(source.incomplete, true)
  assert.equal(saved.length, 0)
  assert.equal(hlsProbes.length, 3)
})

test('returns a recovered complete DASH source when panoramic HLS remains unavailable', async () => {
  const { getSource, extractions, hlsProbes } = playbackLoader({
    panorama: true,
    timeoutAttempts: 1,
    hlsProbeResult: () => false,
  })
  const source = await getSource('video000001')

  assert.equal(source.incomplete, false)
  assert.equal(source.vrProjection, 'MESH')
  assert.match(decodeURIComponent(source.manifestSrc), /height="1080"/)
  assert.equal(extractions.length, 3)
  assert.equal(hlsProbes.length, 3)
})

test('prefers an incomplete panorama to a later complete flat DASH fallback', async () => {
  const { getSource, extractions, hlsProbes } = playbackLoader({
    panorama: true,
    timeoutFormatId: '18',
    timeoutAttempts: 1,
    hlsProbeResult: attempt => attempt === 1,
  })
  const source = await getSource('video000001')

  assert.equal(source.incomplete, true)
  assert.equal(source.vrProjection, 'EQUIRECTANGULAR')
  assert.equal(source.manifestSrc, 'https://media.test/panorama.m3u8?expire=4102444800')
  assert.equal(extractions.length, 3)
  assert.equal(hlsProbes.length, 3)
})

for (const incompleteAfterAttempt of [1, 2]) {
  test(`keeps complete DASH when extraction becomes incomplete after attempt ${incompleteAfterAttempt}`, async () => {
    const { getSource, extractions, hlsProbes } = playbackLoader({
      panorama: true,
      timeoutAttempts: 0,
      incompleteAfterAttempt,
      hlsProbeResult: () => false,
    })
    const source = await getSource('video000001')

    assert.equal(source.incomplete, false)
    assert.equal(source.vrProjection, 'MESH')
    assert.match(decodeURIComponent(source.manifestSrc), /height="1080"/)
    assert.equal(extractions.length, 3)
    assert.equal(hlsProbes.length, 3)
  })
}

test('waits for delayed legacy probes before caching an adaptive source', async () => {
  let releaseProbe
  const legacyProbeGate = new Promise(resolve => { releaseProbe = resolve })
  const { getSource, saved, extractions } = playbackLoader({ legacyProbeGate, timeoutFormatId: '18', timeoutAttempts: 1 })
  let settled = false
  const pendingSource = getSource('video000001').finally(() => { settled = true })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(saved.length, 0)
  releaseProbe()
  const source = await pendingSource

  assert.equal(source.incomplete, false)
  assert.equal(saved.length, 1)
  assert.equal(extractions.length, 2)
})
