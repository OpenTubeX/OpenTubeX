import { test, expect, waitForAppReady } from '../../helpers/app.mjs'

test('the new window button opens a second working window', async ({ app, page }) => {
  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    page.locator('.topNav .navNewWindowButton').click()
  ])

  await waitForAppReady(newWindow)

  // Both windows stay usable and navigate independently.
  await newWindow.locator('.sideNav a[href="#/history"]:visible').first().click()
  await expect(newWindow).toHaveURL(/#\/history/)
  await expect(page).not.toHaveURL(/#\/history/)
})

async function openSecondWindowWithTwoTabs(app, page) {
  const existingWindowIds = await app.electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().map(window => window.id)
  ))
  const [newWindow] = await Promise.all([
    app.electronApp.waitForEvent('window'),
    page.locator('.topNav .navNewWindowButton').click()
  ])
  await waitForAppReady(newWindow)
  await newWindow.locator('.newTabButton').click()

  const windowId = await app.electronApp.evaluate(({ BrowserWindow }, knownIds) => (
    BrowserWindow.getAllWindows().find(window => !knownIds.includes(window.id))?.id
  ), existingWindowIds)
  if (windowId == null) throw new Error('New browser window was not found')

  return { newWindow, windowId }
}

test.describe('multi-tab window close confirmation', () => {
  test.use({ seed: { settings: { confirmCloseWindowWithMultipleTabs: true } } })

  test('can cancel or disable closing confirmation for a window with multiple tabs', async ({ app, page }) => {
    const { newWindow, windowId } = await openSecondWindowWithTwoTabs(app, page)

    await app.electronApp.evaluate(({ dialog }) => {
      globalThis.windowCloseDialogResponse = 1
      globalThis.windowCloseDialogs = []
      dialog.showMessageBox = async (_window, options) => {
        globalThis.windowCloseDialogs.push({
          message: options.message,
          detail: options.detail,
          buttons: options.buttons
        })
        return { response: globalThis.windowCloseDialogResponse }
      }
    })

    await app.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), windowId)
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.windowCloseDialogs)).toEqual([{
      message: 'This window contains 2 tabs. Are you sure you want to close it?',
      detail: 'You can re-enable this confirmation in Settings → General → Confirm before…',
      buttons: ['Close Window', 'Cancel', 'Never ask again']
    }])
    expect(newWindow.isClosed()).toBe(false)

    const closed = newWindow.waitForEvent('close')
    await app.electronApp.evaluate(({ BrowserWindow }, id) => {
      globalThis.windowCloseDialogResponse = 2
      BrowserWindow.fromId(id)?.close()
    }, windowId)
    await closed
    await expect.poll(() => page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      return store.getters.getConfirmCloseWindowWithMultipleTabs
    })).toBe(false)
  })
})

test('can disable the multi-tab window close confirmation', async ({ app, page }) => {
  const { newWindow, windowId } = await openSecondWindowWithTwoTabs(app, page)

  await app.electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      throw new Error('Window close confirmation should be disabled')
    }
  })
  const closed = newWindow.waitForEvent('close')
  await app.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), windowId)
  await closed
})
