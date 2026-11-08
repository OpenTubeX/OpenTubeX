import assert from 'node:assert/strict'
import test from 'node:test'

import { syncServerResponseErrorMessage } from '../../src/renderer/helpers/sync-server-errors.js'

test('keeps short plain-text messages from the sync server', () => {
  assert.equal(syncServerResponseErrorMessage(403, 'Wrong credentials\n'), 'Wrong credentials')
  assert.equal(syncServerResponseErrorMessage(500, 'Internal database error'), 'Internal database error')
})

test('replaces proxy error pages with a short message', () => {
  // Cloudflare answers JSON requests with a JSON error page when the tunnel is down.
  const cloudflare = JSON.stringify({ title: 'Error 502: Bad gateway', status: 502, detail: 'The origin web server returned an invalid or incomplete response to Cloudflare.' })
  assert.equal(syncServerResponseErrorMessage(502, cloudflare), 'Sync server is temporarily unavailable (HTTP 502). Sync will try again later.')
  assert.equal(syncServerResponseErrorMessage(504, '<!DOCTYPE html><html>…</html>'), 'Sync server is temporarily unavailable (HTTP 504). Sync will try again later.')
  assert.equal(syncServerResponseErrorMessage(413, '<html>Request Entity Too Large</html>'), 'Sync server returned HTTP 413')
  assert.equal(syncServerResponseErrorMessage(500, 'x'.repeat(301)), 'Sync server is temporarily unavailable (HTTP 500). Sync will try again later.')
  assert.equal(syncServerResponseErrorMessage(503, ''), 'Sync server is temporarily unavailable (HTTP 503). Sync will try again later.')
})
