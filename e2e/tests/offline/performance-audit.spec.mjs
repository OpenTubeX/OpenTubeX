import { test, expect, goTo, goToSettingsSection, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { IpcChannels } from '../../../src/constants.js'

test.use({
  seed: {
    settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true },
    history: [{
      _id: 'jNQXAC9IVRw',
      videoId: 'jNQXAC9IVRw',
      title: 'Progress animation fixture',
      author: 'Test channel',
      lengthSeconds: 60,
      timeWatched: 1000,
      watchProgress: 0,
      type: 'video',
    }],
  },
})

for (const zoom of [1, 0.95]) {
  test(`download progress animates without changing layout width at ${zoom} UI scale`, async ({ page }) => {
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    await goTo(page, 'downloads')
    const setProgress = percent => page.evaluate(percent => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('upsertYtDlpDownload', { id: 42, videoId: 'jNQXAC9IVRw', title: 'Progress animation fixture', status: 'downloading', percent, mode: 'video' })
    }, percent)
    await setProgress(10)
    const row = page.locator('.downloadRow').filter({ hasText: 'Progress animation fixture' })
    const fill = row.locator('.progressFill')
    const track = row.locator('.progressTrack')
    const layoutWidth = await track.evaluate(element => element.clientWidth)
    await expect.poll(() => fill.evaluate(element => element.clientWidth)).toBe(layoutWidth)
    for (const direction of ['ltr', 'rtl']) {
      await row.evaluate((element, direction) => { element.dir = direction }, direction)
      await setProgress(90)
      await expect.poll(() => fill.evaluate(element => element.getBoundingClientRect().width /
        element.parentElement.getBoundingClientRect().width)).toBeCloseTo(0.9, 2)
      expect(await fill.evaluate(element => element.clientWidth)).toBe(layoutWidth)
      const bounds = await fill.boundingBox()
      const parent = await track.boundingBox()
      expect(direction === 'rtl' ? parent.x + parent.width - bounds.x - bounds.width : bounds.x - parent.x).toBeCloseTo(0, 0)
      await setProgress(0)
      await expect.poll(() => fill.evaluate(element => element.getBoundingClientRect().width)).toBe(0)
    }
    await page.getByRole('dialog', { name: 'Downloads', exact: true }).press('Escape')
    await goTo(page, 'history')
    const video = page.locator('.ft-list-video').first()
    await video.hover()
    await video.locator('.title').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Download Video', exact: true }).click()
    const prompt = page.locator('.activeDownloadCard')
    const promptFill = prompt.locator('.downloadProgressBarFill')
    const promptTrack = prompt.locator('.downloadProgressBarTrack')
    const promptLayoutWidth = await promptTrack.evaluate(element => element.clientWidth)
    for (const direction of ['ltr', 'rtl']) {
      await prompt.evaluate((element, direction) => { element.dir = direction }, direction)
      await setProgress(50)
      await expect.poll(() => promptFill.evaluate(element => element.getBoundingClientRect().width /
        element.parentElement.getBoundingClientRect().width)).toBeCloseTo(0.5, 2)
      expect(await promptFill.evaluate(element => element.clientWidth)).toBe(promptLayoutWidth)
      const bounds = await promptFill.boundingBox()
      const parent = await promptTrack.boundingBox()
      expect(direction === 'rtl' ? parent.x + parent.width - bounds.x - bounds.width : bounds.x - parent.x).toBeCloseTo(0, 0)
      await setProgress(142)
      await expect.poll(() => promptFill.evaluate(element => element.getBoundingClientRect().width /
        element.parentElement.getBoundingClientRect().width)).toBeCloseTo(1, 2)
    }
  })

  test(`color picker batches theme previews and preserves release position at ${zoom} UI scale`, async ({ page }) => {
    await page.evaluate(zoom => window.ftElectron.setZoomFactor(zoom), zoom)
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: 'Create custom theme' }).click()
    await page.locator('.customThemeEditor .colorFieldTrigger').first().click()
    const surface = page.locator('.colorPickerPopover .saturationValue')
    await expect(surface).toBeVisible()
    const metrics = await surface.evaluate(async element => {
      const original = element.getBoundingClientRect
      const bounds = original.call(element)
      let reads = 0
      element.getBoundingClientRect = function () { reads++; return original.call(this) }
      const pointer = (type, x, y, pointerId = 7) => new PointerEvent(type, {
        bubbles: true, button: 0, pointerId, clientX: x, clientY: y
      })
      try {
        element.dispatchEvent(pointer('pointerdown', bounds.left + 1, bounds.top + 1))
        reads = 0
        for (let index = 0; index < 50; index++) {
          window.dispatchEvent(pointer('pointermove', bounds.left + bounds.width * index / 100, bounds.top + 10))
        }
        element.dispatchEvent(pointer('pointerdown', bounds.right, bounds.bottom, 8))
        window.dispatchEvent(pointer('pointermove', bounds.right, bounds.bottom, 8))
        window.dispatchEvent(pointer('pointerup', bounds.right, bounds.bottom, 8))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const burstReads = reads
        window.dispatchEvent(pointer('pointermove', bounds.left + 20, bounds.top + 20))
        window.dispatchEvent(pointer('pointerup', bounds.right + 1, bounds.top + bounds.height / 2))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const releaseValue = element.getAttribute('aria-valuetext')
        element.dispatchEvent(pointer('pointerdown', bounds.right + 1, bounds.top + bounds.height / 2))
        reads = 0
        window.dispatchEvent(pointer('pointermove', bounds.left + 20, bounds.top + 20))
        window.dispatchEvent(pointer('pointercancel', 0, 0))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const cancelReads = reads
        const cancelValue = element.getAttribute('aria-valuetext')
        element.dispatchEvent(pointer('pointerdown', bounds.right + 1, bounds.top + bounds.height / 2))
        reads = 0
        window.dispatchEvent(pointer('pointermove', bounds.left + 20, bounds.top + 20))
        window.dispatchEvent(new Event('blur'))
        await new Promise(resolve => requestAnimationFrame(resolve))
        return { burstReads, releaseValue, cancelReads, cancelValue, blurReads: reads, blurValue: element.getAttribute('aria-valuetext') }
      } finally {
        element.getBoundingClientRect = original
      }
    })
    console.log('Rendered color picker pointer work:', metrics)
    expect.soft(metrics.burstReads).toBe(1)
    expect(metrics.releaseValue).toBe('100%, 50%')
    expect(metrics.cancelReads).toBe(0)
    expect(metrics.cancelValue).toBe('100%, 50%')
    expect(metrics.blurReads).toBe(0)
    expect(metrics.blurValue).toBe('100%, 50%')
    await surface.press('ArrowUp')
    await expect(surface).toHaveAttribute('aria-valuetext', '100%, 51%')
    await page.locator('.colorPickerPopover').getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(surface).toHaveCount(0)
  })

  test(`select focus underline animates with transforms at ${zoom} UI scale`, async ({ page }) => {
    await page.evaluate(async zoom => {
      window.ftElectron.setZoomFactor(zoom)
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateReducedMotion', 'off')
    }, zoom)
    const appearance = await goToSettingsSection(page, 'appearance')
    const select = appearance.locator('.select').first()
    // Exercise the supported filled variant, including its focus underline.
    await select.evaluate(element => { element.classList.remove('outlined') })
    const button = select.locator('.select-text')
    await button.focus()
    const result = await select.locator('.select-bar').evaluate(element => {
      const before = getComputedStyle(element, '::before')
      const after = getComputedStyle(element, '::after')
      return { before: before.transitionProperty, after: after.transitionProperty }
    })
    expect(result).toEqual({ before: 'transform', after: 'transform' })
    await expect.poll(() => select.locator('.select-bar').evaluate(element => (
      getComputedStyle(element, '::before').transform
    ))).toBe('matrix(1, 0, 0, 1, 0, 0)')
    await button.evaluate(element => element.blur())
    await expect.poll(() => select.locator('.select-bar').evaluate(element => (
      getComputedStyle(element, '::before').transform
    ))).toBe('matrix(0, 0, 0, 1, 0, 0)')
  })
}

