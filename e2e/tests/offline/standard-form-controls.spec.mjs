import { test, expect, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'

test.describe('standard form controls', () => {
  test.use({ seed: { settings: { useQuickPlaybackSpeedBar: true } } })

  test('edits playback speed numbers and names with shared fields at wide and narrow widths', { tag: '@scale' }, async ({ app, page }) => {
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Customize Quick Playback Speed Bar' }).click()
    const row = page.locator('.quickPlaybackSpeedEntry').first()
    const speed = row.getByRole('spinbutton', { name: 'Playback Speed', exact: true })
    await expect(row.locator('[data-icon="gauge-high"]')).toBeVisible()
    await speed.fill('1.25')
    await speed.press('Tab')
    await expect(speed).toHaveValue('1.25')
    await speed.fill('1')
    await speed.press('Tab')
    for (const value of ['0', '', '1.001', '0.004']) {
      await speed.fill(value)
      await speed.press('Tab')
      await expect(speed).toHaveValue('1')
    }
    await speed.fill('1.25')
    await speed.press('Tab')

    await row.getByRole('button', { name: 'Edit Playback Speed Name' }).click()
    const name = row.getByRole('textbox', { name: 'Name', exact: true })
    await name.fill('Comfortable')
    await name.press('Tab')
    await expect(name).toHaveValue('Comfortable')
    for (const width of [1100, 375, 812]) {
      await setWindowSize(app, page, { width, height: width === 812 ? 500 : width === 1100 ? 880 : 900 })
      await row.scrollIntoViewIfNeeded()
      await expect(speed).toBeInViewport()
      expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    }
    await row.getByRole('button', { name: 'Use automatic playback speed name' }).click()
    await expect(row.locator('.quickPlaybackSpeedName')).toContainText('1.25')
  })

  test('keeps a playback speed edit while its save is still pending', async ({ app, page }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('db-settings')
      let held = false
      ipcMain.removeHandler('db-settings')
      ipcMain.handle('db-settings', async (event, request) => {
        if (!held && request.action === 2 && request.data._id === 'quickPlaybackSpeedBarOptions') {
          held = true
          await new Promise(resolve => { globalThis.releaseQuickPlaybackSpeedWrite = resolve })
        }
        return original(event, request)
      })
    })
    await goToSettingsSection(page, 'playback')
    await page.getByRole('button', { name: 'Customize Quick Playback Speed Bar' }).click()
    const row = page.locator('.quickPlaybackSpeedEntry').first()
    const speed = row.getByRole('spinbutton', { name: 'Playback Speed', exact: true })
    await speed.fill('1.25')
    await speed.press('Tab')
    await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.releaseQuickPlaybackSpeedWrite)).toBe('function')

    await row.getByRole('button', { name: 'Edit Playback Speed Name' }).click()
    await row.getByRole('textbox', { name: 'Name', exact: true }).fill('Comfortable')
    await app.electronApp.evaluate(() => globalThis.releaseQuickPlaybackSpeedWrite())
    await expect(speed).toHaveValue('1.25')
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.$store.getters.getQuickPlaybackSpeedBarOptions)[0]
    ))).toMatchObject({ speed: 1.25, name: 'Comfortable' })
  })
})
