import assert from 'node:assert/strict'
import test from 'node:test'

import { mapConcurrently } from '../../src/renderer/helpers/concurrent-map.js'

test('reserves each item before the mapper awaits', async () => {
  let releaseMappers
  const mapperGate = new Promise(resolve => {
    releaseMappers = resolve
  })
  const mappedItems = []

  const resultPromise = mapConcurrently(['first', 'second'], 8, async item => {
    mappedItems.push(item)
    await mapperGate
    return item.toUpperCase()
  })

  await Promise.resolve()
  assert.deepEqual(mappedItems, ['first', 'second'])

  releaseMappers()
  assert.deepEqual(await resultPromise, ['FIRST', 'SECOND'])
  assert.equal(mappedItems.includes(undefined), false)
})

test('stops scheduling after a failure and rejects once the items in flight settle', async () => {
  const slow = Promise.withResolvers()
  const started = []
  let settled = false

  const resultPromise = mapConcurrently(['fails', 'slow', 'later'], 2, async item => {
    started.push(item)
    if (item === 'fails') throw new Error('failed')
    if (item === 'slow') await slow.promise
  })
  resultPromise.catch(() => {}).finally(() => { settled = true })

  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(settled, false, 'the failure must wait for the item in flight')

  slow.resolve()
  await assert.rejects(resultPromise, /failed/)
  assert.deepEqual(started, ['fails', 'slow'])
})
