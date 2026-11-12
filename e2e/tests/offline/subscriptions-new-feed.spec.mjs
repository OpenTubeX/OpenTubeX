import { defaultThemeClass, test, expect, goTo } from '../../helpers/app.mjs'
import { expectTabHighlightAligned, expectTabHighlightStyle } from '../../helpers/tabs.mjs'
import { captureAppFramebuffer } from '../../helpers/screenshots.mjs'
import { encryptSyncDocument, decryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

const now = Date.now()
const HOUR = 3600000
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const AUTHOR_THUMBNAIL = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="55" height="55"/>'

function video (videoId, title, published, extra = {}) {
  return {
    videoId,
    title,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    published,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video',
    ...extra
  }
}

function post (postId, text, publishedTime) {
  return {
    postId,
    postText: text,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorThumbnails: [{ url: AUTHOR_THUMBNAIL, width: 55, height: 55 }],
    publishedTime,
    voteCount: 1,
    commentCount: 0,
    postContent: { type: 'text', content: '' },
    type: 'community',
    isNewInSubscriptionFeed: true
  }
}

function profile (subscriptions = [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]) {
  return {
    _id: 'allChannels',
    name: 'All Channels',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    subscriptions
  }
}

const newVideo = video('new-video-1', 'New video', now - HOUR, { isNewInSubscriptionFeed: true })
const watchedVideo = video('watched-new', 'Watched new video', now - 2 * HOUR, { isNewInSubscriptionFeed: false })
const oldVideo = video('not-new', 'Previously seen video', now - 3 * HOUR, { isNewInSubscriptionFeed: false })
const newShort = video('new-short-1', 'New short', now - 30 * 60000, {
  isNewInSubscriptionFeed: true,
  thumbnailUrl: 'https://i.ytimg.com/vi/new-short-1/hq720_2.jpg?sqp=selected&rs=signature'
})
const newLive = video('new-live-1', 'New live stream', now - 15 * 60000, {
  isNewInSubscriptionFeed: true,
  liveNow: true
})

const populatedCache = [{
  _id: CHANNEL_ID,
  videos: [newVideo, watchedVideo, oldVideo],
  videosTimestamp: new Date(now - HOUR).toISOString(),
  shorts: [newShort],
  shortsTimestamp: new Date(now - HOUR).toISOString(),
  liveStreams: [newVideo, newLive],
  liveStreamsTimestamp: new Date(now - HOUR).toISOString(),
  communityPosts: [post('new-post-1', 'New community post', now - 45 * 60000)],
  communityPostsTimestamp: new Date(now - HOUR).toISOString()
}]

const watchedHistory = [{
  _id: watchedVideo.videoId,
  ...watchedVideo,
  description: '',
  watchProgress: watchedVideo.lengthSeconds,
  timeWatched: now,
  isWatched: true,
  isLive: false
}]

const commonSettings = {
  fetchSubscriptionsAutomatically: false,
  hideSubscriptionsVideos: false,
  hideSubscriptionsShorts: false,
  hideSubscriptionsLive: false,
  hideSubscriptionsCommunity: false,
  showNewSubscriptionFeed: true,
  useRssFeeds: false
}

async function holdSeenMarks(page) {
  // Hold persistence pending, then run the real seen-mark action on release.
  await page.evaluate(() => {
    const store = window.$store
    const dispatch = store.dispatch
    store.dispatch = async function (type, ...args) {
      if (type === 'markSubscriptionEntriesAsSeen') {
        store.dispatch = dispatch
        await new Promise(resolve => { window.__finishSavingSeenMarks = resolve })
      }
      const result = await dispatch.call(this, type, ...args)
      if (type === 'markSubscriptionEntriesAsSeen') window.__seenMarksSaved = true
      return result
    }
  })
}

test.describe('New feed refresh while saving seen marks', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        useRssFeeds: true,
        hideSubscriptionsShorts: true,
        hideSubscriptionsLive: true,
        hideSubscriptionsCommunity: true
      },
      profiles: [profile()],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        videos: [newVideo],
        videosTimestamp: new Date(now).toISOString()
      }]
    }
  })

  test('keeps failed channels and the refresh shortcut while saving seen marks', async ({ page }, testInfo) => {
    let feedRequests = 0
    await page.route('**/feeds/videos.xml?*', route => {
      feedRequests++
      return route.fulfill({ status: 500, body: 'Failed' })
    })
    // A failed feed falls back to the channel's videos tab, which reports the channel as gone.
    await page.route('**/youtubei/v1/browse?*', route => route.fulfill({
      json: { alerts: [{ alertRenderer: { type: 'ERROR', text: { simpleText: 'This channel does not exist.' } } }] }
    }))
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: /Refresh New content/ }).click()
    const errorBox = page.locator('.channelErrors.hasErrors')
    await expect(errorBox).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeEnabled()

    await holdSeenMarks(page)
    try {
      await page.getByRole('button', { name: 'Mark all as seen' }).click()
      await expect.poll(() => page.evaluate(() => !!window.__finishSavingSeenMarks)).toBe(true)
      await expect(page.getByText('There is no new content.', { exact: true })).toBeVisible()
      await expect.soft(errorBox).toBeVisible({ timeout: 1000 })
      await expect.soft(page.locator('.newFeed').getByRole('link', { name: 'Channel A', exact: true })).toBeVisible({ timeout: 1000 })
      await page.locator('.card').filter({ has: page.locator('.newFeed') }).screenshot({
        path: testInfo.outputPath('failed-channels-during-save.png')
      })

      const requestsBeforeShortcut = feedRequests
      await page.keyboard.press('r')
      await expect.poll(() => feedRequests).toBeGreaterThan(requestsBeforeShortcut)
    } finally {
      await page.evaluate(() => window.__finishSavingSeenMarks?.())
    }
    await expect(page.getByText('There is no new content.', { exact: true })).toBeVisible()
  })
})

test.describe('Reactive subscription title filtering', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        forbiddenTitles: JSON.stringify(['Blocked']),
        newSubscriptionFeedView: 'tabbed',
        generalAutoLoadMorePaginatedItemsEnabled: false
      },
      profiles: [profile()],
      subscriptionCache: populatedCache.map(channel => ({
        ...channel,
        shorts: [newShort, ...Array.from({ length: 100 }, (_, index) => ({
          ...newShort,
          videoId: `filter-short-${index + 1}`,
          title: `Filter short ${index + 1}`,
          published: newShort.published - (index + 1) * HOUR
        }))]
      }))
    }
  })

  for (const feed of ['Shorts', 'New']) {
    test(`removes and restores ${feed} entries after channel-page title updates`, async ({ page }) => {
      await goTo(page, 'subscriptions')
      if (feed === 'New') {
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await page.locator('[data-new-feed-tab="shorts"]').click()
        // Freeze the New selection as during an ongoing subscription refresh.
        await page.evaluate(() => {
          const store = window.$store
          store.commit('setSubscriptionFeedRefreshInProgress', true)
        })
      } else {
        await page.locator('[data-subscription-feed-tab="shorts"]').click()
      }
      const entries = page.locator('#subscriptionsPanel [data-feed-item-key]')
      await expect(page.getByText('New short', { exact: true })).toBeVisible()
      await expect(entries).toHaveCount(100)
      for (const title of ['Blocked updated short', 'Allowed updated short']) {
        await page.evaluate(({ channelId, title }) => {
          const store = window.$store
          const entry = store.state.subscriptionCache.shortsCache[channelId].videos[0]
          store.commit('updateShortsCacheWithChannelPageShorts', {
            channelId, entries: [{ ...entry, title }]
          })
        }, { channelId: CHANNEL_ID, title })
        // Parent filtering must refill the page, not just hide the blocked card.
        await expect(entries).toHaveCount(100)
        await expect(page.locator('#subscriptionsPanel [data-video-id="filter-short-100"]'))
          .toHaveCount(title.startsWith('Blocked') ? 1 : 0)
      }
      await expect(page.getByText('Allowed updated short', { exact: true })).toBeVisible()
    })
  }
})

