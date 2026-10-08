import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

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

for (const uiScale of [100, 125]) {
  test.describe(`select labels at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

    test('keeps comments labels stationary on focus and opening', async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      await expect(page.locator('.comment').first()).toBeVisible()
      const select = page.locator('.commentHeader').getByRole('combobox', { name: 'Sort By' })
      for (const direction of ['ltr', 'rtl']) {
        await select.evaluate((button, direction) => { button.closest('.select').dir = direction }, direction)
        await expectStableLabel(select)
      }
    })

    test('keeps content-sized settings labels stationary at desktop and phone widths', async ({ app, page }) => {
      const general = await goToSettingsSection(page, 'general')
      const select = general.getByRole('combobox', { name: 'Default Landing Page', includeHidden: true })
      for (const width of [1600, 480]) {
        await app.electronApp.evaluate(({ BrowserWindow }, { width, uiScale }) => {
          BrowserWindow.getAllWindows()[0].setContentSize(Math.round(width * uiScale / 100), Math.round(900 * uiScale / 100))
        }, { width, uiScale })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        for (const direction of ['ltr', 'rtl']) {
          await select.evaluate((button, direction) => { button.closest('.select').dir = direction }, direction)
          await expectStableLabel(select)
        }
      }
    })
  })
}
