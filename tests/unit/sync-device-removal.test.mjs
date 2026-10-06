import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { decryptSyncDocument, encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import { getOtherDeviceSessions, normalizeSyncSessionsDocument, removeSyncSession } from '../../src/renderer/helpers/sync-sessions.js'

const component = await readFile(new URL('../../src/renderer/components/SyncSettings/SyncAccountManagement.vue', import.meta.url), 'utf8')
const revokeSource = component.slice(component.indexOf('async function revokeSession()'), component.indexOf('\ndefineExpose'))
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
const deleteStart = storeSource.indexOf('  deleteSyncServerSession(')
const deleteSource = storeSource.slice(deleteStart, storeSource.indexOf('  async completeSyncServerPairing', deleteStart))

const tabSet = id => ({ sessionId: id, tabs: [{ id: `${id}-tab`, url: '/subscriptions' }] })

async function fixture({ current = false, conflict = false, cleanupFails = false } = {}) {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  let remote = normalizeSyncSessionsDocument({ devices: {
    'old-phone': { platform: 'mobile', sessions: [tabSet('old-tabs'), tabSet('older-tabs')] },
    'new-phone': { platform: 'mobile', sessions: [tabSet('new-tabs')] },
    laptop: { platform: 'desktop', sessions: [tabSet('laptop-tabs')] },
  } })
  remote.shared = [tabSet('shared-tabs')]
  const settings = {
    syncServerEnabled: true, syncServerToken: 'token', syncServerPrivacyKey: key,
    syncServerPrivacySalt: salt, syncServerDeviceId: current ? 'old-phone' : 'new-phone', syncServerSnapshot: '{}',
  }
  let revoked = false
  let puts = 0
  let visible = getOtherDeviceSessions(remote, settings.syncServerDeviceId)
  const context = { rootState: { settings }, commit(name, value) {
    if (name === 'setSyncServerOtherDeviceSessions') visible = value
  }, dispatch: async (name, value) => {
    if (name === 'updateSyncServerSnapshot') settings.syncServerSnapshot = value
    else if (actions[name]) return actions[name](context, value)
    else assert.fail(`Unexpected action: ${name}`)
  } }
  const actions = vm.runInNewContext(`({${deleteSource}})`, {
    SyncServerClient: class {
      async getEncryptedSyncCollection() { return { revision: puts, payload: await encryptSyncDocument(remote, key, salt) } }
      async putEncryptedSyncCollection(collection, revision, payload) {
        puts++
        if (cleanupFails) throw new Error('Offline')
        if (conflict && puts === 1) {
          remote.devices['old-phone'].sessions.push(tabSet('concurrent-tabs'))
          throw Object.assign(new Error('Conflict'), { status: 409 })
        }
        remote = await decryptSyncDocument(payload, key)
      }
    },
    trackSyncClient: client => client, releaseSyncClient() {},
    assertSyncEnabled() {}, withSyncLock: callback => callback(),
    ENCRYPTED_SYNC_RETRIES: 3, decryptSyncDocument, encryptSyncDocument, removeSyncSession,
    normalizeSyncSessionsDocument,
    parseSnapshot: JSON.parse,
    getSavedOtherDeviceSessions: snapshot => getOtherDeviceSessions(snapshot.sessionsV2, settings.syncServerDeviceId),
    SyncServerCancelledError: class extends Error {}, isSessionExpiredError: () => false,
  })
  const prompt = { value: { id: 'login-id', device_id: 'old-phone', current } }
  const promptError = { value: '' }
  const emitted = []
  const componentContext = vm.createContext({
    sessionToRevoke: prompt, promptError, actionBusy: { value: false },
    client: () => ({ token: 'token', async revokeAccountSession() { revoked = true }, cancel() {} }),
    store: { dispatch: context.dispatch }, showToast() {}, t: key => key,
    emit: event => emitted.push(event), loadSessions: async () => {},
    handleRequestError: async (error, token, target) => { target.value = error.message },
  })
  vm.runInContext(revokeSource, componentContext)
  return {
    revoke: () => componentContext.revokeSession(),
    state: () => ({ remote, visible, revoked, puts, prompt: prompt.value, error: promptError.value, emitted }),
  }
}

for (const current of [false, true]) {
  test(`removing the ${current ? 'current' : 'previous'} phone login removes all its saved tab sets`, async () => {
    const app = await fixture({ current })
    await app.revoke()
    const result = app.state()
    assert.equal(result.revoked, true)
    assert.equal(result.remote.devices['old-phone'], undefined)
    assert.deepEqual(result.remote.deletedSessions['old-phone'], ['old-tabs', 'older-tabs'])
    assert.deepEqual(result.remote.devices['new-phone'].sessions, [tabSet('new-tabs')])
    assert.deepEqual(result.remote.devices.laptop.sessions, [tabSet('laptop-tabs')])
    assert.deepEqual(result.remote.shared, [tabSet('shared-tabs')])
    assert.ok(result.visible.every(session => session.syncDeviceId !== 'old-phone'))
    assert.deepEqual(result.emitted, current ? ['current-revoked'] : [])
  })
}

test('retries cleanup against the latest tab sets after a concurrent upload', async () => {
  const app = await fixture({ conflict: true })
  await app.revoke()
  assert.equal(app.state().puts, 2)
  assert.equal(app.state().remote.devices['old-phone'], undefined)
  assert.ok(app.state().remote.deletedSessions['old-phone'].includes('concurrent-tabs'))
})

test('keeps the removal retryable when saving the tab cleanup fails', async () => {
  const app = await fixture({ cleanupFails: true })
  await app.revoke()
  assert.equal(app.state().revoked, false)
  assert.equal(app.state().error, 'Offline')
  assert.equal(app.state().prompt.device_id, 'old-phone')
})
