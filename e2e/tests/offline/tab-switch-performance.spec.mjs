import { test, expect, sel, abortUnmockedRequest } from '../../helpers/app.mjs'

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

      test('avoids repeated page scrollbar measurements and restores tab scroll positions', async ({ page }) => {
        await page.route(/^https?:\/\//, abortUnmockedRequest)
        // A floating settings window makes forced document layout particularly
        // expensive. Keep it open while switching already-mounted pages.
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
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
            await expect.poll(() => page.evaluate(() => {
              const maximum = document.documentElement.scrollHeight - window.innerHeight
              const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
              const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
              const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
              const expected = window.scrollY / maximum * (track.height - thumb.height)
              return !scrollbar.classList.contains('os-scrollbar-unusable') &&
                Math.abs(thumb.top - track.top - expected) <= 2 / devicePixelRatio
            })).toBe(true)
          }
        } finally {
          await session.detach()
        }
        await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', ids.at(-1))

        // Start at the long page's end before reducing the range to zero.
        await scrollPageToBottom(page)
        await page.locator(`.tabContent[data-tab-id="${ids[0]}"] [data-tab-switch-overflow]`).evaluate(element => element.remove())
        await page.locator(`.tab[data-tab-id="${ids[0]}"]`).click()
        await expect(page.locator(`.tabContent[data-tab-id="${ids[0]}"]`)).toBeVisible()
        await expect.poll(() => page.evaluate(() => ({
          offset: window.scrollY,
          range: document.documentElement.scrollHeight - window.innerHeight,
          unusable: document.querySelector('body > .os-scrollbar-vertical').classList.contains('os-scrollbar-unusable')
        }))).toEqual({ offset: 0, range: 0, unusable: true })

        // Growing the viewport must also clamp a formerly valid end offset.
        await page.locator(`.tab[data-tab-id="${ids[1]}"]`).click()
        await expect(page.locator(`.tabContent[data-tab-id="${ids[1]}"]`)).toBeVisible()
        await scrollPageToBottom(page)
        const previousRange = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
        await page.setViewportSize({ width: 1600, height: 1200 })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThan(previousRange)
        await expectPageScrollbarAtEnd(page)
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

async function scrollPageToBottom(page) {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
  await expectPageScrollbarAtEnd(page)
}

async function expectPageScrollbarAtEnd(page) {
  await expect.poll(() => page.evaluate(() => {
    const maximum = document.documentElement.scrollHeight - window.innerHeight
    const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
    const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
    const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
    const content = document.querySelector('.app > .routerView')
    const renderedBottom = content.getBoundingClientRect().bottom + Number.parseFloat(getComputedStyle(content).marginBottom)
    const tolerance = 2 / devicePixelRatio
    return window.scrollY > 0 && Math.abs(window.scrollY - maximum) <= tolerance &&
      Math.abs(renderedBottom - window.innerHeight) <= tolerance &&
      !scrollbar.classList.contains('os-scrollbar-unusable') &&
      Math.abs(thumb.bottom - track.bottom) <= tolerance
  })).toBe(true)
}