test.describe('large bookmark playlist', () => {
  test.use({
    seed: {
      settings: { quickBookmarkTargetPlaylistId: 'favorites' },
      playlists: [{
        _id: 'favorites',
        playlistName: 'Favorites',
        createdAt: 1,
        lastUpdatedAt: 1,
        videos: Array.from({ length: 10_000 }, (_, index) => ({
          videoId: `saved${String(index).padStart(6, '0')}`,
          playlistItemId: `item-${index}`,
          title: `Saved video ${index}`,
          author: 'Creator',
          lengthSeconds: 120,
          timeAdded: 1,
          type: 'video',
        })),
      }],
      history: Array.from({ length: 100 }, (_, index) => ({
        _id: String(index).padStart(11, '0'),
        videoId: String(index).padStart(11, '0'),
        title: `History video ${index}`,
        author: 'Creator',
        lengthSeconds: 120,
        timeWatched: 1000 - index,
        watchProgress: 30,
        isWatched: false,
        type: 'video',
      })),
    },
  })

  test('visible history cards share the bookmark index', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__bookmarkIdReads = 0
      for (const video of store.getters.getQuickBookmarkPlaylist.videos) {
        const id = video.videoId
        Object.defineProperty(video, 'videoId', {
          enumerable: true,
          configurable: true,
          get() { window.__bookmarkIdReads++; return id },
        })
      }
    })
    await goTo(page, 'history')
    await expect.poll(() => page.locator('.quickBookmarkVideoIcon').count()).toBeGreaterThan(5)
    const metrics = await page.evaluate(() => ({
      controls: document.querySelectorAll('.quickBookmarkVideoIcon').length,
      reads: window.__bookmarkIdReads,
    }))
    console.log('Rendered history bookmark work:', metrics)
    expect(metrics.reads).toBe(10_000)
    const card = page.locator('.ft-list-video').first()
    await card.locator('.quickBookmarkVideoIcon').click()
    await expect(card.locator('.quickBookmarkVideoIcon.bookmarked')).toBeVisible()
    await card.locator('.quickBookmarkVideoIcon').click()
    await expect(card.locator('.quickBookmarkVideoIcon.bookmarked')).toHaveCount(0)
  })

  test('playlist overview does not deep-watch saved video titles', async ({ page }) => {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.__playlistTitleReads = 0
      for (const video of store.getters.getQuickBookmarkPlaylist.videos) {
        const title = video.title
        Object.defineProperty(video, 'title', {
          enumerable: true,
          configurable: true,
          get() { window.__playlistTitleReads++; return title },
        })
      }
    })
    await goTo(page, 'userplaylists')
    await expect(page.getByRole('link', { name: 'Favorites', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.__playlistTitleReads)).toBe(0)
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.getters.getQuickBookmarkPlaylist.videos[0].timeAdded = 2
    })
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => window.__playlistTitleReads)).toBe(0)
  })
})

