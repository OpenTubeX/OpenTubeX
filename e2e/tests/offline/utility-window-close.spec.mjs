import { test, expect } from '../../helpers/app.mjs'

for (const { width, height, uiScale } of [
  { width: 1600, height: 900, uiScale: 100 },
  { width: 1600, height: 900, uiScale: 125 },
  { width: 375, height: 800, uiScale: 100 },
  { width: 800, height: 375, uiScale: 125 }
]) {
  test.describe(`utility window dismissal at ${width}×${height}, ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { currentLocale: 'en-US', reducedMotion: 'off', uiScale } } })

    test('closes without rebuilding hidden content or staging transition styles', async ({ page }) => {
      await page.setViewportSize({ width, height })
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })

      for (const view of [null, 'about', 'downloads']) {
        await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', view), view)
        const dialog = page.locator('.settingsWindow')
        await expect(dialog).toBeVisible()
        await expect(dialog).not.toHaveClass(/settings-window-enter-active/)

        const changes = await page.evaluate(async () => {
          const dialog = document.querySelector('.settingsWindow')
          const addedContent = []
          const transitionClasses = []
          const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
              if (mutation.type === 'childList') addedContent.push(...mutation.addedNodes)
              if (mutation.type === 'attributes' && mutation.target === dialog) {
                transitionClasses.push(mutation.oldValue)
              }
            }
          })
          observer.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
          document.querySelector('.settingsCloseButton').click()
          await Promise.resolve()
          const closeAnimations = dialog.getAnimations().filter(animation => animation.animationName?.startsWith('settings-window-leave'))
          await new Promise(resolve => {
            function frame() {
              if (!dialog.isConnected) resolve()
              else requestAnimationFrame(frame)
            }
            requestAnimationFrame(frame)
          })
          observer.disconnect()
          return { addedContent: addedContent.length, transitionClasses, closeAnimations: closeAnimations.length }
        })

        await expect(dialog).toHaveCount(0)
        expect.soft(changes.addedContent, `${view ?? 'settings'} rebuilt hidden content`).toBe(0)
        expect.soft(changes.transitionClasses.join(' ')).not.toMatch(/settings-window-leave-(from|to)/)
        expect(changes.closeAnimations).toBe(1)
        // Reopening selects the requested view even though the closed view stays cached.
        await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
        await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
      }
    })
  })
}

test('reopening a cached utility window cancels its close animation', async ({ page }) => {
  for (const view of [null, 'about', 'downloads']) {
    await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', view), view)
    const dialog = page.locator('.settingsWindow')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
    await page.evaluate(async view => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'about'))
  await expect(page.getByRole('dialog', { name: 'About', exact: true })).toBeVisible()
  await page.locator('.settingsCloseButton').click()
  await expect(page.locator('.settingsWindow')).toHaveCount(0)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showKeyboardShortcutPrompt'))
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
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'downloads'))
  await expect(dialog).toContainText('Initial download history')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'downloads'))
  await expect(dialog).toContainText('Updated download history')
})

for (const prompt of ['Add download', 'Download options', 'Remove file']) {
  test(`closing cached Downloads also dismisses its ${prompt} prompt`, async ({ page }) => {
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'downloads'))
    const dialog = page.getByRole('dialog', { name: 'Downloads', exact: true })
    const originalOverflow = await page.evaluate(() => document.documentElement.style.overflow)
    if (prompt === 'Remove file') {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('upsertYtDlpDownload', {
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
    await expect(page.locator('.prompt')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.isAnyPromptOpen)).toBe(true)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('hideSettingsWindow'))
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.prompt')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.isAnyPromptOpen)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe(originalOverflow)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', 'downloads'))
    await expect(dialog).toBeVisible()
    await expect(page.locator('.prompt')).toHaveCount(0)
  })
}

test.describe('with reduced motion', () => {
  test.use({ seed: { settings: { reducedMotion: 'on' } } })

  test('dismisses utility windows without animating', async ({ page }) => {
    for (const view of [null, 'about', 'downloads']) {
      await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', view), view)
      const dialog = page.locator('.settingsWindow')
      await expect(dialog).toBeVisible()
      const animationNames = await dialog.evaluate(async element => {
        element.querySelector('.settingsCloseButton').click()
        await Promise.resolve()
        return element.getAnimations().map(animation => animation.animationName)
      })
      expect(animationNames).toEqual([])
      await expect(dialog).toHaveCount(0)
    }
  })
})
