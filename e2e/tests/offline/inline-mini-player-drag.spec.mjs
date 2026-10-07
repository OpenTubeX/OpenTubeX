import { readFile, writeFile } from 'node:fs/promises'

import { test, expect, setPlayerFullscreen, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, mobileMiniPlayerRegions, mobileMiniPlayerReturnPoint, openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'
import { checkCompactMiniPlayer } from '../../helpers/compact-mini-player.mjs'
import { checkMiniPlayerSeeking } from '../../helpers/mini-player-seeking.mjs'
import { routeDemoMedia } from '../../helpers/media.mjs'
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
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

for (const uiScale of [100, 125]) {
  test(`landscape minimize clears the expanded hidden Watch sidebar at ${uiScale}%`, async ({ app, page }) => {
    const player = await openMobilePlayer(app, page)
    await setWindowSize(app, page, { width: 1250, height: 540 })
    await page.evaluate(async scale => {
      window.ftElectron.setZoomFactor(scale / 100)
      const app = document.querySelector('#app').__vue_app__
      const store = app.config.globalProperties.$store
      store.commit('setHideSideBarOnWatchPages', false)
      await new Promise(requestAnimationFrame)
      if (!store.getters.getIsSideNavOpen) store.commit('toggleSideNav')
      await new Promise(requestAnimationFrame)
      store.commit('setHideSideBarOnWatchPages', true)
      await new Promise(requestAnimationFrame)
    }, uiScale)
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
}

for (const uiScale of [100, 125, 150]) {
  test(`landscape mobile mini-player clears the sidebar at ${uiScale}%`, async ({ app, page }, testInfo) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(scale => {
      window.ftElectron.setZoomFactor(scale / 100)
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setKeepPlayingOnNavigation', true)
    }, uiScale)
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
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('toggleSideNav'))
      await expect.poll(() => page.locator('.app > .sideNav').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(expanded ? 200 : 80, 0)
      await expectClearOfSidebar()
    }
    const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('landscape-mini-player.png'), Buffer.from(screenshot, 'base64'))
  })
}

