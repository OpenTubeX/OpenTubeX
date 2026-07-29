import { test, expect, goTo, sel } from '../../helpers/app.mjs'

test('searching selected text in a new tab uses the default filters', async ({ page }) => {
  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'context search'
  }))
  const search = contextMenu.items.find(item => item.label === 'Search "context search" in a New Tab')
  expect(search).toMatchObject({
    labelKey: 'Context Menu.Search Selection in New Tab',
    labelParameters: { selection: 'context search' }
  })

  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: search.actionId })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page).toHaveURL(/#\/search\/context%20search/)

  const filterButton = page.locator('.navFilterButton')
  await expect(filterButton).not.toHaveClass(/filterChanged/)
  await filterButton.click()

  await expect(page.locator('input[type="radio"][value="relevance"]')).toBeChecked()
  await expect(page.locator('input[type="radio"][value="all"]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Time' }).locator('input[value=""]')).toBeChecked()
  await expect(page.locator('.searchRadio', { hasText: 'Duration' }).locator('input[value=""]')).toBeChecked()
})

test('offers enabled external search engines in a submenu', async ({ page }) => {
  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'private search'
  }))
  const searchWith = contextMenu.items.find(item => item.label === 'Search with...')

  expect(searchWith).toMatchObject({
    labelKey: 'Context Menu.Search With Multiple',
    labelParameters: {}
  })
  expect(searchWith.submenu.map(item => item.label)).toEqual([
    'DuckDuckGo',
    'Startpage',
    'Qwant',
    'Brave Search'
  ])
  expect(searchWith.submenu.map(item => item.icon)).toEqual([
    'https://duckduckgo.com/favicon.ico',
    'https://www.startpage.com/favicon.ico',
    'https://www.qwant.com/favicon.ico',
    'https://search.brave.com/favicon.ico'
  ])
  expect(searchWith.submenu.map(item => item.faviconSource)).toEqual([
    'https://duckduckgo.com/?q=%s',
    'https://www.startpage.com/sp/search?query=%s',
    'https://www.qwant.com/?q=%s',
    'https://search.brave.com/search?q=%s'
  ])
  expect(searchWith.submenu.every(item => item.labelKey == null)).toBe(true)
})

test('keeps web search enabled and below in-app search for long selections', async ({ page }) => {
  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'x'.repeat(101)
  }))
  const webSearchIndex = contextMenu.items.findIndex(item => item.label === 'Search with...')
  const inAppSearchIndices = contextMenu.items
    .map((item, index) => typeof item.label === 'string' && item.label.includes('is too long for search')
      ? index
      : -1)
    .filter(index => index !== -1)

  expect(contextMenu.items[webSearchIndex].enabled).toBe(true)
  expect(webSearchIndex).toBeGreaterThan(Math.max(...inAppSearchIndices))
})

