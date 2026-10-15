import { expect, goTo, setWindowSize, test } from '../../helpers/app.mjs'

async function expectMatchingGaps(sidebar) {
  await expect.poll(() => sidebar.evaluate(element => {
    const sidebar = element.getBoundingClientRect()
    const tab = document.querySelector('.tabBar .tab').getBoundingClientRect()
    const rtl = getComputedStyle(element).direction === 'rtl'
    const adjacent = rtl ? Math.abs(tab.left - sidebar.right) < 10 : Math.abs(sidebar.left - tab.right) < 10
    return Math.max(...[element.querySelector('.navOption'), element.querySelector('.navChannel')].map(item => {
      const itemBounds = item.getBoundingClientRect()
      const pillStyle = getComputedStyle(item, '::before')
      const scale = itemBounds.width / parseFloat(getComputedStyle(item).width)
      const left = itemBounds.left + parseFloat(pillStyle.left) * scale
      const bounds = { left, right: left + parseFloat(pillStyle.width) * scale }
      const start = rtl ? (adjacent ? tab.left : sidebar.right) - bounds.right : bounds.left - (adjacent ? tab.right : sidebar.left)
      const end = rtl ? bounds.left - sidebar.left : sidebar.right - bounds.right
      return Math.abs(start - end)
    }))
  })).toBeLessThan(0.2)
}

for (const uiScale of [95, 125]) {
  test.describe(`desktop sidebar spacing at ${uiScale}% UI scale`, () => {
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

    test('scales desktop icons with inherited text size only when labels are hidden', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 1100, height: 700 })
      await goTo(page, 'history')
      const sidebar = page.locator('.sideNav')
      const icon = sidebar.locator('.navOption .navIcon').first()
      for (const pack of ['material', 'remix']) {
        await page.evaluate(pack => window.$store.dispatch('updateIconPack', pack), pack)
        await expect(icon).toHaveAttribute('data-icon-pack', pack)
        for (const mode of ['collapsed', 'icon-only', 'expanded', 'expanded-with-hidden-labels']) {
          await page.evaluate(mode => {
            const store = window.$store
            store.commit('setHideLabelsSideBar', mode === 'icon-only' || mode === 'expanded-with-hidden-labels')
            if (store.getters.getIsSideNavOpen !== mode.startsWith('expanded')) store.commit('toggleSideNav')
          }, mode)
          const item = sidebar.locator('.navOption').first()
          const bounds = await item.boundingBox()
          for (const fontSize of [16, 20]) {
            await sidebar.evaluate((element, fontSize) => { element.style.fontSize = `${fontSize}px` }, fontSize)
            const expectedSize = mode === 'icon-only' ? fontSize : 24
            await expect.poll(() => icon.evaluate((element, expectedSize) => {
              const style = getComputedStyle(element)
              const glyph = getComputedStyle(element.querySelector('svg'))
              // Chromium rounds inherited lengths at fractional Electron zoom.
              return Math.max(...[style.fontSize, style.width, style.height, glyph.width]
                .map(value => Math.abs(parseFloat(value) - expectedSize)))
            }, expectedSize)).toBeLessThan(0.05)
            expect(await item.boundingBox(), 'Icon scaling must preserve the clickable area').toEqual(bounds)
          }
          await sidebar.evaluate(element => element.style.removeProperty('font-size'))
        }
      }
    })

    test('matches the visible pill gaps in collapsed and icon-only modes', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 1100, height: 700 })
      await goTo(page, 'history')
      const sidebar = page.locator('.sideNav')
      for (const locale of ['en-US', 'ar']) {
        for (const position of ['top', 'left', 'right']) {
          for (const hideLabels of [false, true]) {
            await page.evaluate(async ({ locale, position, hideLabels }) => {
              const store = window.$store
              await store.dispatch('updateCurrentLocale', locale)
              await store.dispatch('updateTabBarPosition', position)
              store.commit('setHideLabelsSideBar', hideLabels)
            }, { locale, position, hideLabels })
            await expectMatchingGaps(sidebar)
          }
        }
      }
    })

    test('matches the visible gaps beside vertical tabs in both directions', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 1100, height: 700 })
      await goTo(page, 'history')
      await page.evaluate(() => window.$store.commit('toggleSideNav'))
      const sidebar = page.locator('.sideNav.expanded')
      await expect(sidebar).toBeVisible()
      for (const locale of ['en-US', 'ar']) {
        for (const position of ['top', 'left', 'right']) {
          await page.evaluate(async ({ locale, position }) => {
            const store = window.$store
            await store.dispatch('updateCurrentLocale', locale)
            await store.dispatch('updateTabBarPosition', position)
          }, { locale, position })
          await expectMatchingGaps(sidebar)
        }
      }
      await page.evaluate(async () => {
        const store = window.$store
        await store.dispatch('updateCurrentLocale', 'en-US')
        await store.dispatch('updateTabBarPosition', 'left')
      })
      await page.locator('.app').evaluate(element => element.style.setProperty('--tab-bar-inline-padding', '7px'))
      await expect(page.locator('.tabBar .tabsContainer')).toHaveCSS('padding-left', '7px')
      await expectMatchingGaps(sidebar)
      await page.locator('.app').evaluate(element => element.style.removeProperty('--tab-bar-inline-padding'))
      await expectMatchingGaps(sidebar)
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toContainClass(colorScheme)
        const bounds = await sidebar.boundingBox()
        expect(bounds, 'The expanded sidebar must have visible bounds for the screenshot').not.toBeNull()
        await page.screenshot({
          path: testInfo.outputPath(`sidebar-spacing-${colorScheme}.png`),
          clip: {
            x: bounds.x - 35, y: bounds.y, width: bounds.width + 55, height: 430
          }
        })
      }
    })
    test('matches the visible gaps in the watch sidebar overlay', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 1100, height: 700 })
      await page.evaluate(() => window.$router.push('/watch/jNQXAC9IVRw'))
      await expect(page.locator('.app')).toContainClass('watchSideNavOverlay')
      await page.locator('.menuButton').click()
      const sidebar = page.locator('.sideNav.expanded.opened')
      await expect(sidebar).toBeInViewport()
      for (const locale of ['en-US', 'ar']) {
        for (const position of ['top', 'left', 'right']) {
          await page.evaluate(async ({ locale, position }) => {
            const store = window.$store
            await store.dispatch('updateCurrentLocale', locale)
            await store.dispatch('updateTabBarPosition', position)
          }, { locale, position })
          await expectMatchingGaps(sidebar)
        }
      }
    })
  })
}
