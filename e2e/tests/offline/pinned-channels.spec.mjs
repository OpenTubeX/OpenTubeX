import { readFile } from 'node:fs/promises'
import { test, expect, latestSettings, readDatastore, goTo, waitForAppReady } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test'
    }
  }
})

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const channelId = new URL(route.request().url()).pathname.split('/')[4]
    return route.fulfill({
      json: {
        author: 'Channel',
        authorId: channelId,
        authorThumbnails: [{ url: `https://invidious.test/avatar/${channelId}`, width: 48, height: 48 }],
        authorBanners: [],
        description: 'Channel description',
        subCount: 0,
        totalViews: 0,
        joined: 0,
        tabs: ['videos', 'shorts', 'streams'],
        relatedChannels: [],
        videos: [],
        latestVideos: []
      }
    })
  })
  // The saved avatar uses Electron's native decoder, which needs a raster image.
  const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
  await page.route('https://invidious.test/avatar/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
})

test('pins unsubscribed channels, persists them and unpins after navigation', async ({ app, page }, testInfo) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  const pin = page.getByRole('button', { name: 'Pin to Navigation', exact: true })
  await expect(pin).toBeVisible()
  await pin.click()
  const unpin = page.getByRole('button', { name: 'Unpin from Navigation', exact: true })
  await expect(unpin).toHaveAttribute('aria-pressed', 'true')
  const pinned = page.locator('.sideNav .pinnedChannels .navChannel')
  await expect(pinned).toHaveCount(1)
  await expect(pinned).toHaveAttribute('href', `#/channel/${id}`)
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels)
    .toEqual([{ id, name: 'Channel', thumbnail: `https://invidious.test/avatar/${id}` }])
  await page.reload()
  await waitForAppReady(page)
  await expect(pinned).toHaveCount(1)
  await expect(unpin).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getActiveProfile.subscriptions.length)).toBe(0)
  await page.evaluate(() => window.$store.dispatch('updateHideActiveSubscriptions', true))
  await expect(pinned).toBeVisible()
  await page.evaluate(() => {
    if (!window.$store.getters.getIsSideNavOpen) window.$store.commit('toggleSideNav')
  })
  await page.screenshot({ path: testInfo.outputPath('pinned-channel.png'), animations: 'disabled' })
  await goTo(page, 'history')
  await pinned.click()
  await expect(unpin).toBeVisible()
  await unpin.click()
  await expect(pinned).toHaveCount(0)
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual([])
})
