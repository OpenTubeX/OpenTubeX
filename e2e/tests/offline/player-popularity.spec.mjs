import { test, expect, goToSettingsSection, setPlayerFullscreen } from '../../helpers/app.mjs'
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
  await player.locator('.shaka-play-button').hover()
  await expect(graph).toBeHidden()
  expect(await graph.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(40)

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale), scale)
    for (const width of [1300, 500]) {
      await resize(width, scale)
      for (const frosted of [true, false]) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', value), frosted)
        await bar.hover()
        await expect(graph).toBeVisible()
        await expect(graph).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
        expect(await graph.evaluate(element => {
          const graph = element.getBoundingClientRect()
          const bar = element.parentElement.getBoundingClientRect()
          return Math.max(Math.abs(graph.left - bar.left), Math.abs(graph.right - bar.right))
        })).toBeLessThan(1)
        await expect(graph).toHaveCSS('pointer-events', 'none')
        await player.locator('.shaka-play-button').hover()
        await expect(graph).toBeHidden()
      }
    }
  }

  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await resize(1300)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateUseFrostedGlassPlayerUi', true))
  await setPlayerFullscreen(page, true)
  await expect(graph).toBeHidden()
  const box = await bar.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box.x + box.width * 0.755, box.y + box.height / 2)
  const tooltip = bar.locator('.shaka-player-ui-thumbnail-time')
  await expect(tooltip).toContainText('Most replayed')
  await expect(tooltip).toBeVisible()
  await expect(graph).toBeVisible()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2)
  await expect(tooltip).not.toContainText('Most replayed')
  // Remap the playback shortcut so ArrowRight operates the focused range.
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
    'updateKeyboardShortcuts', JSON.stringify({ VIDEO_PLAYER: { PLAYBACK: { SMALL_FAST_FORWARD: 'x' } } })
  ))
  // Seek normally so Shaka commits the starting position before focusing the range.
  await video.evaluate(element => element.pause())
  const rangeBounds = await bar.locator('input').boundingBox()
  expect(rangeBounds).not.toBeNull()
  await page.mouse.click(rangeBounds.x + 6 + (rangeBounds.width - 12) * (22.3 / 30), rangeBounds.y + rangeBounds.height / 2)
  await expect.poll(async () => Number(await bar.locator('input').inputValue())).toBeCloseTo(22.3, 1)
  await bar.locator('input').press('ArrowRight')
  await expect(tooltip).toContainText('Most replayed')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0)

  await setPlayerFullscreen(page, false)
  const normalBox = await bar.boundingBox()
  expect(normalBox).not.toBeNull()
  await page.mouse.click(normalBox.x + normalBox.width * 0.5, normalBox.y + normalBox.height / 2)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(13)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(17)
  await video.evaluate(element => element.pause())
  await page.mouse.move(0, 0)
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(colorScheme))
    const seekBounds = await bar.boundingBox()
    expect(seekBounds).not.toBeNull()
    await page.mouse.move(seekBounds.x + seekBounds.width * 0.755, seekBounds.y + seekBounds.height / 2)
    await expect(tooltip).toContainText('Most replayed')
    await expect(tooltip).toBeVisible()
    const preview = await bar.locator('.shaka-player-ui-thumbnail-container').boundingBox()
    const graphBounds = await graph.boundingBox()
    expect(preview).not.toBeNull()
    expect(graphBounds).not.toBeNull()
    expect(preview.y + preview.height).toBeLessThanOrEqual(graphBounds.y)
    const bounds = await player.boundingBox()
    expect(bounds).not.toBeNull()
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

test('reduced motion reveals the popularity graph without a slide transition', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockPlayableWatchPage(app, page, { popularity })
  await openMockedVideo(page)
  const graph = page.locator('.ft-popularity-graph')
  await expect(graph).toBeHidden()
  await expect(graph).toHaveCSS('transition-duration', '0s')
  await page.locator('.shaka-seek-bar-container').hover()
  await expect(graph).toBeVisible()
  await expect(graph).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await page.locator('.shaka-play-button').hover()
  await expect(graph).toBeHidden()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(graph).toHaveCSS('transition-duration', '0.18s, 0.18s, 0s')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateReducedMotion', 'on'))
  await expect(graph).toHaveCSS('transition-duration', '0s')
  await page.locator('.shaka-seek-bar-container').hover()
  await expect(graph).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
})

test('Distraction Free hides popularity and saves the preference', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { popularity })
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const bar = page.locator('.shaka-seek-bar-container')
  const graph = page.locator('.ft-popularity-graph')
  const tooltip = bar.locator('.shaka-player-ui-thumbnail-time')
  const bounds = await bar.boundingBox()
  expect(bounds).not.toBeNull()
  await bar.hover({ position: { x: bounds.width * 0.755, y: bounds.height / 2 } })
  await expect(tooltip).toContainText('Most replayed')

  const focus = await goToSettingsSection(page, 'focus')
  const toggle = focus.getByRole('checkbox', { name: 'Hide Popularity Graph' })
  await expect(toggle).not.toBeChecked()
  await toggle.locator('..').locator('label.switch-label').click()
  await expect(toggle).toBeChecked()
  await expect(graph).toHaveCount(0)
  await expect(tooltip).not.toContainText('Most replayed')
  await expect(bar).not.toHaveClass(/ft-has-popularity/)

  await toggle.locator('..').locator('label.switch-label').click()
  await expect(toggle).not.toBeChecked()
  await expect(graph).toHaveCount(1)
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('.shaka-play-button').hover()
  await expect(graph).toBeHidden()
  await bar.hover()
  await expect(graph).toBeVisible()

  const reopened = await goToSettingsSection(page, 'focus')
  await reopened.getByRole('checkbox', { name: 'Hide Popularity Graph' }).locator('..').locator('label.switch-label').click()
  await expect(graph).toHaveCount(0)
  const { page: relaunched } = await app.relaunch()
  const restored = await goToSettingsSection(relaunched, 'focus')
  await expect(restored.getByRole('checkbox', { name: 'Hide Popularity Graph' })).toBeChecked()
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
  await expect(bar).toBeVisible()
  const box = await bar.boundingBox()
  expect(box).not.toBeNull()
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
