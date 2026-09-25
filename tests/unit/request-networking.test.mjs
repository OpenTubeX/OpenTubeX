import assert from 'node:assert/strict'
import test from 'node:test'

import { configureRequestNetworking } from '../../src/main/requestNetworking.js'

function fixture ({ replaceHttpCache = false, authorization = null, storyboard = false } = {}) {
  const hooks = {}
  const cookieSets = []
  const requests = []
  const webRequest = {
    onBeforeSendHeaders: (_filter, callback) => { hooks.beforeHeaders = callback },
    onHeadersReceived: (_filter, callback) => { hooks.receivedHeaders = callback },
    onCompleted: (_filter, callback) => { hooks.completed = callback },
    onErrorOccurred: (_filter, callback) => { hooks.errored = callback },
    onBeforeRequest: (_filter, callback) => { hooks.beforeRequest = callback }
  }
  const session = {
    webRequest,
    cookies: { set: cookie => cookieSets.push(cookie) },
    getUserAgent: () => 'Example Electron/1 OpenTubeX/1',
    setUserAgent: userAgent => { hooks.userAgent = userAgent }
  }
  const protocol = { handle: (scheme, callback) => { hooks[scheme] = callback } }
  const net = {
    request: options => {
      const listeners = {}
      const request = {
        options,
        headers: {},
        setHeader (name, value) { this.headers[name] = value },
        on (name, callback) { listeners[name] = callback },
        end () { this.ended = true },
        emitResponse (response) { listeners.response(response) }
      }
      requests.push(request)
      return request
    }
  }
  const invidiousAuthorizations = { getForRequest: (_id, url) => url.includes('invidious.example') ? authorization : null }
  configureRequestNetworking({
    session,
    protocol,
    net,
    productName: 'OpenTubeX',
    replaceHttpCache,
    invidiousAuthorizations,
    getExternalStreamHeaders: () => ({}),
    getExternalStreamCookieHeader: () => null,
    isStoryboardUrl: () => storyboard,
    imageCache: { entries: new Map(), has (url) { return this.entries.has(url) }, get (url) { return this.entries.get(url) }, add (url, mimeType, data) { this.entries.set(url, { mimeType, data }) } }
  })
  return { hooks, requests, cookieSets }
}

function appContents () {
  return { id: 7, getURL: () => 'app://bundle/index.html' }
}

test('request hooks preserve the original app origin while rewriting YouTube request headers', () => {
  const { hooks, cookieSets } = fixture()
  assert.equal(hooks.userAgent, 'Example')
  assert.deepEqual(cookieSets.map(cookie => cookie.name), ['CONSENT', 'CONSENT', 'SOCS'])
  const details = {
    id: 1,
    url: 'https://www.youtube.com/youtubei/v1/player',
    method: 'POST',
    webContents: appContents(),
    frame: { url: 'app://bundle/index.html' },
    requestHeaders: { Origin: 'app://bundle' }
  }
  details.webContents.mainFrame = details.frame
  let sent
  hooks.beforeHeaders(details, value => { sent = value })
  assert.equal(sent.requestHeaders.Origin, 'https://www.youtube.com')
  assert.equal(sent.requestHeaders.Referer, 'https://www.youtube.com/')
  const responseHeaders = { 'Cache-Control': ['public, max-age=3600'] }
  let received
  hooks.receivedHeaders({ ...details, requestHeaders: sent.requestHeaders, responseHeaders, statusCode: 200 }, value => { received = value })
  assert.deepEqual(received.responseHeaders['access-control-allow-origin'], ['app://bundle'])
})

test('authorization is scoped to matching Invidious requests and prevents response caching', () => {
  const { hooks } = fixture({ authorization: 'Bearer secret' })
  const details = {
    id: 2,
    url: 'https://invidious.example/api/v1/videos/abc',
    method: 'GET',
    webContents: appContents(),
    frame: { url: 'app://bundle/index.html' },
    requestHeaders: { Origin: 'app://bundle' }
  }
  details.webContents.mainFrame = details.frame
  let sent
  hooks.beforeHeaders(details, value => { sent = value })
  assert.equal(sent.requestHeaders.Authorization, 'Bearer secret')
  let received
  hooks.receivedHeaders({ ...details, requestHeaders: sent.requestHeaders, responseHeaders: { 'Cache-Control': ['public'] }, statusCode: 200 }, value => { received = value })
  assert.deepEqual(received.responseHeaders['cache-control'], ['no-store'])
})

test('HTTP storyboard requests remove cookies, while YouTube watch responses remove tracking headers', () => {
  const { hooks } = fixture({ storyboard: true })
  let sent
  hooks.beforeHeaders({ id: 3, url: 'http://video.example/storyboard', webContents: appContents(), requestHeaders: { Cookie: 'private=1', cookie: 'other=1' } }, value => { sent = value })
  assert.equal(Object.keys(sent.requestHeaders).some(name => name.toLowerCase() === 'cookie'), false)
  let received
  hooks.receivedHeaders({ id: 3, url: 'https://www.youtube.com/watch?v=abc', responseHeaders: { 'set-cookie': ['tracking=1'], 'content-security-policy': ['x'] } }, value => { received = value })
  assert.equal(received.responseHeaders['set-cookie'], undefined)
  assert.equal(received.responseHeaders['content-security-policy'], undefined)
})

test('image cache redirects by web contents and forwards scoped auth with original permitted headers', async () => {
  const { hooks, requests } = fixture({ replaceHttpCache: true, authorization: 'Bearer image' })
  let redirected
  hooks.beforeRequest({ url: 'https://invidious.example/thumb.jpg', webContents: { id: 7 } }, value => { redirected = value.redirectURL })
  assert.equal(redirected, `imagecache://${encodeURIComponent('https://invidious.example/thumb.jpg')}#7`)
  const pending = hooks.imagecache({ url: redirected, method: 'GET', headers: { Cookie: 'private=1', Origin: 'app://bundle', Accept: 'image/webp' } })
  assert.equal(requests[0].options.headers.Authorization, 'Bearer image')
  assert.deepEqual(requests[0].headers, { Cookie: 'private=1', Accept: 'image/webp' })
  const listeners = {}
  requests[0].emitResponse({ headers: { 'content-type': 'image/jpeg' }, on: (name, callback) => { listeners[name] = callback } })
  listeners.data(Buffer.from('image'))
  listeners.end()
  const response = await pending
  assert.equal(await response.text(), 'image')
  assert.equal((await hooks.imagecache({ url: redirected, method: 'GET', headers: {} })).headers.get('content-type'), 'image/jpeg')
  assert.equal(requests.length, 1)
})
