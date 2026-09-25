import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { sel } from '../../helpers/app.mjs'
import { test, expect, fixtureKey } from '../../helpers/innertube.mjs'

// The official Blender channel.
const CHANNEL_URL = 'https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg'
const CHANNEL_ID = 'UCSMOQeBJ2RAnuFungnQOxLg'

test.describe('channel page', () => {
  test.use({ seed: { settings: { uiRoundness: 200, externalPlayer: 'mpv' } } })

  test('shows channel info and videos', async ({ page }) => {
    let releaseVideos
    const heldVideos = new Promise(resolve => { releaseVideos = resolve })
    let videosRequested = false
    const keyFor = request => fixtureKey(request.url(), request.postData())

    await page.route(/\/youtubei\/v1\/browse/, async route => {
      if (keyFor(route.request()) !== 'browse-43cf009333cb') {
        return route.fallback()
      }

      videosRequested = true
      await heldVideos
      return route.fallback()
    })

    await page.locator(sel.searchInput).fill(CHANNEL_URL)
    await page.locator(sel.searchInput).press('Enter')

    await expect(page).toHaveURL(/#\/channel\/UCSMOQeBJ2RAnuFungnQOxLg/)
    await expect(page.getByText('Blender').first()).toBeVisible({ timeout: 30_000 })
    try {
      await expect.poll(() => videosRequested).toBe(true)
      await page.getByRole('tab', { name: 'Shorts' }).click()
      await expect(page.locator('#shortPanel .ft-list-video').first()).toBeVisible()
      await page.getByRole('tab', { name: 'Videos' }).click()
      await expect(page.locator('.elementList')).toHaveCount(0)
      await expect(page.locator('[data-tab-loading-indicator]:not(.fullscreen)')).toBeVisible()
      await expect(page.getByText('This channel does not currently have any videos')).toHaveCount(0)
    } finally {
      releaseVideos()
    }
    await expect(page.locator('#videoPanel .ft-list-video').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('body')).toHaveCSS('--ui-roundness', '2')
    await expect(page.locator('.channelDetails .bannerContainer')).toHaveCSS('border-top-left-radius', '16px')
    await expect(page.locator('.channelDetails .bannerContainer')).toHaveCSS('border-top-right-radius', '16px')
    await expect(page.locator('.channelDetails .infoContainer')).toHaveCSS('border-bottom-left-radius', '16px')
    await expect(page.locator('.channelDetails .infoContainer')).toHaveCSS('border-bottom-right-radius', '16px')

    await page.locator('body').evaluate(element => {
      element.style.fontFamily = 'Arial, sans-serif'
    })

    const aboutTab = page.getByRole('tab', { name: 'About' })
    await expect(aboutTab).toHaveAttribute('aria-selected', 'false')
    const widthBeforeHover = (await aboutTab.boundingBox()).width
    await aboutTab.hover()
    expect((await aboutTab.boundingBox()).width).toBe(widthBeforeHover)

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

    await expect(page.locator('.channelSearch input')).toHaveAttribute('type', 'search')
    await page.locator('.channelSearch input').fill('')
    await expect(page).not.toHaveURL(/searchQueryText=/)
    await expect(page.locator(sel.activeTab)).toContainText('Blender')

    await page.locator(sel.newTabButton).click()
    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.activeTab)).toContainText('Blender')
    await expect(page.locator(sel.activeTab)).not.toContainText('/channel/')

    const selectedChannelTab = page.locator('.channelDetails [role="tab"][aria-selected="true"]')
    const initialChannelTabId = await selectedChannelTab.getAttribute('id')

    const subscribeButton = page.locator('.ftSubscribeButton .subscribeButton').first()
    await subscribeButton.focus()
    await subscribeButton.press('ArrowRight')
    await expect(selectedChannelTab).toHaveAttribute('id', initialChannelTabId)
    await subscribeButton.evaluate((button) => button.blur())

    await page.keyboard.press('ArrowRight')
    await expect(selectedChannelTab).not.toHaveAttribute('id', initialChannelTabId)
    await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
    await page.keyboard.press('ArrowLeft')
    await expect(selectedChannelTab).toHaveAttribute('id', initialChannelTabId)
    await page.keyboard.press('ArrowLeft')
    await expect(selectedChannelTab).toHaveAttribute('id', 'aboutTab')
    const aboutPanel = page.locator('#aboutPanel')
    await expect(aboutPanel).toHaveAttribute('role', 'tabpanel')

    const sourceTabId = await page.locator(sel.activeTab).getAttribute('data-tab-id')
    const tagLink = aboutPanel.locator('.aboutTagLink').first()
    await expect(tagLink).toBeVisible()
    const tagName = (await tagLink.textContent()).trim()
    await tagLink.click({ button: 'middle' })

    await expect(page.locator(sel.tabs)).toHaveCount(3)
    await expect(page.locator(sel.activeTab)).toHaveAttribute('data-tab-id', sourceTabId)
    await expect(page).toHaveURL(/\/about$/)
    await expect.poll(() => page.evaluate(async () => {
      const state = await window.ftElectron.tabs.getState()
      return state.tabs.find(tab => tab.route.path.startsWith('/search/'))?.id
    })).toBeTruthy()
    const tagTabId = await page.evaluate(async () => {
      const state = await window.ftElectron.tabs.getState()
      return state.tabs.find(tab => tab.route.path.startsWith('/search/')).id
    })
    await expect(page.locator(`.tab[data-tab-id="${tagTabId}"]`)).toContainText(tagName)
    await page.evaluate(id => window.ftElectron.tabs.close(id), tagTabId)
    await expect(page.locator(sel.tabs)).toHaveCount(2)

    await aboutPanel.dispatchEvent('keydown', { key: 'ArrowRight', bubbles: true })
    await expect(selectedChannelTab).toHaveAttribute('id', initialChannelTabId)

    const channelTabIds = await page.locator('.channelDetails [role="tab"]').evaluateAll((tabs) => (
      tabs.map((tab) => tab.id)
    ))
    const initialChannelTabIndex = channelTabIds.indexOf(initialChannelTabId)
    const rapidArrowTabId = channelTabIds[(initialChannelTabIndex + 3) % channelTabIds.length]
    await page.evaluate(() => {
      for (let index = 0; index < 3; index++) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true
        }))
      }
    })
    await expect(selectedChannelTab).toHaveAttribute('id', rapidArrowTabId)
    await expect(page).toHaveURL(new RegExp(`/${rapidArrowTabId.replace('Tab', '')}$`))
    await expect(page.locator('[data-tab-loading-indicator].fullscreen')).toHaveCount(0)
    await page.locator(`#${initialChannelTabId}`).click()
    await expect(selectedChannelTab).toHaveAttribute('id', initialChannelTabId)

    await page.locator(sel.tabs).nth(1).click()
    const subscriptionVideosTab = page.locator('[data-subscription-feed-tab="videos"]')
    const subscriptionShortsTab = page.locator('[data-subscription-feed-tab="shorts"]')
    const subscriptionTabs = page.locator('.subscriptionsHeader [role="tab"]')
    await expect(subscriptionVideosTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(subscriptionShortsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.app')).toHaveClass(/hideOutlines/)
    await page.keyboard.press('ArrowLeft')
    await expect(subscriptionVideosTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(subscriptionTabs.last()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(subscriptionVideosTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Alt+ArrowRight')
    await expect(subscriptionVideosTab).toHaveAttribute('aria-selected', 'true')

    await page.locator(sel.tabs).first().click()
    await expect(page.locator(sel.activeTab)).toContainText('Blender')

    const channelSearchInput = page.locator('.channelSearch input')
    await channelSearchInput.focus()
    await channelSearchInput.press('ArrowRight')
    await expect(selectedChannelTab).toHaveAttribute('id', initialChannelTabId)

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

test.describe('channel route changes', () => {
  test.use({ seed: { settings: { backendPreference: 'invidious', backendFallback: false } } })

  test('keeps the latest sort loading when an older videos request finishes', async ({ page }) => {
    const releaseRequests = new Map()
    let newestRequests = 0

    await page.route(/^https:\/\/invidious\.test\/api\/v1\/channels\//, async route => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/videos')) {
        const sort = url.searchParams.get('sort_by')
        if (sort === 'newest' && newestRequests++ === 0) {
          return route.fulfill({ json: { videos: [], continuation: 'next' } })
        }
        await new Promise(resolve => { releaseRequests.set(sort, resolve) })
        return route.fulfill({ json: { videos: [] } })
      }

      return route.fulfill({
        json: {
          author: 'Alpha',
          authorId: CHANNEL_ID,
          authorThumbnails: [],
          authorBanners: [],
          subCount: 0,
          totalViews: 0,
          joined: 0,
          description: '',
          relatedChannels: [],
          isFamilyFriendly: true,
          tabs: ['videos']
        }
      })
    })
    await page.route(/^https:\/\/invidious\.test\/api\/v1\/resolveurl/, route => route.fulfill({
      json: { pageType: 'WEB_PAGE_TYPE_CHANNEL', ucid: CHANNEL_ID }
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setCurrentInvidiousInstance', 'https://invidious.test')
    })

    try {
      await page.locator(sel.searchInput).fill(CHANNEL_URL)
      await page.locator(sel.searchInput).press('Enter')
      await expect(page).toHaveURL(new RegExp(`#/channel/${CHANNEL_ID}/videos$`))
      const sort = page.locator('.select-container .nativeSelect').first()
      await expect(sort).toHaveValue('newest')
      await sort.evaluate(element => {
        element.value = 'popular'
        element.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await expect.poll(() => releaseRequests.has('popular')).toBe(true)
      await sort.evaluate(element => {
        element.value = 'newest'
        element.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await expect.poll(() => releaseRequests.has('newest')).toBe(true)

      const oldResponse = page.waitForResponse(response => response.url().includes('sort_by=popular'))
      releaseRequests.get('popular')()
      await oldResponse
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expect(page.locator('[data-tab-loading-indicator]:not(.fullscreen)')).toBeVisible()
      await expect(page.getByText('This channel does not currently have any videos')).toHaveCount(0)
    } finally {
      for (const release of releaseRequests.values()) release()
    }
  })

  for (const tab of ['videos', 'shorts']) {
    test(`keeps the new channel loading when an older ${tab} request finishes`, async ({ page }) => {
      const firstId = CHANNEL_ID
      const secondId = 'UCfMJ2MchTSW2kWaT0kK94Yw'
      const releaseVideos = new Map()
      const emptyMessage = tab === 'videos'
        ? 'This channel does not currently have any videos'
        : 'This channel does not currently have any shorts'

      await page.route(/^https:\/\/invidious\.test\/api\/v1\/channels\//, async route => {
        const parts = new URL(route.request().url()).pathname.split('/')
        const channelId = parts[4]

        if (parts[5] === tab) {
          await new Promise(resolve => { releaseVideos.set(channelId, resolve) })
          return route.fulfill({ json: { videos: [] } })
        }
        if (parts[5] === 'videos') return route.fulfill({ json: { videos: [] } })

        return route.fulfill({
          json: {
            author: channelId === firstId ? 'Alpha' : 'Beta',
            authorId: channelId,
            authorThumbnails: [],
            authorBanners: [],
            subCount: 0,
            totalViews: 0,
            joined: 0,
            description: '',
            relatedChannels: [],
            isFamilyFriendly: true,
            tabs: ['videos', 'shorts']
          }
        })
      })
      await page.route(/^https:\/\/invidious\.test\/api\/v1\/resolveurl/, route => route.fulfill({
        json: {
          pageType: 'WEB_PAGE_TYPE_CHANNEL',
          ucid: route.request().url().includes(secondId) ? secondId : firstId
        }
      }))

      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setCurrentInvidiousInstance', 'https://invidious.test')
      })

      try {
        await page.locator(sel.searchInput).fill(CHANNEL_URL)
        await page.locator(sel.searchInput).press('Enter')
        await expect(page).toHaveURL(/#\/channel\//)
        if (tab === 'shorts') await page.getByRole('tab', { name: 'Shorts' }).click()
        await expect.poll(() => releaseVideos.has(firstId)).toBe(true)
        await expect(page).toHaveURL(new RegExp(`#/channel/${firstId}/${tab}$`))
        await expect(page.getByText('Alpha').first()).toBeVisible()

        await page.locator(sel.searchInput).fill(`https://www.youtube.com/channel/${secondId}`)
        await page.locator(sel.searchInput).press('Enter')
        await expect(page).toHaveURL(new RegExp(`#/channel/${secondId}`))
        if (tab === 'shorts') await page.getByRole('tab', { name: 'Shorts' }).click()
        await expect.poll(() => releaseVideos.has(secondId)).toBe(true)
        await expect(page.getByText('Beta').first()).toBeVisible()
        await expect(page.locator('[data-tab-loading-indicator]:not(.fullscreen)')).toBeVisible()

        const oldResponse = page.waitForResponse(response => response.url().includes(`/channels/${firstId}/${tab}`))
        releaseVideos.get(firstId)()
        await oldResponse
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

        await expect(page.locator('[data-tab-loading-indicator]:not(.fullscreen)')).toBeVisible()
        await expect(page.getByText(emptyMessage)).toHaveCount(0)
      } finally {
        for (const release of releaseVideos.values()) release()
      }

      await expect(page.getByText(emptyMessage)).toBeVisible()
    })
  }
})
