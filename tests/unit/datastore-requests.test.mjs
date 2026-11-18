import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatastoreRequestTracker } from '../../src/main/datastoreRequests.js'

test('waits for every datastore request that already started, including failed ones', async () => {
  const tracker = createDatastoreRequestTracker()
  let finishWrite
  const write = tracker.track(new Promise(resolve => { finishWrite = resolve }))
  const failed = tracker.track(Promise.reject(new Error('write failed')))
  await assert.rejects(failed)

  let settled = false
  const waiting = tracker.settled().then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)

  finishWrite('saved')
  assert.equal(await write, 'saved')
  await waiting
  assert.equal(settled, true)

  // Requests that finished are not waited for again.
  await tracker.settled()
})
