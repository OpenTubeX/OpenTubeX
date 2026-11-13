import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestErrors } from '../../src/main/requestErrors.js'

test('reports a redirected request\'s error under the URL the renderer requested', () => {
  const errors = new RequestErrors()
  errors.rememberRequest({ id: 1, url: 'https://www.youtube.com/' })
  errors.rememberRequest({ id: 1, url: 'https://www.google.com/sorry/index' })
  errors.recordError({ id: 1, webContentsId: 7, error: 'net::ERR_TOO_MANY_REDIRECTS' }, 0)

  assert.equal(errors.getError(7, 'https://www.youtube.com/', 0), 'net::ERR_TOO_MANY_REDIRECTS')
  assert.equal(errors.getError(7, 'https://www.google.com/sorry/index', 0), null)
  assert.equal(errors.getError(8, 'https://www.youtube.com/', 0), null, 'another window must not see the error')
  assert.equal(errors.urls.size, 0)
})

test('forgets completed requests and expires errors', () => {
  const errors = new RequestErrors()
  errors.rememberRequest({ id: 1, url: 'https://example.com/ok' })
  errors.forgetRequest({ id: 1 })
  errors.recordError({ id: 1, webContentsId: 7, error: 'net::ERR_FAILED' }, 0)
  assert.equal(errors.getError(7, 'https://example.com/ok', 0), null)

  errors.rememberRequest({ id: 2, url: 'https://example.com/loop' })
  errors.recordError({ id: 2, webContentsId: 7, error: 'net::ERR_TOO_MANY_REDIRECTS' }, 0)
  assert.equal(errors.getError(7, 'https://example.com/loop', 10_000), null)

  errors.rememberRequest({ id: 3, url: 'https://example.com/other' })
  errors.recordError({ id: 3, webContentsId: 7, error: 'net::ERR_FAILED' }, 10_000)
  assert.equal(errors.errors.size, 1, 'recording prunes expired errors')
})
