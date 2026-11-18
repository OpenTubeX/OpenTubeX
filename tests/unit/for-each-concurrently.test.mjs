import assert from 'node:assert/strict'
import test from 'node:test'

import { forEachConcurrently } from '../../src/renderer/helpers/forEachConcurrently.js'

/**
 * Tasks that finish when the test answers them, by value.
 */
function controlledTasks() {
  const started = []
  /** @type {Map<string, () => void>} */
  const pending = new Map()
  const task = value => new Promise((resolve) => {
    started.push(value)
    pending.set(value, resolve)
  })
  const finish = (value) => {
    pending.get(value)()
    pending.delete(value)
  }
  return { task, started, pending, finish }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('keeps loading other servers while one server stalls', async () => {
  const values = ['stuck/1', 'stuck/2', 'stuck/3', 'stuck/4', 'stuck/5', 'fast/1', 'fast/2', 'other/1']
  const { task, started, finish } = controlledTasks()
  const done = forEachConcurrently(values, new AbortController().signal, task, {
    limit: 6, perGroup: 2, group: value => value.split('/')[0]
  })
  await settle()
  // Two from each server, within the overall limit
  assert.deepEqual(started.toSorted(), ['fast/1', 'fast/2', 'other/1', 'stuck/1', 'stuck/2'])

  // The stalled server's values wait for its own slots, not for the other servers
  finish('fast/1')
  finish('other/1')
  await settle()
  assert.equal(started.length, 5)
  finish('stuck/1')
  await settle()
  assert.deepEqual(started.slice(5), ['stuck/3'])

  for (const value of ['fast/2', 'stuck/2', 'stuck/3']) finish(value)
  await settle()
  for (const value of ['stuck/4', 'stuck/5']) finish(value)
  await done
  assert.deepEqual(started.toSorted(), values.toSorted())
})

test('runs no more than the overall limit and stops when aborted', async () => {
  const values = Array.from({ length: 6 }, (_, index) => `server-${index}/1`)
  const controller = new AbortController()
  const { task, started, pending, finish } = controlledTasks()
  const done = forEachConcurrently(values, controller.signal, task, {
    limit: 2, perGroup: 4, group: value => value.split('/')[0]
  })
  await settle()
  assert.deepEqual(started, ['server-0/1', 'server-1/1'])

  finish('server-0/1')
  await settle()
  assert.deepEqual(started, ['server-0/1', 'server-1/1', 'server-2/1'])

  controller.abort()
  for (const value of [...pending.keys()]) finish(value)
  await done
  assert.equal(started.length, 3)
})
