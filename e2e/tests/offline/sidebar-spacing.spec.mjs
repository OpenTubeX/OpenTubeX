import { expect, goTo, setWindowSize, test } from '../../helpers/app.mjs'

for (const uiScale of [95, 125]) {
  test.describe(`expanded sidebar spacing at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { uiScale },
        profiles: [{
          _id: 'allChannels',
          name: 'All Channels',
          subscriptions: Array.from({ length: 24 }, (_, index) => ({
            id: `UC${String(index).padStart(22, '0')}`,
            name: `Channel ${index}`,
            thumbnail: ''
          }))
        }]
      }
    })

    test('matches the visible gaps beside vertical tabs in both directions', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 1100, height: 700 })
      await goTo(page, 'history')
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('toggleSideNav'))
      const sidebar = page.locator('.sideNav.expanded')
      await expect(sidebar).toBeVisible()
      for (const locale of ['en-US', 'ar']) {
        for (const position of ['top', 'left', 'right']) {
          await page.evaluate(async ({ locale, position }) => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            await store.dispatch('updateCurrentLocale', locale)
            await store.dispatch('updateTabBarPosition', position)
          }, { locale, position })
          await expect.poll(() => sidebar.evaluate(element => {
            const sidebar = element.getBoundingClientRect()
            const tab = document.querySelector('.tabBar .tab').getBoundingClientRect()
            const rtl = getComputedStyle(element).direction === 'rtl'
            const adjacent = rtl ? Math.abs(tab.left - sidebar.right) < 10 : Math.abs(sidebar.left - tab.right) < 10
            return Math.max(...[element.querySelector('.navOption.router-link-active'), element.querySelector('.navChannel')].map(item => {
              const bounds = item.getBoundingClientRect()
              const start = rtl ? (adjacent ? tab.left : sidebar.right) - bounds.right : bounds.left - (adjacent ? tab.right : sidebar.left)
              const end = rtl ? bounds.left - sidebar.left : sidebar.right - bounds.right
              return Math.abs(start - end)
            }))
          })).toBeLessThan(0.2)
        }
      }
      await page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateCurrentLocale', 'en-US')
        await store.dispatch('updateTabBarPosition', 'left')
      })
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toContainClass(colorScheme)
        const bounds = await sidebar.boundingBox()
        await page.screenshot({
          path: testInfo.outputPath(`sidebar-spacing-${colorScheme}.png`),
          clip: {
            x: bounds.x - 35, y: bounds.y, width: bounds.width + 55, height: 430
          }
        })
      }
    })
  })
}
