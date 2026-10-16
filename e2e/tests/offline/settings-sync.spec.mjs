import { createHash } from 'node:crypto'

import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  latestSettings,
  openNewWindowFromTabBar,
  waitForAppReady,
  readDatastore,
} from '../../helpers/app.mjs'

test.describe('settings', () => {
  test('links the server-provided sync privacy policy and clears it when switching servers', async ({ page }) => {
    await page.route('https://sync.opentubex.org/health', route => route.fulfill({
      json: { status: 'ok', privacy_policy_url: 'https://operator.example/privacy', capabilities: {} }
    }))
    await page.route('https://sync.libretube.dev/health', route => route.fulfill({ body: 'OK' }))
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.locator('label.switch-label').filter({ hasText: 'Enable Sync' }).click()

    const privacyPolicy = syncSection.getByRole('link', {
      name: 'Privacy policy for this server'
    })

    await expect(privacyPolicy).toHaveAttribute(
      'href',
      'https://operator.example/privacy'
    )

    await syncSection.getByLabel('Sync server URL').fill('https://sync.libretube.dev')
    await expect(privacyPolicy).toHaveCount(0)
    await syncSection.getByLabel('Sync server URL').fill('https://sync.opentubex.org')
    await expect(privacyPolicy).toHaveAttribute('href', 'https://operator.example/privacy')
  })

  test('requires live support for encrypted sync while retaining legacy servers', async ({ page }) => {
    await page.route('https://sync.opentubex.org/health', route => route.fulfill({
      json: { capabilities: { encrypted_sync: 1 } }
    }))
    await page.route('https://sync.libretube.dev/health', route => route.fulfill({ body: 'OK' }))
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.locator('label.switch-label').filter({ hasText: 'Enable Sync' }).click()
    await expect(syncSection.locator('.error')).toHaveText('Update this server to support encrypted live sync.')
    await expect(syncSection.getByLabel(/Privacy passphrase/)).toBeHidden()
    await expect(syncSection.locator('.privacyHint')).toBeHidden()
    await expect(syncSection.getByText(/does not support enhanced privacy/)).toBeHidden()
    await page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'de-DE'))
    await expect(syncSection.locator('.error')).toHaveText('Aktualisiere diesen Server, um verschlüsselte Live-Synchronisierung zu unterstützen.')
    await page.evaluate(() => window.$store.dispatch('updateCurrentLocale', 'en-US'))
    await expect(syncSection.locator('.error')).toHaveText('Update this server to support encrypted live sync.')
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await syncSection.getByLabel('Sync server URL').fill('https://sync.libretube.dev')
    await expect(syncSection.getByText(/does not support enhanced privacy/)).toBeVisible()
    await expect(syncSection.getByLabel(/Privacy passphrase/)).toBeHidden()
    await syncSection.getByLabel('Username').fill('legacy-user')
    await syncSection.getByLabel('Password', { exact: true }).fill('test-password')
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeEnabled()
    await expect(syncSection.locator('.error')).toHaveCount(0)
  })

  test('waits for the device name before creating a secure sync pairing code', async ({ app, page }) => {
    const serverUrl = 'https://pairing.example'
    let createdSession
    let pendingSession
    let cancelledSessionId
    let cancelledRecipientToken

    await app.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__pairingDeviceNameResolvers = []
      ipcMain.removeHandler('get-device-name')
      ipcMain.handle('get-device-name', () => new Promise(resolve => {
        globalThis.__pairingDeviceNameResolvers.push(resolve)
      }))
    })

    await page.route(`${serverUrl}/**`, async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/health') {
        await route.fulfill({
          json: {
            status: 'ok',
            capabilities: { encrypted_sync: 1, live_sync: 1, key_pairing: 1 }
          }
        })
        return
      }
      if (url.pathname === '/v1/pairing' && request.method() === 'POST') {
        createdSession = request.postDataJSON()
        pendingSession = {
          version: 1,
          id: createdSession.id,
          account_id: null,
          recipient_public_key: createdSession.recipient_public_key,
          recipient_device_id: createdSession.recipient_device_id,
          recipient_device_name: createdSession.recipient_device_name,
          approving_device_id: null,
          expires_at: Date.now() + 120_000,
          approved: false
        }
        await route.fulfill({ status: 201, json: pendingSession })
        return
      }
      if (url.pathname.startsWith('/v1/pairing/') && request.method() === 'GET') {
        await route.fulfill({ json: pendingSession })
        return
      }
      if (url.pathname.startsWith('/v1/pairing/') && request.method() === 'DELETE') {
        cancelledSessionId = url.pathname.split('/').at(-1)
        cancelledRecipientToken = request.headers()['x-pairing-token']
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({ status: 404 })
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    await syncSection.getByLabel('Sync server URL').fill(serverUrl)
    await syncSection.getByLabel('Sync server URL').press('Tab')
    const pairButton = syncSection.getByRole('button', { name: 'Pair with an existing device' })
    const loginButton = syncSection.getByRole('button', { name: 'Log in' })
    const registerButton = syncSection.getByRole('button', { name: 'Register' })
    await expect(pairButton).toBeEnabled()
    await expect(loginButton).toBeDisabled()
    await expect(registerButton).toBeDisabled()

    await pairButton.click()
    const dialog = page.getByRole('dialog', { name: 'Pair with an existing device' })
    await expect(dialog.getByLabel('Device name')).toHaveValue('This device')
    await dialog.getByRole('button', { name: 'Create pairing code' }).click()
    await app.electronApp.evaluate(() => {
      for (const resolve of globalThis.__pairingDeviceNameResolvers) resolve('Travel laptop')
      delete globalThis.__pairingDeviceNameResolvers
    })

    await expect(dialog.getByRole('img', { name: 'Pairing QR code for Travel laptop' })).toBeVisible()
    await expect(dialog.getByText('Pairing code expires at')).toBeVisible()
    expect(createdSession).toMatchObject({ version: 1, recipient_device_name: 'Travel laptop' })
    expect(createdSession.recipient_token_hash).toMatch(/^[\w-]{43}$/)
    expect(JSON.stringify(createdSession)).not.toMatch(/privacy|passphrase|password|username|jwt/i)

    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('updateUiScale', 95)
    })
    await page.setViewportSize({ width: 600, height: 420 })
    const textCodeButton = dialog.getByRole('button', { name: 'Use text code instead' })
    await expect(textCodeButton).toBeInViewport()
    await expect(dialog.locator('.promptContentScroller')).toHaveJSProperty('scrollTop', 0)
    await textCodeButton.click()
    const codeField = dialog.getByRole('textbox', { name: 'Pairing code' })
    await expect(codeField).toHaveValue(/^opentubex-pairing:/)
    await expect(codeField).toHaveAttribute('readonly', '')

    await page.setViewportSize({ width: 600, height: 300 })
    const contentScroller = dialog.locator('.promptContentScroller')
    const cancelButton = dialog.locator('.promptFixedFooter').getByRole('button', { name: 'Cancel' })
    await expect(contentScroller).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(cancelButton).toBeVisible()
    const cancelBoundsBeforeScroll = await cancelButton.boundingBox()
    await contentScroller.evaluate(element => element.scrollTo(0, element.scrollHeight))
    await expect.poll(() => contentScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const cancelBoundsAfterScroll = await cancelButton.boundingBox()
    expect(Math.abs(cancelBoundsAfterScroll.y - cancelBoundsBeforeScroll.y)).toBeLessThanOrEqual(1)

    await cancelButton.click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => cancelledSessionId).toBe(createdSession.id)
    expect(cancelledRecipientToken).toMatch(/^[\w-]{43}$/)
    expect(createHash('sha256')
      .update(Buffer.from(cancelledRecipientToken, 'base64url'))
      .digest('base64url')).toBe(createdSession.recipient_token_hash)
  })

  test('keeps the sync server idle until sync is enabled', async ({ page }) => {
    const syncRequests = []
    await page.route('https://sync.opentubex.org/**', async (route) => {
      syncRequests.push(route.request().url())
      await route.fulfill({ status: 200, body: 'OK' })
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.getByLabel('Sync server URL')).toHaveCount(0)
    // Give an unwanted server check time to start.
    await page.waitForTimeout(500)
    expect(syncRequests).toEqual([])
  })
})