test('mobile swipes suspend ambient sampling and hidden control layout in both directions', async ({ app, page }, testInfo) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

for (const uiScale of [100, 125]) {
  test.describe(`minimizing with a phone drawer at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableVideoZoom: false, enableMobileFullscreenSwipe: false, uiScale } } })

    for (const panel of ['comments', 'description', 'chapters', 'transcript']) {
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
}

for (const uiScale of [100, 125]) {
  test.describe(`scroll mini player at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          enableVideoZoom: false,
          enableMobileFullscreenSwipe: false,
          uiScale
        }
      }
    })

    for (const resize of [false, true]) {
      test(`scroll mini player returns without flashing controls or jumping while scrolling${resize ? ' and resizing' : ''}`, async ({ app, page }) => {
        const player = await openMobilePlayer(app, page)
        if (uiScale === 125) await player.locator('video').first().evaluate(element => element.play())
        await page.evaluate(() => {
          const spacer = document.createElement('div')
          spacer.style.height = '2000px'
          document.body.append(spacer)
          window.scrollTo(0, 1200)
        })
        await expect(player).toHaveClass(/scrollMiniPlayer/)
        await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)

        const framesPromise = page.evaluate(async () => {
          const player = document.querySelector('.ftVideoPlayer')
          const video = player.querySelector('video')
          const frames = []
          let landing = null
          const removeAttribute = player.removeAttribute
          player.removeAttribute = function (name) {
            if (name === 'data-mobile-mini-morph' && this.hasAttribute(name)) {
              // Capture the final rendered geometry before cleanup in the same
              // animation callback; a paint sampler can miss that endpoint.
              const rect = video.getBoundingClientRect()
              landing = { top: rect.top + window.scrollY, width: rect.width }
            }
            return removeAttribute.call(this, name)
          }
          let started = false
          window.scrollTo({ top: 0, behavior: 'smooth' })
          try {
            for (let i = 0; i < 90; i++) {
              // Sample after all animation callbacks for this paint have run.
              await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
              const morph = player.hasAttribute('data-mobile-mini-morph')
              if (morph) started = true
              if (!started) continue
              const rect = video.getBoundingClientRect()
              frames.push({
                morph,
                // Compare document positions: scrolling continues between paints.
                top: rect.top + window.scrollY,
                width: rect.width,
                controlsVisible: [...player.children].some(element => {
                  if (element.matches('.player, .countdownPoster, .mobileMiniBarOverlay')) return false
                  const style = getComputedStyle(element)
                  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && element.getBoundingClientRect().height > 0
                })
              })
              if (!morph) break
            }
            return { frames, landing }
          } finally {
            delete player.removeAttribute
          }
        })
        if (resize) {
          await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
          await setWindowSize(app, page, { width: 640, height: 800 })
        }
        const { frames, landing } = await framesPromise
        expect(frames.filter(frame => frame.morph).length).toBeGreaterThan(2)
        expect.soft(frames.filter(frame => frame.morph && frame.controlsVisible), 'only the video may move during the return').toEqual([])
        expect(landing, 'the restore animation must render its endpoint before cleanup').not.toBeNull()
        const inline = frames.at(-1)
        expect(inline.morph).toBe(false)
        expect.soft(Math.abs(landing.top - inline.top), 'the animation must land at the current scrolled position').toBeLessThan(10)
        expect.soft(Math.abs(landing.width - inline.width)).toBeLessThan(10)
      })
    }
  })
}

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

  for (const uiScale of [100, 125]) {
    test(`minimize reveals history at its saved scroll position at ${uiScale}%`, async ({ app, page }, testInfo) => {
      await mockPlayableWatchPage(app, page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      await page.evaluate(scale => {
        window.ftElectron.setZoomFactor(scale / 100)
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setReducedMotion', 'off')
      }, uiScale)
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
        const start = { x: box.x + 16, y: box.y + 16 }
        await touch('touchStart', start)
        await touch('touchMove', { ...start, y: start.y + 80 })
        await expect(player).toHaveAttribute('data-inline-mini-drag', '')
        expect.soft(await history.evaluate(element => element.getBoundingClientRect().top), 'cancelled preview uses the saved history position').toBeCloseTo(saved.top, 0)
        await touch('touchCancel')
        await expect(player).not.toHaveAttribute('data-inline-mini-drag')
        await expect(page).toHaveURL(/#\/watch\//)
        expect(await history.evaluate(element => element.style.translate)).toBe('')
        await touch('touchStart', start)
        for (const distance of [30, 80, 140, 200]) await touch('touchMove', { ...start, y: start.y + distance })
        await expect(player).toHaveAttribute('data-inline-mini-drag', '')
        expect.soft(await history.evaluate(element => element.getBoundingClientRect().top), 'history must already be scrolled while the drag is held').toBeCloseTo(saved.top, 0)
        await page.screenshot({ path: testInfo.outputPath('history-during-minimize.png') })
        const frames = sampleBrowsingPreviewTops(history)
        await touch('touchEnd')
        await expect(page).toHaveURL(/#\/history/)
        await expect(player).not.toHaveAttribute('data-inline-mini-drag')
        expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(saved.scroll, 0)
        expect(await history.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(saved.top, 0)
        expect((await frames).every(top => Math.abs(top - saved.top) <= 2), 'history stays in place through settling and navigation').toBe(true)
      } finally {
        await cdp.detach()
      }
    })
  }

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
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

  for (const trigger of ['remove', 'resize', 'responsive']) {
    test(`minimize clamps history after ${trigger} reduces its scroll range`, async ({ app, page }) => {
      await mockPlayableWatchPage(app, page)
      await setWindowSize(app, page, { width: 480, height: 850 })
      const history = page.locator('.tabContent > .routerView').first()
      await expect(history.locator('.ft-list-video').first()).toBeVisible()
      const videoLink = await history.locator(`a[href="#/watch/${watchHistoryEntry.videoId}"]`).first().elementHandle()
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      const savedScroll = await page.evaluate(() => window.scrollY)
      await videoLink.evaluate(element => element.click())
      await videoLink.dispose()
      const video = await waitForPlayback(page)
      await video.evaluate(element => element.pause())
      await enableMobileTouch(app, page, true, false)
      if (trigger === 'remove') {
        await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          store.commit('setHistoryCacheSorted', store.getters.getHistoryCacheSorted.slice(0, 8))
        })
      } else {
        await setWindowSize(app, page, trigger === 'resize' ? { width: 481, height: 1200 } : { width: 640, height: 900 })
      }
      const player = page.locator('.ftVideoPlayer')
      const cdp = await page.context().newCDPSession(page)
      try {
        const box = await player.boundingBox()
        const start = { x: box.x + 16, y: box.y + 16 }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + 140 }] })
        await expect(player).toHaveAttribute('data-inline-mini-drag', '')
        const held = await history.evaluate(element => ({ top: element.getBoundingClientRect().top, end: element.querySelector('.card').getBoundingClientRect().bottom, viewport: innerHeight }))
        expect.soft(held.end, 'the shortened page must not leave an empty preview').toBeGreaterThan(held.viewport - 200)
        const frames = sampleBrowsingPreviewTops(history)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect(player).not.toHaveAttribute('data-inline-mini-drag')
        await expect(page).toHaveURL(/#\/history/)
        expect(await page.evaluate(() => window.scrollY)).toBeLessThan(savedScroll)
        const tops = await frames
        expect(tops.every(top => Math.abs(top - held.top) <= 2), `clamping must finish before the preview is visible: ${JSON.stringify({ held, min: Math.min(...tops), max: Math.max(...tops) })}`).toBe(true)
      } finally {
        await cdp.detach()
      }
    })
  }

  test('minimize keeps the Popular sticky header at its browsing position', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(entry => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setBackendPreference', 'invidious')
      store.commit('setPopularCache', Array.from({ length: 40 }, (_, index) => ({ ...entry, videoId: index ? `popular-${index}` : entry.videoId })))
    }, watchHistoryEntry)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Search commands' }).fill('most popular')
    await page.getByRole('option', { name: 'Most Popular', exact: true }).click()
    await setWindowSize(app, page, { width: 480, height: 850 })
    const browsing = page.locator('.popularPage')
    await expect(browsing.locator('.ft-list-video').first()).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }))
    const header = browsing.locator('.pageHeader')
    const savedTop = await header.evaluate(element => element.getBoundingClientRect().top)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setBackendPreference', 'local'))
    await browsing.locator(`a[href="#/watch/${watchHistoryEntry.videoId}"]`).first().evaluate(element => element.click())
    const video = await waitForPlayback(page)
    await video.evaluate(element => element.pause())
    await enableMobileTouch(app, page, true, false)
    const player = page.locator('.ftVideoPlayer')
    const box = await player.boundingBox()
    const start = { x: box.x + 16, y: box.y + 16 }
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + 140 }] })
      await expect(player).toHaveAttribute('data-inline-mini-drag', '')
      expect.soft(await header.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(savedTop, 0)
      const frames = sampleBrowsingPreviewTops(header)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(player).not.toHaveAttribute('data-inline-mini-drag')
      expect((await frames).every(top => Math.abs(top - savedTop) <= 2)).toBe(true)
    } finally {
      await cdp.detach()
    }
  })
})

