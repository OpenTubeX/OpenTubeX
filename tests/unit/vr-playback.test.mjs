import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'

const code = await readFile(new URL('../../src/renderer/helpers/player/ytDlpPlayback.js', import.meta.url), 'utf8')
const loaderCode = code.slice(code.indexOf('async function loadYtDlpPlaybackSource('))

function loader({ mesh = true, cached = null, panorama = true, incomplete = false, unavailable = false, combinedOnly = false, probePlayable = true } = {}) {
  const attempts = []
  const info = {
    isLive: false, liveStatus: 'not_live', duration: 47, storyboardVtt: null, incomplete,
    formats: combinedOnly ? [
      { protocol: 'https', url: 'https://media.test/combined', vcodec: 'avc1', acodec: 'mp4a', formatNote: '360s, mesh' }
    ] : [
      { protocol: 'https', url: 'https://media.test/video', vcodec: 'avc1', acodec: 'none', formatNote: mesh ? '1080s60, mesh' : '1080p60' },
      { protocol: 'https', url: 'https://media.test/audio', vcodec: 'none', acodec: 'mp4a' }
    ]
  }
  const dependencies = {
    effectivePlaybackSourceCacheKey: () => 'key',
    playbackSourceCache: { get: () => cached, set: () => true },
    ytDlp: {
      ytDlpPlaybackCacheGet: async () => null,
      ytDlpGetPlaybackInfo: async (_id, defaults) => {
        attempts.push(defaults)
        if (unavailable) return { error: 'extraction failed' }
        return { ...info, hlsManifestUrl: defaults && panorama ? 'https://media.test/panorama.m3u8' : null }
      }
    },
    isVideoFormat: format => format.vcodec !== 'none',
    isAudioFormat: format => format.acodec !== 'none',
    convertLegacyFormats: async formats => formats.map(format => ({ url: format.url })),
    convertAdaptiveFormats: async formats => formats.map(format => ({ has_video: format.vcodec !== 'none', has_audio: format.acodec !== 'none' })),
    getCompatibleAdaptiveFormats: formats => formats,
    FormatUtils: { toDash: async () => '<MPD/>' },
    getEarliestYtDlpFormatExpiry: () => new Date(Date.now() + 3600_000),
    cacheYtDlpPlaybackSource: async () => {},
    probeYtDlpHlsManifest: async () => probePlayable,
    MANIFEST_TYPE_DASH: 'application/dash+xml', MANIFEST_TYPE_HLS: 'application/x-mpegurl',
    console,
  }
  const load = compileFunction(`${loaderCode}\nreturn loadYtDlpPlaybackSource`, Object.keys(dependencies))(...Object.values(dependencies))
  return { load: (preferVrHls, cachedOnly = false) => load('vjBrN18wiuE', '', undefined, false, cachedOnly, true, preferVrHls), attempts }
}

const localCode = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const localStart = localCode.indexOf('async function getLocalVrHlsManifest(')
const localEnd = localCode.indexOf('\n}\n', localStart) + 2

test('built-in panorama extraction uses an isolated VR client and deciphers its HLS URL', async () => {
  let requestedContext
  let requestedOptions
  const context = { client: { clientName: 'WEB', clientVersion: 'current', browserName: 'Chrome', visitorData: 'visitor' } }
  const session = { context, api_key: 'key', api_version: 'v1', player: { signature_timestamp: 123 } }
  const dependencies = {
    deepCopy: structuredClone,
    Session: class {
      constructor(context) {
        requestedContext = context
        this.actions = { execute: async (_endpoint, options) => {
          requestedOptions = options
          return { data: { streamingData: { hlsManifestUrl: 'https://media.test/panorama.m3u8' } } }
        } }
      }
    },
    decipherManifestUrl: async (url, player, token, isDash) => {
      assert.equal(player, session.player)
      assert.equal(token, 'token')
      assert.equal(isDash, false)
      return `${url}?deciphered=1`
    },
    console,
  }
  const getManifest = compileFunction(`${localCode.slice(localStart, localEnd)}\nreturn getLocalVrHlsManifest`, Object.keys(dependencies))(...Object.values(dependencies))
  assert.equal(await getManifest('vjBrN18wiuE', session, 'token'), 'https://media.test/panorama.m3u8?deciphered=1')
  assert.notEqual(requestedContext, context)
  assert.equal(context.client.browserName, 'Chrome')
  assert.equal(requestedContext.client.visitorData, 'visitor')
  assert.equal(requestedOptions.videoId, 'vjBrN18wiuE')
  assert.equal(requestedOptions.client, 'VISIONOS')
  assert.equal(requestedOptions.serviceIntegrityDimensions.poToken, 'token')
})

