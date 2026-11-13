import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { fetchRumblePage } from '../../src/main/rumblePages.js'

/**
 * A fake `net` whose requests answer from `pages`: either a redirect to another
 * address, or a page with a status, headers and body chunks.
 * @param {Record<string, { redirect: string } | { status?: number, headers?: Record<string, string>, chunks: string[] }>} pages
 */
function fakeNet(pages) {
  const requests = []
  return {
    requests,
    request(options) {
      const request = new EventEmitter()
      let url = options.url
      requests.push({ ...options, urls: [url], aborted: false })
      const record = requests.at(-1)
      const answer = () => {
        const page = pages[url]
        if ('redirect' in page) {
          request.emit('redirect', 307, 'GET', page.redirect)
          return
        }
        const response = new EventEmitter()
        response.statusCode = page.status ?? 200
        response.headers = page.headers ?? {}
        request.emit('response', response)
        for (const chunk of page.chunks) {
          if (record.aborted) return
          response.emit('data', Buffer.from(chunk))
        }
        if (!record.aborted) response.emit('end')
      }
      request.setHeader = () => {}
      request.abort = () => { record.aborted = true }
      request.followRedirect = () => {
        url = pages[url].redirect
        record.urls.push(url)
        queueMicrotask(answer)
      }
      request.end = () => queueMicrotask(answer)
      return request
    }
  }
}

test('loads only Rumble pages over HTTPS, with the session cookies', async () => {
  const net = fakeNet({ 'https://rumble.com/c/Example?page=2': { status: 404, chunks: ['<html>', '</html>'] } })
  assert.deepEqual(await fetchRumblePage(net, 'https://rumble.com/c/Example?page=2'), { status: 404, text: '<html></html>' })
  for (const url of [
    'http://rumble.com/c/Example',
    'https://rumble.com.example.test/c/Example',
    'https://notrumble.com/c/Example',
    'https://user@rumble.com/c/Example',
    'https://rumble.com:8443/c/Example',
    'file:///etc/passwd',
    'not a url',
    42
  ]) {
    await assert.rejects(fetchRumblePage(net, url), /Not a Rumble page/, String(url))
  }
  assert.equal(net.requests.length, 1)
  assert.equal(net.requests[0].redirect, 'manual')
  assert.equal(net.requests[0].useSessionCookies, true)
})

test('follows redirects only to Rumble pages', async () => {
  const net = fakeNet({
    'https://rumble.com/c/Example': { redirect: 'https://rumble.com/c/Example?checked' },
    'https://rumble.com/c/Example?checked': { chunks: ['<html>page</html>'] },
    'https://rumble.com/elsewhere': { redirect: 'http://127.0.0.1:8080/' },
    'http://127.0.0.1:8080/': { chunks: ['local'] },
    'https://rumble.com/loop': { redirect: 'https://rumble.com/loop' }
  })

  assert.deepEqual(await fetchRumblePage(net, 'https://rumble.com/c/Example'), { status: 200, text: '<html>page</html>' })
  assert.deepEqual(net.requests[0].urls, ['https://rumble.com/c/Example', 'https://rumble.com/c/Example?checked'])
  await assert.rejects(fetchRumblePage(net, 'https://rumble.com/elsewhere'), /Not a Rumble page/)
  assert.deepEqual(net.requests[1].urls, ['https://rumble.com/elsewhere'])
  assert.equal(net.requests[1].aborted, true)
  await assert.rejects(fetchRumblePage(net, 'https://rumble.com/loop'), /Too many redirects/)
})

test('rejects oversized Rumble pages', async () => {
  const declared = fakeNet({ 'https://rumble.com/': { headers: { 'content-length': '20000000' }, chunks: ['x'] } })
  await assert.rejects(fetchRumblePage(declared, 'https://rumble.com/'), /too large/)
  // Also without a declared length, while it streams
  const streamed = fakeNet({ 'https://rumble.com/': { chunks: Array.from({ length: 11 }, () => 'x'.repeat(1_000_000)) } })
  await assert.rejects(fetchRumblePage(streamed, 'https://rumble.com/'), /too large/)
  assert.equal(streamed.requests[0].aborted, true)
})
