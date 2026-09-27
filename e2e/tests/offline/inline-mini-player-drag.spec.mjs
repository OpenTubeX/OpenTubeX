import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, enableVideoZoom: false, enableMobileFullscreenSwipe: false } } })

async function openMobilePlayer(app, page) {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setWindowSize(app, page, { width: 480, height: 850 })
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 })
    const app = document.querySelector('.app')
    const mobile = () => { if (!app.classList.contains('capacitorTabs')) app.classList.add('capacitorTabs') }
    new MutationObserver(mobile).observe(app, { attributeFilter: ['class'] })
    mobile()
  })
  return page.locator('.ftVideoPlayer')
}

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
  const cdp = await page.context().newCDPSession(page)
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  try {
    await page.evaluate(() => {
      window.__dragFrames = []
      let last = performance.now()
      const sample = now => {
        window.__dragFrames.push(now - last)
        last = now
        if (window.__dragFrames.length < 50) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (const distance of [16, 32, 64, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y + distance }] })
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(player).toHaveClass(/scrollMiniPlayer/)
    await expect.poll(() => page.evaluate(() => window.__dragFrames.length)).toBeGreaterThanOrEqual(12)
    const worstFrame = await page.evaluate(() => Math.max(...window.__dragFrames.slice(0, 12)))
    expect(worstFrame).toBeLessThan(80)
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

  test('prepares the subscriptions page before the first dock preview', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.locator('.tab[data-tab-id="watch"]').click()
    await expect(page.locator('.tabContent[data-tab-id="watch"] .watchPreviewHost .ftVideoPlayer')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.tabContent[data-tab-id="watch"] .browsingBehindWatch.subscriptionsPage')).toHaveCount(1)
  })
})
