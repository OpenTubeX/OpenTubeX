import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

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

test('tablet swipe docks toward the bottom bar', async ({ app, page }) => {
  const player = await openMobilePlayer(app, page, false)
  await page.evaluate(() => {
    const player = document.querySelector('.ftVideoPlayer')
    new MutationObserver(() => {
      const top = player.style.getPropertyValue('--mobile-mini-top')
      if (top) window.lastMiniMorphTop = Number.parseFloat(top)
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
        const top = player.style.getPropertyValue('--mobile-mini-top')
        if (top) window.lastMiniMorphTop = Number.parseFloat(top)
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
    const barBounds = await player.boundingBox()
    const morphTop = await page.evaluate(() => window.lastMiniMorphTop)
    expect(morphTop).toBeLessThan(await page.evaluate(() => window.innerHeight))
    expect(Math.abs(barBounds.y - morphTop)).toBeLessThan(2)
    await player.evaluate(element => element.classList.add('mobileMiniBar'))
    await expect(player).toHaveCSS('touch-action', 'none')
    await player.evaluate(element => {
      window.lastRestoreMorphTop = null
      new MutationObserver(() => {
        if (element.hasAttribute('data-mobile-mini-morph')) {
          const top = element.style.getPropertyValue('--mobile-mini-top')
          if (top) window.lastRestoreMorphTop = Number.parseFloat(top)
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
    expect(Math.abs((await player.boundingBox()).y - restoreTop)).toBeLessThan(2)
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await cdp.detach()
  }
})
