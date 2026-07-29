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
    async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'text/html' }),
      // Electron net.fetch can omit Response.url even for successful requests.
      url: '',
      text: async () => '<link rel="icon" sizes="32x32" href="/favicon-32.png" type="image/png">'
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
