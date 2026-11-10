import { writeFile } from 'node:fs/promises'

import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, mobileMiniPlayerRegions, mobileMiniPlayerReturnPoint, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'
import { checkCompactMiniPlayer } from '../../helpers/compact-mini-player.mjs'
import { checkMiniPlayerSeeking } from '../../helpers/mini-player-seeking.mjs'
import { mobileMiniPlayerBackdrop, resetMiniPlayerWork, sampleBrowsingPreviewTops, stopTrackingMiniPlayerWork, trackMiniPlayerWork } from '../../helpers/mini-player-performance.mjs'

test.use({
  seed: {
    settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableVideoZoom: false, enableMobileFullscreenSwipe: false },
    playlists: [{
      _id: 'mini-bar-playlist',
      playlistName: 'Mini-player controls',
      protected: false,
      description: '',
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
      videos: ['mini-previous', watchHistoryEntry.videoId, 'mini-next'].map((videoId, index) => ({
        ...watchHistoryEntry,
        _id: videoId,
        videoId,
        timeAdded: Date.now() + index,
        playlistItemId: `mini-item-${index}`
      }))
    }]
  }
})

async function enableMobileTouch(app, page, phone = true, resize = true) {
  if (resize) await setWindowSize(app, page, { width: 480, height: 850 })
  await page.evaluate(phone => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 })
    const app = document.querySelector('.app')
    const mobile = () => {
      if (!app.classList.contains('capacitorTabs')) app.classList.add('capacitorTabs')
      if (phone && !app.classList.contains('capacitorPhoneLayout')) app.classList.add('capacitorPhoneLayout')
    }
    new MutationObserver(mobile).observe(app, { attributeFilter: ['class'] })
    mobile()
    const player = document.querySelector('.ftVideoPlayer')
    const bar = () => {
      if (player.classList.contains('scrollMiniPlayer') && !player.classList.contains('mobileMiniBar')) {
        player.classList.add('mobileMiniBar')
      }
    }
    new MutationObserver(bar).observe(player, { attributeFilter: ['class'] })
    bar()
  }, phone)
}

async function openMobilePlayer(app, page, phone = true) {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await enableMobileTouch(app, page, phone)
  return page.locator('.ftVideoPlayer')
}

for (const mode of ['fullscreen', 'fullwindow']) {
  test(`${mode} commenter avatar navigation retains the video in the mobile mini-player`, async ({ app, page }) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setKeepPlayingOnNavigation', true)
      store.commit('setHideCommentPhotos', true)
      store.commit('setReducedMotion', 'off')
    })
    await player.locator('video').evaluate(video => { video.loop = true; return video.play() })
    const originalVideo = await player.locator('video').elementHandle()
    const watch = await page.evaluateHandle(findWatchComponent)
    try {
      if (mode === 'fullscreen') await setPlayerFullscreen(page, true)
      else await player.locator('.full-window-button').first().evaluate(button => button.click())
      await player.evaluate(element => {
        window.__fullWindowAnimationAtDock = false
        const observer = new MutationObserver(() => {
          if (!element.classList.contains('mobileMiniBar')) return
          window.__fullWindowAnimationAtDock ||= element.getAnimations().some(animation =>
            animation.playState === 'running' && animation.effect.getTiming().duration === 400)
          observer.disconnect()
        })
        observer.observe(element, { attributeFilter: ['class'] })
      })
      await watch.evaluate(component => component.proxy.$refs.player.$.setupState.setFullscreenComments(true))
      const avatarLink = player.locator('.fullscreenCommentCard a[tabindex="-1"]').first()
      const avatar = avatarLink.locator('.commentThumbnail, .commentThumbnailHidden').first()
      await expect(avatar).toBeVisible()
      const destination = await avatarLink.getAttribute('href')
      await avatar.click()
      await expect(page).toHaveURL(new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
      await expect(player).not.toHaveClass(/fullWindow/)
      await expect(player).toHaveClass(/mobileMiniBar/)
      await expect(player).toBeVisible()
      expect(await page.evaluate(() => window.__fullWindowAnimationAtDock)).toBe(false)
      expect(await originalVideo.evaluate(video => video.isConnected && !video.paused)).toBe(true)
      await player.locator('.mobileMiniBarReturn').click()
      await expect(page).toHaveURL(/#\/watch\//)
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    } finally {
      await originalVideo.dispose()
      await watch.dispose()
    }
  })
}

test('landscape minimize clears the expanded hidden Watch sidebar', { tag: '@scale' }, async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await setWindowSize(app, page, { width: 1250, height: 540 })
  await page.evaluate(async () => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$store
    store.commit('setHideSideBarOnWatchPages', false)
    await new Promise(requestAnimationFrame)
    if (!store.getters.getIsSideNavOpen) store.commit('toggleSideNav')
    await new Promise(requestAnimationFrame)
    store.commit('setHideSideBarOnWatchPages', true)
    await new Promise(requestAnimationFrame)
  })
  await expect.poll(() => page.locator('.app > .sideNav').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.width === 200 && bounds.right <= 0
  })).toBe(true)
  await player.locator('video').evaluate(video => { video.loop = true; return video.play() })
  const bounds = await player.boundingBox()
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
  const cdp = await page.context().newCDPSession(page)
  let endpoint
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (const distance of [30, 80, 150, 250]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
    }
    const overlay = page.locator('#cross-tab-mini-player-layer > .mobileMiniBarOverlay')
    await expect(overlay).toBeVisible()
    endpoint = await overlay.boundingBox()
    expect(endpoint).not.toBeNull()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
  await expect(player).toHaveClass(/mobileMiniBar/)
  await expect.poll(() => player.evaluate(element => {
    const nav = document.querySelector('.app > .sideNav').getBoundingClientRect()
    return nav.width > 190 && nav.left >= 0 && element.getBoundingClientRect().left >= nav.right - 2 / devicePixelRatio
  })).toBe(true)
  await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
  const settled = await player.boundingBox()
  // This fixture retains desktop size constraints; Android covers the full
  // bar geometry. Both must target the final sidebar edge before release.
  expect(settled.x).toBeCloseTo(endpoint.x, 0)
})

