import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

test.use({ seed: { settings: { reducedMotion: 'off', animationSpeed: 25 } } })

test('shared tabs crossfade between selections and snap after layout changes', async ({ app, page }) => {
  await goToSettingsSection(page, 'data')
  const tabs = page.getByRole('tablist', { name: 'Data & Storage' })
  const indicator = tabs.locator('.tabsIndicator')
  await expect(indicator).toBeVisible()
  const aligned = async () => {
    await expect.poll(() => tabs.evaluate(element => {
      const line = element.querySelector('.tabsIndicator').getBoundingClientRect()
      const selected = element.querySelector('[aria-selected="true"]').getBoundingClientRect()
      return Math.max(Math.abs(line.left - selected.left), Math.abs(line.right - selected.right), Math.abs(line.bottom - selected.bottom))
    })).toBeLessThan(0.2)
  }
  for (const scale of [100, 95, 125]) {
    await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', value), scale)
    await aligned()
    for (const name of ['Storage', 'Data']) {
      await tabs.getByRole('tab', { name, exact: true }).click()
      await expect.poll(() => indicator.evaluate(element => element.getAnimations().some(animation => animation.playState === 'running'))).toBe(true)
      await aligned()
      await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(1)
      const transitions = await tabs.evaluate(element => [...element.querySelectorAll('.tabsIndicator, .tabsIndicatorOutgoing')].map(line => ({
        property: getComputedStyle(line).transitionProperty,
        stationary: Math.abs(new DOMMatrix(getComputedStyle(line).transform).e - new DOMMatrix(line.style.transform).e) < 0.01,
      })))
      expect(transitions.every(line => line.property === 'opacity' && line.stationary)).toBe(true)
      await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(0)
      await expect(indicator).toHaveCSS('transition-duration', '0.56s')
    }
  }
  await tabs.evaluate(element => {
    const buttons = [...element.querySelectorAll('[role="tab"]')]
    buttons[1].click()
    requestAnimationFrame(() => {
      buttons[0].click()
      requestAnimationFrame(() => buttons[1].click())
    })
  })
  await expect(tabs.getByRole('tab', { name: 'Storage', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.locator('.tabsIndicatorOutgoing')).toHaveCount(0)
  await aligned()
  await setWindowSize(app, page, { width: 800, height: 700 })
  await aligned()
  await expect.poll(() => indicator.evaluate(element => element.getAnimations().length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'system'))
  await tabs.getByRole('tab', { name: 'Data', exact: true }).click()
  await aligned()
  await expect.poll(() => indicator.evaluate(element => element.getAnimations().length)).toBe(0)
})

test('connected segments stay joined in compact, RTL, and fractional-scale layouts', async ({ app, page }) => {
  await goToSettingsSection(page, 'data')
  const tabs = page.getByRole('tablist', { name: 'Data & Storage' })
  await expect(tabs).toHaveClass(/segmented/)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUiScale', 95))
  for (const size of [{ width: 1200, height: 800 }, { width: 375, height: 812 }]) {
    await setWindowSize(app, page, size)
    for (const direction of ['ltr', 'rtl']) {
      await tabs.evaluate((element, direction) => { element.dir = direction }, direction)
      await tabs.getByRole('tab', { name: 'Data', exact: true }).click()
      await page.keyboard.press('End')
      await expect(tabs.getByRole('tab', { name: 'Storage', exact: true })).toBeFocused()
      await expect.poll(() => tabs.evaluate(element => {
        const buttons = [...element.querySelectorAll('[role="tab"]')]
        const [left, right] = buttons.map(button => button.getBoundingClientRect()).sort((a, b) => a.left - b.left)
        const group = element.getBoundingClientRect()
        const selected = element.querySelector('[aria-selected="true"]').getBoundingClientRect()
        const highlight = element.querySelector('.tabsIndicator').getBoundingClientRect()
        return {
          joined: Math.abs(left.right - right.left) < 0.2,
          contained: left.left >= group.left && right.right <= group.right,
          aligned: Math.max(Math.abs(highlight.left - selected.left), Math.abs(highlight.right - selected.right), Math.abs(highlight.top - selected.top), Math.abs(highlight.bottom - selected.bottom)) < 0.2,
          unclippedFocus: parseFloat(getComputedStyle(document.activeElement).outlineOffset) < 0,
        }
      })).toEqual({ joined: true, contained: true, aligned: true, unclippedFocus: true })
    }
  }
})