test.describe('history progress during mobile restore', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        enableVideoZoom: false,
        enableMobileFullscreenSwipe: false,
        landingPage: 'history',
        baseTheme: 'light'
      },
      history: [
        watchHistoryEntry,
        { ...watchHistoryEntry, _id: 'abcdefghijk', videoId: 'abcdefghijk', title: 'Second watched video', timeWatched: Date.now() - 1000 }
      ]
    }
  })

  test('watch preview covers history progress while the upward drag is held', async ({ app, page }) => {
    const player = await openMobilePlayer(app, page)
    const progress = page.locator('.watchedProgressBar').last()
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [point] : []
    })
    try {
      const full = await player.boundingBox()
      const down = { x: full.x + full.width / 2, y: full.y + 100 }
      await touch('touchStart', down)
      for (const distance of [20, 40, 60, 80, 100]) {
        await touch('touchMove', { ...down, y: down.y + distance })
        await page.waitForTimeout(30)
      }
      await touch('touchEnd')
      await expect(player).toHaveClass(/scrollMiniPlayer/)
      await expect(progress).toBeVisible()
      await player.evaluate(element => {
        element.style.left = '0px'
        element.style.width = `${window.innerWidth}px`
        element.style.height = '108px'
      })
      await page.waitForTimeout(300)
      const bar = await player.boundingBox()
      const up = { x: bar.x + 60, y: bar.y + bar.height / 2 }
      await touch('touchStart', up)
      for (const distance of [20, 40, 80, 200, 350]) {
        await touch('touchMove', { ...up, y: up.y - distance })
        await page.waitForTimeout(30)
      }
      await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
      const preview = page.locator('.watchDragPreview')
      await expect.poll(() => preview.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1)
      const stroke = await progress.boundingBox()
      const sample = await page.screenshot({
        clip: {
          x: Math.floor(stroke.x) + 5,
          y: Math.floor(stroke.y + stroke.height) - 3,
          width: 60,
          height: 5
        }
      })
      const visibleProgressPixels = await page.evaluate(async base64 => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        let red = 0
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 150 && pixels[i + 1] < 120 && pixels[i + 2] < 120) red++
        }
        return red
      }, sample.toString('base64'))
      expect(visibleProgressPixels).toBe(0)
    } finally {
      await touch('touchEnd').catch(() => {})
      await cdp.detach()
    }
  })
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