async function checkLandscapeMiniPlayerClearsSidebar({ app, page }, testInfo) {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => window.$store.commit('setKeepPlayingOnNavigation', true))
  await player.locator('video').evaluate(video => { video.loop = true; return video.play() })
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.tabRouter.push('/subscriptions'))
  await watch.dispose()
  await expect(player).toHaveClass(/mobileMiniBar/)
  const expectClearOfSidebar = () => expect.poll(() => player.evaluate(element => {
    const bar = element.getBoundingClientRect()
    const nav = document.querySelector('.app > .sideNav').getBoundingClientRect()
    const tolerance = 2 / devicePixelRatio
    return window.innerWidth <= 680
      ? bar.bottom <= nav.top + tolerance
      : bar.left >= nav.right - tolerance
  })).toBe(true)
  for (const width of [1000, 1250, 480, 1000]) {
    await setWindowSize(app, page, { width, height: width === 480 ? 850 : width === 1250 ? 540 : 500 })
    await expectClearOfSidebar()
  }
  await setWindowSize(app, page, { width: 1250, height: 380 })
  for (const expanded of [true, false]) {
    await page.evaluate(() => window.$store.commit('toggleSideNav'))
    await expect.poll(() => page.locator('.app > .sideNav').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(expanded ? 200 : 104, 0)
    await expectClearOfSidebar()
  }
  const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(testInfo.outputPath('landscape-mini-player.png'), Buffer.from(screenshot, 'base64'))
}

test('landscape mobile mini-player clears the sidebar', { tag: '@scale' }, checkLandscapeMiniPlayerClearsSidebar)

test('mobile swipes suspend ambient sampling and hidden control layout in both directions', { tag: '@performance' }, async ({ app, page }, testInfo) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateAmbientMode', true)
    await store.dispatch('updateReducedMotion', 'off')
  })
  await player.locator('video').evaluate(element => { element.loop = true; return element.play() })
  const originalVideo = await player.locator('video').elementHandle()
  await trackMiniPlayerWork(page)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  try {
    await expect.poll(() => page.evaluate(() => window.__miniPlayerWork.ambientDraws)).toBeGreaterThan(0)
    for (const restoring of [false, true]) {
      const bounds = await (restoring ? player.locator('.mobileMiniBarReturn') : player).boundingBox()
      const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const direction = restoring ? -1 : 1
      await touch('touchStart', start)
      await touch('touchMove', { ...start, y: start.y + direction * 30 })
      await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
      await resetMiniPlayerWork(page)
      for (const distance of [40, 60, 80, 100]) {
        await touch('touchMove', { ...start, y: start.y + direction * distance })
        await page.waitForTimeout(30)
      }
      // Hold the swipe so suspended sampling has time to prove it stays idle.
      await page.waitForTimeout(350)
      const work = await page.evaluate(() => window.__miniPlayerWork)
      const backdrop = await mobileMiniPlayerBackdrop(page)
      expect.soft(backdrop.left).toBe('0px')
      expect.soft(backdrop.right).toBe('0px')
      expect.soft(backdrop.image).toBe('none')
      expect.soft(backdrop.color).toBe(backdrop.cardColor)
      console.log(`${restoring ? 'Restoring' : 'Minimizing'} mobile swipe work:`, work)
      expect.soft(work).toEqual({ ambientDraws: 0, controlClones: 0 })
      const endpoint = await page.locator(restoring ? '.scrollMiniPlaceholder' : '.mobileMiniBarMorphOverlay').boundingBox()
      await touch('touchMove', { ...start, y: start.y + direction * Math.abs(endpoint.y - bounds.y) * 0.8 })
      const overlay = page.locator('.mobileMiniBarMorphOverlay')
      await expect(overlay).toHaveCSS('opacity', restoring ? '0' : '1')
      expect(await overlay.evaluate(element => Number(getComputedStyle(element).zIndex)))
        .toBeLessThan(await player.evaluate(element => Number(getComputedStyle(element).zIndex)))
      const screenshotPath = testInfo.outputPath(`${restoring ? 'restoring' : 'minimizing'}.png`)
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach(`${restoring ? 'restoring' : 'minimizing'} mobile player`, {
        path: screenshotPath,
        contentType: 'image/png'
      })
      await touch('touchEnd')
      if (restoring) {
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await expect(page).toHaveURL(/#\/watch\//)
      } else {
        await expect(player).toHaveClass(/scrollMiniPlayer/)
        await expect(page).not.toHaveURL(/#\/watch\//)
      }
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      expect(await originalVideo.evaluate(element => element === document.querySelector('.ftVideoPlayer video') && !element.paused)).toBe(true)
    }
    await resetMiniPlayerWork(page)
    await expect.poll(() => page.evaluate(() => window.__miniPlayerWork.ambientDraws)).toBeGreaterThan(0)
  } finally {
    await touch('touchCancel').catch(() => {})
    await stopTrackingMiniPlayerWork(page)
    await cdp.detach()
    await originalVideo.dispose()
  }
})

test.describe('minimizing with a phone drawer', { tag: '@scale' }, () => {
  for (const panel of ['comments']) {
    test(`swiping with the ${panel} drawer restores it on cancellation and closes it on minimization`, async ({ app, page }) => {
      const player = await openMobilePlayer(app, page)
      const watch = await watchViewHandle(page)
      await watch.evaluate((vm, panel) => {
        if (panel === 'chapters') vm.videoChapters = [{ title: 'Chapter', startSeconds: 0, endSeconds: 10, timestamp: '0:00' }]
        vm.openPhonePanel(panel)
      }, panel)
      const sheet = page.locator('.dockedSheet[open]')
      await expect(sheet).toBeVisible()
      await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
      await expect(player).toHaveAttribute('data-phone-panel-video', '')
      const bounds = await player.boundingBox()
      expect(bounds).not.toBeNull()
      const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const cdp = await page.context().newCDPSession(page)
      const touch = (type, distance) => cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: distance === undefined ? [] : [{ ...start, y: start.y + distance }]
      })
      try {
        await touch('touchStart', 0)
        await touch('touchMove', 30)
        await expect(player).toHaveAttribute('data-inline-mini-drag', '')
        await expect(sheet).toHaveCount(0)
        await touch('touchCancel')
        await expect(player).not.toHaveAttribute('data-inline-mini-drag')
        await expect(sheet).toBeVisible()
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))

        await touch('touchStart', 0)
        for (const distance of [20, 40, 60, 80, 110]) {
          await touch('touchMove', distance)
          await page.evaluate(() => new Promise(requestAnimationFrame))
        }
        await touch('touchEnd')
        await expect(player).toHaveClass(/scrollMiniPlayer/)
        await expect(page).not.toHaveURL(/#\/watch\//)
        await expect(sheet).toHaveCount(0)
        await expect(page.locator('.mobileMiniBarOverlay')).toBeVisible()
        await expect(player).not.toHaveAttribute('data-phone-panel-video')
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
      } finally {
        await cdp.detach()
      }
    })
  }
})

