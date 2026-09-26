import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenUrlRouter } from '../../src/main/openUrlRouting.js'

const rootAppUrl = 'app://bundle/index.html'
const isTrustedUrl = url => url.protocol === 'app:'
const route = createOpenUrlRouter({ rootAppUrl, isTrustedUrl })

test('external video URLs preserve timestamp, playlist, comment, and short context', () => {
  assert.equal(
    route('https://www.youtube.com/shorts/abcdefghijk?t=1m30s&list=PL123&lc=comment'),
    `${rootAppUrl}#/watch/abcdefghijk?timestamp=90&playlistId=PL123&commentId=comment&short=true`
  )
  assert.equal(route('https://youtu.be/abcdefghijk?t=42'), `${rootAppUrl}#/watch/abcdefghijk?timestamp=42`)
})

test('external playlist and search URLs retain unrelated query parameters', () => {
  assert.equal(
    route('https://www.youtube.com/playlist?list=PL123&foo=bar'),
    `${rootAppUrl}#/playlist/PL123?foo=bar`
  )
  assert.equal(
    route('https://www.youtube.com/results?search_query=a+b&sort=recent'),
    `${rootAppUrl}#/search/a%20b?sort=recent`
  )
})

test('trusted app URLs pass through while unsupported URLs stay pending', () => {
  assert.equal(route('app://bundle/index.html#/watch/abcdefghijk'), 'app://bundle/index.html#/watch/abcdefghijk')
  assert.equal(route('https://example.com/video'), null)
  assert.equal(route('not a url'), null)
  assert.equal(route(null), null)
})
