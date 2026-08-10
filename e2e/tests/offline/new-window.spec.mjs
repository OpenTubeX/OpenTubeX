import { readFile } from 'node:fs/promises'
import path from 'node:path'

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

  return { newWindow, windowId, primaryWindowId: existingWindowIds[0] }
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

  test('preserves the session if the window becomes last while confirming', async ({ app, page }) => {
    const { newWindow, windowId, primaryWindowId } = await openSecondWindowWithTwoTabs(app, page)

    await app.electronApp.evaluate(({ dialog }) => {
      globalThis.windowCloseDialogOpen = false
      dialog.showMessageBox = async () => new Promise(resolve => {
        globalThis.windowCloseDialogOpen = true
        globalThis.resolveWindowCloseDialog = () => resolve({ response: 0 })
      })
    })

    await app.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), windowId)
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.windowCloseDialogOpen)).toBe(true)

    const primaryClosed = page.waitForEvent('close')
    await app.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), primaryWindowId)
    await primaryClosed

    const secondaryClosed = newWindow.waitForEvent('close')
    await app.electronApp.evaluate(() => globalThis.resolveWindowCloseDialog())
    await secondaryClosed

    await expect.poll(async () => {
      const contents = await readFile(path.join(app.userDataDir, 'tab-session.db'), 'utf8')
      const sessions = new Map()
      for (const record of contents.trim().split('\n').map(line => JSON.parse(line))) {
        if (record.$$deleted) sessions.delete(record._id)
        else if (record.value) sessions.set(record._id, record.value)
      }
      return [...sessions.values()].some(session => session.tabs.length === 2)
    }).toBe(true)
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
