import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

async function labelGeometry(select) {
  return select.evaluate(button => {
    const control = button.getBoundingClientRect()
    const label = button.closest('.select').querySelector('.select-label').getBoundingClientRect()
    return { x: label.x - control.x, y: label.y - control.y, width: label.width, height: label.height }
  })
}

async function expectStableLabel(select) {
  await select.scrollIntoViewIfNeeded()
  await select.evaluate(button => button.blur())
  const initial = await labelGeometry(select)
  const expectUnchanged = async () => {
    const current = await labelGeometry(select)
    for (const key of Object.keys(initial)) {
      expect.soft(Math.abs(current[key] - initial[key]), `label ${key}`).toBeLessThan(0.1)
    }
  }

  await select.focus()
  await expect(select).toBeFocused()
  await expectUnchanged()
  await select.press('Space')
  await expect(select).toHaveAttribute('aria-expanded', 'true')
  await expectUnchanged()
  await select.page().keyboard.press('Escape')
  await expect(select).toHaveAttribute('aria-expanded', 'false')
  await expectUnchanged()
  await select.evaluate(button => button.blur())
  await expectUnchanged()
  await select.click()
  await expect(select).toHaveAttribute('aria-expanded', 'true')
  await expectUnchanged()
  await select.page().keyboard.press('Escape')
  await expect(select).toHaveAttribute('aria-expanded', 'false')
  await expectUnchanged()
}

for (const [locale, label] of [
  ['de-DE', 'Videofortschritt merken'],
]) {
  test.describe(`watched progress label in ${locale}`, () => {
    test.use({ seed: { settings: { currentLocale: locale, baseTheme: 'dark' } } })

    test('widens the watched progress select without clipping its label', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
      const privacy = await goToSettingsSection(page, 'privacy')
      const select = privacy.getByRole('combobox', { name: label })
      for (const width of [1600, 375]) {
        await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
          BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
        }, { width, uiScale })
        await expect.poll(() => page.evaluate(width => Math.abs(innerWidth - width), width)).toBeLessThanOrEqual(1)
        await select.scrollIntoViewIfNeeded()
        await expect.poll(() => select.evaluate(button => {
          const root = button.closest('.select')
          const caption = root.querySelector('.select-placeholder')
          return caption.scrollWidth - caption.clientWidth
        })).toBeLessThanOrEqual(1)
        const bounds = await select.evaluate(button => {
          const root = button.closest('.select').getBoundingClientRect()
          return { left: root.left, right: root.right, viewport: innerWidth }
        })
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
        await expectStableLabel(select)
        if (uiScale === 100 && width === 1600) {
          await page.screenshot({ path: testInfo.outputPath('watched-progress-label.png') })
        }
      }
    })
  })
}
