import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction } from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/sync-watch-stats.js', import.meta.url), 'utf8')
const createHelpers = compileFunction(
  source.replace(/^import .*\n/gm, '').replaceAll('export ', '') +
    '\nreturn { mergeWatchStats, syncWatchStats, watchSecondsForDevice }',
  ['DBWatchStatsHandlers', 'getCurrentSyncServerDeviceInfo']
)

test('statistics stay separate by device and combined totals count local time once', () => {
  const { mergeWatchStats, watchSecondsForDevice } = createHelpers({}, async () => ({ platform: 'linux' }))
  const remote = [
    { deviceId: 'local', deviceName: 'Old name', platform: 'linux', days: { '2026-09-22': 99 } },
    { deviceId: 'phone', deviceName: 'Phone', platform: 'android', days: { '2026-09-22': 30, '2026-09-23': 40 } },
  ]
  const local = [{ date: '2026-09-22', seconds: 60 }]
  const merged = mergeWatchStats(remote, local, 'local', 'Desktop', 'linux')

  assert.deepEqual(merged, [
    { deviceId: 'local', deviceName: 'Desktop', platform: 'linux', days: { '2026-09-22': 60 } },
    remote[1],
  ])
  assert.deepEqual(watchSecondsForDevice({ '2026-09-22': 60 }, merged, 'local', 'all'), {
    '2026-09-22': 90,
    '2026-09-23': 40,
  })
  assert.deepEqual(watchSecondsForDevice({ '2026-09-22': 60 }, merged, 'local', 'phone'), remote[1].days)
  assert.deepEqual(watchSecondsForDevice({ '2026-09-22': 60 }, merged, 'local', 'local'), {
    '2026-09-22': 60,
  })
})

test('sync uploads local resets without removing other devices or rewriting unchanged data', async () => {
  let records = [{ date: '2026-09-22', seconds: 60 }]
  let remote = [{ deviceId: 'phone', deviceName: 'Phone', platform: 'android', days: { '2026-09-22': 30 } }]
  let uploads = 0
  let applied
  const { syncWatchStats } = createHelpers({ find: async () => records }, async () => ({ platform: 'linux' }))
  const client = {
    getWatchStats: async () => structuredClone(remote),
    putWatchStats: async value => { remote = structuredClone(value); uploads++ },
  }
  const store = {
    state: { settings: { syncServerDeviceId: 'local', syncServerDeviceName: 'Desktop' } },
    commit: (_, value) => { applied = value },
  }

  await syncWatchStats(client, store)
  assert.equal(uploads, 1)
  await syncWatchStats(client, store)
  assert.equal(uploads, 1)

  records = []
  await syncWatchStats(client, store)
  assert.equal(uploads, 2)
  assert.deepEqual(remote, [
    { deviceId: 'phone', deviceName: 'Phone', platform: 'android', days: { '2026-09-22': 30 } },
    { deviceId: 'local', deviceName: 'Desktop', platform: 'linux', days: {} },
  ])
  assert.deepEqual(applied, remote)
})
