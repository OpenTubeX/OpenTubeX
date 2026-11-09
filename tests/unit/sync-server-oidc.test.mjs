import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SyncServerOidcCallbacks,
  getSyncServerOidcCallbackToken,
  isSyncServerOidcCallbackUrl,
  isSyncServerOidcUsername,
  syncServerOidcLoginUrl,
  syncServerOidcUsername,
} from '../../src/renderer/helpers/sync-server-oidc.js'

function token(claims) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`
}

test('recognizes only the OIDC callback URL', () => {
  assert.equal(isSyncServerOidcCallbackUrl('opentubex://oidc?token=abc'), true)
  assert.equal(isSyncServerOidcCallbackUrl('opentubex://oidc'), true)
  // Windows may append a slash to protocol arguments.
  assert.equal(isSyncServerOidcCallbackUrl('opentubex://oidc/?token=abc'), true)
  assert.equal(isSyncServerOidcCallbackUrl('OpenTubeX://OIDC?token=abc'), true)
  assert.equal(isSyncServerOidcCallbackUrl('opentubex://oidcx?token=abc'), false)
  assert.equal(isSyncServerOidcCallbackUrl('opentubex://https://www.youtube.com/watch?v=abc'), false)
  assert.equal(isSyncServerOidcCallbackUrl('https://oidc/?token=abc'), false)
  assert.equal(isSyncServerOidcCallbackUrl('--allow-file-access-from-files'), false)
  assert.equal(isSyncServerOidcCallbackUrl(undefined), false)
})

test('reads the session token from login callbacks', () => {
  assert.equal(getSyncServerOidcCallbackToken('opentubex://oidc?token=a.b.c'), 'a.b.c')
  assert.equal(getSyncServerOidcCallbackToken('opentubex://oidc'), '')
})

test('starts the login with the redirect URL and this device', () => {
  const url = new URL(syncServerOidcLoginUrl('https://sync.example/base', 'device-1'))
  assert.equal(url.origin + url.pathname, 'https://sync.example/base/v1/account/oidc/authenticate')
  assert.equal(url.searchParams.get('redirect_url'), 'opentubex://oidc')
  assert.equal(url.searchParams.get('device_id'), 'device-1')
})

test('names OIDC accounts after the account the token belongs to', () => {
  const username = syncServerOidcUsername(token({ sub: '0198e2d4-8ad2-7f73', exp: 1 }))
  assert.equal(username, 'OIDC-ACCOUNT-0198e2d4-8ad2-7f73')
  assert.equal(isSyncServerOidcUsername(username), true)
  assert.equal(isSyncServerOidcUsername('alice'), false)
  // base64url without padding, including characters that differ from base64
  assert.equal(syncServerOidcUsername(token({ sub: '??>>' })), 'OIDC-ACCOUNT-??>>')
})

test('rejects tokens without an account', () => {
  for (const value of ['', 'not-a-token', token({}), token({ sub: '' }), token({ sub: 1 })]) {
    assert.throws(() => syncServerOidcUsername(value), /invalid session/)
  }
})

test('hands callbacks only to a waiting flow', async () => {
  const callbacks = new SyncServerOidcCallbacks()
  assert.equal(callbacks.receive('opentubex://oidc?token=early'), false)

  const callback = callbacks.wait()
  assert.equal(callbacks.receive('https://example.com'), false)
  assert.equal(callbacks.receive('opentubex://oidc?token=a'), true)
  assert.equal(await callback, 'opentubex://oidc?token=a')
  assert.equal(callbacks.receive('opentubex://oidc?token=b'), false)
})

test('cancels a waiting flow', async () => {
  const callbacks = new SyncServerOidcCallbacks()
  const callback = callbacks.wait()
  const error = new Error('cancelled')
  callbacks.cancel(error)
  await assert.rejects(callback, error)
  assert.equal(callbacks.receive('opentubex://oidc?token=a'), false)
  callbacks.cancel(new Error('nothing waits'))
})
