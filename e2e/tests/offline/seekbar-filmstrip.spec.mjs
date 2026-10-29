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

test('dragging the seek bar shows a storyboard filmstrip at the thumb', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
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

  // Dragging from elsewhere on the track shows the filmstrip too.
  await page.mouse.move(pointAt(0.6).x, pointAt(0.6).y)
  await page.mouse.down()
  await page.mouse.move(pointAt(0.7).x, pointAt(0.7).y, { steps: 4 })
  await expect(filmstrip).toBeVisible()
  await expect(previewImage).toBeHidden()
  await page.mouse.up()
  await expect(filmstrip).toBeHidden()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(duration * 0.7, 0)

  // Drag back and forth from the current position to check the frames and marker.
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

test('the filmstrip shows earlier frames of sprite-sheet storyboards with long tiles', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const video = await openMockedVideo(page)
  const duration = await video.evaluate(element => element.duration)
  // Like YouTube's storyboards for longer videos: one sheet whose tiles span
  // 15 seconds each, laid out by Shaka instead of individual WebVTT cues.
  const tileSeconds = 15
  const tiles = Math.ceil(duration / tileSeconds)
  await page.route('https://images.test/storyboard.svg', route => route.fulfill({
    body: storyboardSprite(tiles),
    contentType: 'image/svg+xml'
  }))
  await video.evaluate(async (element, { duration, tiles, tileSeconds, width, height }) => {
    element.pause()
    const sheet = 'https://images.test/storyboard.svg'
    const player = element.ui.getControls().getPlayer()
    const vtt = `WEBVTT\n\n00:00:00.000 --> ${new Date(duration * 1000).toISOString().slice(11, 23)}\n${sheet}\n`
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
    try {
      await player.addThumbnailsTrack(url, 'text/vtt')
    } finally {
      URL.revokeObjectURL(url)
    }
    // Shaka only exposes its tile classes through existing instances, and keeps
    // a progressive source's image streams in a private (minified) field.
    const SegmentReference = (await player.getThumbnails(null, 0)).segment.constructor
    const stream = Object.values(player).find(value => Array.isArray(value) && value[0]?.type === 'image')[0]
    const SegmentIndex = stream.segmentIndex.constructor
    const layout = `${tiles}x1`
    stream.tilesLayout = layout
    stream.width = tiles * width
    stream.height = height
    stream.createSegmentIndex = async () => {
      stream.segmentIndex = new SegmentIndex([
        new SegmentReference(0, duration, () => [sheet], 0, null, null, 0, 0, Infinity, undefined, layout, tileSeconds)
      ])
    }
    await stream.createSegmentIndex()
  }, { duration, tiles, tileSeconds, width: TILE_WIDTH, height: TILE_HEIGHT })

  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const filmstrip = player.locator('.ft-seek-filmstrip')
  await player.hover()
  const bounds = await bar.boundingBox()
  const pointAt = fraction => ({ x: bounds.x + 6 + fraction * (bounds.width - 12), y: bounds.y + bounds.height / 2 })
  const fraction = await bar.evaluate(element => (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min)))
  await page.mouse.move(pointAt(fraction).x, pointAt(fraction).y)
  await page.mouse.down()
  await page.mouse.move(pointAt(0.8).x, pointAt(0.8).y, { steps: 4 })
  await expect(filmstrip).toBeVisible()

  // Every tile shows side by side, including those before the dragged one.
  await expect.poll(() => filmstrip.evaluate(element => [...element.querySelectorAll('.ft-seek-filmstrip-frame')]
    .map(frame => ({ box: frame.getBoundingClientRect(), position: frame.firstElementChild.style.backgroundPosition }))
    .sort((a, b) => a.box.left - b.box.left)
    .map(({ box, position }, index, frames) => ({
      position,
      gap: index === 0 ? 0 : Math.round(box.left - frames[index - 1].box.right)
    })))).toEqual(Array.from({ length: tiles }, (_, tile) => ({ position: `${-tile * TILE_WIDTH}px 0px`, gap: 0 })))

  // So few frames make the strip coarser than the seek bar, so pulling up keeps the bar's scale.
  await expect(filmstrip.locator('.ft-seek-filmstrip-hint')).toBeHidden()
  const strip = await filmstrip.boundingBox()
  await page.mouse.move(pointAt(0.8).x, strip.y + strip.height / 2, { steps: 2 })
  await page.mouse.move(pointAt(0.6).x, strip.y + strip.height / 2, { steps: 2 })
  await expect.poll(() => bar.evaluate(element => Number(element.value))).toBeCloseTo(duration * 0.6, 0)
  await page.mouse.up()
})