test.describe('new subscriptions feed', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'grid',
        showNewSubscriptionFeedIndicators: true,
        thumbnailSize: 180
      },
      profiles: [profile()],
      history: watchedHistory,
      subscriptionCache: populatedCache
    }
  })

  test('groups new content by feed category', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shorts', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(1)
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await page.locator('.mediaSection').last().scrollIntoViewIfNeeded()
    await expect(page.getByText('New live stream', { exact: true })).toBeVisible()
    await page.locator('.postsSection').scrollIntoViewIfNeeded()
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()
    await expect(page.getByText('Watched new video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Previously seen video', { exact: true })).toHaveCount(0)

    await expect(page.locator('.ft-list-video').filter({ hasText: 'New video' })).toHaveClass(/grid/)
    await expect(page.locator('.ft-list-video').filter({ hasText: 'New short' })).toHaveClass(/youtubeShort/)
    await expect(page.locator('.ft-list-video').filter({ hasText: 'New live stream' })).not.toHaveClass(/youtubeShort/)
    await expect(page.locator('.ft-list-post').filter({ hasText: 'New community post' })).toHaveClass(/list/)
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.locator('.headerRefreshWidget .lastRefreshTimestamp')).toHaveCount(0)
  })

  test('moves between tiles with the arrow keys and marks the focused tile with M', async ({ page }) => {
    const titleLink = ({ videoId }) => page.locator(`a.title[href$="/watch/${videoId}"]`)
    const newVideoCard = page.locator('.ft-list-video').filter({ has: titleLink(newVideo) })

    await goTo(page, 'subscriptions')
    await titleLink(newVideo).focus()
    await page.keyboard.press('ArrowRight')
    await expect(titleLink(watchedVideo)).toBeFocused()
    // Subscriptions switches tabs with left and right, but not while a tile takes them.
    await page.keyboard.press('ArrowLeft')
    await expect(titleLink(newVideo)).toBeFocused()

    await expect(newVideoCard.locator('.newContentDot')).toBeVisible()
    await page.keyboard.press('m')
    await expect(newVideoCard.locator('.newContentDot')).toHaveCount(0)
    await expect(newVideoCard).not.toHaveClass(/watched/)
    // Once seen, the shortcut toggles watched instead.
    await page.keyboard.press('m')
    await expect(newVideoCard).toHaveClass(/watched/)
    await expect(titleLink(newVideo)).toBeFocused()

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(titleLink(newVideo)).toHaveCount(0)
    await titleLink(newShort).focus()
    await page.keyboard.press('m')
    // The Shorts category closes with its last tile, so focus moves on to Live.
    await expect(titleLink(newShort)).toHaveCount(0)
    await expect(titleLink(newLive)).toBeFocused()
  })

  async function expectCompactNewFeedTabs(app, page, testInfo, uiScale) {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    // The view switches once its setting saves.
    await expect(page.getByRole('tablist', { name: 'New content tabs' })).toBeVisible()

    const tabs = page.locator('[data-new-feed-tab]')
    await expect(tabs).toHaveCount(4)

    for (const width of [640, 500, 375, 340, 640]) {
      await app.electronApp.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 })
      }, width)
      await page.waitForFunction(({ width, uiScale }) => {
        return Math.abs(window.innerWidth - width * 100 / uiScale) <= 2
      }, { width, uiScale })
      // The predicate runs in the frame that first sees the new width, before
      // that frame's resize observers re-measure the single-row header. Wait
      // for the next frame so measurements see the layout that was painted.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

      await expect.poll(() => tabs.evaluateAll(elements => {
        const tops = elements.map(element => element.getBoundingClientRect().top)
        return Math.max(...tops) - Math.min(...tops)
      })).toBeLessThan(1)

      const layout = await page.locator('.newFeedTabs').evaluate(element => ({
        container: element.getBoundingClientRect(),
        viewportWidth: document.documentElement.clientWidth,
        tabs: [...element.querySelectorAll('[data-new-feed-tab]')]
          .map(tab => tab.getBoundingClientRect())
      }))
      // Electron's fractional zoom can round a 44px button just below 44.
      expect(Math.min(...layout.tabs.map(tab => tab.height))).toBeGreaterThan(43.5)
      expect(layout.tabs.every(tab => tab.width >= 24)).toBe(true)
      expect(layout.tabs.every(tab => tab.left >= layout.container.left - 1 && tab.right <= layout.container.right + 1)).toBe(true)
      expect(layout.container.left).toBeGreaterThanOrEqual(-1)
      expect(layout.container.right).toBeLessThanOrEqual(layout.viewportWidth + 1)

      // Both rows keep their icons in roomy layouts and restore them when
      // growing back from a narrow phone layout. Icons hide at CSS widths
      // of 480px and below.
      const hasRoomForIcons = width * 100 / uiScale > 480
      for (const row of ['.tabs', '.newFeedTabs']) {
        for (const icon of await page.locator(`${row} .subscriptionIcon`).all()) {
          if (hasRoomForIcons) {
            await expect(icon).toBeVisible()
          } else {
            await expect(icon).toBeHidden()
          }
        }
        if (hasRoomForIcons) {
          const labelsFit = await page.locator(`${row} .tabLabel > span`).evaluateAll(labels => {
            return labels.every(label => label.scrollWidth <= label.clientWidth + 1)
          })
          expect(labelsFit).toBe(true)
        }
      }

      if (width === 375) {
        const path = testInfo.outputPath('compact-new-feed-tabs.png')
        await page.locator('.subscriptionsHeader').screenshot({ path })
        await testInfo.attach('compact New feed tabs', { path, contentType: 'image/png' })
      }
    }

    // Exercise the long German label from the reported layout without
    // depending on translation-service responses.
    const postsTab = page.locator('[data-new-feed-tab="posts"]')
    const label = postsTab.locator('.tabLabel')
    await label.evaluate(element => {
      element.dataset.label = 'Sehr lange übersetzte Beiträge'
      element.querySelector('span').textContent = element.dataset.label
    })
    const labelLayout = await label.evaluate(element => {
      const text = element.querySelector('span')
      return {
        right: element.getBoundingClientRect().right,
        tabRight: element.closest('[data-new-feed-tab]').getBoundingClientRect().right,
        width: text.clientWidth,
        fullWidth: text.scrollWidth
      }
    })
    expect(labelLayout.right).toBeLessThanOrEqual(labelLayout.tabRight)
    expect(labelLayout.fullWidth).toBeGreaterThan(labelLayout.width)

    await page.locator('[data-new-feed-tab="videos"]').focus()
    await page.locator('[data-new-feed-tab="videos"]').press('End')
    await expect(postsTab).toBeFocused()
    await expect(postsTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()
    await expectTabHighlightAligned(postsTab)
  }

  test('keeps New feed tabs on one compact row at phone widths', { tag: '@scale' }, async ({ app, page, uiScale }, testInfo) => {
    await expectCompactNewFeedTabs(app, page, testInfo, uiScale)
  })

  test('wraps long New feed category labels without clipping desktop tabs', async ({ app, page }, testInfo) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    const tabs = page.getByRole('tablist', { name: 'New content tabs' })
    const translations = ['Neue Videos', 'YouTube Shorts', 'Neue Livestreams', 'Neue Community-Beiträge der abonnierten Kanäle']
    // Translate through vue-i18n so re-renders, such as new content badges
    // arriving, keep the long labels.
    await page.evaluate(([videos, shorts, live, posts]) => {
      const app = document.querySelector('#app').__vue_app__
      const i18n = app._context.provides[app.__VUE_I18N_SYMBOL__].global
      i18n.mergeLocaleMessage(i18n.locale.value, { Global: { Videos: videos, Shorts: shorts, Live: live, Posts: posts } })
    }, translations)
    await expect(tabs.locator('.tabLabel > span')).toHaveText(translations)
    for (const scale of [95, 125]) {
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].setSize(Math.round(700 * scale / 100), 900), scale)
      await page.evaluate(value => window.$store.dispatch('updateUiScale', value), scale)
      // Reproduce the old single-row clipping before checking the responsive layout.
      await tabs.evaluate(element => { element.style.flexWrap = 'nowrap' })
      await expect.poll(() => tabs.evaluate(element => {
        const box = element.getBoundingClientRect()
        return [...element.querySelectorAll('[role="tab"]')].some(button => {
          const tab = button.getBoundingClientRect()
          return tab.left < box.left - 1 || tab.right > box.right + 1
        })
      })).toBe(true)
      await tabs.evaluate(element => { element.style.removeProperty('flex-wrap') })
      await expect.poll(() => tabs.evaluate(element => {
        const box = element.getBoundingClientRect()
        const buttons = [...element.querySelectorAll('[role="tab"]')]
        return buttons.every(button => {
          const tab = button.getBoundingClientRect()
          const label = button.querySelector('.tabLabel > span')
          return tab.left >= box.left - 1 && tab.right <= box.right + 1 &&
            tab.bottom <= box.bottom + 1 && label.scrollWidth <= label.clientWidth + 1
        })
      })).toBe(true)
      await expect.poll(() => tabs.locator('[role="tab"]').evaluateAll(buttons =>
        new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size
      )).toBeGreaterThan(1)
      await tabs.locator('[data-new-feed-tab="videos"]').focus()
      await page.keyboard.press('End')
      const posts = tabs.locator('[data-new-feed-tab="posts"]')
      await expect(posts).toBeFocused()
      await expect(posts).toHaveAttribute('aria-selected', 'true')
      await expectTabHighlightAligned(posts)
      if (scale === 95) {
        for (const colorScheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme })
          await expect(page.locator('body')).toHaveClass(defaultThemeClass(colorScheme))
          await captureAppFramebuffer(app, testInfo, `desktop-new-feed-tabs-${colorScheme}`)
        }
      }
    }
  })

  test('switches between the combined and tabbed views and remembers the choice', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const showTabbedView = page.getByRole('button', { name: 'Show tabbed view' })
    await expect(showTabbedView).toHaveAttribute('aria-pressed', 'false')
    await expect(showTabbedView.locator('[data-icon="horizontal-tabs"]')).toBeVisible()
    await showTabbedView.click()

    const newContentTabs = page.getByRole('tablist', { name: 'New content tabs' })
    const selectedTab = newContentTabs.locator('[aria-selected="true"]')
    await expect(newContentTabs).toBeVisible()
    await expectTabHighlightAligned(selectedTab)
    await expect(page.getByRole('button', { name: 'Show combined view' })).toHaveAttribute('aria-pressed', 'true')
    await expect(newContentTabs.locator('[data-new-feed-tab="videos"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)

    const centerDifference = await page.evaluate(() => {
      const header = document.querySelector('.subscriptionsHeader').getBoundingClientRect()
      const tabs = [...document.querySelectorAll('[data-new-feed-tab]')]
        .map(tab => tab.getBoundingClientRect())

      return Math.abs(
        (tabs[0].left + tabs.at(-1).right) / 2 -
        (header.left + header.right) / 2
      )
    })
    expect(centerDifference).toBeLessThanOrEqual(1)
    await attachScreenshot('tabbed New feed')

    const shortsTab = newContentTabs.locator('[data-new-feed-tab="shorts"]')
    await shortsTab.click()
    await expect(shortsTab).toHaveAttribute('aria-selected', 'true')
    await expectTabHighlightStyle(selectedTab, 'transitionProperty', 'opacity, scale')
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)

    await expectTabHighlightAligned(shortsTab)

    await shortsTab.focus()
    await shortsTab.press('ArrowRight')
    await expect(newContentTabs.locator('[data-new-feed-tab="live"]')).toBeFocused()
    await expect(page.getByText('New live stream', { exact: true })).toBeVisible()

    const liveTab = newContentTabs.locator('[data-new-feed-tab="live"]')
    const altArrowWasNotPrevented = await liveTab.evaluate(element => {
      return element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true
      }))
    })
    expect(altArrowWasNotPrevented).toBe(true)
    await expect(liveTab).toHaveAttribute('aria-selected', 'true')
    await expect(liveTab).toBeFocused()

    await newContentTabs.locator('[data-new-feed-tab="posts"]').click()
    await expect(page.getByText('New community post', { exact: true })).toBeVisible()

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()

    const relaunchedTabs = relaunched.page.getByRole('tablist', { name: 'New content tabs' })
    await expect(relaunchedTabs).toBeVisible()
    await expect(relaunchedTabs.locator('[data-new-feed-tab="posts"]')).toHaveAttribute('aria-selected', 'true')
    await expect(relaunched.page.getByText('New community post', { exact: true })).toBeVisible()

    await relaunched.page.getByRole('button', { name: 'Show combined view' }).click()
    await expect(relaunchedTabs).toHaveCount(0)
    await expect(relaunched.page.getByRole('heading', { name: 'Videos', exact: true })).toBeVisible()
    await expect(relaunched.page.getByRole('heading', { name: 'Shorts', exact: true })).toBeVisible()
    await expect(relaunched.page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible()
    await expect(relaunched.page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
  })

  test('marks only the active category as seen in the tabbed New feed', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    // The view switches once its setting saves.
    await expect(page.getByRole('tablist', { name: 'New content tabs' })).toBeVisible()

    await page.evaluate(() => {
      const store = window.$store
      window.__markSeenMutations = []
      window.__unsubscribeMarkSeen = store.subscribe((mutation) => {
        if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
          window.__markSeenMutations.push(mutation.payload)
        }
      })
    })

    await page.getByRole('button', { name: 'Mark all as seen' }).click()

    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
    await page.locator('[data-new-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__markSeenMutations)).toEqual([[
      {
        tab: 'videos',
        channelId: CHANNEL_ID,
        entries: [{ videoId: newVideo.videoId, isMembersOnly: false, isNewInSubscriptionFeed: false }]
      }
    ]])
  })

  test('shows category dots and marks an inactive category as seen from its context menu', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    // The view switches once its setting saves.
    await expect(page.getByRole('tablist', { name: 'New content tabs' })).toBeVisible()

    const tabs = page.getByRole('tablist', { name: 'New content tabs' })
    const videosTab = tabs.locator('[data-new-feed-tab="videos"]')
    const shortsTab = tabs.locator('[data-new-feed-tab="shorts"]')
    const liveTab = tabs.locator('[data-new-feed-tab="live"]')
    const postsTab = tabs.locator('[data-new-feed-tab="posts"]')

    await expect(videosTab.locator('.newContentDot')).toBeVisible()
    await expect(shortsTab.locator('.newContentDot')).toBeVisible()
    await expect(liveTab.locator('.newContentDot')).toBeVisible()
    await expect(postsTab.locator('.newContentDot')).toBeVisible()
    await expect(videosTab).toHaveAttribute('aria-selected', 'true')

    await shortsTab.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Context menu' })
    const markAllAsSeen = menu.getByRole('menuitem', { name: 'Mark all as seen' })
    await expect(markAllAsSeen.locator('[data-prefix="fas"][data-icon="check"]')).toBeVisible()
    await markAllAsSeen.click()

    await expect(videosTab).toHaveAttribute('aria-selected', 'true')
    await expect(shortsTab.locator('.newContentDot')).toHaveCount(0)
    await expect(videosTab.locator('.newContentDot')).toBeVisible()
    await expect(liveTab.locator('.newContentDot')).toBeVisible()
    await expect(postsTab.locator('.newContentDot')).toBeVisible()

    await shortsTab.click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await shortsTab.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Mark all as seen' })).toHaveCount(0)
  })

  test('keeps a new video and its menus open until the video is chosen', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const video = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await video.locator('.thumbnailLink').click({ button: 'right' })

    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible()
    await expect(video).toBeVisible()
    // The broken behavior removed the card after its 200 ms leave transition.
    await page.waitForTimeout(300)
    await expect(page.getByRole('menu', { name: 'Context menu' })).toBeVisible()
    await expect(video).toBeVisible()

    await page.keyboard.press('Escape')
    await video.hover()
    await video.locator('.title').click({ button: 'right' })

    await expect(page.locator('.contextMenu')).toBeVisible()
    await expect(video).toBeVisible()
  })

  test('keeps display metadata reactive in New and Shorts without copying the full cache', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await page.evaluate(channelId => {
      const store = window.$store
      const video = store.state.subscriptionCache.videoCache[channelId].videos[0]
      video.title = 'Updated new video'
      video.viewCount = 42
    }, CHANNEL_ID)
    await expect(page.getByText('Updated new video', { exact: true })).toBeVisible()
    await expect(page.locator('.ft-list-video').filter({ hasText: 'Updated new video' }).locator('.viewCount')).toContainText('42')

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toBeVisible()
    await page.evaluate(channelId => {
      const store = window.$store
      store.state.subscriptionCache.shortsCache[channelId].videos[0].title = 'Updated short'
    }, CHANNEL_ID)
    await expect(page.getByText('Updated short', { exact: true })).toBeVisible()
  })

  test('finishes rapid New category changes with normal card layout at fractional UI scale', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateUiScale', 125)
      await store.dispatch('updateNewSubscriptionFeedView', 'tabbed')
    })
    await expect(page.locator('[data-new-feed-tab="shorts"]')).toBeVisible()
    await page.evaluate(async () => {
      for (const category of ['shorts', 'videos', 'shorts', 'videos']) {
        document.querySelector(`[data-new-feed-tab="${category}"]`).click()
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    })
    await expect(page.locator('.feed-leave-active, .feed-enter-active')).toHaveCount(0)
    const card = page.locator('.newFeed .ft-list-video').filter({ hasText: 'New video' })
    await expect(card).toHaveCount(1)
    await expect(card).toBeVisible()
    expect(await card.evaluate(element => getComputedStyle(element.parentElement).position)).not.toBe('absolute')
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)
  })

  test('marks all combined New content as seen while RSS feeds are enabled', async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('updateEnableRssFeeds', true))
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.locator('[data-rss-feeds-tab]')).toBeVisible()

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await markAllAsSeen.click()
    await expect(markAllAsSeen).toHaveCount(0)
    await expect(page.getByText('There is no new content.')).toBeVisible()
  })

  test('marks watched and seen videos unseen without losing progress, including after restart', async ({ app, page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateWatchedPercentageThreshold', 0)
    })
    const alreadyNew = page.locator('.ft-list-video').filter({ has: page.getByText('New video', { exact: true }) })
    await alreadyNew.locator('.title').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Mark As Seen', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Mark As Unseen', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const watched = page.locator('.ft-list-video').filter({ hasText: 'Watched new video' })
    await expect(watched).toHaveClass(/watched/)
    await watched.locator('.title').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: /^Mark As Unseen$/ })).toBeVisible()
    await attachScreenshot('mark as unseen in subscriptions')
    await page.getByRole('menuitem', { name: 'Mark As Unseen', exact: true }).click()
    await expect(watched).not.toHaveClass(/watched/)
    await expect(watched.locator('.newContentDot')).toBeVisible()
    const readHistory = targetPage => targetPage.evaluate(() => (
      window.$store.getters.getHistoryCacheById['watched-new']
    ))
    await expect.poll(async () => (await readHistory(page)).isWatched).toBe(false)
    expect((await readHistory(page)).watchProgress).toBe(watchedVideo.lengthSeconds)

    const seen = page.locator('.ft-list-video').filter({ hasText: 'Previously seen video' })
    await seen.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark As Unseen', exact: true }).click()
    await expect(seen.locator('.newContentDot')).toBeVisible()
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(watched).toBeVisible()
    await expect(seen).toBeVisible()

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    const restored = relaunched.page.locator('.ft-list-video').filter({ hasText: 'Watched new video' })
    await expect(restored).toBeVisible()
    expect((await readHistory(relaunched.page)).watchProgress).toBe(watchedVideo.lengthSeconds)
    expect((await readHistory(relaunched.page)).isWatched).toBe(false)
    await restored.locator('.title').click({ button: 'right' })
    await relaunched.page.getByRole('menuitem', { name: 'Mark As Seen', exact: true }).click()
    await expect(restored).toHaveCount(0)
    await relaunched.page.getByRole('button', { name: 'Mark all as seen' }).click()
    await expect(relaunched.page.getByText('Previously seen video', { exact: true })).toHaveCount(0)
  })

  test('marking an unseen video watched again supersedes its reverse mark without changing progress', async ({ page }) => {
    await goTo(page, 'subscriptions')
    const card = page.locator('.ft-list-video').filter({ hasText: 'Watched new video' })
    await card.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark As Unseen', exact: true }).click()
    await expect(card).not.toHaveClass(/watched/)
    await card.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark As Watched', exact: true }).click()
    await expect(card).toHaveClass(/watched/)
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      const mark = JSON.parse(store.getters.getSubscriptionSeenVideos).find(entry => entry.videoId === 'watched-new')
      return mark?.seenAt > mark?.unseenAt
    })).toBe(true)
    const history = await page.evaluate(() => (
      window.$store.getters.getHistoryCacheById['watched-new']
    ))
    expect(history.watchProgress).toBe(watchedVideo.lengthSeconds)
    expect(history.timeWatched).toBe(now)
  })

  test('marks a dotted post as seen from its options menu and persists after restart', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="posts"]').click()

    const post = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(post.locator('.newContentDot')).toBeVisible()
    await post.getByRole('button', { name: /^More options$/i }).click()
    await page.getByRole('option', { name: /^Mark As Seen$/ }).click()

    await expect(post).toBeVisible()
    await expect(post.locator('.newContentDot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await post.getByRole('button', { name: /^More options$/i }).click()
    await expect(page.getByRole('option', { name: 'Mark As Seen', exact: true })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Never show Posts from this channel in feeds again' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(post).toHaveCount(0)
    await expect(page.getByText('New video', { exact: true })).toBeVisible()

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="posts"]').click()
    const seenPost = relaunched.page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(seenPost).toBeVisible()
    await expect(seenPost.locator('.newContentDot')).toHaveCount(0)
    await seenPost.getByRole('button', { name: /^More options$/i }).click()
    await expect(relaunched.page.getByRole('option', { name: 'Mark As Seen', exact: true })).toHaveCount(0)
  })

  test('history sync merges seen videos and posts and retains them after refresh and restart', async ({ app, page }) => {
    const key = Buffer.alloc(32, 1).toString('base64')
    const salt = Buffer.alloc(16, 2).toString('base64')
    const marks = [newVideo, newShort, newLive, { videoId: 'fetched-later' }]
      .map(entry => ({ videoId: entry.videoId, seenAt: now, isMembersOnly: false }))
    const olderMarks = Array.from({ length: 10000 }, (_, index) => ({
      videoId: `older-seen-${index}`, seenAt: now - 10000 + index, isMembersOnly: false,
    }))
    const retainedMarks = [...olderMarks.slice(marks.length), ...marks]
    const remote = {
      history: await encryptSyncDocument([], key, salt),
      seenVideos: await encryptSyncDocument([
        ...olderMarks, ...marks,
        { videoId: watchedVideo.videoId, seenAt: now + 1, isMembersOnly: false },
      ], key, salt),
      seenPosts: await encryptSyncDocument([
        { postId: 'new-post-1', seenAt: now },
        { postId: 'post-fetched-later', seenAt: now },
      ], key, salt),
    }
    const uploads = []
    await page.route('https://seen-sync.example/**', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      let body
      if (pathname === '/health') {
        body = { capabilities: { encrypted_sync: 1, live_sync: 1, seen_videos: 1, seen_posts: 1 } }
      } else if (pathname === '/v1/encrypted_sync/events') {
        body = []
      } else if (pathname === '/v1/account/sessions') {
        body = { sessions: [] }
      } else if (pathname === '/v1/encrypted_sync') {
        body = { collections: [], legacy_data: false, legacy_encrypted_data: false }
      } else {
        const collection = pathname.split('/').at(-1)
        expect(Object.hasOwn(remote, collection)).toBe(true)
        if (request.method() === 'PUT') {
          uploads.push(collection)
          remote[collection] = request.postDataJSON().payload
        }
        body = { revision: 1, payload: remote[collection] }
      }
      await route.fulfill({ json: body })
    })

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await page.locator('[data-subscription-feed-tab="posts"]').click()
    const postCard = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await expect(postCard.locator('.newContentDot')).toBeVisible()

    const result = await page.evaluate(async ({ key, salt }) => {
      const store = window.$store
      const settings = {
        SyncServerEnabled: true,
        SyncServerUrl: 'https://seen-sync.example',
        SyncServerToken: 'test-token',
        SyncServerPrivacyMode: 'enhanced',
        SyncServerPrivacyKey: key,
        SyncServerPrivacySalt: salt,
        SyncServerAutoSync: false,
        SyncServerSyncHistory: true,
        SyncServerSyncSubscriptions: false,
        SyncServerSyncPlaylists: false,
        SyncServerSyncProfiles: false,
        SyncServerSyncSettings: false,
        SyncServerSyncSessions: false,
      }
      for (const [setting, value] of Object.entries(settings)) store.commit(`set${setting}`, value)
      const historyBefore = JSON.stringify(store.getters.getHistoryCacheSorted)
      await store.dispatch('syncWithSyncServer')
      return {
        status: store.state.syncServer.syncServerStatus,
        error: store.state.syncServer.syncServerError,
        historyUnchanged: historyBefore === JSON.stringify(store.getters.getHistoryCacheSorted),
      }
    }, { key, salt })
    expect(result).toEqual({ status: 'success', error: '', historyUnchanged: true })
    await expect(postCard.locator('.newContentDot')).toHaveCount(0)
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New community post', { exact: true })).toHaveCount(0)

    await page.evaluate(async ({ channelId, posts }) => {
      const store = window.$store
      await store.dispatch('updateSubscriptionPostsCacheByChannel', { channelId, posts, timestamp: new Date() })
    }, {
      channelId: CHANNEL_ID,
      posts: [post('post-fetched-later', 'Post fetched after sync', now), post('local-post', 'Locally marked post', now)]
    })
    await expect(page.getByText('Post fetched after sync', { exact: true })).toHaveCount(0)
    const localPost = page.locator('.ft-list-post').filter({ hasText: 'Locally marked post' })
    await expect(localPost).toBeVisible()
    await localPost.getByRole('button', { name: /^More options$/i }).click()
    await page.getByRole('option', { name: 'Mark As Seen', exact: true }).click()
    await expect(localPost).toHaveCount(0)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('syncWithSyncServer')
    })
    expect((await decryptSyncDocument(remote.seenPosts, key)).map(entry => entry.postId).sort())
      .toEqual(['local-post', 'new-post-1', 'post-fetched-later'])

    await page.evaluate(async ({ channelId, videos }) => {
      const store = window.$store
      await store.dispatch('updateSubscriptionVideosCacheByChannel', { channelId, videos, timestamp: new Date() })
    }, {
      channelId: CHANNEL_ID,
      videos: [
        video('fetched-later', 'Fetched after sync', now, { isNewInSubscriptionFeed: true }),
        video('fetched-unseen', 'Fetched unseen video', now, { isNewInSubscriptionFeed: true })
      ]
    })
    await expect(page.getByText('Fetched unseen video', { exact: true })).toBeVisible()
    await expect(page.getByText('Fetched after sync', { exact: true })).toHaveCount(0)
    expect(uploads).toContain('history')
    expect(uploads).toContain('seenVideos')
    expect((await decryptSyncDocument(remote.seenVideos, key)).map(entry => entry.videoId).sort())
      .toEqual(retainedMarks.map(entry => entry.videoId).sort())

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('Post fetched after sync', { exact: true })).toHaveCount(0)
    await expect(relaunched.page.getByText('Locally marked post', { exact: true })).toHaveCount(0)
    await expect(relaunched.page.getByText('Fetched unseen video', { exact: true })).toBeVisible()
    await expect(relaunched.page.getByText('Fetched after sync', { exact: true })).toHaveCount(0)
    expect(await relaunched.page.evaluate(() => {
      const store = window.$store
      return JSON.parse(store.getters.getSubscriptionSeenVideos).length
    })).toBe(10000)
  })
})