test.describe('browsing scroll during mobile minimize', () => {
  test.use({
    seed: {
      settings: { landingPage: 'history', videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableVideoZoom: false, enableMobileFullscreenSwipe: false },
      history: Array.from({ length: 40 }, (_, index) => ({
        ...watchHistoryEntry,
        _id: index ? `history-${index}` : watchHistoryEntry.videoId,
        videoId: index ? `history-${index}` : watchHistoryEntry.videoId,
        title: `History video ${index}`,
        timeWatched: Date.now() - index * 1000
      }))
    }
  })

  test('a short watch page excludes the retained history from its scroll range', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setWindowSize(app, page, { width: 480, height: 850 })
    await page.evaluate(async () => {
      await window.$store.dispatch('updateHideRecommendedVideos', true)
      await window.$store.dispatch('updateScrollPlayerMode', 'off')
    })
    const history = page.locator('.tabContent > .routerView').first()
    await expect(history.locator('.ft-list-video').first()).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    const historyHeight = await history.evaluate(element => element.scrollHeight)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await history.locator(`a[href="#/watch/${watchHistoryEntry.videoId}"]`).first().evaluate(element => element.click())
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    const view = await page.evaluateHandle(findWatchComponent)
    for (const offline of [false, true]) {
      await view.evaluate((component, offline) => { component.proxy.isOffline = offline }, offline)
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await expect.poll(() => page.evaluate(() => {
        const browsing = document.querySelector('.tabContent[aria-hidden="false"] > .browsingBehindWatch')
        const actual = document.scrollingElement.scrollHeight
        // The retained page must have the same scroll extent as an absent page,
        // including the platform's normal header and bottom-navigation spacing.
        const display = browsing.style.display
        browsing.style.display = 'none'
        const withoutBrowsing = document.scrollingElement.scrollHeight
        browsing.style.display = display
        return actual - withoutBrowsing
      })).toBeLessThanOrEqual(1)
      expect(await page.locator('.videoLayout').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(historyHeight)
    }
    await view.dispose()
  })

  test('minimize reveals history at its saved scroll position', { tag: '@scale' }, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await setWindowSize(app, page, { width: 480, height: 850 })
    await page.evaluate(() => window.$store.commit('setReducedMotion', 'off'))
    const history = page.locator('.tabContent > .routerView').first()
    await expect(history.locator('.ft-list-video').first()).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }))
    const saved = await history.evaluate(element => ({ top: element.getBoundingClientRect().top, scroll: window.scrollY }))
    expect(saved.scroll).toBeGreaterThan(500)
    await history.locator(`a[href="#/watch/${watchHistoryEntry.videoId}"]`).first().evaluate(element => element.click())
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    await enableMobileTouch(app, page, true, false)
    const player = page.locator('.ftVideoPlayer')
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
    try {
      const box = await player.boundingBox()
      expect(box, 'the player must have a visible box before starting the swipe').not.toBeNull()
      const start = { x: box.x + 16, y: box.y + 16 }
      await touch('touchStart', start)
      await touch('touchMove', { ...start, y: start.y + 80 })
      await expect(player).toHaveAttribute('data-inline-mini-drag', '')
      expect(await history.evaluate(element => element.getBoundingClientRect().top), 'cancelled preview uses the saved history position').toBeCloseTo(saved.top, 0)
      await touch('touchCancel')
      await expect(player).not.toHaveAttribute('data-inline-mini-drag')
      await expect(page).toHaveURL(/#\/watch\//)
      expect(await history.evaluate(element => element.style.translate)).toBe('')
      await touch('touchStart', start)
      for (const distance of [30, 80, 140, 200]) await touch('touchMove', { ...start, y: start.y + distance })
      await expect(player).toHaveAttribute('data-inline-mini-drag', '')
      expect(await history.evaluate(element => element.getBoundingClientRect().top), 'history must already be scrolled while the drag is held').toBeCloseTo(saved.top, 0)
      await page.screenshot({ path: testInfo.outputPath('history-during-minimize.png') })
      const frames = sampleBrowsingPreviewTops(history)
      await touch('touchEnd')
      await expect(page).toHaveURL(/#\/history/)
      await expect(player).not.toHaveAttribute('data-inline-mini-drag')
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(saved.scroll, 0)
      expect(await history.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(saved.top, 0)
      expect((await frames).every(top => Math.abs(top - saved.top) <= 2), 'history stays in place through settling and navigation').toBe(true)
    } finally {
      await touch('touchCancel').catch(() => {})
      await cdp.detach()
    }
  })

  test('Back during a held minimize preview preserves Watch scroll', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await setWindowSize(app, page, { width: 480, height: 850 })
    const history = page.locator('.tabContent > .routerView').first()
    await expect(history.locator('.ft-list-video').first()).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }))
    await history.locator(`a[href="#/watch/${watchHistoryEntry.videoId}"]`).first().evaluate(element => element.click())
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    await enableMobileTouch(app, page, true, false)
    const watchScroll = await page.evaluate(() => window.scrollY)
    const player = page.locator('.ftVideoPlayer')
    const box = await player.boundingBox()
    expect(box, 'the player must have a visible box before starting the swipe').not.toBeNull()
    const start = { x: box.x + 16, y: box.y + 16 }
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + 140 }] })
      await expect(player).toHaveAttribute('data-inline-mini-drag', '')
      await page.locator('.navBackButton button').evaluate(element => element.click())
      await expect(page).toHaveURL(/#\/history/)
      await expect(player).not.toHaveAttribute('data-inline-mini-drag')
      const savedWatchScroll = await page.evaluate(() => {
        const store = window.$store
        const tab = store.getters.getTabById(store.getters.getPresentedTabId)
        return tab.history[tab.historyIndex + 1].scroll.top
      })
      expect(savedWatchScroll).toBeCloseTo(watchScroll, 0)
      await page.locator('.navForwardButton button').evaluate(element => element.click())
      await expect(page).toHaveURL(/#\/watch\//)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(watchScroll, 0)
    } finally {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await cdp.detach()
    }
  })

  for (const trigger of ['remove', 'replace', 'search locale change', 'resize', 'responsive']) {
    test(`minimize clamps history after ${trigger} reduces its scroll range`, { tag: '@scale' }, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      const history = page.locator('.tabContent > .routerView').first()
      await expect(history.locator('.ft-list-video').first()).toBeVisible()
      if (trigger === 'search locale change') {
        await page.evaluate(() => {
          const store = window.$store
          store.commit('setHistoryCacheSorted', store.getters.getHistoryCacheSorted.map((entry, index) => ({
            ...entry, title: index < 8 ? 'istanbul' : 'Istanbul', author: 'Channel'
          })))
        })
        await page.getByRole('searchbox', { name: 'Search in History' }).fill('i')
        await expect(history.locator('.historySearchLoader')).toHaveCount(0)
      }
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await expect(history.locator(`a[href="#/watch/${watchHistoryEntry.videoId}"]`)).toHaveCount(0)
      const savedScroll = await page.evaluate(() => window.scrollY)
      await page.getByRole('button', { name: 'Open Search Container', exact: true }).click()
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(savedScroll, 0)
      const video = await openMockedVideo(page)
      const savedHistoryScroll = await page.evaluate(() => {
        const store = window.$store
        const tab = store.getters.getTabById(store.getters.getPresentedTabId)
        return tab.history[tab.historyIndex - 1].scroll.top
      })
      expect(savedHistoryScroll).toBeCloseTo(savedScroll, 0)
      await video.evaluate(element => element.pause())
      await enableMobileTouch(app, page, true, false)
      if (trigger === 'remove' || trigger === 'replace') {
        await page.evaluate(trigger => {
          const store = window.$store
          store.commit('setHistoryCacheSorted', trigger === 'replace' ? [] : store.getters.getHistoryCacheSorted.slice(0, 8))
        }, trigger)
      } else if (trigger === 'search locale change') {
        await page.evaluate(async () => {
          const store = window.$store
          await store.dispatch('updateCurrentLocale', 'tr')
        })
        await expect(history.locator('.historySearchLoader')).toHaveCount(0)
      } else {
        // Narrower History controls can grow taller, so the viewport must grow enough to shorten the range.
        await setWindowSize(app, page, { width: trigger === 'resize' ? 481 : 400, height: 1200 })
      }
      const player = page.locator('.ftVideoPlayer')
      const cdp = await page.context().newCDPSession(page)
      try {
        const box = await player.boundingBox()
        expect(box, 'the player must have a visible box before starting the swipe').not.toBeNull()
        const start = { x: box.x + 16, y: box.y + 16 }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + 140 }] })
        await expect(player).toHaveAttribute('data-inline-mini-drag', '')
        const held = await history.evaluate(element => ({ top: element.getBoundingClientRect().top, end: element.querySelector('.card').getBoundingClientRect().bottom, viewport: innerHeight }))
        if (trigger === 'replace') {
          await expect(history.locator('.message')).toBeVisible()
          await expect(history.locator('.ft-list-video')).toHaveCount(0)
        } else {
          expect(held.end, 'the shortened page must not leave an empty preview').toBeGreaterThan(held.viewport - 200)
        }
        const frames = sampleBrowsingPreviewTops(history)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(player).not.toHaveAttribute('data-inline-mini-drag')
        await expect(page).toHaveURL(/#\/history/)
        expect(await page.evaluate(() => window.scrollY)).toBeLessThan(savedScroll)
        const tops = await frames
        expect(tops.every(top => Math.abs(top - held.top) <= 2), `clamping must finish before the preview is visible: ${JSON.stringify({ held, min: Math.min(...tops), max: Math.max(...tops) })}`).toBe(true)
        await expect.poll(() => page.evaluate(() => {
          const content = document.querySelector('.app > .routerView')
          const margin = Number.parseFloat(getComputedStyle(content).marginBottom) || 0
          const renderedRange = Math.max(0, content.getBoundingClientRect().bottom + scrollY + margin - innerHeight)
          const range = Math.max(0, document.documentElement.scrollHeight - innerHeight)
          const scrollbar = document.querySelector('body > .os-scrollbar-vertical')
          const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
          const handle = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect()
          const overflowing = range > 1
          return {
            validRange: Math.abs(range - renderedRange) <= 1 && scrollY <= renderedRange + 1,
            usable: !scrollbar.classList.contains('os-scrollbar-unusable'),
            overflowing,
            thumbMatches: !overflowing || (
              Math.abs(handle.top - track.top - scrollY / range * (track.height - handle.height)) <= 1 &&
              Math.abs(handle.height / track.height - innerHeight / (innerHeight + range)) <= 0.01
            )
          }
        })).toEqual({ validRange: true, usable: trigger !== 'replace', overflowing: trigger !== 'replace', thumbMatches: true })
      } finally {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
        await cdp.detach()
      }
    })
  }
})