test.describe('secure pairing manual entry', () => {
  const serverUrl = 'https://pairing.example'

  test.use({
    seed: {
      settings: {
        syncServerAutoSync: false,
        syncServerEnabled: true,
        syncServerPrivacyKey: `${'A'.repeat(43)}=`,
        syncServerPrivacyMode: 'enhanced',
        syncServerPrivacySalt: `${'A'.repeat(22)}==`,
        syncServerToken: 'pairing-test-token',
        syncServerUrl: serverUrl,
        syncServerUsername: 'pairing-user'
      }
    }
  })

  test('accepts a text code when no camera is available', async ({ page }) => {
    const accountId = '0198e2d4-8ad2-7f73-8d6e-4f076707ce25'
    let approvedPayload
    const request = {
      version: 1,
      origin: serverUrl,
      sessionId: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
      recipientPublicKey: 'sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs',
      recipientDeviceId: 'MDEyMzQ1Njc4OTo7PD0-Pw',
      recipientDeviceName: 'Window B',
      pairingSecret: 'oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8'
    }
    const pairingCode = `opentubex-pairing:${Buffer.from(JSON.stringify(request)).toString('base64url')}`

    await page.route(`${serverUrl}/**`, async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/health') {
        await route.fulfill({
          json: {
            status: 'ok',
            capabilities: { encrypted_sync: 1, live_sync: 1, key_pairing: 1 }
          }
        })
        return
      }
      if (url.pathname === `/v1/pairing/${request.sessionId}/claim`) {
        await route.fulfill({
          json: {
            session: {
              version: request.version,
              id: request.sessionId,
              account_id: accountId,
              recipient_public_key: request.recipientPublicKey,
              recipient_device_id: request.recipientDeviceId,
              recipient_device_name: request.recipientDeviceName,
              approving_device_id: null,
              expires_at: Date.now() + 120_000,
              approved: false
            },
            jwt: 'fresh.pairing.token'
          }
        })
        return
      }
      if (url.pathname === `/v1/pairing/${request.sessionId}` &&
          route.request().method() === 'PUT') {
        approvedPayload = route.request().postDataJSON()
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({ status: 404 })
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await expect(syncSection.getByText('Enhanced privacy is enabled.')).toBeVisible()

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          enumerateDevices: () => Promise.resolve([]),
          getUserMedia: () => Promise.reject(new Error('No camera'))
        }
      })
    })

    await syncSection.getByRole('button', { name: 'Pair another device' }).click()
    const dialog = page.getByRole('dialog', { name: 'Pair another device' })
    await expect(dialog.getByRole('alert')).toContainText('could not access a camera')
    await dialog.getByRole('button', { name: 'Enter code manually' }).click()
    await dialog.getByRole('textbox', { name: 'Pairing code' }).fill(pairingCode)
    await dialog.getByRole('button', { name: 'Check code' }).click()

    await expect(dialog.getByText(serverUrl, { exact: true })).toBeVisible()
    await expect(dialog.getByText('Window B', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Approve pairing' }).click()
    await expect(dialog.locator('.pairingVerificationCode')).toHaveText(/^\d{6}$/)
    expect(approvedPayload.approving_device_id).toMatch(/^[\w-]{22}$/)
    expect(approvedPayload.encrypted_payload).toMatch(/^[\w-]+$/)
    expect(JSON.stringify(approvedPayload)).not.toMatch(/fresh\.pairing\.token|pairing-user/)
    await expect(dialog.locator('.promptFixedFooter').getByRole('button', { name: 'Close' }))
      .toBeVisible()
  })
})

