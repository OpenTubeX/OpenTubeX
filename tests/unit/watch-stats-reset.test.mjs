import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction, runInNewContext } from 'node:vm'
import { babelParse } from 'vue/compiler-sfc'
import { createWatchStatsHelpers } from '../helpers/sync-watch-stats.mjs'

const source = readFileSync(new URL('../../src/renderer/store/modules/watch-stats.js', import.meta.url), 'utf8')
const loadStore = compileFunction(source.replace(/^import .*\n/gm, '').replace('export default', 'return'),
  ['DBWatchStatsHandlers', 'getDataScope', 'createWatchStatsReset', 'savedWatchStatsReset', 'console'])
const { savedWatchStatsReset } = createWatchStatsHelpers()

function fixture({ saveFails = false, deleteFails = false, dataScope = null } = {}) {
  let deleted = false
  const writes = []
  const previous = { id: 'previous', at: 100 }
  const resetTimes = []
  const settings = { syncServerDeviceId: 'pixel', syncServerWatchStatsReset: previous, syncServerScopedWatchStatsResets: {} }
  const reset = { id: 'next' }
  const store = loadStore({
    deleteAll: async () => {
      writes.push('delete')
      if (deleteFails) throw new Error('Delete failed')
      deleted = true
    }
  }, () => dataScope, (_devices, _deviceId, at) => {
    resetTimes.push(at)
    return reset
  }, savedWatchStatsReset, { error: () => {} })
  const context = {
    state: store.state,
    rootState: { settings },
    dispatch: async (name, { scope, reset: value }) => {
      assert.equal(name, 'updateWatchStatsReset')
      // Generated settings actions log persistence errors and resolve to false without committing.
      if (saveFails) return false
      if (scope === null) settings.syncServerWatchStatsReset = value
      else settings.syncServerScopedWatchStatsResets = { ...settings.syncServerScopedWatchStatsResets, [scope]: value }
      writes.push(value)
      return true
    },
    commit: name => writes.push(name)
  }
  return { run: () => store.actions.clearWatchStats(context), deleted: () => deleted, settings, writes, previous, reset, resetTimes }
}

test('failed reset persistence leaves local records and the previous marker untouched', async () => {
  const f = fixture({ saveFails: true })
  assert.equal(await f.run(), false)
  assert.equal(f.deleted(), false)
  assert.equal(f.settings.syncServerWatchStatsReset, f.previous)
  assert.deepEqual(f.writes, [])
})

test('reset saves its marker before deleting local records and updating the view', async () => {
  const f = fixture()
  assert.equal(await f.run(), true)
  assert.equal(f.deleted(), true)
  assert.deepEqual(f.writes, [f.reset, 'delete', 'resetWatchStats'])
})

test('a reset orders after the previous one when the clock moved back', async (t) => {
  const f = fixture()
  // Windows tell time from before a clear by this order
  t.mock.method(Date, 'now', () => 90)
  await f.run()
  assert.ok(f.resetTimes[0] > f.previous.at)
})

test('a failed deletion restores the previous reset marker', async () => {
  const f = fixture({ deleteFails: true })
  assert.equal(await f.run(), false)
  assert.equal(f.deleted(), false)
  assert.equal(f.settings.syncServerWatchStatsReset, f.previous)
  assert.deepEqual(f.writes, [f.reset, 'delete', f.previous])
})

test('watch-time writes report whether the datastore saved them', async () => {
  let fails = true
  const commits = []
  const store = loadStore({
    addWatchTime: async () => { if (fails) throw new Error('Write failed') }
  }, () => null, () => null, savedWatchStatsReset, { error: () => {} })
  const context = { commit: (name, value) => commits.push([name, value]) }
  const payload = { date: '2026-10-20', seconds: 3 }
  assert.equal(await store.actions.recordWatchTime(context, payload), false)
  assert.deepEqual(commits, [])
  fails = false
  assert.equal(await store.actions.recordWatchTime(context, payload), true)
  assert.deepEqual(commits, [['addWatchTime', payload]])
})

test('a separate profile resets its own statistics, replaced devices included, and leaves the shared reset alone', async () => {
  const f = fixture({ dataScope: 'separate' })
  assert.equal(await f.run(), true)
  assert.equal(f.deleted(), true)
  assert.equal(f.settings.syncServerWatchStatsReset, f.previous)
  assert.equal(f.settings.syncServerScopedWatchStatsResets.separate, f.reset)
  assert.equal(f.resetTimes.length, 1)

  // The saved reset clears the time of the devices replaced in this profile.
  const { createWatchStatsReset, watchSecondsForDevice } = createWatchStatsHelpers()
  const day = '2026-10-02'
  const devices = [{ deviceId: 'pixel', days: { [day]: 100 }, replacedDevices: [{ deviceId: 'old', days: { [day]: 20 }, overlap: 'sum', replacedAt: 1 }] }]
  assert.deepEqual(watchSecondsForDevice({ [day]: 100 }, devices, 'pixel', 'all'), { [day]: 120 })
  const reset = createWatchStatsReset(devices, 'pixel', 2)
  assert.equal(watchSecondsForDevice({}, devices, 'pixel', 'all', reset)[day] ?? 0, 0)
})

test('sync acknowledges an uploaded reset only while it is still the saved one', async () => {
  const settingsSource = readFileSync(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const program = babelParse(settingsSource, { sourceType: 'module' }).program.body
  const helpers = program.filter(node => /^(runLocked|runLockedSettingUpdate|pendingLocks)$/.test(node.type === 'VariableDeclaration' ? node.declarations[0].id.name : node.id?.name))
  const action = program
    .find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'customActions')
    .declarations[0].init.properties.find(node => node.key?.name === 'updateWatchStatsReset')
  // Another window saved a newer reset after this one uploaded the older one.
  const newer = { id: 'newer', at: 2, pending: true }
  const saved = { syncServerWatchStatsReset: newer, syncServerScopedWatchStatsResets: { kids: newer } }
  const actions = runInNewContext(`${helpers.map(node => settingsSource.slice(node.start, node.end)).join('\n')}
    ({ ${settingsSource.slice(action.start, action.end)} })`, {
    console,
    DBSettingHandlers: {
      findValue: async id => structuredClone(saved[id]),
      upsert: async (id, value) => { saved[id] = value },
    },
  })
  const store = {
    commit: () => {},
    dispatch: async (name, value) => {
      assert.equal(name, 'updateSyncServerWatchStatsReset')
      saved.syncServerWatchStatsReset = value
    },
  }
  for (const scope of [null, 'kids']) {
    await actions.updateWatchStatsReset(store, { scope, reset: { id: 'older', at: 1 }, pendingId: 'older' })
  }
  assert.deepEqual(saved, { syncServerWatchStatsReset: newer, syncServerScopedWatchStatsResets: { kids: newer } })
  for (const scope of [null, 'kids']) {
    await actions.updateWatchStatsReset(store, { scope, reset: { id: 'newer', at: 2 }, pendingId: 'newer' })
  }
  assert.deepEqual(structuredClone(saved), { syncServerWatchStatsReset: { id: 'newer', at: 2 }, syncServerScopedWatchStatsResets: { kids: { id: 'newer', at: 2 } } })
})
