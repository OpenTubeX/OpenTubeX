import { test, expect, sel } from '../../helpers/app.mjs'

const CAPTURE_CLASS = 'opentubex-tab-preview-capturing'
const CAPTURE_STYLE_ID = 'opentubex-tab-preview-capture-style'

/**
 * Hovers the given tab and resolves once its tooltip shows a captured preview.
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 * @returns {Promise<string>} the preview data URL
 */
async function hoverTabForPreview(page, index) {
  await page.locator(sel.tabs).nth(index).hover()
  const preview = page.locator('.tabTooltip .tabTooltipPreview img:not(.retryImagePlaceholder)')
  await expect(preview).toBeVisible()
  await expect.poll(async () => (await preview.getAttribute('src'))?.startsWith('data:image/jpeg'))
    .toBe(true)
  return await preview.getAttribute('src')
}

test.describe('tab previews', () => {
  test('waits for an in-flight first capture before showing the next tooltip', async ({ page }) => {
    await page.evaluate(() => window.ftElectron.tabs.create({
      title: 'Next preview', makeActive: false, lazyLoad: true
    }))
    const tabs = page.locator(sel.tabs)
    await expect(tabs).toHaveCount(2)
    // The main process refreshes the presented tab's preview shortly after
    // startup. Run that capture now so it cannot start once the clock is paused
    // and stand in for the tooltip's capture.
    await page.evaluate(async () => {
      const { activeTabId } = await window.ftElectron.tabs.getState()
      window.ftElectron.tabs.requestPreviewRefresh({ tabId: activeTabId, delayMs: 0 })
      await window.ftElectron.tabs.capturePreview(activeTabId)
    })
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    await tabs.first().hover()
    await page.clock.runFor(80)
    // Capture mode is waiting for two renderer frames. Hold those frames while
    // moving the real pointer to the next anchor.
    await expect(page.locator('html')).toHaveClass(new RegExp(CAPTURE_CLASS))
    await tabs.nth(1).hover()
    await expect(page.locator('.tabTooltip')).toHaveCount(0)
    await page.clock.resume()
    await expect(page.locator('.tabTooltipTitle')).toHaveText('Next preview')
    await expect(page.locator('.tabTooltip')).toHaveCSS('visibility', 'visible')
    await expect(page.locator('html')).not.toHaveClass(new RegExp(CAPTURE_CLASS))
  })

  test('hides transient overlays while preserving interactive previews during capture', async ({ page }) => {
    await page.locator(sel.newTabButton).click()
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await hoverTabForPreview(page, 1)

    // The capture stylesheet is injected by the main process on the first
    // capture; applying its class reproduces what a capture sees.
    await expect(page.locator(`#${CAPTURE_STYLE_ID}`)).toHaveCount(1)
    const visibilities = await page.evaluate((captureClass) => {
      const transientOverlay = document.createElement('div')
      transientOverlay.dataset.tabPreviewOverlay = ''
      document.body.append(transientOverlay)
      document.documentElement.classList.add(captureClass)
      const visibilities = {
        transient: getComputedStyle(transientOverlay).visibility,
        interactive: Array.from(
          document.querySelectorAll('[data-tab-preview-preserve-visibility]'),
          element => getComputedStyle(element).visibility
        )
      }
      document.documentElement.classList.remove(captureClass)
      transientOverlay.remove()
      return visibilities
    }, CAPTURE_CLASS)

    expect(visibilities.transient).toBe('hidden')
    expect(visibilities.interactive.length).toBeGreaterThan(0)
    expect(visibilities.interactive.every(visibility => visibility === 'visible')).toBe(true)
  })

  test('keeps previews when re-enabled during an active transition', async ({ page }) => {
    await hoverTabForPreview(page, 0)
    const activeTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')

    await page.evaluate(async (tabId) => {
      const store = window.$store
      const capturePromise = window.ftElectron.tabs.capturePreview(tabId)
      window.ftElectron.tabs.setPreviewCapturePaused(true)
      await store.dispatch('updateShowTabPreviews', false)
      await capturePromise
    }, activeTabId)

    await expect.poll(async () => {
      const previews = await page.evaluate(
        tabId => window.ftElectron.tabs.getCachedPreviews([tabId]),
        activeTabId
      )
      return previews[activeTabId] ?? null
    }).toBe(null)

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateShowTabPreviews', true)
      await new Promise(resolve => requestAnimationFrame(resolve))
      window.ftElectron.tabs.setPreviewCapturePaused(false)
    })
    await expect.poll(async () => {
      const previews = await page.evaluate(
        tabId => window.ftElectron.tabs.getCachedPreviews([tabId]),
        activeTabId
      )
      return previews[activeTabId] ?? null
    }).toMatch(/^data:image\/jpeg;base64,/)
  })
})

