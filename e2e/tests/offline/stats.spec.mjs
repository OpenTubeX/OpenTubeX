import { test, expect, goTo, goToSettingsSection, waitForAppReady } from '../../helpers/app.mjs'
import { decryptSyncDocument, encryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

/**
 * @param {Date} date
 */
function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const today = toDateKey(new Date())
const yesterday = toDateKey(new Date(Date.now() - 86_400_000))

// Marks the history migration as already completed so the seeded totals
// stay exact and no historical-estimate prompt appears.
const migrationDone = {
  _id: 'history-watch-time-v1',
  completedAt: Date.now(),
  hadEstimates: false,
  adjustment: null
}

test.describe('watch stats', () => {
  test.use({
    seed: {
      watchStats: [
        { _id: today, date: today, seconds: 3600 },
        { _id: yesterday, date: yesterday, seconds: 1800 },
        migrationDone
      ]
    }
  })

  test('summary cards show the seeded totals', async ({ page }) => {
    await goTo(page, 'stats')

    const summaryCard = (label) => page.locator('.summaryCard').filter({ hasText: label })

    await expect(summaryCard('Today')).toContainText('1 hr')
    await expect(summaryCard('Total watch time')).toContainText('1 hr 30 min')

    // Both charts render with data.
    await expect(page.locator('.lineChart')).toBeVisible()
    await expect(page.locator('.barChart')).toBeVisible()
  })

  test('resetting statistics clears all recorded time', async ({ page }) => {
    await goTo(page, 'stats')
    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('1 hr 30 min')

    await page.locator('.resetStatsButton').click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()

    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('0 min')
  })

  test('active navigation stays readable while the system theme changes', async ({ page }) => {
    await goTo(page, 'stats')
    const contrast = () => page.evaluate(() => {
      function channels(color) {
        return color.match(/[\d.]+/g).map(Number)
      }
      function luminance(rgb) {
        const [red, green, blue] = rgb.map(channel => {
          const value = channel / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue
      }
      function ratio(foreground, background) {
        const a = luminance(foreground)
        const b = luminance(background)
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      }
      const tab = document.querySelector('.tab.active')
      const nav = document.querySelector('.sideNav .navOption.router-link-exact-active')
      const navColor = channels(getComputedStyle(nav).backgroundColor)
      const navBase = channels(getComputedStyle(nav.closest('.sideNav')).backgroundColor)
      const navOpacity = navColor[3] ?? 1
      const navBackground = navBase.map((channel, index) =>
        navColor[index] * navOpacity + channel * (1 - navOpacity))
      return {
        tab: ratio(channels(getComputedStyle(tab).color), channels(getComputedStyle(tab).backgroundColor)),
        sidebar: ratio(channels(getComputedStyle(nav).color), navBackground),
      }
    })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('body')).toHaveClass(/\blight\b/)
    await page.locator('.sideNav .navOption.router-link-exact-active').hover()
    await expect.poll(async () => (await contrast()).tab).toBeGreaterThan(4.5)
    await expect.poll(async () => (await contrast()).sidebar).toBeGreaterThan(4.5)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveClass(/\bdark\b/)
    const changed = await contrast()
    expect.soft(changed.tab).toBeGreaterThan(4.5)
    expect.soft(changed.sidebar).toBeGreaterThan(4.5)
    await expect.poll(async () => (await contrast()).tab).toBeGreaterThan(4.5)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('body')).toHaveClass(/\blight\b/)
    const reversed = await contrast()
    expect.soft(reversed.tab).toBeGreaterThan(4.5)
    expect.soft(reversed.sidebar).toBeGreaterThan(4.5)
  })
})

test.describe('historical watch time migration', () => {
  test.use({
    seed: {
      history: [
        {
          _id: 'watchedvid01',
          videoId: 'watchedvid01',
          title: 'Previously watched video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          published: Date.now() - 2 * 86_400_000,
          description: '',
          viewCount: 1234,
          lengthSeconds: 600,
          watchProgress: 600,
          isWatched: true,
          timeWatched: Date.now() - 86_400_000,
          isLive: false,
          type: 'video'
        }
      ]
    }
  })

  test('estimates watch time from history and offers a playback speed adjustment', async ({ page }) => {
    await goTo(page, 'stats')

    // First visit after the migration: the adjustment prompt opens on its own.
    const prompt = page.locator('.historicalAdjustment')
    await expect(prompt).toBeVisible()

    await prompt.getByRole('button', { name: 'Apply playback speed' }).click()
    await expect(prompt).toBeHidden()

    // The estimate is marked as such and contributes to the totals:
    // 600 seconds of saved playback progress become 10 minutes.
    await expect(page.locator('.estimateNote')).toBeVisible()
    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('10 min')
    await expect(page.locator('.adjustEstimateButton')).toBeVisible()
  })
})

test.describe('synced watch stats', () => {
  const key = Buffer.alloc(32, 1).toString('base64')
  const salt = Buffer.alloc(16, 2).toString('base64')
  const laptop = Buffer.alloc(16, 3).toString('base64url')
  const phone = Buffer.alloc(16, 4).toString('base64url')

  test.use({
    seed: {
      settings: {
        syncServerEnabled: false,
        syncServerAutoSync: false,
        syncServerUrl: 'https://sync.example',
        syncServerUsername: 'test',
        syncServerToken: 'test-token',
        syncServerPrivacyMode: 'enhanced',
        syncServerPrivacyKey: key,
        syncServerPrivacySalt: salt,
        syncServerDeviceId: laptop,
        syncServerDeviceName: 'Laptop',
        syncServerSyncSubscriptions: false,
        syncServerSyncPlaylists: false,
        syncServerSyncHistory: false,
        syncServerSyncProfiles: false,
        syncServerSyncSessions: false,
        syncServerSyncSettings: false,
      },
      watchStats: [
        { _id: today, date: today, seconds: 3600 },
        migrationDone,
      ],
    },
  })

  test('switches between devices and keeps another device after a local reset', async ({ app, page }) => {
    const remote = [{ deviceId: phone, deviceName: 'Phone', platform: 'android', days: { [today]: 1800 } }]
    let revision = 1
    let watchStatsSupported = true
    let payload = await encryptSyncDocument(remote, key, salt)
    await page.route('https://sync.example/**', async route => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/health') {
        return route.fulfill({ json: { capabilities: { encrypted_sync: 1, live_sync: 1, watch_stats: Number(watchStatsSupported) } } })
      }
      if (pathname === '/v1/encrypted_sync') {
        return route.fulfill({ json: { collections: [{ collection: 'watchStats', revision }], legacy_data: false } })
      }
      if (pathname === '/v1/account/sessions') {
        return route.fulfill({ json: { sessions: [] } })
      }
      if (pathname === '/v1/encrypted_sync/events') {
        return route.fulfill({ json: [] })
      }
      if (pathname === '/v1/encrypted_sync/watchStats') {
        if (route.request().method() === 'PUT') {
          const request = route.request().postDataJSON()
          expect(request.revision).toBe(revision)
          payload = request.payload
          revision++
        }
        return route.fulfill({ json: { revision, payload } })
      }
      return route.fulfill({ status: 404 })
    })

    const sync = await goToSettingsSection(page, 'sync')
    await sync.getByRole('checkbox', { name: 'Enable Sync', exact: true }).press('Space')
    const statisticsToggle = sync.getByRole('checkbox', { name: 'Sync statistics' })
    await expect(statisticsToggle).toBeEnabled()
    await expect(statisticsToggle).toBeChecked()
    await statisticsToggle.press('Space')
    await expect(statisticsToggle).not.toBeChecked()
    await statisticsToggle.press('Space')
    await expect(statisticsToggle).toBeChecked()
    await sync.getByRole('button', { name: 'Sync now', exact: true }).click()
    await expect(sync.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled()
    await expect(sync.locator('.error')).toHaveCount(0)
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close', exact: true }).click()
    await goTo(page, 'stats')

    const total = page.locator('.summaryCard').filter({ hasText: 'Total watch time' })
    await expect(total).toContainText('1 hr 30 min')

    const selector = page.getByRole('group', { name: 'Devices' })
    await expect(selector.locator('.deviceSegmentIcon')).toHaveCount(3)
    await expect.poll(async () => selector.evaluate(group => {
      const header = group.closest('.statsHeader').getBoundingClientRect()
      const control = group.getBoundingClientRect()
      return Math.abs(header.right - control.right) < 2 && control.top >= header.top && control.bottom <= header.bottom
    })).toBe(true)
    const selectedSegmentIsAligned = async (name) => {
      const button = selector.getByRole('button', { name })
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => selector.evaluate((group, label) => {
        const selected = [...group.querySelectorAll('.deviceSegment')]
          .find(segment => segment.textContent.trim() === label)
        const indicator = group.querySelector('.deviceSegmentIndicator')
        const selectedBounds = selected.getBoundingClientRect()
        const indicatorBounds = indicator.getBoundingClientRect()
        return Math.abs(selectedBounds.left - indicatorBounds.left) < 2 &&
          Math.abs(selectedBounds.right - indicatorBounds.right) < 2
      }, name)).toBe(true)
    }
    await selector.getByRole('button', { name: 'Phone' }).click()
    await expect(total).toContainText('30 min')
    await selectedSegmentIsAligned('Phone')
    await page.evaluate(() => document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.dispatch('updateUiScale', 125))
    await expect(selector).toBeVisible()
    await selectedSegmentIsAligned('Phone')
    await selector.getByRole('button', { name: 'Laptop' }).click()
    await expect(total).toContainText('1 hr')
    await selectedSegmentIsAligned('Laptop')
    await page.locator('.resetStatsButton').click()
    await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible()
    await selector.getByRole('button', { name: 'Phone' }).evaluate(button => button.click())
    await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeHidden()
    await selector.getByRole('button', { name: 'Laptop' }).click()
    await page.locator('.resetStatsButton').click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await selector.getByRole('button', { name: 'All devices' }).click()
    await expect(total).toContainText('30 min')
    await selectedSegmentIsAligned('All devices')
    await page.evaluate(() => document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.commit('setHasHistoricalWatchTimeEstimate', true))
    await selector.getByRole('button', { name: 'Laptop' }).click()
    await expect(page.locator('.historicalAdjustment')).toBeVisible()
    await selector.getByRole('button', { name: 'Phone' }).evaluate(button => button.click())
    await expect(page.locator('.historicalAdjustment')).toBeHidden()
    await page.evaluate(() => document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.commit('setHasHistoricalWatchTimeEstimate', false))
    await selector.getByRole('button', { name: 'All devices' }).click()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSyncedWatchStats', [
        ...store.getters.getSyncedWatchStats,
        ...Array.from({ length: 15 }, (_, index) => ({
          deviceId: `extra-${index}`,
          deviceName: index === 0 ? 'Extra device with a much longer name' : `Extra device ${index}`,
          days: {},
        })),
      ])
    })
    await expect(selector.getByRole('button')).toHaveCount(18)
    await selector.getByRole('button', { name: 'Extra device with a much longer name' }).click()
    await selectedSegmentIsAligned('Extra device with a much longer name')
    await selector.getByRole('button', { name: 'All devices' }).click()
    const scrollbar = selector.locator(':scope > .os-scrollbar-horizontal')
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 480, height: 800 })
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(500)
    await selector.evaluate(element => { element.scrollLeft = element.scrollWidth })
    await expect.poll(() => selector.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1600, height: 900 })
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(1000)
    await expect.poll(() => selector.evaluate(element =>
      Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)))).toBeLessThanOrEqual(3)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSyncedWatchStats', store.getters.getSyncedWatchStats.slice(0, 2))
    })
    await expect(selector.getByRole('button')).toHaveCount(3)
    await expect.poll(() => selector.evaluate(element => element.scrollLeft)).toBe(0)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
    const syncAfterReset = await goToSettingsSection(page, 'sync')
    await syncAfterReset.getByRole('button', { name: 'Sync now', exact: true }).click()
    await expect.poll(async () => decryptSyncDocument(payload, key)).toEqual([
      { deviceId: phone, deviceName: 'Phone', platform: 'android', days: { [today]: 1800 } },
      { deviceId: laptop, deviceName: 'Laptop', platform: expect.any(String), days: {} },
    ])
    await page.context().setOffline(true)
    await page.reload()
    await waitForAppReady(page)
    await goTo(page, 'stats')
    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('30 min')
    await expect(page.getByRole('group', { name: 'Devices' })).toBeVisible()
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 480, height: 800 })
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(500)
    await expect.poll(() => page.locator('.statsHeader').evaluate(header => {
      const title = header.querySelector('h2').getBoundingClientRect()
      const control = header.querySelector('.deviceSegments').getBoundingClientRect()
      return title.bottom <= control.top && control.right <= header.getBoundingClientRect().right + 1
    })).toBe(true)

    watchStatsSupported = false
    await page.context().setOffline(false)
    await page.reload()
    await waitForAppReady(page)
    await goTo(page, 'stats')
    await expect(page.getByRole('group', { name: 'Devices' })).toBeHidden()

    await expect(page.locator('.summaryCard').filter({ hasText: 'Total watch time' })).toContainText('0 min')
    await page.context().setOffline(true)
    await page.reload()
    await waitForAppReady(page)
    await goTo(page, 'stats')
    await expect(page.getByRole('group', { name: 'Devices' })).toBeHidden()
    await page.evaluate(async cached => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSyncServerSyncWatchStats', false)
      await store.dispatch('updateSyncServerSnapshot', JSON.stringify({ watchStats: cached }))
    }, remote)
    await page.context().setOffline(false)
    await page.reload()
    await waitForAppReady(page)
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.getters.getSyncServerWatchStatsSupported)).toBe(false)
    await expect.poll(() => page.evaluate(() => JSON.parse(document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.state.settings.syncServerSnapshot).watchStats?.length)).toBe(1)
    await goTo(page, 'stats')
    await page.evaluate(async () => document.querySelector('#app').__vue_app__
      .config.globalProperties.$store.dispatch('updateSyncServerSyncWatchStats', true))
    await expect(page.getByRole('group', { name: 'Devices' })).toBeHidden()
    await page.evaluate(async cached => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setSyncedWatchStats', cached)
      store.commit('setSyncServerWatchStatsSupported', true)
      await store.dispatch('replaceSyncServerToken', 'replacement-token')
    }, remote)
    await expect(page.getByRole('group', { name: 'Devices' })).toBeHidden()
  })
})
