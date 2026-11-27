import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

test.use({
  trace: 'off',
  seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } }
})

test('drags and settles a phone sheet without laying it out on every frame', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  // Playback updates the time display and progress, which lay out on their own.
  await video.evaluate(element => element.pause())
  await setWindowSize(app, page, { width: 480, height: 800 })
  // Expanded sheets stop below the status bar, as on phones.
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-top', '28px'))
  const watch = await watchViewHandle(page)
  await watch.evaluate(vm => vm.openPhonePanel('comments'))
  const sheet = page.locator('.dockedSheet[open]')
  await expect(sheet.locator('.comment').first()).toBeVisible()
  const settled = () => sheet.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await settled()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const layoutCount = async () => (await cdp.send('Performance.getMetrics')).metrics
    .find(({ name }) => name === 'LayoutCount').value
  const top = () => sheet.evaluate(element => element.getBoundingClientRect().top)
  const frame = () => sheet.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  // Each phase may lay out a few times when it starts or ends, never per move or frame.
  async function drag(x, y, distance) {
    await page.mouse.move(x, y)
    await page.mouse.down()
    let before = await layoutCount()
    for (let step = 1; step <= 20; step++) {
      await page.mouse.move(x, y + distance * step / 20)
    }
    await frame()
    const moved = await layoutCount() - before
    const from = await top()
    before = await layoutCount()
    await page.mouse.up()
    const frames = await sheet.evaluate(element => new Promise(resolve => {
      const samples = []
      const sample = () => {
        const { top, bottom } = element.getBoundingClientRect()
        samples.push({ top, gap: window.innerHeight - bottom })
        if (element.getAnimations().length > 0) requestAnimationFrame(sample)
        else resolve(samples)
      }
      requestAnimationFrame(sample)
    }))
    await settled()
    await frame()
    const settledLayouts = await layoutCount() - before
    expect(moved, 'layouts while dragging').toBeLessThanOrEqual(4)
    expect(settledLayouts, 'layouts while settling').toBeLessThanOrEqual(4)
    // The sheet slides straight to its resting place and keeps reaching the window's bottom edge.
    const to = await top()
    for (const { top, gap } of frames) {
      expect(top).toBeGreaterThanOrEqual(Math.min(from, to) - 1)
      expect(top).toBeLessThanOrEqual(Math.max(from, to) + 1)
      expect(gap).toBeLessThanOrEqual(1)
    }
  }

  const header = await sheet.locator('.mobileSheetHeader').boundingBox()
  const collapsedTop = await top()
  const x = header.x + header.width / 2
  await page.mouse.move(x, header.y + 5)
  await page.mouse.down()
  await page.mouse.move(x, header.y - 95, { steps: 10 })
  // The sheet follows the pointer while it is pulled up.
  await expect.poll(top).toBeCloseTo(collapsedTop - 100, 0)
  await page.mouse.up()
  await settled()
  await expect.poll(top).toBe(28)

  // Pull the expanded sheet down a little, so it returns to the top,
  // then far enough to lower it back below the player.
  await drag(x, 40, 18)
  expect(await top()).toBe(28)
  await drag(x, 40, 200)
  expect(await top()).toBeCloseTo(collapsedTop, 0)
  // Pull it up again, to the top.
  await drag(x, header.y + 5, -200)
  expect(await top()).toBe(28)
})
