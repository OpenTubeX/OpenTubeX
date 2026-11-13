import { DBActions, IpcChannels } from '../../../src/constants.js'
import { defaultThemeClass, test, expect, goTo } from '../../helpers/app.mjs'

const channel = index => ({ id: `UC${String(index).padStart(22, '0')}`, name: `Channel ${index + 1}`, thumbnail: '' })

function seed(channels, settings = {}) {
  return {
    settings: {
      baseTheme: 'system',
      themeColorMode: 'standard',
      mainColor: 'Red',
      secColor: 'Blue',
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://feeds.example',
      fetchSubscriptionsAutomatically: false,
      useRssFeeds: true,
      hideSubscriptionsVideos: true,
      hideSubscriptionsLive: true,
      hideSubscriptionsCommunity: true,
      ...settings
    },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: channels
    }]
  }
}

test.describe('unavailable channels', () => {
  const channels = Array.from({ length: 20 }, (_, index) => channel(index))
  test.use({ seed: seed(channels) })

  test('are listed above the feed with links, technical details, and an unsubscribe button', async ({ page, app }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.route('https://feeds.example/**', route => route.fulfill({ status: 404, body: 'Not found' }))
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await page.getByRole('button', { name: /Refresh Shorts/ }).click()

    const box = page.locator('.channelErrors.hasErrors')
    await expect(box.getByRole('status')).toHaveText(/\b20\b/)
    const rows = box.getByRole('listitem')
    await expect(rows).toHaveCount(3)
    // The box is visible, so the refresh doesn't point to it
    await expect(page.locator('.toast', { hasText: 'could not be refreshed' })).toHaveCount(0)

    const firstRow = rows.first()
    const channelLink = firstRow.getByRole('link', { name: channels[0].name })
    await expect(channelLink).toHaveAttribute('href', new RegExp(`/channel/${channels[0].id}$`))
    await expect(channelLink.locator('.channelAvatar')).toBeVisible()
    await expect(firstRow).toContainText('This channel does not exist')
    await expect(firstRow.getByRole('button', { name: 'Unsubscribe' })).toBeVisible()

    await box.getByRole('button', { name: 'Show all' }).click()
    await expect(rows).toHaveCount(20)
    await expect(box.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
    const overflow = await box.evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)

    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme })
      await expect(page.locator('body')).toHaveClass(defaultThemeClass(colorScheme))
      await testInfo.attach(`unavailable channels ${colorScheme}`, { body: await box.screenshot(), contentType: 'image/png' })
    }

    await box.getByRole('button', { name: 'Copy technical details' }).click()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels.at(-1).id)
    const details = await app.electronApp.evaluate(({ clipboard }) => clipboard.readText())
    for (const { id, name } of channels) expect(details).toContain(`${name} (${id})`)
    expect(details).toContain('HTTP 404')

    await firstRow.getByRole('button', { name: 'Unsubscribe' }).click()
    await expect(box.getByRole('status')).toHaveText(/\b19\b/)
    await expect(box.getByRole('link', { name: channels[0].name, exact: true })).toHaveCount(0)
    expect(await page.evaluate(id => window.$store.getters.getActiveProfile.subscriptions.some(channel => channel.id === id), channels[0].id)).toBe(false)

    await box.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.channelErrors.hasErrors')).toHaveCount(0)
    // The focus stays where the box was instead of falling back to the page
    await expect(page.locator('.channelErrors')).toBeFocused()
  })
})

