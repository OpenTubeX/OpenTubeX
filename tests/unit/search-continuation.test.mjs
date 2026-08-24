import assert from 'node:assert/strict'
import test from 'node:test'

import { loadSearchContinuation } from '../../src/renderer/helpers/search-continuation.js'

test('treats a search continuation without contents as exhausted', async () => {
  const result = await loadSearchContinuation(async () => {
    throw new Error('No contents found in search response')
  })

  assert.equal(result, null)
})

test('treats a search without a continuation as exhausted', async () => {
  const result = await loadSearchContinuation(async () => {
    throw new Error('There are no continuations')
  })

  assert.equal(result, null)
})

test('preserves unexpected search continuation errors', async () => {
  const error = new Error('Search request failed')

  await assert.rejects(loadSearchContinuation(async () => {
    throw error
  }), error)
})
