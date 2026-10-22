import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import {
  YATTEE_CHANNEL_TABS,
  checkYatteeServer,
  createYatteeAuthorization,
  createYatteeResponseError,
  fillYatteeShortDates,
  fillYatteeVideoAuthors,
  getYatteeStoryboard,
  getYatteeStreamExpiry,
  getYatteeUpstreamUrl,
  isYatteeServerPlayableOnAndroid,
  normalizeYatteeChannel,
  normalizeYatteeComments,
  normalizeYatteePlaylist,
  normalizeYatteeSearchItem,
  normalizeYatteeServerUrl,
  normalizeYatteeSuggestions,
  normalizeYatteeVideo,
  resolveYatteeUrl
} from '../../src/renderer/helpers/api/yattee.js'

const server = 'https://yattee.example/server'
const upstream = 'https://rr1---sn-test.googlevideo.com/videoplayback?expire=2000000000&itag=140&dur=30.000&xtags=lang%3Den%3Aacont%3Doriginal'

/**
 * @param {string} base the origin the server derived from the request's Host header
 * @param {number} exp
 */
function relayUrl(base, exp = 1900000000) {
  return `${base}/proxy/relay?${new URLSearchParams({ url: upstream, sig: 'signature', exp: String(exp) })}`
}

test('server URLs are normalized without credentials, queries or trailing slashes', () => {
  assert.equal(normalizeYatteeServerUrl(' https://user:secret@yattee.example/path/?a=1#x '), 'https://yattee.example/path')
  assert.equal(normalizeYatteeServerUrl('http://192.168.1.5:8085///'), 'http://192.168.1.5:8085')
  for (const invalid of ['', 'yattee.example', 'ftp://yattee.example', 'not a url']) {
    assert.equal(normalizeYatteeServerUrl(invalid), '')
  }
})

test('Android only plays streams from HTTPS servers or the device itself', () => {
  for (const url of ['https://yattee.example', 'http://localhost:8085', 'http://127.0.0.1:8085', 'http://yattee.localhost']) {
    assert.equal(isYatteeServerPlayableOnAndroid(url), true, url)
  }
  for (const url of ['http://192.168.1.5:8085', 'http://yattee.example', '']) {
    assert.equal(isYatteeServerPlayableOnAndroid(url), false, url)
  }
})

test('Basic Auth encodes UTF-8 credentials and is omitted without credentials', () => {
  assert.equal(createYatteeAuthorization('user', 'password'), 'Basic dXNlcjpwYXNzd29yZA==')
  assert.equal(createYatteeAuthorization('jürgen', 'pässwort'), `Basic ${Buffer.from('jürgen:pässwort').toString('base64')}`)
  assert.equal(createYatteeAuthorization('', ''), null)
})

test('media URLs resolve against the configured server and keep their signatures', () => {
  assert.equal(resolveYatteeUrl('//yt3.ggpht.com/avatar=s88', server), 'https://yt3.ggpht.com/avatar=s88')
  assert.equal(resolveYatteeUrl('/api/v1/captions/id/content?lang=en&token=abc', server), `${server}/api/v1/captions/id/content?lang=en&token=abc`)
  // Behind a reverse proxy that doesn't forward the Host header or the path prefix
  assert.equal(resolveYatteeUrl(relayUrl('http://127.0.0.1:8085'), server), relayUrl(server))
  assert.equal(
    resolveYatteeUrl('http://yattee.example/api/v1/thumbnails/id/maxres.jpg?token=abc', server),
    `${server}/api/v1/thumbnails/id/maxres.jpg?token=abc`
  )
  assert.equal(
    resolveYatteeUrl('http://localhost:8085/api/v1/channels/UC123/avatar/176.jpg', server),
    `${server}/api/v1/channels/UC123/avatar/176.jpg`
  )
  for (const unchanged of [relayUrl(server), 'https://i.ytimg.com/vi/id/hqdefault.jpg', upstream, '']) {
    assert.equal(resolveYatteeUrl(unchanged, server), unchanged)
  }
})