test('player visibility and playback changes avoid repeated layout work', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const controls = page.locator('.ftVideoPlayer .shaka-controls-container')
  await controls.evaluate(element => element.setAttribute('shown', 'true'))
  await page.waitForTimeout(1000)

  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => {
    const original = window.getComputedStyle
    window.__playerLayoutReads = 0
    window.getComputedStyle = function (element, pseudo) {
      if (element.parentElement?.matches('.shaka-controls-button-panel')) window.__playerLayoutReads++
      return original.call(this, element, pseudo)
    }
  })

  const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
  const before = await metrics()
  const fadeTransitions = []
  for (const shown of [false, true]) {
    await controls.evaluate((element, shown) => {
      if (shown) element.setAttribute('shown', 'true')
      else element.removeAttribute('shown')
    }, shown)
    fadeTransitions.push(...await controls.evaluate(element => (
      element.querySelector('.shaka-controls-button-panel').getAnimations().map(animation => animation.transitionProperty)
    )))
    await page.waitForTimeout(750)
  }
  const after = await metrics()
  const visibility = {
    styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount,
    styleMilliseconds: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
    layoutReads: await page.evaluate(() => window.__playerLayoutReads),
  }

  const playback = await page.evaluate(async () => {
    const video = document.querySelector('.ftVideoPlayer video')
    const button = document.querySelector('.ftVideoPlayer .shaka-controls-button-panel > .shaka-play-button')
    window.__playerLayoutReads = 0
    const toggles = []
    for (let index = 0; index < 4; index++) {
      document.querySelector('.ftVideoPlayer .shaka-controls-container').setAttribute('shown', 'true')
      const wasPaused = video.paused
      button.click()
      toggles.push(video.paused !== wasPaused)
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return { paused: video.paused, layoutReads: window.__playerLayoutReads, toggles }
  })
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await testInfo.attach('player interaction work at 6x CPU slowdown', {
    body: JSON.stringify({ visibility, playback }), contentType: 'application/json',
  })
  console.log('Player interaction work at 6x CPU slowdown:', { visibility, playback })
  // Keep timings diagnostic: machine load must not turn this into a CI flake.
  // Animating the inherited fade value forces descendant styles every frame.
  expect.soft(fadeTransitions).not.toContain('--ft-controls-fade')
  expect.soft(visibility.layoutReads).toBe(0)
  expect(playback.paused).toBe(true)
  expect(playback.toggles).toEqual([true, true, true, true])
  expect(playback.layoutReads).toBe(0)
})

