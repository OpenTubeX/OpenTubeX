import { test, expect, expectScrollAtRenderedEnd, goToSettingsSection } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`account activity at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, syncServerUrl: '' } } })

    test('shows named changes across synced collections and settings', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: '1', deviceName: 'Laptop', collection: 'subscriptions', action: 'added', item: 'Alpha', createdAt: Date.now() },
          { id: '2', deviceName: 'Laptop', collection: 'playlists', action: 'removed', item: 'Video A', parent: 'Favorites', createdAt: Date.now() - 1 },
          { id: '3', deviceName: 'Laptop', collection: 'profiles', action: 'renamed', item: 'Old profile', value: 'New profile', createdAt: Date.now() - 2 },
          { id: '4', deviceName: 'Laptop', collection: 'playlistBookmarks', action: 'added', item: 'Saved mix', createdAt: Date.now() - 3 },
          { id: '5', deviceName: 'Laptop', key: 'subscriptionChannelSettings', detail: 'dailyVideoLimit', item: 'Alpha', value: 3, createdAt: Date.now() - 4 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const card = sync.locator('.syncActivity')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expect(card.locator('.activityList li').nth(0)).toContainText('Laptop added Alpha to Subscriptions')
      await expect(card.locator('.activityList li').nth(1)).toContainText('Laptop removed Video A from Favorites')
      await expect(card.locator('.activityList li').nth(2)).toContainText('Laptop renamed Old profile to New profile')
      await card.locator('.activityDisclosure').click()
      await expect(card.locator('.activityList li').nth(3)).toContainText('Laptop added Saved mix to Saved playlists')
      await expect(card.locator('.activityList li').nth(4)).toContainText('Laptop changed Subscription settings · Alpha · Videos per day to 3')
    })

    test('uses a readable label for a saved setting choice', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'focus', deviceName: 'Laptop', key: 'tabCloseFocus', value: 'nextTab', createdAt: Date.now() },
          { id: 'theme', deviceName: 'Laptop', key: 'baseTheme', value: 'catppuccinMocha', createdAt: Date.now() - 1 },
          { id: 'format', deviceName: 'Laptop', key: 'screenshotFormat', value: 'jpeg', createdAt: Date.now() - 2 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const activity = sync.locator('.syncActivity .activityList li')
      await expect(activity.nth(0)).toContainText(
        'Laptop changed After Closing the Active Tab to Next tab in tab order'
      )
      await expect(activity.nth(1)).toContainText(/Laptop changed Base [Tt]heme to Catppuccin Mocha/)
      await expect(activity.nth(2)).toContainText(/Laptop changed Screenshot [Ff]ormat to JPEG/)
    })

    test('names custom themes once and describes an empty subscription feed', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', [
          { id: 'theme', deviceName: 'Laptop', key: 'customThemes', action: 'added', item: 'Ocean', createdAt: Date.now() },
          { id: 'removed-theme', deviceName: 'Laptop', key: 'customThemes', action: 'removed', item: 'Sunset', createdAt: Date.now() - 1 },
          { id: 'feed', deviceName: 'Laptop', key: 'subscriptionChannelSettings', detail: 'feedTypes', item: 'Alpha', value: '', createdAt: Date.now() - 2 },
        ])
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const activity = sync.locator('.syncActivity .activityList li')
      await expect(activity.nth(0).locator('p')).toHaveText(/Laptop added Ocean to Custom theme creator$/i)
      await expect(activity.nth(1).locator('p')).toHaveText(/Laptop removed Sunset from Custom theme creator$/i)
      await expect(activity.nth(2)).toContainText('No feed types')
    })

    test('clamps after collapse and retains activity after a refresh error', async ({ page }) => {
      const sync = await goToSettingsSection(page, 'sync')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setSyncServerToken', 'test-token')
        store.commit('setSyncServerActivity', Array.from({ length: 12 }, (_, index) => ({
          id: String(index), deviceName: 'Laptop', collection: 'subscriptions', createdAt: Date.now() - index * 60000,
        })))
        store.commit('setSyncServerLiveSupported', true)
        store.commit('setSyncServerEnabled', true)
      })
      const card = sync.locator('.syncActivity')
      const disclosure = card.locator('.activityDisclosure')
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await expect(disclosure).toHaveText('Show more')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
      await expect(disclosure).toHaveText('Show less')
      await expect(card.locator('.activityList li')).toHaveCount(12)

      const scroller = page.locator('.settingsContent')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await expect(disclosure).toHaveText('Show more')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expectScrollAtRenderedEnd(scroller)
      await expect.poll(() => scroller.evaluate(element => {
        const scrollbar = element.querySelector('.os-scrollbar-vertical')
        if (scrollbar.classList.contains('os-scrollbar-unusable')) return element.scrollTop === 0
        const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
        const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
        return Math.abs(track.bottom - thumb.bottom) <= 1
      })).toBe(true)

      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const dispatch = store.dispatch.bind(store)
        store.dispatch = (...args) => args[0] === 'refreshSyncServerEvents'
          ? Promise.reject(new Error('Activity refresh failed'))
          : dispatch(...args)
      })
      await card.locator('.activityAction').click()
      await expect(card.getByRole('alert')).toHaveText('Activity refresh failed')
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await expect(disclosure).toBeVisible()
    })
  })
}