test('pulling the dragged thumb up past the filmstrip middle seeks at its scale', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const { video } = await openVideoWithStoryboard(page)

  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const filmstrip = player.locator('.ft-seek-filmstrip')
  const marker = filmstrip.locator('.ft-seek-filmstrip-marker')
  const hint = filmstrip.locator('.ft-seek-filmstrip-hint')
  const previewTime = player.locator('.shaka-player-ui-thumbnail-time')
  const chapter = player.locator('.ft-chapter-preview')
  await player.hover()
  const bounds = await bar.boundingBox()
  const pointAt = fraction => ({ x: bounds.x + 6 + fraction * (bounds.width - 12), y: bounds.y + bounds.height / 2 })
  const barTime = () => bar.evaluate(element => Number(element.value))
  const hintProgress = () => hint.evaluate(element => Number(element.style.getPropertyValue('--ft-seek-precise-progress')))
  const markerCenter = async () => {
    const box = await marker.boundingBox()
    return box.x + box.width / 2
  }

  const fraction = await bar.evaluate(element => (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min)))
  await page.mouse.move(pointAt(fraction).x, pointAt(fraction).y)
  await page.mouse.down()
  // One movement and a hold: the hint waits for the strip's scale, not for more movement.
  const start = pointAt(0.5)
  await page.mouse.move(start.x, start.y)
  await expect(hint).toHaveText('Pull up for precise seeking')
  expect(await hintProgress()).toBe(0)

  // The lower half of the strip still seeks by the pointer's spot on the bar.
  // The hint fills up to show how far the pointer is from precise seeking.
  const strip = await filmstrip.boundingBox()
  await page.mouse.move(start.x, strip.y + strip.height * 0.75, { steps: 2 })
  await page.mouse.move(start.x + 40, strip.y + strip.height * 0.75, { steps: 2 })
  await expect.poll(async () => Math.abs(await markerCenter() - (start.x + 40))).toBeLessThan(1.5)
  await expect(hint).toHaveText('Pull up for precise seeking')
  await expect.poll(hintProgress).toBeCloseTo(0.5, 1)
  await page.mouse.move(start.x, strip.y + strip.height * 0.75, { steps: 2 })

  // Pulling up past the middle keeps the time; moving sideways then scrolls the frames under a fixed marker.
  const startTime = await barTime()
  const startMarker = await markerCenter()
  const stripY = strip.y + strip.height * 0.25
  await page.mouse.move(start.x, stripY, { steps: 2 })
  await expect(hint).toHaveText('Precise seeking · Drag down to exit')
  await expect(player.locator('.shaka-seek-bar-container')).toHaveClass(/ft-seek-filmstrip-precise/)
  expect(await barTime()).toBeCloseTo(startTime, 5)
  await expect.poll(hintProgress).toBe(1)

  const pixelsPerSecond = await filmstrip.evaluate(element => {
    const frame = element.querySelector('.ft-seek-filmstrip-frame')
    return frame.getBoundingClientRect().width
  })
  await page.mouse.move(start.x + 100, stripY, { steps: 4 })
  await expect.poll(barTime).toBeCloseTo(startTime + 100 / pixelsPerSecond, 1)
  expect(Math.abs(await markerCenter() - startMarker)).toBeLessThan(1.5)
  const previewBox = await previewTime.boundingBox()
  expect(Math.abs(previewBox.x + previewBox.width / 2 - startMarker)).toBeLessThan(2)
  const chapterBox = await chapter.boundingBox()
  expect(Math.abs(chapterBox.x + chapterBox.width / 2 - startMarker)).toBeLessThan(2)

  // Dragging back down to the lower half stays precise and drains the hint; below the strip returns to the bar's scale.
  await page.mouse.move(start.x + 100, strip.y + strip.height * 0.75, { steps: 2 })
  await expect(hint).toHaveText('Precise seeking · Drag down to exit')
  await expect.poll(hintProgress).toBeCloseTo(0.5, 1)
  await page.mouse.move(start.x + 100, start.y, { steps: 2 })
  await expect(hint).toHaveText('Pull up for precise seeking')
  await expect.poll(async () => Math.abs(await markerCenter() - (start.x + 100))).toBeLessThan(1.5)
  await attachScreenshot('seek hint after leaving precise seeking')
  const barScaleTime = await barTime()
  await page.mouse.move(start.x + 140, start.y, { steps: 2 })
  await expect.poll(async () => Math.abs(await markerCenter() - (start.x + 140))).toBeLessThan(1.5)
  expect(await barTime()).toBeGreaterThan(barScaleTime + 40 / pixelsPerSecond)

  // Pulling up again resumes precise seeking from there.
  const resumeTime = await barTime()
  await page.mouse.move(start.x + 140, stripY, { steps: 2 })
  await expect(hint).toHaveText('Precise seeking · Drag down to exit')
  await page.mouse.move(start.x + 40, stripY, { steps: 4 })
  const preciseTime = resumeTime - 100 / pixelsPerSecond
  await expect.poll(barTime).toBeCloseTo(preciseTime, 1)

  // Releasing seeks to the precise time, not to the pointer's spot on the seek bar.
  await page.mouse.up()
  await expect(filmstrip).toBeHidden()
  await expect(chapter).toBeHidden()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(preciseTime, 1)
  // Releasing above the bar must not count as a click on the paused video.
  expect(await video.evaluate(element => element.paused)).toBe(true)

  // Escape cancels a drag and returns to where it started.
  const seekedTime = await video.evaluate(element => element.currentTime)
  const thumb = pointAt((seekedTime - await bar.evaluate(element => Number(element.min))) / await bar.evaluate(element => Number(element.max) - Number(element.min)))
  await page.mouse.move(thumb.x, thumb.y)
  await page.mouse.down()
  await page.mouse.move(pointAt(0.8).x, thumb.y, { steps: 4 })
  await expect(filmstrip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(filmstrip).toBeHidden()
  await page.mouse.move(pointAt(0.9).x, thumb.y, { steps: 2 })
  await page.mouse.up()
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(seekedTime, 2)
  expect(await barTime()).toBeCloseTo(seekedTime, 2)
})