test('tablet swipe docks toward the bottom bar', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page, false)
  await page.evaluate(() => {
    const player = document.querySelector('.ftVideoPlayer')
    new MutationObserver(() => {
      if (player.hasAttribute('data-mobile-mini-morph')) {
        window.lastMiniMorphTop = player.getBoundingClientRect().top
      }
    }).observe(player, { attributes: true, attributeFilter: ['style'] })
  })
  const bounds = await player.boundingBox()
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (const distance of [20, 40, 60, 80, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    const targetTop = await page.evaluate(() => window.lastMiniMorphTop)
    expect(targetTop).toBeGreaterThan(bounds.y + 100)
  } finally {
    await cdp.detach()
  }
})

test('bottom bar can close a video retained after leaving Watch', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const bounds = await player.boundingBox()
  expect(bounds).not.toBeNull()
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (const distance of [20, 40, 60, 80, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(page).not.toHaveURL(/#\/watch\//)
    await page.getByRole('button', { name: 'Hide mini player' }).last().click()
    await expect(page.locator('.mobileMiniBarOverlay')).toHaveCount(0)
    await expect(page.locator('.ftVideoPlayer.scrollMiniPlayer')).toHaveCount(0)
  } finally {
    await cdp.detach()
  }
})

test('bottom bar disappears when its video is hidden on another tab', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await player.locator('video').first().evaluate(element => element.play())
  await page.locator('.tabBar .newTabButton').click()
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  const overlay = page.locator('.mobileMiniBarOverlay')
  await expect(overlay).toBeVisible()
  await overlay.getByRole('button', { name: 'Hide mini player' }).click()
  await expect(player).toHaveClass(/scrollMiniPlayerDismissed/)
  await expect(overlay).toHaveCount(0)
})

