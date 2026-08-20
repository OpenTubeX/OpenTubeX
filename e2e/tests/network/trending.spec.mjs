import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { goTo } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

const fixture = JSON.parse(gunzipSync(readFileSync(new URL(
  '../../fixtures/innertube/trending/shows-trending-videos-and-switches-categories/browse-2cd8b157f6ed.0.json.gz',
  import.meta.url
))))

const categories = {
  UCOpNcN46UbXVtpKMrmU4Abg: 'gaming',
  'UCEgdi0XIXXZ-qJOFPf4JSKw': 'sports'
}

const videoIds = {
  gaming: 'gaming00001',
  sports: 'sports00001'
}

function responseFor(category) {
  const response = structuredClone(fixture)
  const items = response.contents.twoColumnBrowseResultsRenderer.tabs[0]
    .tabRenderer.content.sectionListRenderer.contents[0]
    .itemSectionRenderer.contents[0].shelfRenderer.content.gridRenderer.items
  const renderer = items[0].gridVideoRenderer

  items.splice(1)
  renderer.videoId = videoIds[category]
  renderer.title = { runs: [{ text: `${category} request result` }] }

  return response
}

async function controlTrendingRequests(page) {
  const requests = []

  await page.route(/\/youtubei\/v1\/browse/, async route => {
    const category = categories[route.request().postDataJSON()?.browseId]
    if (!category) {
      return route.fallback()
    }

    const result = await new Promise(resolve => {
      requests.push({ category, resolve })
    })
    await route.fulfill(result)
  })

  return {
    total() {
      return requests.length
    },
    count(category) {
      return requests.filter(request => request.category === category).length
    },
    fulfill(category) {
      const request = requests.find(request => request.category === category && request.resolve)
      expect(request, `pending ${category} request`).toBeTruthy()
      request.resolve({ json: responseFor(category) })
      request.resolve = null
    },
    reject(category) {
      const request = requests.find(request => request.category === category && request.resolve)
      expect(request, `pending ${category} request`).toBeTruthy()
      request.resolve({ status: 500, json: { error: `${category} request failed` } })
      request.resolve = null
    }
  }
}

async function trendingCache(page) {
  return await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return Object.fromEntries(Object.entries(store.getters.getTrendingCache).map(([category, videos]) => [
      category,
      videos?.map(video => video.videoId) ?? null
    ]))
  })
}

async function trendingTimestamps(page) {
  return await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return Object.fromEntries(Object.entries(store.getters.getLastTrendingRefreshTimestamp)
      .map(([category, timestamp]) => [category, timestamp ? new Date(timestamp).getTime() : null]))
  })
}

test.describe('trending page', () => {
  test('shows trending videos and switches categories', async ({ page }) => {
    await goTo(page, 'trending')

    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    const sportsTab = page.getByRole('tab', { name: 'Sports' })
    await sportsTab.click()
    await expect(sportsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    const gamingTab = page.getByRole('tab', { name: 'Gaming' })
    await gamingTab.click()

    await expect(page.locator('#trendingPanel .autoGrid > .feed-enter-active').first()).toBeVisible()

    await expect(gamingTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })
  })

  test('keeps concurrent out-of-order category results with their requests', async ({ page }) => {
    const controlled = await controlTrendingRequests(page)
    const panel = page.locator('#trendingPanel')

    await goTo(page, 'trending')
    await expect.poll(() => controlled.count('gaming')).toBe(1)

    const sportsTab = page.getByRole('tab', { name: 'Sports' })
    await sportsTab.click()
    await expect.poll(() => controlled.count('sports')).toBe(1)
    expect(controlled.count('gaming')).toBe(1)
    expect(await trendingTimestamps(page)).toEqual({
      gaming: null,
      sports: null,
      podcasts: null
    })

    controlled.fulfill('gaming')
    await expect.poll(async () => {
      const cache = await trendingCache(page)
      return Object.values(cache).some(ids => ids?.includes(videoIds.gaming))
    }).toBe(true)

    expect(await trendingCache(page)).toEqual({
      gaming: [videoIds.gaming],
      sports: null,
      podcasts: null
    })
    await expect.poll(async () => (await trendingTimestamps(page)).gaming).not.toBeNull()
    expect(await trendingTimestamps(page)).toEqual({
      gaming: expect.any(Number),
      sports: null,
      podcasts: null
    })
    await expect(sportsTab).toHaveAttribute('aria-selected', 'true')
    await expect(panel.locator('[data-tab-loading-indicator]')).toBeVisible()
    await expect(panel.locator('.ft-list-video')).toHaveCount(0)

    controlled.fulfill('sports')
    await expect.poll(async () => (await trendingCache(page)).sports).toEqual([videoIds.sports])
    expect(await trendingCache(page)).toEqual({
      gaming: [videoIds.gaming],
      sports: [videoIds.sports],
      podcasts: null
    })
    expect(await trendingTimestamps(page)).toEqual({
      gaming: expect.any(Number),
      sports: expect.any(Number),
      podcasts: null
    })
    await expect(panel.locator('.ft-list-video')).toContainText('sports request result')

    const gamingTab = page.getByRole('tab', { name: 'Gaming' })
    await gamingTab.click()
    await expect(panel.locator('.ft-list-video')).toContainText('gaming request result')
    expect(controlled.count('gaming')).toBe(1)
  })

  test('a failed hidden category request does not finish the active category request', async ({ page }) => {
    const controlled = await controlTrendingRequests(page)
    const panel = page.locator('#trendingPanel')

    await goTo(page, 'trending')
    await expect.poll(() => controlled.count('gaming')).toBe(1)

    const sportsTab = page.getByRole('tab', { name: 'Sports' })
    await sportsTab.click()
    await expect.poll(() => controlled.count('sports')).toBe(1)

    const failedResponse = page.waitForResponse(response => (
      response.url().includes('/youtubei/v1/browse') && response.status() === 500
    ))
    controlled.reject('gaming')
    await (await failedResponse).finished()
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))

    await expect(page.locator('.toast', { hasText: 'Local API Error' })).toHaveCount(0)
    await expect(sportsTab).toHaveAttribute('aria-selected', 'true')
    await expect(panel.locator('[data-tab-loading-indicator]')).toBeVisible()
    expect(await trendingCache(page)).toEqual({
      gaming: null,
      sports: null,
      podcasts: null
    })

    controlled.fulfill('sports')
    await expect(panel.locator('.ft-list-video')).toContainText('sports request result')
    expect(await trendingCache(page)).toEqual({
      gaming: null,
      sports: [videoIds.sports],
      podcasts: null
    })

    const gamingTab = page.getByRole('tab', { name: 'Gaming' })
    await gamingTab.click()
    await expect(panel.getByRole('status')).toContainText('Trending could not be loaded')
    expect(controlled.count('gaming')).toBe(1)
  })

  test.describe('without a supported backend', () => {
    test.use({
      seed: {
        settings: {
          backendPreference: 'invidious',
          backendFallback: true
        }
      }
    })

    test('shows the unsupported state without recording a successful refresh', async ({ page }) => {
      const controlled = await controlTrendingRequests(page)

      await page.locator('a[href="#/trending"]').evaluate(link => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setBackendFallback', false)
        link.click()
      })
      await expect(page).toHaveURL(/#\/trending/)

      expect(controlled.total()).toBe(0)
      expect(await trendingTimestamps(page)).toEqual({
        gaming: null,
        sports: null,
        podcasts: null
      })
      await expect(page.locator('#trendingPanel [role="status"]')).toContainText(
        'Trending requires the Local API'
      )
    })
  })
})
