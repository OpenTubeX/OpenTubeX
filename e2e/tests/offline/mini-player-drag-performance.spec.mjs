import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  trace: 'off',
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } }
})

test('drags the mini player without laying out the page on every pointer move', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  // Playback updates the time display and progress, which lay out on their own.
  await video.evaluate(element => element.pause())
  const player = page.locator('.ftVideoPlayer')
  await player.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom))
  await expect(player).toHaveClass(/scrollMiniPlayer/)
  await expect(player).not.toHaveClass(/scrollMiniPlayerAnimating/)
  await player.hover()
  const handle = await player.locator('.scrollMiniDragHandle').boundingBox()
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const layoutCount = async () => (await cdp.send('Performance.getMetrics')).metrics
    .find(({ name }) => name === 'LayoutCount').value
  const position = () => player.evaluate(element => ({
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
    translate: element.style.translate,
  }))

  await page.mouse.move(x, y)
  await page.mouse.down()
  const start = await position()
  const before = await layoutCount()
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(x - step * 10, y - step * 5)
  }
  // Moves only translate the player, which the compositor draws, instead of
  // re-rendering and laying it out at a new left and top.
  await player.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const dragged = await position()
  expect(await layoutCount() - before).toBeLessThanOrEqual(4)
  expect(dragged).toMatchObject({ left: start.left, top: start.top, translate: '-200px -100px' })

  await page.mouse.up()
  // Releasing commits the position and snaps the player to the nearest side.
  const released = await position()
  expect(released.translate).toBe('')
  expect(released.top).toBeCloseTo(start.top - 100, 0)
})