test.describe('sync settings', () => {
  test.use({
    seed: {
      settings: {
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerPrivacyKey: 'e2e-privacy-key',
        syncServerPrivacyMode: 'legacy',
        syncServerSnapshot: '{"subscriptions":[]}',
        syncServerToken: 'invalid-token',
        syncServerUrl: 'https://sync.example',
        syncServerUsername: 'sync-user',
        syncServerLastSyncAt: 1234
      }
    }
  })

  test('keeps the connected account label in the settings layout', { tag: '@scale' }, async ({ page }) => {
    await page.route('https://sync.example/**', route => route.fulfill({
      json: { status: 'ok', capabilities: {} }
    }))
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    const label = syncSection.getByText('Connected as sync-user')
    await expect(label).toBeVisible()
    await expect(label).toHaveCSS('position', 'static')
    await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(label).toHaveCSS('padding-top', '0px')
    await expect(label).toHaveCSS('text-align', 'center')
    const bounds = await label.boundingBox()
    const fields = await syncSection.locator('.fields').boundingBox()
    const toggles = await syncSection.locator('.toggles').nth(1).boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(fields.y + fields.height)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(toggles.y)

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    const banner = page.getByRole('status').filter({ hasText: /^Offline$/ })
    await expect(banner).toBeVisible()
    await expect(page.locator('.connection-status-holder')).toHaveCSS('position', 'fixed')
    await expect(label).toHaveCSS('position', 'static')
    await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })

  test('keeps the paired username when its device metadata update fails', async ({ page }) => {
    await page.route('https://sync.example/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/health') {
        return route.fulfill({
          json: { status: 'ok', capabilities: { account_sessions: 1 } }
        })
      }
      if (url.pathname.endsWith('/account/sessions/current')) {
        return route.fulfill({ status: 503, body: 'metadata unavailable' })
      }
      return route.fulfill({ status: 404 })
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    const username = syncSection.getByLabel('Username')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await expect(username).toBeEnabled()
    await username.fill('')
    await expect(username).toHaveValue('')

    await page.evaluate(() => {
      const store = window.$store
      return store.dispatch('completeSyncServerPairing', {
        serverUrl: 'https://sync.example',
        username: 'paired-user',
        token: 'paired-token',
        privacyKey: 'paired-privacy-key',
        privacySalt: 'paired-privacy-salt',
        deviceId: 'MDEyMzQ1Njc4OTo7PD0-Pw',
        deviceName: 'Paired device',
        deviceSystemInfo: {
          platform: 'android',
          architecture: 'arm64-v8a',
          release: '16'
        }
      })
    })

    await expect(username).toBeDisabled()
    await expect(username).toHaveValue('paired-user')
  })

  test('records concurrent setting edits without losing a sync timestamp', async ({ page }) => {
    const updatedAt = await page.evaluate(async () => {
      const store = window.$store
      await Promise.all([
        store.dispatch('recordSyncSettingEdit', 'baseTheme'),
        store.dispatch('recordSyncSettingEdit', 'mainColor'),
      ])
      return store.state.settings.syncServerSettingUpdatedAt
    })

    expect(updatedAt.baseTheme).toEqual(expect.any(Number))
    expect(updatedAt.mainColor).toEqual(expect.any(Number))
  })

  test('does not follow sync-server redirects with credentials', async ({ page }) => {
    let credentialedRequestStarted
    const credentialedRequest = new Promise(resolve => {
      credentialedRequestStarted = resolve
    })
    let downgradedRequests = 0
    await page.route('https://sync.example/**', route => {
      if (route.request().headers().authorization === 'invalid-token') {
        credentialedRequestStarted()
      }
      return route.fulfill({
        status: 307,
        headers: { location: 'http://sync.opentubex.org/health' }
      })
    })
    await page.route('http://sync.opentubex.org/**', route => {
      downgradedRequests++
      return route.fulfill({ status: 200, body: 'OK' })
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    await credentialedRequest
    await page.waitForTimeout(100)
    expect(downgradedRequests).toBe(0)
  })

  test('shows session expiration and other sync failures outside Sync settings', async ({ page }) => {
    let response = { status: 500, body: 'Background sync failed' }
    await page.route('https://sync.example/**', async (route) => {
      await route.fulfill(response)
    })

    const sync = () => page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('syncWithSyncServer').catch(() => {})
    })

    await sync()
    const toast = page.locator('.toast', {
      hasText: 'Sync failed: Background sync failed'
    })
    await expect(toast).toBeVisible()
    await expect(toast.locator('.icon[data-icon="circle-exclamation"]')).toBeVisible()

    response = { status: 401, body: 'Invalid or missing authentication token' }
    await sync()
    await expect(page.locator('.toast', {
      hasText: 'Sync failed: Sync server session expired. Sign in again to resume syncing.'
    })).toBeVisible()
  })

  test('clears a sync error and enables credentials after disconnecting', async ({ page }) => {
    let delayServerCheck = false
    let finishServerCheck
    let serverCheckStarted
    const serverCheckPending = new Promise((resolve) => {
      finishServerCheck = resolve
    })
    const serverCheckRequested = new Promise((resolve) => {
      serverCheckStarted = resolve
    })
    await page.route('https://sync.example/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/health') {
        if (delayServerCheck) {
          serverCheckStarted()
          await serverCheckPending
        }
        await route.fulfill({ status: 200, json: { capabilities: { encrypted_sync: 1, live_sync: 1 } } })
      } else {
        await route.fulfill({ status: 500, body: 'Sync failed' })
      }
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText('Sync failed')
    await page.waitForTimeout(250)
    await expect(page.locator('.toast', { hasText: 'Sync failed: Sync failed' })).toHaveCount(0)

    await expect(syncSection.getByLabel('Sync server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    // Sync may query optional capabilities before the post-disconnect check.
    delayServerCheck = true
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()

    try {
      await serverCheckRequested
      // Scoped to the sync failure: the same element also carries unrelated
      // notices (e.g. the enhanced-privacy hint) once the server check lands.
      await expect(syncSection.locator('.error', { hasText: 'Sync failed' })).toHaveCount(0)
      await expect(syncSection.getByLabel('Sync server URL')).toBeEnabled()
      await expect(syncSection.getByLabel('Username')).toBeEnabled()
      await expect(syncSection.getByLabel('Password', { exact: true })).toBeEnabled()
    } finally {
      finishServerCheck()
    }
  })

  test('stops an active sync when sync is disabled', async ({ page }) => {
    let finishSyncRequest
    let syncRequestStarted
    const syncRequestPending = new Promise((resolve) => {
      finishSyncRequest = resolve
    })
    const syncRequestRequested = new Promise((resolve) => {
      syncRequestStarted = resolve
    })
    const syncRequests = []

    await page.route('https://sync.example/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, json: { capabilities: { encrypted_sync: 1, live_sync: 1 } } })
        return
      }

      if (pathname === '/v1/account/sessions' || pathname === '/v1/encrypted_sync/events') {
        await route.fulfill({ json: [] })
        return
      }
      syncRequests.push(pathname)
      syncRequestStarted()
      await syncRequestPending
      await route.fulfill({ status: 200, json: [] })
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await syncRequestRequested
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    finishSyncRequest()

    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(syncSection.locator('.syncProgress')).toBeHidden()
    await expect(syncSection.locator('.error')).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: 'Sync completed' })).toHaveCount(0)
    // Give a stray follow-up sync time to start.
    await page.waitForTimeout(500)
    expect(syncRequests).toHaveLength(1)
  })

  test('stops an active sync in another window when sync is disabled', async ({ app, page }) => {
    const otherWindow = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(otherWindow)

    let finishSyncRequest
    let syncRequestStarted
    const syncRequestPending = new Promise((resolve) => {
      finishSyncRequest = resolve
    })
    const syncRequestRequested = new Promise((resolve) => {
      syncRequestStarted = resolve
    })
    const syncRequests = []

    await otherWindow.route('https://sync.example/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, json: { capabilities: { encrypted_sync: 1, live_sync: 1 } } })
        return
      }
      if (pathname === '/v1/account/sessions' || pathname === '/v1/encrypted_sync/events') {
        await route.fulfill({ json: [] })
        return
      }
      syncRequests.push(pathname)
      syncRequestStarted()
      await syncRequestPending
      await route.fulfill({ status: 200, json: [] }).catch(() => {})
    })

    await goTo(page, 'settings')
    await goTo(otherWindow, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    await otherWindow.locator('.settingsMenu [data-section="sync"]').click()
    const firstSyncSection = page.locator('[data-section="sync"]')
    const otherSyncSection = otherWindow.locator('[data-section="sync"]')

    await otherSyncSection.getByRole('button', { name: 'Sync now' }).click()
    await syncRequestRequested
    await firstSyncSection.getByText('Enable Sync', { exact: true }).click()
    finishSyncRequest()

    await expect(firstSyncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(otherSyncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect(otherSyncSection.locator('.syncProgress')).toBeHidden()
    // Give a stray follow-up sync time to start.
    await otherWindow.waitForTimeout(500)
    expect(syncRequests).toHaveLength(1)
  })

  test('cancels authentication without storing a new token when sync is disabled', async ({ app, page }) => {
    let finishAuthentication
    let authenticationStarted
    const authenticationPending = new Promise((resolve) => {
      finishAuthentication = resolve
    })
    const authenticationRequested = new Promise((resolve) => {
      authenticationStarted = resolve
    })

    await page.route('https://sync.example/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
        return
      }
      authenticationStarted()
      await authenticationPending
      await route.fulfill({ status: 200, json: { jwt: 'late-token' } }).catch(() => {})
    })

    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()
    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await syncSection.getByLabel('Username').fill('sync-user')
    await syncSection.getByLabel('Password', { exact: true }).fill('sync-password')
    await syncSection.getByRole('button', { name: 'Log in' }).click()
    await authenticationRequested
    await syncSection.getByText('Enable Sync', { exact: true }).click()
    finishAuthentication()

    await expect(syncSection.getByLabel('Enable Sync')).not.toBeChecked()
    await expect.poll(async () => {
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      return settings.syncServerToken
    }).toBe('')
  })

  test('disables credentials while authentication is pending', async ({ page }) => {
    let finishAuthentication
    const authenticationPending = new Promise((resolve) => {
      finishAuthentication = resolve
    })
    await page.route('https://sync.example/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/health') {
        await route.fulfill({ status: 200, body: 'OK' })
      } else {
        await authenticationPending
        await route.fulfill({ status: 401, body: 'Invalid credentials' })
      }
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Disconnect' }).click()
    await expect(syncSection.getByLabel('Username')).toBeEnabled()
    await syncSection.getByLabel('Username').fill('sync-user')
    const passwordInput = syncSection.getByLabel('Password', { exact: true })
    await passwordInput.fill('sync-password')
    const passwordToggle = passwordInput.locator('../..').locator('.passwordVisibilityToggle')
    await passwordToggle.click()
    await expect(passwordInput).toHaveAttribute('type', 'text')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    await expect(syncSection.getByLabel('Sync server URL')).toBeDisabled()
    await expect(syncSection.getByLabel('Username')).toBeDisabled()
    await expect(passwordInput).toBeDisabled()
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(passwordToggle).toHaveAccessibleName('Show password')
    await expect(passwordToggle).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await expect(syncSection.getByRole('button', { name: 'Register' })).toBeDisabled()

    finishAuthentication()
    await expect(syncSection.locator('.error')).toHaveText('Invalid credentials')
    await expect(syncSection.getByLabel('Sync server URL')).toBeEnabled()
    await expect(syncSection.getByLabel('Username')).toBeEnabled()
    await expect(passwordInput).toBeEnabled()
    await expect(passwordToggle).toBeEnabled()
  })

  test('preserves the sync baseline while reauthenticating an expired session', async ({ app, page }) => {
    let finishPostLoginSync
    let postLoginSyncStarted
    const postLoginSyncPending = new Promise((resolve) => {
      finishPostLoginSync = resolve
    })
    const postLoginSyncRequested = new Promise((resolve) => {
      postLoginSyncStarted = resolve
    })
    let authenticatedManifestRequests = 0

    await page.route('https://sync.example/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      const authorization = request.headers().authorization

      if (pathname === '/health') {
        await route.fulfill({
          status: 200,
          json: { capabilities: { encrypted_sync: 1, live_sync: 1 } }
        })
      } else if (pathname === '/v1/account/login') {
        await route.fulfill({ status: 200, json: { jwt: 'renewed-token' } })
      } else if (authorization === 'invalid-token') {
        await route.fulfill({
          status: 401,
          body: 'Invalid or missing authentication token'
        })
      } else if (pathname === '/v1/encrypted_sync') {
        authenticatedManifestRequests++
        if (authenticatedManifestRequests === 2) {
          postLoginSyncStarted()
          await postLoginSyncPending
        }
        await route.fulfill({ status: 200, json: { collections: [] } })
      } else if (request.method() === 'PUT') {
        await route.fulfill({ status: 200, json: {} })
      } else {
        await route.fulfill({ status: 200, json: { revision: 0 } })
      }
    })
    await goTo(page, 'settings')
    await page.locator('.settingsMenu [data-section="sync"]').click()

    const syncSection = page.locator('[data-section="sync"]')
    await syncSection.getByRole('button', { name: 'Sync now' }).click()
    await expect(syncSection.locator('.error')).toHaveText(
      'Sync server session expired. Sign in again to resume syncing.'
    )
    await expect(syncSection.getByLabel('Username')).toBeEnabled()

    await syncSection.getByLabel('Password', { exact: true }).fill('sync-password')
    await syncSection.getByLabel(/Privacy passphrase/).fill('sync-privacy-passphrase')
    await syncSection.getByRole('button', { name: 'Log in' }).click()

    try {
      await postLoginSyncRequested
      const settings = latestSettings(
        readDatastore(app.userDataDir, 'settings')
      )
      expect(settings.syncServerSnapshot).toBe('{"subscriptions":[]}')
      expect(settings.syncServerLastSyncAt).toBe(1234)
    } finally {
      finishPostLoginSync()
    }

    await expect(syncSection.getByText('Connected as sync-user')).toBeVisible()
    await expect(syncSection.getByText(/Last synced:/)).toBeVisible()
  })
})

