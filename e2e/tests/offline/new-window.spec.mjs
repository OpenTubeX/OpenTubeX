import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { openNewWindowFromTabBar, test, expect, waitForAppReady } from '../../helpers/app.mjs'

test('new windows move from the app header to the tab bar context menu', async ({ app, page }) => {
  await expect(page.locator('.topNav .navNewWindowButton')).toHaveCount(0)

  const newWindowMenuItem = page.getByRole('menuitem', { name: 'New Window', exact: true })
  await page.locator('.newTabButton').click({ button: 'right' })
  await expect(newWindowMenuItem).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(newWindowMenuItem).toBeHidden()

  const viewportBounds = await page.locator('.tabsViewport').boundingBox()
  if (!viewportBounds) throw new Error('Tab viewport was not found')
  const newWindowPromise = app.electronApp.waitForEvent('window')
  await page.mouse.click(
    viewportBounds.x + viewportBounds.width - 4,
    viewportBounds.y + viewportBounds.height / 2,
    { button: 'right' }
  )
  await newWindowMenuItem.click()
  const newWindow = await newWindowPromise

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
  const newWindow = await openNewWindowFromTabBar(app, page)
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

  test.describe('with app close confirmation enabled', () => {
    test.use({
      seed: {
        settings: {
          confirmCloseApp: true,
          confirmCloseWindowWithMultipleTabs: true
        }
      }
    })

    test('preserves the session if the window becomes last while confirming', async ({ app, page }) => {
      const { newWindow, windowId, primaryWindowId } = await openSecondWindowWithTwoTabs(app, page)

      await app.electronApp.evaluate(({ dialog }) => {
        globalThis.windowCloseDialogMessages = []
        globalThis.windowCloseDialogResolvers = []
        dialog.showMessageBox = async (_window, options) => new Promise(resolve => {
          globalThis.windowCloseDialogMessages.push(options.message)
          globalThis.windowCloseDialogResolvers.push(response => resolve({ response }))
        })
      })

      await app.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), windowId)
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.windowCloseDialogMessages)).toEqual([
        'This window contains 2 tabs. Are you sure you want to close it?'
      ])

      const primaryClosed = page.waitForEvent('close')
      await app.electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), primaryWindowId)

      await app.electronApp.evaluate(() => globalThis.windowCloseDialogResolvers[0](0))
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.windowCloseDialogMessages)).toEqual([
        'This window contains 2 tabs. Are you sure you want to close it?',
        'Are you sure you want to quit OpenTubeX?'
      ])
      await primaryClosed

      const secondaryClosed = newWindow.waitForEvent('close')
      await app.electronApp.evaluate(() => globalThis.windowCloseDialogResolvers[1](0))
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

  test('confirms when the renderer closes every tab in a multi-tab window', async ({ app, page }) => {
    const { newWindow } = await openSecondWindowWithTwoTabs(app, page)

    await app.electronApp.evaluate(({ dialog }) => {
      globalThis.windowCloseDialogs = []
      dialog.showMessageBox = async (_window, options) => {
        globalThis.windowCloseDialogs.push(options.message)
        return { response: 1 }
      }
    })

    const result = await newWindow.evaluate(async () => {
      const state = await window.ftElectron.tabs.getState()
      return await window.ftElectron.tabs.closeMultiple(state.tabs.map(tab => tab.id))
    })

    expect(result).toEqual({ hasRemainingTabs: true })
    await expect.poll(() => app.electronApp.evaluate(() => globalThis.windowCloseDialogs)).toEqual([
      'This window contains 2 tabs. Are you sure you want to close it?'
    ])
    expect(newWindow.isClosed()).toBe(false)
  })
})

test.describe('disabled multi-tab window close confirmation', () => {
  test.use({ seed: { settings: { confirmCloseWindowWithMultipleTabs: false } } })

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
})
