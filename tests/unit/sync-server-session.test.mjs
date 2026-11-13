import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SyncServerError,
  isAccountDeletedError,
  isExpiredSessionReauthentication,
  isSessionExpiredError,
} from '../../src/renderer/helpers/sync-server-errors.js'

test('treats 401 as an expired session', () => {
  assert.equal(
    isSessionExpiredError(new SyncServerError('invalid or missing authentication token', 401)),
    true
  )
})

test('treats a token whose account was deleted as an expired session', () => {
  // Servers answer authenticated requests for a deleted account with 404.
  assert.equal(isSessionExpiredError(new SyncServerError("account doesn't exist", 404)), true)
  assert.equal(isSessionExpiredError(new SyncServerError("playlist doesn't exist", 404)), false)
})

test('only a missing account proves that the account was deleted', () => {
  assert.equal(isAccountDeletedError(new SyncServerError("account doesn't exist", 404)), true)
  // A revoked session also rejects the token, but the account may still exist.
  assert.equal(isAccountDeletedError(new SyncServerError('invalid or missing authentication token', 401)), false)
  assert.equal(isAccountDeletedError(new SyncServerError("playlist doesn't exist", 404)), false)
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