for (const uiScale of [100, 125]) {
  test(`bottom bar close button fades in while minimizing at ${uiScale}%`, async ({ app, page }, testInfo) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(async scale => {
      await window.ftElectron.setZoomFactor(scale / 100)
      document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setReducedMotion', 'off')
      await new Promise(requestAnimationFrame)
    }, uiScale)
    const bounds = await player.boundingBox()
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, distance) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: distance === undefined ? [] : [{ ...start, y: start.y + distance }]
    })
    const overlay = page.locator('.mobileMiniBarOverlay')
    const close = overlay.locator('.mobileMiniBarDismiss')
    try {
      for (const cancel of [true, false]) {
        await touch('touchStart', 0)
        await touch('touchMove', 30)
        await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
        const bar = await overlay.boundingBox()
        await touch('touchMove', Math.abs(bar.y - bounds.y) * 0.8)
        await expect(overlay).toHaveCSS('opacity', '1')
        await expect(close, 'the close button must fade in with the bottom bar before the gesture ends').toBeVisible()
        await expect(close).toBeInViewport()
        await expect(close).toBeDisabled()
        await expect(close).toHaveCSS('pointer-events', 'none')
        await expect(overlay).toHaveClass(/mobileMiniBarDismissible/)
        if (cancel) {
          const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
          await writeFile(testInfo.outputPath('minimizing-close-button.png'), Buffer.from(screenshot, 'base64'))
        }
        await touch(cancel ? 'touchCancel' : 'touchEnd')
        await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
        if (cancel) {
          await expect(overlay).toHaveCount(0)
          await expect(player).not.toHaveClass(/scrollMiniPlayer/)
        }
      }
      await expect(close).toBeEnabled()
      await close.click()
      await expect(overlay).toHaveCount(0)
    } finally {
      await cdp.detach()
    }
  })
}

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
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('updateScrollMiniPlayerOnAllTabs', true))
  await page.locator('.tabBar .newTabButton').click()
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  const overlay = page.locator('.mobileMiniBarOverlay')
  await expect(overlay).toBeVisible()
  await overlay.getByRole('button', { name: 'Hide mini player' }).click()
  await expect(player).toHaveClass(/scrollMiniPlayerDismissed/)
  await expect(overlay).toHaveCount(0)
})

test('mobile bar details fade at the destination during both swipe directions', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [point] : []
  })
  try {
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    const watch = await player.boundingBox()
    const down = { x: watch.x + watch.width / 2, y: watch.y + 100 }
    await touch('touchStart', down)
    await touch('touchMove', { ...down, y: down.y + 30 })
    await page.waitForTimeout(40)
    const distance = await player.evaluate(element => {
      const targetTop = window.innerHeight - 108
      return Math.max(150, (targetTop - element.getBoundingClientRect().top) / 2)
    })
    await touch('touchMove', { ...down, y: down.y + distance })
    await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
    await expect(player).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.watchDragPreview')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(player.locator('video').first()).toHaveCSS('object-fit', 'contain')
    const details = page.locator('.mobileMiniBarDetails')
    await expect(details).toHaveCount(1)
    await expect.poll(() => details.evaluate(element => Number(getComputedStyle(element.closest('.mobileMiniBarOverlay')).opacity))).toBeGreaterThan(0.5)
    await touch('touchEnd')
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player.locator('video').first()).toHaveCSS('object-fit', 'cover')
    await player.evaluate(element => {
      element.style.left = '0px'
      element.style.width = `${window.innerWidth}px`
      element.style.height = '108px'
    })
    await page.waitForTimeout(300)
    const bar = await player.boundingBox()
    const up = { x: bar.x + 60, y: bar.y + bar.height / 2 }
    await touch('touchStart', up)
    for (const step of [20, 40, 80]) {
      await touch('touchMove', { ...up, y: up.y - step })
      await page.waitForTimeout(30)
    }
    const barTop = bar.y
    await touch('touchMove', { ...up, y: up.y - distance / 2 })
    await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
    await expect(player).toHaveCSS('border-top-width', '0px')
    await expect(player).toHaveCSS('box-shadow', 'none')
    await expect.poll(() => details.evaluate(element => Number(getComputedStyle(element.closest('.mobileMiniBarOverlay')).opacity))).toBeLessThan(0.5)
    expect(Math.abs((await details.boundingBox()).y - barTop)).toBeLessThan(2)
    await page.evaluate(() => {
      const element = document.querySelector('.ftVideoPlayer')
      const watchRoot = document.querySelector('.watchPreviewHost > div')
      window.mobileRestoreFrames = []
      let doneAt = null
      const sample = () => {
        window.mobileRestoreFrames.push({
          watchTop: watchRoot.getBoundingClientRect().top,
          morph: element.hasAttribute('data-mobile-mini-morph'),
          route: location.hash
        })
        if (location.hash.startsWith('#/watch/') && !element.hasAttribute('data-mobile-mini-morph')) {
          doneAt ??= performance.now() + 200
        }
        if (doneAt === null || performance.now() < doneAt) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await touch('touchMove', { ...up, y: up.y - 530 })
    await touch('touchEnd')
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.mobileRestoreFrames.length)).toBeGreaterThan(4)
    const frames = await page.evaluate(() => window.mobileRestoreFrames)
    const atWatch = frames.filter(frame => frame.morph && frame.route.startsWith('#/watch/'))
    expect(atWatch.length).toBeGreaterThan(0)
    expect(atWatch.every(frame => Math.abs(frame.watchTop - watch.y) < 3)).toBe(true)
  } finally {
    await cdp.detach()
  }
})