test('mesh playback retries default clients when the first extraction omits panoramic HLS', async () => {
  const { load, attempts } = loader()
  const source = await load(true)
  assert.equal(source.vrProjection, 'EQUIRECTANGULAR')
  assert.equal(source.manifestSrc, 'https://media.test/panorama.m3u8')
  assert.deepEqual(attempts, [false, true])
})

test('yt-dlp detects mesh playback even when backend projection metadata is missing', async () => {
  const { load } = loader()
  assert.equal((await load(false)).vrProjection, 'EQUIRECTANGULAR')
})

test('a cached flat source cannot suppress an explicitly requested panorama', async () => {
  const { load, attempts } = loader({ cached: { subtitlesIncluded: true, vrProjection: null } })
  assert.equal((await load(true)).vrProjection, 'EQUIRECTANGULAR')
  assert.deepEqual(attempts, [false, true])
})

test('a cache-only panorama request ignores a cached flat source without extracting', async () => {
  const { load, attempts } = loader({ cached: { subtitlesIncluded: true, vrProjection: null } })
  assert.equal(await load(true, true), null)
  assert.deepEqual(attempts, [])
})

test('ordinary videos keep the first playable DASH source', async () => {
  const { load, attempts } = loader({ mesh: false })
  const source = await load(false)
  assert.equal(source.manifestMimeType, 'application/dash+xml')
  assert.equal(source.vrProjection, null)
  assert.deepEqual(attempts, [false])
})

const watchCode = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const extractionStart = watchCode.indexOf('    extractYtDlpPlaybackSource: async function (')
const extractionEnd = watchCode.indexOf('\n    /**', extractionStart)
test('a rejected supplied panorama retries the built-in VR client', async () => {
  const start = watchCode.indexOf("            if (this.vrProjection === 'MESH' && !this.isYtDlpPlaybackRequested()) {")
  const end = watchCode.indexOf("if (this.vrProjection === 'MESH' && supportsYtDlp", start)
  const probed = []
  let lookups = 0
  const dependencies = {
    result: { streaming_data: { hls_manifest_url: 'https://media.test/stale.m3u8' } },
    videoInfo: { getVrHlsManifest: async () => { lookups++; return 'https://media.test/fresh.m3u8' } },
    probeHlsManifest: async url => { probed.push(url); return url.endsWith('/fresh.m3u8') },
  }
  const select = compileFunction(`return async function () {
    let vrHlsManifestUrl = null
    const loadGeneration = 1
    const videoId = 'vjBrN18wiuE'
    ${watchCode.slice(start, end)}
    return vrHlsManifestUrl
  }`, Object.keys(dependencies))(...Object.values(dependencies))
  const watch = {
    vrProjection: 'MESH', playbackEngineSwitchGeneration: 1,
    isCurrentVideoLoad: () => true, isYtDlpPlaybackRequested: () => false, updateTitle: () => {},
  }
  assert.equal(await select.call(watch), 'https://media.test/fresh.m3u8')
  assert.equal(watch.vrProjection, 'EQUIRECTANGULAR')
  assert.equal(lookups, 1)
  assert.deepEqual(probed, ['https://media.test/stale.m3u8', 'https://media.test/fresh.m3u8'])
})

