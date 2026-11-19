import { test, expect, goTo, goToSettingsSection, sel, readDatastore } from '../../helpers/app.mjs'
import { demoPlayerResponse } from '../../helpers/media.mjs'
import { activeTab } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

// A closing filters prompt stays in the page while it fades out.
const filters = page => page.locator('.prompt:not([inert])')

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

  for (const selection of ['click', 'keyboard']) {
    test(`selecting filtered history by ${selection} preserves the selected entry's filters`, async ({ page }) => {
      const input = page.locator(sel.searchInput)
      await input.fill('bak')
      await expect(suggestions(page)).toHaveCount(1)
      await expect(suggestions(page).first()).toContainText('baking bread')
      if (selection === 'keyboard') {
        await input.press('ArrowDown')
        await input.press('Enter')
      } else {
        await suggestions(page).first().locator('.optionWrapper').click()
      }
      await expect(page).toHaveURL(/#\/search\/baking%20bread/)
      await expect.poll(() => page.evaluate(() => {
        const params = new URLSearchParams(location.hash.split('?')[1])
        return {
          prioritize: params.get('prioritize'),
          time: params.get('time'),
          type: params.get('type'),
          duration: params.get('duration'),
          features: params.getAll('features')
        }
      })).toEqual({ prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] })
    })
  }

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
    await expect(filters(page).locator('input[type="radio"][value="popularity"]')).toBeChecked()
    await expect(filters(page).locator('input[type="radio"][value="today"]')).toBeChecked()
    await expect(filters(page).locator('input[type="radio"][value="video"]')).toBeChecked()
    await expect(filters(page).locator('input[type="radio"][value="three_to_twenty_mins"]')).toBeChecked()
  })

  test('the same query saves and restores each distinct filter set', async ({ app, page }) => {
    await page.locator('.navFilterButton').click()
    await filters(page).locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
    await filters(page).locator('.searchRadio', { hasText: 'Duration' }).getByText('3 - 20 minutes', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.locator(sel.searchInput).fill('daily news')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible()

    await page.evaluate(() => {
      const store = window.$store
      const tabId = store.getters.getPresentedTabId ?? 'web'
      store.commit('setSearchTime', { tabId, value: 'week' })
    })
    await page.locator(sel.searchInput).press('Enter')

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'search-history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
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

    // Searching again moves the Today entry to the top once it is saved. The
    // rows are reused in place then, so a click during the move lands on Today.
    await page.locator(sel.searchInput).click()
    await expect(matchingSuggestions.nth(0)).toContainText('Today')
    await matchingSuggestions.locator('.optionWrapper[href*="time=week"]').click()
    await expect.poll(() => new URLSearchParams(page.url().split('?')[1]).get('time')).toBe('week')
  })

  test('an early search reuses a matching legacy database entry', async ({ app, page }) => {
    await page.evaluate(() => {
      const store = window.$store
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
      const contents = readDatastore(app.userDataDir, 'search-history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return [...new Set(records
        .filter(entry => !entry.$$deleted && (
          entry._id === 'android tutorial' || entry.query === 'android tutorial'
        ))
        .map(entry => entry._id))]
    }).toEqual(['android tutorial'])

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'search-history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.filter(entry => entry._id === 'android tutorial').at(-1)?.query
    }).toBe('android tutorial')
  })

  test('a YouTube export round trip preserves filter presets for the same query', async ({ page }) => {
    const dataSection = await goToSettingsSection(page, 'data')

    await page.evaluate(() => {
      const store = window.$store
      store.commit('setSearchHistoryEntries', [
        {
          _id: 'round-trip-today',
          query: 'round trip',
          lastUpdatedAt: 100,
          searchSettings: { time: 'today', features: ['hd', '4k'] }
        },
        {
          _id: 'round-trip-week',
          query: 'round trip',
          lastUpdatedAt: 200,
          searchSettings: { time: 'week', features: ['subtitles'] }
        }
      ])
      window.__searchHistoryExport = null
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => ({
          createWritable: async () => ({
            write: async (content) => { window.__searchHistoryExport = content },
            close: async () => {}
          })
        })
      })
    })

    await dataSection.getByRole('button', { name: 'Export search history', exact: true }).click()
    await page.getByRole('button', { name: 'Export YouTube (.json)', exact: true }).click()

    await expect.poll(() => page.evaluate(() => window.__searchHistoryExport)).not.toBeNull()
    expect(await page.evaluate(() => JSON.parse(window.__searchHistoryExport)
      .map(({ searchSettings }) => searchSettings))).toEqual([
      {
        prioritize: 'relevance',
        time: 'today',
        type: 'all',
        duration: '',
        features: ['4k', 'hd']
      },
      {
        prioritize: 'relevance',
        time: 'week',
        type: 'all',
        duration: '',
        features: ['subtitles']
      }
    ])

    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('removeAllSearchHistoryEntries')
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [{
          getFile: async () => new File(
            [window.__searchHistoryExport],
            'youtube-search-history.json',
            { type: 'application/json' }
          )
        }]
      })
    })

    await dataSection.getByRole('button', { name: 'Import search history', exact: true }).click()

    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getSearchHistoryEntries
        .filter(({ query }) => query === 'round trip')
        .map(({ searchSettings }) => ({
          time: searchSettings.time,
          features: searchSettings.features
        }))
        .sort((a, b) => a.time.localeCompare(b.time))
    })).toEqual([
      { time: 'today', features: ['4k', 'hd'] },
      { time: 'week', features: ['subtitles'] }
    ])
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
      const contents = readDatastore(app.userDataDir, 'search-history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.some(record => record._id === 'android tutorial')
    }).toBe(false)

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

  test('a pasted video link is saved with its title, found by it, and opens the video again, unless history is cleared or off', async ({ app, page }) => {
    const videoId = 'jNQXAC9IVRw'
    await mockPlayableWatchPage(app, page)
    const player = demoPlayerResponse(videoId)
    await page.route('**/youtubei/v1/player**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...player, videoDetails: { ...player.videoDetails, title: 'Linked Video Title', author: 'Linked Channel' } }),
    }))
    const linkEntries = () => page.evaluate(() => window.$store.getters.getSearchHistoryEntries
      .filter(entry => entry.linkType != null)
      .map(({ query, linkType, title }) => ({ query, linkType, title })))
    const input = page.locator(sel.searchInput)

    // Without search suggestions no preview loads, so the title is loaded after submitting.
    await input.fill(`https://youtu.be/${videoId}`)
    await input.press('Enter')
    await expect(page).toHaveURL(new RegExp(`#/watch/${videoId}`))
    await expect.poll(linkEntries).toEqual([
      { query: `https://youtu.be/${videoId}`, linkType: 'video', title: 'Linked Video Title' },
    ])
    await expect.poll(() => readDatastore(app.userDataDir, 'search-history')).toContain('"title":"Linked Video Title"')

    await page.locator(sel.backButton).click()
    await expect(page).not.toHaveURL(/#\/watch\//)
    await input.fill('linked vi')
    const link = suggestions(page).getByRole('link', { name: /Linked Video Title/ })
    await expect(link).toHaveText('Linked Video Title')
    await expect(suggestions(page)).toHaveCount(1)
    const searchType = () => page.evaluate(() => {
      const store = window.$store
      return store.getters.getSearchSettings(store.getters.getPresentedTabId ?? 'web').type
    })
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setSearchType', { tabId: store.getters.getPresentedTabId ?? 'web', value: 'video' })
    })
    await link.click()
    await expect(page).toHaveURL(new RegExp(`#/watch/${videoId}`))
    // A link entry leaves the search filters alone.
    expect(await searchType()).toBe('video')

    // Clearing the history while a title loads drops the save.
    const otherVideoId = 'dQw4w9WgXcQ'
    let releaseTitle
    const titleHeld = new Promise(resolve => { releaseTitle = resolve })
    let heldRequests = 0
    let answeredRequests = 0
    await page.route('**/youtubei/v1/player**', async route => {
      heldRequests++
      await titleHeld
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ...player, videoDetails: { ...player.videoDetails, videoId: otherVideoId, title: 'Cleared Video Title' } }),
      })
      answeredRequests++
    })
    await input.fill(`https://youtu.be/${otherVideoId}`)
    await input.press('Enter')
    await expect.poll(() => heldRequests).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.$store.dispatch('removeAllSearchHistoryEntries'))).toBe(true)
    releaseTitle()
    await expect(page).toHaveURL(new RegExp(`#/watch/${otherVideoId}`))
    await expect.poll(() => answeredRequests).toBe(heldRequests)
    // Saves are written in order, so once a later search is saved, a dropped link save would have been too.
    await input.fill('after clearing')
    await input.press('Enter')
    await expect.poll(() => readDatastore(app.userDataDir, 'search-history')).toContain('"query":"after clearing"')
    expect(await linkEntries()).toEqual([])
    expect(await readDatastore(app.userDataDir, 'search-history')).not.toContain('Cleared Video Title')

    await page.evaluate(() => window.$store.dispatch('updateRememberSearchHistory', false))
    await input.fill(`https://www.youtube.com/watch?v=${videoId}`)
    await input.press('Enter')
    await expect(page).toHaveURL(new RegExp(`#/watch/${videoId}`))
    // The setting is checked before the page opens.
    await expect(page.locator(`${activeTab} .videoTitle`)).toBeVisible()
    await expect.poll(() => answeredRequests).toBe(heldRequests)
    expect(await linkEntries()).toEqual([])
  })
})
