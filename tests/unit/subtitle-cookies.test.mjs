import assert from 'node:assert/strict'
import test from 'node:test'

import { isYouTubeSubtitleUrl } from '../../src/youtubeSubtitle.js'
import { getSubtitleRequestUrl } from '../../src/renderer/helpers/player/subtitleCookies.js'

const url = 'https://www.youtube.com/api/timedtext?v=eeeeeeeeeee&lang=en&tlang=de&fmt=vtt&pot=test-token'
const untranslatedUrl = url.replace('&tlang=de', '')
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nÜbersetzung\n'

test('accepts only HTTPS YouTube WebVTT and SRT requests for cookie authentication', () => {
  assert.equal(isYouTubeSubtitleUrl(url), true)
  assert.equal(isYouTubeSubtitleUrl(url.replace('fmt=vtt', 'fmt=srt')), true)
  for (const invalid of [
    null, {}, '', 'invalid',
    url.replace('https:', 'http:'),
    url.replace('www.youtube.com', 'www.youtube.com.evil.test'),
    url.replace('www.youtube.com', 'evil.test'),
    url.replace('www.youtube.com', 'user:password@www.youtube.com'),
    url.replace('www.youtube.com', 'www.youtube.com:8443'),
    url.replace('/api/timedtext', '/watch'),
    url.replace('fmt=vtt', 'fmt=json3'),
    'file:///tmp/cookies.txt',
  ]) assert.equal(isYouTubeSubtitleUrl(invalid), false, String(invalid))
})

test('the subtitles cookie use authenticates the exact selected translation', async () => {
  const authenticatedUrl = await getSubtitleRequestUrl(url, { getYtDlpCookieUses: ['subtitles'] }, {
    ytDlpGetSubtitle: async requestedUrl => {
      assert.equal(requestedUrl, url)
      return vtt
    }
  })
  assert.equal(await (await fetch(authenticatedUrl)).text(), vtt)
})

test('does not send other requests or disabled requests through yt-dlp', async () => {
  const electron = { ytDlpGetSubtitle: () => assert.fail('Unexpected cookie request') }
  assert.equal(await getSubtitleRequestUrl(untranslatedUrl, {}, electron), untranslatedUrl)
  assert.equal(await getSubtitleRequestUrl(untranslatedUrl, { getYtDlpCookieUses: ['playback', 'downloads'] }, electron), untranslatedUrl)
  const otherUrl = 'https://invidious.example/api/v1/captions/eeeeeeeeeee'
  assert.equal(await getSubtitleRequestUrl(otherUrl, { getYtDlpCookieUses: ['subtitles'] }, electron), otherUrl)
  assert.equal(await getSubtitleRequestUrl(untranslatedUrl, { getYtDlpCookieUses: ['subtitles'] }, null), untranslatedUrl)
})

test('uses normal fetching when no cookie source is configured and reports download errors', async () => {
  const getters = { getYtDlpCookieUses: ['subtitles'] }
  assert.equal(await getSubtitleRequestUrl(untranslatedUrl, getters, { ytDlpGetSubtitle: async () => null }), untranslatedUrl)
  await assert.rejects(getSubtitleRequestUrl(untranslatedUrl, getters, {
    ytDlpGetSubtitle: async () => ({ error: 'Unable to load subtitle with configured cookies' })
  }), /Unable to load subtitle/)
})

test('preserves the SRT format used by automatic caption translations', async () => {
  const srt = '1\n00:00:00,000 --> 00:00:01,000\nÜbersetzung\n'
  const result = await getSubtitleRequestUrl(url.replace('fmt=vtt', 'fmt=srt'), { getYtDlpCookieUses: ['subtitles'] }, {
    ytDlpGetSubtitle: async () => srt
  })
  assert.match(result, /^data:text\/srt;/)
  assert.equal(await (await fetch(result)).text(), srt)
})

test('keeps authenticated automatic captions centered instead of forcing position:0%', async () => {
  const caption = vtt.replace('00:00:01.000', '00:00:01.000 align:start position:0%')
  const authenticatedUrl = await getSubtitleRequestUrl(`${url}&caps=asr&kind=asr`, {
    getYtDlpCookieUses: ['subtitles']
  }, { ytDlpGetSubtitle: async () => caption })
  assert.equal(await (await fetch(authenticatedUrl)).text(), vtt)

  // Uploaded captions retain the author's positioning.
  const uploadedUrl = await getSubtitleRequestUrl(url, {
    getYtDlpCookieUses: ['subtitles']
  }, { ytDlpGetSubtitle: async () => caption })
  assert.equal(await (await fetch(uploadedUrl)).text(), caption)
})

