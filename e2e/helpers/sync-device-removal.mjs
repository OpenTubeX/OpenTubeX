import { expect } from '@playwright/test'
import * as releasedClient from '../../tests/helpers/released-sync-sessions.mjs'
import { encryptSyncDocument, decryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import { encryptSyncServerDeviceInfo } from '../../src/renderer/helpers/sync-server-sessions.js'
import { getOtherDeviceSessions, normalizeSyncSessionsDocument } from '../../src/renderer/helpers/sync-sessions.js'
import { goToSettingsSection } from './app.mjs'

// Shared by Electron and real Android WebView regression tests.
export async function verifySyncDeviceRemoval(page, { phone = false, current = false, otherLogin = false, otherLoginExpires = false, revokeFailsOnce = false, revokeResponseLost = false, loginDisappears = false, reconnectDuringCleanup = false, postCleanupFailsOnce = false, capture } = {}) {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const oldDeviceId = Buffer.alloc(16, 3).toString('base64url')
  const currentDeviceId = Buffer.alloc(16, 4).toString('base64url')
  const activeDeviceId = current || (otherLogin && !otherLoginExpires) ? oldDeviceId : currentDeviceId
  const orphanId = 'phone-before-app-data-reset'
  const tabSet = (sessionId, title) => ({
    sessionId,
    updatedAt: 1,
    activeTabId: sessionId,
    tabs: [{ id: sessionId, title, url: '/subscriptions' }],
  })
  let document = normalizeSyncSessionsDocument({
    devices: {
      [oldDeviceId]: { platform: 'mobile', sessions: [tabSet('old-tabs', 'Old phone tabs'), tabSet('older-tabs', 'Older phone tabs')] },
      [currentDeviceId]: { platform: 'mobile', sessions: [tabSet('current-tabs', 'Current phone tabs')] },
      [orphanId]: { platform: 'mobile', sessions: [tabSet('orphan-tabs', 'Tabs from a previously removed phone')] },
    }
  })
  let revision = 1
  let revoked = false
  let revokeAttempts = 0
  let otherLoginExpired = false
  let postCleanupFailed = false
  const preserveTabs = (otherLogin && !otherLoginExpires) || reconnectDuringCleanup
  const deviceInfo = await encryptSyncServerDeviceInfo({
    name: 'Previous phone', platform: 'android', architecture: 'arm64', release: '15',
  }, key, oldDeviceId)
  const now = Date.now()
  const accountSessions = [{
    id: 'old-login',
    device_id: oldDeviceId,
    current,
    created_at: now,
    last_active_at: now,
    expires_at: now + 86400000,
    encrypted_device_info: deviceInfo,
  }]
  if (otherLogin || revokeResponseLost || loginDisappears || reconnectDuringCleanup) {
    const loginDeviceId = otherLogin ? oldDeviceId : currentDeviceId
    accountSessions.push({
      ...accountSessions[0],
      id: 'current-login',
      device_id: loginDeviceId,
      current: !current && !otherLoginExpires,
      encrypted_device_info: await encryptSyncServerDeviceInfo({
        name: 'Current phone', platform: 'android', architecture: 'arm64', release: '15',
      }, key, loginDeviceId),
    })
  }
  const requests = []
  const routeHandler = async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    requests.push(`${request.method()} ${pathname}`)
    if (current && revoked) return route.fulfill({ status: 401 })
    if (pathname === '/health') {
      return route.fulfill({ json: { capabilities: { encrypted_sync: 1, live_sync: 1, account_sessions: 1 } } })
    }
    if (pathname === '/v1/account/sessions') {
      return route.fulfill({
        json: {
          password_login: true,
          sessions: accountSessions.filter(session => (
            (!revoked || session.id !== 'old-login') && (!otherLoginExpired || session.id !== 'current-login')
          ))
        }
      })
    }
    if (pathname.startsWith('/v1/account/sessions/') && request.method() === 'PATCH') {
      const session = accountSessions.find(session => pathname === `/v1/account/sessions/${session.id}`)
      if (!session) return route.fulfill({ status: 404 })
      session.encrypted_device_info = request.postDataJSON().encrypted_device_info
      return route.fulfill({ status: 204 })
    }
    if (pathname === '/v1/account/sessions/old-login' && request.method() === 'DELETE') {
      if (preserveTabs) expect(document.devices[oldDeviceId].sessions).toHaveLength(reconnectDuringCleanup ? 3 : 2)
      else expect(document.devices[oldDeviceId]).toBeUndefined()
      if (postCleanupFailsOnce) {
        document = releasedClient.mergeSyncSessions({
          remoteValue: document,
          localSessions: [tabSet('released-window', 'Window opened by the released client')],
          deviceId: oldDeviceId,
          platform: 'desktop',
        }).document
        revision++
      }
      if (revokeFailsOnce && revokeAttempts++ === 0) {
        return route.fulfill({ status: 503, body: 'Fixture revocation failure' })
      }
      if (revokeResponseLost) {
        if (revoked) return route.fulfill({ status: 404 })
        revoked = true
        return route.fulfill({ status: 503, body: 'Fixture response lost after revocation' })
      }
      revoked = true
      return route.fulfill({ status: 204 })
    }
    if (pathname === '/v1/encrypted_sync/sessionsV2') {
      if (request.method() === 'PUT') {
        if (postCleanupFailsOnce && revoked && !postCleanupFailed) {
          postCleanupFailed = true
          return route.fulfill({ status: 503, body: 'Sync server is temporarily unavailable' })
        }
        if (reconnectDuringCleanup && !accountSessions.some(session => session.id === 'reconnected-login')) {
          accountSessions.push({
            ...accountSessions[0],
            id: 'reconnected-login',
            current: false,
            encrypted_device_info: await encryptSyncServerDeviceInfo({
              name: 'Reconnected phone', platform: 'android', architecture: 'arm64', release: '15',
            }, key, oldDeviceId),
          })
          document.devices[oldDeviceId].sessions.push(tabSet('reconnected-tabs', 'Reconnected phone tabs'))
          revision++
          return route.fulfill({ status: 409, json: { error: 'Concurrent reconnect upload' } })
        }
        const body = request.postDataJSON()
        expect(body.revision).toBe(revision)
        document = await decryptSyncDocument(body.payload, key)
        revision++
        return route.fulfill({ json: { revision } })
      }
      return route.fulfill({ json: { revision, payload: await encryptSyncDocument(document, key, salt) } })
    }
    return route.fulfill({ status: 404, json: {} })
  }
  await page.route('https://device-removal.example/**', routeHandler)
  if (phone) {
    // Android sync uses native HTTP rather than the WebView's fetch. Supply the
    // same deterministic server responses at that transport boundary.
    await page.exposeBinding('__syncDeviceRemovalRequest', async (_source, options) => routeHandler({
      request: () => ({ url: () => options.url, method: () => options.method, postDataJSON: () => JSON.parse(options.data) }),
      fulfill: async ({ status = 200, json, body = '' }) => ({ status, data: json ? JSON.stringify(json) : body, headers: {}, url: options.url }),
    }))
    await page.evaluate(() => {
      const capacitor = window.Capacitor
      window.__syncDeviceRemovalNativePromise = capacitor.nativePromise
      capacitor.nativePromise = (plugin, method, options) => (
        plugin === 'CapacitorHttp' && options.url.startsWith('https://device-removal.example/')
          ? window.__syncDeviceRemovalRequest(options)
          : window.__syncDeviceRemovalNativePromise(plugin, method, options)
      )
    })
  }
  const saved = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return JSON.parse(JSON.stringify({ settings: store.state.settings, sync: store.state.syncServer }))
  })
  try {
    if (await page.locator('.settingsWindow').isVisible()) await page.locator('.settingsCloseButton').click()
    await page.evaluate(({ key, salt, currentDeviceId, sessions, snapshot, phone }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const settings = {
        SyncServerAutoSync: false,
        SyncServerEnabled: true,
        SyncServerUrl: 'https://device-removal.example',
        SyncServerToken: 'fixture-token',
        SyncServerUsername: 'fixture-user',
        SyncServerPrivacyKey: key,
        SyncServerPrivacySalt: salt,
        SyncServerDeviceId: currentDeviceId,
        SyncServerDeviceName: 'Current phone',
        SyncServerPrivacyMode: 'enhanced',
        SyncServerSyncSessions: true,
        SyncServerSharedTabs: false,
        SyncServerSnapshot: JSON.stringify({ sessionsV2: snapshot }),
        BaseTheme: 'system',
        SystemDarkTheme: 'dark',
        SystemLightTheme: 'light',
        MainColor: 'Red',
        SecColor: 'Blue',
        CurrentLocale: 'en-US',
        ...(phone ? { CapacitorLayoutMode: 'phone', EnableMobileTabs: true } : {}),
      }
      for (const [name, value] of Object.entries(settings)) store.commit(`set${name}`, value)
      store.commit('setSyncServerOtherDeviceSessions', sessions)
    }, { key, salt, currentDeviceId: activeDeviceId, sessions: getOtherDeviceSessions(document, activeDeviceId), snapshot: document, phone })
    const sync = await goToSettingsSection(page, 'sync')
    const device = sync.locator('.sessionCard', { hasText: current ? 'Current device' : 'Previous phone' })
    await device.getByRole('button', { name: 'Revoke access' }).click()
    const prompt = page.getByRole('dialog', { name: 'Revoke this session?' })
    if (otherLogin) await expect(prompt).not.toContainText("This device's synced tab sets will also be deleted.")
    else await expect(prompt).toContainText("This device's synced tab sets will also be deleted.")
    if (capture) await capture(otherLogin ? 'shared-device-login-confirmation' : 'device-removal-confirmation', prompt)
    if (loginDisappears) revoked = true
    if (otherLoginExpires) {
      otherLoginExpired = true
      await prompt.getByRole('button', { name: 'Revoke session', exact: true }).click()
      await expect(prompt).toContainText("This device's synced tab sets will also be deleted.")
      await expect(prompt.getByRole('button', { name: 'Revoke session', exact: true })).toBeEnabled()
      expect(revoked).toBe(false)
      expect(requests).not.toContain('PUT /v1/encrypted_sync/sessionsV2')
      expect(requests).not.toContain('DELETE /v1/account/sessions/old-login')
      if (capture) await capture('device-removal-reconfirmation', prompt)
    }
    await prompt.getByRole('button', { name: 'Revoke session', exact: true }).click()
    if (revokeFailsOnce || revokeResponseLost) {
      await expect(prompt.getByRole('alert')).toHaveText('Synced tab sets were deleted, but revocation could not be confirmed. Retry to revoke access.')
      await expect(prompt.getByRole('button', { name: 'Revoke session', exact: true })).toBeEnabled()
      expect(revoked).toBe(revokeResponseLost)
      expect(document.devices[oldDeviceId]).toBeUndefined()
      expect(document.deletedSessions[oldDeviceId]).toEqual(['old-tabs', 'older-tabs'])
      if (capture) await capture('device-removal-partial-failure', prompt)
      await prompt.getByRole('button', { name: 'Revoke session', exact: true }).click()
    }
    if (postCleanupFailsOnce) {
      await expect(prompt.getByRole('alert')).toContainText('Session revoked:')
      expect(revoked).toBe(true)
      expect(document.devices[oldDeviceId].sessions[0].sessionId).toBe('released-window')
      if (capture) await capture('device-removal-post-revocation-failure', prompt)
      await prompt.getByRole('button', { name: 'Revoke session', exact: true }).click()
      expect(requests.filter(request => request === 'DELETE /v1/account/sessions/old-login')).toHaveLength(1)
    }
    await expect(prompt).toBeHidden()
    await expect(device).toHaveCount(0)
    if (current) {
      expect(revoked).toBe(true)
      expect(requests.slice(requests.indexOf('DELETE /v1/account/sessions/old-login') + 1)).toEqual([])
      expect(document.devices[oldDeviceId].sessions.map(session => session.sessionId)).toEqual(['old-tabs', 'older-tabs', 'reconnected-tabs'])
      expect(document.deletedSessions[oldDeviceId]).toBeUndefined()
      await expect.poll(() => page.evaluate(() => {
        const settings = document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings
        return [settings.syncServerToken, settings.syncServerUsername, settings.syncServerPrivacyKey, settings.syncServerPrivacySalt, settings.syncServerSnapshot]
      })).toEqual(['', '', '', '', '{}'])
      return
    }
    if (revokeResponseLost || loginDisappears) {
      expect(requests.filter(request => request === 'DELETE /v1/account/sessions/old-login')).toHaveLength(loginDisappears ? 0 : 1)
      expect(requests.filter(request => request === 'PUT /v1/encrypted_sync/sessionsV2')).toHaveLength(loginDisappears ? 1 : 2)
      await expect(sync.locator('.sessionCard', { hasText: 'Current device' })).toBeVisible()
      if (capture) await capture('device-removal-completed', sync.locator('.accountManagement'))
    }
    expect(revoked).toBe(true)
    if (preserveTabs) {
      expect(document.devices[oldDeviceId].sessions.map(session => session.sessionId)).toEqual(['old-tabs', 'older-tabs', ...(reconnectDuringCleanup ? ['reconnected-tabs'] : [])])
      expect(document.deletedSessions[oldDeviceId]).toBeUndefined()
      if (reconnectDuringCleanup) {
        expect(requests.filter(request => request === 'PUT /v1/encrypted_sync/sessionsV2')).toHaveLength(1)
      } else expect(requests).not.toContain('PUT /v1/encrypted_sync/sessionsV2')
      await expect(sync.locator('.sessionCard', { hasText: 'Current device' })).toBeVisible()
      if (capture && reconnectDuringCleanup) await capture('device-reconnect-preserved', sync.locator('.accountManagement'))
    } else {
      expect(document.devices[oldDeviceId]).toBeUndefined()
      // The released owner garbage-collects markers for its closed old windows.
      expect(document.deletedSessions[oldDeviceId]).toEqual(postCleanupFailsOnce ? ['released-window'] : ['old-tabs', 'older-tabs'])
    }
    expect(document.devices[currentDeviceId].sessions[0].sessionId).toBe('current-tabs')
    await expect.poll(() => page.evaluate(() => (
      document.querySelector('#app').__vue_app__.config.globalProperties.$store
        .getters.getSyncServerOtherDeviceSessions.map(session => session.sessionId)
    ))).toEqual(reconnectDuringCleanup ? ['old-tabs', 'older-tabs', 'orphan-tabs'] : preserveTabs ? ['current-tabs', 'orphan-tabs'] : ['orphan-tabs'])

    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await page.locator(phone ? '.capacitorPhoneTabSwitcherButton' : '.tabOrganizerButton').click()
    const organizer = page.locator(phone ? '.capacitorPhoneTabDialog' : '.tabOrganizer')
    await expect(organizer).toBeVisible()
    if (phone) await organizer.getByRole('tab', { name: 'Tabs from other devices', exact: true }).click()
    await organizer.getByRole('tab', { name: 'Mobile · 1 tab', exact: true }).last().click()
    const deleteButton = organizer.getByRole('button', { name: 'Delete: Mobile · 1 tab' })
    await expect(deleteButton).toHaveText('Delete')
    if (capture) await capture('orphan-tab-set-delete', organizer.locator(phone ? '.capacitorPhoneSyncedSession' : '.syncedTabsSection'))
    await deleteButton.click()
    await page.getByRole('dialog', { name: 'Delete', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(organizer.getByRole('tab', { name: 'Mobile · 1 tab', exact: true })).toHaveCount(!reconnectDuringCleanup && preserveTabs ? 1 : 0)
    if (reconnectDuringCleanup) {
      await expect(organizer.getByRole('tab', { name: 'Reconnected phone · 1 tab', exact: true })).toHaveCount(3)
    }
    expect(document.devices[orphanId]).toBeUndefined()
    expect(document.deletedSessions[orphanId]).toEqual(['orphan-tabs'])
    expect(document.devices[currentDeviceId].sessions[0].sessionId).toBe('current-tabs')
    if (preserveTabs) expect(document.devices[oldDeviceId].sessions).toHaveLength(reconnectDuringCleanup ? 3 : 2)
    if (loginDisappears) expect(requests).not.toContain('DELETE /v1/account/sessions/old-login')
    else expect(requests).toContain('DELETE /v1/account/sessions/old-login')
  } finally {
    await page.evaluate(async saved => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSyncServerSnapshot', saved.settings.syncServerSnapshot)
      Object.assign(store.state.settings, saved.settings)
      Object.assign(store.state.syncServer, saved.sync)
      if (window.__syncDeviceRemovalNativePromise) {
        window.Capacitor.nativePromise = window.__syncDeviceRemovalNativePromise
        delete window.__syncDeviceRemovalNativePromise
      }
    }, saved)
    await page.unroute('https://device-removal.example/**', routeHandler)
  }
}
