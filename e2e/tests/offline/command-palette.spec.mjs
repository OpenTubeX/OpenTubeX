import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchHistoryEntry } from '../../helpers/watch.mjs'
import { DEMO_MEDIA_PATH } from '../../helpers/media.mjs'
import { copyFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const mainProfile = {
  _id: 'allChannels',
  name: 'All Channels',
  bgColor: '#d50000',
  textColor: '#FFFFFF',
  subscriptions: []
}

const secondProfile = {
  _id: 'e2eprofile',
  name: 'Second profile',
  bgColor: '#558B2F',
  textColor: '#FFFFFF',
  icon: {
    type: 'emoji',
    value: '🦊'
  },
  subscriptions: []
}

async function scrollResultsToBottom(page) {
  const results = page.locator('.commandPaletteResults')
  await results.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
}

async function expectValidResultsScroll(page) {
  const results = page.locator('.commandPaletteResults')
  await expect.poll(() => results.evaluate(element => {
    const content = element.querySelector('.commandPaletteResultsContent').getBoundingClientRect()
    const viewport = element.getBoundingClientRect()
    const overflow = element.scrollHeight > element.clientHeight + 1
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    return {
      validOffset: element.scrollTop >= 0 && element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1,
      noEmptySpace: overflow ? content.bottom >= viewport.bottom - 1 : content.top >= viewport.top - 1 && content.bottom <= viewport.bottom + 1,
      matchingScrollbar: scrollbar.classList.contains('os-scrollbar-unusable') === !overflow,
    }
  })).toEqual({ validOffset: true, noEmptySpace: true, matchingScrollbar: true })
}

test('opens with the configured shortcut and supports accessible fuzzy keyboard search', async ({ page }) => {
  await page.keyboard.press('Control+k')

  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await expect(dialog).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveAccessibleName('Search commands, settings, and local videos')
  await expect(page.getByRole('listbox')).toHaveAccessibleName('Results')
  await expect(input).toHaveAttribute('placeholder', 'Search commands, settings, and local videos…')
  await expect(dialog.locator('.textInputLabelText')).toHaveCount(0)
  await expect(dialog.locator('.commandPaletteTitle')).toHaveCount(0)
  const [searchBounds, closeBounds] = await Promise.all([
    dialog.locator('.commandPaletteSearch').boundingBox(),
    dialog.getByRole('button', { name: 'Close' }).boundingBox()
  ])
  expect(searchBounds).not.toBeNull()
  expect(closeBounds).not.toBeNull()
  const searchCenterY = searchBounds.y + searchBounds.height / 2
  const closeCenterY = closeBounds.y + closeBounds.height / 2
  expect(Math.abs(searchCenterY - closeCenterY)).toBeLessThanOrEqual(1)
  expect(closeBounds.x).toBeGreaterThan(searchBounds.x + searchBounds.width)
  await expect(page.locator('.commandPaletteResults')).toHaveAttribute(
    'data-overlayscrollbars-viewport'
  )
  await expect(page.locator('.topNav')).toHaveAttribute('inert', '')

  await input.fill('tab')
  await expect(page.getByRole('option', { name: 'Create a new tab' }).locator('strong'))
    .toHaveText('tab')

  await input.fill('captions')
  const captions = page.getByRole('option', { name: /Toggle captions ON\/OFF/ })
  await expect(captions).toHaveAttribute('aria-disabled', 'true')
  await expect(captions).toContainText('Open a video first')
  await input.press('Enter')
  await expect(dialog).toBeVisible()

  await input.fill('trnding')
  await expect(page.getByRole('option', { name: 'Trending', exact: true })).toBeVisible()
  await input.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/#\/trending/)
})

test('keeps the backdrop mounted through pointer release without activating the page', async ({ page }) => {
  await page.evaluate(() => {
    window.__backdropBackgroundClicks = 0
    const button = document.createElement('button')
    button.dataset.backdropBackgroundTarget = ''
    button.style.cssText = 'position:fixed;inset:0 auto auto 0;width:48px;height:48px;z-index:0'
    button.addEventListener('click', () => { window.__backdropBackgroundClicks++ })
    document.body.append(button)
  })
  await page.keyboard.press('Control+k')

  const backdrop = page.locator('.commandPaletteBackdrop')
  await expect(backdrop).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden')

  await page.mouse.move(12, 12)
  await page.mouse.down()
  await expect(backdrop).toBeVisible()
  await page.mouse.up()

  await expect(backdrop).toBeHidden()
  expect(await page.evaluate(() => window.__backdropBackgroundClicks)).toBe(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('')
})

test('clamps the results scroll position after filtering to a shorter list', async ({ page }) => {
  await page.keyboard.press('Control+k')

  const input = page.getByRole('combobox', { name: 'Search commands' })
  const results = page.locator('.commandPaletteResults')
  const scrollbar = results.locator(':scope > .os-scrollbar-vertical')

  await results.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

  await input.fill('toggle captions on off')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect.poll(() => results.evaluate(element => {
    const content = element.querySelector('.commandPaletteResultsContent')
    const contentRect = content.getBoundingClientRect()
    const viewportRect = element.getBoundingClientRect()

    return {
      scrollTop: element.scrollTop,
      hasOverflow: element.scrollHeight > element.clientHeight + 1,
      contentStartsInViewport: contentRect.top >= viewportRect.top - 1,
      contentEndsInViewport: contentRect.bottom <= viewportRect.bottom + 1
    }
  })).toEqual({
    scrollTop: 0,
    hasOverflow: false,
    contentStartsInViewport: true,
    contentEndsInViewport: true
  })
  await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
})

test('uses arrow keys and opens a specific settings section', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('appearance')

  const activeOptionId = await input.getAttribute('aria-activedescendant')
  await expect(page.locator(`#${activeOptionId}`)).toContainText('Appearance')
  await input.press('Enter')

  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(settings.locator('.settingsMenu .active')).toContainText('Appearance')
})

test('finds and highlights an individual setting', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('thumbnail preference')

  const setting = page.getByRole('option', { name: /Thumbnail Preference/ })
  await expect(setting).toContainText('Appearance')
  await input.press('Enter')

  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(settings.locator('.settingsMenu .active')).toContainText('Appearance')
  await expect(settings.locator('.settingsSearchTarget'))
    .toContainText('Thumbnail Preference')
})