test('relay URLs expose the YouTube stream details and the earlier expiry', () => {
  assert.equal(getYatteeUpstreamUrl(relayUrl(server)), upstream)
  assert.equal(getYatteeUpstreamUrl(upstream), upstream)
  assert.deepEqual(getYatteeStreamExpiry(relayUrl(server, 1900000000)), new Date(1900000000 * 1000))
  assert.deepEqual(getYatteeStreamExpiry(relayUrl(server, 2100000000)), new Date(2000000000 * 1000))
  assert.deepEqual(
    getYatteeStreamExpiry('https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1800000000/id/abc/file/index.m3u8'),
    new Date(1800000000 * 1000)
  )
  assert.equal(getYatteeStreamExpiry('https://example.com/video.mp4'), null)
})

const video = {
  videoId: 'jNQXAC9IVRw',
  title: 'Me at the zoo',
  author: 'jawed',
  authorId: 'UC4QobU6STFB0P71PMvOGN5A',
  authorThumbnails: [{ url: '//yt3.ggpht.com/avatar=s176', width: 176, height: 176 }],
  description: 'First line\n<b>second</b>',
  descriptionHtml: null,
  lengthSeconds: 19,
  hlsUrl: null,
  dashUrl: null,
  videoThumbnails: [{ quality: 'default', url: 'https://i.ytimg.com/vi/jNQXAC9IVRw/3.jpg' }],
  formatStreams: [
    { itag: '269', type: 'application/vnd.apple.mpegurl', container: 'hls', quality: '144p', url: 'https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1/file/index.m3u8' },
    { itag: '18', type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', container: 'mp4', quality: '360p', resolution: '360p', width: 640, height: 360, size: '1234', url: relayUrl('http://127.0.0.1:8085') }
  ],
  adaptiveFormats: [
    { itag: '140', type: 'audio/m4a; codecs="mp4a.40.2"', container: 'm4a', url: relayUrl('http://127.0.0.1:8085') },
    { itag: '137', type: 'video/mp4; codecs="avc1.640028"', container: 'mp4', url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=137' }
  ],
  captions: [{ label: 'English', languageCode: 'en', url: 'http://127.0.0.1:8085/api/v1/captions/jNQXAC9IVRw/content?lang=en&token=abc', auto_generated: false }],
  storyboards: [],
  recommendedVideos: [{ videoId: 'other', authorId: '' }],
}

test('proxied videos only keep media that the server relays', () => {
  const normalized = normalizeYatteeVideo(video, server, true)

  assert.deepEqual(normalized.adaptiveFormats.map(format => format.itag), ['140'])
  assert.equal(normalized.adaptiveFormats[0].url, relayUrl(server))
  assert.deepEqual(normalized.formatStreams.map(format => format.itag), ['18'])
  assert.equal(normalized.formatStreams[0].size, '640x360')
  assert.equal(normalized.formatStreams[0].qualityLabel, '360p')
  assert.equal(normalized.hlsUrl, null, 'the unrelayed HLS manifest would connect to YouTube directly')
  assert.deepEqual(normalized.captions, [{
    label: 'English',
    language_code: 'en',
    url: `${server}/api/v1/captions/jNQXAC9IVRw/content?lang=en&token=abc`
  }])
  assert.equal(normalized.authorThumbnails[0].url, 'https://yt3.ggpht.com/avatar=s176')
  assert.equal(normalized.descriptionHtml, 'First line<br>&lt;b&gt;second&lt;/b&gt;')
  assert.equal(normalized.recommendedVideos[0].authorId, null)
  assert.equal(normalized.isListed, true)
})

test('direct videos keep YouTube URLs and use the HLS manifest for live streams', () => {
  const normalized = normalizeYatteeVideo({ ...video, liveNow: true }, server, false)

  assert.deepEqual(normalized.adaptiveFormats.map(format => format.itag), ['140', '137'])
  assert.deepEqual(normalized.formatStreams.map(format => format.itag), ['18'])
  assert.equal(normalized.hlsUrl, video.formatStreams[0].url)
})

test('storyboards use the largest sheet up to 90 pixels high', () => {
  const storyboard = getYatteeStoryboard([
    { templateUrl: 'https://i.ytimg.com/sb/id/storyboard3_L0/default.jpg', width: 48, height: 27, count: 100, interval: 0, storyboardWidth: 10, storyboardHeight: 10 },
    { templateUrl: 'https://i.ytimg.com/sb/id/storyboard3_L1/M$M.jpg?sigh=rs$abc', width: 80, height: 45, count: 200, interval: 4938, storyboardWidth: 10, storyboardHeight: 10 },
    { templateUrl: 'https://i.ytimg.com/sb/id/storyboard3_L2/M$M.jpg?sigh=rs$abc', width: 160, height: 90, count: 200, interval: 4938, storyboardWidth: 5, storyboardHeight: 5 },
    { templateUrl: 'https://i.ytimg.com/sb/id/storyboard3_L3/M$M.jpg?sigh=rs$abc', width: 320, height: 180, count: 200, interval: 4938, storyboardWidth: 3, storyboardHeight: 3 }
  ])

  assert.deepEqual(storyboard, {
    template_url: 'https://i.ytimg.com/sb/id/storyboard3_L2/M$M.jpg?sigh=rs$abc',
    thumbnail_width: 160,
    thumbnail_height: 90,
    thumbnail_count: 200,
    interval: 4938,
    columns: 5,
    rows: 5
  })
  assert.equal(getYatteeStoryboard([]), null)
})

test('channel search results move the handle and subscriber count into place', () => {
  const channel = {
    type: 'channel',
    authorId: 'UCXuqSBlHAE6Xw-yeJA0Tunw',
    author: 'Linus Tech Tips',
    subCount: null,
    subCountText: '@LinusTechTips',
    videoCount: 16900000
  }

  assert.deepEqual(normalizeYatteeSearchItem(channel), {
    ...channel,
    channelHandle: '@LinusTechTips',
    subCount: 16900000,
    videoCount: null
  })
  const videoItem = { type: 'video', videoId: 'id' }
  assert.equal(normalizeYatteeSearchItem(videoItem), videoItem)
})

test('channel avatars and banners point at the configured server', () => {
  const channel = normalizeYatteeChannel({
    authorId: 'UC123',
    author: 'Channel',
    authorThumbnails: [{ url: 'http://127.0.0.1:8085/api/v1/channels/UC123/avatar/176.jpg', width: 176, height: 176 }],
    authorBanners: [{ url: '//yt3.googleusercontent.com/banner', width: 1060, height: 175 }]
  }, 'https://yattee.example')

  assert.equal(channel.authorThumbnails[0].url, 'https://yattee.example/api/v1/channels/UC123/avatar/176.jpg')
  assert.equal(channel.authorBanners[0].url, 'https://yt3.googleusercontent.com/banner')
})

test('channels list only the tabs the server implements', () => {
  const channel = normalizeYatteeChannel({ authorId: 'UC123', author: 'Channel', description: 'a\nb' })

  assert.deepEqual(channel.tabs, YATTEE_CHANNEL_TABS)
  assert.deepEqual(channel.relatedChannels, [])
  assert.equal(channel.descriptionHtml, 'a<br>b')
  assert.deepEqual(
    fillYatteeVideoAuthors([{ author: '', authorId: '', authorUrl: '' }], 'UC123'),
    [{ author: '', authorId: 'UC123', authorUrl: '/channel/UC123' }]
  )
})

test('playlists get the details that Invidious includes', () => {
  const playlist = normalizeYatteePlaylist({ playlistId: 'PL1', title: 'Playlist', videoCount: 3, videos: [{ videoId: 'a' }, { videoId: 'b' }] })

  assert.deepEqual(playlist.authorThumbnails, [])
  assert.equal(playlist.updated, null)
  assert.deepEqual(playlist.videos.map(entry => entry.index), [0, 1])
})

test('comments get publication timestamps and hearts', () => {
  const before = Date.now() / 1000
  const response = normalizeYatteeComments({
    comments: [
      { content: 'a <b>', publishedText: '6 years ago', published: null, isHearted: true },
      { content: 'b', contentHtml: 'b', publishedText: 'unknown', published: 1700000000 }
    ]
  })

  const [first, second] = response.comments
  assert.ok(first.published < before - 5 * 365 * 24 * 60 * 60)
  assert.deepEqual(first.creatorHeart, {})
  assert.equal(first.contentHtml, 'a &lt;b&gt;')
  assert.equal(second.published, 1700000000)
  assert.equal(second.creatorHeart, undefined)
})

test('search suggestions are wrapped like Invidious does', () => {
  assert.deepEqual(normalizeYatteeSuggestions(['a', 'b'], 'q'), { query: 'q', suggestions: ['a', 'b'] })
  assert.deepEqual(normalizeYatteeSuggestions({ query: 'q', suggestions: [] }, 'q'), { query: 'q', suggestions: [] })
})

test('connection checks report actionable failures', async () => {
  const respond = (status, body) => ({
    fetch: async (url, options) => {
      assert.equal(url, `${server}/info`)
      assert.equal(options.cache, 'no-store')
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }
  })

  assert.deepEqual(await checkYatteeServer('', null), { ok: false, error: 'invalid-url' })
  assert.deepEqual(await checkYatteeServer(server, null, { fetch: async () => { throw new TypeError('Failed to fetch') } }), { ok: false, error: 'unreachable' })

  // A server that drops packets never answers, so the test has to give up on its own
  const silent = (_url, { signal }) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))
  const pending = new Promise(resolve => setTimeout(() => resolve('still testing'), 1000))
  assert.deepEqual(await Promise.race([checkYatteeServer(server, null, { fetch: silent, timeout: 10 }), pending]), { ok: false, error: 'unreachable' })

  // A slow media check is not a CORS problem
  const reachable = async () => Response.json({ name: 'Yattee Server', version: '1.0.9' })
  assert.deepEqual(await checkYatteeServer(server, null, { fetch: reachable, mediaFetch: silent, timeout: 10 }), { ok: false, error: 'unreachable' })
  assert.deepEqual(await checkYatteeServer(server, null, respond(200, { name: 'yattee-server' })), { ok: false, error: 'credentials-required' })
  assert.deepEqual(await checkYatteeServer(server, 'Basic x', respond(401, { detail: 'Invalid credentials' })), { ok: false, error: 'invalid-credentials', status: 401 })
  assert.deepEqual(await checkYatteeServer(server, 'Basic x', respond(429, { detail: 'Too many' })), { ok: false, error: 'rate-limited', status: 429 })
  assert.deepEqual(await checkYatteeServer(server, null, respond(404, '<html></html>')), { ok: false, error: 'not-yattee', status: 404 })
  assert.deepEqual(await checkYatteeServer(server, null, respond(200, { software: { name: 'invidious' } })), { ok: false, error: 'not-yattee' })
  assert.deepEqual(await checkYatteeServer(server, null, respond(502, 'Bad Gateway')), { ok: false, error: 'server-error', status: 502 })

  let authorization
  const info = async (url, options) => {
    authorization = options.headers?.Authorization
    return Response.json({ name: 'Yattee Server', version: '1.0.9-fa6b55f835003d1d75dd2700960a1ddae03d100c' })
  }
  assert.deepEqual(await checkYatteeServer(server, 'Basic dXNlcjpwYXNzd29yZA==', { fetch: info }), { ok: true, version: '1.0.9' })
  assert.equal(authorization, 'Basic dXNlcjpwYXNzd29yZA==')

  // On mobile, the API goes through native HTTP while the player needs CORS headers
  const mediaRequests = []
  const allowed = async url => { mediaRequests.push(url); return new Response('{"status":"ok"}') }
  assert.deepEqual(await checkYatteeServer(server, null, { fetch: info, mediaFetch: allowed }), { ok: true, version: '1.0.9' })
  assert.deepEqual(mediaRequests, [`${server}/health`])
  const blocked = async () => { throw new TypeError('Failed to fetch') }
  assert.deepEqual(await checkYatteeServer(server, null, { fetch: info, mediaFetch: blocked }), { ok: false, error: 'cors' })
  assert.deepEqual(
    await checkYatteeServer('http://192.168.1.5:8085', null, { fetch: info, mediaFetch: allowed, requireHttps: true }),
    { ok: false, error: 'https-required' }
  )
})

