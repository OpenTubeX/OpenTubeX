import { clickInFullscreen, setPlayerFullscreen, setWindowSize, test, expect } from '../../helpers/app.mjs'
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

const showAddToPlaylistPrompt = page => page.evaluate(() => window.$store.dispatch('showAddToPlaylistPromptForManyVideos', {
  videos: [{ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', lengthSeconds: 19 }]
}))

test('closes a prompt opened in player fullscreen when Escape exits fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  await showAddToPlaylistPrompt(page)
  await expect(page.locator(':fullscreen .prompt')).toBeVisible()

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.prompt')).toHaveCount(0)
  await expect(page.locator('.app')).not.toHaveAttribute('inert')
})

test('keeps the prompt behind a nested prompt open when Escape exits player fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  await showAddToPlaylistPrompt(page)
  const addPrompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  await clickInFullscreen(addPrompt.getByRole('button', { name: 'Create new Playlist', exact: true }))
  await expect(page.locator(':fullscreen .prompt')).toHaveCount(2)

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.prompt')).toHaveCount(1)
  await expect(page.locator('.app > .prompt:not([inert])')).toHaveCount(1)
  await expect(addPrompt).toBeVisible()
  await addPrompt.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(addPrompt).toHaveCount(0)
})

test('moves a busy prompt out of player fullscreen when Escape exits it', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  await page.evaluate(() => window.dispatchEvent(new Event('opentubex:open-tab-organizer')))
  await clickInFullscreen(page.locator(':fullscreen .tabOrganizerBackdrop').getByRole('button', { name: 'Create Group', exact: true }))
  const groupPrompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
  // The textbox is in player fullscreen, see clickInFullscreen.
  await groupPrompt.getByRole('textbox').fill('Research', { force: true })
  // Hold group creation open so the prompt stays busy.
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('tabs-create-group')
    ipcMain.handle('tabs-create-group', () => new Promise(resolve => { globalThis.__e2eFinishCreateGroup = resolve }))
  })
  await clickInFullscreen(groupPrompt.getByRole('button', { name: 'Create Group', exact: true }))
  await expect(page.locator(':fullscreen .prompt .promptCard[inert]')).toHaveCount(1)

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.app > .prompt')).toHaveCount(1)
  await expect(groupPrompt).toBeVisible()
  await app.electronApp.evaluate(() => globalThis.__e2eFinishCreateGroup(null))
})

// Entering fullscreen can blur the focused button before fullscreenchange.
test('moves an open prompt into player fullscreen after its focus was lost', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await showAddToPlaylistPrompt(page)
  const addPrompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  const cancel = addPrompt.getByRole('button', { name: 'Cancel', exact: true })
  await cancel.focus()
  await cancel.blur()
  await page.keyboard.press('f')

  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.matches('.ftVideoPlayer'))).toBe(true)
  await expect(page.locator(':fullscreen .prompt')).toHaveCount(1)
  await expect(addPrompt).toBeVisible()
  await expect(cancel).toBeFocused()
})

test('keeps a prompt open behind a modal sheet when Escape exits player fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 800 })
  await setPlayerFullscreen(page, true)

  await showAddToPlaylistPrompt(page)
  const addPrompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  await clickInFullscreen(addPrompt.locator('.sortSelect').getByRole('combobox'))
  await expect(page.locator(':fullscreen dialog:modal')).toHaveCount(1)

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.app > .prompt')).toHaveCount(1)
  await expect(addPrompt).toBeVisible()
})
