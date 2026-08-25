import assert from 'node:assert/strict'
import test from 'node:test'

import { applySyncServerUserAgent } from '../../src/syncServerUserAgent.js'
import { createSyncServerRequestHeaders } from '../../src/renderer/helpers/sync-server-request.js'

test('unauthenticated sync requests expose the unchanged version through the user agent', () => {
  const requestHeaders = createSyncServerRequestHeaders({
    headers: { 'X-Request-Context': 'health-check' },
    version: '0.32.0-beta',
  })
  const headers = new Headers(applySyncServerUserAgent(Object.fromEntries(requestHeaders)))

  assert.equal(headers.get('Accept'), 'application/json')
  assert.equal(headers.get('User-Agent'), 'OpenTubeX/0.32.0-beta')
  assert.equal(headers.get('X-Request-Context'), 'health-check')
  assert.equal(headers.has('Authorization'), false)
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})

test('authenticated sync requests retain authentication, content type, and caller headers', () => {
  const requestHeaders = createSyncServerRequestHeaders({
    hasBody: true,
    headers: new Headers({
      Accept: 'application/vnd.sync+json',
      'X-Request-Context': 'encrypted-sync',
    }),
    token: 'sync-token',
    version: '0.32.0-nightly-976',
  })
  const headers = new Headers(applySyncServerUserAgent(Object.fromEntries(requestHeaders)))

  assert.equal(headers.get('Accept'), 'application/vnd.sync+json')
  assert.equal(headers.get('Authorization'), 'sync-token')
  assert.equal(headers.get('Content-Type'), 'application/json')
  assert.equal(headers.get('User-Agent'), 'OpenTubeX/0.32.0-nightly-976')
  assert.equal(headers.get('X-Request-Context'), 'encrypted-sync')
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})

test('browser sync requests do not add the Electron-only version marker', () => {
  const headers = createSyncServerRequestHeaders({ version: '' })

  assert.equal(headers.get('Accept'), 'application/json')
  assert.equal(headers.has('OpenTubeX-Client-Version'), false)
})
