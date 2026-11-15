import { chooseSelectOption, test, expect, goTo, setWindowSize, updateInputWithoutScrolling, sel, readDatastore, scrollPageToEnd, expectPageScrollWithinRenderedRange } from '../../helpers/app.mjs'

const now = Date.now()
const DAY = 86_400_000

function historyEntry(videoId, title, timeWatched, isWatched = false, extra = {}) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: 'Test description',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 10,
    isWatched,
    timeWatched,
    isLive: false,
    type: 'video',
    ...extra
  }
}

function matchingHistoryEntries(prefix, count, timeOffset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(6, '0')
    return historyEntry(
      `${prefix.toLowerCase()}${suffix}`,
      `${prefix} match ${suffix}`,
      now - timeOffset - index
    )
  })
}

async function openHistoryFilters(page) {
  const toggle = page.locator('.historyFilterToggleRow').getByRole('button', { name: /^Search filters$/i })
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await expect(page.getByRole('region', { name: /^Search filters$/i })).toBeVisible()
}

async function trackHistoryNavigations(page, block = false) {
  await page.evaluate(block => {
    const tabContent = document.querySelector('.tabContent[aria-hidden="false"]')
    function find(vnode) {
      if (vnode?.component) {
        if (vnode.component.subTree.el === tabContent) return vnode.component
        const nested = find(vnode.component.subTree)
        if (nested) return nested
      }
      for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
        const nested = find(child)
        if (nested) return nested
      }
    }
    const instance = find(document.querySelector('#app')._vnode)
    const router = Reflect.ownKeys(instance.provides).map(key => instance.provides[key])
      .find(value => value?.currentRoute && typeof value.beforeEach === 'function')
    const tracker = { releases: [], completed: [] }
    // The tab router runs afterEach hooks after updating the URL, so a save
    // the test already saw in the URL can still finish after tracking starts.
    // Only count navigations that passed this tracker's guard.
    const started = new WeakSet()
    router.beforeEach(to => {
      started.add(to)
      if (block) return new Promise(resolve => tracker.releases.push(resolve))
    })
    router.afterEach(to => { if (started.has(to)) tracker.completed.push(to.fullPath) })
    window.__historyNavigations = tracker
  }, block)
}

async function releaseHistoryNavigation(page, completedCount) {
  await expect.poll(() => page.evaluate(() => window.__historyNavigations.releases.length)).toBe(1)
  await page.evaluate(() => window.__historyNavigations.releases.shift()())
  await expect.poll(() => page.evaluate(() => window.__historyNavigations.completed.length)).toBe(completedCount)
}

async function pauseClock(page) {
  // pauseAt() fast-forwards from the fake clock's current time, which keeps
  // running until the call reaches the page. Under load that can take longer
  // than a short lead, but never longer than the test may run.
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + test.info().timeout)
}

test.use({
  seed: {
    settings: {
      uiRoundness: 200,
      useAITranslationCompletions: true,
      quickBookmarkTargetPlaylistId: 'favorites'
    },
    playlists: [{
      _id: 'favorites',
      playlistName: 'Favorites',
      protected: true,
      description: '',
      quickBookmarkIcon: 'bookmark',
      videos: [],
      createdAt: now - DAY,
      lastUpdatedAt: now - DAY
    }],
    history: [
      historyEntry('aaaaaaaaaaa', 'First test video', now - 1000, true),
      historyEntry('bbbbbbbbbbb', 'Second test video', now - 2000),
      historyEntry('ccccccccccc', 'Active live stream', now - 3000, false, { isLive: true }),
      historyEntry('eeeeeeeeeee', 'Upcoming premiere', now - 4000, false, {
        isUpcoming: true,
        premiereTimestamp: Math.floor((now + 30 * DAY) / 1000)
      }),
      historyEntry('fffffffffff', 'Started premiere with stale flag', now - 5000, false, {
        isUpcoming: true,
        premiereTimestamp: Math.floor((now - DAY) / 1000)
      })
    ]
  }
})

