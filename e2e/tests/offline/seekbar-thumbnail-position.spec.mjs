import { readFile } from 'node:fs/promises'

import { test, expect } from '../../helpers/app.mjs'
import { routeDemoMedia } from '../../helpers/media.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

test('keeps short-video thumbnails centered on the cursor at different UI scales and widths', async ({ app, page, attachScreenshot }) => {
  await mockPlayableWatchPage(app, page)
  await routeDemoMedia(page, await readFile(new URL('../../fixtures/media/short-demo.webm', import.meta.url)))
  await page.route('https://images.test/seek-thumbnail.svg', route => fulfillVisualFixture(route, 'video-thumbnail'))
  const video = await openMockedVideo(page)
  await video.evaluate(async element => {
    element.pause()
    const vtt = new Blob([
      'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nhttps://images.test/seek-thumbnail.svg\n'
    ], { type: 'text/vtt' })
    const url = URL.createObjectURL(vtt)
    try {
      await element.ui.getControls().getPlayer().addThumbnailsTrack(url, 'text/vtt')
    } finally {
      URL.revokeObjectURL(url)
    }
  })
  expect(await video.evaluate(element => element.duration)).toBeLessThan(5)
  const player = page.locator('.ftVideoPlayer')
  const bar = player.locator('.shaka-seek-bar')
  const preview = player.locator('.shaka-player-ui-thumbnail-container')
  const image = preview.locator('img')

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale)
    }, scale)
    for (const width of [420, 1000]) {
      await player.evaluate((element, width) => { element.style.width = `${width}px` }, width)
      await expect.poll(() => player.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0)
      await player.hover()
      await bar.scrollIntoViewIfNeeded()
      const bounds = await bar.boundingBox()
      for (const fraction of [0.25, 0.37, 0.53, 0.69]) {
        const cursorX = bounds.x + 6 + fraction * (bounds.width - 12)
        await page.mouse.move(cursorX, bounds.y + bounds.height / 2)
        await expect(preview).toHaveCSS('visibility', 'visible')
        await expect(image).toBeVisible()
        await expect.poll(async () => {
          const box = await preview.boundingBox()
          return Math.abs(box.x + box.width / 2 - cursorX)
        }).toBeLessThan(1.5)
        await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
      }

      // Edges still clamp the preview to the track instead of letting it overflow.
      for (const fraction of [0, 1]) {
        await page.mouse.move(bounds.x + 6 + fraction * (bounds.width - 12), bounds.y + bounds.height / 2)
        const box = await preview.boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1.5)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1.5)
      }
    }
  }
  const bounds = await bar.boundingBox()
  const cursorX = bounds.x + 6 + 0.37 * (bounds.width - 12)
  await page.mouse.click(cursorX, bounds.y + bounds.height / 2)
  const seekTime = await bar.evaluate(element => {
    return Number(element.min) + 0.37 * (Number(element.max) - Number(element.min))
  })
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(seekTime, 2)
  await attachScreenshot('short-video thumbnail follows the cursor')
})
