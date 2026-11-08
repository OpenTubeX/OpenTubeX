import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractFaviconUrl,
  fetchFaviconDataUrl,
  resolveFaviconUrl
} from '../../src/main/favicon.js'

test('discovers relative favicons and prefers exact-size menu icons', () => {
  const html = `
    <link rel="shortcut icon" href="/favicon.ico" type="image/x-icon">
    <link rel="icon" sizes="32x32" href="/assets/favicon.png" type="image/png">
    <link rel="icon" href="https://cdn.example.com/icon.svg" type="image/svg+xml">
  `

  assert.equal(
    extractFaviconUrl(html, 'https://search.example.com/'),
    'https://search.example.com/assets/favicon.png'
  )
})

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

test('falls back to the conventional favicon URL when discovery fails', async () => {
  const icon = await resolveFaviconUrl(
    'https://search.example.com/find?q=%s',
    async () => {
      throw new Error('offline')
    }
  )

  assert.equal(icon, 'https://search.example.com/favicon.ico')
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

test('decodes character references in favicon URLs', () => {
  const html = `
    <link rel="icon" sizes="32x32" href="/icon.png?a=1&amp;b=2&#38;c=&#x33;&quot;&AMP;d=4">
  `

  assert.equal(
    extractFaviconUrl(html, 'https://search.example.com/'),
    'https://search.example.com/icon.png?a=1&b=2&c=3%22&d=4'
  )
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
