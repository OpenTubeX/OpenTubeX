import assert from 'node:assert/strict'
import test from 'node:test'

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
