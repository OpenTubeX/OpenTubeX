import assert from 'node:assert/strict'
import test from 'node:test'

import { mapConcurrently } from '../../src/renderer/helpers/concurrent-map.js'

test('rejects invalid concurrency', async () => {
  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      mapConcurrently([], concurrency, async item => item),
      new RangeError('concurrency must be a positive integer')
    )
  }
})

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