test.describe('tab previews disabled', () => {
  test.use({ seed: { settings: { showTabPreviews: false } } })

  test('keeps a compact title tooltip and removes preview images', async ({ page }) => {
    await page.locator(sel.tabs).first().hover()

    const tooltip = page.locator('.tabTooltip')
    const title = tooltip.locator('.tabTooltipTitle')
    await expect(tooltip).toBeVisible()
    await expect(title).not.toBeEmpty()
    await expect(tooltip.locator('.tabTooltipPreview')).toHaveCount(0)

    const [tooltipBox, titleBox] = await Promise.all([
      tooltip.boundingBox(),
      title.boundingBox()
    ])
    expect(tooltipBox.width).toBeLessThanOrEqual(titleBox.width + 20)

    const activeTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
    await expect.poll(() => page.evaluate(
      tabId => window.ftElectron.tabs.capturePreview(tabId),
      activeTabId
    )).toBe(null)

    await page.evaluate(async () => {
      for (let i = 0; i < 9; i++) {
        await window.ftElectron.tabs.create({
          makeActive: false,
          lazyLoad: true
        })
      }
    })
    await expect(page.locator(sel.tabs)).toHaveCount(10)
    await page.keyboard.down('Control')
    try {
      await page.keyboard.press('Tab')
      await expect(page.locator('.tabSwitcher.noPreviews')).toBeVisible()
      await expect(page.locator('.tabSwitcherPreview')).toHaveCount(0)

      const gridPositions = await page.locator('.tabSwitcherItem').evaluateAll((items) => ({
        rows: new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size,
        columns: new Set(items.map(item => Math.round(item.getBoundingClientRect().left))).size
      }))
      expect(gridPositions.rows).toBeGreaterThan(1)
      expect(gridPositions.columns).toBeGreaterThan(1)

      const verticalCenters = await page.locator('.tabSwitcherItem').first().evaluate((item) => {
        const center = element => {
          const bounds = element.getBoundingClientRect()
          return bounds.top + bounds.height / 2
        }
        return {
          item: center(item),
          icon: center(item.querySelector('.tabSwitcherTitleIcon, .tabSwitcherTitleAvatar')),
          text: center(item.querySelector('.tabSwitcherTitleText'))
        }
      })
      expect(Math.abs(verticalCenters.icon - verticalCenters.item)).toBeLessThanOrEqual(1)
      expect(Math.abs(verticalCenters.text - verticalCenters.item)).toBeLessThanOrEqual(1)
    } finally {
      await page.keyboard.up('Control')
    }
  })

  for (const position of ['left']) {
    test(`shows the full title after moving from a shorter tab with the ${position} tab bar`, async ({ page }) => {
      await page.evaluate(async position => {
        window.$store.commit('setTabBarPosition', position)
        for (const title of ['Short', 'A considerably longer tab title that must wrap instead of being cut off']) {
          await window.ftElectron.tabs.create({ title, route: '/history', makeActive: false, lazyLoad: true })
        }
      }, position)
      const tabs = page.locator(sel.tabs)
      await expect(tabs).toHaveCount(3)
      const title = page.locator('.tabTooltip .tabTooltipTitle')

      await tabs.nth(1).hover()
      await expect(title).toHaveText('Short')
      await tabs.nth(2).hover()
      await expect(title).toHaveText(/must wrap/)
      await expect.poll(() => title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })
  }
})