test.describe('tile keyboard navigation in a long feed', () => {
  const videos = Array.from({ length: 30 }, (_, index) => (
    video(`long-feed-${index}`, `Long feed video ${index}`, now - (index + 1) * HOUR)
  ))

  test.use({
    seed: {
      settings: { ...commonSettings, listType: 'list' },
      profiles: [profile()],
      subscriptionCache: [{ _id: CHANNEL_ID, videos, videosTimestamp: new Date(now - HOUR).toISOString() }]
    }
  })

  test('moves down onto tiles that mount once they scroll into view', async ({ page }) => {
    const titleLink = index => page.locator(`a.title[href$="/watch/long-feed-${index}"]`)

    await goTo(page, 'subscriptions')
    await titleLink(0).focus()
    // Only the first screen of tiles mounts up front.
    for (let index = 1; index <= 20; index++) {
      await page.keyboard.press('ArrowDown')
      await expect(titleLink(index)).toBeFocused()
    }

    for (let index = 19; index >= 0; index--) {
      await page.keyboard.press('ArrowUp')
      await expect(titleLink(index)).toBeFocused()
    }
    // The first row cannot scroll further down, so its focus ring needs room
    // below the sticky header.
    const { ringTop, headerBottom } = await titleLink(0).evaluate(title => {
      const tile = title.closest('.ft-list-item')
      const style = getComputedStyle(tile)
      return {
        ringTop: tile.getBoundingClientRect().top - parseFloat(style.outlineWidth) - parseFloat(style.outlineOffset),
        headerBottom: document.querySelector('.subscriptionsHeader').getBoundingClientRect().bottom
      }
    })
    expect(ringTop).toBeGreaterThanOrEqual(headerBottom)
  })
})

