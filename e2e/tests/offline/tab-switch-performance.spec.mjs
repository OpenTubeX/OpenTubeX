import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

test.describe('Ctrl+Tab responsiveness', () => {
  test.use({ seed: { settings: { uiScale: 125, showTabPreviews: true, fetchSubscriptionsAutomatically: false } } })

  test('quick forward and backward switches never mount the menu under CPU throttling', async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.evaluate(async () => {
      await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
      await window.ftElectron.tabs.create({ route: '/about', makeActive: false, lazyLoad: true })
      window.__switcherMounts = 0
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.matches('.tabSwitcherOverlay')) window.__switcherMounts++
          }
        }
      }).observe(document.querySelector('#app'), { childList: true, subtree: true })
    })
    await expect(page.locator(sel.tabs)).toHaveCount(3)
    const ids = await page.locator(sel.tabs).evaluateAll(tabs => tabs.map(tab => tab.dataset.tabId))
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    // Freeze the hold threshold so IPC/test-driver latency on busy machines
    // cannot accidentally turn a quick tap into an intentional hold.
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    try {
      for (const [shortcut, target] of [['Control+Tab', ids[1]], ['Control+Shift+Tab', ids[0]], ['Control+Shift+Tab', ids[2]]]) {
        await page.keyboard.press(shortcut)
        await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', target)
        expect(await page.evaluate(() => window.__switcherMounts)).toBe(0)
      }
      await page.clock.runFor(500)
      await expect(page.locator('.tabSwitcherOverlay')).toHaveCount(0)
      expect(await page.evaluate(() => window.__switcherMounts)).toBe(0)
    } finally {
      await page.clock.resume()
      await session.detach()
    }
  })

  test('shows the switcher before a slow background capture finishes', async ({ page, app }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.evaluate(async () => {
      window.ftElectron.tabs.setPreviewCapturePaused(true)
      await window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
    })
    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('opentubex-tab-preview-capturing'))).toBe(false)
    const activeTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
    const cachedPreview = await page.evaluate(async id => (await window.ftElectron.tabs.getCachedPreviews([id]))[id], activeTabId)

    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const original = contents.capturePage.bind(contents)
      const capture = { started: false, release: null, original }
      contents.__delayedPreviewCapture = capture
      contents.capturePage = async (...args) => {
        capture.started = true
        await new Promise(resolve => { capture.release = resolve })
        return original(...args)
      }
    })
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    try {
      await page.evaluate(() => {
        window.ftElectron.tabs.setPreviewCapturePaused(false)
        const store = window.$store
        window.__slowPreview = window.ftElectron.tabs.capturePreview(store.getters.getActiveTabId)
      })
      await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.__delayedPreviewCapture.started)).toBe(true)
      await page.keyboard.down('Control')
      await page.keyboard.press('Tab')
      // The capture is deliberately still pending: keyboard feedback must not
      // depend on screenshot, encoding, or disk I/O finishing.
      await expect(page.locator('.tabSwitcher')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('.tabSwitcher')).toHaveCount(0)
      await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', activeTabId)
      await page.keyboard.press('Shift+Tab')
      await expect(page.locator('.tabSwitcher')).toBeVisible()
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.__delayedPreviewCapture.release())
      const interruptedPreview = await page.evaluate(() => window.__slowPreview)
      expect(interruptedPreview).toBe(cachedPreview)
      await page.keyboard.up('Control')
      await expect(page.locator(sel.activeTab)).toContainText('History')
    } finally {
      await page.keyboard.up('Control')
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        const capture = contents.__delayedPreviewCapture
        contents.capturePage = capture.original
        capture.release?.()
        delete contents.__delayedPreviewCapture
      })
      await page.evaluate(async () => { await window.__slowPreview; delete window.__slowPreview })
      await session.detach()
    }
  })
})

for (const uiScale of [100, 125]) {
  for (const currentLocale of ['en-US', 'ar']) {
    test.describe(`desktop tab switching at ${uiScale}% in ${currentLocale}`, () => {
      test.use({
        seed: {
          settings: {
            uiScale,
            currentLocale,
            reducedMotion: 'on',
            showTabPreviews: false,
            fetchSubscriptionsAutomatically: false
          }
        }
      })

      test('avoids repeated page scrollbar measurements when restoring tab scroll positions', async ({ page }) => {
        await page.route(/^https?:\/\//, abortUnmockedRequest)
        // A floating settings window makes forced document layout particularly
        // expensive. Keep it open while switching already-mounted pages.
        await page.evaluate(() => window.$store.dispatch('showSettingsWindow'))
        await expect(page.locator('.settingsWindow')).toBeVisible()
        const ids = []
        for (const route of ['/history', '/about']) {
          const tab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: true }), route)
          ids.push(tab.id)
          const content = page.locator(`.tabContent[data-tab-id="${tab.id}"]`)
          await expect(content).toBeVisible()
          await content.evaluate((element, index) => {
            const overflow = document.createElement('div')
            overflow.dataset.tabSwitchOverflow = ''
            overflow.style.height = `${2000 + index * 1000}px`
            element.append(overflow)
          }, ids.length)
        }

        await settlePageLayout(page)
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
        const savedOffsets = new Map(ids.map(id => [id, 0]))
        try {
          for (const id of [...ids, ...ids]) {
            await settlePageLayout(page)
            const metrics = await page.evaluate(id => new Promise(resolve => {
              const originalStyle = window.getComputedStyle
              let pageMeasurements = 0
              window.getComputedStyle = (...args) => {
                if (args[0] === document.documentElement) pageMeasurements++
                return originalStyle(...args)
              }
              const startedAt = performance.now()
              let finished = false
              const timeout = setTimeout(() => finish(false), 5000)
              function finish(presented) {
                finished = true
                clearTimeout(timeout)
                window.getComputedStyle = originalStyle
                resolve({ presented, elapsed: performance.now() - startedAt, pageMeasurements })
              }
              function frame() {
                if (finished) return
                const target = document.querySelector(`.tabContent[data-tab-id="${id}"]`)
                if (target?.getAttribute('aria-hidden') === 'false') {
                  requestAnimationFrame(() => finish(true))
                } else {
                  requestAnimationFrame(frame)
                }
              }
              document.querySelector(`.tab[data-tab-id="${id}"]`).click()
              requestAnimationFrame(frame)
            }), id)
            console.log('Desktop tab switch:', { uiScale, currentLocale, ...metrics })
            expect(metrics.presented).toBe(true)
            // Bound work instead of machine-dependent elapsed time. Before the
            // fix each switch performs 16+ document style measurements.
            expect.soft(metrics.pageMeasurements).toBeLessThanOrEqual(12)
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(savedOffsets.get(id), 0)
            await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'instant' }))
            savedOffsets.set(id, await page.evaluate(() => window.scrollY))
          }
        } finally {
          await session.detach()
        }
      })
    })
  }
}

/** Wait for pending resize and mutation observer deliveries before sampling. */
async function settlePageLayout(page) {
  await page.evaluate(() => new Promise(resolve => {
    let remaining = 4
    function frame() {
      if (--remaining === 0) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }))
}
