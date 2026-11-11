import { DBActions, IpcChannels } from '../../../src/constants.js'
import { defaultThemeClass, test, expect, goTo } from '../../helpers/app.mjs'

for (const count of [2, 20]) {
  test.describe(`${count} unavailable channels`, () => {
    const channels = Array.from({ length: count }, (_, index) => ({
      id: `UC${String(index).padStart(22, '0')}`,
      name: `Unavailable channel ${index + 1}`,
      thumbnail: ''
    }))
    test.use({
      seed: {
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
          hideSubscriptionsCommunity: true
        },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          bgColor: '#000000',
          textColor: '#FFFFFF',
          subscriptions: channels
        }]
      }
    })

    test('shows channel names and opens failure reasons before copying technical details', async ({ page, app }, testInfo) => {
      await page.setViewportSize({ width: count === 2 ? 375 : 480, height: 800 })
      await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
      await page.route('https://feeds.example/**', route => route.fulfill({ status: 404, body: 'Not found' }))
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="shorts"]').click()
      await page.getByRole('button', { name: /Refresh Shorts/ }).click()
      const toast = page.locator('.toast', { hasText: 'Channels that could not be refreshed:' })
      await expect(toast).toContainText(channels[0].name)
      await expect(page.locator('.toast')).toHaveCount(1)
      await expect(page.locator('.connectionStatus')).toBeHidden()
      const bounds = await toast.boundingBox()
      expect(bounds.height).toBeLessThan(160)
      expect(bounds.width).toBeLessThanOrEqual(480)
      await toast.click()
      const dialog = page.getByRole('dialog', { name: 'Channels with Errors' })
      await expect(dialog).toBeVisible()
      await expect(toast).toBeHidden({ timeout: 2000 })
      for (const channel of channels) await expect(dialog).toContainText(channel.name)
      await expect(dialog).toContainText('HTTP 404')
      await expect(dialog).not.toContainText('lifecycle=')
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(defaultThemeClass(colorScheme))
        await expect(page.locator('.prompt')).toHaveCSS('opacity', '1')
        await expect(dialog).toHaveCSS('opacity', '1')
        const dialogBounds = await dialog.boundingBox()
        // Electron reports CSS bounds before UI zoom; screenshot clips use physical pixels.
        const clip = Object.fromEntries(Object.entries(dialogBounds).map(([key, value]) => [key, value * 1.25]))
        await testInfo.attach(`subscription refresh failure reasons ${colorScheme}`, {
          body: await page.screenshot({ clip }),
          contentType: 'image/png'
        })
      }
      if (count === 20) {
        const scroller = dialog.locator('.promptContentScroller')
        await expect(scroller).toHaveAttribute('data-overlayscrollbars-viewport')
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await expect(dialog.getByRole('heading', { level: 2 })).toBeInViewport()
        await expect(dialog.getByRole('button', { name: 'Copy technical details' })).toBeInViewport()
        await page.setViewportSize({ width: 1100, height: 1000 })
        await expect.poll(() => scroller.evaluate(element => {
          const content = element.querySelector('.promptContent').getBoundingClientRect()
          return Math.abs(content.bottom - element.getBoundingClientRect().bottom)
        })).toBeLessThan(2)
        await expect(scroller.locator(':scope > .os-scrollbar-vertical')).not.toHaveClass(/os-scrollbar-unusable/)
      }
      await dialog.getByRole('button', { name: 'Copy technical details' }).click()
      await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels.at(-1).id)
      const details = await app.electronApp.evaluate(({ clipboard }) => clipboard.readText())
      for (const channel of channels) expect(details).toContain(`${channel.name} (${channel.id})`)
      expect(details).toContain('HTTP 404')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })

    if (count === 2) {
      test('an open dialog receives later failures', async ({ page, app }) => {
        let releaseSecond
        const secondReady = new Promise(resolve => { releaseSecond = resolve })
        await page.route('https://feeds.example/**', async route => {
          if (route.request().url().includes(channels[1].id.slice(2))) await secondReady
          return route.fulfill({ status: 404, body: 'Not found' })
        })
        try {
          await goTo(page, 'subscriptions')
          await page.locator('[data-subscription-feed-tab="shorts"]').click()
          await page.getByRole('button', { name: /Refresh Shorts/ }).click()
          const toast = page.locator('.toast', { hasText: 'Channels that could not be refreshed:' })
          await expect(toast).toContainText(channels[0].name)
          await toast.click()
          const dialog = page.getByRole('dialog', { name: 'Channels with Errors' })
          await expect(dialog).toContainText(channels[0].name)
          releaseSecond()
          await expect(dialog).toContainText(channels[1].name)
          await expect(toast).toBeHidden()
          await dialog.getByRole('button', { name: 'Copy technical details' }).click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels[1].id)
        } finally {
          releaseSecond()
        }
      })

      test('later failures notify again after closing the details dialog', async ({ page, app }) => {
        let releaseSecond
        const secondReady = new Promise(resolve => { releaseSecond = resolve })
        await page.route('https://feeds.example/**', async route => {
          if (route.request().url().includes(channels[1].id.slice(2))) await secondReady
          return route.fulfill({ status: 404, body: 'Not found' })
        })
        try {
          await goTo(page, 'subscriptions')
          await page.locator('[data-subscription-feed-tab="shorts"]').click()
          await page.getByRole('button', { name: /Refresh Shorts/ }).click()
          const toast = page.locator('.toast', { hasText: 'Channels that could not be refreshed:' })
          await expect(toast).toContainText(channels[0].name)
          await toast.click()
          const dialog = page.getByRole('dialog', { name: 'Channels with Errors' })
          await expect(dialog).toContainText(channels[0].name)
          await dialog.getByRole('button', { name: 'Close', exact: true }).click()
          await expect(dialog).toBeHidden()
          releaseSecond()
          await expect(toast).toContainText(channels[1].name)
          await toast.click()
          await expect(dialog).toContainText(channels[1].name)
          await expect(toast).toBeHidden()
          await dialog.getByRole('button', { name: 'Copy technical details' }).click()
          await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain(channels[1].id)
        } finally {
          releaseSecond()
        }
      })
    }
  })
}

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
          ? page.getByRole('heading', { name: 'Channels with Errors' })
          : page.getByText('Refreshing subscription videos')).toBeVisible()

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
