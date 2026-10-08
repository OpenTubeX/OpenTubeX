import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction } from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/store/modules/watch-stats.js', import.meta.url), 'utf8')
const loadStore = compileFunction(source.replace(/^import .*\n/gm, '').replace('export default', 'return'),
  ['DBWatchStatsHandlers', 'createWatchStatsReset', 'console'])

function fixture({ saveFails = false, deleteFails = false } = {}) {
  let deleted = false
  const writes = []
  const previous = { id: 'previous' }
  const settings = { syncServerDeviceId: 'pixel', syncServerWatchStatsReset: previous }
  const reset = { id: 'next' }
  const store = loadStore({ deleteAll: async () => {
    writes.push('delete')
    if (deleteFails) throw new Error('Delete failed')
    deleted = true
  } }, () => reset, { error: () => {} })
  const context = { state: store.state, rootState: { settings }, dispatch: async (_name, value) => {
    // Generated settings actions log persistence errors and resolve without committing.
    if (saveFails) return
    settings.syncServerWatchStatsReset = value
    writes.push(value)
  }, commit: name => writes.push(name) }
  return { run: () => store.actions.clearWatchStats(context), deleted: () => deleted, settings, writes, previous, reset }
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

test('a failed deletion restores the previous reset marker', async () => {
  const f = fixture({ deleteFails: true })
  assert.equal(await f.run(), false)
  assert.equal(f.deleted(), false)
  assert.equal(f.settings.syncServerWatchStatsReset, f.previous)
  assert.deepEqual(f.writes, [f.reset, 'delete', f.previous])
})