test('scroll docking follows the current player height after a wider layout', { tag: '@scale' }, async ({ app, page }) => {
  // Watch opens in the wider default window before narrowing, like leaving
  // fullscreen passes through the landscape viewport.
  const player = await openMobilePlayer(app, page)
  const docking = await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.height = '3000px'
    document.body.append(spacer)
    const element = document.querySelector('.ftVideoPlayer')
    return new Promise(resolve => {
      let previous = null
      const step = () => {
        if (element.classList.contains('scrollMiniPlayer')) return resolve(previous)
        const { top, height } = element.getBoundingClientRect()
        previous = { top, height }
        if (top < -2 * height) return resolve(null)
        window.scrollBy(0, 10)
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  })
  expect(docking, 'the player docks while scrolling past it').not.toBeNull()
  // It docks once less than 15% remains visible, before scrolling fully out of
  // view. The scroll handler can trail the last sample by two 10px steps.
  expect(docking.top + docking.height).toBeGreaterThan(0)
  expect(docking.top + docking.height).toBeLessThan(docking.height * 0.15 + 20)
  await expect(player).toHaveClass(/scrollMiniPlayer/)
})

test('disabled fullscreen and zoom gestures allow upward scrolling and downward docking', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  const bounds = await player.boundingBox()
  expect(bounds).not.toBeNull()
  const cdp = await page.context().newCDPSession(page)
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    for (const distance of [16, 32, 48, 64, 80]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y - distance }] })
      await page.waitForTimeout(30)
    }
    await page.evaluate(() => {
      window.testScrollFinished = new Promise(resolve => {
        window.addEventListener('scrollend', () => resolve(), { once: true })
      })
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(20)
    await expect(player).not.toHaveClass(/mobileFullscreenSwiping/)
    await page.evaluate(() => window.testScrollFinished)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    const restored = await player.boundingBox()
    expect(restored).not.toBeNull()
    const start = { x: restored.x + restored.width / 2, y: restored.y + restored.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (const distance of [16, 32, 64, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      await page.waitForTimeout(30)
    }
    await expect(page.locator('.browsingBehindWatch')).toHaveCount(1)
    await expect(page.locator('.watchDragPreview')).toHaveCount(1)
    await expect(page.locator('.browsingBehindWatch')).toBeVisible()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
  } finally {
    await cdp.detach()
  }
})

test('first downward dock renders no browsing content during the swipe', { tag: '@performance' }, async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const browsing = page.locator('.browsingBehindWatch')
  await expect(browsing).toHaveCount(1)
  const bounds = await player.boundingBox()
  expect(bounds).not.toBeNull()
  const cdp = await page.context().newCDPSession(page)
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  try {
    // Mounting or navigating to the destination mid-swipe caused long frames.
    await browsing.evaluate(element => {
      window.__dragBrowsing = element
      window.__dragAddedNodes = 0
      window.__dragObserver = new MutationObserver(records => {
        for (const record of records) window.__dragAddedNodes += record.addedNodes.length
      })
      window.__dragObserver.observe(element, { childList: true, subtree: true })
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (const distance of [16, 32, 64, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      await page.waitForTimeout(50)
    }
    await expect(player).toHaveAttribute('data-inline-mini-drag', '')
    const during = await page.evaluate(() => {
      window.__dragObserver.disconnect()
      return {
        addedNodes: window.__dragAddedNodes,
        sameBrowsing: document.querySelector('.browsingBehindWatch') === window.__dragBrowsing,
        watchRoute: location.hash.startsWith('#/watch/')
      }
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    expect(during).toEqual({ addedNodes: 0, sameBrowsing: true, watchRoute: true })
  } finally {
    await cdp.detach()
  }
})

test.describe('a restored Watch tab', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        enableVideoZoom: false,
        enableMobileFullscreenSwipe: false,
        startupBehavior: 'restoreTabLoadState'
      },
      tabSessions: [{
        _id: 'e2e-window-session',
        value: {
          tabs: [
            { id: 'browse', url: 'app://bundle/index.html#/subscriptions', title: 'Subscriptions', isUnloaded: false },
            {
              id: 'watch',
              url: 'app://bundle/index.html#/watch/jNQXAC9IVRw',
              title: 'Saved video',
              isUnloaded: true,
              history: [{ route: { path: '/watch/jNQXAC9IVRw' }, title: 'Saved video', scroll: { left: 0, top: 0 } }],
              historyIndex: 0
            }
          ],
          activeTabId: 'browse'
        }
      }]
    },
    // The tab bar loads the restored tab's icon while the app starts. Mock the
    // Watch requests before then, or that load reaches YouTube or is aborted.
    // An aborted request holds back the next YouTube requests for retries.
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a fixture object
    onPhase: async ({}, use) => {
      await use(async (phase, page, electronApp) => {
        if (phase === 'windowCreated') await mockPlayableWatchPage({ electronApp }, page)
      })
    }
  })

  test('prepares and opens subscriptions on the first restored Watch dock', async ({ app, page }) => {
    await page.locator('.tab[data-tab-id="watch"]').click()
    const watchTab = page.locator('.tabContent[data-tab-id="watch"]')
    const player = watchTab.locator('.ftVideoPlayer')
    await expect(player).toBeVisible({ timeout: 30_000 })
    await waitForPlayback(page)
    await enableMobileTouch(app, page)
    await expect(watchTab.locator('.browsingBehindWatch.subscriptionsPage')).toHaveCount(1)
    const bounds = await player.boundingBox()
    expect(bounds).not.toBeNull()
    const cdp = await page.context().newCDPSession(page)
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
      for (const distance of [16, 32, 64, 100]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
        await page.waitForTimeout(30)
      }
      await expect(watchTab.locator('.watchDragPreview')).toHaveCount(1)
      await expect(watchTab.locator('.browsingBehindWatch.subscriptionsPage')).toHaveCount(1)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.locator('.ftVideoPlayer.scrollMiniPlayer')).toHaveCount(1)
      await expect(page).toHaveURL(/#\/subscriptions$/)
    } finally {
      await cdp.detach()
    }
  })
})
for (const swipe of [false, true]) {
  test(`${swipe ? 'swiping' : 'clicking'} across the bottom bar returns to Watch`, { tag: '@scale' }, async ({ app, page }) => {
    const player = await openMobilePlayer(app, page)
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [point] : []
    })
    try {
      for (const region of mobileMiniPlayerRegions) {
        const bounds = await player.boundingBox()
        const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        await touch('touchStart', start)
        for (const distance of [20, 40, 60, 80, 100]) {
          await touch('touchMove', { ...start, y: start.y + distance })
        }
        await touch('touchEnd')
        await expect(page).not.toHaveURL(/#\/watch\//)
        await expect(player).toHaveClass(/scrollMiniPlayer/)
        const returnButton = player.locator('.mobileMiniBarReturn')
        await expect(returnButton).toBeEnabled()
        await expect(returnButton.locator('svg')).toHaveCount(0)
        const point = await player.evaluate(mobileMiniPlayerReturnPoint, region)
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('mobileMiniBarReturn'), point), region).toBe(true)
        if (swipe) {
          await touch('touchStart', point)
          for (const distance of [20, 40, 80, 100]) {
            await touch('touchMove', { ...point, y: point.y - distance })
          }
          await touch('touchEnd')
        } else {
          // Android taps are verified on WebView; Electron needs mouse input
          // to exercise the button's native click and pressed appearance.
          await page.mouse.move(point.x, point.y)
          await page.mouse.down()
          if (region === 'thumbnail') {
            await expect(returnButton).toHaveCSS('background-color', /(?:\/|,)\s*0\.12\)/)
          }
          await page.mouse.up()
        }
        await expect(page, `${swipe ? 'swipe' : 'click'} on ${region}`).toHaveURL(/#\/watch\//)
        await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        // Let click suppression from this gesture expire before the next one.
        await page.waitForTimeout(400)
      }
    } finally {
      await touch('touchEnd').catch(() => {})
      await cdp.detach()
    }
  })
}

