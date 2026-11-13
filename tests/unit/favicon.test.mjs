import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  fetchFaviconDataUrl,
  fetchWithCheckedRedirects,
  resolveFaviconUrl
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

  assert.equal(icon, 'https://cdn.example.com/favicon.png')
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

test('public engines cannot point the icon request at the local network', async () => {
  const page = href => async () => new Response(`<link rel="icon" href="${href}">`, { headers: { 'content-type': 'text/html' } })
  const addresses = { 'search.example.com': ['93.184.216.34'], 'cdn.example.net': ['93.184.216.35'], 'router.lan': ['192.168.1.1'], 'searx.lan': ['192.168.1.20'] }
  const resolve = async hostname => addresses[hostname] ?? []

  assert.equal(await resolveFaviconUrl('https://search.example.com/?q=%s', page('http://192.168.1.1/icon.png'), resolve), 'https://search.example.com/favicon.ico')
  assert.equal(await resolveFaviconUrl('https://search.example.com/?q=%s', page('http://router.lan/icon.png'), resolve), 'https://search.example.com/favicon.ico')
  assert.equal(await resolveFaviconUrl('https://search.example.com/?q=%s', page('https://cdn.example.net/icon.png'), resolve), 'https://cdn.example.net/icon.png')
  // A self-hosted engine on the local network keeps its icons there
  assert.equal(await resolveFaviconUrl('http://searx.lan/search?q=%s', page('http://192.168.1.1/icon.png'), resolve), 'http://192.168.1.1/icon.png')
  // An engine whose address cannot be looked up gets no exception
  assert.equal(await resolveFaviconUrl('https://unknown.example/?q=%s', page('http://192.168.1.1/icon.png'), resolve), 'https://unknown.example/favicon.ico')
  // nor does a public engine whose homepage redirects there
  const redirected = async () => Object.defineProperty(await page('/icon.png')(), 'url', { value: 'http://searx.lan/' })
  assert.equal(await resolveFaviconUrl('https://search.example.com/?q=%s', redirected, resolve), 'https://search.example.com/favicon.ico')
})

test('icon requests check each redirect target before requesting it', async () => {
  const requested = []
  // Electron's net.request reports a redirect instead of following it
  const request = ({ url }) => {
    requested.push(url)
    const clientRequest = new EventEmitter()
    Object.assign(clientRequest, { setHeader() {}, abort() {} })
    clientRequest.end = () => setImmediate(() => {
      const target = { 'https://cdn.example.net/icon.png': 'https://cdn.example.net/moved.png', 'https://cdn.example.net/moved.png': 'http://192.168.1.1/icon.png' }[url]
      if (target) clientRequest.emit('redirect', 302, 'GET', target)
      else clientRequest.emit('response', Object.assign(Readable.from([Buffer.from('icon')]), { statusCode: 200, headers: { 'content-type': 'image/png' } }))
    })
    return clientRequest
  }
  const isAllowed = async url => !new URL(url).hostname.startsWith('192.168.')

  const response = await fetchWithCheckedRedirects(request, 'https://cdn.example.net/other.png', {}, isAllowed)
  assert.equal(await response.text(), 'icon')
  requested.length = 0
  await assert.rejects(fetchWithCheckedRedirects(request, 'https://cdn.example.net/icon.png', {}, isAllowed), /local network/)
  assert.deepEqual(requested, ['https://cdn.example.net/icon.png', 'https://cdn.example.net/moved.png'])
})
