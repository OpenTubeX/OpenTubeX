import assert from 'node:assert/strict'
import test from 'node:test'
import { EncryptedSyncAdapter } from '../../src/renderer/helpers/sync-server-privacy.js'
import { createWatchStatsHelpers as createHelpers } from '../helpers/sync-watch-stats.mjs'

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

test('a replaced device stays in the combined history without reappearing after sync', () => {
  const { mergeWatchStats, watchSecondsForDevice } = createHelpers({}, async () => ({ platform: 'android' }))
  const old = { deviceId: 'old', deviceName: 'Pixel', days: { '2026-10-01': 60, '2026-10-02': 120 }, overlap: 'max', replacedAt: 100 }
  const remote = [{ deviceId: 'new', deviceName: 'Pixel', platform: 'android', days: {}, replacedDevices: [old] }]
  const merged = mergeWatchStats(remote, [{ date: '2026-10-02', seconds: 180 }], 'new', 'Pixel', 'android')
  assert.deepEqual(watchSecondsForDevice({ '2026-10-02': 180 }, merged, 'new', 'all'), { '2026-10-01': 60, '2026-10-02': 180 })
  assert.deepEqual(watchSecondsForDevice({ '2026-10-02': 180 }, merged, 'new', 'local'), { '2026-10-01': 60, '2026-10-02': 180 })
  const fromOld = mergeWatchStats(merged, [{ date: '2026-10-02', seconds: 200 }], 'old', 'Pixel', 'android')
  assert.equal(fromOld.length, 1)
  assert.deepEqual(watchSecondsForDevice({ '2026-10-02': 180 }, fromOld, 'new', 'all'), { '2026-10-02': 200 })
})

test('replacement preserves original daily totals and offers an explicit overlap rule', () => {
  const helpers = createHelpers()
  const devices = [
    { deviceId: 'new', days: { '2026-10-02': 120 } },
    { deviceId: 'old', days: { '2026-10-01': 60, '2026-10-02': 100 } },
    { deviceId: 'other', days: { '2026-10-02': 20 } },
  ]
  const reset = { at: 101, generation: 1, origin: 'new', baselines: { new: {}, old: devices[1].days } }
  for (const [overlap, expected] of [['max', 120], ['sum', 220]]) {
    const repaired = helpers.replaceWatchStatsDevice(devices, 'new', 'old', overlap, 100)
    assert.equal(repaired.length, 2)
    assert.deepEqual(repaired[0].replacedDevices[0].days, devices[1].days)
    assert.deepEqual(helpers.watchSecondsForDevice(devices[0].days, repaired, 'new', 'all'), {
      '2026-10-01': 60, '2026-10-02': expected + 20,
    })
    // A local reset also clears the previously imported device's contribution.
    assert.deepEqual(helpers.watchSecondsForDevice({}, repaired, 'new', 'local', reset), {})
    assert.deepEqual(helpers.watchSecondsForDevice({}, repaired, 'new', 'all', reset), { '2026-10-02': 20 })
  }
  assert.equal(devices.length, 3)
  assert.throws(() => helpers.replaceWatchStatsDevice(devices, 'new', 'new', 'max', 100))
  assert.throws(() => helpers.replaceWatchStatsDevice(devices, 'new', 'old', '', 100))
})

test('repeated repairs keep separate device identities and account-wide totals consistent', () => {
  const helpers = createHelpers()
  const devices = [
    { deviceId: 'one', days: { '2026-10-01': 100 } },
    { deviceId: 'two', days: { '2026-10-02': 200 } },
    { deviceId: 'three', days: { '2026-10-03': 300 } },
    { deviceId: 'laptop', days: {} },
  ]
  const first = helpers.replaceWatchStatsDevice(devices, 'two', 'one', 'sum', 100)
  const second = helpers.replaceWatchStatsDevice(first, 'three', 'two', 'max', 200)
  for (const [id, date, seconds] of [['one', '2026-10-01', 100], ['two', '2026-10-02', 200], ['three', '2026-10-03', 300]]) {
    const local = { [date]: seconds }
    const merged = helpers.mergeWatchStats(second, [{ date, seconds }], id, 'Pixel', 'android')
    assert.equal(merged.length, 2)
    assert.deepEqual(helpers.watchSecondsForDevice(local, merged, id, 'all'), {
      '2026-10-01': 100, '2026-10-02': 200, '2026-10-03': 300,
    })
    assert.deepEqual(helpers.watchSecondsForDevice({}, merged, 'laptop', 'three'), {
      '2026-10-01': 100, '2026-10-02': 200, '2026-10-03': 300,
    })
  }
})