test.describe('watch history', () => {
  test('keeps actions usable beside a wide vertical tab bar and clears obsolete scrolling', { tag: '@scale' }, async ({ app, page }) => {
    await goTo(page, 'history')
    const actions = page.locator('.headingActions')
    const scrollbar = actions.locator(':scope > .os-scrollbar-horizontal')
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setTabBarPosition', 'left')
      store.commit('setVerticalTabBarWidth', 260)
    })
    await setWindowSize(app, page, { width: 340, height: 880 })
    await expect(actions).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    for (const button of await actions.getByRole('button').all()) {
      await button.focus()
      await expect.poll(() => button.evaluate(button => {
        const rect = button.getBoundingClientRect()
        const icon = button.querySelector('svg').getBoundingClientRect()
        const label = button.querySelector('.historyCompactActionLabel')
        return rect.height >= 48 && icon.left >= rect.left - 1 && icon.right <= rect.right + 1 &&
          label.scrollWidth <= label.clientWidth + 1
      })).toBe(true)
    }
    for (const trigger of ['resize', 'tab width', 'locale']) {
      if (trigger === 'locale') {
        await setWindowSize(app, page, { width: 440, height: 860 })
        await page.evaluate(() => window.$store.commit('setVerticalTabBarWidth', 260))
        await page.evaluate(() => {
          window.$store.dispatch('updateCurrentLocale', 'br')
        })
        await page.waitForFunction(() => document.documentElement.lang === 'br')
      } else if (trigger === 'tab width') {
        await setWindowSize(app, page, { width: 340, height: 880 })
        await page.evaluate(() => window.$store.commit('setVerticalTabBarWidth', 260))
      }
      await actions.evaluate(element => { element.scrollLeft = element.scrollWidth })
      if (trigger === 'resize') await setWindowSize(app, page, { width: 732, height: 550 })
      if (trigger === 'tab width') await page.evaluate(() => window.$store.commit('setVerticalTabBarWidth', 150))
      if (trigger === 'locale') {
        await page.evaluate(() => {
          window.$store.dispatch('updateCurrentLocale', 'en-US')
        })
        await page.waitForFunction(() => document.documentElement.lang === 'en-US')
      }
      await expect.poll(() => actions.evaluate(element => element.scrollLeft <= Math.max(0, element.scrollWidth - element.clientWidth) + 1)).toBe(true)
      await expect.poll(() => actions.evaluate(element => {
        const scrollbar = element.querySelector(':scope > .os-scrollbar-horizontal')
        return scrollbar.classList.contains('os-scrollbar-unusable') === (element.scrollWidth <= element.clientWidth)
      })).toBe(true)
    }
  })

  test('history search filters entries', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('First test video')).toBeVisible()

    const filterInput = page.getByRole('searchbox', { name: 'Search in History' })
    await filterInput.fill('Second')

    await expect(page.getByText('Second test video')).toBeVisible()
    await expect(page.getByText('First test video')).toBeHidden()
  })

  test('keeps an existing entry in place when toggling watched status', async ({ page }) => {
    await goTo(page, 'history')

    const videos = page.locator('.ft-list-video')
    const secondVideo = videos.filter({ hasText: 'Second test video' })

    await secondVideo.hover()
    await secondVideo.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark As Watched' }).click()

    await expect(videos.nth(0)).toContainText('First test video')
    await expect(videos.nth(1)).toContainText('Second test video')

    await secondVideo.hover()
    await secondVideo.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unmark As Watched' }).click()

    await expect(videos.nth(0)).toContainText('First test video')
    await expect(videos.nth(1)).toContainText('Second test video')
  })

  test('does not offer watched actions for an active live history entry', async ({ page }) => {
    await goTo(page, 'history')

    const activeLiveStream = page.locator('.ft-list-video').filter({ hasText: 'Active live stream' })
    await activeLiveStream.hover()
    await activeLiveStream.locator('.title').click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: 'Mark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Unmark As Watched' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Remove From History' })).toBeVisible()
  })

  test('marks every history entry as watched', async ({ app, page }) => {
    await goTo(page, 'history')

    const markAllButton = page.getByRole('button', { name: 'Mark All As Watched' })
    await expect(markAllButton).not.toBeDisabled()
    await markAllButton.click()

    const prompt = page.getByRole('dialog', {
      name: 'Are you sure you want to mark all videos in your history as watched?'
    })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Mark All As Watched' }).click()

    await expect(markAllButton).toBeDisabled()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      const latestRecords = Object.values(Object.fromEntries(
        records.filter(record => record.videoId).map(record => [record.videoId, record])
      ))
      return latestRecords.every(record => {
        return record.isLive === true || record.isUpcoming === true || record.isWatched === true
      }) &&
        latestRecords.find(record => record.videoId === 'ccccccccccc')?.isWatched === false &&
        latestRecords.find(record => record.videoId === 'eeeeeeeeeee')?.isWatched === false &&
        latestRecords.find(record => record.videoId === 'fffffffffff')?.isWatched === true
    }).toBe(true)
  })
})

test.describe('history search pagination', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: false,
        uiScale: 125
      },
      history: [
        ...matchingHistoryEntries('Decoy', 100),
        ...matchingHistoryEntries('Alpha', 220, 1000),
        ...matchingHistoryEntries('Beta', 129, 2000),
        historyEntry('betacase000', 'beta match lowercase', now - 2500),
        ...matchingHistoryEntries('Gamma', 20, 3000)
      ]
    }
  })

  test('treats whitespace-only queries as cleared history when loading more', async ({ page }) => {
    await goTo(page, 'history')
    const input = page.getByRole('searchbox', { name: 'Search in History' })
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    const loadMore = page.getByRole('button', { name: 'Load More Videos' })
    await expect(videos).toHaveCount(100)
    await loadMore.click()
    await expect(videos).toHaveCount(200)

    await input.fill('   ')
    await expect(page.locator('.historySearchLoader')).toHaveCount(0)
    await expect(videos).toHaveCount(200)
    await loadMore.click()
    await expect(videos).toHaveCount(300)

    await input.fill('Alpha match')
    await expect(videos).toHaveCount(100)
    await input.fill('')
    await expect(videos).toHaveCount(300)
  })

  test('loads every filtered batch and resets the limit for a new query', async ({ page }) => {
    await goTo(page, 'history')

    const historySearch = page.locator('.ft-input-component').filter({
      has: page.getByRole('searchbox', { name: 'Search in History' })
    })
    const filterInput = historySearch.getByRole('searchbox', { name: 'Search in History' })
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    const loadMoreButton = page.getByRole('button', { name: 'Load More Videos' })

    await filterInput.fill('Alpha match')
    await expect(videos.first()).toContainText('Alpha match')
    await expect(videos).toHaveCount(100)
    await expect(loadMoreButton).toBeVisible()

    await loadMoreButton.click()
    await expect(videos).toHaveCount(200)
    await expect(loadMoreButton).toBeVisible()

    await scrollPageToEnd(page)
    await page.clock.install()
    await pauseClock(page)
    await updateInputWithoutScrolling(filterInput, 'Beta match')
    await expect(page.locator('.historySearchLoader')).toBeVisible()
    await expect(videos).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
    await page.clock.resume()
    await expect(videos.first()).toContainText('Beta match')
    await expect(videos).toHaveCount(100)
    await expect(loadMoreButton).toBeVisible()
    await expectPageScrollWithinRenderedRange(page)

    await loadMoreButton.click()
    await expect(videos).toHaveCount(130)
    await expect(loadMoreButton).toHaveCount(0)

    await scrollPageToEnd(page)
    await expect(videos.filter({ hasText: 'beta match lowercase' })).toHaveCount(1)
    await pauseClock(page)
    await page.getByRole('checkbox', { name: 'Case Sensitive Search' }).evaluate(element => element.click())
    await expect(page.locator('.historySearchLoader')).toBeVisible()
    await expect(videos).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
    await page.clock.resume()
    await expect(videos).toHaveCount(129)
    await expect(videos.filter({ hasText: 'beta match lowercase' })).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)

    await scrollPageToEnd(page)
    await expect(filterInput).toHaveAttribute('type', 'search')
    await filterInput.fill('')
    await expect(filterInput).toHaveValue('')
    await expect(videos.first()).toContainText('Decoy match')
    await expect(videos).toHaveCount(100)
    await expect(loadMoreButton).toBeVisible()
    await expectPageScrollWithinRenderedRange(page)

    await scrollPageToEnd(page)
    await updateInputWithoutScrolling(filterInput, 'Gamma match')
    await expect(videos.first()).toContainText('Gamma match')
    await expect(videos).toHaveCount(20)
    await expect(loadMoreButton).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
  })
})

