import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo, waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchHistoryEntry, watchViewHandle } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableVideoZoom: false, enableMobileFullscreenSwipe: false } } })

async function enableMobileTouch(app, page, phone = true) {
  await setWindowSize(app, page, { width: 480, height: 850 })
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
        element.style.height = '76px'
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
      const targetTop = window.innerHeight - 76
      return Math.max(150, (targetTop - element.getBoundingClientRect().top) / 2)
    })
    await touch('touchMove', { ...down, y: down.y + distance })
    await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
    await expect(player).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.watchDragPreview')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(player.locator('video').first()).toHaveCSS('object-fit', 'cover')
    const details = page.locator('.mobileMiniBarDetails')
    const chevron = page.locator('.mobileMiniBarReturn')
    await expect(details).toHaveCount(1)
    await expect.poll(() => details.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.5)
    await expect.poll(() => chevron.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.5)
    await touch('touchEnd')
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player.locator('video').first()).toHaveCSS('object-fit', 'cover')
    await player.evaluate(element => {
      element.style.left = '0px'
      element.style.width = `${window.innerWidth}px`
      element.style.height = '76px'
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
    await expect.poll(() => details.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(0.5)
    expect(Math.abs((await details.boundingBox()).y - barTop)).toBeLessThan(2)
    expect(Math.abs((await chevron.boundingBox()).y - barTop)).toBeLessThan(2)
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
      const overlay = document.querySelector('.mobileMiniBarOverlay')
      if (!overlay) return
      window.mobileBarMorphSamples.push({
        playerTop: element.getBoundingClientRect().top,
        barTop: overlay.getBoundingClientRect().top,
        opacity: Number(getComputedStyle(overlay.querySelector('.mobileMiniBarDetails')).opacity)
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
    document.querySelector('.sideNav').classList.add('scrollHidden')
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
      element.style.height = '76px'
    })
    await page.waitForTimeout(300)
    const morphTop = await page.evaluate(() => window.lastMiniMorphTop)
    expect(morphTop).toBeLessThan(await page.evaluate(() => window.innerHeight))
    const barVideo = await video.boundingBox()
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
    await expect.poll(async () => (await player.boundingBox()).height).toBeGreaterThan(100)
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

test('waiting poster follows the video into and out of the bottom bar', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.route('https://i.ytimg.com/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#326b8a"/></svg>'
  }))
  await openMockedVideo(page)
  const video = page.locator('.ftVideoPlayer > video.player')
  await video.evaluate(element => element.pause())
  await enableMobileTouch(app, page)
  const watchView = await watchViewHandle(page)
  await watchView.evaluate(async view => {
    view.isLoading = true
    await view.$nextTick()
    view.adEndTimeUnixMs = Date.now() + 60_000
    view.isLoading = false
  })
  const player = page.locator('.ftVideoPlayer')
  const poster = player.locator('.countdownPoster')
  await expect(poster).toBeVisible()
  await expect.poll(() => poster.locator('img').evaluate(image => image.naturalWidth)).toBe(480)
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
      if (distance === 60) await expectPosterOverVideo()
    }
    await touch('touchEnd')
    await expect(player).toHaveClass(/mobileMiniBar/)
    await expectPosterOverVideo()
    const barVideo = await video.boundingBox()
    const up = { x: barVideo.x + 60, y: barVideo.y + barVideo.height / 2 }
    await touch('touchStart', up)
    for (const distance of [20, 40, 80, 200]) {
      await touch('touchMove', { ...up, y: up.y - distance })
      await page.waitForTimeout(30)
    }
    await expect(player).toHaveAttribute('data-mobile-mini-morph', '')
    await expectPosterOverVideo()
  } finally {
    await touch('touchEnd').catch(() => {})
    await cdp.detach()
  }
})

test('tapping the bottom bar video returns to Watch', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page)
  const bounds = await player.boundingBox()
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 100 }
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...start, y: start.y + 100 }]
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page).not.toHaveURL(/#\/watch\//)
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect(player).not.toHaveAttribute('data-mobile-mini-morph', '')
    const thumbnail = player.locator('.mobileMiniBarThumbnailReturn')
    await expect(thumbnail).toBeEnabled()
    const video = await thumbnail.boundingBox()
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('mobileMiniBarThumbnailReturn'), {
      x: video.x + video.width / 2, y: video.y + video.height / 2
    })).toBe(true)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: video.x + video.width / 2, y: video.y + video.height / 2 }]
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page).toHaveURL(/#\/watch\//)
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await cdp.detach()
  }
})