test('swiping across the scroll-triggered bottom bar returns to the video', { tag: '@scale' }, async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
  })
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [point] : []
  })
  try {
    await page.evaluate(() => window.scrollTo(0, 1200))
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
    const cancelPoint = await player.evaluate(mobileMiniPlayerReturnPoint, 'thumbnail')
    for (const end of ['touchCancel', 'touchEnd']) {
      await touch('touchStart', cancelPoint)
      await touch('touchMove', { ...cancelPoint, y: cancelPoint.y - 40 })
      // Hold the drag so its release is not a fling.
      await page.waitForTimeout(300)
      await touch(end)
      // The bar must stay docked after a gesture below the restore threshold.
      await page.waitForTimeout(400)
      await expect(player, `${end} below the restore threshold`).toHaveClass(/scrollMiniPlayer/)
    }
    for (const region of mobileMiniPlayerRegions) {
      await page.evaluate(() => window.scrollTo(0, 1200))
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await expect(page).toHaveURL(/#\/watch\//)
      const point = await player.evaluate(mobileMiniPlayerReturnPoint, region)
      await touch('touchStart', point)
      for (const distance of [20, 40, 80, 100]) {
        await touch('touchMove', { ...point, y: point.y - distance })
      }
      await touch('touchEnd')
      await expect(player, `swipe on ${region}`).not.toHaveClass(/scrollMiniPlayer/)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await expect(page).toHaveURL(/#\/watch\//)
      // Let click suppression from this gesture expire before the next one.
      await page.waitForTimeout(400)
    }
  } finally {
    await touch('touchEnd').catch(() => {})
    await cdp.detach()
  }
})

test('tapping the scroll-triggered bottom bar expands it while the page scrolls up', { tag: '@scale' }, async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const settledTop = await player.locator('video').evaluate(video => video.getBoundingClientRect().top)
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
    window.scrollTo(0, 1200)
  })
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
  await player.evaluate(element => {
    const video = element.querySelector('video')
    const frames = window.restoreFrames = []
    const sample = () => {
      frames.push({
        morph: element.hasAttribute('data-mobile-mini-morph'),
        scrollY: window.scrollY,
        top: video.getBoundingClientRect().top
      })
      if (!window.restoreFramesDone) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const point = await player.evaluate(mobileMiniPlayerReturnPoint, 'title')
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
  // Sample one more frame after the morph so the handoff is always recorded.
  const frames = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    window.restoreFramesDone = true
    resolve(window.restoreFrames.splice(0))
  }))))
  const first = frames.findIndex(frame => frame.morph)
  const last = frames.findLastIndex(frame => frame.morph)
  expect(first).toBeGreaterThan(-1)
  // The bar expands at once instead of waiting for the scroll to reveal its slot.
  expect(frames[first].scrollY).toBeGreaterThan(600)
  const morph = frames.slice(first, last + 1)
  for (const [index, frame] of morph.entries()) {
    // The video rises straight to its slot without overshooting the page top.
    expect(frame.top, `frame ${index}`).toBeGreaterThanOrEqual(settledTop - 0.5)
    if (index > 0) expect(frame.top, `frame ${index}`).toBeLessThanOrEqual(morph[index - 1].top + 0.5)
  }
  // The inline player takes over exactly where the morph ended.
  expect(frames[last].top).toBeCloseTo(settledTop, 0)
  expect(last + 1, 'a frame after the morph').toBeLessThan(frames.length)
  expect(frames[last + 1].top).toBeCloseTo(settledTop, 0)

  // Older WebKit has no scrollend. The bar must still dock again afterwards,
  // also when a touch stops the restore scroll halfway.
  await page.evaluate(() => {
    window.blockScrollEnd = event => event.stopImmediatePropagation()
    window.addEventListener('scrollend', window.blockScrollEnd, true)
  })
  try {
    await page.evaluate(() => window.scrollTo(0, 1200))
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
    await player.evaluate(element => element.querySelector('.mobileMiniBarReturn').click())
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(1100)
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }))
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
  } finally {
    await page.evaluate(() => window.removeEventListener('scrollend', window.blockScrollEnd, true))
  }

  // Reduced motion has no morph to wait for. The page jumps up, and the bar
  // docks again on the next scroll down.
  await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await player.evaluate(element => element.querySelector('.mobileMiniBarReturn').click())
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect(player).toHaveClass(/scrollMiniPlayer/)
})