test.describe('history search automatic pagination', () => {
  test.use({
    seed: {
      settings: {
        generalAutoLoadMorePaginatedItemsEnabled: true,
        uiScale: 125
      },
      history: [
        ...matchingHistoryEntries('Decoy', 100),
        ...matchingHistoryEntries('Automatic', 150, 1000)
      ]
    }
  })

  test('loads the next filtered batch when the pagination control enters view', async ({ page }) => {
    await goTo(page, 'history')

    const filterInput = page.getByRole('searchbox', { name: 'Search in History' })
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')

    await filterInput.fill('Automatic match')
    await expect(videos.first()).toContainText('Automatic match')
    await expect(videos).toHaveCount(100)
    await expect(page.getByRole('button', { name: 'Load More Videos' })).toHaveCount(0)
    await expect(page.locator('.ft-auto-load-next-page-wrapper')).toBeAttached()

    await trackHistoryNavigations(page)
    const scrollTop = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
      return window.scrollY
    })
    await expect(videos).toHaveCount(150)
    await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.__historyNavigations.completed.some(path => path.includes('searchDataLimit=200')))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scrollTop - 1)
  })
})

test.describe('watch history with an immediate watched threshold', () => {
  const immediateHistoryEntry = historyEntry(
    'ddddddddddd',
    'Immediately watched video',
    Date.now(),
    true
  )

  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        watchedPercentageThreshold: 0,
      },
      profiles: [{
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{
          id: immediateHistoryEntry.authorId,
          name: immediateHistoryEntry.author,
          thumbnail: '',
        }]
      }],
      history: [immediateHistoryEntry],
      subscriptionCache: [{
        _id: immediateHistoryEntry.authorId,
        videos: [immediateHistoryEntry],
        videosTimestamp: new Date().toISOString(),
      }]
    }
  })

  test('removes a history entry when it is marked as unwatched', async ({ app, page }) => {
    await goTo(page, 'history')

    const video = page.locator('.ft-list-video').filter({ hasText: 'Immediately watched video' })
    await video.hover()
    await video.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unmark As Watched' }).click()

    await expect(video).toHaveCount(0)
    await expect(page.getByText('Your history list is currently empty.')).toBeVisible()
    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'history')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.some(record => record._id === 'ddddddddddd')
    }).toBe(false)
  })

  test('removes and cleanly re-adds a history entry from the subscriptions feed', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="videos"]').click()

    const video = page.locator('.ft-list-video').filter({ hasText: 'Immediately watched video' })
    await expect(video.locator('.watchedProgressBar')).toHaveCount(1)
    await video.hover()
    await video.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unmark As Watched' }).click()

    await expect(video).toBeVisible()
    await expect(video.locator('.watchedProgressBar')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const store = window.$store
      return store.getters.getHistoryCacheById.ddddddddddd
    })).toBeUndefined()

    await video.hover()
    await video.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark As Watched' }).click()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'history')
      const records = contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      return records.filter(record => record.videoId === 'ddddddddddd').at(-1)?.watchProgress
    }).toBe(0)
    await expect(video.locator('.watchedProgressBar')).toHaveCount(0)
  })
})