test.describe('per-channel subscription feed filters', () => {
  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profile([{
        id: CHANNEL_ID,
        name: 'Channel A',
        thumbnail: '',
        feedTypes: ['videos']
      }])],
      subscriptionCache: populatedCache
    }
  })

  test('hides every disabled cached feed type', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.getByText('New community post', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.getByText('New short', { exact: true })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="live"]').click()
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(page.getByText('New community post', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Refresh Posts/ })).toBeDisabled()
  })
})

test.describe('new subscriptions feed sorting', () => {
  const newestVideo = video('sort-newest-video', 'Newest video', now - HOUR, {
    isNewInSubscriptionFeed: true
  })
  const oldestVideo = video('sort-oldest-video', 'Oldest video', now - 3 * HOUR, {
    isNewInSubscriptionFeed: true
  })
  const newestPost = post('sort-newest-post', 'Newest post', now - 2 * HOUR)
  const oldestPost = post('sort-oldest-post', 'Oldest post', now - 4 * HOUR)

  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profile()],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        videos: [oldestVideo, newestVideo],
        videosTimestamp: new Date(now).toISOString(),
        shorts: [],
        shortsTimestamp: new Date(now).toISOString(),
        liveStreams: [],
        liveStreamsTimestamp: new Date(now).toISOString(),
        communityPosts: [oldestPost, newestPost],
        communityPostsTimestamp: new Date(now).toISOString()
      }]
    }
  })

  test('sorts every section oldest first and persists the preference', async ({ app, page }) => {
    const videoTitles = page => page.locator('.newFeed > .autoGrid .ft-list-video').evaluateAll(cards => {
      return cards.map(card => card.querySelector('.title').textContent.trim())
    })
    const postTexts = page => page.locator('.newFeed .postsSection .ft-list-post').evaluateAll(posts => {
      return posts.map(post => post.querySelector('.postText').textContent.trim())
    })

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect.poll(() => videoTitles(page)).toEqual(['Newest video', 'Oldest video'])
    await expect.poll(() => postTexts(page)).toEqual(['Newest post', 'Oldest post'])

    const sortSelect = page.locator('.headerSortSelect').getByRole('combobox')
    await expect(sortSelect).toHaveText('Newest first')
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setNewSubscriptionFeedSortBy', 'unsupported')
    })
    await expect(sortSelect).toHaveText('Newest first')
    await expect.poll(() => videoTitles(page)).toEqual(['Newest video', 'Oldest video'])

    await sortSelect.click()
    await page.getByRole('option', { name: 'Oldest first' }).click()

    await expect(sortSelect).toHaveText('Oldest first')
    await expect.poll(() => videoTitles(page)).toEqual(['Oldest video', 'Newest video'])
    await expect.poll(() => postTexts(page)).toEqual(['Oldest post', 'Newest post'])
    await expect.poll(() => page.evaluate(() => {
      return window.$store.getters.getNewSubscriptionFeedSortBy
    })).toBe('oldest')

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(relaunched.page.locator('.headerSortSelect').getByRole('combobox')).toHaveText('Oldest first')
    await expect.poll(() => videoTitles(relaunched.page)).toEqual(['Oldest video', 'Newest video'])
    await expect.poll(() => postTexts(relaunched.page)).toEqual(['Oldest post', 'Newest post'])
  })
})