test('channel tab videos get the channel name from the channel page or the subscriptions', async () => {
  const source = readFileSync(new URL('../../src/renderer/helpers/api/invidious.js', import.meta.url), 'utf8')
  const extract = (start, end) => {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    assert.ok(from >= 0 && to > from, `Update the extracted range around ${start}`)
    return source.slice(from, to).replaceAll('export ', '')
  }
  const tabVideos = () => ({ videos: [{ videoId: 'a', author: '', authorId: '' }] })
  const context = {
    store: { getters: { getBackendPreference: 'yattee', getProfileList: [{ subscriptions: [{ id: 'UCsubscribed', name: 'Subscribed channel' }] }] } },
    getInvidiousChannelTab: async () => tabVideos(),
    invidiousAPICall: async () => ({ authorId: 'UCvisited', author: 'Visited channel' }),
    normalizeYatteeChannel,
    fillYatteeVideoAuthors,
    getCurrentInstanceUrl: () => 'https://yattee.example',
  }
  const { getInvidiousChannelShorts, invidiousGetChannelInfo } = vm.runInNewContext(
    `${extract('function isYatteeBackend()', '\n/**\n * @param {string} feature')}
    ${extract('export async function invidiousGetChannelInfo(', '\n/**\n * @param {string} tab')}
    ${extract('export async function getInvidiousChannelShorts(', '\n/**\n * @param {string} channelId\n * @param {string | undefined} sortBy\n * @param {string | undefined | null} continuation\n */\nexport async function getInvidiousChannelLive(')}
    ;({ getInvidiousChannelShorts, invidiousGetChannelInfo })`,
    context
  )

  assert.equal((await getInvidiousChannelShorts('UCsubscribed')).videos[0].author, 'Subscribed channel')

  await invidiousGetChannelInfo('@visited')
  assert.equal((await getInvidiousChannelShorts('UCvisited')).videos[0].author, 'Visited channel')
})

