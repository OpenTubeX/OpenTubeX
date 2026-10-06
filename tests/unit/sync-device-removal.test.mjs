import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { decryptSyncDocument, encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import { getOtherDeviceSessions, normalizeSyncSessionsDocument, removeSyncSession } from '../../src/renderer/helpers/sync-sessions.js'

const component = await readFile(new URL('../../src/renderer/components/SyncSettings/SyncAccountManagement.vue', import.meta.url), 'utf8')
const revokeSource = component.slice(component.indexOf('function openRevokePrompt('), component.indexOf('\ndefineExpose'))
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
const deleteStart = storeSource.indexOf('  deleteSyncServerSession(')
const deleteSource = storeSource.slice(deleteStart, storeSource.indexOf('  async completeSyncServerPairing', deleteStart))

const tabSet = id => ({ sessionId: id, tabs: [{ id: `${id}-tab`, url: '/subscriptions' }] })

async function fixture({ current = false, conflict = false, cleanupFails = false, otherLogin = false, otherLoginExpires = false, accountResponse, revokeFailsOnce = false, revokeResponseLost = false } = {}) {
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
  let revokeAttempts = 0
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
  const sessions = { value: [prompt.value, ...(otherLogin ? [{ id: 'remaining-login', device_id: 'old-phone' }] : [])] }
  const revokeDeletesTabs = { value: false }
  const promptError = { value: '' }
  const emitted = []
  let reloads = 0
  const componentContext = vm.createContext({
    sessionToRevoke: prompt, promptError, actionBusy: { value: false }, sessions, revokeDeletesTabs,
    client: () => ({
      token: 'token',
      async getAccountSessions() {
        if (accountResponse !== undefined) return accountResponse
        return { sessions: sessions.value.filter(session => (
          (!otherLoginExpires || session.id === 'login-id') && (!revoked || session.id !== 'login-id')
        )) }
      },
      async revokeAccountSession() {
        revokeAttempts++
        if (revokeResponseLost) {
          if (revoked) throw new Error('Not found')
          revoked = true
          throw new Error('Response lost')
        }
        if (revokeFailsOnce && revokeAttempts === 1) {
          remote.devices.laptop.sessions.push(tabSet('new-laptop-tabs'))
          throw new Error('Offline')
        }
        revoked = true
      },
      cancel() {},
    }),
    store: { dispatch: context.dispatch }, showToast() {}, t: key => key,
    emit: event => emitted.push(event), loadSessions: async () => { reloads++ },
    handleRequestError: async (error, token, target) => { target.value = error.message },
  })
  vm.runInContext(revokeSource, componentContext)
  componentContext.openRevokePrompt(prompt.value)
  return {
    revoke: () => componentContext.revokeSession(),
    state: () => ({ remote, visible, revoked, puts, prompt: prompt.value, error: promptError.value, emitted, tabsWarning: revokeDeletesTabs.value, revokeAttempts, reloads }),
  }
}

test('finishes revocation after a lost response without repeating deletion requests', async () => {
  const app = await fixture({ revokeResponseLost: true })
  await app.revoke()
  assert.equal(app.state().revoked, true)
  assert.equal(app.state().error, 'Settings.Sync Settings.Revoke Session Partial Failure')
  assert.equal(app.state().prompt.device_id, 'old-phone')
  assert.equal(app.state().puts, 1)
  await app.revoke()
  assert.equal(app.state().prompt, null)
  assert.equal(app.state().puts, 1)
  assert.equal(app.state().revokeAttempts, 1)
  assert.equal(app.state().reloads, 1)
})

test('does not delete tabs or send a DELETE when the refreshed login is already absent', async () => {
  const app = await fixture({ accountResponse: { sessions: [] } })
  await app.revoke()
  assert.equal(app.state().prompt, null)
  assert.equal(app.state().puts, 0)
  assert.equal(app.state().revokeAttempts, 0)
  assert.equal(app.state().reloads, 1)
  assert.deepEqual(app.state().remote.devices['old-phone'].sessions, [tabSet('old-tabs'), tabSet('older-tabs')])
})

for (const [label, accountResponse] of [['null', null], ['missing sessions', {}], ['non-array sessions', { sessions: {} }]]) {
  test(`keeps revocation retryable with a translated error for a ${label} response`, async () => {
    const app = await fixture({ accountResponse })
    await app.revoke()
    assert.equal(app.state().revoked, false)
    assert.equal(app.state().puts, 0)
    assert.equal(app.state().error, 'Settings.Sync Settings.Account Management Failed')
    assert.equal(app.state().prompt.device_id, 'old-phone')
  })
}

for (const current of [false, true]) {
  test(`reports completed tab cleanup when revoking a ${current ? 'current' : 'previous'} login fails and preserves newer sync changes on retry`, async () => {
    const app = await fixture({ current, revokeFailsOnce: true })
    await app.revoke()
    assert.equal(app.state().revoked, false)
    assert.equal(app.state().error, 'Settings.Sync Settings.Revoke Session Partial Failure')
    assert.equal(app.state().remote.devices['old-phone'], undefined)
    assert.deepEqual(app.state().remote.deletedSessions['old-phone'], ['old-tabs', 'older-tabs'])
    assert.equal(app.state().prompt.device_id, 'old-phone')
    await app.revoke()
    assert.equal(app.state().revoked, true)
    assert.deepEqual(app.state().remote.devices.laptop.sessions, [tabSet('laptop-tabs'), tabSet('new-laptop-tabs')])
    assert.deepEqual(app.state().remote.deletedSessions['old-phone'], ['old-tabs', 'older-tabs'])
  })
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
  test(`requires another confirmation when the other login expires before revoking a ${current ? 'current' : 'previous'} login`, async () => {
    const app = await fixture({ current, otherLogin: true, otherLoginExpires: true })
    assert.equal(app.state().tabsWarning, false)
    await app.revoke()
    const result = app.state()
    assert.equal(result.revoked, false)
    assert.equal(result.puts, 0)
    assert.equal(result.tabsWarning, true)
    assert.equal(result.prompt.device_id, 'old-phone')
    assert.deepEqual(result.remote.devices['old-phone'].sessions, [tabSet('old-tabs'), tabSet('older-tabs')])
    await app.revoke()
    assert.equal(app.state().revoked, true)
    assert.equal(app.state().remote.devices['old-phone'], undefined)
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

for (const current of [false, true]) {
  test(`revoking a ${current ? 'current' : 'previous'} login preserves tabs used by another login with the same device ID`, async () => {
    const app = await fixture({ current, otherLogin: true })
    await app.revoke()
    const result = app.state()
    assert.equal(result.revoked, true)
    assert.equal(result.puts, 0)
    assert.deepEqual(result.remote.devices['old-phone'].sessions, [tabSet('old-tabs'), tabSet('older-tabs')])
    assert.deepEqual(result.remote.deletedSessions, {})
    assert.deepEqual(result.emitted, current ? ['current-revoked'] : [])
  })
}
