import { test, expect, latestSettings, readDatastore, goTo, sel, waitForAppReady } from '../../helpers/app.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

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

for (const [surface, selector] of [['name', '.title'], ['avatar', '.channelThumbnailLink'], ['handle', '.handle']]) {
  test(`pins an unsubscribed channel from its ${surface} context menu and unpins from navigation`, async ({ app, page }) => {
    await page.locator(sel.searchInput).fill('channels')
    await page.locator(sel.searchInput).press('Enter')
    const card = page.locator('.ft-list-channel')
    await expect(card.locator('.h3Title')).toHaveText(channel.name)
    await expectImagesLoaded(card.locator('img'))
    const searchUrl = page.url()
    const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    const pin = menu.getByRole('menuitem', { name: 'Pin to Navigation', exact: true })
    const unpin = menu.getByRole('menuitem', { name: 'Unpin from Navigation', exact: true })

    await card.locator(selector).click({ button: 'right' })
    await expect(pin).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Hide channel', exact: true })).toBeVisible()
    await pin.click()
    await expect(menu).toBeHidden()
    await expect(page).toHaveURL(searchUrl)
    await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels)
      .toEqual([otherChannel, channel])
    await expect.poll(() => page.evaluate(() => window.$store.getters.getActiveProfile.subscriptions.map(channel => channel.id)))
      .toEqual([otherChannel.id])

    await card.locator(selector).click({ button: 'right' })
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
}

test('unpins and repins a subscribed channel without an avatar', async ({ app, page }) => {
  await goTo(page, 'subscribedchannels')
  const link = page.locator('.channels .channelName')
  const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
  await link.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Unpin from Navigation', exact: true }).click()
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual([])
  await link.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Pin to Navigation', exact: true }).click()
  await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).pinnedChannels).toEqual([otherChannel])
  await expect(link).toBeVisible()
})