test('default-speed button transitions do not query animations in JavaScript', async ({ page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateReducedMotion', 'off')
  })
  const button = page.getByRole('button', { name: 'Expand side navigation', exact: true })
  await page.mouse.move(800, 500)
  await button.evaluate(element => {
    window.__buttonAnimationWork = { transitions: 0, queries: 0 }
    element.addEventListener('transitionrun', () => window.__buttonAnimationWork.transitions++)
    const original = element.getAnimations
    element.getAnimations = function (options) {
      window.__buttonAnimationWork.queries++
      return original.call(this, options)
    }
  })
  await button.hover()
  await expect.poll(() => page.evaluate(() => window.__buttonAnimationWork.transitions)).toBeGreaterThan(0)
  const metrics = await page.evaluate(() => window.__buttonAnimationWork)
  console.log('Default-speed button animation work:', metrics)
  expect(metrics.queries).toBe(0)
})

test('hidden player menus do not measure labels after playback option changes', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.waitForTimeout(1000)
  const measurements = await page.evaluate(async () => {
    const menu = document.querySelector('.ftVideoPlayer .shaka-overflow-menu')
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
    let reads = 0
    Object.defineProperty(Element.prototype, 'clientWidth', {
      ...descriptor,
      get() {
        if (menu.contains(this)) reads++
        return descriptor.get.call(this)
      },
    })
    try {
      const video = document.querySelector('.ftVideoPlayer video')
      video.loop = !video.loop
      await new Promise(resolve => setTimeout(resolve, 300))
      return reads
    } finally {
      Object.defineProperty(Element.prototype, 'clientWidth', descriptor)
    }
  })
  console.log('Hidden player menu label measurements:', measurements)
  expect(measurements).toBe(0)
})

test.describe('history progress direction', () => {
  test.use({
    seed: {
      settings: { uiScale: 95, uiRoundness: 200 },
      history: Array.from({ length: 100 }, (_, index) => ({
        _id: String(index).padStart(11, '0'),
        videoId: String(index).padStart(11, '0'),
        title: `Progress video ${index}`,
        author: 'Performance fixture',
        authorId: 'UC0000000000000000000000',
        timeWatched: Date.now() - index * 1000,
        lengthSeconds: 120,
        watchProgress: 30,
        isWatched: false,
        type: 'video',
      })),
    },
  })

  test('mirrors progress without per-card JavaScript style reads', async ({ app, page }, testInfo) => {
    await page.evaluate(() => {
      const original = window.getComputedStyle
      window.__progressStyleReads = 0
      window.getComputedStyle = function (element, pseudo) {
        if (element.matches?.('svg.embeddedProgress')) window.__progressStyleReads++
        return original.call(this, element, pseudo)
      }
    })
    await goTo(page, 'history')
    const paths = page.locator('.watchedProgressBar .embeddedProgressPath')
    // Cards below the viewport are intentionally rendered lazily.
    await expect.poll(() => paths.count()).toBeGreaterThan(10)
    const path = paths.first()

    const progressStartsOn = async direction => {
      await expect.poll(() => path.evaluate(element => {
        const start = element.getPointAtLength(0).matrixTransform(element.getScreenCTM())
        const end = element.getPointAtLength(element.getTotalLength()).matrixTransform(element.getScreenCTM())
        return start.x < end.x ? 'left' : 'right'
      })).toBe(direction)
    }

    await progressStartsOn('left')
    const mountReads = await page.evaluate(() => window.__progressStyleReads)
    await page.evaluate(() => { document.body.dir = 'rtl' })
    await progressStartsOn('right')
    const directionReads = await page.evaluate(() => window.__progressStyleReads) - mountReads
    await testInfo.attach('progress JavaScript work', {
      body: JSON.stringify({ cards: await paths.count(), mountReads, directionReads }),
      contentType: 'application/json',
    })
    console.log('Progress style reads:', { mountReads, directionReads })
    expect.soft(mountReads).toBe(0)
    expect.soft(directionReads).toBe(0)

    await setWindowSize(app, page, { width: 900, height: 700 })
    await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
    await progressStartsOn('right')
    await page.evaluate(() => { document.body.dir = 'ltr' })
    await progressStartsOn('left')
    await expect.poll(() => path.evaluate(element => {
      const svg = element.ownerSVGElement
      return Math.abs(svg.viewBox.baseVal.width - Number.parseFloat(getComputedStyle(svg).width))
    })).toBeLessThan(0.1)
  })
})

