import { test, expect, sel, waitForAppReady, clickSearchCancel, setWindowSize } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      enableSearchSuggestions: false,
      keyboardShortcuts: JSON.stringify({
        APP: {
          GENERAL: {
            SEARCH_IN_NEW_WINDOW: 'ctrl+enter'
          }
        }
      })
    }
  }
})

for (const uiScale of [100, 95]) {
  test.describe(`search input at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { enableSearchSuggestions: false, uiScale },
        searchHistory: [{ _id: 'recent search', lastUpdatedAt: Date.now() }]
      }
    })

    test('keeps its width when focused, typed into, and cleared', async ({ app, page }) => {
      const input = page.locator(sel.searchInput)
      for (const width of [1600, 900]) {
        if (width === 900) await setWindowSize(app, page, { width, height: 700 })
        await input.evaluate(element => element.blur())
        // Let the header's ResizeObserver and Vue update settle before measuring.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const initialBox = await input.boundingBox()

        const expectStableWidth = async () => {
          const box = await input.boundingBox()
          expect(box.x).toBeCloseTo(initialBox.x, 1)
          expect(box.width).toBeCloseTo(initialBox.width, 1)
        }

        await input.focus()
        await expectStableWidth()
        await input.fill('a search')
        await expectStableWidth()
        await input.fill('')
        await expectStableWidth()
        await input.evaluate(element => element.blur())
        await expectStableWidth()
      }
    })

    test('keeps the text position stable when focus changes', async ({ page }) => {
      const input = page.locator(sel.searchInput)
      await input.fill('OpenTubeX')
      await input.evaluate(element => element.blur())
      const textCenter = () => input.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return bounds.top + (bounds.height + parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth) +
          parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / 2
      })
      const unfocusedCenter = await textCenter()
      await input.focus()
      await expect(input).toBeFocused()
      expect(await textCenter()).toBeCloseTo(unfocusedCenter, 1)
      await input.evaluate(element => element.blur())
      expect(await textCenter()).toBeCloseTo(unfocusedCenter, 1)
    })

    for (const direction of ['ltr', 'rtl']) {
      test(`uses the native cancel control and restores recent searches in ${direction}`, async ({ page }) => {
        await page.locator('body').evaluate((element, direction) => { element.dir = direction }, direction)
        const input = page.locator(sel.searchInput)
        const suggestions = page.locator('.topNav .searchContainer .options .list li')
        await expect(input).toHaveAttribute('type', 'search')
        await expect(page.locator('.topNav .clearInputTextButton')).toHaveCount(0)

        await input.fill('unmatched query')
        await expect(suggestions).toHaveCount(0)
        await clickSearchCancel(input)

        await expect(input).toHaveValue('')
        await expect(input).toBeFocused()
        await expect(suggestions).toHaveCount(1)
        await expect(suggestions.first()).toContainText('recent search')

        await input.press('ArrowDown')
        await expect(input).toHaveValue('recent search')
        await clickSearchCancel(input)
        await expect(input).toHaveValue('')
        await input.press('Enter')
        await expect(page).not.toHaveURL(/#\/search\//)
      })
    }
  })
}

test('back navigation restores the previous search text', async ({ page }) => {
  const searchInput = page.locator(sel.searchInput)

  await searchInput.fill('first search')
  await searchInput.press('Enter')
  await expect(page).toHaveURL(/#\/search\/first%20search/)

  await searchInput.fill('second search')
  await searchInput.press('Enter')
  await expect(page).toHaveURL(/#\/search\/second%20search/)

  await page.locator(sel.backButton).click()

  await expect(page).toHaveURL(/#\/search\/first%20search/)
  await expect(searchInput).toHaveValue('first search')
})

test('Shift+Enter searches in a new window', async ({ app, page }) => {
  await page.locator(sel.searchInput).fill('shift enter search')

  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    page.locator(sel.searchInput).press('Shift+Enter')
  ])
  await waitForAppReady(newWindow)

  await expect(newWindow).toHaveURL(/#\/search\/shift%20enter%20search/)
  await expect(newWindow.locator('.navFilterButton')).not.toHaveClass(/filterChanged/)
  await expect(page).not.toHaveURL(/#\/search\//)
})