test('bottom bar taps restore despite finger drift or a dropped click, and short flicks restore it', { tag: '@scale' }, async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
  })
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [point] : []
  })
  const tap = async ({ drift = 0, dropClick = false }) => {
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
    const point = await player.evaluate(mobileMiniPlayerReturnPoint, 'title')
    if (dropClick) {
      // Chromium dispatches no click for a tap that stops a page fling.
      await page.evaluate(() => {
        window.dropClick = event => event.stopImmediatePropagation()
        window.addEventListener('click', window.dropClick, true)
      })
    }
    // Hardware timestamps keep the measured speed independent of how long
    // the app takes to handle each event.
    const timestamp = Date.now() / 1000
    const send = (type, time, point) => cdp.send('Input.dispatchTouchEvent', {
      type, timestamp: timestamp + time, touchPoints: point ? [point] : []
    })
    await send('touchStart', 0, point)
    if (drift) await send('touchMove', 0.02, { ...point, y: point.y + drift })
    await send('touchEnd', 0.04)
    if (dropClick) {
      // The click that never came must not swallow the next tap's click.
      const clicked = await page.evaluate(() => {
        window.removeEventListener('click', window.dropClick, true)
        let clicked = false
        const target = document.createElement('button')
        target.addEventListener('click', () => { clicked = true })
        document.body.append(target)
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        target.click()
        target.remove()
        return clicked
      })
      expect(clicked).toBe(true)
    }
  }
  // A quick 40px flick is below the swipe distance but commits as a fling.
  const taps = [{ drift: -12 }, { dropClick: true }, { drift: -40 }]
  const scrollTaps = [...taps, { drift: 16, dropClick: true }]
  try {
    for (const gesture of scrollTaps) {
      await page.evaluate(() => window.scrollTo(0, 1200))
      await tap(gesture)
      await expect(player, JSON.stringify(gesture)).not.toHaveClass(/scrollMiniPlayer/)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await page.evaluate(() => window.removeEventListener('click', window.dropClick, true))
    }
    for (const gesture of [...taps, { drift: 12 }]) {
      const bounds = await player.boundingBox()
      const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      await touch('touchStart', start)
      for (const distance of [20, 40, 60, 80, 100]) {
        await touch('touchMove', { ...start, y: start.y + distance })
      }
      await touch('touchEnd')
      await expect(page).not.toHaveURL(/#\/watch\//)
      await tap(gesture)
      await expect(page, JSON.stringify(gesture)).toHaveURL(/#\/watch\//)
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await page.evaluate(() => window.removeEventListener('click', window.dropClick, true))
    }
  } finally {
    await page.evaluate(() => window.removeEventListener('click', window.dropClick, true)).catch(() => {})
    await touch('touchEnd').catch(() => {})
    await cdp.detach()
  }
})

async function checkBottomBarPlaybackControls({ app, page, uiScale }, testInfo) {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
    window.scrollTo(0, 1200)
  })
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
  const video = player.locator('video').first()
  const controls = player.locator('.mobileMiniBarPlayback')
  const progress = player.locator('.mobileMiniBarProgress > div')
  const expectProgress = async () => {
    await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
    await expect.poll(() => progress.evaluate(element => {
      const video = document.querySelector('.ftVideoPlayer video')
      return Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).a - video.currentTime / video.duration)
    })).toBeLessThan(0.01)
  }
  const thumbnailBounds = await video.boundingBox()
  expect(thumbnailBounds.width).toBeCloseTo(80, 1)
  expect(thumbnailBounds.height).toBeCloseTo(45, 1)
  await expect(controls.getByRole('button')).toHaveCount(3)
  const rewind = controls.getByRole('button', { name: 'Rewind 10 seconds' })
  const forward = controls.getByRole('button', { name: 'Forward 10 seconds' })
  for (const button of await controls.getByRole('button').all()) {
    const bounds = await button.boundingBox()
    // Fractional UI scales snap the 48px targets to physical pixels.
    expect(bounds.width).toBeGreaterThanOrEqual(47.9)
    expect(bounds.height).toBeGreaterThanOrEqual(47.9)
  }
  await video.evaluate(element => { element.currentTime = 15 })
  await forward.click()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(25, 1)
  await expectProgress()
  await rewind.click()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(15, 1)
  await expectProgress()
  await video.evaluate(element => { element.currentTime = 2 })
  await rewind.click()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(0)
  await expectProgress()
  await controls.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.5)
  await expectProgress()
  await controls.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await controls.getByRole('button', { name: 'Play', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)

  // Playlist controls follow the same capabilities and events as the full player.
  const watch = await watchViewHandle(page)
  await watch.evaluate(async vm => {
    vm.playlistId = 'mini-bar-playlist'
    vm.playlistType = 'user'
    vm.watchingPlaylist = true
    window.miniBarSkips = []
    vm.handleSkipToPrev = () => window.miniBarSkips.push('previous')
    vm.handleSkipToNext = () => window.miniBarSkips.push('next')
    await vm.$nextTick()
  })
  await expect(controls.getByRole('button')).toHaveCount(5)
  await controls.getByRole('button', { name: 'Previous', exact: true }).click()
  await controls.getByRole('button', { name: 'Next', exact: true }).click()
  expect(await page.evaluate(() => window.miniBarSkips)).toEqual(['previous', 'next'])
  await testInfo.attach('bottom bar playback controls', { body: await player.screenshot(), contentType: 'image/png' })
  for (const size of [{ width: 320, height: 800 }, { width: 375, height: 850 }, { width: 850, height: 480 }]) {
    await setWindowSize(app, page, size)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
    // Electron retains desktop docking calculations after a resize. Supply
    // the native bar's full-width bounds when checking its responsive CSS.
    await player.evaluate(element => {
      element.style.left = '0px'
      element.style.width = `${window.innerWidth}px`
      element.style.height = '108px'
    })
    await expect.poll(() => controls.evaluate(element => {
      const bar = element.closest('.ftVideoPlayer').getBoundingClientRect()
      return [...element.querySelectorAll('button')].every(button => {
        const bounds = button.getBoundingClientRect()
        return bounds.left >= bar.left - 0.5 && bounds.right <= bar.right + 0.5 && bounds.bottom <= bar.bottom + 0.5
      })
    })).toBe(true)
    for (const button of await controls.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      // Upscaled bars may use narrower CSS targets, but never below 48 device
      // pixels. A chosen downscale keeps the 48 CSS pixel target.
      expect(bounds.width * Math.max(uiScale, 100) / 100).toBeGreaterThanOrEqual(47.9)
    }
  }
  await player.locator('.mobileMiniBarReturn').click({ position: { x: 60, y: 30 } })
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
}

test('bottom bar playback controls work without reopening Watch', { tag: '@scale' }, checkBottomBarPlaybackControls)

