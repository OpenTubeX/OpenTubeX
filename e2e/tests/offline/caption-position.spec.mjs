import { setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      enableSubtitlesByDefault: true,
    }
  }
})

test('lowers bottom captions after the player controls fade', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page, { captionCueSettings: 'align:start position:0%' })
  await openMockedVideo(page)

  const player = page.locator('.ftVideoPlayer')
  const controls = player.locator('.shaka-controls-container')
  const captions = player.locator('.shaka-text-container')
  const caption = captions.locator('[translate="no"]')
  await expect(caption).toBeVisible()
  await setPlayerFullscreen(page, true)

  await player.hover()
  await expect(controls).toHaveAttribute('shown', 'true')
  const raisedBottom = await captions.evaluate(element => {
    return Number.parseFloat(getComputedStyle(element).bottom)
  })
  expect(raisedBottom).toBeGreaterThan(0)
  const raisedCaptionBounds = await caption.boundingBox()

  await page.mouse.move(0, 0)
  await expect(controls).not.toHaveAttribute('shown', 'true')
  const expectedHiddenBottom = await player.evaluate(element => {
    return Math.max(12, element.getBoundingClientRect().height * 0.04)
  })
  await expect.poll(() => captions.evaluate(element => {
    return Number.parseFloat(getComputedStyle(element).bottom)
  })).toBeCloseTo(expectedHiddenBottom, 1)
  await expect.poll(async () => {
    const bounds = await caption.boundingBox()
    return bounds?.y + bounds?.height
  }).toBeGreaterThan(raisedCaptionBounds.y + raisedCaptionBounds.height)
  await expect.poll(async () => {
    const [playerBounds, captionBounds] = await Promise.all([
      player.boundingBox(),
      caption.boundingBox(),
    ])
    if (!playerBounds || !captionBounds) return Number.POSITIVE_INFINITY

    const visualBottomGap = playerBounds.y + playerBounds.height -
      (captionBounds.y + captionBounds.height)
    return Math.abs(visualBottomGap - expectedHiddenBottom)
  }).toBeLessThanOrEqual(1)
})
