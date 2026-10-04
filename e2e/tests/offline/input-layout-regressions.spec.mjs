import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'

for (const uiScale of [100, 95]) {
  test.describe(`input layout regressions at ${uiScale}%`, () => {
    test.use({
      seed: {
        settings: { currentLocale: 'en-US', baseTheme: 'dark', uiScale, useQuickPlaybackSpeedBar: true },
        history: [
          { _id: 'aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', title: 'First video', author: 'Test', timeWatched: 1000, lengthSeconds: 60, watchProgress: 10 },
          { _id: 'bbbbbbbbbbb', videoId: 'bbbbbbbbbbb', title: 'Second video', author: 'Test', timeWatched: 2000, lengthSeconds: 60, watchProgress: 10 }
        ]
      }
    })

    test.beforeEach(async ({ page }) => {
      await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 40, y: 40, width: 1400, height: 900 })))
    })

    test('history search fills its row at desktop and mobile widths', async ({ app, page }) => {
      await goTo(page, 'history')
      for (const width of [1600, 480, 1600]) {
        await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 }), width)
        const field = page.locator('.historySearch')
        await expect(field).toBeVisible()
        await expect.poll(() => field.evaluate(element => {
          const parent = element.parentElement
          const style = getComputedStyle(parent)
          return Math.abs(parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - element.getBoundingClientRect().width)
        })).toBeLessThanOrEqual(1)
        await field.locator('input').fill('First')
        await field.locator('input').clear()
      }
    })

    test('settings selects stay compact while History sort fits its selected option', async ({ app, page }, testInfo) => {
      const general = await goToSettingsSection(page, 'general')
      const week = general.getByRole('combobox', { name: 'Week Starts On' })
      expect((await week.boundingBox()).width).toBeLessThanOrEqual(400)
      await general.locator('.generalSelectGrid').scrollIntoViewIfNeeded()
      await captureAppFramebuffer(app, testInfo, 'compact-general-selects')
      const appearance = await goToSettingsSection(page, 'appearance')
      for (const name of ['Video View Type', 'Playlist View Type', 'Thumbnail Preference']) {
        const select = appearance.getByRole('combobox', { name })
        expect.soft((await select.boundingBox()).width, name).toBeLessThanOrEqual(260)
      }
      await appearance.locator('.generalSelectGrid').scrollIntoViewIfNeeded()
      await captureAppFramebuffer(app, testInfo, 'compact-appearance-selects')
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toHaveCount(0)
      await goTo(page, 'history')
      const sort = page.locator('.sortSelect [role="combobox"]')
      for (const [key, label] of [['Home', 'Date Watched (Newest)'], ['End', 'Date Watched (Oldest)']]) {
        await sort.focus()
        await sort.press(key)
        await expect(sort.locator('.selectedValue')).toHaveText(label)
        await expect.poll(() => sort.locator('.selectedValue').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      }
      await captureAppFramebuffer(app, testInfo, 'history-readable-sort')
    })

    test('Tab Organizer puts the group target after Select All and aligns bulk controls', async ({ app, page }, testInfo) => {
      await page.locator('.tabOrganizerButton').click()
      const organizer = page.getByRole('dialog', { name: 'Tab Organizer' })
      const move = organizer.getByRole('combobox', { name: /Move selected tabs to group/ })
      await expect(move.locator('..')).toHaveClass(/compactSelect/)
      expect(await move.evaluate(element => {
        const field = element.closest('.compactSelect')
        return field.parentElement.matches('.selectionControls') && field.previousElementSibling.matches('button')
      })).toBe(true)
      const offset = await organizer.locator('.bulkActions').evaluate(element => {
        const input = element.querySelector('input').getBoundingClientRect()
        return Math.max(...[...element.querySelectorAll(':scope > button')].map(button => Math.abs(button.getBoundingClientRect().bottom - input.bottom)))
      })
      expect(offset).toBeLessThanOrEqual(1)
      await captureAppFramebuffer(app, testInfo, 'tab-organizer-desktop')
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 480, height: 900 }))
      await expect.poll(() => organizer.locator('.tabOrganizerSearch').evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const parent = element.parentElement.getBoundingClientRect()
        return Math.max(Math.abs(bounds.left - parent.left), Math.abs(bounds.right - parent.right))
      })).toBeLessThanOrEqual(1)
      await captureAppFramebuffer(app, testInfo, 'tab-organizer-narrow')
    })

    test('wrapped engine fields center and playback name editing centers beside its reset', async ({ app, page }, testInfo) => {
      const engines = await goToSettingsSection(page, 'context-menu-search')
      const form = engines.locator('.addEngine')
      await form.getByLabel('Engine name', { exact: true }).fill('Example engine')
      await form.getByLabel('Search URL', { exact: true }).fill('https://example.com/search?q=%s')
      await form.getByRole('button', { name: 'Add engine', exact: true }).click()
      const engineRow = engines.locator('.engineRow').filter({ has: page.getByRole('button', { name: 'Remove Example engine', exact: true }) })
      const buttonOffset = await engineRow.evaluate(element => {
        const button = element.querySelector('.removeEngine').getBoundingClientRect()
        return Math.max(...[...element.querySelectorAll('.ft-input')].map(input => {
          const field = input.getBoundingClientRect()
          return Math.abs(field.top + field.height / 2 - button.top - button.height / 2)
        }))
      })
      expect(buttonOffset).toBeLessThanOrEqual(0.1)
      const heightDifference = await engineRow.evaluate(element => Math.abs(
        element.querySelector('.removeEngine').getBoundingClientRect().height - element.querySelector('.ft-input').getBoundingClientRect().height
      ))
      expect(heightDifference).toBeLessThanOrEqual(0.1)
      await captureAppFramebuffer(app, testInfo, 'engine-delete-alignment')
      await engines.evaluate(element => { element.parentElement.style.inlineSize = '650px' })
      for (const field of await engines.locator('.addEngine .ft-input-component').all()) {
        const offset = await field.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const parent = element.parentElement.getBoundingClientRect()
          return Math.abs(bounds.left + bounds.width / 2 - parent.left - parent.width / 2)
        })
        expect.soft(offset).toBeLessThanOrEqual(1)
      }
      await engines.locator('.addEngine').scrollIntoViewIfNeeded()
      await captureAppFramebuffer(app, testInfo, 'centered-engine-inputs')
      await page.locator('.settingsCloseButton').click()
      await expect(page.locator('.settingsWindow')).toHaveCount(0)
      const playback = await goToSettingsSection(page, 'playback')
      await playback.locator('[data-settings-subpage="quick-playback-speed"]').click()
      const row = page.locator('.quickPlaybackSpeedEntry').first()
      await row.getByRole('button', { name: 'Edit playback speed name', exact: true }).click()
      const offset = await row.locator('.quickPlaybackSpeedNameEditRow').evaluate(element => {
        const input = element.querySelector('input').getBoundingClientRect()
        const reset = element.querySelector('.quickPlaybackSpeedIconButton').getBoundingClientRect()
        return Math.abs(input.top + input.height / 2 - reset.top - reset.height / 2)
      })
      expect(offset).toBeLessThanOrEqual(1)
      await captureAppFramebuffer(app, testInfo, 'playback-name-alignment')
    })
  })
}