test('Shorts dates come from earlier refreshes and lookups of new Shorts only', async () => {
  const lookups = []
  const getVideo = async videoId => { lookups.push(videoId); return { published: 1_700_000_000 } }
  const shorts = [{ videoId: 'new' }, { videoId: 'known' }, { videoId: 'undated' }]

  // Without an earlier refresh, every Short would need a lookup that makes the server extract the video
  assert.deepEqual(await fillYatteeShortDates(shorts, undefined, getVideo), shorts)
  assert.deepEqual(lookups, [])

  const cached = [{ videoId: 'known', published: 1_600_000_000_000 }, { videoId: 'undated' }]
  assert.deepEqual(await fillYatteeShortDates(shorts, cached, getVideo), [
    { videoId: 'new', published: 1_700_000_000_000 },
    { videoId: 'known', published: 1_600_000_000_000 },
    { videoId: 'undated' }
  ])
  assert.deepEqual(lookups, ['new'])

  // Failed lookups are retried on the next refresh
  const failing = async () => { throw new Error('offline') }
  const unresolved = { videoId: 'new', isYatteePublicationDateMissing: true }
  assert.deepEqual(await fillYatteeShortDates([{ videoId: 'new' }], cached, failing), [unresolved])
  // Multiplying a missing date would date the Short to 1970
  assert.deepEqual(await fillYatteeShortDates([{ videoId: 'new' }], cached, async () => ({ published: null })), [unresolved])

  lookups.length = 0
  assert.deepEqual(await fillYatteeShortDates([{ videoId: 'new' }], [unresolved], getVideo), [{ videoId: 'new', published: 1_700_000_000_000 }])
  assert.deepEqual(lookups, ['new'])
})

test('response errors keep the details of validation errors', () => {
  // FastAPI reports validation errors as a list
  const detail = [{ loc: ['query', 'page'], msg: 'Input should be a valid integer', type: 'int_parsing' }]
  const error = createYatteeResponseError({ status: 422 }, { detail })
  assert.equal(error.message, JSON.stringify(detail))
  assert.equal(error.status, 422)
  assert.equal(createYatteeResponseError({ status: 404 }, { detail: 'Video not found' }).message, 'Video not found')
  assert.equal(createYatteeResponseError({ status: 502 }, null).message, 'HTTP 502')
})