for (const { uiScale, size } of [
  { uiScale: 125, size: { width: 375, height: 800 } },
  { uiScale: 100, size: { width: 850, height: 480 } },
]) {
  test(`compact mobile strip expands controls and restores playback at ${uiScale}% in ${size.width}px`, async ({ app, page }, testInfo) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(scale => {
      window.ftElectron.setZoomFactor(scale / 100)
      const store = window.$store
      store.commit('setCompactMobileMiniPlayer', true)
      store.commit('setKeepPlayingOnNavigation', true)
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      document.body.append(spacer)
    }, uiScale)
    const watch = await watchViewHandle(page)
    await setWindowSize(app, page, size)
    await page.evaluate(async width => {
      const store = window.$store
      await store.dispatch('updateIconPack', width === 375 ? 'material' : 'remix')
      await store.dispatch('updateReducedMotion', width === 375 ? 'off' : 'on')
    }, size.width)
    await page.evaluate(() => window.scrollTo(0, 1200))
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
    await checkCompactMiniPlayer(page, player, async state => {
      await testInfo.attach(`${state}-${size.width}`, { body: await player.screenshot(), contentType: 'image/png' })
    }, async () => {
      // The desktop build can retain its desktop docking rectangle when the
      // simulated mobile classes change during navigation. Android tests
      // cover the real docking geometry; provide that geometry for CSS here.
      await player.evaluate(() => {
        const nav = document.querySelector('.app > .sideNav').getBoundingClientRect()
        const left = window.innerWidth > 680 ? Math.max(0, nav.right) : 0
        let style = document.querySelector('#compact-mini-player-test-layout')
        if (!style) {
          style = document.createElement('style')
          style.id = 'compact-mini-player-test-layout'
          document.head.append(style)
        }
        style.textContent = `
          .ftVideoPlayer.scrollMiniPlayer.mobileMiniBar {
            left: ${left}px !important;
            width: ${window.innerWidth - left}px !important;
            height: 112px !important;
          }
          .ftVideoPlayer.scrollMiniPlayer.mobileMiniBarCollapsed { height: 64px !important; }
        `
      })
    })
    await page.evaluate(() => window.scrollTo(0, 1200))
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
    const seekSession = await page.context().newCDPSession(page)
    try {
      await checkMiniPlayerSeeking(page, player, (type, point) => seekSession.send('Input.dispatchTouchEvent', {
        type, touchPoints: point ? [point] : []
      }))
    } finally {
      await seekSession.detach()
    }
    await player.locator('.mobileMiniBarExpand').click()
    await expect(player.locator('.mobileMiniBarExpand')).toHaveAttribute('aria-expanded', 'true')
    await watch.evaluate(async vm => {
      vm.playlistId = 'mini-bar-playlist'
      vm.playlistType = 'user'
      vm.watchingPlaylist = true
      window.compactMiniBarSkips = []
      vm.handleSkipToPrev = () => window.compactMiniBarSkips.push('previous')
      vm.handleSkipToNext = () => window.compactMiniBarSkips.push('next')
      await vm.$nextTick()
    })
    const controls = player.locator('.mobileMiniBarPlayback')
    await expect(controls.getByRole('button')).toHaveCount(5)
    await controls.getByRole('button', { name: 'Previous', exact: true }).click()
    await controls.getByRole('button', { name: 'Next', exact: true }).click()
    expect(await page.evaluate(() => window.compactMiniBarSkips)).toEqual(['previous', 'next'])
    await player.locator('.mobileMiniBarExpand').click()
    await expect(controls.getByRole('button')).toHaveCount(1)
    await player.locator('.mobileMiniBarExpand').click()
    await page.evaluate(() => window.$store.commit('setCompactMobileMiniPlayer', false))
    await expect(player.locator('.mobileMiniBarExpand')).toHaveCount(0)
    await expect(player.locator('.mobileMiniBarUploader')).toBeVisible()
    await player.locator('.mobileMiniBarReturn').click({ position: { x: 60, y: 30 } })
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await watch.dispose()
  })
}

test('audio mini-player morphs suspend visualizer painting', { tag: '@performance' }, async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const watch = await watchViewHandle(page)
  await watch.evaluate(view => { view.musicMediaType = 'audioTrack' })
  await page.evaluate(async () => {
    await window.$store.dispatch('updateReducedMotion', 'off')
    await window.$store.dispatch('updateMusicVisualizer', true)
    const original = CanvasRenderingContext2D.prototype.fill
    window.musicMorphPaints = { inline: 0, morph: 0 }
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.matches('.musicVisualizerCanvas')) {
        const player = this.canvas.closest('.ftVideoPlayer')
        window.musicMorphPaints[player.hasAttribute('data-mobile-mini-morph') ? 'morph' : 'inline']++
      }
      return original.apply(this, args)
    }
    window.musicMorphStarts = 0
    const observer = new MutationObserver(records => {
      window.musicMorphStarts += records.filter(record => record.oldValue === null).length
    })
    observer.observe(document.querySelector('.ftVideoPlayer'), {
      attributes: true, attributeFilter: ['data-mobile-mini-morph'], attributeOldValue: true
    })
    window.restoreMusicMorphProbe = () => {
      observer.disconnect()
      CanvasRenderingContext2D.prototype.fill = original
    }
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
  })
  const cdp = await page.context().newCDPSession(page)
  try {
    await player.locator('video').evaluate(video => { video.loop = true; return video.play() })
    await expect.poll(() => page.evaluate(() => window.musicMorphPaints.inline)).toBeGreaterThan(0)
    const bounds = await player.boundingBox()
    expect(bounds, 'The audio player is visible before the drag').not.toBeNull()
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...start, y: start.y + 100 }]
    })
    await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
    await page.evaluate(() => { window.musicMorphPaints.inline = 0 })
    await expect.poll(() => page.evaluate(() => window.musicMorphPaints.inline)).toBeGreaterThan(0)
    for (let cycle = 0; cycle < 2; cycle++) {
      const starts = await page.evaluate(() => window.musicMorphStarts)
      await page.evaluate(() => window.scrollTo(0, 1200))
      await expect.poll(() => page.evaluate(() => window.musicMorphStarts)).toBe(starts + 1)
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect.poll(() => page.evaluate(() => window.musicMorphStarts)).toBe(starts + 2)
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await page.evaluate(() => { window.musicMorphPaints.inline = 0 })
      await expect.poll(() => page.evaluate(() => window.musicMorphPaints.inline)).toBeGreaterThan(0)
    }
    expect(await page.evaluate(() => window.musicMorphPaints.morph)).toBe(0)
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await cdp.detach()
    await page.evaluate(() => window.restoreMusicMorphProbe())
    await watch.dispose()
  }
})