test.describe('scheduled entries in the new subscriptions feed', () => {
  const scheduledTime = now + 30 * 24 * HOUR

  test.use({
    seed: {
      settings: { ...commonSettings, showScheduledLiveStreamsFirst: true },
      profiles: [profile()],
      subscriptionCache: [{
        _id: CHANNEL_ID,
        videos: [
          video('scheduled-premiere', 'Scheduled premiere', scheduledTime, {
            isNewInSubscriptionFeed: true,
            isUpcoming: true,
            isPremiere: true,
            premiereDate: new Date(scheduledTime).toISOString(),
            subscriptionFeedPublished: now - 2 * HOUR
          }),
          video('recent-upload', 'Recent upload', now - HOUR, { isNewInSubscriptionFeed: true }),
          video('older-upload', 'Older upload', now - 3 * HOUR, { isNewInSubscriptionFeed: true })
        ],
        videosTimestamp: new Date(now).toISOString(),
        shorts: [],
        shortsTimestamp: new Date(now).toISOString(),
        liveStreams: [],
        liveStreamsTimestamp: new Date(now).toISOString(),
        communityPosts: [],
        communityPostsTimestamp: new Date(now).toISOString()
      }]
    }
  })

  test('keeps scheduled entries at their announcement position when they are not shown first', async ({ page }) => {
    const videoTitles = () => page.locator('.newFeed > .autoGrid .ft-list-video').evaluateAll(cards => {
      return cards.map(card => card.querySelector('.title').textContent.trim())
    })

    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect.poll(videoTitles).toEqual(['Scheduled premiere', 'Recent upload', 'Older upload'])

    await page.evaluate(() => window.$store.dispatch('updateShowScheduledLiveStreamsFirst', false))

    await expect.poll(videoTitles).toEqual(['Recent upload', 'Scheduled premiere', 'Older upload'])
  })
})