test.describe('tabs from other synced devices', () => {
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        syncServerEnabled: true,
        syncServerAutoSync: false,
        syncServerUsername: 'test-user',
        syncServerToken: 'offline-test-token',
        syncServerPrivacyMode: 'enhanced',
        syncServerSyncSessions: true,
        syncServerSharedTabs: false,
      }
    }
  })

  test('confirms before replacing other devices’ tabs with this device tab set', async ({ page }) => {
    await page.route('https://sync.opentubex.org/**', route => route.fulfill({
      json: { status: 'ok', capabilities: { encrypted_sync: 1 } }
    }))
    const section = await goToSettingsSection(page, 'sync')
    const toggle = section.getByRole('checkbox', { name: 'Use one shared tab set across devices' })
    const toggleLabel = section.locator('label.switch-label')
      .filter({ hasText: 'Use one shared tab set across devices' })
    await expect(toggle).not.toBeChecked()
    await toggleLabel.click()

    const dialog = page.getByRole('dialog', { name: 'Use one shared tab set across devices' })
    await expect(dialog).toContainText('The open tabs on this device become the shared set.')
    await expect(dialog).toContainText('tabs from different devices are not combined')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toggle).not.toBeChecked()

    await toggleLabel.click()
    await dialog.getByRole('button', { name: 'Use one shared tab set across devices' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeChecked()
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSharedTabs
    })).toBe(true)
    await toggleLabel.click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.state.settings.syncServerSharedTabs
    })).toBe(false)
  })

  test('does not schedule sync for a superseded shared-tab choice', async ({ page }) => {
    await page.route('https://sync.opentubex.org/**', route => route.fulfill({
      json: { status: 'ok', capabilities: { encrypted_sync: 1 } }
    }))
    const section = await goToSettingsSection(page, 'sync')
    const toggle = section.getByRole('checkbox', { name: 'Use one shared tab set across devices' })
    const toggleLabel = section.locator('label.switch-label')
      .filter({ hasText: 'Use one shared tab set across devices' })
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setSyncServerSharedTabs', true)
      const dispatch = store.dispatch.bind(store)
      window.sharedTabUpdates = []
      window.sharedTabSyncSchedules = []
      store.dispatch = (action, ...args) => {
        if (action === 'updateSyncServerSharedTabs') {
          return new Promise(resolve => window.sharedTabUpdates.push({ enabled: args[0], resolve }))
        }
        if (action === 'scheduleSyncServer') {
          window.sharedTabSyncSchedules.push(args[0])
          return Promise.resolve()
        }
        return dispatch(action, ...args)
      }
    })
    await expect(toggle).toBeChecked()
    await toggleLabel.click()
    await toggleLabel.click()
    const dialog = page.getByRole('dialog', { name: 'Use one shared tab set across devices' })
    await dialog.getByRole('button', { name: 'Use one shared tab set across devices' }).click()
    await expect.poll(() => page.evaluate(() => window.sharedTabUpdates.map(update => update.enabled)))
      .toEqual([false, true])

    await page.evaluate(async () => {
      window.sharedTabUpdates[0].resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await expect.poll(() => page.evaluate(() => window.sharedTabSyncSchedules)).toEqual([])
    await page.evaluate(() => {
      window.sharedTabUpdates[1].resolve()
    })
    await expect.poll(() => page.evaluate(() => window.sharedTabSyncSchedules)).toEqual(['sessions'])
  })

  test('keeps synced tab sets in the tab organizer instead of settings', async ({ page }) => {
    await page.route('https://sync.opentubex.org/**', route => route.fulfill({
      json: { status: 'ok', capabilities: {} }
    }))
    const section = await goToSettingsSection(page, 'sync')
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setSyncServerOtherDeviceSessions', [{
        sessionId: 'desktop-session',
        syncDeviceId: 'desktop-device',
        syncPlatform: 'desktop',
        tabs: [
          { id: 'first', title: 'A long channel tab title', url: 'https://www.youtube.com/' },
          { id: 'second', title: 'Watch later', url: 'https://www.youtube.com/playlist?list=WL' },
        ],
      }])
    })

    await expect(section.getByRole('heading', { name: 'Tabs from other devices' })).toHaveCount(0)
  })
})