test('scroll docking fades the details at the bottom bar position', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => {
    const element = document.querySelector('.ftVideoPlayer')
    window.mobileBarMorphSamples = []
    new MutationObserver(() => {
      if (!element.hasAttribute('data-mobile-mini-morph')) return
      const overlay = document.querySelector('.mobileMiniBarMorphOverlay')
      if (!overlay) return
      window.mobileBarMorphSamples.push({
        playerTop: element.getBoundingClientRect().top,
        barTop: overlay.getBoundingClientRect().top,
        opacity: Number(getComputedStyle(overlay).opacity)
      })
    }).observe(element, { attributes: true, attributeFilter: ['style'] })
    const spacer = document.createElement('div')
    spacer.style.height = '2000px'
    document.body.append(spacer)
    window.scrollTo(0, 1200)
  })
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
  const samples = await page.evaluate(() => window.mobileBarMorphSamples)
  expect(samples.length).toBeGreaterThan(3)
  const first = samples[0]
  const last = samples.at(-1)
  const middle = samples.find(sample => {
    const progress = (sample.playerTop - first.playerTop) / (last.playerTop - first.playerTop)
    return progress >= 0.48 && progress <= 0.6
  })
  expect(middle).toBeDefined()
  expect(middle.opacity).toBeGreaterThan(0.5)
  const visible = samples.filter(sample => sample.opacity > 0)
  expect(Math.max(...visible.map(sample => sample.barTop)) - Math.min(...visible.map(sample => sample.barTop))).toBeLessThan(2)

  await page.evaluate(() => {
    window.mobileBarMorphSamples = []
    window.scrollTo(0, 0)
  })
  await expect(player).not.toHaveClass(/scrollMiniPlayer/)
  await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
  const restoring = await page.evaluate(() => window.mobileBarMorphSamples)
  expect(restoring.length).toBeGreaterThan(3)
  const restoreStart = restoring[0]
  const restoreEnd = restoring.at(-1)
  const restoreMiddle = restoring.find(sample => {
    const progress = (restoreStart.playerTop - sample.playerTop) / (restoreStart.playerTop - restoreEnd.playerTop)
    return progress >= 0.48 && progress <= 0.6
  })
  expect(restoreMiddle).toBeDefined()
  expect(restoreMiddle.opacity).toBeLessThan(0.5)
  const restoreVisible = restoring.filter(sample => sample.opacity > 0)
  expect(Math.max(...restoreVisible.map(sample => sample.barTop)) - Math.min(...restoreVisible.map(sample => sample.barTop))).toBeLessThan(2)
})