test.describe('new feed settings and seen state', () => {
  const videoPost = {
    ...post('new-post-2', 'New video post', now - 40 * 60000),
    postContent: {
      type: 'video',
      content: video('post-video-1', 'Attached video', now - 40 * 60000)
    }
  }
  const cacheWithVideoPost = [{
    ...populatedCache[0],
    communityPosts: [...populatedCache[0].communityPosts, videoPost]
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        listType: 'list',
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile()],
      subscriptionCache: cacheWithVideoPost
    }
  })

  test('works without dots and persists marking all entries as seen', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.locator('[data-subscription-feed-tab="all"]')).toBeVisible()
    await expect(page.locator('.newContentDot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()
    await expect(page.getByRole('tablist', { name: 'New content tabs' }).locator('.newContentDot')).toHaveCount(0)
    await page.getByRole('button', { name: 'Show combined view' }).click()
    // Mark all as seen covers the view that is active when clicked, which switches once the setting saves.
    await expect(page.getByRole('button', { name: 'Show tabbed view' })).toBeVisible()
    const newVideoCard = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await expect(newVideoCard).toHaveClass(/list/)

    const markAllAsSeen = page.getByRole('button', { name: 'Mark all as seen' })
    await expect(markAllAsSeen).toBeVisible()
    await page.evaluate(() => {
      const store = window.$store
      window.__markSeenMutations = []
      window.__unsubscribeMarkSeen = store.subscribe((mutation) => {
        if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
          window.__markSeenMutations.push(mutation.payload)
        }
      })
    })
    await markAllAsSeen.click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    // The panel clears its cards before the cache writes finish and commit.
    await expect.poll(() => page.evaluate(() => (
      window.__markSeenMutations.map(batch => batch.map(({ tab, channelId }) => ({ tab, channelId })))
    ))).toEqual([[
      { tab: 'videos', channelId: CHANNEL_ID },
      { tab: 'shorts', channelId: CHANNEL_ID },
      { tab: 'live', channelId: CHANNEL_ID },
      { tab: 'posts', channelId: CHANNEL_ID }
    ]])
    await page.evaluate(() => window.__unsubscribeMarkSeen())
    await expect(markAllAsSeen).toHaveCount(0)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('There is no new content.')).toBeVisible()
  })

  test('marks a video as seen from the New feed even when dots are disabled', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const regularFeedVideo = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await regularFeedVideo.hover()
    await regularFeedVideo.locator('.title').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Mark As Seen', exact: true })).toHaveCount(0)

    await page.keyboard.press('Escape')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const newFeedVideo = page.locator('.ft-list-video').filter({
      has: page.getByRole('heading', { name: 'New video', exact: true })
    })
    await newFeedVideo.hover()
    await newFeedVideo.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark As Seen', exact: true }).click()

    await expect(newFeedVideo).toHaveCount(0)
  })

  test('persists a post as seen when its comments are opened', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const newPost = page.locator('.ft-list-post').filter({ hasText: 'New community post' })
    await page.locator('.postsSection').scrollIntoViewIfNeeded()
    await expect(newPost).toBeVisible()
    await newPost.locator('.commentsLink').click()
    await expect(page).toHaveURL(/#\/post\/new-post-1/)

    const relaunched = await app.relaunch()
    await goTo(relaunched.page, 'subscriptions')
    await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(relaunched.page.getByText('New community post', { exact: true })).toHaveCount(0)
  })
})

test.describe('new feed display filters', () => {
  const hiddenPremiere = video('hidden-premiere', 'Hidden premiere', now + HOUR, {
    isNewInSubscriptionFeed: true,
    isUpcoming: true,
    premiereDate: new Date(now + HOUR).toISOString()
  })
  const forbiddenVideo = video('forbidden-video', 'Blocked title', now - HOUR, {
    isNewInSubscriptionFeed: true
  })
  const hiddenLive = video('hidden-live', 'Hidden live stream', now, {
    isNewInSubscriptionFeed: true,
    liveNow: true
  })
  const forbiddenPost = {
    ...post('forbidden-post', 'Forbidden post', now),
    author: 'Blocked channel'
  }
  const hiddenCache = [{
    _id: CHANNEL_ID,
    videos: [hiddenPremiere, forbiddenVideo],
    videosTimestamp: new Date(now).toISOString(),
    shorts: [],
    shortsTimestamp: new Date(now).toISOString(),
    liveStreams: [hiddenLive],
    liveStreamsTimestamp: new Date(now).toISOString(),
    communityPosts: [forbiddenPost],
    communityPostsTimestamp: new Date(now).toISOString()
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        forbiddenTitles: JSON.stringify(['Blocked']),
        hideLiveStreams: true,
        hideUpcomingPremieres: true,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profile()],
      subscriptionCache: hiddenCache
    }
  })

  test('does not advertise new content hidden by display preferences', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
    await page.locator('[data-subscription-feed-tab="posts"]').click()
    await expect(page.getByText(/Posts feed last updated:/)).toBeVisible()
    await expect(page.getByText('Forbidden post', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)

    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('There is no new content.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
  })

  test.describe('with blocked items blurred', () => {
    test.use({
      seed: {
        settings: {
          ...commonSettings,
          forbiddenTitles: JSON.stringify(['Blocked']),
          blurBlockedItems: true
        },
        profiles: [profile()],
        subscriptionCache: hiddenCache
      }
    })

    test('covers blocked videos and posts until they are revealed', async ({ page }) => {
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="videos"]').click()

      const reveal = page.getByRole('button', { name: 'Show blocked item' })
      await expect(page.getByRole('link', { name: 'Hidden premiere' }).first()).toBeVisible()
      await expect(reveal).toHaveCount(1)
      // Covered cards stay out of the tab order and accessibility tree.
      await expect(page.getByRole('link', { name: 'Blocked title' })).toHaveCount(0)

      await reveal.focus()
      await page.keyboard.press('Enter')
      await expect(reveal).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Blocked title' }).first()).toBeVisible()
      await expect(page.locator('.blockedItem :focus:not([tabindex="-1"])')).toHaveCount(1)

      await page.locator('[data-subscription-feed-tab="posts"]').click()
      await expect(page.locator('.blockedItem.covered')).toContainText('Forbidden post')
      await reveal.click()
      await expect(page.locator('.blockedItem.covered')).toHaveCount(0)
      await expect(page.getByText('Forbidden post', { exact: true })).toBeVisible()
    })
  })
})

test.describe('new feed latest-per-channel limit', () => {
  const publishedTimeShort = video('published-time-short', 'New short by published time', undefined, {
    isNewInSubscriptionFeed: true,
    publishedTime: now + HOUR
  })
  const latestLimitCache = [{
    ...populatedCache[0],
    shorts: [publishedTimeShort]
  }]

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        onlyShowLatestFromChannel: true,
        onlyShowLatestFromChannelNumber: 1
      },
      profiles: [profile()],
      subscriptionCache: latestLimitCache
    }
  })

  test('applies the limit across media categories', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('New short by published time', { exact: true })).toBeVisible()
    await expect(page.getByText('New video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('New live stream', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Videos', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Live', exact: true })).toHaveCount(0)
  })
})

test.describe('new feed per-channel daily limit', () => {
  const day = new Date(2026, 7, 31, 12).getTime()
  const dailyLimitCache = [{
    ...populatedCache[0],
    videos: [
      video('daily-newest', 'Newest video today', day, { isNewInSubscriptionFeed: true }),
      video('daily-hidden', 'Hidden video today', day - HOUR, { isNewInSubscriptionFeed: true }),
      video('daily-previous', 'Video from yesterday', day - 24 * HOUR, { isNewInSubscriptionFeed: true })
    ],
    shorts: [],
    liveStreams: [],
    communityPosts: []
  }]

  test.use({
    seed: {
      settings: commonSettings,
      profiles: [profile([{
        id: CHANNEL_ID,
        name: 'Channel A',
        thumbnail: '',
        dailyVideoLimit: 1
      }])],
      subscriptionCache: dailyLimitCache
    }
  })

  test('keeps the newest video from each day and reports hidden entries', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    await expect(page.getByText('Newest video today', { exact: true })).toBeVisible()
    await expect(page.getByText('Hidden video today', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Video from yesterday', { exact: true })).toBeVisible()
    await expect(page.getByText('+1 more', { exact: true })).toBeVisible()
  })
})

test.describe('independent new feed setting', () => {
  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeed: false,
        showNewSubscriptionFeedIndicators: true
      },
      profiles: [profile()],
      history: watchedHistory,
      subscriptionCache: populatedCache
    }
  })

  test('can hide the New tab without disabling indicators', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('New video', { exact: true })).toBeVisible()
    await expect(page.locator('[data-subscription-feed-tab="all"]')).toHaveCount(0)
    await expect(page.locator('.newContentDot')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeVisible()
  })
})

