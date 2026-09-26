import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

test.use({ seed: { settings: { thumbnailSize: 100, fetchSubscriptionsAutomatically: false } } })

for (const scale of [1, 1.25]) {
  test(`touch sliders allow scrolling without changing settings at scale ${scale}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 850 })
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await goToSettingsSection(page, 'appearance')
    const slider = page.locator('.pure-material-slider').filter({ hasText: 'Thumbnail Size:' }).locator('input')
    await slider.evaluate(element => element.scrollIntoView({ block: 'center' }))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    async function gesture(dx, dy) {
      await slider.evaluate(element => element.scrollIntoView({ block: 'center' }))
      const bounds = await slider.boundingBox()
      const x = bounds.x + bounds.width * 0.2
      const y = bounds.y + bounds.height / 2
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    try {
      const viewport = page.locator('.settingsContent')
      const before = await viewport.evaluate(element => element.scrollTop)
      await gesture(4, -120)
      await expect(slider).toHaveValue('100')
      await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(before)
      await gesture(35, 0)
      await expect(slider).not.toHaveValue('100')
      // A tap remains an alternative to dragging, and keyboard input still works.
      await gesture(0, 0)
      await expect(slider).toHaveValue('70')
      await slider.press('ArrowRight')
      await expect(slider).toHaveValue('80')
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await cdp.detach()
    }
  })

  test(`connection banner follows hidden navigation above progress at scale ${scale}`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 850 })
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
      // Use the same element contract as the app's global progress component.
      const progress = document.createElement('div')
      progress.className = 'progressBar'
      document.querySelector('.app').append(progress)
    })
    const banner = page.locator('.connection-status-holder')
    await expect(banner).toBeVisible()
    const gap = () => banner.evaluate(element => innerHeight - element.getBoundingClientRect().bottom)
    await expect.poll(gap).toBeCloseTo(66, 0)
    await page.locator('.sideNav').evaluate(element => element.classList.add('scrollHidden'))
    await expect.poll(gap).toBeCloseTo(6, 0)
    // Overlay layouts must cancel the hidden-nav transform, including reduced motion.
    for (const kind of ['sheet', 'settings']) {
      await page.evaluate(kind => {
        const overlay = document.createElement('div')
        overlay.id = 'connection-overlay-test'
        if (kind === 'sheet') { overlay.className = 'mobileSheet'; overlay.setAttribute('open', '') }
        if (kind === 'settings') overlay.className = 'settingsWindow maximized'
        document.querySelector('.app').append(overlay)
      }, kind)
      await expect.poll(gap).toBeCloseTo(6, 0)
      await expect(banner).toHaveCSS('transition-duration', '0s')
      await page.evaluate(() => {
        document.body.append(document.querySelector('.connection-status-holder'))
        document.querySelector('#connection-overlay-test').remove()
      })
    }
    await page.locator('.sideNav').evaluate(element => element.classList.remove('scrollHidden'))
    await expect.poll(gap).toBeCloseTo(66, 0)
    await page.locator('.app > .progressBar').evaluate(element => element.remove())
    await expect.poll(gap).toBeCloseTo(60, 0)
  })
}

test('header sync indicator follows active sync stages, opens sync settings, and disappears on completion', async ({ page }) => {
  const indicator = page.locator('.topNav .syncIndicator')
  await expect(indicator).toHaveCount(0)
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setSyncServerStatus', 'syncing')
    store.commit('setSyncServerProgress', { stage: 'subscriptions' })
  })
  await expect(indicator).toHaveAttribute('type', 'button')
  await expect(indicator).toHaveAccessibleName('Sync: Syncing subscriptions…')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSyncServerProgress', { stage: 'history' }))
  await expect(indicator).toHaveAccessibleName('Sync: Syncing watch history…')
  const focusSettings = await goToSettingsSection(page, 'focus')
  const hideIndicator = focusSettings.getByRole('checkbox', { name: 'Hide Header Sync Indicator' })
  await expect(hideIndicator).not.toBeChecked()
  await hideIndicator.locator('..').locator('label.switch-label').click()
  await expect(hideIndicator).toBeChecked()
  await expect(indicator).toHaveCount(0)
  await hideIndicator.locator('..').locator('label.switch-label').click()
  await expect(hideIndicator).not.toBeChecked()
  await expect(indicator).toHaveAccessibleName('Sync: Syncing watch history…')
  await expect(indicator).toHaveCSS('font-size', '16px')
  await expect.poll(async () => {
    const { width, height } = await indicator.boundingBox()
    return width - height
  }).toBe(0)
  await expect(indicator.locator('svg')).toHaveCSS('animation-duration', '2s')
  await expect.poll(() => indicator.locator('svg').evaluate(element => getComputedStyle(element).animationName)).toMatch(/^sync-rotation(?:-|$)/)
  await page.locator('.topNav').evaluate(element => {
    element.classList.add('topNavBarColor')
    element.style.setProperty('--text-with-main-color', 'rgb(12, 34, 56)')
  })
  await expect(indicator).toHaveCSS('color', 'rgb(12, 34, 56)')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => indicator.locator('svg').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  await indicator.focus()
  await indicator.press('Enter')
  await expect(page.locator('.settingsWindow')).toBeVisible()
  await expect(page.locator('.settingsContent > [data-section="sync"]')).toBeVisible()
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSyncServerStatus', 'idle'))
  await expect(indicator).toHaveCount(0)
})

test.describe('translated download actions', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE', fetchSubscriptionsAutomatically: false } } })

  for (const scale of [1, 1.25]) {
    test(`downloads modal keeps long Clear labels within mobile widths at scale ${scale}`, async ({ app, page }) => {
      await setWindowSize(app, page, { width: 375, height: 850 })
      await page.evaluate(async scale => {
        window.ftElectron.setZoomFactor(scale)
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('upsertYtDlpDownload', {
          id: 999,
          title: 'Canceled download',
          mode: 'video',
          status: 'cancelled',
          destinations: [],
          files: []
        })
        await store.dispatch('showSettingsWindow', 'downloads')
      }, scale)
      const clear = page.locator('.downloadHeaderActions button').filter({ hasText: 'Fehlgeschlagene, abgebrochene, übersprungene und fehlende Einträge entfernen' })
      await expect(clear).toHaveText('Fehlgeschlagene, abgebrochene, übersprungene und fehlende Einträge entfernen')
      for (const width of [375, 480, 850]) {
        if (width !== 375) await setWindowSize(app, page, { width, height: width === 480 ? 851 : 850 })
        await expect.poll(() => page.locator('.settingsDownloadsPage').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await expect.poll(() => clear.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const container = element.closest('.downloadsPage').getBoundingClientRect()
          // Measure the label itself: the decorative ripple extends beyond the button.
          const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
          const range = document.createRange()
          range.selectNodeContents(text)
          return bounds.left >= container.left - 1 && bounds.right <= container.right + 1 &&
            [...range.getClientRects()].every(rect => rect.left >= bounds.left && rect.right <= bounds.right &&
              rect.top >= bounds.top && rect.bottom <= bounds.bottom)
        })).toBe(true)
      }
    })
  }
})
