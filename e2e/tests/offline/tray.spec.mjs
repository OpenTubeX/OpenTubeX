import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

async function setting(page, name, value) {
  await page.evaluate(async ({ name, value }) => {
    await document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(name, value)
  }, { name, value })
}

async function captureTray(app, page) {
  await app.electronApp.evaluate(({ Tray }) => {
    const original = Tray.prototype.setContextMenu
    Tray.prototype.setContextMenu = function(menu) {
      globalThis.testTray = this
      globalThis.testTrayMenu = menu
      return original.call(this, menu)
    }
  })
  // Changing the media controls rebuilds the existing tray menu without replacing the icon.
  await page.evaluate(() => window.ftElectron.tabs.setMediaSessionState({
    playbackState: 'paused',
    hasMetadata: true,
    actions: ['play']
  }))
  await expect.poll(() => app.electronApp.evaluate(() => !!globalThis.testTray)).toBe(true)
}

async function windowVisible(app) {
  return app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
}

async function trayClick(app) {
  await app.electronApp.evaluate(() => globalThis.testTray.emit('click'))
}

test('tray settings default independently and background refresh forces the tray', async ({ app, page }) => {
  await captureTray(app, page)
  const general = await goToSettingsSection(page, 'general')
  const useTray = general.getByRole('checkbox', { name: /^Use tray icon/ })
  const closeToTray = general.getByRole('checkbox', { name: /^Close to system tray/ })
  const minimizeToTray = general.getByRole('checkbox', { name: /Minimi[sz]e to system tray/ })
  await expect(useTray).toBeChecked()
  await expect(general.getByRole('button', { name: 'The tray icon is required while background subscription refresh is enabled.', exact: true })).toHaveCount(0)
  await expect(closeToTray).not.toBeChecked()
  await expect(minimizeToTray).not.toBeChecked()
  await setting(page, 'updateUseTrayIcon', false)
  await expect(useTray).not.toBeChecked()
  await expect(closeToTray).toBeDisabled()
  await expect(minimizeToTray).toBeDisabled()
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.testTray.isDestroyed())).toBe(true)
  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', true)
  await expect(useTray).toBeChecked()
  await expect(useTray).toBeDisabled()
  await expect(general.getByRole('button', { name: 'The tray icon is required while background subscription refresh is enabled.', exact: true })).toBeVisible()
  await expect(closeToTray).toBeEnabled()
  await expect.poll(() => app.electronApp.evaluate(() => !globalThis.testTray.isDestroyed())).toBe(true)
  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', false)
  await expect(useTray).not.toBeChecked()
  await expect(useTray).toBeEnabled()
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.testTray.isDestroyed())).toBe(true)
})

test('left click toggles the window and disabling the tray restores it', async ({ app, page }) => {
  await captureTray(app, page)
  await trayClick(app)
  await expect.poll(() => windowVisible(app)).toBe(false)
  await trayClick(app)
  await expect.poll(() => windowVisible(app)).toBe(true)
  await trayClick(app)
  await setting(page, 'updateUseTrayIcon', false)
  await expect.poll(() => windowVisible(app)).toBe(true)
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.testTray.isDestroyed())).toBe(true)
})

test('close-to-tray preserves tabs and Quit exits hidden windows', async ({ app, page }) => {
  await captureTray(app, page)
  await setting(page, 'updateHideToTrayOnClose', true)
  const tabs = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.tabs.tabs.map(tab => tab.id))
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => windowVisible(app)).toBe(false)
  expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await trayClick(app)
  await expect.poll(() => windowVisible(app)).toBe(true)
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.tabs.tabs.map(tab => tab.id))).toEqual(tabs)
  await trayClick(app)
  const closed = app.electronApp.waitForEvent('close')
  await app.electronApp.evaluate(() => globalThis.testTrayMenu.items.find(item => item.label === 'Quit').click())
  await closed
})

test('native minimize hides to tray and the tray restores the window', async ({ app, page }) => {
  await captureTray(app, page)
  await setting(page, 'updateHideToTrayOnMinimize', true)
  // Xvfb has no window manager; emit the native notification Electron delivers
  // after a minimize. KWin detection and its callback are covered by unit tests.
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('minimize'))
  await expect.poll(() => windowVisible(app)).toBe(false)
  await trayClick(app)
  await expect.poll(() => windowVisible(app)).toBe(true)
})

test('tray media actions update with playback and reach the media coordinator', async ({ app, page }) => {
  await captureTray(app, page)
  await page.evaluate(() => window.ftElectron.tabs.setMediaSessionState({ playbackState: 'playing', hasMetadata: true, actions: ['pause', 'nexttrack'] }))
  const controls = () => app.electronApp.evaluate(() => globalThis.testTrayMenu.items.filter(item => ['Previous', 'Play', 'Pause', 'Next'].includes(item.label)).map(item => ({ label: item.label, enabled: item.enabled })))
  await expect.poll(controls).toEqual([{ label: 'Previous', enabled: false }, { label: 'Pause', enabled: true }, { label: 'Next', enabled: true }])
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    const webContents = BrowserWindow.getAllWindows()[0].webContents
    const original = webContents.send.bind(webContents)
    globalThis.testMediaActions = []
    webContents.send = (channel, ...args) => {
      if (channel === 'tabs-request-media-session-action') globalThis.testMediaActions.push(args[0])
      return original(channel, ...args)
    }
    globalThis.testTrayMenu.items.find(item => item.label === 'Pause').click()
    globalThis.testTrayMenu.items.find(item => item.label === 'Next').click()
  })
  expect(await app.electronApp.evaluate(() => globalThis.testMediaActions)).toEqual(['pause', 'nexttrack'])
  await page.evaluate(() => window.ftElectron.tabs.setMediaSessionState({ playbackState: 'paused', hasMetadata: true, actions: ['play'] }))
  await expect.poll(controls).toEqual([{ label: 'Previous', enabled: false }, { label: 'Play', enabled: true }, { label: 'Next', enabled: false }])
})

test('closing the final tab still exits with close-to-tray enabled', async ({ app, page }) => {
  await setting(page, 'updateHideToTrayOnClose', true)
  const closed = app.electronApp.waitForEvent('close')
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.ftElectron.tabs.close(store.state.tabs.tabs[0].id)
  })
  await closed
})

test('explicit tray Close closes the window even with close-to-tray enabled', async ({ app, page }) => {
  await captureTray(app, page)
  await setting(page, 'updateHideToTrayOnClose', true)
  await trayClick(app)
  const closed = app.electronApp.waitForEvent('close')
  await app.electronApp.evaluate(() => globalThis.testTrayMenu.items[0].submenu.items.find(item => item.label === 'Close').click())
  await closed
})

test('cancelling explicit tray Close restores normal close-to-tray behavior', async ({ app, page }) => {
  await captureTray(app, page)
  await setting(page, 'updateHideToTrayOnClose', true)
  await setting(page, 'updateConfirmCloseApp', true)
  await app.electronApp.evaluate(({ dialog }) => {
    globalThis.testClosePrompts = 0
    dialog.showMessageBox = async () => {
      globalThis.testClosePrompts++
      return { response: 1 }
    }
    globalThis.testTrayMenu.items[0].submenu.items.find(item => item.label === 'Close').click()
  })
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.testClosePrompts)).toBe(1)
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => windowVisible(app)).toBe(false)
  expect(await app.electronApp.evaluate(() => globalThis.testClosePrompts)).toBe(1)
  await setting(page, 'updateConfirmCloseApp', false)
})
