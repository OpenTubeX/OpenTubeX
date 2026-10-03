import { test, expect, goTo, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectValidScrollRange(scroller) {
  await expect.poll(() => scroller.evaluate(element => {
    const scrollbar = element.querySelector('.os-scrollbar-vertical')
    const lastItem = [...element.querySelectorAll(':scope > .playlistItem')].at(-1)
    const viewport = element.getBoundingClientRect()
    const end = lastItem
      ? lastItem.getBoundingClientRect().bottom + (Number.parseFloat(getComputedStyle(lastItem).marginBlockEnd) || 0)
      : viewport.top
    const scrollable = element.scrollHeight > element.clientHeight
    return {
      offsetValid: element.scrollTop <= Math.max(0, element.scrollHeight - element.clientHeight) + 1,
      contentEndValid: element.scrollTop === 0 || end >= viewport.bottom - 1,
      scrollbarValid: !!scrollbar && (scrollable || !scrollbar.classList.contains('os-scrollbar-visible') || scrollbar.classList.contains('os-scrollbar-unusable')),
      scrollTop: element.scrollTop,
      contentEnd: end,
      viewportEnd: viewport.bottom
    }
  })).toMatchObject({ offsetValid: true, contentEndValid: true, scrollbarValid: true })
}

const videos = Array.from({ length: 12 }, (_, index) => ({
  videoId: index === 0 ? 'jNQXAC9IVRw' : `layoutvideo${index}`,
  title: `Playlist video ${index + 1}`,
  author: 'Test channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 120,
  published: Date.now() - 86400000,
  timeAdded: Date.now() + index,
  playlistItemId: `layout-item-${index}`,
  type: 'video'
}))

test.use({
  seed: {
    settings: {
      animationSpeed: 0,
      userPlaylistSortOrder: 'custom',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    },
    history: [{ ...videos[1], _id: videos[1].videoId, isWatched: true, watchProgress: 60, timeWatched: Date.now() }],
    playlists: [{
      _id: 'layout-playlist',
      playlistName: 'Layout test playlist',
      protected: false,
      description: '',
      videos,
      createdAt: Date.now(),
      lastUpdatedAt: Date.now()
    }]
  }
})

async function openPlaylist(app, page) {
  await mockPlayableWatchPage(app, page)
  await goTo(page, 'userplaylists')
  await page.getByText('Layout test playlist', { exact: true }).click()
  await page.getByText('Playlist video 1', { exact: true }).click()
  await waitForPlayback(page)
  await expect(page.locator('.watchVideoPlaylist .playlistItem')).toHaveCount(videos.length)
  return watchViewHandle(page)
}

for (const zoom of [1, 0.95]) {
  test(`phone playlist centers pending current items when opened at ${zoom} UI scale`, async ({ app, page }) => {
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await page.setViewportSize({ width: 480, height: 800 })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const playlist = store.getters.getPlaylist('layout-playlist')
      const [current, ...others] = playlist.videos
      await store.dispatch('updatePlaylist', { ...playlist, videos: [...others.slice(0, 8), current, ...others.slice(8)] })
    })
    const watch = await openPlaylist(app, page)
    await page.locator('.phonePlaylistButton').click()
    const sheet = page.locator('.dockedSheet[open]')
    const list = sheet.locator('.playlistItemsWrapper')
    const current = list.locator('.playlistItem').filter({ has: page.getByText('Playlist video 1', { exact: true }) })
    const expectCurrentVisible = async () => {
      await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
      await expect.poll(async () => {
        const item = await current.boundingBox()
        const viewport = await list.boundingBox()
        return item != null && viewport != null && item.y >= viewport.y - 1 && item.y + item.height <= viewport.y + viewport.height + 1
      }).toBe(true)
    }
    await expectCurrentVisible()
    await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await watch.evaluate(async vm => {
      const playlist = vm.$store.getters.getPlaylist('layout-playlist')
      const current = playlist.videos.find(video => video.videoId === vm.videoId)
      const others = playlist.videos.filter(video => video !== current)
      await vm.$store.dispatch('updatePlaylist', { ...playlist, videos: [...others.slice(0, 10), current, ...others.slice(10)] })
    })
    await page.locator('.phonePlaylistButton').click()
    await expectCurrentVisible()
    await watch.dispose()
  })

  test(`portrait playlist opens below the video and clamps after resize and removal at ${zoom} UI scale`, async ({ app, page, attachScreenshot }) => {
    const watch = await openPlaylist(app, page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await page.setViewportSize({ width: Math.round(480 / zoom), height: Math.round(800 / zoom) })
    await watch.evaluate(vm => { vm.videoDescription = 'Description line\n'.repeat(30); vm.videoDescriptionHtml = '' })
    const preview = page.locator('.phoneDescriptionPreview')
    await expect.poll(() => preview.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(110)
    await expect(page.locator('.watchVideoPlaylist')).toBeHidden()
    await page.locator('.phonePlaylistButton').click()
    const sheet = page.locator('.dockedSheet[open]')
    await expect(sheet).toBeVisible()
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    await expect(sheet.locator('.mobileSheetHeader')).toContainText('Layout test playlist')
    await expect(sheet.locator('.playlistIndex')).toBeHidden()
    await expect(sheet.locator('.playlistProgressBarContainer')).toBeHidden()
    const list = sheet.locator('.playlistItemsWrapper')
    await expect(list).toHaveAttribute('data-overlayscrollbars-viewport')
    await expect.poll(async () => {
      const header = await sheet.locator('.playlistHeader').boundingBox()
      const viewport = await list.boundingBox()
      return viewport.y >= header.y + header.height - 1
    }).toBe(true)
    const videoBox = await page.locator('.ftVideoPlayer').boundingBox()
    const sheetBox = await sheet.boundingBox()
    expect(sheetBox.y).toBeGreaterThanOrEqual(videoBox.y + videoBox.height - 1)
    const actions = sheet.locator('.mobileSheetHeader .playlistButtons')
    await expect(actions).toBeVisible()
    await expect(sheet.locator('.phonePanelContent .playlistButtons')).toHaveCount(0)
    for (const button of await actions.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      // Chromium rounds fractional CSS pixels at non-100% UI scales.
      expect(bounds.width).toBeGreaterThanOrEqual(47.9)
      expect(bounds.height).toBeGreaterThanOrEqual(47.9)
    }
    await actions.getByRole('button', { name: 'Shuffle Playlist' }).click()
    await expect(actions.getByRole('button', { name: 'Shuffle Playlist' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => actions.getByRole('button', { name: 'Shuffle Playlist' }).evaluate(el => getComputedStyle(el).color))
      .toBe(await page.evaluate(() => {
        const el = document.createElement('span')
        el.style.color = 'var(--accent-color)'
        document.body.append(el)
        const color = getComputedStyle(el).color
        el.remove()
        return color
      }))
    await actions.getByRole('button', { name: 'Shuffle Playlist' }).click()
    await list.evaluate(el => { el.scrollTop = 200 })
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(200)
    const actionBounds = await actions.boundingBox()
    const headerBounds = await sheet.locator('.mobileSheetHeader').boundingBox()
    expect(actionBounds.y).toBeGreaterThanOrEqual(headerBounds.y)
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height)
    expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(headerBounds.x + headerBounds.width)
    await attachScreenshot(`portrait playlist header actions ${zoom}`)
    const position = await list.evaluate(el => el.scrollTop)
    await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await page.locator('.phonePlaylistButton').click()
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(position)

    await list.evaluate(async el => {
      for (let i = 0; i < 3; i++) {
        el.scrollTop = el.scrollHeight
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    })
    // A taller sheet increases the viewport while the list is at its old end.
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 480, height: 950 }))
    await page.setViewportSize({ width: Math.round(480 / zoom), height: Math.round(950 / zoom) })
    await expectValidScrollRange(list)
    await list.evaluate(el => { el.scrollTop = el.scrollHeight })
    await watch.evaluate(async vm => {
      for (const video of vm.$store.getters.getPlaylist('layout-playlist').videos.slice(1)) {
        await vm.$store.dispatch('removeVideo', { _id: 'layout-playlist', videoId: video.videoId, playlistItemId: video.playlistItemId })
      }
    })
    await expect(list.locator('.playlistItem')).toHaveCount(1)
    await expectValidScrollRange(list)
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0)
    await attachScreenshot(`portrait playlist ${zoom}`)
    await sheet.press('Escape')
    await expect(sheet).toHaveCount(0)
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 800 }))
    await page.setViewportSize({ width: Math.round(1280 / zoom), height: Math.round(800 / zoom) })
    await expect(page.locator('.watchVideoPlaylist')).toBeVisible()
    await expect(page.locator('.watchVideoPlaylist .playlistTitle')).toContainText('Layout test playlist')
    await expect(page.locator('.watchVideoPlaylist .playlistHeader .playlistButtons')).toBeVisible()
    await expect(page.locator('.watchVideoPlaylist .playlistIndex')).toBeVisible()
    await expect(page.locator('.watchVideoPlaylist .playlistProgressBarContainer')).toBeVisible()
  })

  test(`playlist channel separator follows the counter at ${zoom} UI scale`, async ({ app, page }) => {
    const watch = await openPlaylist(app, page)
    await watch.evaluate(async (vm, items) => {
      const store = vm.$store
      const router = vm.tabRouter
      const tabId = vm.tabId ?? 'web'
      await router.push('/watch/jNQXAC9IVRw')
      await vm.$nextTick()
      store.commit('setCachedPlaylist', {
        tabId,
        value: { id: 'channel-layout', title: 'Channel playlist', channelName: 'Test channel', channelId: 'UC-test', totalVideoCount: items.length, items, continuationData: null }
      })
      await router.push('/watch/jNQXAC9IVRw?playlistId=channel-layout')
    }, videos)
    await waitForPlayback(page)
    await setWindowSize(app, page, { width: 480, height: 800 })
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await page.setViewportSize({ width: Math.round(480 / zoom), height: Math.round(800 / zoom) })
    await page.locator('.phonePlaylistButton').click()
    const sheet = page.locator('.dockedSheet[open]')
    await expect(sheet.locator('.playlistHeader > .channelName')).toHaveText('Test channel', { useInnerText: true })
    await expect(sheet.locator('.playlistIndex')).toBeHidden()
    await sheet.locator('.mobileSheetHeader').getByRole('button', { name: 'Close', exact: true }).click()
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 850 }))
    await page.setViewportSize({ width: Math.round(1280 / zoom), height: Math.round(850 / zoom) })
    await expect(page.locator('.watchVideoPlaylist .playlistHeader > .channelName')).toHaveText('Test channel -')
    await expect(page.locator('.watchVideoPlaylist .playlistIndex')).toBeVisible()
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1280, height: 550 }))
    await page.setViewportSize({ width: 1280, height: 550 })
    await expect.poll(() => page.evaluate(() => window.matchMedia('(height <= 600px)').matches)).toBe(true)
    // Exercise the ordinary component independently of the phone-layout query.
    await watch.evaluate(vm => { vm.phoneLayout = false })
    await expect(page.locator('.watchVideoPlaylist')).toBeVisible()
    await expect(page.locator('.watchVideoPlaylist .playlistHeader > .channelName')).toHaveText('Test channel -', { useInnerText: true })
    await expect(page.locator('.watchVideoPlaylist .playlistIndex')).toBeVisible()
    await expect(page.locator('.watchVideoPlaylist .playlistProgressBarContainer')).toBeVisible()
    await watch.dispose()
  })

  test(`landscape fullscreen playlist shows more videos and keeps controls outside the scroller at ${zoom} UI scale`, async ({ app, page, attachScreenshot }) => {
    await openPlaylist(app, page)
    await setWindowSize(app, page, { width: 960, height: 440 })
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await page.setViewportSize({ width: Math.round(960 / zoom), height: Math.round(440 / zoom) })
    await setPlayerFullscreen(page, true)
    await page.locator('.fullscreenPlaylistToggle').click()
    const dock = page.locator('.fullscreenPlaylistTarget')
    await expect(dock.locator('.playlistItemsWrapper')).toBeVisible()
    await expect(dock.locator('.playlistProgressBarContainer')).toBeHidden()
    await expect(dock.locator('.playlistIndex')).toBeHidden()
    const watchedThumbnail = dock.locator('.ft-list-item.watched .videoThumbnail').first()
    await expect(watchedThumbnail.locator('.videoWatched')).toBeVisible()
    await expect.poll(() => watchedThumbnail.evaluate(thumbnail => {
      const watched = thumbnail.querySelector('.videoWatched').getBoundingClientRect()
      const duration = thumbnail.querySelector('.videoDuration').getBoundingClientRect()
      const bounds = thumbnail.getBoundingClientRect()
      return watched.bottom <= duration.top && watched.top >= bounds.top && duration.bottom <= bounds.bottom
    })).toBe(true)
    await watchedThumbnail.evaluate(thumbnail => {
      const label = thumbnail.querySelector('.videoDuration').cloneNode(false)
      label.className = 'sponsorBlockVideoLabel'
      label.textContent = 'Sponsor'
      thumbnail.append(label)
    })
    await expect.poll(() => watchedThumbnail.evaluate(thumbnail => thumbnail.getBoundingClientRect().height)).toBeLessThanOrEqual(45.1)
    const list = dock.locator('.playlistItemsWrapper')
    await expect.poll(() => list.locator('.playlistItem').evaluateAll(items => {
      const viewport = items[0].parentElement.getBoundingClientRect()
      return items.filter(item => {
        const rect = item.getBoundingClientRect()
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom
      }).length
    })).toBeGreaterThanOrEqual(4)
    const headerBefore = await dock.locator('.playlistHeader').boundingBox()
    await list.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expectValidScrollRange(list)
    const headerAfter = await dock.locator('.playlistHeader').boundingBox()
    expect(headerAfter.y).toBe(headerBefore.y)
    await dock.getByRole('button', { name: 'Reverse Playlist' }).click()
    await expect(dock.getByRole('button', { name: 'Reverse Playlist' })).toHaveAttribute('aria-pressed', 'true')
    await list.evaluate(el => { el.scrollTop = 0 })
    await expect(list.locator('.playlistItem').first()).toContainText('Playlist video 12')
    await attachScreenshot(`landscape fullscreen playlist ${zoom}`)
    await setPlayerFullscreen(page, false)
  })
}
