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

function playbackLoader({ timeoutAttempts = Infinity, timeoutFormatId = '137', probeError = new DOMException('signal timed out', 'TimeoutError') } = {}) {
  const extractions = []
  const saved = []
  const dependencies = {
    ytDlp: {
      ytDlpPlaybackCacheGet: async () => null,
      ytDlpPlaybackCacheSet: async (videoId, _key, _expiry, source) => saved.push({ videoId, source }),
      ytDlpGetPlaybackInfo: async videoId => {
        extractions.push(videoId)
        return {
          isLive: false, liveStatus: 'not_live', duration: 60, storyboardVtt: null,
          hlsManifestUrl: null, incomplete: false,
          formats: [
            { formatId: '18', height: 360, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2' },
            { formatId: '137', height: 1080, vcodec: 'avc1.640028', acodec: 'none' },
            { formatId: '140', height: null, vcodec: 'none', acodec: 'mp4a.40.2' },
          ].map(format => ({
            ...format, protocol: 'https', ext: 'mp4',
            width: format.height === null ? null : format.height * 16 / 9,
            fps: 30, dynamicRange: 'SDR', language: null,
            audioSampleRate: 44_100, audioChannels: 2, bitrate: 100_000,
            url: `https://media.test/${videoId}/${format.formatId}?expire=4102444800`,
          })),
        }
      },
    },
    probeStreamByteRanges: async url => {
      checkProbe(url)
      return { initRange: { start: 0, end: 99 }, indexRange: { start: 100, end: 199 } }
    },
    fetch: async url => {
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
  }
  function checkProbe(url) {
    if (url.includes(`/video000001/${timeoutFormatId}?`) && extractions.filter(id => id === 'video000001').length <= timeoutAttempts) {
      throw probeError
    }
  }
  const getSource = compileFunction(`${code}\nreturn getYtDlpPlaybackSource`, Object.keys(dependencies))(...Object.values(dependencies))
  return { getSource, extractions, saved }
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
