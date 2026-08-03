import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, sel } from '../../helpers/app.mjs'

async function setWindowWidth (app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

async function enableVerticalTabBar (page, width) {
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

test.describe('global progress presentation', () => {
  test('uses a persistent notification or the global bar based on the theme setting', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setProgressBarMessage', 'Downloading yt-dlp and ffmpeg')
      store.commit('setProgressBarIcon', ['fas', 'download'])
      store.commit('setProgressBarPercentage', 42)
      store.commit('setShowProgressBar', true)
    })

    const progressToast = page.getByTestId('progress-toast')
    await expect(progressToast).toContainText('Downloading yt-dlp and ffmpeg')
    await expect(progressToast.locator('.icon')).toHaveAttribute('data-icon', 'download')
    await expect(progressToast.locator('.progress-indicator')).toHaveAttribute('data-progress', '42')
    await expect(page.locator('.app > .progressBar')).toHaveCount(0)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowProgressBarToast', false)
    })

    await expect(progressToast).toHaveCount(0)
    await expect(page.locator('.app > .progressBar')).toHaveCount(1)

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setShowProgressBarToast', true)
    })
    await expect(progressToast).toBeVisible()

    await page.evaluate(() => document.querySelector('.app').requestFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await expect(progressToast).toBeVisible()
    await page.evaluate(() => document.exitFullscreen())
  })
})

test.describe('UI roundness', () => {
  test.use({ seed: { settings: { uiRoundness: 0 } } })

  test('applies to controls, cards, popovers, and modals', async ({ app, page }) => {
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '0')

    await goTo(page, 'settings')
    const roundnessSlider = page.getByRole('slider', { name: /UI Roundness/ })
    const toggleSwitch = page.locator('label.switch-label').first()
    const toggleTrackRadius = () => toggleSwitch.evaluate((element) =>
      getComputedStyle(element, '::before').borderRadius)
    await expect(roundnessSlider).toHaveValue('0')
    expect(await toggleTrackRadius()).toBe('8px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('border-radius', '0px')
    await expect(page.getByRole('button').first()).toHaveCSS('border-radius', '0px')

    await page.locator('.settingsMenu [data-section="data"]').click()
    await page.getByRole('button', { name: 'Export Subscriptions' }).click()
    await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '0px')

    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await page.locator(sel.tabs).first().click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Context menu' })).toHaveCSS('border-radius', '0px')

    await page.keyboard.press('Escape')
    await roundnessSlider.fill('150')
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '1.5')
    expect(await toggleTrackRadius()).toBe('8px')
    await expect(page.locator('.sectionBody').first()).toHaveCSS('border-radius', '12px')

    ;({ page } = await app.relaunch())
    await goTo(page, 'settings')
    await expect(page.getByRole('slider', { name: /UI Roundness/ })).toHaveValue('150')
  })
})

test.describe('rounded feed page headers', () => {
  test.use({
    seed: {
      settings: {
        uiRoundness: 200,
        backendPreference: 'invidious',
        backendFallback: true,
        fetchSubscriptionsAutomatically: false
      }
    }
  })

  test('preserves scaled card corners on feed pages', async ({ page }) => {
    const pages = [
      { route: 'subscriptions', header: '.subscriptionsHeader' },
      { route: 'trending', header: '.pageHeader' },
      { route: 'popular', header: '.pageHeader' }
    ]

    for (const { route, header } of pages) {
      await goTo(page, route)
      await expect(page.locator(header)).toHaveCSS('border-top-left-radius', '16px')
      await expect(page.locator(header)).toHaveCSS('border-top-right-radius', '16px')
    }
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

test.describe('tab orientation shortcut', () => {
  test('F1 switches between horizontal and vertical tabs', async ({ page }) => {
    const app = page.locator('.app')
    await expect(app).not.toHaveClass(/verticalTabs/)

    await page.keyboard.press('F1')
    await expect(app).toHaveClass(/verticalTabs/)
    await expect.poll(async () => {
      return page.locator('.tab.vertical.active').evaluate((tab) => {
        const tabEnd = tab.getBoundingClientRect().right
        const viewportEnd = tab.parentElement.getBoundingClientRect().right
        return viewportEnd - tabEnd
      })
    }).toBeGreaterThanOrEqual(1)

    await page.keyboard.press('F1')
    await expect(app).not.toHaveClass(/verticalTabs/)
  })

  test('presses in quick succession are not swallowed by the pending write', async ({ app: appHandle, page }) => {
    const app = page.locator('.app')

    // The setting is only committed once persisted, so two presses that beat
    // the write have to queue up instead of both negating the same value —
    // otherwise they collapse into a single toggle and the layout flips.
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }))
      }
    })

    await expect.poll(async () => {
      const contents = await readFile(path.join(appHandle.userDataDir, 'settings.db'), 'utf8')
      return Object.fromEntries(contents.trim().split('\n')
        .map(line => JSON.parse(line))
        .map(record => [record._id, record.value]))
        .useVerticalTabBar
    }).toBe(false)
    await expect(app).not.toHaveClass(/verticalTabs/)
  })
})

test.describe('tab orientation shortcut rebound to a printable key', () => {
  test.use({
    seed: {
      settings: {
        keyboardShortcuts: JSON.stringify({ APP: { GENERAL: { TOGGLE_TAB_ORIENTATION: 'v' } } })
      }
    }
  })

  test('typing the key in the search bar does not toggle the layout', async ({ page }) => {
    const app = page.locator('.app')
    const searchInput = page.locator(sel.searchInput)

    await searchInput.click()
    await searchInput.type('vv')

    await expect(searchInput).toHaveValue('vv')
    await expect(app).not.toHaveClass(/verticalTabs/)

    // Outside a text field the rebound key still works.
    await page.locator('.app').click()
    await page.keyboard.press('v')
    await expect(app).toHaveClass(/verticalTabs/)
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
