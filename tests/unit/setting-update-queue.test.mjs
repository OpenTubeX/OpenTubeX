import assert from 'node:assert/strict'
import test from 'node:test'

import { createOptimisticSettingUpdater, createSettingUpdateQueue } from '../../src/renderer/helpers/settingUpdateQueue.js'

function deferred () {
  let resolvePromise
  const promise = new Promise(resolve => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

test('optimistic list edits compose before persistence and survive delayed earlier writes', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['first', 'second', 'third']
  let persisted = value
  const options = {
    read: () => value,
    commit: next => { value = next },
    persist: async next => {
      if (next.includes('second')) {
        started.resolve()
        await release.promise
      }
      persisted = next
    },
  }
  const first = update('items', value.filter(id => id !== 'first'), options)
  await started.promise
  const second = update('items', value.filter(id => id !== 'second'), options)
  assert.deepEqual(value, ['third'])
  release.resolve()
  await Promise.all([first, second])
  assert.deepEqual(value, ['third'])
  assert.deepEqual(persisted, ['third'])
})

test('a failed latest list edit restores the last successful write, not an obsolete optimistic value', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['first', 'second', 'third']
  const options = {
    read: () => value,
    commit: next => { value = next },
    persist: async next => {
      if (next.length === 2) {
        started.resolve()
        await release.promise
      } else {
        throw new Error('Disk write failed')
      }
    },
  }
  const first = update('items', ['second', 'third'], options)
  await started.promise
  const second = update('items', ['third'], options)
  const failure = assert.rejects(second, /Disk write failed/)
  release.resolve()
  await Promise.all([first, failure])
  assert.deepEqual(value, ['second', 'third'])
})

test('a failed optimistic write cannot roll back a newer synchronized value', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['original']
  const pending = update('items', ['local'], {
    read: () => value,
    commit: next => { value = next },
    persist: async () => {
      started.resolve()
      await release.promise
      throw new Error('Disk write failed')
    },
  })
  const failure = assert.rejects(pending, /Disk write failed/)
  await started.promise
  value = ['synchronized']
  release.resolve()
  await failure
  assert.deepEqual(value, ['synchronized'])
})

test('edits after synchronization use the synchronized rollback baseline', async () => {
  const update = createOptimisticSettingUpdater()
  const started = deferred()
  const release = deferred()
  let value = ['original']
  const options = {
    read: () => value,
    commit: next => { value = next },
    persist: async () => {
      started.resolve()
      await release.promise
      throw new Error('Disk write failed')
    },
  }
  const first = assert.rejects(update('items', ['first'], options), /Disk write failed/)
  await started.promise
  value = ['synchronized']
  const second = assert.rejects(update('items', ['second'], options), /Disk write failed/)
  release.resolve()
  await Promise.all([first, second])
  assert.deepEqual(value, ['synchronized'])
})

test('keeps an in-flight setting write from applying after a newer update', async () => {
  const runUpdate = createSettingUpdateQueue()
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const appliedValues = []

  const first = runUpdate('scrollbarThumbWidth', async isLatest => {
    firstStarted.resolve()
    await releaseFirst.promise
    if (isLatest()) appliedValues.push(7)
  })
  await firstStarted.promise

  const second = runUpdate('scrollbarThumbWidth', async isLatest => {
    if (isLatest()) appliedValues.push(8)
  })
  const third = runUpdate('scrollbarThumbWidth', async isLatest => {
    if (isLatest()) appliedValues.push(9)
  })

  releaseFirst.resolve()
  await Promise.all([first, second, third])

  assert.deepEqual(appliedValues, [9])
})

test('continues with the latest setting write after an earlier write fails', async () => {
  const runUpdate = createSettingUpdateQueue()
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const appliedValues = []

  const first = runUpdate('scrollbarThumbWidth', async () => {
    firstStarted.resolve()
    await releaseFirst.promise
    throw new Error('write failed')
  })
  await firstStarted.promise

  const second = runUpdate('scrollbarThumbWidth', async isLatest => {
    if (isLatest()) appliedValues.push(8)
  })

  releaseFirst.resolve()
  await assert.rejects(first, /write failed/)
  await second

  assert.deepEqual(appliedValues, [8])
})
