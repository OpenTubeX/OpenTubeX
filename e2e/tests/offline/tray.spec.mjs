import { test, expect, goToSettingsSection, openNewWindowFromTabBar, waitForAppReady } from '../../helpers/app.mjs'

async function setting(page, name, value) {
  await page.evaluate(async ({ name, value }) => {
    await window.$store.dispatch(name, value)
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

test('the system tray menu keeps hiding windows tied to its icon and background refresh forces the icon', async ({ app, page }) => {
  await captureTray(app, page)
  const general = await goToSettingsSection(page, 'general')
  const tray = general.getByRole('combobox', { name: 'System tray' })
  const option = name => page.getByRole('option', { name, exact: true })
  const traySettings = () => page.evaluate(() => {
    const { getters } = window.$store
    return [getters.getUseTrayIcon, getters.getHideToTrayOnClose, getters.getHideToTrayOnMinimize]
  })
  const trayDestroyed = () => app.electronApp.evaluate(() => globalThis.testTray.isDestroyed())
  const requiredTooltip = general.getByRole('button', { name: 'The tray icon is required while background subscription refresh is enabled.', exact: true })

  await tray.click()
  await expect(requiredTooltip).toHaveCount(0)

  // Turning the icon off stops hiding windows to the tray.
  await option('Close to tray').click()
  await expect.poll(traySettings).toEqual([true, true, false])
  await option('Show icon').click()
  await expect.poll(traySettings).toEqual([false, false, false])
  await expect(option('Close to tray')).toHaveAttribute('aria-selected', 'false')
  await expect.poll(trayDestroyed).toBe(true)

  // Hiding windows to the tray turns the icon back on.
  await option('Minimize to tray').click()
  await expect.poll(traySettings).toEqual([true, false, true])
  await expect(option('Show icon')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(trayDestroyed).toBe(false)
  await option('Show icon').click()
  await expect.poll(traySettings).toEqual([false, false, false])
  await page.keyboard.press('Escape')

  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', true)
  await expect(requiredTooltip).toBeVisible()
  await expect.poll(trayDestroyed).toBe(false)
  await tray.click()
  await expect(option('Show icon')).toHaveAttribute('aria-selected', 'true')
  await option('Show icon').click()
  await expect(option('Show icon')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(traySettings).toEqual([false, false, false])
  await page.keyboard.press('Escape')

  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', false)
  await expect(requiredTooltip).toHaveCount(0)
  await expect.poll(trayDestroyed).toBe(true)
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
  const tabs = await page.evaluate(() => window.$store.state.tabs.tabs.map(tab => tab.id))
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => windowVisible(app)).toBe(false)
  expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await trayClick(app)
  await expect.poll(() => windowVisible(app)).toBe(true)
  expect(await page.evaluate(() => window.$store.state.tabs.tabs.map(tab => tab.id))).toEqual(tabs)
  await trayClick(app)
  const closed = app.electronApp.waitForEvent('close')
  await app.electronApp.evaluate(() => globalThis.testTrayMenu.items.find(item => item.label === 'Quit').click())
  await closed
})

test('closing the last window confirms quitting when close-to-tray is disabled', async ({ app, page }) => {
  await page.locator('.newTabButton').click()
  await setting(page, 'updateConfirmCloseApp', true)
  await setting(page, 'updateConfirmCloseWindowWithMultipleTabs', true)
  await setting(page, 'updateHideToTrayOnClose', false)
  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', true)
  await app.electronApp.evaluate(({ dialog }) => {
    globalThis.testClosePrompts = []
    globalThis.testClosePromptResolvers = []
    dialog.showMessageBox = (_window, options) => new Promise(resolve => {
      globalThis.testClosePrompts.push({
        message: options.message,
        detail: options.detail,
        buttons: options.buttons
      })
      globalThis.testClosePromptResolvers.push(response => resolve({ response }))
    })
  })

  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())

  await expect.poll(() => app.electronApp.evaluate(() => globalThis.testClosePrompts)).toEqual([{
    message: 'Are you sure you want to quit OpenTubeX?',
    detail: 'Quitting will stop background subscription refreshes.\n\nYou can re-enable this confirmation in Settings → General → Confirm before…',
    buttons: ['Quit', 'Hide Window', 'Cancel', 'Never ask again']
  }])
  await app.electronApp.evaluate(() => globalThis.testClosePromptResolvers[0](1))
  await expect.poll(() => windowVisible(app)).toBe(false)

  const closed = app.electronApp.waitForEvent('close')
  await app.electronApp.evaluate(({ app }) => app.exit())
  await closed
})

test('closing the last window hides it while background refresh runs without a close prompt', async ({ app, page }) => {
  await captureTray(app, page)
  await setting(page, 'updateConfirmCloseApp', false)
  await setting(page, 'updateHideToTrayOnClose', false)
  await setting(page, 'updateConfirmCloseWindowWithMultipleTabs', false)
  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', true)

  // Other windows still close.
  const secondWindow = await openNewWindowFromTabBar(app, page)
  await waitForAppReady(secondWindow)
  await secondWindow.locator('.newTabButton').click()
  await expect.poll(() => secondWindow.evaluate(async () => (
    (await window.ftElectron.tabs.getState()).tabs.length
  ))).toBe(2)
  const secondClosed = secondWindow.waitForEvent('close')
  await secondWindow.evaluate(() => window.close())
  await secondClosed
  await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => windowVisible(app)).toBe(false)
  expect(await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  // Clicking the macOS Dock icon brings the hidden window back.
  await app.electronApp.evaluate(({ app }) => app.emit('activate', {}, false))
  await expect.poll(() => windowVisible(app)).toBe(true)

  // An explicit tray Close still quits.
  const closed = app.electronApp.waitForEvent('close')
  await app.electronApp.evaluate(() => globalThis.testTrayMenu.items[0].submenu.items.find(item => item.label === 'Close').click())
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
    const store = window.$store
    window.ftElectron.tabs.close(store.state.tabs.tabs[0].id)
  })
  await closed
})

test('closing the final tab still exits while background refresh runs without a close prompt', async ({ app, page }) => {
  await setting(page, 'updateConfirmCloseApp', false)
  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', true)
  const closed = app.electronApp.waitForEvent('close')
  // The app menu closes the emptied window without marking it confirmed.
  await app.electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu().items
      .flatMap(menuItem => menuItem.submenu?.items ?? [])
      .find(menuItem => menuItem.label === 'Close Tab')
    item.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await closed
})

test('closing the final tab offers Hide Window and Quit exits while background refresh runs', async ({ app, page }) => {
  await setting(page, 'updateConfirmCloseApp', true)
  await setting(page, 'updateEnableClosedAppSubscriptionRefresh', true)
  await app.electronApp.evaluate(({ dialog }) => {
    // Hide Window, then Quit
    globalThis.testCloseResponses = [1, 0]
    dialog.showMessageBox = async () => ({ response: globalThis.testCloseResponses.shift() })
  })
  const tabs = await page.evaluate(() => window.$store.state.tabs.tabs.map(tab => tab.id))
  const closeTab = () => page.evaluate(() => {
    window.ftElectron.tabs.close(window.$store.state.tabs.tabs[0].id)
  })

  // Hide Window keeps the tab
  await closeTab()
  await expect.poll(() => windowVisible(app)).toBe(false)
  expect(await page.evaluate(() => window.$store.state.tabs.tabs.map(tab => tab.id))).toEqual(tabs)
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
    // An auxiliary window, such as GPU Internals, does not keep the app running
    globalThis.testAuxiliaryWindow = new BrowserWindow({ show: false })
  })

  // Quit exits instead of leaving the app in the tray without a window
  const closed = app.electronApp.waitForEvent('close')
  await closeTab()
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
