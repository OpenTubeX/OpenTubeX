import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

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

const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const optimisticPersistence = ['function getSettingSyncTimestamps(', 'function normalizeSettingSyncTimestamps(', 'function persistOptimisticSetting(']
  .map(start => {
    const index = settingsSource.indexOf(start)
    assert.ok(index >= 0, `Update the harness after renaming ${start}`)
    return settingsSource.slice(index, settingsSource.indexOf('\n}\n', index) + 3)
  })
  .join('\n')

test('an optimistic setting value is visible to sync only with its edit time', async () => {
  const writes = []
  const recorded = []
  const state = { uiScale: 100, syncServerSettingUpdatedAt: { theme: 1 } }
  let now = 1000
  const persistOptimisticSetting = vm.runInNewContext(`${optimisticPersistence}\npersistOptimisticSetting`, {
    Date: { now: () => now },
    isSettingSyncable: () => true,
    defaultMutationId: id => `set${id}`,
    updateOptimisticSetting: createOptimisticSettingUpdater(),
    recordSettingSyncTimestamp: async (_commit, _settings, settingId, editedAt) => { recorded.push([settingId, editedAt]) },
    DBSettingHandlers: { upsert: () => { const write = deferred(); writes.push(write); return write.promise } },
  })
  const commit = (name, value) => { state[name[3].toLowerCase() + name.slice(4)] = value }

  const first = persistOptimisticSetting(commit, state, 'uiScale', 125)
  assert.equal(state.uiScale, 125)
  assert.deepEqual({ ...state.syncServerSettingUpdatedAt }, { theme: 1, uiScale: 1000 })
  await new Promise(resolve => setImmediate(resolve))

  now = 2000
  const second = persistOptimisticSetting(commit, state, 'uiScale', 150)
  assert.equal(state.syncServerSettingUpdatedAt.uiScale, 2000)
  writes[0].resolve()
  await first
  assert.deepEqual(recorded, [], 'a superseded write does not save its older edit time')
  await new Promise(resolve => setImmediate(resolve))
  writes[1].resolve()
  await second
  assert.deepEqual(recorded, [['uiScale', 2000]])
})

test('a failed optimistic write restores the saved edit time with the saved value', async () => {
  const state = { uiScale: 100, syncServerSettingUpdatedAt: { uiScale: 500 } }
  const persistOptimisticSetting = vm.runInNewContext(`${optimisticPersistence}\npersistOptimisticSetting`, {
    Date: { now: () => 1000 },
    isSettingSyncable: () => true,
    defaultMutationId: id => `set${id}`,
    updateOptimisticSetting: createOptimisticSettingUpdater(),
    recordSettingSyncTimestamp: async () => assert.fail('a failed write records no edit time'),
    DBSettingHandlers: { upsert: async () => { throw new Error('disk full') } },
  })
  const commit = (name, value) => { state[name[3].toLowerCase() + name.slice(4)] = value }

  const update = persistOptimisticSetting(commit, state, 'uiScale', 125)
  assert.equal(state.syncServerSettingUpdatedAt.uiScale, 1000)
  await assert.rejects(update)
  assert.equal(state.uiScale, 100)
  assert.equal(state.syncServerSettingUpdatedAt.uiScale, 500)
})

test('edit time writes save only confirmed times and keep newer optimistic ones in memory', async () => {
  const start = settingsSource.indexOf('function recordSettingSyncTimestamp(')
  const recordSource = settingsSource.slice(start, settingsSource.indexOf('\n}\n', start) + 3)
  const write = deferred()
  const saved = []
  // locale has an optimistic edit time whose write is still pending.
  const state = { syncServerSettingUpdatedAt: { theme: 1, locale: 5000 } }
  const commit = (_name, value) => { state.syncServerSettingUpdatedAt = value }
  const recordSettingSyncTimestamp = vm.runInNewContext(`${optimisticPersistence}
    let settingSyncTimestampWrite = Promise.resolve()
    ${recordSource}
    recordSettingSyncTimestamp`, {
    isSettingSyncable: () => true,
    CUSTOM_THEMES_SYNC_KEY: 'customThemes',
    DBSettingHandlers: {
      findValue: async () => ({ theme: 1 }),
      upsert: (_id, value) => { saved.push({ ...value }); return write.promise },
    },
    console,
  })

  const recording = recordSettingSyncTimestamp(commit, state, 'uiScale', 1000)
  await new Promise(resolve => setImmediate(resolve))
  state.syncServerSettingUpdatedAt = { ...state.syncServerSettingUpdatedAt, uiScale: 2000, theme: 3000 }
  write.resolve()
  await recording

  assert.deepEqual(saved, [{ theme: 1, uiScale: 1000 }])
  assert.deepEqual({ ...state.syncServerSettingUpdatedAt }, { theme: 3000, locale: 5000, uiScale: 2000 })
})

test('generated setting updaters report whether the write was saved', async () => {
  const generator = settingsSource.slice(settingsSource.indexOf('const getters = {}'), settingsSource.indexOf('// Add all custom data'))
  let failWrites = false
  const actions = vm.runInNewContext(`${optimisticPersistence}\n${generator}\nactions`, {
    state: { uiScale: 100, theme: 'dark' },
    settingsWithSideEffects: ['theme'],
    sideEffectHandlers: { theme: () => {} },
    defaultGetterId: id => `get${id}`,
    defaultMutationId: id => `set${id}`,
    defaultUpdaterId: id => `update${id}`,
    defaultSideEffectsTriggerId: id => `trigger${id}`,
    createSettingUpdateQueue,
    updateOptimisticSetting: createOptimisticSettingUpdater(),
    recordSettingSyncTimestamp: async () => {},
    isSettingSyncable: () => false,
    DBSettingHandlers: { upsert: async () => { if (failWrites) throw new Error('disk full') } },
    console: { error () {} },
  })
  const state = { uiScale: 100, theme: 'dark' }
  const context = { commit (name, value) { state[name.slice(3)] = value }, dispatch () {}, state }

  assert.equal(await actions.updateuiScale(context, 125), true)
  assert.equal(await actions.updatetheme(context, 'light'), true)
  failWrites = true
  const failedUpdate = actions.updateuiScale(context, 150)
  assert.equal(state.uiScale, 150, 'settings without side effects apply before their write')
  assert.equal(await failedUpdate, false)
  assert.equal(state.uiScale, 125, 'a failed write restores the saved value')
  assert.equal(await actions.updatetheme(context, 'black'), false)
  assert.equal(state.theme, 'light')
})