test('loop controls update on changes without polling an idle player', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const buttons = page.locator('.ftVideoPlayer .loop-button')
  await expect(buttons.first()).toBeAttached()

  for (const enabled of [true, false]) {
    await video.evaluate((element, enabled) => { element.loop = enabled }, enabled)
    await expect.poll(() => buttons.evaluateAll((elements, enabled) => elements.every(element => (
      element.getAttribute('aria-pressed') === String(enabled)
    )), enabled)).toBe(true)
  }

  const metrics = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('.ftVideoPlayer .loop-button')]
    const classes = new Set(buttons.map(button => button.classList))
    const original = DOMTokenList.prototype.toggle
    let visibilityChecks = 0
    DOMTokenList.prototype.toggle = function (...args) {
      if (classes.has(this)) visibilityChecks++
      return original.apply(this, args)
    }
    try {
      await new Promise(resolve => setTimeout(resolve, 1100))
      return { buttons: buttons.length, visibilityChecks }
    } finally {
      DOMTokenList.prototype.toggle = original
    }
  })
  await testInfo.attach('idle loop control work', {
    body: JSON.stringify(metrics), contentType: 'application/json',
  })
  console.log('Idle loop control work:', metrics)
  expect(metrics.visibilityChecks).toBe(0)
})

test('video clock updates retain positions without rebuilding media controls', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused')

  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    globalThis.__mediaClockIpc = 0
    ipcMain.on(channel, () => globalThis.__mediaClockIpc++)
  }, IpcChannels.TABS_SET_MEDIA_SESSION_STATE)
  const metrics = await page.evaluate(() => {
    const media = navigator.mediaSession
    const originalHandler = media.setActionHandler
    const originalPosition = media.setPositionState
    let handlers = 0
    let positions = 0
    media.setActionHandler = function (...args) {
      handlers++
      return originalHandler.apply(this, args)
    }
    media.setPositionState = function (...args) {
      positions++
      return originalPosition.apply(this, args)
    }
    try {
      const video = document.querySelector('.ftVideoPlayer video')
      for (let index = 0; index < 60; index++) video.dispatchEvent(new Event('timeupdate'))
      return { handlers, positions }
    } finally {
      media.setActionHandler = originalHandler
      media.setPositionState = originalPosition
    }
  })
  // Flush the renderer's IPC stream before inspecting the main-process count.
  await page.evaluate(() => window.ftElectron.tabs.getState())
  const ipc = await app.electronApp.evaluate(() => globalThis.__mediaClockIpc)
  console.log('Rendered player clock work:', { ...metrics, ipc })
  expect(metrics.positions).toBe(60)
  expect(metrics.handlers).toBe(0)
  expect(ipc).toBe(0)
})

test('native media actions still control playback after switching tabs', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const playingTabId = await page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.activeTabId))
  const video = page.locator(`.ftVideoPlayer[data-tab-id="${playingTabId}"] video`)
  const newTabId = await page.evaluate(() => window.ftElectron.tabs.create({ makeActive: true }).then(tab => tab.id))
  await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.presentedTabId))).toBe(newTabId)
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)

  const sendAction = action => app.electronApp.evaluate(({ BrowserWindow }, { channel, action }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, action)
  }, { channel: IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, action })
  await sendAction('pause')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused')

  await page.evaluate(tabId => window.ftElectron.tabs.activate(tabId), playingTabId)
  await expect.poll(() => page.evaluate(() => window.ftElectron.tabs.getState().then(state => state.presentedTabId))).toBe(playingTabId)
  await sendAction('play')
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('playing')
})
