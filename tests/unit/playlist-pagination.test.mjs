import assert from 'node:assert/strict'
import test from 'node:test'

import { runRetryablePlaylistRequest } from '../../src/renderer/helpers/playlist-pagination.js'

test('clears playlist pagination loading after failure and retries the same page', async () => {
  const requestedPages = []
  const loadingStates = []
  const errors = []
  let nextPage = 2

  const runRequest = () => runRetryablePlaylistRequest({
    request: async () => {
      requestedPages.push(nextPage)
      if (requestedPages.length === 1) throw new Error('Synthetic pagination failure')
      nextPage++
    },
    setLoading: loading => loadingStates.push(loading),
    setError: error => errors.push(error),
  })

  const failed = await runRequest()
  assert.equal(failed.ok, false)
  assert.equal(nextPage, 2)
  assert.deepEqual(loadingStates, [true, false])
  assert.equal(errors[0], null)
  assert.match(errors[1].message, /Synthetic pagination failure/)

  const retried = await runRequest()
  assert.equal(retried.ok, true)
  assert.equal(nextPage, 3)
  assert.deepEqual(requestedPages, [2, 2])
  assert.deepEqual(loadingStates, [true, false, true, false])
  assert.equal(errors[2], null)
})