test('the mouse wheel over the seek bar scrolls the page instead of seeking', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.pause()
    element.currentTime = 5
  })

  const bar = page.locator('.ftVideoPlayer .shaka-seek-bar')
  await page.locator('.ftVideoPlayer').hover()
  await expect(bar).toBeEnabled()
  const scrollOffsets = () => bar.evaluate(element => {
    const offsets = []
    for (let node = element.parentElement; node; node = node.parentElement) offsets.push(node.scrollTop)
    return offsets
  })
  const before = await scrollOffsets()
  await bar.hover()
  await page.mouse.wheel(0, 300)

  await expect.poll(async () => (await scrollOffsets()).some((offset, index) => offset > before[index])).toBe(true)
  expect(await video.evaluate(element => element.currentTime)).toBe(5)
})

test('releasing a short drag away from the seek bar hides the time preview', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())

  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const preview = player.locator('.shaka-player-ui-thumbnail-container')
  await player.hover()
  const bounds = await bar.boundingBox()
  const x = bounds.x + bounds.width / 2
  await page.mouse.move(x, bounds.y + bounds.height / 2)
  await expect(preview).toHaveCSS('visibility', 'visible')

  // Too little sideways movement for the filmstrip, but the pointer leaves the bar.
  await page.mouse.down()
  await page.mouse.move(x + 1, bounds.y - 80, { steps: 4 })
  await page.mouse.up()
  await expect(preview).toHaveCSS('visibility', 'hidden')
})

