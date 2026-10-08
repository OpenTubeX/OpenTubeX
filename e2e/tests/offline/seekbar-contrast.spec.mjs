import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

test('seekbar stays backed on bright, dark and busy footage without blocking seeking', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.pause()
    element.currentTime = element.duration * 0.35
    // Replace only the footage, retaining the real player and controls.
    element.style.opacity = '0'
    Object.defineProperty(element, 'buffered', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => element.duration * 0.65 })
    })
  })
  const player = page.locator('.ftVideoPlayer')
  const track = player.locator('.shaka-seek-bar-container')
  const input = track.locator('.shaka-seek-bar')

  for (const scale of [1, 1.25]) {
    await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale)
    }, scale)
    for (const width of [420, 1000]) {
      await player.evaluate((element, width) => { element.style.width = `${width}px` }, width)
      for (const [name, background] of [
        ['white', '#fff'],
        ['black', '#000'],
        ['busy', 'repeating-linear-gradient(110deg, #fafafa 0 18px, #142b43 18px 36px, #dc9b42 36px 54px)']
      ]) {
        await video.evaluate(element => { element.currentTime = element.duration * 0.2 })
        await player.evaluate((element, background) => { element.style.background = background }, background)
        await player.hover()
        await input.focus()
        // Transparent Shaka segments must composite over a fixed dark base,
        // never the footage. This fails with the original transparent base.
        await expect(track).toHaveCSS('background-color', 'rgb(24, 24, 24)')
        await expect(input).toBeVisible()
        const bounds = await input.boundingBox()
        await page.mouse.click(bounds.x + 6 + (bounds.width - 12) * 0.37, bounds.y + bounds.height / 2)
        const target = await input.evaluate(element => Number(element.min) + 0.37 * (Number(element.max) - Number(element.min)))
        // Pointer coordinates round to physical pixels, especially at 125% zoom.
        const tolerance = await video.evaluate((element, width) => element.duration * 2 / (width - 12), bounds.width)
        await expect.poll(async () => Math.abs(await video.evaluate(element => element.currentTime) - target)).toBeLessThan(tolerance)
        await page.mouse.move(0, 0)
        if (scale === 1) {
          const box = await player.boundingBox()
          await page.screenshot({
            path: testInfo.outputPath(`${name}-${width}-${scale}.png`),
            clip: { x: box.x, y: box.y + box.height - 120, width: box.width, height: 120 }
          })
        }
      }
    }
  }
})
