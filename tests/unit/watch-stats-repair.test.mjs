import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { decryptSyncDocument, encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import { createWatchStatsHelpers } from '../helpers/sync-watch-stats.mjs'
import { areJsonValuesEqual } from '../../src/renderer/helpers/jsonValues.js'

const helpers = createWatchStatsHelpers()
const storeSource = readFileSync(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
const actionSource = storeSource.slice(storeSource.indexOf('  replaceSyncWatchStatsDevice('), storeSource.indexOf('  async completeSyncServerPairing('))

async function fixture({ sourceChanged = false, localChanged = false, conflict = false, uploadFails = false, nested = false, rootChanged = false, resetChanged = false } = {}) {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const settings = { syncServerEnabled: true, syncServerToken: 'token', syncServerUrl: 'https://sync.example',
    syncServerUsername: 'test', syncServerDeviceId: 'pixel', syncServerDeviceName: 'Pixel',
    syncServerPrivacyMode: 'enhanced', syncServerPrivacyKey: key, syncServerPrivacySalt: salt,
    syncServerSyncWatchStats: true, syncServerWatchStatsReset: null, syncServerSnapshot: '{}' }
  const localDays = { '2026-10-02': 120 }
  const source = { deviceId: 'old', deviceName: 'Pixel', platform: 'android', days: { '2026-10-01': 60, '2026-10-02': 100 } }
  let remote = [source, { deviceId: 'pixel', days: localDays, platform: 'android' }]
  if (nested) remote[1] = { deviceId: 'root', days: { '2026-10-03': 100 }, replacedDevices: [
    { ...remote[1], overlap: 'sum', replacedAt: 100 },
  ] }
  const currentDays = helpers.watchStatsDeviceDays(remote[1], 'pixel', localDays)
  const replacedDevices = structuredClone(remote[1].replacedDevices ?? [])
  if (rootChanged) remote[1].days['2026-10-03'] = 1000
  if (resetChanged) remote[1].reset = { at: 200, baselines: { root: { '2026-10-03': 100 }, pixel: {} } }
  let visible = remote
  let revision = 1
  let puts = 0
  const snapshot = structuredClone(source)
  if (sourceChanged) remote[0].days['2026-10-01'] = 70
  const records = [{ date: '2026-10-02', seconds: localChanged ? 130 : 120 }]
  class Client {
    async getEncryptedSyncCollection(collection) {
      assert.equal(collection, 'watchStats')
      return { revision, payload: await encryptSyncDocument(remote, key, salt) }
    }
    async putEncryptedSyncCollection(collection, expectedRevision, payload) {
      assert.equal(collection, 'watchStats')
      assert.equal(expectedRevision, revision)
      puts++
      if (uploadFails) throw new Error('Upload failed')
      if (conflict && puts === 1) {
        remote = [...remote, { deviceId: 'tablet', days: { '2026-10-02': 20 } }]
        revision++
        throw Object.assign(new Error('Conflict'), { status: 409 })
      }
      remote = await decryptSyncDocument(payload, key)
      return { revision: ++revision }
    }
  }
  const bindings = { ...helpers, SyncServerClient: Client, areJsonValuesEqual, decryptSyncDocument, encryptSyncDocument,
    i18n: { global: { t: key => key } }, ENCRYPTED_SYNC_RETRIES: 3,
    activityAccountKey: value => JSON.stringify([value.syncServerUrl, value.syncServerUsername, value.syncServerDeviceId]),
    assertSyncEnabled: () => {}, SyncServerCancelledError: Error, withSyncLock: callback => callback(),
    trackSyncClient: value => value, releaseSyncClient: () => {},
    collectionCache: { put: () => {} }, parseSnapshot: JSON.parse, DBWatchStatsHandlers: { find: async () => records } }
  const actions = compileFunction(`return ({${actionSource}})`, Object.keys(bindings))(...Object.values(bindings))
  const context = { rootState: { settings }, commit(name, value) {
    if (name === 'setSyncedWatchStats') visible = value
  }, dispatch: async (name, value) => {
    assert.equal(name, 'updateSyncServerSnapshot')
    settings.syncServerSnapshot = value
  } }
  return { run: overlap => actions.replaceSyncWatchStatsDevice(context, { source: snapshot, overlap, localDays, currentDays, replacedDevices, localReset: null }),
    remote: () => remote, visible: () => visible, puts: () => puts, settings }
}

test('replacement saves encrypted histories and restores the repaired snapshot after restart', async () => {
  const f = await fixture()
  await f.run('max')
  assert.equal(f.remote().length, 1)
  assert.deepEqual(f.visible(), f.remote())
  assert.deepEqual(JSON.parse(f.settings.syncServerSnapshot).watchStats, f.remote())
  assert.deepEqual(helpers.watchSecondsForDevice({ '2026-10-02': 120 }, f.remote(), 'pixel', 'all'), {
    '2026-10-01': 60, '2026-10-02': 120,
  })
  await assert.rejects(f.run('sum'), /Replacement changed/)
  assert.equal(f.puts(), 1)
})

test('revision conflicts preserve concurrent changes to other devices', async () => {
  const f = await fixture({ conflict: true })
  await f.run('sum')
  assert.equal(f.puts(), 2)
  assert.equal(f.remote().length, 2)
  assert.equal(f.remote()[1].deviceId, 'tablet')
  assert.deepEqual(helpers.watchSecondsForDevice({ '2026-10-02': 120 }, f.remote(), 'pixel', 'all'), {
    '2026-10-01': 60, '2026-10-02': 240,
  })
})

for (const change of ['sourceChanged', 'localChanged']) {
  test(`replacement refuses a stale preview after ${change}`, async () => {
    const f = await fixture({ [change]: true })
    await assert.rejects(f.run('max'), /Replacement changed/)
    assert.equal(f.puts(), 0)
    assert.equal(f.remote().length, 2)
  })
}

test('failed uploads leave both histories and the saved snapshot intact', async () => {
  const f = await fixture({ uploadFails: true })
  await assert.rejects(f.run('max'), /Upload failed/)
  assert.equal(f.remote().length, 2)
  assert.equal(f.settings.syncServerSnapshot, '{}')
})

for (const change of ['rootChanged', 'resetChanged']) {
  test(`replacement refuses a nested preview after ${change}`, async () => {
    const f = await fixture({ nested: true, [change]: true })
    await assert.rejects(f.run('max'), /Replacement changed/)
    assert.equal(f.puts(), 0)
    assert.equal(f.remote().length, 2)
  })
}