test('transfers focus to Find in Page', async ({ page }) => {
  const navigationSearch = page.locator('.topNav .searchInput input.ft-input')
  await navigationSearch.focus()
  await expect(navigationSearch).toBeFocused()

  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('find text on the current page')
  await input.press('Enter')

  await expect(page.locator('.findbarInput')).toBeFocused()
  await expect(page.locator('.findbarInput')).toHaveAttribute('placeholder', 'Find in page')
  await expect(page.locator('.findbar .textInputLabelText')).toHaveCount(0)
})

test('restores prior focus when dismissed', async ({ page }) => {
  const navigationSearch = page.locator('.topNav .searchInput input.ft-input')
  await navigationSearch.focus()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search commands' }).press('Escape')

  await expect(navigationSearch).toBeFocused()
})

test('consumes Escape inside the command palette once', async ({ page }) => {
  await page.evaluate(() => {
    window.__commandPaletteEscapes = 0
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.__commandPaletteEscapes++
    })
  })
  await page.keyboard.press('Control+k')

  await page.getByRole('combobox', { name: 'Search commands' }).press('Escape')

  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden()
  expect(await page.evaluate(() => window.__commandPaletteEscapes)).toBe(0)
})

test('hides pages that are unavailable without an Invidious instance', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })

  await input.fill('most popular')
  await expect(page.getByRole('option', { name: 'Most Popular', exact: true })).toHaveCount(0, { timeout: 1000 })
})

test.describe('Invidious navigation commands', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        defaultInvidiousInstance: 'https://invidious.test'
      }
    }
  })

  test('hides Trending without Local API fallback', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })

    await input.fill('most popular')
    await expect(page.getByRole('option', { name: 'Most Popular', exact: true })).toBeVisible()
    await input.fill('trending')
    await expect(page.getByRole('option', { name: 'Trending', exact: true })).toHaveCount(0, { timeout: 1000 })
  })
})

test.describe('fallback navigation commands', () => {
  test.use({
    seed: {
      settings: {
        backendFallback: true,
        hidePopularVideos: true,
        hideTrendingVideos: true
      }
    }
  })

  test('ignores distraction-free visibility settings', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })

    await input.fill('most popular')
    await expect(page.getByRole('option', { name: 'Most Popular', exact: true })).toBeVisible()
    await input.fill('trending')
    await expect(page.getByRole('option', { name: 'Trending', exact: true })).toBeVisible()
  })
})

