import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchFaviconDataUrl,
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
