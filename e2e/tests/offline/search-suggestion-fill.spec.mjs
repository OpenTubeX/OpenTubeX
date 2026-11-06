import { test, expect, sel, setWindowSize, clickSearchCancel } from '../../helpers/app.mjs'

const searchHistory = [
  { _id: 'android tutorial', lastUpdatedAt: 2, searchSettings: { time: 'today' } },
  { _id: 'baking bread', lastUpdatedAt: 1 }
]

for (const [iconPack, uiScale] of [['material', 100], ['remix', 95]]) {
  test.describe(`fill search suggestions with ${iconPack} icons at ${uiScale}%`, () => {
    test.use({ seed: { settings: { enableSearchSuggestions: false, iconPack, uiScale }, searchHistory } })

    test('accepts a filtered suggestion without searching and lets the user edit it', async ({ page }) => {
      const input = page.locator(sel.searchInput)
      const initialUrl = page.url()
      await input.fill('bak')
      await page.getByRole('button', { name: 'Use suggestion: baking bread', exact: true }).click()

      await expect(input).toHaveValue('baking bread')
      await expect(input).toBeFocused()
      await expect(page).toHaveURL(initialUrl)
      await expect(page.locator('.topNav .options .list')).toBeHidden()
      await input.press('End')
      await input.pressSequentially(' recipe')
      await expect(input).toHaveValue('baking bread recipe')
      await input.press('Enter')
      await expect(page).toHaveURL(/#\/search\/baking%20bread%20recipe/)
    })

    test('clears the keyboard preview when accepting a different suggestion', async ({ page }) => {
      const input = page.locator(sel.searchInput)
      const initialUrl = page.url()
      await input.focus()
      await input.press('ArrowDown')
      await expect(input).toHaveValue('android tutorial')
      await page.getByRole('button', { name: /^Use suggestion: / }).nth(1).click()
      await expect(input).toHaveValue('baking bread')
      await expect(page).toHaveURL(initialUrl)
      await input.press('Enter')
      await expect(page).toHaveURL(/#\/search\/baking%20bread/)
    })

    for (const edit of ['replace', 'clear']) {
      test(`reopens suggestions after a native ${edit} of the filled query`, async ({ page }) => {
        const input = page.locator(sel.searchInput)
        const list = page.locator('.topNav .options .list')
        const initialUrl = page.url()
        await input.fill('bak')
        await page.getByRole('button', { name: /^Use suggestion: / }).click()
        await expect(input).toHaveValue('baking bread')
        await expect(list).toBeHidden()

        if (edit === 'replace') {
          // fill emits native input without keydown, like paste or IME input.
          await input.fill('bak')
        } else {
          await clickSearchCancel(input)
        }

        await expect(input).toHaveValue(edit === 'replace' ? 'bak' : '')
        await expect(input).toBeFocused()
        await expect(list).toBeVisible()
        await expect(list.locator('li')).toHaveCount(edit === 'replace' ? 1 : 2)
        await expect(page).toHaveURL(initialUrl)
      })
    }

    test('supports keyboard activation of the fill button', async ({ page }) => {
      const input = page.locator(sel.searchInput)
      const initialUrl = page.url()
      await input.focus()
      const fill = page.getByRole('button', { name: /^Use suggestion: / }).first()
      for (let step = 0; step < 6 && !await fill.evaluate(element => element === document.activeElement); step++) {
        await page.keyboard.press('Tab')
      }
      await expect(fill).toBeFocused()
      await expect(fill).toHaveAccessibleName('Use suggestion: android tutorial (Today)')
      await page.keyboard.press('Space')
      await expect(input).toHaveValue('android tutorial')
      await expect(input).toBeFocused()
      await expect(page).toHaveURL(initialUrl)
      await expect(page.locator('.navFilterButton')).not.toHaveClass(/filterChanged/)
      await input.press('Enter')
      await expect(page).toHaveURL(/#\/search\/android%20tutorial/)
      expect(new URLSearchParams(page.url().split('?')[1]).get('time')).toBe('')
    })

    test('keeps fill and remove actions separate in the compact search dropdown', async ({ app, page }) => {
      await setWindowSize(app, page, { width: 390, height: 844 })
      await page.getByRole('button', { name: 'Open Search Container', exact: true }).click()
      const input = page.locator(sel.searchInput)
      await input.focus()
      const row = page.locator('.topNav .options .list li').first()
      const fill = row.getByRole('button', { name: /^Use suggestion: / })
      const remove = row.getByRole('button', { name: 'Remove', exact: true })
      const [textBox, fillBox, removeBox] = await Promise.all([
        row.locator('.optionWrapper').boundingBox(), fill.boundingBox(), remove.boundingBox()
      ])
      expect(textBox.x + textBox.width).toBeLessThanOrEqual(fillBox.x)
      expect(fillBox.x + fillBox.width).toBeLessThanOrEqual(removeBox.x)
      expect(fillBox.width / (uiScale / 100)).toBeGreaterThanOrEqual(47)
      await fill.click()
      await expect(input).toHaveValue('android tutorial')
      await expect(input).toBeFocused()
      await expect(page).not.toHaveURL(/#\/search\//)
      await input.press('ControlOrMeta+A')
      await input.press('Backspace')
      await expect(page.locator('.topNav .options .list li')).toHaveCount(2)
      await remove.click()
      await expect(input).toHaveValue('')
      await expect(page.locator('.topNav .options .list li')).toHaveCount(1)
    })
  })
}

test.describe('online suggestions', () => {
  const instanceUrl = 'https://invidious.test'
  test.use({
    seed: { settings: { enableSearchSuggestions: true, backendPreference: 'invidious', defaultInvidiousInstance: instanceUrl } }
  })

  test('fills an online suggestion and refreshes suggestions without submitting a search', async ({ page }) => {
    await page.route(`${instanceUrl}/api/v1/search/suggestions/**`, route => route.fulfill({
      json: { query: new URL(route.request().url()).searchParams.get('q'), suggestions: ['bread recipe', 'bread recipe easy'] }
    }))
    const input = page.locator(sel.searchInput)
    const initialUrl = page.url()
    await input.fill('bread')
    const fill = page.getByRole('button', { name: /^Use suggestion: / }).first()
    await expect(fill).toBeVisible()
    const refresh = page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === 'bread recipe')
    await fill.click()
    await refresh
    await expect(input).toHaveValue('bread recipe')
    await expect(input).toBeFocused()
    await expect(page).toHaveURL(initialUrl)
    const list = page.locator('.topNav .options .list')
    await expect(list).toBeHidden()
    await input.fill('bread recipe e')
    await expect(list).toBeVisible()
    await expect(list.locator('li')).toHaveCount(1)
    await expect(list).toContainText('bread recipe easy')
    await input.pressSequentially('asy')
    await expect(input).toHaveValue('bread recipe easy')
  })
})
