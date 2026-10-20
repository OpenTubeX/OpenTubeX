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
        authorThumbnails: [{ url: `https://yt3.googleusercontent.com/${channelId}=s176`, width: 48, height: 48 }],
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
  await page.route('https://invidious.test/ggpht/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
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
    .toEqual([{ id, name: 'Channel', thumbnail: `https://yt3.googleusercontent.com/${id}=s176` }])
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

test('pinned channels respect disabled channel links', async ({ page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  await page.evaluate(id => window.$store.dispatch('updatePinnedChannels', [{ id, name: 'Channel', thumbnail: null }]), id)
  const pinned = page.locator('.sideNav .pinnedChannels .navChannel')
  await expect(pinned).toHaveAttribute('href', `#/channel/${id}`)
  await page.evaluate(() => window.$store.dispatch('updateDisableChannelLinks', true))
  await expect(pinned).not.toHaveAttribute('href')
  await expect(pinned).toHaveClass(/disabledIcon/)
  const url = page.url()
  await pinned.click({ force: true })
  await expect(page).toHaveURL(url)
  await page.evaluate(() => window.$store.dispatch('updateDisableChannelLinks', false))
  await expect(pinned).toHaveAttribute('href', `#/channel/${id}`)
})

test('pinned avatars follow the active backend and Invidious instance', async ({ page }) => {
  const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
  await page.route('https://other.invidious.test/ggpht/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
  await page.route('https://yt3.googleusercontent.com/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
  await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
  await page.getByRole('button', { name: 'Pin to Navigation', exact: true }).click()
  const image = page.locator('.sideNav .pinnedChannels img')
  await expect(image).toHaveAttribute('src', `https://invidious.test/ggpht/${id}=s35`)
  await page.evaluate(() => window.$store.dispatch('updateDefaultInvidiousInstance', 'https://other.invidious.test'))
  await expect(image).toHaveAttribute('src', `https://other.invidious.test/ggpht/${id}=s35`)
  await page.evaluate(() => window.$store.dispatch('updateBackendPreference', 'local'))
  await expect(image).toHaveAttribute('src', `https://yt3.googleusercontent.com/${id}=s35`)
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
})

for (const subscribeFirst of [true, false]) {
  test(`shows subscribed pinned channels once when subscribing ${subscribeFirst ? 'before' : 'after'} pinning`, async ({ page }) => {
    const id = 'UCaaaaaaaaaaaaaaaaaaaaaa'
    await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: true }), id)
    const subscribe = page.locator('.channelDetails:visible .subscribeButton')
    const pin = page.getByRole('button', { name: 'Pin to Navigation', exact: true })
    if (subscribeFirst) {
      await subscribe.click()
      await expect(subscribe).toHaveText('Unsubscribe')
    }
    await pin.click()
    if (!subscribeFirst) {
      await subscribe.click()
      await expect(subscribe).toHaveText('Unsubscribe')
    }
    const links = page.locator(`.sideNav .navChannel[href="#/channel/${id}"]`)
    await expect(links).toHaveCount(1)
    await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveCount(1)
    await page.getByRole('button', { name: 'Unpin from Navigation', exact: true }).click()
    await expect(page.locator('.sideNav .pinnedChannels .navChannel')).toHaveCount(0)
    await expect(links).toHaveCount(1)
    await expect(subscribe).toHaveText('Unsubscribe')
  })
}