test('shows each tab page icon in switch commands', async ({ page }) => {
  const historyTab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/history',
    title: 'History tab',
    makeActive: false,
    lazyLoad: true
  }))
  const tabIcon = page.locator(`.tab[data-tab-id="${historyTab.id}"] .tabPageIcon`)
  await expect(tabIcon).toBeVisible()
  const iconName = await tabIcon.getAttribute('data-icon')

  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Search commands' })
  await input.fill('switch to tab history tab')

  const command = page.getByRole('option', { name: /Switch to tab: History tab/ })
  await expect(command.locator(`[data-icon="${iconName}"]`)).toBeVisible()
  await expect(command.locator('[data-icon="clone"]')).toHaveCount(0)
})

test.describe('playlist commands', () => {
  test.use({
    seed: {
      playlists: [{
        _id: 'palette-playlist',
        playlistName: 'Palette playlist',
        protected: false,
        description: '',
        videos: [],
        createdAt: Date.now() - 86_400_000,
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('resolves the tab title after opening a local playlist', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('open playlist palette playlist')
    await page.getByRole('option', { name: 'Open playlist: Palette playlist' }).click()

    await expect(page).toHaveURL(/#\/playlist\/palette-playlist/)
    await expect(page.locator('.playlistTitle')).toHaveText('Palette playlist')
    await expect(page.locator('.tabBar .tab.active')).toContainText('Palette playlist')
  })
})

test.describe('local video commands', () => {
  const video = { ...watchHistoryEntry, title: 'A journey through the mountains', author: 'North Channel' }
  const playlist = {
    _id: 'palette-local-videos',
    playlistName: 'Road trips',
    protected: false,
    description: '',
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
    videos: [{ ...video, playlistItemId: 'journey-item' }]
  }
  test.use({
    seed: {
      settings: { enableDownloads: true, uiScale: 125, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true },
      history: [video],
      playlists: [playlist],
      downloads: [{
        id: 42,
        title: video.title,
        status: 'completed',
        mode: 'video',
        destination: DEMO_MEDIA_PATH,
        destinations: [DEMO_MEDIA_PATH],
        files: [{ videoId: video.videoId, path: DEMO_MEDIA_PATH, title: video.title, author: video.author }]
      }]
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.evaluate(video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('addVideoToWatchQueue', {
        video: { ...video, route: { path: `/watch/${video.videoId}`, query: { short: 'false' } } }
      })
    }, video)
    await page.keyboard.press('Control+k')
  })

  test('finds local titles, channels, and sources without submitting a YouTube search', async ({ page }) => {
    const input = page.getByRole('combobox', { name: 'Search commands' })
    const videos = page.getByRole('group', { name: 'Local videos', exact: true })
    await expect(videos).toHaveCount(0)
    await input.fill('jorney montains')
    await expect(videos.getByRole('option')).toHaveCount(4)
    await expect(videos.locator('small')).toHaveText([
      'History · North Channel', 'Playlists: Road trips · North Channel',
      'Downloads · North Channel', 'Queue · North Channel'
    ])
    await input.fill('north channel')
    await expect(videos.getByRole('option')).toHaveCount(4)
    await input.fill('journey road trips')
    await expect(videos.getByRole('option')).toHaveCount(1)
    await expect(videos.getByRole('option')).toContainText('Playlists: Road trips')
    await expect(page).not.toHaveURL(/#\/search/)

    // Removing metadata while the palette is open must update its results.
    await input.fill('journey')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setHistoryCacheSorted', [])
      store.commit('clearWatchQueue')
      store.commit('removeYtDlpDownload', 42)
    })
    await expect(videos.getByRole('option')).toHaveCount(1)
    await input.fill('zzzzzz')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(page.getByText('No matching results', { exact: true })).toBeVisible()
  })

  for (const [source, query] of [
    ['History', {}],
    ['Playlists: Road trips', { playlistId: playlist._id, playlistType: 'user', playlistItemId: 'journey-item' }],
    ['Downloads', { downloadId: '42' }],
    ['Queue', { short: 'false' }],
  ]) {
    test(`opens the selected local video from ${source}`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      const input = page.getByRole('combobox', { name: 'Search commands' })
      await input.fill('journey')
      const videos = page.getByRole('group', { name: 'Local videos', exact: true })
      const option = videos.getByRole('option').filter({ has: page.locator('small', { hasText: `${source} ·` }) })
      await expect(option).toBeVisible()
      const optionId = await option.getAttribute('id')
      for (let index = 0; index < 4; index++) {
        if (await input.getAttribute('aria-activedescendant') === optionId) break
        await input.press('ArrowDown')
      }
      await expect(input).toHaveAttribute('aria-activedescendant', optionId)
      await input.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden()
      await expect(page).toHaveURL(url => {
        const [path, search = ''] = url.hash.slice(1).split('?')
        const params = new URLSearchParams(search)
        return path === `/watch/${video.videoId}` &&
          params.size === Object.keys(query).length &&
          Object.entries(query).every(([key, value]) => params.get(key) === value)
      })
      if (source === 'Queue') {
        await expect.poll(() => page.evaluate(() => (
          document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueueLength
        ))).toBe(0)
      }
      if (source === 'Downloads') {
        await expect.poll(() => page.locator('video').first().evaluate(element => element.currentTime)).toBeGreaterThan(0)
      }
    })
  }

  for (const enabled of [true, false]) {
    test(`history results respect saved playlist context when the setting is ${enabled}`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await page.evaluate(({ enabled, video, playlistId }) => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('upsertToHistoryCache', {
          ...video, lastViewedPlaylistId: playlistId, lastViewedPlaylistType: 'user', lastViewedPlaylistItemId: 'journey-item',
        })
        store.commit('setSaveVideoHistoryWithLastViewedPlaylist', enabled)
      }, { enabled, video, playlistId: playlist._id })
      await page.getByRole('combobox', { name: 'Search commands' }).fill('journey')
      const videos = page.getByRole('group', { name: 'Local videos', exact: true })
      await videos.getByRole('option').filter({ has: page.locator('small', { hasText: 'History ·' }) }).click()
      await expect(page).toHaveURL(url => {
        const [path, query = ''] = url.hash.slice(1).split('?')
        const params = new URLSearchParams(query)
        return path === `/watch/${video.videoId}` &&
          params.get('playlistId') === (enabled ? playlist._id : null) &&
          params.get('playlistType') === (enabled ? 'user' : null) &&
          params.get('playlistItemId') === (enabled ? 'journey-item' : null)
      })
    })
  }

  test('restarts an already open queued video and removes only the selected duplicate', async ({ app, page }) => {
    await page.getByRole('combobox', { name: 'Search commands' }).press('Escape')
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const player = page.locator('video').first()
    await expect.poll(() => player.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
    await player.evaluate(element => { element.pause(); element.currentTime = 5 })
    await expect.poll(() => player.evaluate(element => element.paused && element.currentTime >= 4)).toBe(true)
    const firstId = await page.evaluate(video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('clearWatchQueue')
      const route = store.getters.getPresentedTab.route
      const queued = { ...video, title: 'Current queued journey', route: { path: route.path, query: { ...route.query } } }
      store.commit('addVideoToWatchQueue', { video: queued })
      store.commit('addVideoToWatchQueue', { video: queued })
      return store.getters.getWatchQueue[0].queueItemId
    }, video)
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Search commands' }).fill('current queued journey')
    const options = page.getByRole('group', { name: 'Local videos', exact: true }).getByRole('option')
    await expect(options).toHaveCount(2)
    await options.last().click()
    await expect.poll(() => player.evaluate(element => !element.paused && element.currentTime < 3)).toBe(true)
    await expect.poll(() => page.evaluate(() => (
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getWatchQueue.map(video => video.queueItemId)
    ))).toEqual([firstId])
  })

  test('keeps local video scrolling valid when resizing at fractional scale', async ({ app, page }) => {
    await page.evaluate(video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setHistoryCacheSorted', Array.from({ length: 30 }, (_, index) => ({
        ...video, videoId: `resize${index}`, title: `${video.title} ${index}`,
      })))
    }, video)
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('journey')
    await expect(page.getByRole('group', { name: 'Local videos', exact: true }).getByRole('option')).toHaveCount(33)
    for (const size of [{ width: 520, height: 640 }, { width: 900, height: 520 }, { width: 1000, height: 900 }]) {
      await scrollResultsToBottom(page)
      await setWindowSize(app, page, size)
      const dialog = page.locator('.commandPalette')
      const [viewport, bounds] = await Promise.all([
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })), dialog.boundingBox()
      ])
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expectValidResultsScroll(page)
    }
  })

  for (const mutation of ['removeMultipleFromHistoryCache', 'setHistoryCacheSorted']) {
    test(`clamps local results after ${mutation} shortens the list at fractional scale`, async ({ page }) => {
      await page.evaluate(video => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('setHistoryCacheSorted', Array.from({ length: 30 }, (_, index) => ({
          ...video, videoId: `shorten${index}`,
        })))
      }, video)
      await page.getByRole('combobox', { name: 'Search commands' }).fill('journey')
      const videos = page.getByRole('group', { name: 'Local videos', exact: true })
      await expect(videos.getByRole('option')).toHaveCount(33)
      await scrollResultsToBottom(page)
      await page.evaluate(mutation => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit(mutation, mutation === 'setHistoryCacheSorted' ? [] : Array.from({ length: 30 }, (_, index) => `shorten${index}`))
        store.commit('clearWatchQueue')
        store.commit('removeYtDlpDownload', 42)
      }, mutation)
      await expect(videos.getByRole('option')).toHaveCount(1)
      await expectValidResultsScroll(page)
      await expect(page.locator('.commandPaletteResults')).toHaveJSProperty('scrollTop', 0)
    })
  }

  test('adds local download matches only after the download completes', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', { ...store.getters.getYtDlpDownloads[42], status: 'downloading' })
    })
    await page.getByRole('combobox', { name: 'Search commands' }).fill('journey')
    const videos = page.getByRole('group', { name: 'Local videos', exact: true })
    await expect(videos.getByRole('option')).toHaveCount(3)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', { ...store.getters.getYtDlpDownloads[42], status: 'completed' })
    })
    await expect(videos.getByRole('option')).toHaveCount(4)
    await expect(videos.locator('small', { hasText: 'Downloads · North Channel' })).toBeVisible()
  })

  test('cancels stale local matches when typing in a large library', async ({ page }) => {
    await page.evaluate(video => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setHistoryCacheSorted', [
        ...Array.from({ length: 6000 }, (_, index) => ({ ...video, videoId: `video${index}`, title: `Mountain journey ${index}` })),
        { ...video, videoId: 'uniquevideo', title: 'Unique destination' },
      ])
    }, video)
    const input = page.getByRole('combobox', { name: 'Search commands' })
    const videos = page.getByRole('group', { name: 'Local videos', exact: true })
    await input.fill('journey')
    await expect(videos.getByRole('option')).toHaveCount(50)
    const results = page.locator('.commandPaletteResults')
    await results.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await input.fill('mountain')
    await input.fill('unique destination')
    await expect(videos.getByRole('option')).toHaveCount(1)
    await expect(videos.getByRole('option')).toContainText('Unique destination')
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
    await expect.poll(() => results.evaluate(element => element.scrollTop)).toBe(0)
    await expect(results.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    await input.fill('')
    await expect(videos).toHaveCount(0)
    await expect(page.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
  })

  test('refreshes in-place library edits without rebuilding for download progress', async ({ page }) => {
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('journey')
    const videos = page.getByRole('group', { name: 'Local videos', exact: true })
    await expect(videos.getByRole('option')).toHaveCount(4)
    await input.press('End')
    const selected = await input.getAttribute('aria-activedescendant')
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__paletteSearchRestarts = 0
      const list = document.querySelector('.commandPalette [role="listbox"]')
      const observer = new MutationObserver(records => {
        window.__paletteSearchRestarts += records.filter(record => record.attributeName === 'aria-busy').length
      })
      observer.observe(list, { attributes: true })
      for (let progress = 1; progress <= 10; progress++) {
        store.commit('upsertYtDlpDownload', { ...store.getters.getYtDlpDownloads[42], progress })
        store.commit('updateRecordWatchProgressInHistoryCache', { videoId: 'jNQXAC9IVRw', watchProgress: progress })
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      observer.disconnect()
    })
    expect(await page.evaluate(() => window.__paletteSearchRestarts)).toBe(0)
    await expect(input).toHaveAttribute('aria-activedescendant', selected)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertToHistoryCache', {
        ...store.getters.getHistoryCacheById.jNQXAC9IVRw, title: 'Renamed expedition', author: 'Other Channel',
      })
      store.commit('upsertPlaylistToList', { _id: 'palette-local-videos', playlistName: 'Renamed travels' })
    })
    await expect(videos.getByRole('option')).toHaveCount(3)
    await expect(videos.locator('small', { hasText: 'Playlists: Renamed travels' })).toBeVisible()
    await input.fill('renamed expedition')
    await expect(videos.getByRole('option')).toHaveCount(1)
    await expect(videos.getByRole('option')).toContainText('Other Channel')
  })
})

