import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { createCastMediaServer as createMediaServer, fetchCastMedia, resolveCastMediaAddresses, rewriteCastDash, rewriteCastHls } from '../../src/main/castMediaServer.js'
import { isInvidiousInstanceUrl } from '../../src/main/invidiousAuthorization.js'

// Trust only the loopback HTTP fixtures in these unit tests.
function createCastMediaServer(source, address, token, headers, allowed = url => url.hostname === '127.0.0.1') {
  return createMediaServer(source, address, token, headers, async url => await allowed(url) ? [{ address: '127.0.0.1', family: 4 }] : null,
    (url, options) => fetchCastMedia({ request: httpRequest }, url, options))
}

test('relay connections use only the addresses returned by destination validation', async () => {
  const network = {
    request(options) {
      assert.equal(options.agent, false)
      assert.equal(options.hostname, 'media.test')
      assert.equal(typeof options.lookup, 'function')
      options.lookup('media.test', { all: true }, (error, addresses) => {
        assert.equal(error, null)
        assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }])
      })
      const request = new EventEmitter()
      request.setHeader = () => {}
      request.end = () => queueMicrotask(() => {
        const incoming = Readable.from([Buffer.from('media')])
        incoming.statusCode = 200
        incoming.headers = {}
        request.emit('response', incoming)
      })
      request.destroy = () => {}
      return request
    }
  }
  const response = await fetchCastMedia(network, 'https://media.test/video', {
    method: 'GET', headers: new Headers(), signal: new AbortController().signal, addresses: [{ address: '8.8.8.8', family: 4 }]
  })
  assert.equal(await response.text(), 'media')
})

test('each relay redirect passes its own validated addresses to the transport', async t => {
  const source = { url: 'https://first.test/video', contentType: 'video/mp4' }
  const first = [{ address: '8.8.8.8', family: 4 }]
  const second = [{ address: '1.1.1.1', family: 4 }]
  const requests = []
  const media = createMediaServer(source, '127.0.0.1', 'token', () => ({}), url =>
    url.hostname === 'first.test' ? first : second, async (url, options) => {
    requests.push([url, options.addresses])
    return url === source.url
      ? new Response(null, { status: 302, headers: { location: 'https://second.test/video' } })
      : new Response('media')
  })
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  assert.equal(await (await fetch(media.mediaUrl())).text(), 'media')
  assert.deepEqual(requests, [[source.url, first], ['https://second.test/video', second]])
})

