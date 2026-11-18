import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { getVisionOsStreamsFallbackReason, isVisionOsStreamUrl } from '../../src/renderer/helpers/api/visionos-streams.js'

const playable = {
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'testVideo01' },
  streamingData: { adaptiveFormats: [{ itag: 137, url: 'https://rr1---sn-test.googlevideo.com/videoplayback?c=VISIONOS' }] },
}

test('a playable visionOS response provides the streams', () => {
  assert.equal(getVisionOsStreamsFallbackReason(playable, 'testVideo01'), null)
})

for (const [name, response, videoId = 'testVideo01'] of [
  ['a bot check', { ...playable, playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }],
  ['another video', playable, 'otherVideo1'],
  ['an ongoing stream', { ...playable, videoDetails: { videoId: 'testVideo01', isLive: true } }],
  ['a premiere', { ...playable, videoDetails: { videoId: 'testVideo01', isUpcoming: true } }],
  ['a post-live DVR stream', { ...playable, videoDetails: { videoId: 'testVideo01', isPostLiveDvr: true } }],
  ['formats that need deciphering', { ...playable, streamingData: { adaptiveFormats: [{ itag: 137, signatureCipher: 's=a&url=b' }] } }],
  ['DRM protected formats', { ...playable, streamingData: { adaptiveFormats: [{ ...playable.streamingData.adaptiveFormats[0], drmFamilies: ['WIDEVINE'] }] } }],
  ['missing formats', { ...playable, streamingData: {} }],
]) {
  test(`${name} keeps the WEB streams`, () => {
    assert.equal(typeof getVisionOsStreamsFallbackReason(response, videoId), 'string')
  })
}

test('recognizes visionOS stream URLs', () => {
  assert.equal(isVisionOsStreamUrl('https://rr1---sn-test.googlevideo.com/videoplayback?itag=137&c=VISIONOS'), true)
  assert.equal(isVisionOsStreamUrl('https://rr1---sn-test.googlevideo.com/videoplayback?itag=137&c=WEB'), false)
  assert.equal(isVisionOsStreamUrl('https://example.com/videoplayback?c=VISIONOS'), false)
  assert.equal(isVisionOsStreamUrl(undefined), false)
})

const watchSource = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const refreshStart = watchSource.indexOf('    refreshExpiredVisionOsStreams: async function () {')
const refreshExpiredVisionOsStreams = vm.runInNewContext(
  `({${watchSource.slice(refreshStart, watchSource.indexOf('\n    /**', refreshStart))}}).refreshExpiredVisionOsStreams`,
  { MANIFEST_TYPE_DASH: 'application/dash+xml', URL, console: { warn () {} } }
)

function createRefreshView(refreshedCaptionTracks) {
  const player = {}
  let finishRefresh
  const view = {
    videoId: 'testVideo01',
    videoLoadGeneration: 1,
    isLoading: false,
    manifestMimeType: 'application/dash+xml',
    activeFormat: 'dash',
    manifestSrc: 'expired-manifest',
    playbackSourceKey: 0,
    $refs: { player },
    captions: [{ id: '.en', language: 'en', url: 'https://www.youtube.com/api/timedtext?lang=en&expire=1' }],
    captionTranslations: [],
    isCurrentVideoLoad (generation, videoId) { return generation === this.videoLoadGeneration && videoId === this.videoId },
    createLocalDashManifest: async () => 'fresh-manifest',
    showStreamRecoveryNotice () {},
    t: key => key,
    refreshVisionOsStreams: () => new Promise(resolve => {
      finishRefresh = () => resolve({
        streaming_data: { expires: new Date(Date.now() + 21_540_000) },
        captions: { caption_tracks: refreshedCaptionTracks },
      })
    }),
  }
  return { view, finish: () => finishRefresh() }
}

test('a refresh that finishes after another source was picked keeps that source', async () => {
  const { view, finish } = createRefreshView([{ vss_id: '.en', base_url: 'https://www.youtube.com/api/timedtext?lang=en&expire=2' }])
  const refresh = refreshExpiredVisionOsStreams.call(view)
  // Picking a downloaded file while the request runs
  view.manifestSrc = 'file:///downloads/video.webm'
  view.playbackSourceKey++
  finish()
  assert.equal(await refresh, true)
  assert.deepEqual({ manifestSrc: view.manifestSrc, playbackSourceKey: view.playbackSourceKey }, { manifestSrc: 'file:///downloads/video.webm', playbackSourceKey: 1 })
})

test('a refresh without fresh URLs for every caption falls back to the page reload', async () => {
  const { view, finish } = createRefreshView(undefined)
  const refresh = refreshExpiredVisionOsStreams.call(view)
  finish()
  assert.equal(await refresh, false)
  assert.deepEqual({ manifestSrc: view.manifestSrc, captionUrl: view.captions[0].url }, { manifestSrc: 'expired-manifest', captionUrl: 'https://www.youtube.com/api/timedtext?lang=en&expire=1' })
})
