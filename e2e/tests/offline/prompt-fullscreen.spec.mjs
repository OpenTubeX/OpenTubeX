import { setPlayerFullscreen, test, expect } from '../../helpers/app.mjs'
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

/**
 * Chromium exits fullscreen on Escape before the page sees the key, but
 * Playwright's key presses skip that browser-side handling.
 */
async function pressBrowserEscape(app, page) {
  await app.electronApp.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  }, page.url())
}

const overlays = [
  {
    name: 'prompt',
    open: page => page.evaluate(() => window.$store.dispatch('showAddToPlaylistPromptForManyVideos', {
      videos: [{ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', lengthSeconds: 19 }]
    })),
    selector: '.prompt',
  },
  {
    name: 'command palette',
    open: page => page.keyboard.press('Control+k'),
    selector: '.commandPaletteBackdrop',
  },
]

for (const overlay of overlays) {
  test(`closes a ${overlay.name} opened in player fullscreen when Escape exits fullscreen`, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)

    await overlay.open(page)
    await expect(page.locator(`:fullscreen ${overlay.selector}`)).toBeVisible()

    await pressBrowserEscape(app, page)

    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(page.locator(overlay.selector)).toHaveCount(0)
    await expect(page.locator('.app')).not.toHaveAttribute('inert')
  })
}
