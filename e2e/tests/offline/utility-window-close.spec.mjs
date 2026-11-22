import { test, expect } from '../../helpers/app.mjs'

test('reopening a cached utility window cancels its close animation', async ({ page }) => {
  for (const view of [null, 'about', 'downloads']) {
    await page.evaluate(view => window.$store.dispatch('showSettingsWindow', view), view)
    const dialog = page.locator('.settingsWindow')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
    await page.evaluate(async view => {
      const store = window.$store
      await store.dispatch('hideSettingsWindow')
      await store.dispatch('showSettingsWindow', view)
    }, view)
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveClass(/settings-window-(enter|leave)-active/)
    await expect(dialog).toHaveCSS('opacity', '1')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
})

test('opens keyboard shortcuts after closing a cached About window', async ({ page }) => {
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'about'))
  await expect(page.getByRole('dialog', { name: 'About', exact: true })).toBeVisible()
  await page.locator('.settingsCloseButton').click()
  await expect(page.locator('.settingsWindow')).toHaveCount(0)
  await page.evaluate(() => window.$store.dispatch('showKeyboardShortcutPrompt'))
  await expect(page.locator('.shortcutColumns')).toBeVisible()
})

test('refreshes download history when reopening a cached Downloads window', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }) => {
    let requests = 0
    ipcMain.removeHandler('yt-dlp-list-downloads')
    ipcMain.handle('yt-dlp-list-downloads', () => [{
      id: 1,
      title: ++requests === 1 ? 'Initial download history' : 'Updated download history',
      mode: 'video',
      status: 'cancelled',
      destinations: [],
      files: []
    }])
  })
  const dialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'downloads'))
  await expect(dialog).toContainText('Initial download history')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'downloads'))
  await expect(dialog).toContainText('Updated download history')
})

for (const prompt of ['Add download', 'Download options', 'Remove file']) {
  test(`closing cached Downloads also dismisses its ${prompt} prompt`, async ({ page }) => {
    await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'downloads'))
    const dialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
    const originalOverflow = await page.evaluate(() => document.documentElement.style.overflow)
    if (prompt === 'Remove file') {
      await page.evaluate(() => window.$store.commit('upsertYtDlpDownload', {
        id: 1,
        title: 'Completed fixture download',
        mode: 'video',
        status: 'completed',
        destination: '/fixture/video.mp4',
        availability: 'available',
        sizeBytes: 100,
        files: []
      }))
      await dialog.getByTitle('Remove File', { exact: true }).click()
    } else {
      await dialog.getByRole('button', { name: 'Add download', exact: true }).click()
      if (prompt === 'Download options') {
        await page.locator('.prompt input[type="url"]').fill('https://example.com/video')
        await page.locator('.prompt').getByRole('button', { name: 'Next', exact: true }).click()
        await expect(page.locator('.downloadPromptCard')).toBeVisible()
      }
    }
    await expect(page.locator('.prompt:not([inert])')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.$store.getters.isAnyPromptOpen)).toBe(true)
    await page.evaluate(() => window.$store.dispatch('hideSettingsWindow'))
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.prompt')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.$store.getters.isAnyPromptOpen)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe(originalOverflow)
    await page.evaluate(() => window.$store.dispatch('showSettingsWindow', 'downloads'))
    await expect(dialog).toBeVisible()
    await expect(page.locator('.prompt')).toHaveCount(0)
  })
}