test.describe('history cleanup', () => {
  test.use({
    seed: {
      history: [
        historyEntry('rrrrrrrrrrr', 'Recent video', Date.now() - 1000),
        historyEntry('ooooooooooo', 'Old video', Date.now() - 100 * 86_400_000)
      ]
    }
  })

  test('deletes only entries older than the selected cutoff', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Recent video')).toBeVisible()
    await expect(page.getByText('Old video')).toBeVisible()

    await page.locator('.headingActions').getByRole('button', { name: 'Delete', exact: true }).click()
    await chooseSelectOption(page.locator('.cleanupPromptContent select'), '30')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Old video')).toBeHidden()
    await expect(page.getByText('Recent video')).toBeVisible()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.some(record => record._id === 'ooooooooooo')
    }).toBe(false)
  })

  test('deletes all entries when all time is selected', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Recent video')).toBeVisible()

    await page.locator('.headingActions').getByRole('button', { name: 'Delete', exact: true }).click()
    await chooseSelectOption(page.locator('.cleanupPromptContent select'), 'all')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Watch history has been cleared')).toBeVisible()
    await expect(page.getByText('Recent video')).toBeHidden()
    await expect(page.getByText('Old video')).toBeHidden()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.some(record => ['rrrrrrrrrrr', 'ooooooooooo'].includes(record._id))
    }).toBe(false)
  })

  test('reports a failure when deleting all entries fails', async ({ page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Recent video')).toBeVisible()
    await page.evaluate(() => {
      window.$store._actions.removeAllHistory = [() => Promise.resolve(false)]
    })

    await page.locator('.headingActions').getByRole('button', { name: 'Delete', exact: true }).click()
    await chooseSelectOption(page.locator('.cleanupPromptContent select'), 'all')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText('Storage cleanup failed')).toBeVisible()
    await expect(page.getByText('Watch history has been cleared')).toBeHidden()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('selects a history cutoff from the modal dropdown', async ({ page }) => {
    await goTo(page, 'history')
    await page.locator('.headingActions').getByRole('button', { name: 'Delete', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveAccessibleName('Delete')
    const combobox = dialog.getByRole('combobox', { name: /Delete entries older than/i })
    await combobox.click()

    const dropdown = page.getByRole('listbox', { name: /Delete entries older than/i })
    await expect(dropdown).toBeVisible()
    await expect(page.locator('.prompt').getByRole('listbox', { name: /Delete entries older than/i })).toBeVisible()
    await dropdown.getByRole('option', { name: '1 month' }).click()

    await expect(combobox).toContainText('1 month')
    await expect(dialog).toBeVisible()
  })
})

test.describe('legacy watch history', () => {
  const timeWatched = Date.now() - 1000

  test.use({
    seed: {
      history: [
        {
          _id: 'legacyvideo',
          videoId: 'legacyvideo',
          title: 'Legacy imported video',
          author: 'Test Channel',
          authorId: 'UC-test-channel-id',
          published: timeWatched,
          description: '',
          viewCount: 1234,
          lengthSeconds: 100,
          watchProgress: 0.95,
          timeWatched,
          isLive: false,
          type: 'video'
        }
      ]
    }
  })

  test('migrates fractional progress and watched status on load', async ({ app, page }) => {
    await goTo(page, 'history')
    await expect(page.getByText('Legacy imported video')).toBeVisible()

    await expect.poll(async () => {
      const contents = readDatastore(app.userDataDir, 'history')
      const records = contents.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      return records.find((record) => record._id === 'legacyvideo')
    }).toMatchObject({ watchProgress: 95, isWatched: true, isLive: false })
  })
})

test.describe('history search feedback', () => {
  test.use({
    seed: {
      settings: { uiScale: 110 },
      history: [
        historyEntry('searchaaaaa', 'City night walking tour', now),
        historyEntry('searchbbbbb', 'Another video', now - 1000)
      ]
    }
  })

  test('replaces stale results and empty messages with a spinner until the latest query settles', async ({ page }) => {
    await goTo(page, 'history')
    const input = page.getByRole('searchbox', { name: 'Search in History' })
    const videos = page.locator('.ft-list-video')
    const loader = page.locator('.historySearchLoader')
    await expect(videos).toHaveCount(2)
    await page.clock.install()
    await pauseClock(page)

    await input.fill('city tour')
    await expect(loader).toBeVisible()
    await expect(videos).toHaveCount(0)
    await expect(input).toBeFocused()
    await page.clock.runFor(600)
    await expect(loader).toHaveCount(0)
    await expect(videos).toHaveCount(1)
    await expect(videos).toContainText('City night walking tour')

    await input.fill('zzzzzz')
    await page.clock.runFor(100)
    await input.fill('Another')
    await page.clock.runFor(150)
    await expect(loader).toBeVisible()
    await expect(videos).toHaveCount(0)
    await page.clock.runFor(300)
    await expect(videos).toHaveCount(1)
    await expect(videos).toContainText('Another video')

    await input.fill('zzzzzz')
    await page.clock.runFor(600)
    const empty = page.getByText('There are no videos in your history that match your search')
    await expect(loader).toHaveCount(0)
    await expect(videos).toHaveCount(0)
    await expect(empty).toBeVisible()
    await input.fill('')
    await expect(loader).toBeVisible()
    await expect(empty).toHaveCount(0)
    await page.clock.runFor(600)
    await expect(videos).toHaveCount(2)
    await expect(loader).toHaveCount(0)
  })

  test('refreshes search results in place when history changes in the background', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('searchbox', { name: 'Search in History' }).fill('city')
    const videos = page.locator('.ft-list-video')
    const loader = page.locator('.historySearchLoader')
    await expect(videos).toHaveCount(1)
    await expect(loader).toHaveCount(0)

    // Sync merges replace the history array without changing the search inputs.
    const flashes = await page.evaluate(newRecord => new Promise(resolve => {
      const flashes = []
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element && node.matches('.historySearchLoader')) flashes.push('loader')
          }
          for (const node of mutation.removedNodes) {
            if (node instanceof Element && (node.matches('.ft-list-video') || node.querySelector('.ft-list-video'))) flashes.push('results removed')
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      window.$store.commit('applyHistorySyncChanges', { insertions: [newRecord], updates: [], deletions: [] })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        observer.disconnect()
        resolve(flashes)
      }))
    }), historyEntry('searchccccc', 'City river cruise', now + 1000))
    expect(flashes).toEqual([])
    await expect(videos).toHaveCount(2)
    await expect(videos.first()).toContainText('City river cruise')
    await expect(loader).toHaveCount(0)
  })
})