test('a replaced device sync does not alter sibling histories', () => {
  const { mergeWatchStats } = createHelpers({}, async () => ({ platform: 'android' }))
  const sibling = { deviceId: 'sibling', days: { '2026-10-01': 60 }, replacedAt: 100, overlap: 'max' }
  const remote = [{ deviceId: 'current', days: {}, replacedDevices: [
    { deviceId: 'old', days: {}, replacedAt: 100, overlap: 'max' }, sibling,
  ] }]
  const merged = mergeWatchStats(remote, [{ date: '2026-10-02', seconds: 30 }], 'old', 'Pixel', 'android')
  assert.deepEqual(merged[0].replacedDevices[0].days, { '2026-10-02': 30 })
  assert.deepEqual(merged[0].replacedDevices[1], sibling)
})

test('resetting a replaced identity clears the entire combined history before and after sync', () => {
  const { mergeWatchStats, watchSecondsForDevice } = createHelpers()
  const remote = [{ deviceId: 'new', days: { '2026-10-01': 100 }, replacedDevices: [
    { deviceId: 'old', days: { '2026-10-01': 50 }, overlap: 'sum', replacedAt: 100 },
  ] }]
  const reset = { at: 200, generation: 1, origin: 'old', baselines: { new: { '2026-10-01': 100 }, old: {} } }
  assert.deepEqual(watchSecondsForDevice({}, remote, 'old', 'local', reset), {})
  const synced = mergeWatchStats(remote, [], 'old', 'Pixel', 'android', reset)
  assert.deepEqual(watchSecondsForDevice({}, synced, 'old', 'local', reset), {})
  assert.deepEqual(watchSecondsForDevice({}, synced, 'laptop', 'new'), {})
  // Additional watching from either identity survives without resurrecting its baseline.
  const updated = mergeWatchStats(synced, [{ date: '2026-10-01', seconds: 130 }], 'new', 'Pixel', 'android')
  assert.deepEqual(watchSecondsForDevice({ '2026-10-02': 20 }, updated, 'old', 'local', reset), {
    '2026-10-01': 30, '2026-10-02': 20,
  })
  assert.deepEqual(updated[0].days, { '2026-10-01': 130 })
})

test('resets preserve prior subtree resets and explicitly imported later histories', () => {
  const { createWatchStatsReset, mergeWatchStats, replaceWatchStatsDevice, watchSecondsForDevice } = createHelpers()
  const day = '2026-10-01'
  const original = [
    { deviceId: 'root', days: { [day]: 100 }, replacedDevices: [
      { deviceId: 'old', days: { [day]: 50 }, overlap: 'sum', replacedAt: 100 },
    ] },
    { deviceId: 'other', days: { [day]: 80 } },
  ]
  const reset = createWatchStatsReset(original, 'old', 200)
  assert.deepEqual(reset, { id: reset.id, at: 200, epochs: { root: null, old: null }, generation: 1, origin: 'old', baselines: { old: {}, root: { [day]: 100 } } })
  const cleared = mergeWatchStats(original, [], 'old', 'Pixel', 'android', reset)
  const imported = replaceWatchStatsDevice(cleared, 'old', 'other', 'sum', 300)
  assert.deepEqual(watchSecondsForDevice({}, imported, 'old', 'local', reset), { [day]: 80 })
  const newRaw = [{ date: day, seconds: 130 }]
  const watched = mergeWatchStats(imported, newRaw, 'root', 'Pixel', 'android')
  assert.deepEqual(watchSecondsForDevice({ [day]: 130 }, watched, 'root', 'local'), { [day]: 110 })
  const secondReset = createWatchStatsReset(watched, 'root', 400)
  const twice = mergeWatchStats(watched, [], 'root', 'Pixel', 'android', secondReset)
  assert.deepEqual(watchSecondsForDevice({}, twice, 'old', 'local', reset), {})
  // Importing an already-reset group retains its reset, without clearing its new target.
  const joined = replaceWatchStatsDevice([...cleared, { deviceId: 'fresh', days: { [day]: 10 } }], 'fresh', 'root', 'sum', 500)
  assert.deepEqual(watchSecondsForDevice({ [day]: 10 }, joined, 'fresh', 'local'), { [day]: 10 })
})

test('reset metadata copied from reactive settings can be cloned for encrypted sync', () => {
  const { mergeWatchStats } = createHelpers()
  const reset = new Proxy({ at: 200, generation: 1, origin: 'pixel', baselines: { pixel: {} } }, {})
  const merged = mergeWatchStats([], [], 'pixel', 'Pixel', 'android', reset)
  assert.deepEqual(structuredClone(merged)[0].reset, { at: 200, generation: 1, origin: 'pixel', baselines: { pixel: {} } })
})