test('Shorts overflow is clipped while dragging into the mini player', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await player.evaluate(element => element.classList.add('shortsPlayer'))
  await expect(player).toHaveCSS('overflow', 'visible')
  await player.evaluate(element => element.setAttribute('data-inline-mini-drag', ''))
  await expect(player).toHaveCSS('overflow', 'clip')
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

test('first downward dock keeps the player moving without a long frame', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const bounds = await player.boundingBox()
  expect(bounds).not.toBeNull()
  const cdp = await page.context().newCDPSession(page)
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await page.evaluate(() => {
      window.__dragFrames = []
      window.__dragSampling = true
      let last = performance.now()
      const sample = now => {
        if (!window.__dragSampling) return
        window.__dragFrames.push(now - last)
        last = now
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    for (const distance of [16, 32, 64, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      await page.waitForTimeout(50)
    }
    const frames = await page.evaluate(() => {
      window.__dragSampling = false
      return window.__dragFrames
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    expect(frames.length).toBeGreaterThanOrEqual(8)
    expect(Math.max(...frames)).toBeLessThan(80)
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
    }
  })

  test('prepares and opens subscriptions on the first restored Watch dock', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
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
test('video keeps its shape while dragging into a shorter player', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await player.evaluate(element => { element.style.height = '480px' })
  await page.evaluate(() => {
    // Hide through the scroll handler so Vue retains the state during navigation.
    window.scrollTo(0, 100)
    document.body.style.setProperty('--connection-status-height', '38px')
    const player = document.querySelector('.ftVideoPlayer')
    window.lastMiniMorphTop = null
    new MutationObserver(() => {
      if (player.hasAttribute('data-mobile-mini-morph')) {
        const video = player.querySelector('video')
        const crop = Number.parseFloat(getComputedStyle(video).clipPath.slice(6)) || 0
        const scale = new DOMMatrixReadOnly(getComputedStyle(player).transform).d
        window.lastMiniMorphTop = video.getBoundingClientRect().top + crop * scale
      }
    }).observe(player, { attributes: true, attributeFilter: ['style'] })
  })
  const nav = page.locator('.sideNav')
  await expect(nav).toHaveClass(/scrollHidden/)
  await nav.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const video = player.locator('video').first()
  const distortion = () => video.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return Math.abs((rect.width / rect.height) / (element.offsetWidth / element.offsetHeight) - 1)
  })
  const bounds = await player.boundingBox()
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    for (const distance of [20, 40, 60, 80, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y + distance }] })
      await page.waitForTimeout(30)
    }
    await expect(player).toHaveAttribute('data-inline-mini-drag', '')
    expect(await distortion()).toBeLessThan(0.03)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    // Electron keeps its desktop rect even with mobile classes; match the native bar size.
    await player.evaluate(element => {
      element.style.left = '0px'
      element.style.width = `${window.innerWidth}px`
      element.style.height = '108px'
    })
    await page.waitForTimeout(300)
    const morphTop = await page.evaluate(() => window.lastMiniMorphTop)
    expect(morphTop).toBeLessThan(await page.evaluate(() => window.innerHeight))
    const barVideo = await video.boundingBox()
    await expect(nav).toHaveClass(/scrollHidden/)
    expect(Math.abs(barVideo.y - morphTop)).toBeLessThan(2)
    await player.evaluate(element => element.classList.add('mobileMiniBar'))
    await expect(player).toHaveCSS('touch-action', 'none')
    await player.evaluate(element => {
      window.lastRestoreMorphTop = null
      new MutationObserver(() => {
        if (element.hasAttribute('data-mobile-mini-morph')) {
          const video = element.querySelector('video')
          const crop = Number.parseFloat(getComputedStyle(video).clipPath.slice(6)) || 0
          const scale = new DOMMatrixReadOnly(getComputedStyle(element).transform).d
          window.lastRestoreMorphTop = video.getBoundingClientRect().top + crop * scale
        }
      }).observe(element, { attributes: true, attributeFilter: ['style'] })
    })

    const miniBounds = await player.boundingBox()
    const restorePoint = { x: miniBounds.x + miniBounds.width / 2, y: miniBounds.y + miniBounds.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [restorePoint] })
    for (const distance of [20, 40, 60, 80, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...restorePoint, y: restorePoint.y - distance }] })
      await page.waitForTimeout(30)
    }
    await expect(player).toHaveAttribute('data-inline-mini-drag', '')
    await expect(player).toHaveCSS('translate', 'none')
    // Restoration now uses the inline video surface as its fixed base, so the
    // player box no longer expands from the bar's full 108px control height.
    await expect.poll(async () => (await video.boundingBox()).height).toBeGreaterThan(barVideo.height)
    expect(await distortion()).toBeLessThan(0.03)
    await player.evaluate(element => {
      window.restoreTops = []
      window.restoreTopTimer = setInterval(() => {
        window.restoreTops.push(element.getBoundingClientRect().top)
      }, 16)
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page).toHaveURL(/#\/watch\//)
    await page.waitForTimeout(400)
    const restoreTops = await page.evaluate(() => {
      clearInterval(window.restoreTopTimer)
      return window.restoreTops
    })
    expect(restoreTops.length).toBeGreaterThan(0)
    expect(Math.max(...restoreTops)).toBeLessThan(await page.evaluate(() => innerHeight))
    const restoreTop = await page.evaluate(() => window.lastRestoreMorphTop)
    expect(Math.abs((await video.boundingBox()).y - restoreTop)).toBeLessThan(2)
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await cdp.detach()
  }
})

test('mobile video moves to the bottom bar without stretching its player', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const bounds = await player.boundingBox()
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...start, y: start.y + 100 }]
    })
    await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
    const scale = await player.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return { x: matrix.a, y: matrix.d }
    })
    expect(Math.abs(scale.x - scale.y)).toBeLessThan(0.01)
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  }
})