test.describe('channels that could not be refreshed in several New feed categories', () => {
  const channels = [channel(0), channel(1)]
  test.use({ seed: seed(channels, { hideSubscriptionsVideos: false }) })

  test('are listed once and can be retried on their own', async ({ page }) => {
    const failing = new Set(channels.map(({ id }) => id.slice(2)))
    const requests = []
    await page.route('https://feeds.example/**', route => {
      const url = route.request().url()
      requests.push(url)
      return [...failing].some(id => url.includes(id))
        ? route.fulfill({ status: 500, body: 'Failed' })
        : route.fulfill({ contentType: 'application/atom+xml', body: '<feed xmlns="http://www.w3.org/2005/Atom"><author><name>Channel</name></author></feed>' })
    })
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: /Refresh New content/ }).click()

    const box = page.locator('.channelErrors.hasErrors')
    await expect(box.getByRole('status')).toHaveText(/\b2\b/)
    // Both the videos and the Shorts of each channel failed
    await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscriptionFeedRefreshInProgress)).toBe(false)
    await expect(box.getByRole('listitem')).toHaveCount(2)
    await expect(box.getByRole('button', { name: 'Unsubscribe' })).toHaveCount(0)
    await expect(box.getByRole('listitem').first()).toContainText('HTTP 500')
    await expect(box).not.toContainText('lifecycle=')

    failing.delete(channels[1].id.slice(2))
    requests.length = 0
    await box.getByRole('button', { name: `Retry ${channels[1].name}` }).click()
    await expect(box.getByRole('listitem')).toHaveCount(1)
    await expect(box.getByRole('link', { name: channels[0].name })).toBeVisible()
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests.every(url => url.includes(channels[1].id.slice(2)))).toBe(true)

    // Feed types turned off for a channel aren't fetched anymore, so their errors can't be retried
    await page.evaluate(channelId => window.$store.dispatch('updateChannelSettings', { channelId, settings: { feedTypes: ['live'] } }), channels[0].id)
    await expect(page.locator('.channelErrors.hasErrors')).toHaveCount(0)
  })
})

test.describe('failed subscription cache load', () => {
  const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        backendFallback: false,
        defaultInvidiousInstance: 'https://feeds.example',
        fetchSubscriptionsAutomatically: true,
        useRssFeeds: true,
        subscriptionGroups: [{ id: 'group', name: 'Group', channelIds: [channelId] }]
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [
          { id: channelId, name: 'Channel A', thumbnail: '' },
          { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Channel B', thumbnail: '' }
        ]
      }],
      subscriptionCache: [{
        _id: channelId,
        videos: [{
          videoId: 'video000000',
          title: 'Cached video',
          author: 'Channel A',
          authorId: channelId,
          published: Date.now(),
          lengthSeconds: 120,
          type: 'video'
        }],
        videosTimestamp: new Date().toISOString()
      }]
    }
  })

  for (const outcome of ['failed', 'is cancelled']) {
    test(`retrying shows the cached feed when the automatic refresh ${outcome}`, async ({ page, app }) => {
      await app.electronApp.evaluate(({ ipcMain }, { channel, find }) => {
        const original = ipcMain._invokeHandlers.get(channel)
        globalThis.__failSubscriptionCacheLoad = true
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (event, request) => {
          if (globalThis.__failSubscriptionCacheLoad && request.action === find) throw new Error('Cache unavailable')
          return original(event, request)
        })
      }, { channel: IpcChannels.DB_SUBSCRIPTION_CACHE, find: DBActions.GENERAL.FIND })
      let releaseRefresh
      const refreshReleased = new Promise(resolve => { releaseRefresh = resolve })
      await page.route('https://feeds.example/**', async route => {
        if (outcome === 'is cancelled') await refreshReleased
        await route.fulfill({ status: 404, body: 'Not found' }).catch(() => {})
      })
      try {
        // Load the cache again, now through the failing handler
        await page.reload()
        await goTo(page, 'subscriptions')
        await page.locator('[data-subscription-feed-tab="videos"]').click()
        const error = page.getByText('Your saved subscription feeds could not be loaded.')
        await expect(error).toBeVisible()
        await expect(outcome === 'failed'
          ? page.getByText('2 channels could not be refreshed.', { exact: true })
          : page.getByText('Refreshing subscription videos')).toBeVisible()
        // The channels may well have videos, so no empty state goes with the error
        await expect(page.getByText('Your subscribed channels currently do not have any videos.')).toBeHidden()

        // Switching groups leaves the feed loading until the cache is available
        await page.evaluate(() => window.$store.dispatch('selectSubscriptionGroup', 'group'))
        if (outcome === 'failed') await expect(page.getByRole('button', { name: /Refresh Videos/ })).toBeDisabled()

        await app.electronApp.evaluate(() => { globalThis.__failSubscriptionCacheLoad = false })
        await page.getByRole('button', { name: 'Retry' }).click()
        await expect(error).toBeHidden()
        if (outcome === 'is cancelled') {
          await page.locator('[data-subscription-feed-tab="videos"]').click({ button: 'right' })
          await page.getByRole('menuitem', { name: 'Cancel refresh' }).click()
          releaseRefresh()
        }
        await expect(page.getByRole('link', { name: 'Cached video' }).first()).toBeVisible()
      } finally {
        releaseRefresh()
      }
    })
  }
})
