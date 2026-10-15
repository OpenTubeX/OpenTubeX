import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
import { expectTabHighlightAligned, selectTabWithHighlightAnimation, tabHighlightAnimations } from '../../helpers/tabs.mjs'

test.use({ seed: { settings: { reducedMotion: 'off', animationSpeed: 25 } } })

test('highlight capture resolves when its transition is canceled', async ({ page }) => {
  await goToSettingsSection(page, 'data')
  const tab = page.getByRole('tab', { name: 'Storage', exact: true })
  await tab.evaluate(element => {
    function cancelHighlight(event) {
      if (event.target !== element || event.propertyName !== 'opacity' || event.pseudoElement !== '::before') return
      element.removeEventListener('transitionrun', cancelHighlight)
      element.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition && animation.transitionProperty === 'opacity' && animation.effect.target === element && animation.effect.pseudoElement === '::before')
        .forEach(animation => animation.cancel())
    }
    element.addEventListener('transitionrun', cancelHighlight)
  })
  expect(await selectTabWithHighlightAnimation(tab)).toBeNull()
})

test('shared tabs crossfade between selections and snap after layout changes', async ({ app, page }) => {
  await goToSettingsSection(page, 'data')
  const tabs = page.getByRole('tablist', { name: 'Data & Storage' })
  const selected = tabs.locator('[aria-selected="true"]')
  const aligned = () => expectTabHighlightAligned(selected)
  await aligned()
  for (const scale of [100, 95, 125]) {
    await page.evaluate(value => window.$store.dispatch('updateUiScale', value), scale)
    await aligned()
    for (const name of ['Storage', 'Data']) {
      expect(await selectTabWithHighlightAnimation(tabs.getByRole('tab', { name, exact: true }))).toEqual(
        { property: 'opacity', playbackRate: 0.25, duration: 140 }
      )
      await aligned()
      await expect.poll(() => tabs.locator('[role="tab"]').evaluateAll(buttons =>
        buttons.filter(button => button.getAnimations({ subtree: true }).some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'opacity')).length
      )).toBe(0)
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
  await aligned()
  await setWindowSize(app, page, { width: 800, height: 700 })
  await aligned()
  await expect.poll(() => selected.evaluate(tabHighlightAnimations)).toEqual([])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'system'))
  await tabs.getByRole('tab', { name: 'Data', exact: true }).click()
  await aligned()
  await expect.poll(() => selected.evaluate(tabHighlightAnimations)).toEqual([])
  await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'off'))
  expect(await selectTabWithHighlightAnimation(tabs.getByRole('tab', { name: 'Storage', exact: true }))).not.toBeNull()
  await aligned()
})

test('connected segments stay joined in compact, RTL, and fractional-scale layouts', async ({ app, page }) => {
  await goToSettingsSection(page, 'data')
  const tabs = page.getByRole('tablist', { name: 'Data & Storage' })
  await expect(tabs).toHaveClass(/segmented/)
  await page.evaluate(() => window.$store.dispatch('updateUiScale', 95))
  for (const size of [{ width: 1200, height: 800 }, { width: 375, height: 812 }]) {
    await setWindowSize(app, page, size)
    for (const direction of ['ltr', 'rtl']) {
      await tabs.evaluate((element, direction) => { element.dir = direction }, direction)
      await tabs.getByRole('tab', { name: 'Data', exact: true }).click()
      await page.keyboard.press('End')
      await expect(tabs.getByRole('tab', { name: 'Storage', exact: true })).toBeFocused()
      await expectTabHighlightAligned(tabs.locator('[aria-selected="true"]'))
      await expect.poll(() => tabs.evaluate(element => {
        const buttons = [...element.querySelectorAll('[role="tab"]')]
        const [left, right] = buttons.map(button => button.getBoundingClientRect()).sort((a, b) => a.left - b.left)
        const group = element.getBoundingClientRect()
        const parent = element.parentElement.getBoundingClientRect()
        const parentStyle = getComputedStyle(element.parentElement)
        const availableWidth = parent.width - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)
        return {
          joined: Math.abs(left.right - right.left) < 0.2,
          fullWidth: Math.abs(group.width - availableWidth) < 0.2,
          equalSegments: Math.abs(left.width - right.width) < 0.2,
          contained: left.left >= group.left && right.right <= group.right,
          unclippedFocus: parseFloat(getComputedStyle(document.activeElement).outlineOffset) < 0,
        }
      })).toEqual({ joined: true, fullWidth: true, equalSegments: true, contained: true, unclippedFocus: true })
    }
  }
})
