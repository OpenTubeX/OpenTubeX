import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SyncServerError,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
} from '../../src/renderer/helpers/sync-server-errors.js'

test('treats 401 as an expired session', () => {
  assert.equal(
    isSessionExpiredError(new SyncServerError('invalid or missing authentication token', 401)),
    true
  )
})

test('does not treat other sync server failures as an expired session', () => {
  // 403 is wrong credentials or someone else's resource, not a dead token
  assert.equal(isSessionExpiredError(new SyncServerError('invalid accountname or password', 403)), false)
  // 404 is an ordinary miss, e.g. a video not in the watch history
  assert.equal(isSessionExpiredError(new SyncServerError('not found', 404)), false)
  // rate limiting and quota errors are retryable or user-fixable
  assert.equal(isSessionExpiredError(new SyncServerError('too many requests', 429)), false)
  assert.equal(isSessionExpiredError(new SyncServerError('quota exceeded', 413)), false)
  assert.equal(isSessionExpiredError(new SyncServerError('server exploded', 500)), false)
})

test('ignores errors that are not sync server errors', () => {
  assert.equal(isSessionExpiredError(new Error('offline')), false)
  assert.equal(isSessionExpiredError(null), false)
  assert.equal(isSessionExpiredError(undefined), false)
  assert.equal(isSessionExpiredError({ status: 401 }), false)
})

test('preserves the baseline only when reauthenticating the same expired session', () => {
  const session = {
    expired: true,
    savedServerUrl: 'https://sync.example',
    savedUsername: 'alice',
    serverUrl: 'https://sync.example',
    username: 'alice',
  }

  assert.equal(isExpiredSessionReauthentication(session), true)
  assert.equal(isExpiredSessionReauthentication({ ...session, expired: false }), false)
  assert.equal(isExpiredSessionReauthentication({ ...session, serverUrl: 'https://other.example' }), false)
  assert.equal(isExpiredSessionReauthentication({ ...session, username: 'bob' }), false)
})