test('reset while disconnected completes missing repaired baselines on the next sync', () => {
  const { createWatchStatsReset, mergeWatchStats, watchSecondsForDevice } = createHelpers()
  const remote = [{ deviceId: 'pixel', days: { '2026-10-01': 100 }, replacedDevices: [
    { deviceId: 'old', days: { '2026-10-02': 50 }, overlap: 'sum', replacedAt: 100 },
  ] }]
  const pending = createWatchStatsReset([], 'pixel', 200)
  const merged = mergeWatchStats(remote, [{ date: '2026-10-03', seconds: 10 }], 'pixel', 'Pixel', 'android', pending)
  assert.deepEqual(watchSecondsForDevice({}, merged, 'observer', 'pixel'), { '2026-10-03': 10 })
  assert.deepEqual(merged[0].replacedDevices[0].days, remote[0].replacedDevices[0].days)
})

test('reset scope follows recorded membership despite a clock behind the replacement', () => {
  const { createWatchStatsReset, mergeWatchStats, watchSecondsForDevice } = createHelpers()
  const remote = [{ deviceId: 'new', days: { '2026-10-01': 100 }, replacedDevices: [
    { deviceId: 'old', days: { '2026-10-01': 50 }, overlap: 'sum', replacedAt: 1000 },
  ] }]
  const reset = createWatchStatsReset(remote, 'old', 50)
  const merged = mergeWatchStats(remote, [], 'old', 'Pixel', 'android', reset)
  assert.deepEqual(watchSecondsForDevice({}, merged, 'observer', 'new'), {})
})

test('staging an offline reset keeps it pending until the encrypted upload is accepted', async () => {
  const day = '2026-10-01'
  const remote = [{ deviceId: 'pixel', days: {}, replacedDevices: [
    { deviceId: 'old', days: { [day]: 50 }, overlap: 'sum', replacedAt: 100 },
  ] }]
  const { createWatchStatsReset, syncWatchStats, persistUploadedWatchStatsReset } = createHelpers({ find: async () => [] }, async () => ({ platform: 'android' }))
  const pending = createWatchStatsReset([], 'pixel', 200)
  const settings = { syncServerDeviceId: 'pixel', syncServerDeviceName: 'Pixel', syncServerWatchStatsReset: pending }
  let saves = 0
  const store = { state: { settings }, commit: () => {}, dispatch: async (name, value) => {
    assert.equal(name, 'updateSyncServerWatchStatsReset')
    settings.syncServerWatchStatsReset = value
    saves++
  } }
  const client = new EncryptedSyncAdapter({ watchStats: remote })
  await syncWatchStats(client, store)
  assert.equal(settings.syncServerWatchStatsReset, pending)
  assert.equal(saves, 0)
  await persistUploadedWatchStatsReset(client.document.watchStats, store)
  assert.equal(saves, 1)
  assert.equal(settings.syncServerWatchStatsReset.pending, undefined)
  await syncWatchStats(client, store)
  await persistUploadedWatchStatsReset(client.document.watchStats, store)
  assert.equal(saves, 1)
})

test('concurrent resets keep both identities’ new watch time', () => {
  const { createWatchStatsReset, mergeWatchStats, watchSecondsForDevice } = createHelpers()
  const day = '2026-10-01'
  const remote = [{ deviceId: 'a', days: { [day]: 100 }, replacedDevices: [
    { deviceId: 'b', days: { [day]: 100 }, overlap: 'sum', replacedAt: 100 },
  ] }]
  const resetA = createWatchStatsReset(remote, 'a', 200)
  const resetB = createWatchStatsReset(remote, 'b', 50)
  const a = mergeWatchStats(remote, [{ date: day, seconds: 10 }], 'a', 'Pixel', 'android', resetA)
  const both = mergeWatchStats(a, [{ date: day, seconds: 10 }], 'b', 'Pixel', 'android', resetB)
  assert.deepEqual(watchSecondsForDevice({}, both, 'observer', 'a'), { [day]: 20 })
})

test('retrying an accepted pending reset preserves watching since its upload', () => {
  const { createWatchStatsReset, mergeWatchStats, watchSecondsForDevice } = createHelpers()
  const day = '2026-10-01'
  const remote = [{ deviceId: 'pixel', days: {}, replacedDevices: [
    { deviceId: 'old', days: { [day]: 100 }, overlap: 'sum', replacedAt: 100 },
  ] }]
  const pending = createWatchStatsReset([], 'pixel', 200)
  const accepted = mergeWatchStats(remote, [], 'pixel', 'Pixel', 'android', pending)
  const watched = mergeWatchStats(accepted, [{ date: day, seconds: 110 }], 'old', 'Pixel', 'android')
  const retried = mergeWatchStats(watched, [], 'pixel', 'Pixel', 'android', pending)
  assert.deepEqual(retried[0].reset, accepted[0].reset)
  assert.deepEqual(watchSecondsForDevice({}, retried, 'observer', 'pixel'), { [day]: 10 })
})
