import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      animationSpeed: 0,
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useCustomShortsPlayer: true,
    },
  },
})

test('Shorts playlist popover stays above the video player', async ({ app, page }, testInfo) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    component.proxy.useCustomShortsPlayerForCurrentVideo = true
    component.proxy.updateShortsPlayerState(30, [{ width: 360, height: 640 }])
    await component.proxy.$nextTick()
  })
  await watch.dispose()

  const button = page.locator('.shortsActionRail').getByRole('button', { name: /^Add to Playlist$/i })
  const picker = page.locator('.addToPlaylistDropdown')
  for (const { width, height, zoom } of [
    { width: 1500, height: 850, zoom: 1 },
    { width: 1100, height: 800, zoom: 0.95 },
    { width: 1600, height: 1000, zoom: 1.25 },
  ]) {
    await setWindowSize(app, page, { width, height })
    await page.evaluate(factor => window.ftElectron.setZoomFactor(factor), zoom)
    await button.click()
    await expect(picker).toBeVisible()

    const row = picker.getByRole('option').first()
    await expect.poll(() => row.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const player = document.querySelector('.ftVideoPlayer.shortsPlayer').getBoundingClientRect()
      const x = Math.max(bounds.left, player.left) + 8
      const y = bounds.top + bounds.height / 2
      return x < Math.min(bounds.right, player.right) &&
        y >= player.top && y <= player.bottom &&
        element.contains(document.elementFromPoint(x, y))
    }), { message: 'playlist row must receive clicks where it overlaps the Shorts player' }).toBe(true)

    if (zoom === 1) {
      await page.screenshot({ path: testInfo.outputPath('shorts-playlist-popover.png') })
    }
    await row.click()
    await expect(row).toHaveAttribute('aria-selected', 'true')
    await row.click()
    await expect(row).toHaveAttribute('aria-selected', 'false')
    await page.locator('.iconDropdown').focus()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(button).toBeFocused()
  }
})
