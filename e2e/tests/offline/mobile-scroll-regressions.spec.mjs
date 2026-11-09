import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

for (const [uiScale, reducedMotion, compactNavigationLabels] of [
  [125, 'no-preference', false], [100, 'reduce', true]
]) {
  test.describe(`mobile progress at ${uiScale}% with ${reducedMotion} motion and compact ${compactNavigationLabels}`, () => {
    test.use({ seed: { settings: { showProgressBarToast: false, uiScale, compactNavigationLabels } } })

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
      await page.evaluate(() => window.$store.dispatch('updateAlwaysShowNavigationBar', true))
      await expect(nav).not.toHaveClass(/scrollHidden/)
      for (const top of [400, 600, 500]) {
        await page.evaluate(top => window.scrollTo(0, top), top)
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top)
        await expect(nav).not.toHaveClass(/scrollHidden/)
        await expect.poll(() => nav.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - window.innerHeight))).toBeLessThan(1)
      }
      await page.evaluate(() => window.$store.dispatch('updateAlwaysShowNavigationBar', false))
      await page.evaluate(() => window.scrollTo(0, 700))
      await expect(nav).toHaveClass(/scrollHidden/)
      await page.evaluate(() => window.scrollTo(0, 600))
      await expect(nav).not.toHaveClass(/scrollHidden/)
    })
  })
}
