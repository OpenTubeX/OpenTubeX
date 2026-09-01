import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo, sel } from '../../helpers/app.mjs'

const now = Date.now()

test.use({
  seed: {
    // YouTube search suggestions would need the network; disabling them
    // keeps this offline and isolates the search history behaviour.
    settings: { enableSearchSuggestions: false },
    searchHistory: [
      {
        _id: 'android tutorial',
        lastUpdatedAt: now - 1000,
        searchSettings: {
          prioritize: 'popularity',
          time: 'today',
          type: 'video',
          duration: 'three_to_twenty_mins',
          features: ['hd', 'subtitles']
        }
      },
      { _id: 'baking bread', lastUpdatedAt: now - 2000 }
    ]
  }
})

const suggestions = (page) => page.locator('.topNav .searchContainer .options .list li')

test.describe('search history suggestions', () => {
  test('focusing the empty search bar lists recent searches, newest first', async ({ page }) => {
    await page.locator(sel.searchInput).click()

    await expect(suggestions(page)).toHaveCount(2)
    await expect(suggestions(page).nth(0)).toContainText('android tutorial')
    await expect(suggestions(page).nth(1)).toContainText('baking bread')
  })

  test('typing filters recent searches by prefix', async ({ page }) => {
    await page.locator(sel.searchInput).fill('bak')

    await expect(suggestions(page)).toHaveCount(1)
    await expect(suggestions(page).first()).toContainText('baking bread')
    await expect(suggestions(page).first().locator('.optionWrapper'))
      .toHaveAttribute('href', /#\/search\/baking%20bread/)
  })

  test('selecting a recent search restores its filters', async ({ page }) => {
    await page.locator(sel.searchInput).click()
    await suggestions(page).first().click()

    await expect.poll(() => page.evaluate(() => {
      const params = new URLSearchParams(location.hash.split('?')[1])
      return {
        prioritize: params.get('prioritize'),
        time: params.get('time'),
        type: params.get('type'),
        duration: params.get('duration'),
        features: params.getAll('features')
      }
    })).toEqual({
      prioritize: 'popularity',
      time: 'today',
      type: 'video',
      duration: 'three_to_twenty_mins',
      features: ['hd', 'subtitles']
    })
  })

  test('middle-clicking a recent search opens its link in a background tab', async ({ page }) => {
    await page.locator(sel.searchInput).click()
    const link = suggestions(page).first().locator('.optionWrapper')

    await expect(link).toHaveAttribute('href', /#\/search\/android%20tutorial/)
    await link.click({ button: 'middle' })

    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await expect(page).not.toHaveURL(/#\/search\/android%20tutorial/)
    await expect(page.locator(sel.searchInput)).toBeFocused()
    await expect(page.locator(sel.searchInput)).toHaveValue('')
    await expect(suggestions(page)).toHaveCount(2)

    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/search\/android%20tutorial/)
    await expect.poll(() => page.evaluate(() => {
      const params = new URLSearchParams(location.hash.split('?')[1])
      return params.getAll('features')
    })).toEqual(['hd', 'subtitles'])
  })

  test('middle-clicking works before the destination href is available', async ({ page }) => {
    await page.locator(sel.searchInput).click()
    const link = suggestions(page).first().locator('.optionWrapper')

    await link.evaluate((element) => element.removeAttribute('href'))
    await link.click({ button: 'middle' })

    await expect(page.locator(sel.tabs)).toHaveCount(2)
    await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
    await page.locator(sel.tabs).nth(1).click()
    await expect(page).toHaveURL(/#\/search\/android%20tutorial/)
  })

  test('back navigation restores the active search filters', async ({ page }) => {
    await page.locator(sel.searchInput).click()
    await suggestions(page).first().click()
    await expect(page.locator('.navFilterButton')).toHaveClass(/filterChanged/)

    await goTo(page, 'history')
    await page.locator('.navFilterButton').click()
    await page.locator('.clearFilterButton').click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.navFilterButton')).not.toHaveClass(/filterChanged/)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/search\/android%20tutorial/)
    await expect(page.locator('.navFilterButton')).toHaveClass(/filterChanged/)

    await page.locator('.navFilterButton').click()
    await expect(page.locator('input[type="radio"][value="popularity"]')).toBeChecked()
    await expect(page.locator('input[type="radio"][value="today"]')).toBeChecked()
    await expect(page.locator('input[type="radio"][value="video"]')).toBeChecked()
    await expect(page.locator('input[type="radio"][value="three_to_twenty_mins"]')).toBeChecked()
  })

  test('the same query saves and restores each distinct filter set', async ({ app, page }) => {
    await page.locator('.navFilterButton').click()
    await page.locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
    await page.locator('.searchRadio', { hasText: 'Duration' }).getByText('3 - 20 minutes', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.locator(sel.searchInput).fill('daily news')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible()

    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tabId = store.getters.getPresentedTabId ?? 'web'
      store.commit('setSearchTime', { tabId, value: 'week' })
    })
    await page.locator(sel.searchInput).press('Enter')

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'search-history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records
        .filter((entry) => entry.query === 'daily news' && !entry.$$deleted)
        .map((entry) => entry.searchSettings.time)
        .sort()
    }).toEqual(['today', 'week'])

    await page.locator(sel.searchInput).click()
    const matchingSuggestions = suggestions(page).filter({ hasText: 'daily news' })
    await expect(matchingSuggestions).toHaveCount(2)
    await expect(matchingSuggestions.nth(0)).toContainText(/This week/i)
    await expect(matchingSuggestions.nth(1)).toContainText('Today')

    const savedTimes = await matchingSuggestions.locator('.optionWrapper').evaluateAll((links) => {
      return links.map((link) => new URL(link.href).hash.match(/[?&]time=([^&]*)/)?.[1]).sort()
    })
    expect(savedTimes).toEqual(['today', 'week'])

    await matchingSuggestions.locator('.optionWrapper[href*="time=today"]').click()
    await expect.poll(() => new URLSearchParams(page.url().split('?')[1]).get('time')).toBe('today')

    await page.locator(sel.searchInput).click()
    await suggestions(page)
      .filter({ hasText: 'daily news' })
      .locator('.optionWrapper[href*="time=week"]')
      .click()
    await expect.poll(() => new URLSearchParams(page.url().split('?')[1]).get('time')).toBe('week')
  })

  test('an early search reuses a matching legacy database entry', async ({ app, page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const tabId = store.getters.getPresentedTabId ?? 'web'
      store.commit('setSearchHistoryEntries', [])
      store.commit('setSearchPrioritize', { tabId, value: 'popularity' })
      store.commit('setSearchTime', { tabId, value: 'today' })
      store.commit('setSearchType', { tabId, value: 'video' })
      store.commit('setSearchDuration', { tabId, value: 'three_to_twenty_mins' })
      store.commit('setSearchFeatures', { tabId, value: ['subtitles', 'hd'] })
    })

    await page.locator(sel.searchInput).fill('android tutorial')
    await page.locator(sel.searchInput).press('Enter')

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'search-history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return [...new Set(records
        .filter(entry => !entry.$$deleted && (
          entry._id === 'android tutorial' || entry.query === 'android tutorial'
        ))
        .map(entry => entry._id))]
    }).toEqual(['android tutorial'])

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'search-history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter(entry => entry._id === 'android tutorial').at(-1)?.query
    }).toBe('android tutorial')
  })

  test('a recent search can be removed and stays removed', async ({ app, page }) => {
    await page.locator(sel.searchInput).click()
    await expect(suggestions(page)).toHaveCount(2)

    const firstEntry = suggestions(page).first()
    await firstEntry.hover()
    await firstEntry.locator('.removeButton').click()

    await expect(suggestions(page)).toHaveCount(1)
    await expect(suggestions(page).first()).toContainText('baking bread')

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'search-history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      return records.filter((record) => record._id === 'android tutorial').at(-1)?.$$deleted
    }).toBe(true)

    ;({ page } = await app.relaunch())
    await page.locator(sel.searchInput).click()
    await expect(suggestions(page)).toHaveCount(1)
    await expect(suggestions(page).first()).toContainText('baking bread')
  })

  test('typing a different search immediately after removing a suggestion works', async ({ page }) => {
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const searchInput = page.locator(sel.searchInput)
    await searchInput.fill('android tutorial')

    const matchingEntry = suggestions(page).first()
    await matchingEntry.hover()
    await matchingEntry.locator('.removeButton').click()

    await searchInput.fill('different search')
    await searchInput.press('Enter')

    await expect(page).toHaveURL(/#\/search\/different%20search/)
    expect(pageErrors).toEqual([])
  })
})

