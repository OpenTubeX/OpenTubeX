import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

for (const width of [460, 1400]) {
  for (const uiScale of [100, 125]) {
    test.describe(`live settings search at ${width}px and ${uiScale}% scale`, () => {
      test.use({ seed: { settings: { uiScale } } })

      test.beforeEach(async ({ page, app }) => {
        await setWindowSize(app, page, { width, height: 850 })
        await goTo(page, 'settings')
      })

      test('filters on each keystroke without submitting', async ({ page }) => {
        const search = page.getByRole('searchbox', { name: 'Search settings' })
        const matches = page.locator('.settingsSearchResultMatch')
        await search.focus()
        for (const text of ['u', 'i', ' scale']) {
          await search.pressSequentially(text)
          await expect(matches.filter({ hasText: /^UI Scale$/ })).toBeVisible()
          await expect(search).toBeFocused()
        }
        await expect(matches).toHaveCount(1)

        await search.press('Backspace')
        await expect(matches).toHaveText(['UI Scale'])
        await search.fill('no-such-setting')
        await expect(page.locator('.settingsNoResults')).toBeVisible()
        await search.fill('')
        await expect(page.locator('.settingsSearchResults')).toHaveCount(0)
        await expect(page.locator('.settingsMenu [data-section="appearance"]')).toBeVisible()
      })

      test('filters while the keyboard is composing text', async ({ page }) => {
        const search = page.getByRole('searchbox', { name: 'Search settings' })
        const matches = page.locator('.settingsSearchResultMatch')
        await search.focus()
        await search.dispatchEvent('compositionstart')

        // Android keyboards keep the current word uncommitted until a space,
        // suggestion or editor action. Input events must still update search.
        for (const text of ['ui', 'ui scale', 'ui scal', 'no-such-setting', '']) {
          await search.evaluate((element, value) => {
            element.value = value
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true, inputType: 'insertCompositionText', isComposing: true
            }))
          }, text)
          if (text === '') {
            await expect(page.locator('.settingsSearchResults')).toHaveCount(0)
            await expect(page.locator('.settingsMenu [data-section="appearance"]')).toBeVisible()
          } else if (text === 'no-such-setting') {
            await expect(page.locator('.settingsNoResults')).toBeVisible()
          } else if (text === 'ui') {
            await expect(matches.filter({ hasText: /^UI Scale$/ })).toBeVisible()
            await expect(matches.filter({ hasText: /^UI Roundness$/ })).toBeVisible()
          } else {
            await expect(matches).toHaveText(['UI Scale'])
          }
          await expect(search).toHaveValue(text)
          await expect(search).toBeFocused()
        }

        await search.dispatchEvent('compositionend')
        await search.pressSequentially('ui scale')
        await expect(matches).toHaveText(['UI Scale'])
      })
    })
  }
}
