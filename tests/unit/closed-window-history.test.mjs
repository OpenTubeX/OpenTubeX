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

test('history ignores empty windows, retains ten windows, and allows retry after failure', async () => {
  const history = new ClosedWindowHistory()
  history.remember({ tabs: [] })
  assert.equal(history.sessions.length, 0)
  for (let id = 0; id < 12; id++) history.remember({ tabs: [{ id }] })
  await assert.rejects(history.restore(async () => { throw new Error('failed') }))
  const restored = []
  for (let i = 0; i < 11; i++) await history.restore(async data => restored.push(data.tabs[0].id))
  assert.deepEqual(restored, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
})