test.describe('large new feed refresh', () => {
  const subscriptions = Array.from({ length: 126 }, (_, index) => ({
    id: `UC${String(index).padStart(22, '0')}`,
    name: `Channel ${index}`,
    thumbnail: ''
  }))

  test.use({
    seed: {
      settings: {
        ...commonSettings,
        showNewSubscriptionFeedIndicators: false
      },
      profiles: [profile(subscriptions)]
    }
  })

  test('warns before refreshing all feeds', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('There is no new content.')).toBeVisible()

    const refreshNewContent = page.getByRole('button', { name: /Refresh New content/ })
    await expect(refreshNewContent).toBeVisible()
    await refreshNewContent.click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toBeVisible()
    await expect(page.getByText(/126 subscriptions can take a long time/)).toBeVisible()
    expect(await page.locator('.promptCard').evaluate(
      element => element.scrollHeight <= element.clientHeight
    )).toBe(true)

    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)
    await expect(page.getByText('There is no new content.')).toBeVisible()

    // "Never ask again" refreshes and turns the confirmation off
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
    await page.evaluate(() => {
      window.__refreshStarts = 0
      window.$store.watch(state => state.subscriptionCache.subscriptionFeedRefreshInProgress, refreshing => {
        if (refreshing) window.__refreshStarts++
      })
    })
    await refreshNewContent.click()
    await page.getByRole('button', { name: 'Never ask again' }).click()
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.$store.getters.getConfirmRefreshAllFeeds)).toBe(false)
    // Refreshing all feeds refreshes each feed type in turn, and each one
    // toggles the flag, so a single refresh can count more than one start.
    await expect.poll(() => page.evaluate(() => window.__refreshStarts)).toBeGreaterThan(0)

    await page.locator('.subscriptionsHeader').getByRole('button', { name: 'Cancel Refresh' }).click()
    await expect(refreshNewContent).toHaveAttribute('aria-disabled', 'false')
    await page.evaluate(() => { window.__refreshStarts = 0 })
    await refreshNewContent.click()
    await expect.poll(() => page.evaluate(() => window.__refreshStarts)).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)
  })

  test.describe('with RSS feeds', () => {
    test.use({
      seed: {
        settings: {
          ...commonSettings,
          newSubscriptionFeedView: 'tabbed',
          enableRssFeeds: true,
          followedRssFeeds: [{ url: 'https://rss.example.test/feed.xml', title: 'Example feed' }]
        },
        profiles: [profile(subscriptions)]
      }
    })

    test('reloading all feeds from the RSS tab asks too and can be cancelled there', async ({ page }) => {
      await page.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '' }))
      await goTo(page, 'subscriptions')
      const newTab = page.locator('[data-subscription-feed-tab="all"]')
      await newTab.click()
      await page.locator('[data-new-feed-rss-tab]').click()
      await newTab.click({ button: 'right' })
      await page.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name: 'Reload All Feeds' }).click()
      await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toBeVisible()
      await page.getByRole('button', { name: 'Yes', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Refresh all subscription feeds?' })).toHaveCount(0)

      // The RSS tab shows and cancels the subscription refresh it started
      await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscriptionFeedRefreshInProgress)).toBe(true)
      await page.locator('.subscriptionsHeader').getByRole('button', { name: 'Cancel Refresh' }).click()
      await expect.poll(() => page.evaluate(() => window.$store.getters.getSubscriptionFeedRefreshInProgress)).toBe(false)
    })
  })

  for (const view of ['combined', 'tabbed']) {
    test.describe(`confirmation while saving in ${view} view`, () => {
      test.use({
        seed: {
          settings: { ...commonSettings, newSubscriptionFeedView: view },
          profiles: [profile(subscriptions)],
          subscriptionCache: [{
            _id: subscriptions[0].id,
            videos: [video('large-feed-new', 'New video in a large profile', now - HOUR, {
              author: subscriptions[0].name,
              authorId: subscriptions[0].id,
              isNewInSubscriptionFeed: true
            })],
            videosTimestamp: new Date(now).toISOString()
          }]
        }
      })

      test('shows the refresh confirmation during saving and retains its focus afterward', async ({ page }, testInfo) => {
        await goTo(page, 'subscriptions')
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await expect(page.getByText('New video in a large profile', { exact: true })).toBeVisible()
        await holdSeenMarks(page)
        try {
          await page.getByRole('button', { name: 'Mark all as seen' }).click()
          await expect.poll(() => page.evaluate(() => !!window.__finishSavingSeenMarks)).toBe(true)
          await expect(page.getByText('There is no new content.', { exact: true })).toBeVisible()
          await expect(page.locator('#subscriptionsPanel.newFeed')).toHaveAttribute('role', 'tabpanel')
          await page.keyboard.press('r')
          const dialog = page.getByRole('dialog', { name: 'Refresh all subscription feeds?' })
          await expect(dialog).toBeVisible({ timeout: 1000 })
          await expect(dialog.getByText(/126 subscriptions can take a long time/)).toBeVisible()
          await dialog.evaluate(element => { window.__refreshConfirmation = element })
          const cancel = dialog.getByRole('button', { name: 'No', exact: true })
          await cancel.focus()
          await dialog.screenshot({ path: testInfo.outputPath('refresh-confirmation-during-save.png') })

          await page.evaluate(() => window.__finishSavingSeenMarks())
          await expect.poll(() => page.evaluate(() => window.__seenMarksSaved)).toBe(true)
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          await expect(page.locator('#subscriptionsPanel.newFeed')).toHaveAttribute('role', 'tabpanel')
          expect(await dialog.evaluate(element => element === window.__refreshConfirmation)).toBe(true)
          await expect(cancel).toBeFocused()
          await cancel.click()
          await expect(dialog).toHaveCount(0)
          await expect(page.getByText('There is no new content.', { exact: true })).toBeVisible()
        } finally {
          await page.evaluate(() => window.__finishSavingSeenMarks?.())
        }
      })
    })
  }
})

