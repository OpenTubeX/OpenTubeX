import { test, expect, goTo, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'
import { mockUnplayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

test.describe('link underlines', () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US' },
      history: [watchHistoryEntry]
    }
  })

  test('underlines description links on hover by default, never, or always', async ({ app, page }) => {
    await mockUnplayableWatchPage(app, page)
    await goTo(page, 'history')
    await page.getByText(watchHistoryEntry.title, { exact: true }).click()
    // Allows for parsing the uncached player script on a busy host.
    await expect(page.locator('.videoDescription').visible()).toBeVisible({ timeout: 30_000 })
    const view = await watchViewHandle(page)
    await view.evaluate(component => {
      component.videoDescription = 'Follow @SomeCreator for more clips'
      component.videoDescriptionHtml = ''
    })
    const link = page.locator('.videoDescription .description a', { hasText: '@SomeCreator' })
    await expect(link).toBeVisible()

    /** @param {{ idle: string, hovered: string }} expected */
    async function expectUnderline({ idle, hovered }) {
      await page.mouse.move(0, 0)
      await expect(link).toHaveCSS('text-decoration-line', idle)
      await link.hover()
      await expect(link).toHaveCSS('text-decoration-line', hovered)
      await page.mouse.move(0, 0)
    }

    await expect(page.locator(':root')).toHaveAttribute('data-link-underline', 'hover')
    await expectUnderline({ idle: 'none', hovered: 'underline' })

    const appearance = await goToSettingsSection(page, 'appearance')
    const select = appearance.getByRole('combobox', { name: 'Link Underlines' })
    await expect(select).toHaveText('Underline links on hover')
    await select.click()
    await page.locator(`#${await select.getAttribute('aria-controls')}`)
      .getByRole('option', { name: 'Never underline links', exact: true }).click()
    await expect(select).toHaveText('Never underline links')
    await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).linkUnderline).toBe('never')
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await expectUnderline({ idle: 'none', hovered: 'none' })

    await page.evaluate(() => window.$store.dispatch('updateLinkUnderline', 'always'))
    await expectUnderline({ idle: 'underline', hovered: 'underline' })

    // Hot Pink used to hide link underlines unless hovered, whatever the setting.
    await page.evaluate(() => window.$store.dispatch('updateBaseTheme', 'hotPink'))
    await expect(page.locator('body')).toHaveClass(/\bhotPink\b/)
    await expectUnderline({ idle: 'underline', hovered: 'underline' })
    await page.evaluate(() => window.$store.dispatch('updateLinkUnderline', 'never'))
    await expectUnderline({ idle: 'none', hovered: 'none' })
  })
})