test('keeps the newest overlapping context menu session executable', async ({ page }) => {
  const contextMenus = await page.evaluate(() => {
    return Promise.all(Array.from({ length: 10 }, (_, index) => {
      return window.ftElectron.contextMenu.open({ selectionText: `overlap ${index}` })
    }))
  })
  const contextMenu = contextMenus.at(-1)
  const search = contextMenu.items.find(item => item.label === 'Search "overlap 9" in a New Tab')

  await page.evaluate(({ sessionId, actionId }) => {
    return window.ftElectron.contextMenu.execute(sessionId, actionId)
  }, { sessionId: contextMenu.sessionId, actionId: search.actionId })

  await expect(page.locator(sel.tabs)).toHaveCount(2)
  await expect(page).toHaveURL(/#\/search\/overlap%209/)
})

test('adds a custom search engine from settings', async ({ page }) => {
  await goTo(page, 'settings')
  const sectionOrder = await page.locator('.settingsMenu [data-section]').evaluateAll(items => {
    return items.map(item => item.dataset.section)
  })
  expect(sectionOrder.indexOf('context-menu-search'))
    .toBe(sectionOrder.indexOf('return-youtube-dislike') + 1)

  await page.locator('.settingsMenu [data-section="context-menu-search"]').click()

  const section = page.locator('.settingsSections [data-section="context-menu-search"]')
  await section.getByLabel('Engine name').fill('Example Search')
  await section.getByLabel('Search URL').fill('https://example.com/search?q=%s')
  const addButton = section.getByRole('button', { name: 'Add engine' })
  const addRowCenterDifference = await Promise.all([
    section.getByLabel('Engine name').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    }),
    addButton.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
  ]).then(([inputCenter, buttonCenter]) => Math.abs(inputCenter - buttonCenter))
  expect(addRowCenterDifference).toBeLessThan(1)

  await addButton.click()
  await expect(section.getByRole('checkbox', { name: 'Example Search' })).toBeChecked()

  const customRow = section.locator('.engineRow').filter({ hasText: 'Example Search' })
  const nameInput = customRow.getByLabel('Engine name')
  const removeButton = customRow.getByRole('button', { name: 'Remove Example Search' })
  const centerDifference = await Promise.all([
    nameInput.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    }),
    removeButton.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
  ]).then(([inputCenter, buttonCenter]) => Math.abs(inputCenter - buttonCenter))
  expect(centerDifference).toBeLessThan(1)

  const urlInput = customRow.getByLabel('Search URL')
  await urlInput.fill('not a search URL')
  await urlInput.blur()
  await expect(urlInput).toHaveValue('https://example.com/search?q=%s')

  const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
    selectionText: 'custom search'
  }))
  const searchWith = contextMenu.items.find(item => item.label === 'Search with...')

  expect(searchWith.submenu.map(item => item.label)).toContain('Example Search')
  expect(searchWith.submenu.find(item => item.label === 'Example Search').icon)
    .toBe('https://example.com/favicon.ico')
})

test.describe('with one external search engine enabled', () => {
  test.use({
    seed: {
      settings: {
        contextMenuSearchEngines: JSON.stringify([
          {
            id: 'duckduckgo',
            name: 'DuckDuckGo',
            url: 'https://duckduckgo.com/?q=%s',
            enabled: true
          },
          {
            id: 'startpage',
            name: 'Startpage',
            url: 'https://www.startpage.com/sp/search?query=%s',
            enabled: false
          },
          {
            id: 'qwant',
            name: 'Qwant',
            url: 'https://www.qwant.com/?q=%s',
            enabled: false
          },
          {
            id: 'brave',
            name: 'Brave Search',
            url: 'https://search.brave.com/search?q=%s',
            enabled: false
          }
        ])
      }
    }
  })

  test('shows a direct action and opens the encoded URL in the default browser', async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.openedExternalSearchUrls = []
      shell.openExternal = async (url) => {
        globalThis.openedExternalSearchUrls.push(url)
      }
    })

    const contextMenu = await page.evaluate(() => window.ftElectron.contextMenu.open({
      selectionText: 'privacy & cats'
    }))
    const searchWith = contextMenu.items.find(item => item.label === 'Search with DuckDuckGo')

    expect(searchWith.submenu).toBeUndefined()
    expect(searchWith).toMatchObject({
      labelKey: 'Context Menu.Search With',
      labelParameters: { engine: 'DuckDuckGo' }
    })
    expect(searchWith.icon).toBe('https://duckduckgo.com/favicon.ico')
    expect(searchWith.faviconSource).toBe('https://duckduckgo.com/?q=%s')
    await page.evaluate(({ sessionId, actionId }) => {
      return window.ftElectron.contextMenu.execute(sessionId, actionId)
    }, { sessionId: contextMenu.sessionId, actionId: searchWith.actionId })

    await expect.poll(() => app.electronApp.evaluate(() => {
      return globalThis.openedExternalSearchUrls
    })).toEqual(['https://duckduckgo.com/?q=privacy%20%26%20cats'])
  })
})

test.describe('German locale', () => {
  test.use({ seed: { settings: { currentLocale: 'de-DE' } } })

  test('translates external search labels from explicit menu metadata', async ({ page }) => {
    const searchInput = page.locator('.searchInput input')
    await searchInput.fill('Auswahl')
    await searchInput.selectText()
    await searchInput.click({ button: 'right' })

    const menu = page.getByRole('menu', { name: 'Kontextmenü' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Suchen mit …' })).toBeVisible()
  })
})