for (const savedPanorama of [false, true]) {
  test(`switching a ${savedPanorama ? 'saved' : 'current'} built-in panorama to yt-dlp ignores cached flat streams`, async () => {
    const { load, attempts } = loader({ cached: {
      subtitlesIncluded: true, vrProjection: null, captions: [], captionTranslations: [],
      manifestSrc: 'data:application/dash+xml,<MPD/>', legacyFormats: [], expiryDate: null,
    } })
    const extract = compileFunction(`return ({${watchCode.slice(extractionStart, extractionEnd)}}).extractYtDlpPlaybackSource`, ['getYtDlpPlaybackSource'])(
      (_id, _key, _callback, _authentication, _cachedOnly, _subtitles, preferVrHls) => load(preferVrHls)
    )
    const watch = {
      vrProjection: savedPanorama ? null : 'EQUIRECTANGULAR',
      builtInPlaybackSource: savedPanorama ? { vrProjection: 'EQUIRECTANGULAR' } : null,
      activePlaybackEngine: savedPanorama ? 'yt-dlp' : 'built-in',
      playbackEngineSwitchGeneration: 1, playbackEngineFallbackTarget: null,
      captions: [], videoStoryboardSrc: '', hasResolvedVideoTitle: true,
      isCurrentVideoLoad: () => true, alignActiveFormatWithAvailableSources: () => {},
    }
    assert.equal(await extract.call(watch, 1, 'vjBrN18wiuE'), true)
    assert.equal(watch.manifestSrc, 'https://media.test/panorama.m3u8')
    assert.equal(watch.vrProjection, 'EQUIRECTANGULAR')
    assert.deepEqual(attempts, [false, true])
  })
}

test('an unavailable panorama returns mesh projection for the flat fallback', async () => {
  const { load, attempts } = loader({ panorama: false })
  assert.equal((await load(true)).vrProjection, 'MESH')
  assert.deepEqual(attempts, [false, true, true])
})

test('an incomplete flat fallback retains mesh projection', async () => {
  const { load } = loader({ panorama: false, incomplete: true })
  assert.equal((await load(true)).vrProjection, 'MESH')
})

for (const panorama of [false, true]) {
  test(`combined-only mesh streams remain playable when panoramic HLS is ${panorama ? 'rejected' : 'missing'}`, async () => {
    const { load, attempts } = loader({ combinedOnly: true, panorama, probePlayable: false })
    const source = await load(true)
    assert.equal(source.manifestSrc, null)
    assert.equal(source.vrProjection, 'MESH')
    assert.deepEqual(source.legacyFormats, [{ url: 'https://media.test/combined' }])
    assert.deepEqual(attempts, [false, true, true])
  })
}

test('a combined-only mesh stream still retries and prefers a recovered panorama', async () => {
  const { load, attempts } = loader({ combinedOnly: true })
  const source = await load(true)
  assert.equal(source.vrProjection, 'EQUIRECTANGULAR')
  assert.equal(source.manifestSrc, 'https://media.test/panorama.m3u8')
  assert.deepEqual(attempts, [false, true])
})

test('failed panorama extraction cannot restore an incompatible flat cache', async () => {
  const { load } = loader({ unavailable: true, cached: { subtitlesIncluded: true, vrProjection: null } })
  await assert.rejects(load(true), /extraction failed/)
})

for (const backend of ['Local', 'Invidious']) {
  for (const playable of [true, false]) {
    test(`a late ${backend} panorama probe (${playable}) cannot change a newer video`, async () => {
      const start = watchCode.indexOf(backend === 'Local'
        ? "            if (this.vrProjection === 'MESH' && !this.isYtDlpPlaybackRequested()) {"
        : "              if (this.vrProjection === 'MESH' && result.hlsUrl && !this.isYtDlpPlaybackRequested()) {")
      const end = watchCode.indexOf("if (this.vrProjection === 'MESH' && supportsYtDlp", start)
      let resolveProbe
      const probe = new Promise(resolve => { resolveProbe = resolve })
      const dependencies = {
        result: { streaming_data: { hls_manifest_url: 'https://media.test/panorama.m3u8' }, hlsUrl: 'https://media.test/panorama.m3u8' },
        probeHlsManifest: () => probe,
      }
      const select = compileFunction(`return async function () {
        let vrHlsManifestUrl = null
        const loadGeneration = 1
        const videoId = 'vjBrN18wiuE'
        ${watchCode.slice(start, end)}
        this.completed = true
      }`, Object.keys(dependencies))(...Object.values(dependencies))
      let current = true
      const watch = {
        vrProjection: 'MESH', playbackEngineSwitchGeneration: 1, proxyVideos: false,
        isCurrentVideoLoad: () => current, isYtDlpPlaybackRequested: () => false,
        updateTitle: () => {},
      }
      const pending = select.call(watch)
      current = false
      watch.vrProjection = null
      resolveProbe(playable)
      await pending
      assert.equal(watch.vrProjection, null)
      assert.equal(watch.completed, undefined)
    })
  }
}
