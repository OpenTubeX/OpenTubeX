import { test, expect, expectScrollAtRenderedEnd, goToSettingsSection } from '../../helpers/app.mjs'

for (const uiScale of [100, 125]) {
  test.describe(`account activity at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, syncServerUrl: '' } } })

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
      await expect(card.locator('.activityList li')).toHaveCount(3)
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
      await expect(card.locator('.activityList li')).toHaveCount(12)

      const scroller = page.locator('.settingsContent')
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
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