test.describe('large combined new feed', () => {
  const seed = {
    settings: { ...commonSettings, newSubscriptionFeedView: 'combined', uiScale: 95 },
    profiles: [profile()],
    subscriptionCache: [{
      _id: CHANNEL_ID,
      videos: Array.from({ length: 120 }, (_, index) => video(
          `new-video-${index}`, `New video ${index}`, now - index * HOUR,
          { isNewInSubscriptionFeed: true }
      )),
      videosTimestamp: new Date(now).toISOString(),
      shorts: Array.from({ length: 24 }, (_, index) => video(
          `new-short-${index}`, `New short ${index}`, now - index * HOUR,
          { isNewInSubscriptionFeed: true }
      )),
      shortsTimestamp: new Date(now).toISOString(),
      liveStreams: [newLive],
      liveStreamsTimestamp: new Date(now).toISOString(),
      communityPosts: [post('new-post-below-feed', 'New post below feed', now)],
      communityPostsTimestamp: new Date(now).toISOString()
    }]
  }
  test.use({ seed })

  for (const [view, scale, reducedMotion] of [
    ['combined', 95, 'off'],
    ['tabbed', 125, 'off']
  ]) {
    test.describe(`mark all seen: ${view}, ${scale}% scale, motion ${reducedMotion}`, () => {
      test.use({ seed: { ...seed, settings: { ...seed.settings, newSubscriptionFeedView: view, uiScale: scale, reducedMotion } } })
      test('shows the empty message as soon as cards disappear while seen marks are saving', async ({ page }) => {
        await goTo(page, 'subscriptions')
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await expect(page.getByText('New video 0', { exact: true })).toBeVisible()

        await holdSeenMarks(page)
        try {
          await page.getByRole('button', { name: 'Mark all as seen' }).click()
          await expect.poll(() => page.evaluate(() => !!window.__finishSavingSeenMarks)).toBe(true)
          await expect(page.locator('.newFeed [data-feed-item-key]')).toHaveCount(0)
          await expect(page.getByText('There is no new content.', { exact: true })).toBeVisible({ timeout: 1000 })
          await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeDisabled()
        } finally {
          await page.evaluate(() => window.__finishSavingSeenMarks?.())
        }
        await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
        await expect(page.getByText('There is no new content.', { exact: true })).toBeVisible()
      })

      test('returns to the top and clears the New feed without per-card layout work', async ({ page }) => {
        await goTo(page, 'subscriptions')
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await expect(page.locator('.newFeed [data-feed-item-key]')).toHaveCount(view === 'combined' ? 126 : 100)
        await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight))
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)

        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

        await page.evaluate(() => {
          const store = window.$store
          window.__markAllSeenMetrics = { leaveReflows: 0, scrollAtCommit: null, animations: [] }
          const animate = Element.prototype.animate
          Element.prototype.animate = function (...args) {
            if (this.matches('.newFeed')) {
              window.__markAllSeenMetrics.animations.push({ scrollY: window.scrollY, frames: args[0] })
            }
            return animate.apply(this, args)
          }
          window.__restoreMarkSeenAnimate = () => { Element.prototype.animate = animate }
          const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight').get
          Object.defineProperty(document.body, 'offsetHeight', {
            configurable: true,
            get() {
              window.__markAllSeenMetrics.leaveReflows++
              return offsetHeight.call(this)
            }
          })
          window.__unsubscribeMarkAllSeen = store.subscribe(mutation => {
            if (mutation.type === 'markSubscriptionEntriesAsSeenInCache') {
              window.__markAllSeenMetrics.scrollAtCommit = window.scrollY
            }
          })
        })
        await page.getByRole('button', { name: 'Mark all as seen' }).click()
        await expect(page.getByText('There is no new content.')).toBeVisible()
        await expect(page.locator('.newFeed [data-feed-item-key]')).toHaveCount(0)
        // The empty message appears before the seen marks are saved and committed.
        await expect.poll(() => page.evaluate(() => window.__markAllSeenMetrics.scrollAtCommit)).not.toBeNull()
        const metrics = await page.evaluate(() => {
          delete document.body.offsetHeight
          window.__unsubscribeMarkAllSeen()
          window.__restoreMarkSeenAnimate()
          return window.__markAllSeenMetrics
        })
        console.log('Mark all as seen:', metrics)
        expect(metrics.leaveReflows).toBeLessThan(10)
        expect(metrics.scrollAtCommit).toBeLessThanOrEqual(1)
        expect(metrics.animations).toHaveLength(reducedMotion === 'on' ? 0 : 1)
        for (const animation of metrics.animations) {
          expect(animation.scrollY).toBeLessThanOrEqual(1)
          expect(animation.frames.at(-1)).toEqual({ opacity: 0, transform: 'translateY(-10px)' })
        }
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
        await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1)
        await expect(page.locator('body > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)

        await page.locator('[data-subscription-feed-tab="videos"]').click()
        await page.locator('[data-subscription-feed-tab="all"]').click()
        await expect(page.getByText('There is no new content.')).toBeVisible()
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
        await cdp.detach()
      })

      if (reducedMotion === 'off') {
        test('keeps entries arriving during the removal animation unseen', async ({ page, app }) => {
          await goTo(page, 'subscriptions')
          await page.evaluate(async channelId => {
            const store = window.$store
            await store.dispatch('updateSubscriptionVideosCacheByChannel', {
              channelId,
              videos: store.getters.getVideoCache[channelId].videos.map(entry => entry.videoId === 'new-video-1'
                ? { ...entry, isMembersOnly: true }
                : entry),
              timestamp: new Date()
            })
          }, CHANNEL_ID)
          await page.locator('[data-subscription-feed-tab="all"]').click()
          await expect(page.getByText('New video 0', { exact: true })).toBeVisible()
          await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeVisible()
          await page.evaluate(() => {
            const animate = Element.prototype.animate
            Element.prototype.animate = function (...args) {
              const animation = animate.apply(this, args)
              if (this.matches('.newFeed')) {
                animation.pause()
                window.__markSeenAnimation = animation
                Element.prototype.animate = animate
              }
              return animation
            }
            document.querySelector('.markAllSeenButton').click()
          })
          await expect.poll(() => page.evaluate(() => !!window.__markSeenAnimation)).toBe(true)
          // Apply the same cache writes as a refresh while removal is paused.
          await page.evaluate(async ({ channelId, incoming }) => {
            const store = window.$store
            for (const [getter, action, field, entry] of [
              ['getVideoCache', 'updateSubscriptionVideosCacheByChannel', 'videos', incoming.video],
              ['getShortsCache', 'updateSubscriptionShortsCacheByChannel', 'videos', incoming.short],
              ['getLiveCache', 'updateSubscriptionLiveCacheByChannel', 'videos', incoming.live],
              ['getPostsCache', 'updateSubscriptionPostsCacheByChannel', 'posts', incoming.post]
            ]) {
              await store.dispatch(action, {
                channelId,
                [field]: [entry, ...store.getters[getter][channelId][field].map(item => item.videoId === 'new-video-1'
                  ? { ...item, isMembersOnly: false, title: 'Newly public upload' }
                  : item)],
                timestamp: new Date()
              })
            }
            window.__markSeenAnimation.finish()
          }, {
            channelId: CHANNEL_ID,
            incoming: {
              video: video('arrived-video', 'Video arriving during removal', now, { isNewInSubscriptionFeed: true }),
              short: video('arrived-short', 'Short arriving during removal', now, { isNewInSubscriptionFeed: true }),
              live: video('arrived-live', 'Live arriving during removal', now, { isNewInSubscriptionFeed: true, liveNow: true }),
              post: post('arrived-post', 'Post arriving during removal', now)
            }
          })
          await expect(page.getByText('Video arriving during removal', { exact: true })).toBeVisible()
          await expect(page.getByText('Newly public upload', { exact: true })).toBeVisible()
          await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeEnabled()
          await expect(page.getByText('New video 0', { exact: true })).toHaveCount(0)
          expect(await page.evaluate(() => {
            const store = window.$store
            return ['getVideoCache', 'getShortsCache', 'getLiveCache', 'getPostsCache'].map(getter => {
              const cache = store.getters[getter]
              const entry = Object.values(cache)[0]
              return (entry.videos ?? entry.posts).map(item => item.isNewInSubscriptionFeed)
            })
          })).toEqual([
            [true, false, true, ...Array(118).fill(false)],
            [true, ...Array(24).fill(view === 'tabbed')],
            [true, view === 'tabbed'],
            [true, view === 'tabbed']
          ])
          const relaunched = await app.relaunch()
          await goTo(relaunched.page, 'subscriptions')
          await relaunched.page.locator('[data-subscription-feed-tab="all"]').click()
          await expect(relaunched.page.getByText('Video arriving during removal', { exact: true })).toBeVisible()
          await expect(relaunched.page.getByText('Newly public upload', { exact: true })).toBeVisible()
          await expect(relaunched.page.getByText('New video 0', { exact: true })).toHaveCount(0)
        })
      }

      if (view === 'tabbed' && reducedMotion === 'off') {
        test('switching categories during removal leaves the new category visible', async ({ page }) => {
          await goTo(page, 'subscriptions')
          await page.locator('[data-subscription-feed-tab="all"]').click()
          await expect(page.locator('.newFeed [data-feed-item-key]')).toHaveCount(100)
          await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight))
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
          // Pause at the real leave animation so cancellation is deterministic.
          await page.evaluate(() => {
            const animate = Element.prototype.animate
            Element.prototype.animate = function (...args) {
              const animation = animate.apply(this, args)
              if (this.matches('.newFeed')) {
                animation.pause()
                window.__markSeenAnimation = animation
                Element.prototype.animate = animate
              }
              return animation
            }
            document.querySelector('.markAllSeenButton').click()
          })
          await expect.poll(() => page.evaluate(() => !!window.__markSeenAnimation)).toBe(true)
          await page.locator('[data-new-feed-tab="shorts"]').click()
          await expect(page.getByText('New short 0', { exact: true })).toBeVisible()
          await expect(page.locator('.newFeed')).toHaveCSS('opacity', '1')
          await expect(page.getByRole('button', { name: 'Mark all as seen' })).toBeEnabled()
          await expect.poll(() => page.evaluate(() => window.__markSeenAnimation.playState)).toBe('idle')
          await page.locator('[data-new-feed-tab="videos"]').click()
          await expect(page.getByText('There is no new content.')).toBeVisible()
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
        })
      }
    })
  }

  test('mounts cards in later sections when scrolled into view', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    const feed = page.locator('.tabContent[aria-hidden="false"] #subscriptionsPanel.newFeed')
    await expect(feed.getByText('New video 0', { exact: true })).toBeVisible()
    await expect(feed.locator('.mediaSection')).toHaveCount(2)
    await expect(feed.locator('.postsSection')).toHaveCount(1)
    await expect(feed.locator('.mediaSection .ft-list-video, .postsSection .ft-list-post')).toHaveCount(0)

    const shorts = feed.locator('.mediaSection').first()
    await shorts.scrollIntoViewIfNeeded()
    await expect(shorts.getByText('New short 0', { exact: true })).toBeVisible()
  })

  test('releases distant video cards after scrolling through the feed', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    const panel = page.locator('.tabContent[aria-hidden="false"] #subscriptionsPanel:not(.newFeed)')
    await expect(panel.getByText('New video 0', { exact: true })).toBeVisible()

    const metrics = await page.evaluate(async () => {
      const scroller = document.scrollingElement
      let steps = 0
      for (let y = 0; y < scroller.scrollHeight - innerHeight && steps < 200; y += 350, steps++) {
        scroller.scrollTo(0, y)
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }
      const reachedLastVideo = [...document.querySelectorAll(
        '.tabContent[aria-hidden="false"] #subscriptionsPanel:not(.newFeed) .ft-list-video'
      )].some(card => card.textContent.includes('New video 99'))
      scroller.scrollTo(0, 0)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return { reachedLastVideo, steps }
    })
    expect(metrics.steps).toBeGreaterThan(5)
    expect(metrics.reachedLastVideo).toBe(true)
    // Intersection delivery, the release frame and Vue's patch can take more
    // than two frames. Wait for actual eviction rather than sampling mid-update.
    await expect.poll(() => panel.locator('.ft-list-video').count()).toBeLessThan(40)
    await expect(panel.getByText('New video 0', { exact: true })).toBeVisible()
  })
})
