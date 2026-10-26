import { test, expect, setPlayerFullscreen } from '../../helpers/app.mjs'
import { routeDemoMedia } from '../../helpers/media.mjs'
import { mockCapacitorPhoneLayout } from '../../helpers/mobile.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      enableMobileFullscreenSeek: true,
      showMobileSeekPreview: true
    }
  }
})

const COLUMNS = 10
const TILE_WIDTH = 160
const TILE_HEIGHT = 90

/** A storyboard with one distinctly coloured, numbered tile per second. */
function storyboardSprite(frames) {
  const tiles = Array.from({ length: frames }, (_, index) => {
    const x = index % COLUMNS * TILE_WIDTH
    const y = Math.floor(index / COLUMNS) * TILE_HEIGHT
    return `<rect x="${x}" y="${y}" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" fill="hsl(${index * 47} 60% 40%)"/>` +
      `<text x="${x + 80}" y="${y + 60}" font-size="44" font-family="sans-serif" fill="#fff" text-anchor="middle">${index}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * TILE_WIDTH}" height="${Math.ceil(frames / COLUMNS) * TILE_HEIGHT}">${tiles.join('')}</svg>`
}

/**
 * Opens the paused demo video with a storyboard track of one tile per second.
 * @param {import('@playwright/test').Page} page
 */
async function openVideoWithStoryboard(page) {
  const video = await openMockedVideo(page)
  const duration = await video.evaluate(element => element.duration)
  const frames = Math.ceil(duration)
  await page.route('https://images.test/storyboard.svg', route => route.fulfill({
    body: storyboardSprite(frames),
    contentType: 'image/svg+xml'
  }))
  await video.evaluate(async (element, { frames, columns, width, height }) => {
    element.pause()
    const time = seconds => new Date(seconds * 1000).toISOString().slice(11, 23)
    const cues = Array.from({ length: frames }, (_, index) => {
      const xywh = `${index % columns * width},${Math.floor(index / columns) * height},${width},${height}`
      return `${time(index)} --> ${time(index + 1)}\nhttps://images.test/storyboard.svg#xywh=${xywh}\n`
    })
    const url = URL.createObjectURL(new Blob([`WEBVTT\n\n${cues.join('\n')}`], { type: 'text/vtt' }))
    try {
      await element.ui.getControls().getPlayer().addThumbnailsTrack(url, 'text/vtt')
    } finally {
      URL.revokeObjectURL(url)
    }
  }, { frames, columns: COLUMNS, width: TILE_WIDTH, height: TILE_HEIGHT })
  return { video, duration }
}

test('dragging the seek bar thumb shows a storyboard filmstrip at it', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const { video, duration } = await openVideoWithStoryboard(page)

  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const filmstrip = player.locator('.ft-seek-filmstrip')
  const marker = filmstrip.locator('.ft-seek-filmstrip-marker')
  const preview = player.locator('.shaka-player-ui-thumbnail-container')
  const previewImage = preview.locator('.shaka-player-ui-thumbnail-image-container')
  const previewTime = preview.locator('.shaka-player-ui-thumbnail-time')
  await player.hover()
  const bounds = await bar.boundingBox()
  const pointAt = fraction => ({ x: bounds.x + 6 + fraction * (bounds.width - 12), y: bounds.y + bounds.height / 2 })
  /** Where the thumb currently is within the given seek bar bounds. */
  const thumbAt = async (barBounds = bounds) => {
    const fraction = await bar.evaluate(element => (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min)))
    return { x: barBounds.x + 6 + fraction * (barBounds.width - 12), y: barBounds.y + barBounds.height / 2 }
  }

  // Hovering keeps the single thumbnail.
  await page.mouse.move(pointAt(0.3).x, pointAt(0.3).y)
  await expect(previewImage).toBeVisible()
  await expect(filmstrip).toBeHidden()

  // A tap seeks without ever showing the filmstrip.
  await player.evaluate(element => {
    const container = element.querySelector('.shaka-seek-bar-container')
    element.filmstripShown = false
    element.filmstripObserver = new MutationObserver(() => {
      element.filmstripShown ||= container.classList.contains('ft-seek-filmstrip-active')
    })
    element.filmstripObserver.observe(container, { attributes: true, attributeFilter: ['class'] })
  })
  await page.mouse.click(pointAt(0.3).x, pointAt(0.3).y)
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * 0.3, 0)
  expect(await player.evaluate(element => {
    element.filmstripObserver.disconnect()
    return element.filmstripShown
  })).toBe(false)

  // Like YouTube, dragging from elsewhere on the track keeps the single thumbnail.
  await page.mouse.move(pointAt(0.6).x, pointAt(0.6).y)
  await page.mouse.down()
  await page.mouse.move(pointAt(0.7).x, pointAt(0.7).y, { steps: 4 })
  await expect(previewImage).toBeVisible()
  await expect(filmstrip).toBeHidden()
  await page.mouse.up()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * 0.7, 0)

  // Grabbing the thumb itself shows the filmstrip while dragging.
  const thumb = await thumbAt()
  await page.mouse.move(thumb.x, thumb.y)
  await page.mouse.down()
  for (const fraction of [0.6, 0.5, 0.4, 0.45]) {
    await page.mouse.move(pointAt(fraction).x, pointAt(fraction).y, { steps: 2 })
    await expect(filmstrip).toBeVisible()
    await expect(previewImage).toBeHidden()
    await expect(previewTime).toBeVisible()

    const time = await bar.evaluate(element => Number(element.value))
    await expect.poll(async () => {
      const box = await marker.boundingBox()
      return Math.abs(box.x + box.width / 2 - pointAt(fraction).x)
    }).toBeLessThan(1.5)

    // The frame under the marker shows the storyboard tile for the dragged time.
    const tile = Math.floor(time)
    await expect.poll(() => filmstrip.evaluate((element, markerX) => {
      const frame = [...element.querySelectorAll('.ft-seek-filmstrip-frame')].find(frame => {
        const box = frame.getBoundingClientRect()
        return box.left <= markerX && markerX < box.right
      })
      return frame?.firstElementChild.style.backgroundPosition
    }, pointAt(fraction).x)).toBe(`${-(tile % COLUMNS * TILE_WIDTH)}px ${-(Math.floor(tile / COLUMNS) * TILE_HEIGHT)}px`)
  }

  // The strip spans the seek bar, the time sits above it, and both stay inside the player.
  const stripBox = await filmstrip.boundingBox()
  const timeBox = await previewTime.boundingBox()
  const playerBox = await player.boundingBox()
  expect(Math.abs(stripBox.x - bounds.x)).toBeLessThan(1.5)
  expect(Math.abs(stripBox.width - bounds.width)).toBeLessThan(1.5)
  expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(bounds.y)
  expect(timeBox.y + timeBox.height).toBeLessThanOrEqual(stripBox.y)
  expect(timeBox.y).toBeGreaterThanOrEqual(playerBox.y)
  const frameCount = await filmstrip.locator('.ft-seek-filmstrip-frame').count()
  expect(frameCount).toBeGreaterThan(2)
  await attachScreenshot('seek bar filmstrip while dragging')

  await page.mouse.up()
  await expect(filmstrip).toBeHidden()
  await expect(preview).toHaveCSS('visibility', 'hidden')
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * 0.45, 0)

  // The filmstrip spans the fullscreen action dock's corner, so the dock steps aside.
  await setPlayerFullscreen(page, true)
  const dock = player.locator('.fullscreenActions')
  await player.hover({ position: { x: 20, y: 20 } })
  await expect(dock).toBeVisible()
  const fullscreenBounds = await bar.boundingBox()
  const fullscreenThumb = await thumbAt(fullscreenBounds)
  await page.mouse.move(fullscreenThumb.x, fullscreenThumb.y)
  await page.mouse.down()
  await page.mouse.move(fullscreenThumb.x + fullscreenBounds.width * 0.2, fullscreenThumb.y, { steps: 4 })
  await expect(filmstrip).toBeVisible()
  await expect(dock).toBeHidden()
  await page.mouse.up()
  await expect(filmstrip).toBeHidden()
  await player.hover({ position: { x: 20, y: 20 } })
  await expect(dock).toBeVisible()
})