test.describe('with a short interface hide delay', () => {
  test.use({
    seed: {
      settings: {
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true,
        playingInterfaceHideDelay: 0.5
      }
    }
  })

  test('dragging the seek bar keeps the controls up outside the player until release', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await routeDemoMedia(page)
    const { video } = await openVideoWithStoryboard(page)
    await video.evaluate(element => element.play())

    const player = page.locator('.ftVideoPlayer')
    const controls = player.locator('.shaka-controls-container')
    const bar = player.locator('.shaka-seek-bar')
    const filmstrip = player.locator('.ft-seek-filmstrip')
    await player.hover()
    const bounds = await bar.boundingBox()
    const playerBox = await player.boundingBox()
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(bounds.x + bounds.width * 0.3, y)
    // Shaka ignores presses until the controls it just revealed re-enable the bar.
    await expect(controls).toHaveAttribute('shown')
    await expect(bar).toBeEnabled()
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.4, y, { steps: 4 })
    await expect(filmstrip).toBeVisible()

    // Neither leaving the player nor resting outside it hides the controls mid-drag.
    const outside = { x: bounds.x + bounds.width * 0.5, y: playerBox.y + playerBox.height + 20 }
    await page.mouse.move(outside.x, outside.y, { steps: 4 })
    await page.waitForTimeout(2000)
    await expect(controls).toHaveAttribute('shown')
    await expect(filmstrip).toBeVisible()

    // Releasing outside lets them fade like leaving the player does.
    await page.mouse.up()
    await expect(filmstrip).toBeHidden()
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(false)
    await expect(controls).not.toHaveAttribute('shown', { timeout: 5000 })
  })
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
  await mockCapacitorPhoneLayout(page)
  const { video, duration } = await openVideoWithStoryboard(page)
  await video.evaluate(element => { element.currentTime = 15 })
  await expect.poll(() => video.evaluate(element => !element.seeking && element.currentTime === 15)).toBe(true)
  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const filmstrip = player.locator('.ft-seek-filmstrip')
  await player.hover()
  const bounds = await bar.boundingBox()
  const pointAt = fraction => ({ x: bounds.x + 6 + fraction * (bounds.width - 12), y: bounds.y + bounds.height / 2 })
  const bigButtons = player.locator('.shaka-big-buttons-container')
  await expect(bigButtons).toBeVisible()
  const thumbFraction = () => bar.evaluate(element => (Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min)))
  // Shaka only moves the thumb to a seek on its next refresh tick.
  await expect.poll(thumbFraction).toBeCloseTo(15 / duration, 2)

  // Dragging the knob, and dragging from elsewhere on the track, both show it.
  for (const startFraction of [await thumbFraction(), 0.7]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pointAt(startFraction)] })
    for (let step = 1; step <= 4; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pointAt(startFraction - 0.05 * step)] })
    }
    await expect(filmstrip).toBeVisible()
    // The central play button would cover the strip on small players.
    await expect(bigButtons).toBeHidden()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(filmstrip).toBeHidden()
    await expect(bigButtons).toBeVisible()
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
  // Shaka shows the time at the finger and hides it again after the tap.
  await expect(player.locator('.shaka-player-ui-thumbnail-container')).toHaveCSS('visibility', 'hidden')
})
