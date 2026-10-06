import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

for (const [uiScale, reducedMotion, compactNavigationLabels] of [
  [100, 'no-preference', false], [125, 'no-preference', false], [100, 'reduce', false],
  [100, 'no-preference', true], [125, 'no-preference', true], [100, 'reduce', true]
]) {
  test.describe(`mobile progress at ${uiScale}% with ${reducedMotion} motion and compact ${compactNavigationLabels}`, () => {
    test.use({ seed: { settings: { showProgressBarToast: false, uiScale, compactNavigationLabels } } })

    test('global progress follows navigation throughout hiding and revealing', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion })
      await setWindowSize(app, page, { width: 400, height: 850 })
      await goTo(page, 'settings')
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setShowProgressBar', true)
        store.commit('setProgressBarPercentage', 50)
        document.querySelector('.app > .flexBox').style.minHeight = '3000px'
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '17px')
        document.activeElement?.blur()
        window.dispatchEvent(new Event('resize'))
      })
      await expect(page.locator('.progressBar')).toBeVisible()
      const visibleTop = await page.locator('.sideNav').evaluate(nav => nav.getBoundingClientRect().top)
      for (const [top, hidden] of [[300, true], [100, false], [400, true], [0, false]]) {
        const maximumGap = await page.evaluate(async top => {
          window.scrollTo(0, top)
          let maximumGap = 0
          const start = performance.now()
          do {
            await new Promise(requestAnimationFrame)
            const nav = document.querySelector('.sideNav').getBoundingClientRect()
            const bar = document.querySelector('.progressBar').getBoundingClientRect()
            maximumGap = Math.max(maximumGap, Math.abs(bar.bottom - nav.top))
          } while (performance.now() - start < 350)
          return maximumGap
        }, top)
        expect(maximumGap).toBeLessThan(1)
        if (reducedMotion === 'reduce') {
          for (const selector of ['.sideNav', '.progressBar']) {
            await expect(page.locator(selector)).toHaveCSS('transition-duration', '0s')
          }
        }
        const nav = page.locator('.sideNav')
        if (hidden) {
          await expect(nav).toHaveClass(/scrollHidden/)
          await expect.poll(async () => {
            const geometry = await nav.evaluate(element => {
              const rect = element.getBoundingClientRect()
              return { top: rect.top, height: rect.height }
            })
            return Math.abs(geometry.top - visibleTop - geometry.height)
          }).toBeLessThan(1)
        } else {
          await expect(nav).not.toHaveClass(/scrollHidden/)
          await expect.poll(async () => Math.abs(await nav.evaluate(element => element.getBoundingClientRect().top) - visibleTop)).toBeLessThan(1)
        }
      }
      await expect(page.locator('.sideNav')).not.toHaveClass(/scrollHidden/)
    })

    test('always visible navigation can be enabled while hidden and disabled while scrolled', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion })
      await setWindowSize(app, page, { width: 400, height: 850 })
      await goTo(page, 'settings')
      await page.evaluate(() => {
        document.querySelector('.app > .flexBox').style.minHeight = '3000px'
        document.activeElement?.blur()
        window.scrollTo(0, 300)
      })
      const nav = page.locator('.sideNav')
      await expect(nav).toHaveClass(/scrollHidden/)
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateAlwaysShowNavigationBar', true))
      await expect(nav).not.toHaveClass(/scrollHidden/)
      for (const top of [400, 600, 500]) {
        await page.evaluate(top => window.scrollTo(0, top), top)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top)
        await expect(nav).not.toHaveClass(/scrollHidden/)
        await expect.poll(() => nav.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - window.innerHeight))).toBeLessThan(1)
      }
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateAlwaysShowNavigationBar', false))
      await page.evaluate(() => window.scrollTo(0, 700))
      await expect(nav).toHaveClass(/scrollHidden/)
      await page.evaluate(() => window.scrollTo(0, 600))
      await expect(nav).not.toHaveClass(/scrollHidden/)
    })

    test('connection banner appearing during navigation hiding stays above the moving bars', async ({ app, page }) => {
      await page.emulateMedia({ reducedMotion })
      await setWindowSize(app, page, { width: 400, height: 850 })
      await goTo(page, 'subscriptions')
      await page.evaluate(() => {
        document.querySelector('.app').classList.add('capacitorPhoneLayout')
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setShowProgressBar', true)
        store.commit('setProgressBarPercentage', 50)
        document.querySelector('.app > .flexBox').style.minHeight = '3000px'
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '17px')
        document.activeElement?.blur()
        window.dispatchEvent(new Event('resize'))
      })
      await expect(page.locator('.progressBar')).toBeVisible()
      await expect(page.locator('.connectionStatus')).toBeHidden()
      const overlap = await page.evaluate(async () => {
        window.scrollTo(0, 300)
        const nav = document.querySelector('.sideNav')
        while (!nav.classList.contains('scrollHidden')) await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        // A network change on returning to the app can mount the banner while
        // the navigation's scroll transition is already in progress.
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        window.dispatchEvent(new Event('offline'))
        let maximumOverlap = 0
        const start = performance.now()
        do {
          await new Promise(requestAnimationFrame)
          const status = document.querySelector('.connectionStatus')?.getBoundingClientRect()
          const progress = document.querySelector('.progressBar').getBoundingClientRect()
          if (status) maximumOverlap = Math.max(maximumOverlap, status.bottom - progress.top)
        } while (performance.now() - start < 350)
        return maximumOverlap
      })
      expect(overlap).toBeLessThan(1)
      await expect(page.locator('.connectionStatus')).toHaveText('Offline')
      await expect(page.locator('.sideNav')).toHaveClass(/scrollHidden/)
      for (const top of [100, 400, 0]) {
        const gap = await page.evaluate(async top => {
          window.scrollTo(0, top)
          let maximumGap = 0
          const start = performance.now()
          do {
            await new Promise(requestAnimationFrame)
            const status = document.querySelector('.connectionStatus').getBoundingClientRect()
            const progress = document.querySelector('.progressBar').getBoundingClientRect()
            maximumGap = Math.max(maximumGap, Math.abs(status.bottom - progress.top))
          } while (performance.now() - start < 350)
          return maximumGap
        }, top)
        expect(gap).toBeLessThan(1)
      }
      await expect(page.locator('.sideNav')).not.toHaveClass(/scrollHidden/)
    })
  })
}
