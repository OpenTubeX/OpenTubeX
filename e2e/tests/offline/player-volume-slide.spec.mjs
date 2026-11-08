import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useQuickPlaybackSpeedBar: true,
      reducedMotion: 'off'
    }
  }
})

test('volume slide supports narrow windows, keyboard input and reduced motion', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  await page.locator('.shaka-controls-container').evaluate(element => element.setAttribute('casting', 'true'))
  await setWindowSize(app, page, { width: 450, height: 700 })
  const group = page.locator('.ft-volume-control-group')
  const slider = group.locator('.shaka-volume-bar')
  await group.locator('.shaka-mute-button').hover()
  await expect(group.locator('.shaka-volume-bar-container')).toHaveCSS('width', '50px')
  await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
  await page.keyboard.press('Tab')
  await slider.focus()
  await page.mouse.move(1, 1)
  await expect(group.locator('.shaka-volume-bar-container')).toHaveCSS('width', '50px')
  const volumeBefore = Number(await slider.inputValue())
  await page.keyboard.press('ArrowLeft')
  await expect(slider).toHaveValue(String(volumeBefore - 1))
  await expect(group.locator('.shaka-volume-bar-container')).toHaveCSS('animation-name', 'none')
  expect(await group.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
})
