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
