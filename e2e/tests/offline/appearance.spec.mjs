import { test, expect, goTo, sel } from '../../helpers/app.mjs'

async function setWindowWidth(app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

async function enableVerticalTabBar(page, width) {
  await page.evaluate((tabBarWidth) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setUseVerticalTabBar', true)
    store.commit('setVerticalTabBarWidth', tabBarWidth)
  }, width)
  await expect(page.locator('.app')).toHaveClass(/verticalTabs/)
}

test.describe('distraction and appearance settings', () => {
  test.use({
    seed: {
      settings: {
        baseTheme: 'dark',
        hideEndScreenAnnotations: true,
        hideTrendingVideos: true,
        hideProfileSelectorInHeader: true
      }
    }
  })

  test('hidden UI elements stay hidden and the theme applies', async ({ page }) => {
    // Trending is removed from the side nav entirely.
    await expect(page.locator(sel.sideNavLink('trending'))).toHaveCount(0)

    // Fork feature: the profile selector can be hidden from the header (7e8223dba).
    await expect(page.locator('.topNav .profiles .colorOption')).toHaveCount(0)

    // The base theme is applied as a class on <body>.
    await expect(page.locator('body')).toHaveClass(/dark/)

    await goTo(page, 'settings')
    await expect(page.getByRole('checkbox', { name: 'Hide End-Screen Annotations' })).toBeChecked()
  })
})

test.describe('default appearance', () => {
  test('trending link and profile selector are visible by default', async ({ page }) => {
    // The link may live in the side nav itself or its "More" flyout,
    // depending on the collapsed state — either way it must exist.
    await expect(page.locator(sel.sideNavLink('trending'))).not.toHaveCount(0)
    await expect(page.locator('.topNav .profiles .colorOption').first()).toBeVisible()
    await expect(page.locator('body')).toHaveClass(/system/)
  })
})

test.describe('top nav beside the vertical tab bar', () => {
  test('search bar and profile selector stay clear of the tab column', async ({ app, page }) => {
    await enableVerticalTabBar(page, 220)

    // Wide enough viewport for the 3-column grid, but the top nav itself (beside
    // the 220px tab column) is not — the profile selector on the inline-end must
    // not overflow off the right edge (the grid must fall back to the flex row).
    await setWindowWidth(app, 1000)
    const profiles = page.locator('.topNav .profiles')
    await expect.poll(async () => {
      const [tabBarBox, profilesBox] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        profiles.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        profilesBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        profilesBox.x + profilesBox.width <= viewportWidth + 1
      )
    }).toBe(true)

    // Mobile layout: the fixed search bar opens beside the tab column, not behind it.
    await setWindowWidth(app, 660)
    await page.locator('.topNav .navSearchButton').click()
    const searchContainer = page.locator('.topNav .searchContainer')
    await expect.poll(async () => {
      const [tabBarBox, searchBox] = await Promise.all([
        page.locator('.tabBar.vertical').boundingBox(),
        searchContainer.boundingBox()
      ])
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return (
        searchBox.x >= tabBarBox.x + tabBarBox.width - 1 &&
        searchBox.x + searchBox.width <= viewportWidth + 1
      )
    }).toBe(true)
  })
})

test.describe('narrow layout top padding', () => {
  test('page content clears the fixed top nav and tab bar', async ({ app, page }) => {
    // On mobile widths the top nav is fixed and taller when a tab bar is
    // present; the page content must keep a gap below it instead of tucking
    // underneath (previously the content sat flush against the nav).
    await setWindowWidth(app, 560)
    const routerView = page.locator('.app > .routerView').first()
    await expect.poll(async () => {
      const [topNavBox, routerBox] = await Promise.all([
        page.locator('.topNav').boundingBox(),
        routerView.boundingBox()
      ])
      const gap = routerBox.y - (topNavBox.y + topNavBox.height)
      return gap >= 4 && gap <= 40
    }).toBe(true)
  })
})
