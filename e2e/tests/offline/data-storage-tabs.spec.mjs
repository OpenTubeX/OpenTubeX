import { expect, expectScrollAtRenderedEnd, goToSettingsSection, setWindowSize, test } from '../../helpers/app.mjs'

for (const uiScale of [100, 95]) {
  test.describe(`fixed data and storage tabs at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', uiScale } } })

    test('keeps both tabs above the scroller when scrolling, switching tabs and resizing', async ({ app, page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await setWindowSize(app, page, { width: 1100, height: 720 })
      await goToSettingsSection(page, 'data')
      const content = page.locator('.settingsContent')
      const tabs = page.getByRole('tablist', { name: 'Data & Storage' })
      const expectFixedTabs = async () => {
        await expect.poll(() => tabs.evaluate(element => {
          const tabs = element.getBoundingClientRect()
          const viewport = document.querySelector('.settingsContent').getBoundingClientRect()
          const header = document.querySelector('.settingsWindowHeader').getBoundingClientRect()
          return tabs.top >= header.bottom - 1 && tabs.bottom <= viewport.top + 1 &&
            [...element.querySelectorAll('button')].every(button => {
              const rect = button.getBoundingClientRect()
              return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
            })
        })).toBe(true)
        await expect.poll(() => content.evaluate(element => {
          const section = element.querySelector('.section')
          const contentEnd = section.getBoundingClientRect().bottom +
            Number.parseFloat(getComputedStyle(element).paddingBottom)
          if (element.scrollTop < 0 || (element.scrollTop > 1 &&
            contentEnd < element.getBoundingClientRect().bottom - 2 / devicePixelRatio)) return false
          const scrollbar = element.querySelector('.os-scrollbar-vertical')
          if (element.scrollHeight <= element.clientHeight + 1) {
            return element.scrollTop <= 1 && scrollbar.classList.contains('os-scrollbar-unusable')
          }
          const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
          const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
          return !scrollbar.classList.contains('os-scrollbar-unusable') &&
            Math.abs(thumb.height / track.height - element.clientHeight / element.scrollHeight) < 0.02
        })).toBe(true)
      }
      const scrollToBottom = async () => {
        await content.evaluate(element => { element.scrollTop = element.scrollHeight })
        await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        await expectScrollAtRenderedEnd(content)
        await expectFixedTabs()
      }

      await scrollToBottom()
      await tabs.getByRole('tab', { name: 'Storage', exact: true }).click()
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)
      await scrollToBottom()
      await tabs.getByRole('tab', { name: 'Storage', exact: true }).press('ArrowLeft')
      await expect(tabs.getByRole('tab', { name: 'Data', exact: true })).toBeFocused()
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0)

      await scrollToBottom()
      await setWindowSize(app, page, { width: 620, height: 650 })
      await expectFixedTabs()
      await scrollToBottom()
      await setWindowSize(app, page, { width: 1400, height: 900 })
      await expectFixedTabs()
      await page.getByRole('button', { name: 'Maximize', exact: true }).click()
      await expectFixedTabs()

      await tabs.getByRole('tab', { name: 'Storage', exact: true }).click()
      await scrollToBottom()
      for (const colorScheme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme })
        await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
        await page.locator('.settingsContentPane').screenshot({ path: testInfo.outputPath(`fixed-tabs-${colorScheme}.png`) })
      }

      await tabs.getByRole('tab', { name: 'Data', exact: true }).click()
      await scrollToBottom()
      await content.getByRole('button', { name: 'Export Subscriptions', exact: true }).click()
      await expect(tabs).toBeHidden()
      await page.locator('.settingsBreadcrumbParent').click()
      await expectFixedTabs()
      await scrollToBottom()
      const search = page.getByRole('searchbox', { name: 'Search settings' })
      await search.fill('UI Scale')
      await expect(tabs).toBeHidden()
      await expect(page.locator('.settingsSearchResultMatch')).toHaveText(['UI Scale'])
      await search.fill('')
      await goToSettingsSection(page, 'data')
      await expectFixedTabs()
    })
  })
}
