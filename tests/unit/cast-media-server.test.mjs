import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { createCastMediaServer, rewriteCastDash, rewriteCastHls } from '../../src/main/castMediaServer.js'
import { isInvidiousInstanceUrl } from '../../src/main/invidiousAuthorization.js'

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}
function close(server) {
  server.closeAllConnections()
  return new Promise(resolve => server.close(resolve))
}

test('rewrites DASH resources using their original inherited base and preserves ranges/templates', () => {
  const registered = []
  const xml = `<MPD><BaseURL>https://media.test/vod/</BaseURL><Period><AdaptationSet>
    <Representation id="video"><BaseURL>video.mp4?sig=a&amp;b=2</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation>
    <Representation id="audio"><SegmentTemplate media="audio-$Number$.m4s" initialization="init.mp4"/></Representation>
  </AdaptationSet></Period></MPD>`
  const result = rewriteCastDash(xml, undefined, url => { registered.push(url); return `http://cast.test/${registered.length}` })
  assert.deepEqual(registered, ['https://media.test/vod/', 'https://media.test/vod/video.mp4?sig=a&b=2', 'https://media.test/vod/audio-$Number$.m4s', 'https://media.test/vod/init.mp4'])
  assert.match(result, /indexRange="100-200"/)
  assert.match(result, /range="0-99"/)
  assert.ok(!result.includes('https://media.test'))
  assert.throws(() => rewriteCastDash('<!DOCTYPE MPD><MPD/>', undefined, () => ''), /doctype/)
  assert.throws(() => rewriteCastDash('<MPD><BaseURL>file:///secret</BaseURL></MPD>', undefined, () => ''), /Unsupported/)
  assert.throws(() => rewriteCastDash('<html/>', undefined, () => ''), /Invalid/)
})

test('rewrites HLS variants, segments, initialization maps and keys', () => {
  const urls = []
  const result = rewriteCastHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\nchunk.ts\n', 'https://media.test/live/main.m3u8', url => { urls.push(url); return `http://cast.test/${urls.length}` })
  assert.deepEqual(urls, ['https://media.test/live/key', 'https://media.test/live/init.mp4', 'https://media.test/live/chunk.ts'])
  assert.match(result, /URI="http:\/\/cast.test\/1"/)
  assert.match(result, /\nhttp:\/\/cast.test\/3\n/)
})

test('serves session resources with ranges, CORS, subtitles and per-origin credentials', async t => {
  const requests = []
  const upstream = createServer((request, response) => {
    requests.push({ path: request.url, range: request.headers.range, authorization: request.headers.authorization })
    if (request.url === '/caption.vtt') {
      response.writeHead(200, { 'content-type': 'text/vtt' }).end('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n')
    } else {
      response.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 2-5/10', 'content-length': 4, 'accept-ranges': 'bytes' }).end('cdef')
    }
  })
  const upstreamUrl = await listen(upstream)
  t.after(() => close(upstream))
  const media = createCastMediaServer({ url: `${upstreamUrl}/video.mp4`, contentType: 'video/mp4' }, '127.0.0.1', 'test-token', url =>
    url.startsWith(upstreamUrl) ? { Authorization: 'Bearer scoped-test' } : {})
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  const url = media.mediaUrl()
  const response = await fetch(url, { headers: { Range: 'bytes=2-5' } })
  assert.equal(response.status, 206)
  assert.equal(await response.text(), 'cdef')
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal((await fetch(url, { method: 'OPTIONS' })).status, 204)
  assert.equal((await fetch(url.replace('/test-token/', '/wrong-token/'))).status, 404)
  assert.equal((await fetch(url.replace('/0/', '/999/'))).status, 404)
  assert.equal((await fetch(url, { method: 'POST' })).status, 404)
  const caption = await fetch(media.register(`${upstreamUrl}/caption.vtt`, 'text/vtt'))
  assert.equal(caption.headers.get('content-type'), 'text/vtt')
  assert.match(await caption.text(), /WEBVTT/)
  assert.deepEqual(requests[0], { path: '/video.mp4', range: 'bytes=2-5', authorization: 'Bearer scoped-test' })
  assert.equal(requests.length, 2)
})

