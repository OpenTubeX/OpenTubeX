import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, goTo, goToSettingsSection, latestSettings, openNewWindowFromTabBar, waitForAppReady } from '../../helpers/app.mjs'
import { encryptSyncDocument, decryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'
import { encryptSyncServerDeviceInfo } from '../../../src/renderer/helpers/sync-server-sessions.js'

const key = Buffer.alloc(32, 1).toString('base64')
const salt = Buffer.alloc(16, 2).toString('base64')
const device = Buffer.alloc(16, 3).toString('base64url')
const phone = Buffer.alloc(16, 4).toString('base64url')
const videoId = 'jNQXAC9IVRw'

for (const uiScale of [95, 125]) {
  test.describe(`live sync at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          syncServerEnabled: false,
          syncServerAutoSync: false,
          syncServerUrl: 'https://sync.example',
          syncServerUsername: 'test',
          syncServerToken: 'test-token',
          syncServerPrivacyMode: 'enhanced',
          syncServerPrivacyKey: key,
          syncServerPrivacySalt: salt,
          syncServerDeviceId: device,
          syncServerDeviceName: 'Laptop',
          syncServerSyncSubscriptions: false,
          syncServerSyncPlaylists: false,
          syncServerSyncHistory: false,
          syncServerSyncProfiles: false,
          syncServerSyncSessions: false,
          syncServerSyncSettings: true,
        },
        history: [{
          _id: videoId,
          videoId,
          title: 'Send this video',
          author: 'Test Channel',
          authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
          timeWatched: Date.now(),
          lengthSeconds: 60,
          watchProgress: 10,
          type: 'video'
        }],
      }
    })

    test('receives live settings and activity, skips unchanged downloads, and sends and receives videos', async ({ page, app, attachScreenshot }) => {
      const collections = new Map()
      const events = []
      const sent = []
      const downloads = []
      const eventCursors = []
      const waiting = new Set()
      page.context().on('requestfailed', request => {
        for (const route of waiting) {
          if (route.request() === request) waiting.delete(route)
        }
      })
      let cursor = 1
      let acknowledgments = 0
      const wake = () => {
        cursor++
        for (const route of waiting) route.fulfill({ json: { cursor: String(cursor) } }).catch(() => {})
        waiting.clear()
      }
      const sessions = await Promise.all([[device, 'Laptop'], [phone, 'Phone']].map(async ([id, name]) => ({
        id,
        device_id: id,
        current: id === device,
        created_at: Date.now(),
        last_active_at: Date.now(),
        expires_at: Date.now() + 86400000,
        encrypted_device_info: await encryptSyncServerDeviceInfo({ name, platform: 'linux', architecture: '', release: '' }, key, id),
      })))
      const routeSync = async route => {
        const request = route.request()
        const url = new URL(request.url())
        const pathname = url.pathname
        if (pathname === '/health') return route.fulfill({ json: { capabilities: { encrypted_sync: 1, account_sessions: 1, live_sync: 1 } } })
        if (pathname === '/v1/account/sessions') return route.fulfill({ json: { sessions } })
        if (pathname === '/v1/encrypted_sync/changes') {
          if (url.searchParams.get('since') !== String(cursor)) return route.fulfill({ json: { cursor: String(cursor) } })
          waiting.add(route)
          return
        }
        if (pathname === '/v1/encrypted_sync/events') {
          eventCursors.push(url.searchParams.get('since'))
          if (request.method() === 'POST') {
            sent.push(request.postDataJSON())
            return route.fulfill({ status: 204 })
          }
          return route.fulfill({ json: events.filter(event => event.recipient || event.id > (url.searchParams.get('since') ?? '')) })
        }
        if (pathname.startsWith('/v1/encrypted_sync/events/')) {
          if (++acknowledgments === 1) return route.fulfill({ status: 503 })
          const index = events.findIndex(event => event.id === pathname.split('/').at(-1))
          if (index !== -1) events.splice(index, 1)
          return route.fulfill({ status: 204 })
        }
        if (pathname === '/v1/encrypted_sync') {
          return route.fulfill({
            json: {
              collections: [...collections].map(([collection, value]) => ({ collection, revision: value.revision })), legacy_data: false,
            }
          })
        }
        const collection = pathname.split('/').at(-1)
        if (request.method() === 'PUT') {
          const { revision, payload, activity } = request.postDataJSON()
          if (revision !== (collections.get(collection)?.revision ?? 0)) return route.fulfill({ status: 409 })
          collections.set(collection, { revision: revision + 1, payload })
          if (activity) events.push({ id: String(Date.now()), recipient: '', payload: activity, created_at: Date.now(), expires_at: Date.now() + 86400000 })
          wake()
        } else downloads.push(collection)
        return route.fulfill({ json: collections.get(collection) ?? { revision: 0, payload: null } })
      }
      await page.context().route('https://sync.example/**', routeSync)
      await page.route('https://sync.example/**', routeSync)
      const sync = await goToSettingsSection(page, 'sync')
      await sync.getByRole('checkbox', { name: 'Enable Sync', exact: true }).press('Space')
      await sync.getByRole('button', { name: 'Sync now', exact: true }).click()
      await expect(sync.locator('.syncActivity')).toBeVisible()
      await expect.poll(() => collections.has('settings')).toBe(true)
      const auto = sync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })
      await auto.press('Space')
      await expect(auto).toBeChecked()
      await expect.poll(() => waiting.size).toBeGreaterThan(0)
      const baselineDownloads = downloads.length
      const remote = await decryptSyncDocument(collections.get('settings').payload, key)
      const theme = remote.find(entry => entry.key === 'baseTheme')
      theme.value = 'light'
      theme.updatedAt = Date.now() + 10000
      collections.set('settings', { revision: collections.get('settings').revision + 1, payload: await encryptSyncDocument(remote, key, salt) })
      events.push({
        id: 'remote-activity',
        recipient: '',
        created_at: Date.now(),
        expires_at: Date.now() + 86400000,
        payload: await encryptSyncDocument({ version: 1, type: 'activity', deviceName: 'Phone', changes: [{ key: 'baseTheme', value: 'light' }] }, key, salt)
      })
      wake()
      await expect.poll(async () => latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8')).baseTheme).toBe('light')
      await expect(sync.locator('.activityList')).toContainText(/Phone changed Base theme to light/i)
      await expect.poll(() => waiting.size).toBeGreaterThan(0)
      expect(downloads.slice(baselineDownloads)).toEqual(['settings'])
      await sync.locator('.syncActivity').scrollIntoViewIfNeeded()
      await attachScreenshot('encrypted account activity')
      await page.keyboard.press('Escape')
      await goTo(page, 'history')
      await page.locator('.ft-list-video .title').first().click({ button: 'right' })
      const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
      await menu.getByRole('menuitem', { name: 'Open on another device', exact: true }).click()
      await expect(menu.getByRole('menuitem', { name: 'Phone', exact: true })).toBeVisible()
      await attachScreenshot('send video to another device')
      await menu.getByRole('menuitem', { name: 'Phone', exact: true }).click()
      await expect.poll(() => sent.length).toBe(1)
      expect(sent[0].recipient).toBe(phone)
      expect((await decryptSyncDocument(sent[0].payload, key)).videoId).toBe(videoId)
      const otherWindow = await openNewWindowFromTabBar(app, page)
      await waitForAppReady(otherWindow)
      const otherSync = await goToSettingsSection(otherWindow, 'sync')
      await expect(otherSync.locator('.syncActivity')).toBeVisible()
      await expect.poll(() => waiting.size).toBe(1)
      const otherAuto = otherSync.getByRole('checkbox', { name: 'Sync automatically after changes and every five minutes', exact: true })
      await otherAuto.press('Space')
      await expect(otherAuto).not.toBeChecked()
      await expect.poll(() => waiting.size).toBe(0)
      await otherAuto.press('Space')
      await expect.poll(() => waiting.size).toBe(1)
      events.push({
        id: 'received-video',
        recipient: device,
        created_at: Date.now(),
        expires_at: Date.now() + 86400000,
        payload: await encryptSyncDocument({ version: 1, type: 'openVideo', recipient: device, videoId, title: 'Remote video', position: 12, expiresAt: Date.now() + 86000000 }, key, salt)
      })
      wake()
      await expect.poll(() => events.some(event => event.id === 'received-video')).toBe(false)
      expect(eventCursors).toContain('remote-activity')
      const states = await Promise.all([page, otherWindow].map(target => target.evaluate(() => window.ftElectron.tabs.getState())))
      expect(states.flatMap(state => state.tabs).filter(tab => tab.route?.fullPath?.includes(videoId) || tab.url?.includes?.(videoId))).toHaveLength(1)
      for (const route of waiting) await route.abort().catch(() => {})
    })
  })
}
