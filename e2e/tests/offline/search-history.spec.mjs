import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, sel } from '../../helpers/app.mjs'

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

  test('a search saves its active filters', async ({ app, page }) => {
    await page.locator('.navFilterButton').click()
    await page.locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
    await page.locator('.searchRadio', { hasText: 'Duration' }).getByText('3 - 20 minutes', { exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.locator(sel.searchInput).fill('daily news')
    await page.locator(sel.searchInput).press('Enter')

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'search-history.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const record = records.filter((entry) => entry._id === 'daily news').at(-1)
      return record && record.searchSettings
    }).toEqual({
      prioritize: 'relevance',
      time: 'today',
      type: 'all',
      duration: 'three_to_twenty_mins',
      features: []
    })
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
})
