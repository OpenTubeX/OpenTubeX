import * as releasedClient from '../../tests/helpers/released-sync-sessions.mjs'
import { expect } from '@playwright/test'
import { preparePrivacyKey, encryptSyncDocument, decryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import { normalizeSyncSessionsDocument, removeSyncSession } from '../../src/renderer/helpers/sync-sessions.js'
import { encryptSyncServerDeviceInfo } from '../../src/renderer/helpers/sync-server-sessions.js'
import { goToSettingsSection } from './app.mjs'

export async function verifySyncDeviceReconnection(page, { conflict = false, phone = false, intentionalDeletion = false } = {}) {
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getTabs.length
  )), { timeout: 30_000 }).toBeGreaterThan(0)
  const skip = page.getByRole('button', { name: 'Skip', exact: true })
  if (await skip.isVisible()) await skip.click()
  const passphrase = 'fixture-separate-privacy-passphrase'
  const { key, salt } = await preparePrivacyKey(null, passphrase)
  const deviceId = Buffer.alloc(16, 9).toString('base64url')
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return JSON.parse(JSON.stringify({ settings: store.state.settings, sync: store.state.syncServer }))
  })
  const localSessions = await page.evaluate(async phone => {
    if (!phone) return window.ftElectron.tabs.getSyncSessions()
    const tabs = document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getTabs
      .map(tab => ({ id: tab.id, url: new URL(tab.route.fullPath, location.origin).toString(), title: tab.title }))
    return [{ sessionId: 'mobile', updatedAt: 1, activeTabId: tabs[0].id, tabs }]
  }, phone)
  const sessionIds = localSessions.map(session => session.sessionId)
  const tabIds = localSessions.flatMap(session => session.tabs.map(tab => tab.id))
  let document = normalizeSyncSessionsDocument({
    devices: {
      [deviceId]: { platform: phone ? 'mobile' : 'desktop', sessions: localSessions },
      laptop: { platform: 'desktop', sessions: [{ sessionId: 'laptop', tabs: [{ id: 'laptop-tab', url: '/subscriptions' }] }] },
    }
  })
  document = removeSyncSession(document, 'other-phone', 'mobile')
  const previous = structuredClone(document)
  let revision = 1
  let revoked = false
  let signedIn = false
  let loginDeviceId
  let reconnectPuts = 0
  let deviceInfo = await encryptSyncServerDeviceInfo({ name: 'Fixture phone', platform: 'android', architecture: 'x64', release: '15' }, key, deviceId)
  const request = async options => {
    const path = new URL(options.url).pathname
    const body = options.data ? JSON.parse(options.data) : null
    let status = 200
    let data = {}
    if (path === '/health') data = { capabilities: { encrypted_sync: 1, live_sync: 1, account_sessions: 1 } }
    else if (path === '/v1/account/login') {
      loginDeviceId = body.device_id
      signedIn = true
      data = { jwt: 'new-fixture-token' }
    } else if (path === '/v1/account/sessions') {
      const now = Date.now()
      data = {
        password_login: true,
        sessions: [{
          id: signedIn ? 'new-login' : 'old-login',
          device_id: deviceId,
          current: true,
          created_at: now,
          last_active_at: now,
          expires_at: now + 86400000,
          encrypted_device_info: deviceInfo
        }]
      }
    } else if (path === '/v1/account/sessions/old-login' && options.method === 'DELETE') {
      expect(document.devices[deviceId]).toBeUndefined()
      revoked = true
      status = 204
    } else if (path === '/v1/account/sessions/current' || options.method === 'PATCH') {
      deviceInfo = body.encrypted_device_info
      status = 204
    } else if (path === '/v1/encrypted_sync') data = { collections: [{ collection: 'sessionsV2', revision }] }
    else if (path === '/v1/encrypted_sync/events') data = []
    else if (path === '/v1/encrypted_sync/sessions') data = { revision: 0, payload: null }
    else if (path === '/v1/encrypted_sync/sessionsV2') {
      if (options.method === 'PUT') {
        if (signedIn && !intentionalDeletion && ++reconnectPuts === 1) {
          if (conflict) {
            document.devices.laptop.sessions.push({ sessionId: 'concurrent-laptop', tabs: [{ id: 'new-laptop-tab', url: '/history' }] })
            revision++
          }
          return { status: conflict ? 409 : 503, data: 'Fixture upload failure', headers: {}, url: options.url }
        }
        expect(body.revision).toBe(revision)
        document = await decryptSyncDocument(body.payload, key)
        revision++
      }
      data = { revision, payload: await encryptSyncDocument(document, key, salt) }
    } else status = 404
    return { status, data: status === 204 ? '' : JSON.stringify(data), headers: {}, url: options.url }
  }
  if (phone) {
    await page.exposeBinding('__syncDeviceReconnectionRequest', (_source, options) => request(options))
    await page.evaluate(() => {
      window.__syncDeviceReconnectionNativePromise = window.Capacitor.nativePromise
      window.Capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && options.url.startsWith('https://device-reconnection.example/')
          ? window.__syncDeviceReconnectionRequest(options)
          : window.__syncDeviceReconnectionNativePromise(plugin, method, options)
      )
    })
  } else {
    await page.route('https://device-reconnection.example/**', async route => {
      const response = await request({ url: route.request().url(), method: route.request().method(), data: route.request().postData() })
      await route.fulfill({ status: response.status, body: response.data, contentType: 'application/json' })
    })
  }
  try {
    await page.evaluate(({ key, salt, deviceId, previous }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const settings = {
        SyncServerEnabled: true,
        SyncServerAutoSync: false,
        SyncServerUrl: 'https://device-reconnection.example',
        SyncServerUsername: 'fixture-user',
        SyncServerToken: 'old-fixture-token',
        SyncServerDeviceId: deviceId,
        SyncServerDeviceName: 'Fixture phone',
        SyncServerPrivacyMode: 'enhanced',
        SyncServerPrivacyKey: key,
        SyncServerPrivacySalt: salt,
        SyncServerSnapshot: JSON.stringify({ sessionsV2: previous }),
        SyncServerSyncSessions: true,
        SyncServerSharedTabs: false,
        EnableMobileTabs: true,
        CapacitorLayoutMode: 'phone',
        CurrentLocale: 'en-US'
      }
      for (const key of Object.keys(store.state.settings).filter(key => key.startsWith('syncServerSync'))) {
        store.commit(`set${key[0].toUpperCase()}${key.slice(1)}`, false)
      }
      for (const [name, value] of Object.entries(settings)) store.commit(`set${name}`, value)
    }, { key, salt, deviceId, previous })
    if (intentionalDeletion) {
      await page.evaluate(async ({ deviceId, sessionIds }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        for (const sessionId of sessionIds) await store.dispatch('deleteSyncServerSession', { syncDeviceId: deviceId, sessionId })
        await store.dispatch('disconnectSyncServer')
      }, { deviceId, sessionIds })
    } else {
      const sync = await goToSettingsSection(page, 'sync')
      await sync.locator('.sessionCard', { hasText: 'Current device' }).getByRole('button', { name: 'Revoke access' }).click()
      const prompt = page.getByRole('dialog', { name: 'Revoke this session?' })
      await prompt.getByRole('button', { name: 'Revoke session', exact: true }).click()
      await expect(prompt).toBeHidden()
      expect(revoked).toBe(true)
    }
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.syncServerToken)).toBe('')
    expect(document.deletedSessions[deviceId]).toEqual(sessionIds)
    expect(document.deletedSessions[`revoked:${deviceId}`]).toEqual(intentionalDeletion ? undefined : sessionIds)
    // A connected peer still running the released v1 client rewrites the
    // encrypted collection between revocation and the owning device's login.
    document = releasedClient.mergeSyncSessions({
      remoteValue: document,
      localSessions: document.devices.laptop.sessions,
      deviceId: 'laptop',
      platform: 'desktop',
      preferredMode: 'separate',
    }).document
    revision++
    const error = await page.evaluate(async ({ deviceId, passphrase }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      try {
        await store.dispatch('authenticateSyncServer', {
          mode: 'login',
          serverUrl: 'https://device-reconnection.example',
          username: 'fixture-user',
          password: 'fixture-account-password',
          privacyPassphrase: passphrase,
          deviceId,
          deviceName: 'Fixture phone',
          deviceSystemInfo: { platform: 'android', architecture: 'x64', release: '15' }
        })
        return ''
      } catch (error) { return error.message }
    }, { deviceId, passphrase })
    if (!conflict && !intentionalDeletion) {
      expect(error).toBe('Fixture upload failure')
      expect(await page.evaluate(() => JSON.parse(document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.syncServerSnapshot).reclaimDeviceSessions)).toBe(deviceId)
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
    } else expect(error).toBe('')
    expect(loginDeviceId).toBe(deviceId)
    expect(document.devices[deviceId].sessions.map(session => session.sessionId)).toEqual(intentionalDeletion ? [] : sessionIds)
    expect(document.devices[deviceId].sessions.flatMap(session => session.tabs.map(tab => tab.id))).toEqual(intentionalDeletion ? [] : tabIds)
    expect(document.deletedSessions[deviceId]).toEqual(intentionalDeletion ? sessionIds : undefined)
    expect(document.deletedSessions[`revoked:${deviceId}`]).toBeUndefined()
    expect(document.deletedSessions['other-phone']).toEqual(['mobile'])
    expect(document.devices.laptop.sessions).toHaveLength(conflict ? 2 : 1)
    expect(await page.evaluate(() => JSON.parse(document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.syncServerSnapshot).reclaimDeviceSessions)).toBeUndefined()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
    expect(document.devices[deviceId].sessions.flatMap(session => session.tabs.map(tab => tab.id))).toEqual(intentionalDeletion ? [] : tabIds)
  } finally {
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('stopSyncServerAutoSync')
      store.commit('setSyncServerEnabled', false)
      for (const name of ['Url', 'Username', 'DeviceId', 'DeviceName', 'Snapshot', 'LastSyncAt', 'PrivacyMode', 'PrivacyKey', 'PrivacySalt', 'Token', 'ResumeAutoSync']) {
        const key = `syncServer${name}`
        await store.dispatch(`updateSyncServer${name}`, saved.settings[key])
      }
      Object.assign(store.state.settings, saved.settings)
      Object.assign(store.state.syncServer, saved.sync)
      if (window.__syncDeviceReconnectionNativePromise) {
        window.Capacitor.nativePromise = window.__syncDeviceReconnectionNativePromise
        delete window.__syncDeviceReconnectionNativePromise
      }
    }, saved)
    if (!phone) await page.unroute('https://device-reconnection.example/**')
  }
}