for (const uiScale of [100, 125]) {
  test(`4:3 video keeps its inline fit throughout mobile restoration at ${uiScale}%`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    await routeDemoMedia(page, await readFile(new URL('../../fixtures/media/aspect-ratio-demo.webm', import.meta.url)))
    await openMockedVideo(page)
    const video = page.locator('.ftVideoPlayer > video.player')
    await video.evaluate(element => { element.loop = true; element.pause() })
    await enableMobileTouch(app, page)
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), uiScale)
    const player = page.locator('.ftVideoPlayer')
    const inlineVideo = await video.boundingBox()
    const full = await player.boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [point] : []
    })
    const capture = async name => {
      const screenshot = await app.electronApp.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath(name), Buffer.from(screenshot, 'base64'))
    }
    try {
      await capture('inline-4-by-3.png')
      const down = { x: full.x + full.width / 2, y: full.y + 40 }
      await touch('touchStart', down)
      await touch('touchMove', { ...down, y: down.y + 100 })
      await touch('touchEnd')
      await expect(player).toHaveClass(/mobileMiniBar/)
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      const bar = await player.locator('.mobileMiniBarReturn').boundingBox()
      const up = { x: bar.x + 40, y: bar.y + 30 }
      await touch('touchStart', up)
      await touch('touchMove', { ...up, y: up.y - 30 })
      await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
      await touch('touchMove', { ...up, y: up.y - Math.abs(bar.y - full.y) * 0.8 })
      await expect.poll(async () => (await video.boundingBox()).width).toBeGreaterThan(inlineVideo.width * 0.7)
      await capture('restoring-4-by-3.png')
      await expect(video).toHaveCSS('object-fit', 'contain')
      const restoring = await video.boundingBox()
      expect(restoring.width / restoring.height).toBeCloseTo(inlineVideo.width / inlineVideo.height, 2)
      const scale = await player.evaluate(element => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
        return { x: matrix.a, y: matrix.d }
      })
      expect(scale.x).toBeCloseTo(scale.y, 4)
      await touch('touchEnd')
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await expect(player).not.toHaveClass(/scrollMiniPlayer/)
      await expect(video).toHaveCSS('object-fit', 'contain')
    } finally {
      await touch('touchCancel').catch(() => {})
      await cdp.detach()
    }
  })
}

for (const state of ['waiting', 'ended before minimizing', 'ended in the mini player']) {
  test(`${state} poster follows the video into and out of the bottom bar`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('https://i.ytimg.com/**', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#326b8a"/></svg>'
    }))
    await openMockedVideo(page)
    const video = page.locator('.ftVideoPlayer > video.player')
    await video.evaluate(element => element.pause())
    await enableMobileTouch(app, page)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setPlayNextVideo', false))
    const endVideo = async () => {
      await video.evaluate(element => { element.currentTime = element.duration - 0.1; return element.play() })
      await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)
    }
    const watchView = await watchViewHandle(page)
    if (state === 'waiting') {
      await watchView.evaluate(async view => {
        view.isLoading = true
        await view.$nextTick()
        view.adEndTimeUnixMs = Date.now() + 60_000
        view.isLoading = false
      })
    }
    await watchView.dispose()
    if (state === 'ended before minimizing') await endVideo()
    const player = page.locator('.ftVideoPlayer')
    const poster = player.locator('.countdownPoster, .endedPoster')
    if (state !== 'ended in the mini player') await expect(poster).toBeVisible()
    await expect.poll(() => poster.locator('img:not(.retryImagePlaceholder)').evaluate(image => image.naturalWidth)).toBe(480)
    const expectPosterOverVideo = async () => {
      await expect(poster).toBeVisible()
      const [videoBox, posterBox] = await Promise.all([video.boundingBox(), poster.boundingBox()])
      for (const side of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(posterBox[side] - videoBox[side])).toBeLessThan(2)
      }
    }
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: point ? [point] : []
    })
    try {
      const full = await player.boundingBox()
      const down = { x: full.x + full.width / 2, y: full.y + 100 }
      await touch('touchStart', down)
      for (const distance of [20, 40, 60, 80, 100]) {
        await touch('touchMove', { ...down, y: down.y + distance })
        await page.waitForTimeout(30)
        if (distance === 60 && state !== 'ended in the mini player') await expectPosterOverVideo()
      }
      await touch('touchEnd')
      await expect(player).toHaveClass(/mobileMiniBar/)
      if (state === 'ended in the mini player') await endVideo()
      await expectPosterOverVideo()
      if (state !== 'waiting') await expect(poster.locator('img:not(.retryImagePlaceholder)')).toHaveCSS('opacity', '0.35')
      const barVideo = await video.boundingBox()
      const up = { x: barVideo.x + 60, y: barVideo.y + barVideo.height / 2 }
      await touch('touchStart', up)
      for (const distance of [20, 40, 80, 200]) {
        await touch('touchMove', { ...up, y: up.y - distance })
        await page.waitForTimeout(30)
      }
      await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
      await expectPosterOverVideo()
      await touch('touchEnd')
      await expect(player).not.toHaveAttribute('data-mobile-mini-morph')
      await expectPosterOverVideo()
      if (state !== 'waiting') {
        await video.evaluate(element => { element.currentTime = 0; return element.play() })
        await expect(poster).toBeHidden()
      }
    } finally {
      await touch('touchEnd').catch(() => {})
      await cdp.detach()
    }
  })
}

