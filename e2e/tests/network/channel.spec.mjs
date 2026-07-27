import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { sel } from '../../helpers/app.mjs'
import { test, expect } from '../../helpers/innertube.mjs'

// The official Blender channel.
const CHANNEL_URL = 'https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg'
const CHANNEL_ID = 'UCSMOQeBJ2RAnuFungnQOxLg'

test.describe('channel page', () => {
  test('shows channel info and videos', async ({ page }) => {
    await page.locator(sel.searchInput).fill(CHANNEL_URL)
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(/#\/channel\/UCSMOQeBJ2RAnuFungnQOxLg/)
    await expect(page.getByText('Blender').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.ft-list-video').first()).toBeVisible({ timeout: 30_000 })

    // Channel tab changes must update the route and title without creating a
    // new history entry for every tab selection (796650405, 912e5ea6e).
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    const historyLength = await page.evaluate(() => history.length)

    const channelSearch = page.locator('.channelSearch input')
    await channelSearch.fill('animation')
    await channelSearch.press('Enter')
    await expect(page).toHaveURL(/searchQueryText=animation/)
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    await expect(page.locator(sel.activeTab)).not.toContainText('/channel/')

    const searchTypeFilters = page.getByRole('group', { name: 'Search result types' })
    const allResultsFilter = searchTypeFilters.getByRole('button', { name: 'All' })
    const shortsResultsFilter = searchTypeFilters.getByRole('button', { name: 'Shorts' })
    const playlistResultsFilter = searchTypeFilters.getByRole('button', { name: 'Playlists' })
    const videoResults = page.locator('.channelSearchResults .ft-list-video:not(:has(.videoCountContainer))')
    const playlistResults = page.locator('.channelSearchResults .ft-list-video:has(.videoCountContainer)')
    await expect(allResultsFilter).toHaveAttribute('aria-pressed', 'true')
    await expect(videoResults.first()).toBeVisible()
    await expect(playlistResults.first()).toBeVisible()

    await shortsResultsFilter.click()
    await expect(shortsResultsFilter).toHaveAttribute('aria-pressed', 'true')
    await expect(videoResults.first()).toBeVisible()
    await expect(playlistResults).toHaveCount(0)

    await playlistResultsFilter.click()
    await expect(playlistResultsFilter).toHaveAttribute('aria-pressed', 'true')
    await expect(videoResults).toHaveCount(0)
    await expect(playlistResults.first()).toBeVisible()

    await page.locator('.channelSearch .clearInputTextButton').click()
    await expect(page).not.toHaveURL(/searchQueryText=/)
    await expect(page.locator(sel.activeTab)).toContainText('Blender')

    await page.locator(sel.newTabButton).click()
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    await expect(page.locator(sel.activeTab)).not.toContainText('/channel/')

    const videosTab = page.getByRole('tab', { name: 'Videos' })
    await videosTab.click()
    await expect(videosTab).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/#\/channel\/UCSMOQeBJ2RAnuFungnQOxLg\/videos/)
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    await expect(page.locator(sel.activeTab)).not.toContainText('/channel/')
    expect(await page.evaluate(() => history.length)).toBe(historyLength)

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/subscriptions/)
  })

  test('subscribing writes the channel to the profile and back out again', async ({ app, page }) => {
    await page.locator(sel.searchInput).fill(CHANNEL_URL)
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByText('Blender').first()).toBeVisible({ timeout: 30_000 })

    const readSubscriptions = async () => {
      const contents = await readFile(path.join(app.userDataDir, 'profiles.db'), 'utf8')
      const records = contents.trim().split('\n').map((line) => JSON.parse(line))
      const main = records.filter((record) => record._id === 'allChannels').at(-1)
      return main?.subscriptions?.map((channel) => channel.id) ?? []
    }

    const subscribeButton = page.locator('.ftSubscribeButton .subscribeButton').first()
    await expect(subscribeButton).toHaveText(/^\s*Subscribe/)
    await subscribeButton.click()

    await expect(subscribeButton).toHaveText(/^\s*Unsubscribe/)
    await expect.poll(readSubscriptions).toContain(CHANNEL_ID)

    // Unsubscribing is immediate (no confirmation popup by default).
    await subscribeButton.click()
    await expect(subscribeButton).toHaveText(/^\s*Subscribe/)
    await expect.poll(readSubscriptions).not.toContain(CHANNEL_ID)
  })
})