test('fullscreen swipe-to-seek shows the seek bar preview over paused controls', async ({ app, page }) => {
  const touch = await page.context().newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const { video } = await openVideoWithStoryboard(page)
  await video.evaluate(element => { element.currentTime = 15 })
  await expect.poll(() => video.evaluate(element => !element.seeking && element.currentTime === 15)).toBe(true)
  await mockCapacitorPhoneLayout(page)
  await setPlayerFullscreen(page, true)
  const player = page.locator('.ftVideoPlayer')
  const controls = player.locator('.shaka-controls-container')
  await expect(controls).toHaveAttribute('shown')
  // Shaka hides the cursor once the last input stops counting as recent; only
  // the pause keeps the controls up from then on.
  await expect(player).toHaveClass(/no-cursor/, { timeout: 15000 })
  await expect(controls).toHaveAttribute('shown')

  const box = await player.boundingBox()
  const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.4 }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
  for (let step = 1; step <= 5; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + box.width * 0.04 * step, y: start.y }] })
  }
  await expect(player.locator('.ft-seek-filmstrip')).toBeVisible()
  await expect(player.locator('.shaka-player-ui-thumbnail-time')).toHaveText('0:21')
  // Seeking must not let Shaka fade out the paused controls, which hold the preview.
  await page.waitForTimeout(500)
  await expect(controls).toHaveAttribute('shown')

  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(player.locator('.ft-seek-filmstrip')).toBeHidden()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(21)
})

test('finger drags on the seek bar show the filmstrip, taps do not', async ({ app, page }) => {
  const touch = await page.context().newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const { video, duration } = await openVideoWithStoryboard(page)
  await video.evaluate(element => { element.currentTime = 15 })
  await expect.poll(() => video.evaluate(element => !element.seeking && element.currentTime === 15)).toBe(true)
  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const filmstrip = player.locator('.ft-seek-filmstrip')
  await player.hover()
  const bounds = await bar.boundingBox()
  const pointAt = fraction => ({ x: bounds.x + 6 + fraction * (bounds.width - 12), y: bounds.y + bounds.height / 2 })
  const thumbFraction = () => bar.evaluate(element => (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min)))

  // Dragging the knob, and dragging from elsewhere on the track, both show it.
  for (const startFraction of [await thumbFraction(), 0.7]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pointAt(startFraction)] })
    for (let step = 1; step <= 4; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pointAt(startFraction - 0.05 * step)] })
    }
    await expect(filmstrip).toBeVisible()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(filmstrip).toBeHidden()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * (startFraction - 0.2), 0)
  }

  // A tap only seeks.
  await player.evaluate(element => {
    const container = element.querySelector('.shaka-seek-bar-container')
    element.filmstripShown = false
    new MutationObserver(() => {
      element.filmstripShown ||= container.classList.contains('ft-seek-filmstrip-active')
    }).observe(container, { attributes: true, attributeFilter: ['class'] })
  })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pointAt(0.8)] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * 0.8, 0)
  expect(await player.evaluate(element => element.filmstripShown)).toBe(false)
})