for (const uiScale of [100, 125]) {
  for (const swipe of [false, true]) {
    test(`${swipe ? 'swiping' : 'clicking'} across the bottom bar returns to Watch at ${uiScale}%`, async ({ app, page }) => {
      const player = await openMobilePlayer(app, page)
      await page.evaluate(scale => window.ftElectron.setZoomFactor(scale / 100), uiScale)
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
}

for (const uiScale of [100, 125]) {
  test(`swiping across the scroll-triggered bottom bar returns to the video at ${uiScale}%`, async ({ app, page }) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(scale => {
      window.ftElectron.setZoomFactor(scale / 100)
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      document.body.append(spacer)
    }, uiScale)
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
        await touch(end)
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
        await page.waitForTimeout(400)
      }
    } finally {
      await touch('touchEnd').catch(() => {})
      await cdp.detach()
    }
  })
}

test('bottom bar progress follows a moving live seek window while paused', async ({ app, page }) => {
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
  const progress = player.locator('.mobileMiniBarProgress > div')
  await player.evaluate(element => {
    const shakaPlayer = element.ui.getControls().getPlayer()
    window.miniBarSeekRange = { start: 0, end: 30 }
    shakaPlayer.seekRange = () => window.miniBarSeekRange
    shakaPlayer.isLive = () => true
    element.querySelector('video').currentTime = 15
  })
  const fill = () => progress.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
  await expect.poll(fill).toBeCloseTo(0.5, 2)
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false)
  await page.evaluate(() => { window.miniBarSeekRange = { start: 5, end: 35 } })
  await expect.poll(fill).toBeCloseTo(1 / 3, 2)
  expect(await video.evaluate(element => ({ paused: element.paused, currentTime: element.currentTime })))
    .toEqual({ paused: true, currentTime: 15 })
  const controls = player.locator('.mobileMiniBarPlayback')
  const rewind = controls.getByRole('button', { name: 'Rewind 10 seconds' })
  const forward = controls.getByRole('button', { name: 'Forward 10 seconds' })
  await page.evaluate(() => { window.miniBarSeekRange = { start: 15, end: 15 } })
  await expect(rewind).toBeDisabled()
  await expect(forward).toBeDisabled()
  await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await page.evaluate(() => { window.miniBarSeekRange = { start: 5, end: 35 } })
  await expect(rewind).toBeEnabled()
  await expect(forward).toBeEnabled()
})

for (const uiScale of [100, 125, 150]) {
  test(`bottom bar playback controls work without reopening Watch at ${uiScale}%`, async ({ app, page }, testInfo) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(scale => {
      window.ftElectron.setZoomFactor(scale / 100)
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      document.body.append(spacer)
      window.scrollTo(0, 1200)
    }, uiScale)
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
      expect(bounds.width).toBeGreaterThanOrEqual(48)
      expect(bounds.height).toBeGreaterThanOrEqual(48)
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
        expect(bounds.width * uiScale / 100).toBeGreaterThanOrEqual(48)
      }
    }
    await player.locator('.mobileMiniBarReturn').click({ position: { x: 60, y: 30 } })
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })
}

for (const { uiScale, size } of [
  { uiScale: 100, size: { width: 375, height: 800 } },
  { uiScale: 125, size: { width: 375, height: 800 } },
  { uiScale: 150, size: { width: 375, height: 800 } },
  { uiScale: 100, size: { width: 850, height: 480 } },
]) {
  test(`compact mobile strip expands controls and restores playback at ${uiScale}% in ${size.width}px`, async ({ app, page }, testInfo) => {
    const player = await openMobilePlayer(app, page)
    await page.evaluate(scale => {
      window.ftElectron.setZoomFactor(scale / 100)
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setCompactMobileMiniPlayer', true)
      store.commit('setKeepPlayingOnNavigation', true)
      const spacer = document.createElement('div')
      spacer.style.height = '2000px'
      document.body.append(spacer)
    }, uiScale)
    const watch = await watchViewHandle(page)
    await setWindowSize(app, page, size)
    await page.evaluate(async width => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setCompactMobileMiniPlayer', false))
    await expect(player.locator('.mobileMiniBarExpand')).toHaveCount(0)
    await expect(player.locator('.mobileMiniBarUploader')).toBeVisible()
    await player.locator('.mobileMiniBarReturn').click({ position: { x: 60, y: 30 } })
    await expect(player).not.toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await watch.dispose()
  })
}
