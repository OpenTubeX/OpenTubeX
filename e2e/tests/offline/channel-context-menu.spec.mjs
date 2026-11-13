import { test, expect, latestSettings, readDatastore, goTo, sel, waitForAppReady } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'
import { mockWatchPage } from '../../helpers/watch.mjs'

const channel = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Example Channel', thumbnail: 'https://yt3.googleusercontent.com/example=s176' }
const otherChannel = { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Other Channel', thumbnail: null }

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test',
      fetchSubscriptionsAutomatically: false,
      pinnedChannels: [otherChannel]
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [otherChannel]
    }]
  }
})

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/ggpht/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route('https://invidious.test/api/v1/search**', route => route.fulfill({
    json: new URL(route.request().url()).searchParams.get('page') === '1'
      ? [{
          type: 'channel',
          authorId: channel.id,
          author: channel.name,
          authorThumbnails: [{ url: channel.thumbnail }],
          channelHandle: '@example',
          subCount: 1000,
          description: ''
        }]
      : []
  }))
})

test('pins an unsubscribed channel from its name context menu and unpins from navigation', async ({ app, page }) => {
  await page.locator(sel.searchInput).fill('channels')
  await page.locator(sel.searchInput).press('Enter')
  const card = page.locator('.ft-list-channel')
  await expect(card.locator('.h3Title')).toHaveText(channel.name)
  await expectImagesLoaded(card.locator('img'))
  const searchUrl = page.url()
  const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
  const pin = menu.getByRole('menuitem', { name: 'Pin to Navigation', exact: true })
  const unpin = menu.getByRole('menuitem', { name: 'Unpin from Navigation', exact: true })

  await card.locator('.title').click({ button: 'right' })
  await expect(pin).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Hide channel', exact: true })).toBeVisible()
  await pin.click()
  await expect(menu).toBeHidden()
  await expect(page).toHaveURL(searchUrl)
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels)
    .toEqual([otherChannel, channel])
  await expect(page.getByText('Failed to save channel settings', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.$store.getters.getActiveProfile.subscriptions.map(channel => channel.id)))
    .toEqual([otherChannel.id])

  await card.locator('.title').click({ button: 'right' })
  await expect(unpin).toBeVisible()
  await expect(pin).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.reload()
  await waitForAppReady(page)
  const pinned = page.locator(`.sideNav .pinnedChannels a[href="#/channel/${channel.id}"]`)
  await expect(pinned).toHaveAttribute('title', channel.name)
  await pinned.click({ button: 'right' })
  await unpin.click()
  await expect(pinned).toHaveCount(0)
  await expect(page).toHaveURL(searchUrl)
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels)
    .toEqual([otherChannel])
})

test('pins an uncached watch-page channel from its name with the visible avatar', async ({ app, page }) => {
  await page.evaluate(() => window.$store.dispatch('updateBackendPreference', 'local'))
  await mockWatchPage(app, page)
  await page.route(/^https:\/\/yt3\.(ggpht|googleusercontent)\.com\//, route => fulfillVisualFixture(route, 'avatar'))
  await page.evaluate(() => window.ftElectron.tabs.create({ route: '/watch/jNQXAC9IVRw', makeActive: true }))
  const info = page.locator('.watchVideoInfo:visible')
  const link = info.locator('.channelName')
  await expect(link).toBeVisible()
  const image = info.locator('img.channelThumbnail')
  await expectImagesLoaded(image)
  const id = (await link.getAttribute('href')).split('/').at(-1)
  const name = (await link.textContent()).trim()
  const thumbnail = await image.getAttribute('src')
  expect(await page.evaluate(id => window.$store.getters.getChannelThumbnail(id), id)).toBeNull()
  expect(await page.evaluate(id => window.$store.getters.getSubscribedChannelsById.has(id), id)).toBe(false)
  await link.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin to Navigation', exact: true }).click()
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels)
    .toEqual([otherChannel, { id, name, thumbnail }])
})

for (const pinned of [false, true]) {
  test(`reports a failed channel ${pinned ? 'unpin' : 'pin'} save`, async ({ app, page }) => {
    const savedChannels = pinned ? [otherChannel] : []
    await page.evaluate(async channels => {
      await window.$store.dispatch('updatePinnedChannels', channels)
      window.$store._actions.updatePinnedChannels = [() => Promise.resolve(false)]
    }, savedChannels)
    await goTo(page, 'subscribedchannels')
    await page.locator('.channels .channelName').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    await menu.getByRole('menuitem', { name: pinned ? 'Unpin from Navigation' : 'Pin to Navigation', exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(page.getByText('Failed to save channel settings', { exact: true })).toBeVisible()
    expect(latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual(savedChannels)
  })
}
