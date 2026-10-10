import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue'
    }
  }
})

const popularity = Array.from({ length: 100 }, (_, index) =>
  index === 75 ? 1 : 0.12 + 0.5 * Math.exp(-(((index - 75) / 5) ** 2)) + Math.sin(index * 0.6) ** 2 * 0.08)

test('popularity aligns with the seek bar across layouts, themes and UI scales', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page, { popularity })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const watch = await page.evaluateHandle(findWatchComponent)
  expect(await watch.evaluate(component => component.proxy.videoPopularity.length)).toBe(100)
  const player = page.locator('.ftVideoPlayer')
  const graph = player.locator('.ft-popularity-graph')
  const bar = player.locator('.shaka-seek-bar-container')
  const resize = async (width, scale = 1) => {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeCloseTo(width / scale, 0)
  }
  await expect(graph).toHaveAttribute('aria-label', 'Most replayed: 0:22')
  await player.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale), scale)
    for (const width of [1300, 500]) {
      await resize(width, scale)
      for (const frosted of [true, false]) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
        await expect(graph).toBeVisible()
        expect(await graph.evaluate(element => {
          const graph = element.getBoundingClientRect()
          const bar = element.parentElement.getBoundingClientRect()
          return Math.max(Math.abs(graph.left - bar.left), Math.abs(graph.right - bar.right))
        })).toBeLessThan(1)
        await expect(graph).toHaveCSS('pointer-events', 'none')
      }
    }
  }

  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await resize(1300)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', true))
  await setPlayerFullscreen(page, true)
  await expect(graph).toBeVisible()
  const box = await bar.boundingBox()
  await page.mouse.move(box.x + box.width * 0.755, box.y + box.height / 2)
  const tooltip = bar.locator('.shaka-player-ui-thumbnail-time')
  await expect(tooltip).toContainText('Most replayed')
  await expect(tooltip).toBeVisible()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
  await expect(tooltip).not.toContainText('Most replayed')
  await bar.locator('input').evaluate(element => {
    element.value = '22.6'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(tooltip).toContainText('Most replayed')
  await bar.locator('input').evaluate(element => {
    element.value = '22.3'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(tooltip).not.toContainText('Most replayed')
  // Remap the playback shortcut so ArrowRight operates the focused range.
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
    'updateKeyboardShortcuts', JSON.stringify({ VIDEO_PLAYER: { PLAYBACK: { SMALL_FAST_FORWARD: 'x' } } })
  ))
  await bar.locator('input').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tooltip).toContainText('Most replayed')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0)

  await setPlayerFullscreen(page, false)
  const normalBox = await bar.boundingBox()
  await page.mouse.click(normalBox.x + normalBox.width * 0.5, normalBox.y + normalBox.height / 2)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(13)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(17)
  await video.evaluate(element => element.pause())
  await page.mouse.move(0, 0)
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
    const seekBounds = await bar.boundingBox()
    await page.mouse.move(seekBounds.x + seekBounds.width * 0.755, seekBounds.y + seekBounds.height / 2)
    await expect(tooltip).toContainText('Most replayed')
    await expect(tooltip).toBeVisible()
    const preview = await bar.locator('.shaka-player-ui-thumbnail-container').boundingBox()
    const graphBounds = await graph.boundingBox()
    expect(preview.y + preview.height).toBeLessThanOrEqual(graphBounds.y)
    const bounds = await player.boundingBox()
    const height = Math.min(180, bounds.height)
    await page.screenshot({
      path: testInfo.outputPath(`popularity-${colorScheme}.png`),
      clip: { x: bounds.x, y: bounds.y + bounds.height - height, width: bounds.width, height }
    })
  }

  // Replacing metadata must remove the old graph, including after a UI rebuild.
  await watch.evaluate(component => { component.proxy.videoPopularity = [] })
  await expect(graph).toHaveCount(0)
  await expect(bar).not.toHaveClass(/ft-has-popularity/)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', false))
  await expect(graph).toHaveCount(0)
})

test('touch scrubbing shows the most replayed label at the peak', async ({ app, page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 })
  })
  await mockPlayableWatchPage(app, page, { popularity })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await setPlayerFullscreen(page, true)
  const bar = page.locator('.shaka-seek-bar')
  const tooltip = page.locator('.shaka-player-ui-thumbnail-time')
  const box = await bar.boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const point = percentage => ({ x: box.x + box.width * percentage, y: box.y + box.height / 2 })
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0.4)] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(0.755)] })
    await expect(tooltip).toContainText('Most replayed')
    await expect(tooltip).toBeVisible()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(0.5)] })
    await expect(tooltip).not.toContainText('Most replayed')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
})

test('videos without popularity data keep the normal timeline', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { popularity: null })
  await openMockedVideo(page)
  await expect(page.locator('.ft-popularity-graph')).toHaveCount(0)
  await expect(page.locator('.shaka-seek-bar-container')).not.toHaveClass(/ft-has-popularity/)
})
