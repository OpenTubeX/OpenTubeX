import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const storageSource = await readFile(new URL('../../src/renderer/helpers/androidStorage.js', import.meta.url), 'utf8')
const checkStart = storageSource.indexOf('const INSTALLATION_MARKER_KEY')
const checkSource = storageSource.slice(checkStart, storageSource.indexOf('\nexport async function chooseAndroidDirectory', checkStart))
  .replaceAll('export async function', 'async function')

function check(native, saved) {
  const storage = new Map(saved === undefined ? [] : [['opentubex-installation-marker', saved]])
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const { checkAndroidAppDataRestore } = vm.runInNewContext(`${checkSource}\n({ checkAndroidAppDataRestore })`, {
    localStorage,
    AndroidStorage: { getInstallationMarker: async () => ({ marker: native }) },
  })
  return { storage, result: checkAndroidAppDataRestore() }
}

test('app data restored from another installation is told apart from upgrades and normal launches', async () => {
  // A fresh install, or the first launch of the version that added markers
  const first = check('this-install', undefined)
  const { restored, accept } = await first.result
  assert.equal(restored, false)
  accept()
  assert.equal(first.storage.get('opentubex-installation-marker'), 'this-install')

  assert.equal((await check('this-install', 'this-install').result).restored, false)
  // The WebView storage came with a backup or a device transfer
  const transferred = check('new-install', 'old-install')
  assert.equal((await transferred.result).restored, true)
  // Until the restored data is handled, the next launch checks again
  assert.equal(transferred.storage.get('opentubex-installation-marker'), 'old-install')
})

test('restored sync settings sign out and leave the old installation its device ID', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
  const start = source.indexOf('  async forgetRestoredSyncServerDevice(')
  const actionSource = source.slice(start, source.indexOf('\n  },\n', start) + 5)
  const forgotten = []
  const { forgetRestoredSyncServerDevice } = vm.runInNewContext(`({${actionSource}})`, {
    forgetSyncDeviceId: () => forgotten.push('legacy device ID'),
    SYNC_SERVER_RESTORED_DEVICE_MESSAGE: 'restored',
  })
  const run = async settings => {
    const calls = []
    await forgetRestoredSyncServerDevice({
      rootState: { settings },
      dispatch: async (action, value) => {
        calls.push(value === undefined ? action : [action, value])
        if (action === 'disconnectSyncServer') settings.syncServerToken = ''
      },
      commit: (mutation, value) => calls.push([mutation, value]),
    })
    return calls
  }

  assert.deepEqual(await run({ syncServerToken: 'token', syncServerDeviceId: 'old-device' }), [
    'disconnectSyncServer',
    ['updateSyncServerDeviceId', ''],
    ['updateSyncServerDeviceName', ''],
    ['setSyncServerError', 'restored'],
  ])
  assert.deepEqual(await run({ syncServerToken: '', syncServerDeviceId: '' }), [])
  assert.equal(forgotten.length, 2)

  // A token that could not be removed stays out of this session, and the restore is checked again next launch
  const settings = { syncServerToken: 'token', syncServerDeviceId: 'old-device' }
  const calls = []
  await assert.rejects(forgetRestoredSyncServerDevice({
    rootState: { settings },
    dispatch: async action => { calls.push(action) },
    commit: (mutation, value) => calls.push([mutation, value]),
  }), /Could not sign restored app data out of sync/)
  assert.deepEqual(calls, ['disconnectSyncServer', ['setSyncServerToken', '']])
})