test.describe('download availability recheck', () => {
  const filePath = path.join(tmpdir(), `opentubex-palette-${randomUUID()}.webm`)
  test.use({
    seed: {
      settings: { enableDownloads: true },
      downloads: [{
        id: 42,
        videoId: 'vanish00001',
        title: 'Vanishing palette download',
        status: 'completed',
        mode: 'video',
        destination: filePath,
        destinations: [filePath],
        files: [{ videoId: 'vanish00001', title: 'Vanishing palette download', path: filePath, extension: 'webm' }],
      }],
    }
  })
  test.beforeAll(() => copyFile(DEMO_MEDIA_PATH, filePath))
  test.afterAll(() => rm(filePath, { force: true }))

  test('rechecks a selected download after its file is deleted externally', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('vanishing palette download')
    const videos = page.getByRole('group', { name: 'Local videos', exact: true })
    await expect(videos.getByRole('option')).toHaveCount(1)
    await rm(filePath)
    await videos.getByRole('option').click()
    await expect(page.getByText('The downloaded file could not be found.', { exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/#\/watch\/vanish00001/)
    await expect.poll(() => page.evaluate(() => (
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getYtDlpDownloads[42].files[0].available
    ))).toBe(false)
    await page.keyboard.press('Control+k')
    await input.fill('vanishing palette download')
    await expect(videos).toHaveCount(0)
  })
})

test.describe('profile commands', () => {
  test.use({ seed: { profiles: [mainProfile, secondProfile] } })

  test('moves through filtered options in their visual order', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('profile')

    const optionIds = await page.getByRole('option').evaluateAll(options => (
      options.map(option => option.id)
    ))

    for (const optionId of optionIds) {
      await expect(input).toHaveAttribute('aria-activedescendant', optionId)
      await input.press('ArrowDown')
    }
    await expect(input).toHaveAttribute('aria-activedescendant', optionIds[0])
  })

  test('shows each configured profile icon', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('second profile')

    const command = page.getByRole('option', { name: /Second profile/ })
    const profileIcon = command.locator('.commandPaletteOptionProfileIcon')
    await expect(profileIcon).toHaveText('🦊')
    await expect(profileIcon).toHaveCSS('background-color', 'rgb(85, 139, 47)')
    await expect(profileIcon).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(command.locator('[data-icon="circle-user"]')).toHaveCount(0)
  })

  test('uses the profile switcher action and shows its toast', async ({ page }) => {
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('second profile')
    await page.getByRole('option', { name: /Second profile/ }).click()

    await expect(page.locator('.toast', { hasText: 'Second profile' })).toBeVisible()
  })
})

