import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { ClientType, Constants, Utils, YT } from 'youtubei.js'

import { getPaidPromotionDurationMs } from '../../src/renderer/helpers/player/paidPromotion.js'
import { getLocalPremiereState } from '../../src/renderer/helpers/premiere.js'
import { getVideoPopularity, normalizeVideoPopularityResponse } from '../../src/renderer/helpers/player/videoPopularity.js'
import { getAndroidLiveDashManifestUrl, getAndroidLiveHlsManifestUrl, getLiveDvrEnabled } from '../../src/renderer/helpers/player/liveManifest.js'

const source = await readFile(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const start = source.indexOf('export async function getLocalVideoInfo(')
const end = source.indexOf('\n}\n', start) + 2

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function loader({ android = Promise.resolve({ data: {} }), token = Promise.resolve('token'), next = Promise.resolve({ data: {} }), details = {}, embeddedNext = false, embeddedPlayer = true } = {}) {
  const requests = []
  const playerResponse = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'testVideo01', title: 'Ready video', lengthSeconds: '30', ...details },
    streamingData: { formats: [], adaptiveFormats: [] },
  }
  const session = {
    context: { client: { clientName: 'WEB', clientVersion: 'test', osName: 'Linux', osVersion: 'test' } },
    actions: {
      execute(endpoint, options) {
        requests.push(options.client ?? endpoint)
        if (options.client === 'ANDROID') return android
        return endpoint === '/player' ? Promise.resolve({ data: playerResponse }) : next
      }
    }
  }
  const dependencies = {
    getWatchHTMLWatchPage: async () => ({ session, playerResponse: embeddedPlayer ? playerResponse : undefined, nextResponse: embeddedNext ? {} : undefined }),
    localApiFetch: () => assert.fail('Unexpected network request'),
    Player: { create: async () => ({ signature_timestamp: 1, decipher: async url => url }) },
    PlayerCache: class {},
    UniversalCache: class {},
    generateContentPoToken: () => { requests.push('token'); return token },
    process: { env: { IS_ELECTRON: true } },
    getPaidPromotionDurationMs,
    normalizeVideoPopularityResponse,
    getLocalPremiereState,
    getLiveDvrEnabled,
    getAndroidLiveHlsManifestUrl,
    getAndroidLiveDashManifestUrl,
    resolveMusicMediaType: async () => 'unknown',
    decipherManifestUrl: async url => url,
    decipherFormats: async () => {},
    extractTotalAdTimeMilliseconds: () => 0,
    Constants, Utils, YT, ClientType,
    createInnertube: () => assert.fail('Unexpected fallback'),
    Response,
    console,
  }
  const load = compileFunction(`${source.slice(start, end).replace('export ', '')}\nreturn getLocalVideoInfo`, Object.keys(dependencies))(...Object.values(dependencies))
  return { load, requests }
}

test('returns regular video data while promotion details are still pending', async () => {
  const android = deferred()
  const { load } = loader({ android: android.promise })
  let completed = false
  const loading = load('testVideo01').then(result => { completed = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.equal(completed, true, 'Promotion metadata must not hold up the watch page')
  } finally {
    android.resolve({ data: {} })
    await loading
  }
})

test('requests watch metadata while the playback token is still being generated', async () => {
  const token = deferred()
  const { load, requests } = loader({ token: token.promise })
  const loading = load('testVideo01')
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.ok(requests.includes('/next'), 'Watch metadata should overlap token generation')
    assert.ok(requests.includes('ANDROID'), 'Promotion details should overlap token generation')
  } finally {
    token.resolve('token')
    await loading
  }
})

test('requests the player response while watch metadata is still pending', async () => {
  const next = deferred()
  const { load, requests } = loader({ next: next.promise, embeddedPlayer: false })
  const loading = load('testVideo01')
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.ok(requests.includes('/player'), 'A slow /next response must not delay the player request')
  } finally {
    next.resolve({ data: {} })
    await loading
  }
})

test('delivers promotion details after the regular video data', async () => {
  const android = deferred()
  const { load } = loader({ android: android.promise })
  const result = await load('testVideo01')
  assert.equal(result.paidPromotionDurationMs, null)
  android.resolve({ data: { paidContentOverlay: { paidContentOverlayRenderer: { durationMs: '60000' } } } })
  assert.equal(await result.paidPromotionPromise, 60000)
})

for (const details of [{ isLive: true }, { isPostLiveDvr: true }]) {
  test(`waits for live manifest fallback ${JSON.stringify(details)}`, async () => {
    const android = deferred()
    const { load } = loader({ android: android.promise, details })
    let completed = false
    const loading = load('testVideo01').then(result => { completed = true; return result })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(completed, false)
    android.resolve({ data: { streamingData: {
      hlsManifestUrl: 'https://example.com/live.m3u8',
      dashManifestUrl: 'https://example.com/post-live.mpd',
    } } })
    const result = await loading
    assert.equal(result.androidLiveHlsManifestUrl, 'https://example.com/live.m3u8')
    assert.equal(result.androidLiveDashManifestUrl, details.isPostLiveDvr ? 'https://example.com/post-live.mpd' : null)
  })
}

test('ignores a failed promotion request', async () => {
  const android = deferred()
  const { load } = loader({ android: android.promise })
  const result = await load('testVideo01')
  android.reject(new Error('Promotion lookup unavailable'))
  assert.equal(await result.paidPromotionPromise, null)
})

test('reuses embedded watch metadata and honors skipped token generation', async () => {
  const { load, requests } = loader({ embeddedNext: true })
  const result = await load('testVideo01', { shouldGeneratePoToken: () => false })
  assert.deepEqual(requests, ['ANDROID'])
  assert.equal(result.poToken, undefined)
})

test('normalizes legacy popularity markers before parsing watch metadata', async () => {
  const { load } = loader({ next: Promise.resolve({ data: {
    contents: { twoColumnWatchNextResults: {
      results: { results: { contents: [] } }, secondaryResults: { secondaryResults: { results: [] } }
    } },
    playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: {
      playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{
        key: 'HEATSEEKER', value: { heatmap: { heatmapRenderer: { heatMarkers: [{
          heatMarkerRenderer: {
            timeRangeStartMillis: 1000, markerDurationMillis: 1000, heatMarkerIntensityScoreNormalized: 1
          }
        }] } } }
      }] } }
    } } } }
  } }) })
  const result = await load('testVideo01')
  assert.deepEqual(getVideoPopularity(result.info), [{ startSeconds: 1, endSeconds: 2, intensity: 1 }])
})

test('propagates a metadata failure while token generation is pending', async () => {
  const token = deferred()
  const next = deferred()
  const { load } = loader({ token: token.promise, next: next.promise })
  const loading = load('testVideo01')
  const rejected = assert.rejects(loading, /Metadata unavailable/)
  next.reject(new Error('Metadata unavailable'))
  await rejected
  token.resolve('token')
})