test('serves local data manifests and rejects directory traversal in segment templates', async t => {
  const upstream = createServer((request, response) => response.end(request.url))
  const upstreamUrl = await listen(upstream)
  t.after(() => close(upstream))
  const xml = `<MPD><Period><AdaptationSet><SegmentTemplate media="${upstreamUrl}/segments/$Number$.m4s" initialization="${upstreamUrl}/segments/init.mp4"/></AdaptationSet></Period></MPD>`
  const media = createCastMediaServer({ url: `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(xml)}`, contentType: 'application/dash+xml' }, '127.0.0.1', 'token')
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  const manifest = await fetch(media.mediaUrl())
  assert.equal(manifest.status, 200)
  const body = await manifest.text()
  const template = body.match(/media="([^"]+)"/)[1]
  assert.equal(await (await fetch(template.replace('$Number$', '7'))).text(), '/segments/7.m4s')
  assert.equal((await fetch(template.replace('$Number$.m4s', '%2e%2e%2fsecret'))).status, 502)
  const head = await fetch(media.mediaUrl(), { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(body))
  assert.equal(await head.text(), '')
})

test('rejects requests from a different device address', async t => {
  const media = createCastMediaServer({ url: 'https://media.test/video.mp4', contentType: 'video/mp4' }, '192.0.2.1', 'token')
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  assert.equal((await fetch(media.mediaUrl())).status, 404)
})

test('does not truncate compressed subtitles or advertise compressed byte ranges', async t => {
  const subtitle = 'WEBVTT\n\n00:00.000 --> 00:10.000\n' + 'A subtitle line.\n'.repeat(25)
  const compressed = gzipSync(subtitle)
  let encoding
  const upstream = createServer((request, response) => {
    encoding = request.headers['accept-encoding']
    response.writeHead(200, { 'content-type': 'text/vtt', 'content-encoding': 'gzip',
      'content-length': compressed.length, 'accept-ranges': 'bytes' }).end(compressed)
  })
  const upstreamUrl = await listen(upstream)
  t.after(() => close(upstream))
  const media = createCastMediaServer({ url: `${upstreamUrl}/caption.vtt`, contentType: 'text/vtt' }, '127.0.0.1', 'token')
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  const response = await fetch(media.mediaUrl())
  assert.equal(await response.text(), subtitle)
  assert.equal(response.headers.get('content-length'), null)
  assert.equal(response.headers.get('accept-ranges'), null)
  assert.equal(encoding, 'identity')
})

test('preserves DASH template placeholders in directories and filenames', async t => {
  const upstream = createServer((request, response) => response.end(request.url))
  const upstreamUrl = await listen(upstream)
  t.after(() => close(upstream))
  const xml = `<MPD><Period><AdaptationSet><SegmentTemplate media="${upstreamUrl}/vod/$RepresentationID$/chunk-$Number$.m4s" initialization="${upstreamUrl}/vod/$RepresentationID$/init.mp4"/></AdaptationSet></Period></MPD>`
  const media = createCastMediaServer({ url: `data:application/dash+xml,${encodeURIComponent(xml)}`, contentType: 'application/dash+xml' }, '127.0.0.1', 'token')
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  const body = await (await fetch(media.mediaUrl())).text()
  const template = body.match(/media="([^"]+)"/)[1]
  assert.match(template, /\$RepresentationID\$\/chunk-\$Number\$/)
  const segment = await fetch(template.replace('$RepresentationID$', 'video').replace('$Number$', '7'))
  assert.equal(await segment.text(), '/vod/video/chunk-7.m4s')
  const initialization = body.match(/initialization="([^"]+)"/)[1]
  assert.equal(await (await fetch(initialization.replace('$RepresentationID$', 'audio'))).text(), '/vod/audio/init.mp4')
})

test('recalculates Invidious authorization on redirects without leaking it to the media origin', async t => {
  const requests = []
  const target = createServer((request, response) => {
    requests.push({ target: true, authorization: request.headers.authorization, range: request.headers.range })
    response.writeHead(206, { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/4', 'content-length': 4 }).end('test')
  })
  const targetUrl = await listen(target)
  t.after(() => close(target))
  const instance = createServer((request, response) => {
    requests.push({ target: false, authorization: request.headers.authorization, range: request.headers.range })
    response.writeHead(302, { location: `${targetUrl}/video.mp4` }).end()
  })
  const instanceUrl = await listen(instance)
  t.after(() => close(instance))
  const media = createCastMediaServer({ url: `${instanceUrl}/videoplayback`, contentType: 'video/mp4' }, '127.0.0.1', 'token', url =>
    isInvidiousInstanceUrl(url, instanceUrl) ? { Authorization: 'Bearer cast-test' } : {})
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  const response = await fetch(media.mediaUrl(), { headers: { Range: 'bytes=0-3' } })
  assert.equal(response.status, 206)
  assert.equal(await response.text(), 'test')
  assert.deepEqual(requests, [
    { target: false, authorization: 'Bearer cast-test', range: 'bytes=0-3' },
    { target: true, authorization: undefined, range: 'bytes=0-3' }
  ])
})