test.describe('search history URL links', () => {
  test.use({
    seed: {
      settings: { enableSearchSuggestions: false },
      searchHistory: [{
        _id: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        lastUpdatedAt: now
      }]
    }
  })

  test('a recognized YouTube URL links to its internal destination', async ({ page }) => {
    await page.locator(sel.searchInput).click()

    await expect(suggestions(page).first().locator('.optionWrapper'))
      .toHaveAttribute('href', /#\/watch\/dQw4w9WgXcQ/)
  })
})

test.describe('search suggestion remove button layout', () => {
  test('the remove control stays compact in a narrow dropdown', async ({ app, page }) => {
    // Squeeze the search dropdown by shrinking the window and adding the vertical
    // tab column, so the suggestion text has to truncate. The remove button must
    // stay clear of the text instead of covering it (2nd screenshot bug).
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0]
      const bounds = browserWindow.getBounds()
      browserWindow.setBounds({ ...bounds, width: 760 })
    })
    await page.locator(sel.searchInput).click()
    await expect(suggestions(page)).toHaveCount(2)

    // Narrow the middle column further; the input keeps focus so the dropdown
    // stays open.
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setTabBarPosition', 'left')
      store.commit('setVerticalTabBarWidth', 300)
    })
    await expect(page.locator('.app')).toHaveClass(/verticalTabs/)

    const entry = suggestions(page).first()
    const removeButton = entry.locator('.removeButton')
    await entry.hover()

    // The remove control is a compact icon (~26px) rather than the wider
    // "Remove" word (~47px), so it no longer eats into the suggestion text.
    await expect.poll(async () => {
      const removeBox = await removeButton.boundingBox()
      return removeBox.width
    }).toBeLessThan(40)

    const [entryBox, removeBox] = await Promise.all([
      entry.boundingBox(),
      removeButton.boundingBox()
    ])
    expect(entryBox.x + entryBox.width - removeBox.x - removeBox.width).toBeGreaterThanOrEqual(8)

    const colors = await entry.evaluate((element) => ({
      row: getComputedStyle(element).backgroundColor,
      handle: getComputedStyle(
        element.closest('.list').querySelector('.os-scrollbar-vertical .os-scrollbar-handle')
      ).backgroundColor
    }))
    expect(colors.handle).toBe(colors.row)
  })

  test('the leading icon is vertically centered in its row', async ({ page }) => {
    await page.locator(sel.searchInput).click()
    const entry = suggestions(page).first()
    await expect(entry).toBeVisible()
    const icon = entry.locator('.searchResultIcon')

    await expect.poll(async () => {
      const [rowBox, iconBox] = await Promise.all([entry.boundingBox(), icon.boundingBox()])
      const rowCenter = rowBox.y + rowBox.height / 2
      const iconCenter = iconBox.y + iconBox.height / 2
      return Math.abs(rowCenter - iconCenter)
    }).toBeLessThanOrEqual(1.5)
  })
})