const originalSrt = [
  '1', '00:00:00,000 --> 00:00:01,500', 'First line', 'continues here.', '',
  '2', '00:00:01,500 --> 00:00:03,000', '[♪♪♪]', '',
  '3', '00:00:03,000 --> 00:00:04,000', 'Fish & <chips>!', ''
].join('\n')

/**
 * Serves the original track and records the requested caption URLs.
 * @param {(url: URL) => void} onRequest
 * @param {string} [body]
 */
function stubCaptionFetch(t, onRequest, body = originalSrt) {
  const nativeFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (!String(input).startsWith('https://www.youtube.com/')) return nativeFetch(input, init)
    onRequest(new URL(input))
    return new Response(body)
  })
}

const fakeTranslate = async (text, language) => text.split('\n').map(line => `${language}:${line}`).join('\n')

test('translates the original track when YouTube would refuse a signed-out translation', async (t) => {
  const requested = []
  stubCaptionFetch(t, url => requested.push(url))
  const sentToTranslation = []
  const translate = async (text, language) => {
    sentToTranslation.push(text)
    return await fakeTranslate(text, language)
  }

  const srtUrl = url.replace('fmt=vtt', 'fmt=srt')
  const result = await getSubtitleRequestUrl(srtUrl, {}, null, translate)
  assert.equal(requested.length, 1)
  assert.equal(requested[0].searchParams.has('tlang'), false)
  assert.equal(requested[0].searchParams.get('pot'), 'test-token')
  // One request per batch of sentences; lines without words keep their text and are not sent
  assert.deepEqual(sentToTranslation, ['First line continues here.\nFish & <chips>!'])
  assert.match(result, /^data:text\/srt;/)
  assert.equal(await (await fetch(result)).text(), [
    '1', '00:00:00,000 --> 00:00:01,500', 'de:First line continues here.', '',
    '2', '00:00:01,500 --> 00:00:03,000', '[♪♪♪]', '',
    '3', '00:00:03,000 --> 00:00:04,000', 'de:Fish & <chips>!', ''
  ].join('\n'))

  // Picking the translation again, e.g. as secondary captions, reuses it
  assert.equal(await getSubtitleRequestUrl(srtUrl, {}, null, translate), result)
  assert.equal(requested.length, 1)

  // WebVTT requests, like yt-dlp's `de-en` translations, still read YouTube's SRT
  const vttResult = await getSubtitleRequestUrl(url.replace('tlang=de', 'tlang=fr-en'), {}, null, fakeTranslate)
  assert.equal(requested[1].searchParams.get('fmt'), 'srt')
  assert.equal(await (await fetch(vttResult)).text(), [
    'WEBVTT', '',
    '00:00:00.000 --> 00:00:01.500', 'fr:First line continues here.', '',
    '00:00:01.500 --> 00:00:03.000', '[♪♪♪]', '',
    '00:00:03.000 --> 00:00:04.000', 'fr:Fish &amp; &lt;chips&gt;!', ''
  ].join('\n'))
})

test('spreads sentences split across cues, and unpunctuated captions, over their cues', async (t) => {
  const srt = [
    '1', '00:00:00,000 --> 00:00:02,000', 'so we went to the', '',
    '2', '00:00:02,000 --> 00:00:04,000', 'zoo and saw', '',
    '3', '00:00:04,000 --> 00:00:06,000', 'the elephants there', ''
  ].join('\n')
  stubCaptionFetch(t, () => {}, srt)
  const requests = []
  // Like YouTube's service, punctuates the fragments and joins them into one line
  const translate = async (text) => {
    requests.push(text)
    return 'Also gingen wir in den Zoo und sahen dort die Elefanten.'
  }

  const result = await getSubtitleRequestUrl(url.replace('tlang=de', 'tlang=es').replace('fmt=vtt', 'fmt=srt'), {}, null, translate)
  assert.deepEqual(requests, ['so we went to the zoo and saw the elephants there'])
  const cues = (await (await fetch(result)).text()).trim().split('\n\n').map(block => block.split('\n')[2])
  assert.deepEqual(cues, ['Also gingen wir in', 'den Zoo und', 'sahen dort die Elefanten.'])
})

test('falls back to translating the original track when the cookie request fails', async (t) => {
  stubCaptionFetch(t, () => {})
  t.mock.method(console, 'warn', () => {})
  const result = await getSubtitleRequestUrl(url.replace('tlang=de', 'tlang=it'), { getYtDlpCookieUses: ['subtitles'] }, {
    ytDlpGetSubtitle: async () => ({ error: 'Unable to load subtitle with configured cookies' })
  }, fakeTranslate)
  assert.match(await (await fetch(result)).text(), /it:First line continues here\./)
})