test.describe('history search locale changes', () => {
  test.use({
    seed: {
      settings: { uiScale: 125, currentLocale: 'en-US' },
      history: matchingHistoryEntries('Istanbul', 120)
    }
  })

  test('refreshes locale-sensitive matches and clamps shorter results after changing language', async ({ page }) => {
    await goTo(page, 'history')
    await page.getByRole('searchbox', { name: 'Search in History' }).fill('i')
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    await expect(videos).toHaveCount(100)
    await scrollPageToEnd(page)

    await page.clock.install()
    await pauseClock(page)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateCurrentLocale', 'tr')
    })
    await expect(page.locator('.historySearchLoader')).toBeVisible()
    await expect(videos).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
    await page.clock.resume()
    await expect(videos).toHaveCount(0)
    await expect(page.locator('.historySearchLoader')).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
  })
})

test.describe('history date and channel browsing', () => {
  const dated = (id, title, day, extra = {}) => historyEntry(id, title, new Date(2026, 9, day, 12).getTime(), false, extra)
  test.use({
    seed: {
      settings: { generalAutoLoadMorePaginatedItemsEnabled: false, uiScale: 125 },
      history: [
        ...Array.from({ length: 100 }, (_, index) => dated(`decoy${String(index).padStart(6, '0')}`, `Recent video ${index}`, 14)),
        ...Array.from({ length: 220 }, (_, index) => dated(`older${String(index).padStart(6, '0')}`, `City walk ${index}`, 12, { author: 'Walking Channel', authorId: 'UC-walking' })),
        dated('nightwalk01', 'Night walk', 13, { author: 'Walking Channel', authorId: 'UC-walking' }),
        dated('otherwalk01', 'Other city walk', 12, { author: 'Other Channel', authorId: 'UC-other' }),
        dated('imported001', 'Imported video', 11, { author: 'Imported Channel', authorId: '' }),
      ]
    }
  })

  async function chooseChannel(page, name) {
    await page.getByRole('combobox', { name: 'Channel', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }

  test.describe('mixed history channel metadata', () => {
    test.use({
      seed: {
        settings: { generalAutoLoadMorePaginatedItemsEnabled: false, uiScale: 125 },
        history: [
          dated('knownwalk01', 'Modern walk', 14, { author: 'Walking Channel', authorId: 'UC-walking' }),
          dated('legacywalk1', 'Legacy walk', 12, { author: 'Walking Channel', authorId: '' }),
          dated('sharedone01', 'First shared', 12, { author: 'Shared Channel', authorId: 'UC-first' }),
          dated('sharedtwo01', 'Second shared', 12, { author: 'Shared Channel', authorId: 'UC-second' }),
          dated('sharedold01', 'Legacy shared', 12, { author: 'Shared Channel', authorId: '' }),
        ]
      }
    })

    test('includes ID-less channel records without merging ambiguous names', async ({ page }) => {
      await goTo(page, 'history')
      await openHistoryFilters(page)
      await page.getByLabel('To', { exact: true }).fill('2026-10-12')
      await page.getByRole('combobox', { name: 'Channel', exact: true }).click()
      await expect(page.getByRole('option', { name: 'Walking Channel', exact: true })).toHaveCount(1)
      await page.getByRole('option', { name: 'Walking Channel', exact: true }).click()
      const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
      await expect(videos).toHaveCount(1)
      await expect(videos.first()).toContainText('Legacy walk')
      await page.getByRole('searchbox', { name: 'Search in History' }).fill('Legacy walk')
      await expect(videos).toHaveCount(1)
      await page.getByRole('searchbox', { name: 'Search in History' }).fill('')
      for (const [channel, title] of [['Shared Channel (UC-first)', 'First shared'], ['Shared Channel (UC-second)', 'Second shared'], ['Shared Channel', 'Legacy shared']]) {
        await chooseChannel(page, channel)
        await expect(videos).toHaveCount(1)
        await expect(videos.first()).toContainText(title)
      }
    })
  })

  test('combines dates, channel and search across the complete history', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    await page.getByLabel('From', { exact: true }).fill('2026-10-12')
    await page.getByLabel('To', { exact: true }).fill('2026-10-13')
    await chooseChannel(page, 'Walking Channel')
    await expect(videos).toHaveCount(100)
    await expect(videos.first()).toContainText('Night walk')
    await page.getByRole('searchbox', { name: 'Search in History' }).fill('City walk')
    await expect(videos).toHaveCount(100)
    await expect(videos.first()).toContainText('City walk')
    await expect(videos.filter({ hasText: 'Other city walk' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(videos).toHaveCount(200)
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(videos).toHaveCount(220)
    await expect(page.getByRole('button', { name: 'Load More Videos' })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Sort By' }).click()
    await page.getByRole('option', { name: 'Date Watched (Oldest)' }).click()
    await expect(videos.first()).toContainText('City walk 219')

    const savedUrl = page.url()
    await goTo(page, 'trending')
    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(savedUrl)
    await openHistoryFilters(page)
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('2026-10-12')
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('2026-10-13')
    await expect(page.getByRole('combobox', { name: 'Channel', exact: true })).toContainText('Walking Channel')
    await expect(videos).toHaveCount(220)
    await expect(page.getByRole('searchbox', { name: 'Search in History' })).toHaveValue('City walk')

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('')
    await expect(page.getByRole('searchbox', { name: 'Search in History' })).toHaveValue('City walk')
    await expect(videos).toHaveCount(100)
  })

  test('paginates date-only results and resets the limit when changing filters', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    await page.getByLabel('To', { exact: true }).fill('2026-10-12')
    await expect(videos).toHaveCount(100)
    await expect(videos.first()).toContainText('City walk')
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(videos).toHaveCount(200)
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(videos).toHaveCount(222)
    await expect(page.getByRole('button', { name: 'Load More Videos' })).toHaveCount(0)
    await chooseChannel(page, 'Walking Channel')
    await expect(videos).toHaveCount(100)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(videos).toHaveCount(100)
    await expect(videos.first()).toContainText('Recent video')
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeDisabled()
  })

  test('synchronizes filters when navigating within the history route', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    await page.getByLabel('From', { exact: true }).fill('2026-10-12')
    await page.getByLabel('To', { exact: true }).fill('2026-10-13')
    await chooseChannel(page, 'Walking Channel')
    await page.getByRole('searchbox', { name: 'Search in History' }).fill('City walk')
    await page.locator('.historySearchOptions .switch-label').click()
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(videos).toHaveCount(200)
    const savedUrl = page.url()

    await goTo(page, 'history')
    await expect(page).toHaveURL(/#\/history$/)
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('')
    await expect(page.getByRole('combobox', { name: 'Channel', exact: true })).toContainText('All channels')
    await expect(page.getByRole('searchbox', { name: 'Search in History' })).toHaveValue('')
    await expect(page.getByRole('checkbox', { name: 'Case Sensitive Search' })).not.toBeChecked()
    await expect(videos).toHaveCount(100)
    await expect(videos.first()).toContainText('Recent video')

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(savedUrl)
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('2026-10-12')
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('2026-10-13')
    await expect(page.getByRole('combobox', { name: 'Channel', exact: true })).toContainText('Walking Channel')
    await expect(page.getByRole('searchbox', { name: 'Search in History' })).toHaveValue('City walk')
    await expect(page.getByRole('checkbox', { name: 'Case Sensitive Search' })).toBeChecked()
    await expect(videos).toHaveCount(200)
  })

  test('keeps newer text edits while earlier URL saves are queued', async ({ page }) => {
    await goTo(page, 'history')
    await trackHistoryNavigations(page, true)
    const input = page.getByRole('searchbox', { name: 'Search in History' })
    await input.fill('City')
    await expect.poll(() => page.evaluate(() => window.__historyNavigations.releases.length)).toBe(1)
    await input.fill('City walk')
    await releaseHistoryNavigation(page, 1)
    await expect(input).toHaveValue('City walk')
    await input.press('End')
    await input.pressSequentially(' 219')
    // Drain one queued save per keystroke without letting older URLs undo edits.
    for (let count = 2; count <= 6; count++) {
      await releaseHistoryNavigation(page, count)
      await expect(input).toHaveValue('City walk 219')
    }
    await expect(page).toHaveURL(/searchQueryText=City\+walk\+219/)
  })

  test('keeps all browse filters cleared while their URL saves are queued', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    await page.getByLabel('From', { exact: true }).fill('2026-10-12')
    await page.getByLabel('To', { exact: true }).fill('2026-10-13')
    await chooseChannel(page, 'Walking Channel')
    await expect.poll(() => new URLSearchParams(page.url().split('?')[1]).get('channel')).toBe('id:UC-walking')
    await trackHistoryNavigations(page, true)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    for (let count = 1; count <= 3; count++) {
      await releaseHistoryNavigation(page, count)
      await expect(page.getByLabel('From', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('To', { exact: true })).toHaveValue('')
      await expect(page.getByRole('combobox', { name: 'Channel', exact: true })).toContainText('All channels')
    }
    await expect(page).toHaveURL(/#\/history$/)
  })

  test('preserves scroll when loading more date-filtered history', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    await page.getByLabel('To', { exact: true }).fill('2026-10-12')
    await expect(page).toHaveURL(/searchDataLimit=100/)
    await expect(page.locator('.historyResults')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *').first()).toContainText('City walk')
    await trackHistoryNavigations(page)
    await scrollPageToEnd(page)
    const scrollTop = await page.evaluate(() => window.scrollY)
    expect(scrollTop).toBeGreaterThan(100)
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect.poll(() => page.evaluate(() => window.__historyNavigations.completed.some(path => path.includes('searchDataLimit=200')))).toBe(true)
    await expect(page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')).toHaveCount(200)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scrollTop - 1)
    await expectPageScrollWithinRenderedRange(page)
  })

  test('shows invalid and empty ranges and supports channels without IDs', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    await page.getByLabel('From', { exact: true }).fill('2026-10-14')
    await page.getByLabel('To', { exact: true }).fill('2026-10-12')
    await expect(page.getByRole('alert')).toHaveText('The From date must be on or before the To date.')
    await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('No videos in your history match these filters.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await chooseChannel(page, 'Imported Channel')
    await expect(page.locator('.ft-list-video')).toHaveCount(1)
    await expect(page.locator('.ft-list-video')).toContainText('Imported video')
    await page.getByLabel('From', { exact: true }).fill('2026-10-12')
    await expect(page.getByText('No videos in your history match these filters.')).toBeVisible()
    await page.getByLabel('From', { exact: true }).fill('')
    await page.evaluate(() => window.$store.dispatch('removeFromHistory', 'imported001'))
    await expect(page.getByRole('combobox', { name: 'Channel', exact: true })).toContainText('Imported Channel')
    await expect(page.locator('.ft-list-video')).toHaveCount(0)
  })

  test('clamps scroll after date and channel filters shorten results', async ({ page }) => {
    await goTo(page, 'history')
    await openHistoryFilters(page)
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    for (const [label, date] of [['From', '2026-10-13'], ['To', '2026-10-11']]) {
      await scrollPageToEnd(page)
      await updateInputWithoutScrolling(page.getByLabel(label, { exact: true }), date)
      await expectPageScrollWithinRenderedRange(page)
      await page.getByRole('button', { name: 'Clear filters' }).click()
      await expect(videos).toHaveCount(100)
    }
    await chooseChannel(page, 'Walking Channel')
    await expect(videos).toHaveCount(100)
    await scrollPageToEnd(page)
    // Change the picker without scrolling the page back to the control.
    await page.locator('.historyChannelFilter select').evaluate(select => {
      // The hidden native select only holds the current channel.
      select.add(new Option('Other Channel', 'id:UC-other'))
      select.value = 'id:UC-other'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(videos).toHaveCount(1)
    await expectPageScrollWithinRenderedRange(page)

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await chooseChannel(page, 'Walking Channel')
    await expect(videos).toHaveCount(100)
    await scrollPageToEnd(page)
    await page.evaluate(async () => {
      const store = window.$store
      const record = store.getters.getHistoryCacheSorted.find(record => record.authorId === 'UC-walking')
      await store.dispatch('overwriteHistory', new Map([[record.videoId, record]]))
    })
    await expect(videos).toHaveCount(1)
    await expectPageScrollWithinRenderedRange(page)
    await scrollPageToEnd(page)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('removeFromHistory', store.getters.getHistoryCacheSorted[0].videoId)
    })
    await expect(videos).toHaveCount(0)
    await expectPageScrollWithinRenderedRange(page)
  })

  test('collapses the grouped filter card without changing active options or results', async ({ page }) => {
    await goTo(page, 'history')
    const toggle = page.locator('.historyFilterToggleRow').getByRole('button', { name: /^Search filters$/i })
    const panel = page.getByRole('region', { name: /^Search filters$/i })
    const videos = page.locator('.tabContent[aria-hidden="false"] .autoGrid > *')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()
    await expect(page.getByRole('combobox', { name: 'Sort By' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Case Sensitive Search' })).toBeVisible()
    await toggle.focus()
    await toggle.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toHaveAttribute('id', await toggle.getAttribute('aria-controls'))
    await expect(panel.getByRole('checkbox', { name: 'Case Sensitive Search' })).toHaveCount(0)
    await panel.getByLabel('From', { exact: true }).fill('2026-10-12')
    await panel.getByLabel('To', { exact: true }).fill('2026-10-13')
    await chooseChannel(page, 'Walking Channel')
    await page.locator('.historySearchOptions .switch-label').click()
    await page.getByRole('combobox', { name: 'Sort By' }).click()
    await page.getByRole('option', { name: 'Date Watched (Oldest)' }).click()
    await expect(videos).toHaveCount(100)
    await expect(videos.first()).toContainText('City walk 219')
    await scrollPageToEnd(page)
    await toggle.evaluate(button => button.click())
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()
    await expect(page.getByRole('checkbox', { name: 'Case Sensitive Search' })).toBeVisible()
    await expect(videos).toHaveCount(100)
    // Offscreen cards release their text while keeping the stable video ID.
    await expect(videos.first()).toHaveAttribute('data-video-id', 'older000219')
    await expectPageScrollWithinRenderedRange(page)
    const sort = page.getByRole('combobox', { name: 'Sort By' })
    await expect(sort).toBeVisible()
    await sort.click()
    await page.getByRole('option', { name: 'Date Watched (Newest)' }).click()
    await expect(videos.first()).toContainText('Night walk')
    await sort.click()
    await page.getByRole('option', { name: 'Date Watched (Oldest)' }).click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.evaluate(button => button.click())
    await expect(panel).toBeVisible()
    await expect(panel.getByLabel('From', { exact: true })).toHaveValue('2026-10-12')
    await expect(panel.getByLabel('To', { exact: true })).toHaveValue('2026-10-13')
    await expect(panel.getByRole('combobox', { name: 'Channel', exact: true })).toContainText('Walking Channel')
    await expect(page.getByRole('checkbox', { name: 'Case Sensitive Search' })).toBeChecked()
    await expect(page.getByRole('combobox', { name: 'Sort By' })).toContainText('Date Watched (Oldest)')
    await expect(videos).toHaveCount(100)
  })
})

test.describe('lazy history channel picker', () => {
  const channelNames = Array.from({ length: 400 }, (_, index) => `Picker channel ${String(index).padStart(4, '0')}`)
  test.use({
    seed: {
      history: channelNames.map((author, index) =>
        historyEntry(`picker${String(index).padStart(5, '0')}`, `Picker video ${index}`, now - index * 60_000, false, { author, authorId: `UC-picker-${index}` })),
    },
  })

  async function expectListWithinScrollRange(list) {
    await expect.poll(() => list.evaluate(menu => {
      const maximumScrollTop = Math.max(0, menu.scrollHeight - menu.clientHeight)
      const scrollbar = menu.querySelector(':scope > .os-scrollbar-vertical')
      const rows = menu.querySelectorAll(':scope > li')
      const contentBottom = rows[rows.length - 1].getBoundingClientRect().bottom +
        Number.parseFloat(getComputedStyle(menu).paddingBottom)
      return {
        withinRange: menu.scrollTop <= maximumScrollTop + 1,
        // Scrolled lists end at their content without empty space below it.
        noEmptySpace: menu.scrollTop <= 1 || Math.abs(contentBottom - menu.getBoundingClientRect().bottom) <= 1,
        scrollbarMatchesOverflow: scrollbar.classList.contains('os-scrollbar-unusable') === (maximumScrollTop <= 1),
      }
    })).toEqual({ withinRange: true, noEmptySpace: true, scrollbarMatchesOverflow: true })
  }

  async function openChannelPicker(page) {
    await openHistoryFilters(page)
    const picker = page.getByRole('combobox', { name: 'Channel', exact: true })
    await picker.click()
    return page.locator(`#${await picker.getAttribute('aria-controls')}`)
  }

  test('reopens at a late selection and keeps rows in place while loading earlier pages @scale', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    const selected = channelNames.at(-150)
    await goTo(page, 'history')
    let dropdown = await openChannelPicker(page)
    await page.locator('.mobileSheet[open]').getByRole('searchbox', { name: 'Search', exact: true }).fill(selected)
    await dropdown.getByRole('option', { name: selected, exact: true }).click()
    const picker = page.getByRole('combobox', { name: 'Channel', exact: true })
    await expect(picker).toContainText(selected)
    await expect(page.locator('.mobileSheet[open]')).toHaveCount(0)

    await picker.click()
    dropdown = page.locator(`#${await picker.getAttribute('aria-controls')}`)
    const options = dropdown.getByRole('option')
    const selectedOption = dropdown.getByRole('option', { name: selected, exact: true })
    await expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    await expect(selectedOption).toBeInViewport()
    // Only the selected option's page is rendered, not the pages before it.
    expect(await options.count()).toBeLessThanOrEqual(200)
    await expect(dropdown.getByRole('option', { name: 'All channels', exact: true })).toHaveCount(0)

    // Loading the page above must not move the rows that are already visible.
    const firstRendered = options.first()
    const firstName = await firstRendered.textContent()
    const renderedCount = await options.count()
    await dropdown.evaluate(menu => { menu.scrollTop = 0 })
    await expect.poll(() => options.count()).toBeGreaterThan(renderedCount)
    await expect.poll(() => dropdown.evaluate(menu => menu.scrollTop)).toBeGreaterThan(0)
    await expect(dropdown.getByRole('option', { name: firstName.trim(), exact: true })).toBeInViewport()
  })

  test('clamps the scrolled picker when searching shortens it @scale', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await goTo(page, 'history')
    const dropdown = await openChannelPicker(page)
    const sheet = page.locator('.mobileSheet[open]').filter({ has: dropdown })
    const options = dropdown.getByRole('option')
    const scrollbar = dropdown.locator(':scope > .os-scrollbar-vertical')

    // Scroll to the bottom until every page is loaded.
    await expect(async () => {
      await dropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })
      expect(await options.count()).toBe(channelNames.length + 1)
    }).toPass()
    await expect(dropdown.getByRole('option', { name: channelNames.at(-1), exact: true })).toBeInViewport()
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await sheet.getByRole('searchbox', { name: 'Search', exact: true }).fill('0123')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toBeInViewport()
    await expect.poll(() => dropdown.evaluate(menu =>
      menu.scrollTop <= 1 && menu.scrollHeight <= menu.clientHeight + 1
    )).toBe(true)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })

  test('keeps loading pages when the list jumps to its new end as soon as a page loads', async ({ page }) => {
    await goTo(page, 'history')
    const dropdown = await openChannelPicker(page)
    const options = dropdown.getByRole('option')
    await expect(options).toHaveCount(100)
    // Scrolling to the end again before the next frame, like dragging the scrollbar
    // to the end, leaves the end of the list in view across the page load.
    await dropdown.evaluate(menu => {
      new MutationObserver(() => { menu.scrollTop = menu.scrollHeight }).observe(menu, { childList: true })
      menu.scrollTop = menu.scrollHeight
    })
    await expect(options).toHaveCount(channelNames.length + 1)
  })

  test('resets the scrolled picker when it crosses the phone layout breakpoint @scale', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await goTo(page, 'history')
    const dropdown = await openChannelPicker(page)
    const options = dropdown.getByRole('option')
    await expect(async () => {
      await dropdown.evaluate(menu => { menu.scrollTop = menu.scrollHeight })
      expect(await options.count()).toBe(channelNames.length + 1)
    }).toPass()

    // Leaving the phone layout closes the sheet instead of keeping a shortened
    // list open. Reopening starts from the first page within its range.
    const picker = page.getByRole('combobox', { name: 'Channel', exact: true })
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    await expect(dropdown).toHaveCount(0)
    await picker.click()
    await expect(dropdown).not.toHaveClass(/phonePicker/)
    await expect(options).toHaveCount(100)
    await expect.poll(() => dropdown.evaluate(menu => menu.scrollTop)).toBeLessThanOrEqual(1)
    await expectListWithinScrollRange(dropdown)
  })

  test('End and Home reach the ends of the phone picker', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await goTo(page, 'history')
    const dropdown = await openChannelPicker(page)
    await expect(dropdown).toBeFocused()
    await page.keyboard.press('End')
    await expect(dropdown.getByRole('option', { name: channelNames.at(-1), exact: true })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(dropdown.getByRole('option', { name: 'All channels', exact: true })).toBeFocused()
  })
})
