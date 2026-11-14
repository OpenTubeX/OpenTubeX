import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  fetchFaviconDataUrl,
  requestWithoutRedirects,
  resolveFaviconUrl,
  resolveSearchEngineIcon
} from '../../src/main/favicon.js'

test('resolves a declared favicon from the engine homepage', async () => {
  const icon = await resolveFaviconUrl(
    'https://search.example.com/find?q=%s',
    // Electron net.fetch can omit Response.url even for successful requests,
    // as constructed responses do.
    async () => new Response('<link rel="icon" sizes="32x32" href="/favicon-32.png" type="image/png">', {
      status: 429,
      headers: { 'content-type': 'text/html' }
    })
  )

  assert.equal(icon, 'https://search.example.com/favicon-32.png')
})

test('fetches discovered icons as renderer-safe data URLs', async () => {
  const icon = await fetchFaviconDataUrl(
    'https://cdn.example.com/favicon.png',
    async () => new Response(Uint8Array.from([137, 80, 78, 71]), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    })
  )

  assert.equal(icon, 'data:image/png;base64,iVBORw==')
})

/**
 * A 2 MiB response that records whether reading it was cancelled.
 * @param {string} contentType
 * @param {Uint8Array} [prefix]
 */
function largeResponse(contentType, prefix = new Uint8Array(0)) {
  const state = { cancelled: false }
  let chunks = 0
  const body = new ReadableStream({
    pull(controller) {
      if (chunks === 32) {
        controller.close()
        return
      }
      controller.enqueue(chunks++ === 0 ? prefix : new Uint8Array(65_536))
    },
    cancel() {
      state.cancelled = true
    }
  })
  return { state, response: new Response(body, { status: 200, headers: { 'content-type': contentType } }) }
}

test('stops reading icons beyond the size limit', async () => {
  const { state, response } = largeResponse('image/png')
  const icon = await fetchFaviconDataUrl('https://cdn.example.com/favicon.png', async () => response)

  assert.equal(icon, '')
  assert.ok(state.cancelled, 'the oversized icon was not cancelled')
})

test('discovers favicons from the start of an oversized homepage', async () => {
  const { state, response } = largeResponse(
    'text/html',
    new TextEncoder().encode('<head><link rel="icon" sizes="32x32" href="/favicon-32.png"></head>')
  )
  const icon = await resolveFaviconUrl('https://search.example.com/find?q=%s', async () => response)

  assert.equal(icon, 'https://search.example.com/favicon-32.png')
  assert.ok(state.cancelled, 'the oversized homepage was not cancelled')
})

const ICON = 'data:image/png;base64,iVBORw=='
const ADDRESSES = {
  'search.example.com': ['93.184.216.34'],
  'cdn.example.net': ['93.184.216.35'],
  'router.lan': ['192.168.1.1'],
  'searx.lan': ['192.168.1.20']
}

/**
 * Serves `routes` and records each request with the addresses it was pinned to.
 * @param {Record<string, { redirect: string } | { html: string } | 'icon'>} routes
 * @param {string} [proxy]
 */
function engineNetwork(routes, proxy = 'DIRECT') {
  const requests = []
  const respond = url => {
    const route = routes[url]
    if (route === 'icon') return new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    if (route?.html) return new Response(route.html, { headers: { 'content-type': 'text/html' } })
    if (route?.redirect) return new Response(null, { status: 302, headers: { location: route.redirect } })
    return new Response(null, { status: 404 })
  }
  return {
    requests,
    resolveAddresses: async hostname => proxy === 'DIRECT' ? ADDRESSES[hostname] ?? [] : [],
    resolveProxy: async () => proxy,
    fetchPinned: async (url, _init, addresses) => {
      requests.push(`${url} ${addresses.join(',')}`)
      return respond(url)
    },
    fetchProxied: async url => {
      requests.push(`${url} proxy`)
      return respond(url)
    }
  }
}

const page = href => ({ html: `<link rel="icon" href="${href}">` })

test('public engines cannot make the app request the local network', async () => {
  for (const declared of ['http://192.168.1.1/icon.png', 'http://router.lan/icon.png']) {
    const network = engineNetwork({ 'https://search.example.com': page(declared), 'https://search.example.com/favicon.ico': 'icon' })
    assert.equal(await resolveSearchEngineIcon('https://search.example.com/?q=%s', network), ICON)
    assert.deepEqual(network.requests, [
      'https://search.example.com 93.184.216.34',
      'https://search.example.com/favicon.ico 93.184.216.34'
    ])
  }

  // Redirects of the homepage and of the icon are checked before they are requested
  const network = engineNetwork({
    'https://search.example.com': { redirect: 'https://cdn.example.net/home' },
    'https://cdn.example.net/home': page('/icon.png'),
    'https://cdn.example.net/icon.png': { redirect: 'http://192.168.1.1/icon.png' },
    'https://search.example.com/favicon.ico': { redirect: 'http://searx.lan/' }
  })
  assert.equal(await resolveSearchEngineIcon('https://search.example.com/?q=%s', network), '')
  assert.deepEqual(network.requests, [
    'https://search.example.com 93.184.216.34',
    'https://cdn.example.net/home 93.184.216.35',
    'https://cdn.example.net/icon.png 93.184.216.35',
    'https://search.example.com/favicon.ico 93.184.216.34'
  ])

  // An engine whose address cannot be looked up gets no exception
  const unknown = engineNetwork({ 'https://unknown.example': page('http://192.168.1.1/icon.png') })
  assert.equal(await resolveSearchEngineIcon('https://unknown.example/?q=%s', unknown), '')
  assert.deepEqual(unknown.requests, [])
})

test('self-hosted engines keep their icons on the local network', async () => {
  const network = engineNetwork({ 'http://searx.lan': page('http://192.168.1.1/icon.png'), 'http://192.168.1.1/icon.png': 'icon' })

  assert.equal(await resolveSearchEngineIcon('http://searx.lan/search?q=%s', network), ICON)
  assert.deepEqual(network.requests, ['http://searx.lan 192.168.1.20', 'http://192.168.1.1/icon.png 192.168.1.1'])
})

test('proxied engine requests keep the local network check', async () => {
  const network = engineNetwork({
    'https://search.example.com': page('http://192.168.1.1/icon.png'),
    'https://search.example.com/favicon.ico': 'icon'
  }, 'PROXY proxy.example:8080')

  // The proxy resolves the engine's host, which may have no local lookup
  assert.equal(await resolveSearchEngineIcon('https://search.example.com/?q=%s', network), ICON)
  assert.deepEqual(network.requests, ['https://search.example.com proxy', 'https://search.example.com/favicon.ico proxy'])
})

test('proxied requests report redirects instead of following them', async () => {
  // Electron's net.request emits a redirect event that the request must not follow
  const request = () => {
    const clientRequest = new EventEmitter()
    Object.assign(clientRequest, { setHeader() {}, abort() {} })
    clientRequest.end = () => setImmediate(() => clientRequest.emit('redirect', 302, 'GET', 'http://192.168.1.1/icon.png'))
    return clientRequest
  }

  const response = await requestWithoutRedirects(request, 'https://cdn.example.net/icon.png', {})
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'http://192.168.1.1/icon.png')
})
