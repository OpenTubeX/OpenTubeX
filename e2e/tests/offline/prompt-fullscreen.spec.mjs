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

const showAddToPlaylistPrompt = page => page.evaluate(() => window.$store.dispatch('showAddToPlaylistPromptForManyVideos', {
  videos: [{ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', lengthSeconds: 19 }]
}))

const overlays = [
  {
    name: 'prompt',
    open: showAddToPlaylistPrompt,
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

test('keeps the prompt behind a nested prompt open when Escape exits player fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  await showAddToPlaylistPrompt(page)
  const addPrompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  await addPrompt.getByRole('button', { name: 'Create new Playlist', exact: true }).click()
  await expect(page.locator(':fullscreen .prompt')).toHaveCount(2)

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.prompt')).toHaveCount(1)
  await expect(page.locator('.app > .prompt:not([inert])')).toHaveCount(1)
  await expect(addPrompt).toBeVisible()
  await addPrompt.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(addPrompt).toHaveCount(0)
})

test('keeps the Tab Organizer open behind its nested prompt when Escape exits player fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  await page.evaluate(() => window.dispatchEvent(new Event('opentubex:open-tab-organizer')))
  const organizer = page.locator(':fullscreen .tabOrganizerBackdrop')
  await organizer.getByRole('button', { name: 'Create Group', exact: true }).click()
  await expect(page.locator(':fullscreen .prompt')).toHaveCount(1)

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.prompt')).toHaveCount(0)
  await expect(page.locator('.app > .tabOrganizerBackdrop .tabOrganizer:not([inert])')).toBeVisible()
})

test.describe('with external link confirmation', () => {
  test.use({ seed: { settings: { externalLinkHandling: 'openLinkAfterPrompt' } } })

  test('keeps a prompt behind another prompt open when Escape exits player fullscreen', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    await setPlayerFullscreen(page, true)

    await showAddToPlaylistPrompt(page)
    const addPrompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
    await addPrompt.evaluate(element => {
      const link = document.createElement('a')
      link.href = 'https://example.com/'
      link.textContent = 'External link'
      element.append(link)
    })
    await addPrompt.getByRole('link', { name: 'External link' }).click()
    const linkPrompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })
    await expect(linkPrompt).toBeVisible()
    await expect(page.locator(':fullscreen .prompt:not([inert])')).toHaveCount(2)

    await pressBrowserEscape(app, page)

    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
    await expect(linkPrompt).toHaveCount(0)
    await expect(page.locator('.app > .prompt')).toHaveCount(1)
    await expect(addPrompt).toBeVisible()
  })
})

test('moves a busy prompt out of player fullscreen when Escape exits it', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setPlayerFullscreen(page, true)

  await page.evaluate(() => window.dispatchEvent(new Event('opentubex:open-tab-organizer')))
  await page.locator(':fullscreen .tabOrganizerBackdrop').getByRole('button', { name: 'Create Group', exact: true }).click()
  const groupPrompt = page.getByRole('dialog', { name: 'Create Group', exact: true })
  await groupPrompt.getByRole('textbox').fill('Research')
  // Hold group creation open so the prompt stays busy.
  await app.electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('tabs-create-group')
    ipcMain.handle('tabs-create-group', () => new Promise(resolve => { globalThis.__e2eFinishCreateGroup = resolve }))
  })
  await groupPrompt.getByRole('button', { name: 'Create Group', exact: true }).click()
  await expect(page.locator(':fullscreen .prompt .promptCard[inert]')).toHaveCount(1)

  await pressBrowserEscape(app, page)

  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.locator('.app > .prompt')).toHaveCount(1)
  await expect(groupPrompt).toBeVisible()
  await app.electronApp.evaluate(() => globalThis.__e2eFinishCreateGroup(null))
})

test('moves an open prompt into player fullscreen', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)

  await showAddToPlaylistPrompt(page)
  const addPrompt = page.getByRole('dialog', { name: 'Select a playlist to add your video to', exact: true })
  await addPrompt.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('f')

  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.matches('.ftVideoPlayer'))).toBe(true)
  await expect(page.locator(':fullscreen .prompt')).toHaveCount(1)
  await expect(addPrompt).toBeVisible()
})