test.describe('custom command palette shortcut', () => {
  test.use({
    seed: {
      settings: {
        keyboardShortcuts: JSON.stringify({
          APP: { GENERAL: { OPEN_COMMAND_PALETTE: 'ctrl+shift+p' } }
        })
      }
    }
  })

  test('opens only with the saved binding', async ({ page }) => {
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)

    await page.keyboard.press('Control+Shift+p')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })
})

test.describe('contextual playback commands', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true
      }
    }
  })

  test('runs the existing player action on a watch page', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search commands' })
    await input.fill('toggle play pause')
    await input.press('Enter')

    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  })
})

test.describe('responsive command palette', () => {
  test.use({
    seed: {
      settings: {
        reducedMotion: 'on',
        uiScale: 125
      }
    }
  })

  test('fits a compact window at fractional UI scale and removes motion', async ({ app, page }) => {
    await setWindowSize(app, page, { width: 520, height: 640 })
    await page.keyboard.press('Control+k')

    const backdrop = page.locator('.commandPaletteBackdrop')
    const dialog = page.locator('.commandPalette')
    await expect(backdrop).toHaveCSS('animation-name', 'none')
    await expect(dialog).toHaveCSS('animation-name', 'none')

    const [viewport, bounds] = await Promise.all([
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      dialog.boundingBox()
    ])
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    await expect(page.locator('.commandPaletteFooter')).toBeHidden()
  })
})
