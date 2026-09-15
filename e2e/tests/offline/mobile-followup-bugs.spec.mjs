import { test, expect, goTo, goToSettingsSection, sel } from '../../helpers/app.mjs'

test.use({ seed: { settings: { ytDlpFfmpegSource: 'managed', backendPreference: 'invidious', defaultInvidiousInstance: 'https://invidious.test' } } })

for (const { width, uiScale } of [{ width: 740, uiScale: 100 }, { width: 900, uiScale: 100 }, { width: 1000, uiScale: 125 }]) {
  test.describe(`landscape at ${uiScale}% scale`, () => {
    test.use({ seed: { settings: { uiScale } } })
    test(`forced phone pages stay beside the sidebar in landscape at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 400 })
      for (const route of ['userplaylists', 'history', 'subscribedchannels', 'stats']) {
        await goTo(page, route)
        await page.locator('.app').evaluate(element => {
          element.classList.remove('topTabs', 'bottomTabs', 'verticalTabs')
          element.classList.add('capacitorTabs', 'capacitorPhoneLayout')
        })
        const main = await page.locator('.app > .routerView').boundingBox()
        const nav = await page.locator('.sideNav').boundingBox()
        expect(main.y, route).toBeLessThan(130)
        expect(main.x, route).toBeGreaterThanOrEqual(nav.x + nav.width)
        expect(main.x + main.width, route).toBeLessThanOrEqual(width)
      }
    })
  })
}

test('synced channel tabs load an avatar without visiting the channel', async ({ page }) => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: { author: 'Remote channel', authorId: channelId, authorThumbnails: [{ url: 'https://invidious.test/avatar.png' }], tabs: [] }
  }))
  await page.route('https://invidious.test/avatar.png', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>'
  }))
  await page.evaluate(id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSyncServerEnabled', true)
    store.commit('setSyncServerToken', 'e2e-token')
    store.commit('setSyncServerPrivacyMode', 'enhanced')
    store.commit('setSyncServerSyncSessions', true)
    store.commit('setSyncServerSharedTabs', false)
    store.commit('setSyncServerOtherDeviceSessions', [{ syncDeviceId: 'remote', syncPlatform: 'mobile', sessionId: 'remote', tabs: [{ id: 'remote-channel', title: 'Remote channel', url: `https://localhost/channel/${id}` }] }])
  }, channelId)
  await page.locator(sel.tabOrganizerButton).click()
  const avatar = page.locator('.syncedTabTarget img')
  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('src', 'https://invidious.test/avatar.png')
  await expect.poll(() => avatar.evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
})

test('groups FFmpeg and FFprobe checking and missing messages', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('yt-dlp-get-info')
    const pending = new Promise(resolve => { globalThis.releaseFollowupToolInfo = resolve })
    ipcMain.handle('yt-dlp-get-info', async () => {
      await pending
      return { ytDlp: { available: false }, ffmpeg: { available: false }, ffprobe: { available: false } }
    })
  })
  const section = await goToSettingsSection(page, 'advanced')
  const status = section.locator('.externalSoftwareTool').nth(1).locator('.externalSoftwareToolStatus')
  await expect(status.locator('p')).toHaveText(['Checking FFmpeg/FFprobe…'])
  await app.electronApp.evaluate(() => {
    globalThis.releaseFollowupToolInfo()
    delete globalThis.releaseFollowupToolInfo
  })
  await expect(status.locator('p')).toHaveText(['FFmpeg/FFprobe have not been downloaded yet. Click the button below to download them.'])
})

test('keeps watch statistics and week start together in general settings', async ({ page }) => {
  const section = await goToSettingsSection(page, 'general')
  await expect(section.getByRole('checkbox', { name: 'Enable Watch Statistics', exact: true })).toBeVisible()
  await expect(section.getByRole('combobox', { name: 'Week Starts On', exact: true })).toBeVisible()
  await goToSettingsSection(page, 'privacy')
  await expect(page.locator('[data-section="privacy"]').getByRole('checkbox', { name: 'Enable Watch Statistics', exact: true })).toHaveCount(0)
})