test('HTTP requests expose redirects for policy checks with only explicit credentials', async () => {
  let destroyed = false
  const network = {
    request(options) {
      assert.equal(options.hostname, 'instance.test')
      assert.equal(options.protocol, 'https:')
      assert.equal(options.agent, false)
      const request = new EventEmitter()
      request.setHeader = (name, value) => {
        assert.equal(name, 'range')
        assert.equal(value, 'bytes=0-3')
      }
      request.end = () => queueMicrotask(() => {
        const incoming = Readable.from([])
        incoming.statusCode = 302
        incoming.headers = { location: 'https://media.test/video' }
        incoming.destroy = () => { destroyed = true }
        request.emit('response', incoming)
      })
      request.destroy = () => {}
      return request
    }
  }
  const response = await fetchCastMedia(network, 'https://instance.test/video', {
    method: 'GET', headers: new Headers({ Range: 'bytes=0-3' }), signal: new AbortController().signal,
    addresses: [{ address: '8.8.8.8', family: 4 }]
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://media.test/video')
  assert.equal(response.body, null)
  assert.equal(destroyed, true)
})

test('HTTP requests stream media responses and abort with their caller', async () => {
  let aborted = false
  const network = {
    request() {
      const request = new EventEmitter()
      request.setHeader = () => {}
      request.end = () => queueMicrotask(() => {
        const incoming = Readable.from([Buffer.from('video')])
        incoming.statusCode = 206
        incoming.headers = { 'content-type': 'video/mp4' }
        request.emit('response', incoming)
      })
      request.destroy = () => { aborted = true }
      return request
    }
  }
  const controller = new AbortController()
  const response = await fetchCastMedia(network, 'https://media.test/video', {
    method: 'GET', headers: new Headers(), signal: controller.signal, addresses: [{ address: '8.8.8.8', family: 4 }]
  })
  assert.equal(response.status, 206)
  controller.abort()
  assert.equal(aborted, true)
  assert.equal(await response.text(), 'video')
})

test('HTTP HEAD responses handle transport errors after their headers', async () => {
  const network = {
    request() {
      const request = new EventEmitter()
      request.setHeader = () => {}
      request.destroy = () => {}
      request.end = () => queueMicrotask(() => {
        const incoming = Readable.from([])
        incoming.statusCode = 200
        incoming.headers = {}
        request.emit('response', incoming)
        incoming.destroy(new Error('Connection lost after headers'))
      })
      return request
    }
  }
  const response = await fetchCastMedia(network, 'https://media.test/video', {
    method: 'HEAD', headers: new Headers(), signal: new AbortController().signal, addresses: [{ address: '8.8.8.8', family: 4 }]
  })
  assert.equal(response.status, 200)
  assert.equal(response.body, null)
})

test('aborting a streamed HTTP response closes the upstream socket', async t => {
  let closed
  const upstreamClosed = new Promise(resolve => { closed = resolve })
  const upstream = createServer((request, response) => {
    request.once('close', closed)
    response.writeHead(200, { 'content-type': 'video/mp4' })
    response.write('first chunk')
  })
  const origin = await listen(upstream)
  t.after(() => close(upstream))
  const controller = new AbortController()
  const response = await fetchCastMedia({ request: httpRequest }, `${origin}/video`, {
    method: 'GET', headers: new Headers(), signal: controller.signal, addresses: [{ address: '127.0.0.1', family: 4 }]
  })
  const reader = response.body.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first chunk')
  controller.abort()
  await assert.rejects(reader.read())
  await upstreamClosed
})

for (const addresses of [undefined, [], [{ address: 'not-an-address', family: 4 }], [{ address: '8.8.8.8', family: 6 }]]) {
  test(`rejects missing or invalid validated destinations: ${JSON.stringify(addresses)}`, async () => {
    const network = { request() { assert.fail('Invalid destinations cannot reach the transport') } }
    await assert.rejects(fetchCastMedia(network, 'https://media.test/video', {
      method: 'GET', headers: new Headers(), signal: new AbortController().signal, addresses
    }), /validated Cast destination/)
  })
}

for (const proxy of ['PROXY proxy.test:8080', 'SOCKS5 proxy.test:1080', 'PROXY proxy.test:8080; DIRECT']) {
  test(`does not bypass a ${proxy} route with a direct connection`, async () => {
    const network = { request() { assert.fail('No direct request may bypass the proxy') } }
    await assert.rejects(fetchCastMedia(network, 'https://media.test/video', {
      method: 'GET', headers: new Headers(), signal: new AbortController().signal,
      addresses: [{ address: '8.8.8.8', family: 4 }], proxy
    }), /direct route/)
  })
}

test('destination resolution rejects non-public results except the configured instance origin', async () => {
  const publicUrl = new URL('https://media.test/video')
  const endpoints = [{ address: '8.8.8.8' }, { address: '2606:4700:4700::1111' }]
  const resolve = async hostname => { assert.equal(hostname, 'media.test'); return { endpoints } }
  assert.deepEqual(await resolveCastMediaAddresses(publicUrl, null, resolve), [
    { address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }
  ])
  endpoints.push({ address: '127.0.0.1' })
  assert.equal(await resolveCastMediaAddresses(publicUrl, null, resolve), null)
  assert.equal(await resolveCastMediaAddresses(new URL('http://127.0.0.1/video'), null, resolve), null)
  assert.deepEqual(await resolveCastMediaAddresses(new URL('http://127.0.0.1/video'), 'http://127.0.0.1', resolve), [{ address: '127.0.0.1', family: 4 }])
  assert.equal(await resolveCastMediaAddresses(publicUrl, 'http://127.0.0.1', async () => ({ endpoints: [] })), null)
  assert.equal(await resolveCastMediaAddresses(publicUrl, null, async () => { throw new Error('DNS failed') }), null)
})

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

test('rewriting DASH BaseURL text retains playback attributes and escaped values', () => {
  const xml = '<MPD><BaseURL byteRange="100-200" availabilityTimeOffset="1.5" availabilityTimeComplete="false" serviceLocation="A&amp;B">https://media.test/vod/</BaseURL><Period><BaseURL byteRange="10-20">video.mp4</BaseURL></Period></MPD>'
  const urls = []
  const rewritten = rewriteCastDash(xml, undefined, url => { urls.push(url); return `http://cast.test/${urls.length}` })
  assert.match(rewritten, /<BaseURL byteRange="100-200" availabilityTimeOffset="1.5" availabilityTimeComplete="false" serviceLocation="A&amp;B">http:\/\/cast.test\/1<\/BaseURL>/)
  assert.match(rewritten, /<BaseURL byteRange="10-20">http:\/\/cast.test\/2<\/BaseURL>/)
  assert.deepEqual(urls, ['https://media.test/vod/', 'https://media.test/vod/video.mp4'])
})

test('rewrites DASH manifest locations against the document URL while preserving attributes', () => {
  const xml = '<dash:MPD xmlns:dash="urn:mpeg:dash:schema:mpd:2011"><dash:BaseURL>https://media.test/segments/</dash:BaseURL><dash:Location serviceLocation="A&amp;B"> next?x=1&amp;y=2 </dash:Location><dash:Location>https://other.test/updated.mpd</dash:Location><dash:PatchLocation ttl="60">patch.xml</dash:PatchLocation></dash:MPD>'
  const urls = []
  const result = rewriteCastDash(xml, 'https://instance.test/live/start.mpd', url => { urls.push(url); return `http://cast.test/${urls.length}` })
  assert.deepEqual(urls, ['https://media.test/segments/', 'https://instance.test/live/next?x=1&y=2', 'https://other.test/updated.mpd', 'https://instance.test/live/patch.xml'])
  assert.match(result, /<dash:Location serviceLocation="A&amp;B">http:\/\/cast.test\/2<\/dash:Location>/)
  assert.match(result, /<dash:PatchLocation ttl="60">http:\/\/cast.test\/4<\/dash:PatchLocation>/)
  assert.throws(() => rewriteCastDash('<MPD><Location>file:///manifest</Location></MPD>', undefined, () => ''), /Unsupported/)
})

test('dynamic DASH refreshes keep scoped credentials and rewrite the refreshed manifest', async t => {
  const requests = []
  const upstream = createServer((request, response) => {
    requests.push([request.url, request.headers.authorization])
    if (request.headers.authorization !== 'Bearer scoped-test') return response.writeHead(401).end()
    const xml = request.url === '/live/start'
      ? '<MPD type="dynamic"><BaseURL>https://media.test/segments/</BaseURL><Location>next</Location></MPD>'
      : '<MPD type="dynamic"><Location>third</Location></MPD>'
    response.writeHead(200, { 'content-type': 'application/dash+xml' }).end(xml)
  })
  const origin = await listen(upstream)
  t.after(() => close(upstream))
  const media = createCastMediaServer({ url: `${origin}/live/start`, contentType: 'application/dash+xml' }, '127.0.0.1', 'token', url =>
    new URL(url).origin === origin ? { Authorization: 'Bearer scoped-test' } : {})
  const relayOrigin = await listen(media.server)
  media.setOrigin(relayOrigin)
  t.after(() => close(media.server))
  const initial = await (await fetch(media.mediaUrl())).text()
  const location = initial.match(/<Location>([^<]+)<\/Location>/)[1]
  assert.equal(new URL(location).origin, relayOrigin)
  const refreshed = await fetch(location)
  assert.equal(refreshed.status, 200)
  assert.match(await refreshed.text(), new RegExp(`<Location>${relayOrigin}/token/\\d+/media</Location>`))
  assert.deepEqual(requests, [['/live/start', 'Bearer scoped-test'], ['/live/next', 'Bearer scoped-test']])
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

for (const [contentType, filename, body] of [
  ['application/dash+xml', 'video.mpd', '<MPD><BaseURL>segment.mp4</BaseURL></MPD>'],
  ['application/x-mpegurl', 'video.m3u8', '#EXTM3U\n#EXTINF:5,\nsegment.ts\n']
]) {
  test(`remote ${filename} HEAD omits upstream representation headers`, async t => {
    const upstream = createServer((request, response) => {
      response.writeHead(200, { 'content-type': contentType, 'content-length': Buffer.byteLength(body),
        'content-range': `bytes 0-${Buffer.byteLength(body) - 1}/${Buffer.byteLength(body)}`, 'accept-ranges': 'bytes' })
      response.end(request.method === 'HEAD' ? undefined : body)
    })
    const upstreamUrl = await listen(upstream)
    t.after(() => close(upstream))
    const media = createCastMediaServer({ url: `${upstreamUrl}/${filename}`, contentType }, '127.0.0.1', 'token')
    media.setOrigin(await listen(media.server))
    t.after(() => close(media.server))
    const head = await fetch(media.mediaUrl(), { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-type'), contentType)
    assert.equal(await head.text(), '')
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      assert.equal(head.headers.get(header), null, header)
    }
    const get = await fetch(media.mediaUrl())
    const rewritten = await get.text()
    assert.ok(rewritten.includes('/token/'))
    assert.equal(Number(get.headers.get('content-length')), Buffer.byteLength(rewritten))
  })
}

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


test('rejects untrusted upstream destinations before any request', async t => {
  let fetched = false
  const upstream = createServer((request, response) => { fetched = true; response.end('private service') })
  const upstreamUrl = await listen(upstream)
  t.after(() => close(upstream))
  const media = createCastMediaServer({ url: `${upstreamUrl}/video.mp4`, contentType: 'video/mp4' }, '127.0.0.1', 'token', () => ({}), () => false)
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  assert.equal((await fetch(media.mediaUrl())).status, 502)
  assert.equal(fetched, false)
})


test('checks manifest resources and redirects against the destination policy', async t => {
  let privateRequests = 0
  const privateService = createServer((request, response) => { privateRequests++; response.end('private') })
  const privateUrl = await listen(privateService)
  t.after(() => close(privateService))
  const instance = createServer((request, response) => {
    if (request.url === '/manifest.m3u8') {
      response.writeHead(200, { 'content-type': 'application/x-mpegurl' }).end(`#EXTM3U\n${privateUrl}/segment.ts\n`)
    } else response.writeHead(302, { location: `${privateUrl}/video.mp4` }).end()
  })
  const instanceUrl = await listen(instance)
  t.after(() => close(instance))
  const media = createCastMediaServer({ url: `${instanceUrl}/manifest.m3u8`, contentType: 'application/x-mpegurl' }, '127.0.0.1', 'token', () => ({}), url => url.origin === instanceUrl)
  media.setOrigin(await listen(media.server))
  t.after(() => close(media.server))
  const manifest = await (await fetch(media.mediaUrl())).text()
  const segment = manifest.trim().split('\n').at(-1)
  assert.equal((await fetch(segment)).status, 502)
  assert.equal((await fetch(media.register(`${instanceUrl}/redirect`, 'video/mp4'))).status, 502)
  assert.equal(privateRequests, 0)
})
