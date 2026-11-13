import assert from 'node:assert/strict'
import test from 'node:test'
import { ClosedWindowHistory } from '../../src/main/tabs/ClosedWindowHistory.js'

test('closed windows restore once each, newest first, with independent snapshots', async () => {
  const history = new ClosedWindowHistory()
  const session = { tabs: [{ id: 'first', previewFileName: 'deleted.webp' }], activeTabId: 'first' }
  history.remember(session)
  session.tabs[0].id = 'second'
  history.remember(session)
  const restored = []
  const create = async data => restored.push(data)
  await history.restore(create)
  await history.restore(create)
  await history.restore(create)
  assert.deepEqual(restored.map(data => data.tabs[0].id), ['second', 'first'])
  assert.equal(restored[1].activeTabId, 'first')
  assert.equal(restored[1].tabs[0].previewFileName, undefined)
})

test('serializes overlapping restores and preserves newest-first order after failure', async () => {
  const history = new ClosedWindowHistory()
  history.remember({ tabs: [{ id: 'older' }] })
  history.remember({ tabs: [{ id: 'newer' }] })
  let rejectFirst
  const started = []
  const first = history.restore(async session => {
    started.push(session.tabs[0].id)
    await new Promise((resolve, reject) => { rejectFirst = reject })
  })
  const failed = assert.rejects(first, /failed/)
  const second = history.restore(async session => { started.push(session.tabs[0].id) })
  await new Promise(setImmediate)
  assert.deepEqual(started, ['newer'])
  history.remember({ tabs: [{ id: 'newest' }] })
  rejectFirst(new Error('failed'))
  await failed
  await second
  await history.restore(async session => { started.push(session.tabs[0].id) })
  await history.restore(async session => { started.push(session.tabs[0].id) })
  assert.deepEqual(started, ['newer', 'newest', 'newer', 'older'])
})
