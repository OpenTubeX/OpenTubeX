import assert from 'node:assert/strict'
import test from 'node:test'

import { withTimeout } from '../../src/main/promiseTimeout.js'

test('returns a result that settles before the timeout', async () => {
  await assert.doesNotReject(async () => {
    assert.equal(await withTimeout(Promise.resolve('token'), 100, 'timed out'), 'token')
  })
})

test('rejects work that does not settle before the timeout', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, 'PO token generation timed out'),
    /PO token generation timed out/
  )
})
