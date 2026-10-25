import { dialog, ipcMain } from 'electron'

import { IpcChannels, MULTIPLE_TABS_CONFIRM_THRESHOLD } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { createMainTranslator } from './mainTranslator'

const DEFAULT_CONFIRM_CLOSE_APP = true
const DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS = true
const MULTIPLE_TABS_CONFIRMATION_SETTING_KEYS = {
  close: 'confirmCloseMultipleTabs',
  load: 'confirmLoadMultipleTabs',
  unload: 'confirmUnloadMultipleTabs'
}

async function getConfirmCloseApp() {
  try {
    const value = (await baseHandlers.settings._findOne('confirmCloseApp'))?.value
    return typeof value === 'boolean' ? value : DEFAULT_CONFIRM_CLOSE_APP
  } catch (error) {
    console.error('Failed to load close confirmation preference:', error)
    return DEFAULT_CONFIRM_CLOSE_APP
  }
}

async function getConfirmCloseWindowWithMultipleTabs() {
  try {
    const value = (await baseHandlers.settings._findOne('confirmCloseWindowWithMultipleTabs'))?.value
    return typeof value === 'boolean' ? value : DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS
  } catch (error) {
    console.error('Failed to load window close confirmation preference:', error)
    return DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS
  }
}

/**
 * @param {'close' | 'load' | 'unload'} action
 * @returns {Promise<boolean>}
 */
async function getConfirmMultipleTabsAction(action) {
  const settingKey = MULTIPLE_TABS_CONFIRMATION_SETTING_KEYS[action]
  try {
    const value = (await baseHandlers.settings._findOne(settingKey))?.value
    return typeof value === 'boolean' ? value : true
  } catch (error) {
    console.error(`Failed to load ${action} tabs confirmation preference:`, error)
    return true
  }
}

/**
 * Native quit and window close prompts, and the renderer prompt for bulk tab
 * actions. Each prompt is shown once while it is open.
 * @param {object} options
 * @param {() => boolean} options.isQuitting
 * @param {() => boolean} options.isQuitConfirmed
 * @param {() => void} options.confirmQuit Skips later quit prompts.
 * @param {(browserWindow: import('electron').BrowserWindow | null | undefined) => void} options.hideWindowToTray
 * @param {(settingKey: string, value: unknown) => Promise<void>} options.updateSettingFromMain
 */
export function createConfirmations({ isQuitting, isQuitConfirmed, confirmQuit, hideWindowToTray, updateSettingFromMain }) {
  let quitPromptInProgress = null
  const windowClosePromptsInProgress = new Map()
  let multipleTabsActionRequestCount = 0

  /**
   * @param {import('electron').BrowserWindow | null | undefined} browserWindow
   * @param {boolean} [allowHideWindow]
   * @param {boolean} [hideWithoutPrompt] Hide the window instead of quitting when the user skips the prompt.
   * @returns {Promise<boolean>}
   */
  async function confirmCloseApp(browserWindow, allowHideWindow = false, hideWithoutPrompt = false) {
    if (isQuitting() || isQuitConfirmed()) {
      return true
    }

    if (!await getConfirmCloseApp()) {
      if (!hideWithoutPrompt) return true
      hideWindowToTray(browserWindow)
      return false
    }

    if (quitPromptInProgress) {
      return quitPromptInProgress
    }

    quitPromptInProgress = (async () => {
      const t = await createMainTranslator()
      const buttons = allowHideWindow
        ? [
            t('Close Confirmation.Quit'),
            t('Close Confirmation.Hide Window'),
            t('Cancel'),
            t('Close Confirmation.Never Ask Again')
          ]
        : [
            t('Close Confirmation.Quit'),
            t('Cancel'),
            t('Close Confirmation.Never Ask Again')
          ]
      const { response } = await dialog.showMessageBox(browserWindow ?? undefined, {
        type: 'question',
        title: t('Close Confirmation.Title'),
        message: t('Close Confirmation.Message'),
        detail: allowHideWindow
          ? `${t('Close Confirmation.Background Sync Warning')}\n\n${t('Confirmations.Settings Hint')}`
          : t('Confirmations.Settings Hint'),
        buttons,
        defaultId: 1,
        cancelId: allowHideWindow ? 2 : 1,
        noLink: true
      })

      if (allowHideWindow && response === 1) {
        hideWindowToTray(browserWindow)
        return false
      }

      if (response === (allowHideWindow ? 3 : 2)) {
        try {
          await updateSettingFromMain('confirmCloseApp', false)
        } catch (error) {
          console.error('Failed to disable the app close confirmation:', error)
        }
        if (hideWithoutPrompt) {
          hideWindowToTray(browserWindow)
          return false
        }
        confirmQuit()
        return true
      }

      if (response === 0) {
        confirmQuit()
        return true
      }

      return false
    })().finally(() => {
      quitPromptInProgress = null
    })

    return quitPromptInProgress
  }

  /**
   * @param {import('electron').BrowserWindow} browserWindow
   * @param {number} count
   * @returns {Promise<boolean>}
   */
  async function confirmCloseWindowWithMultipleTabs(browserWindow, count) {
    if (isQuitting() || !await getConfirmCloseWindowWithMultipleTabs()) {
      return true
    }

    const existingPrompt = windowClosePromptsInProgress.get(browserWindow.id)
    if (existingPrompt) return existingPrompt

    const prompt = (async () => {
      const t = await createMainTranslator()
      const { response } = await dialog.showMessageBox(browserWindow, {
        type: 'question',
        title: t('Close Window Confirmation.Title'),
        message: t('Close Window Confirmation.Message', { count }, count),
        detail: t('Confirmations.Settings Hint'),
        buttons: [
          t('Close Window Confirmation.Close Window'),
          t('Cancel'),
          t('Confirmations.Never Ask Again')
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })

      if (response === 2) {
        try {
          await updateSettingFromMain('confirmCloseWindowWithMultipleTabs', false)
        } catch (error) {
          console.error('Failed to disable the multi-tab window close confirmation:', error)
        }
        return true
      }

      return response === 0
    })().finally(() => {
      windowClosePromptsInProgress.delete(browserWindow.id)
    })

    windowClosePromptsInProgress.set(browserWindow.id, prompt)
    return prompt
  }

  /**
   * Ask the renderer to confirm a bulk tab action.
   * @param {import('./tabs/TabManager').TabManager | null | undefined} manager
   * @param {number} count the number of tabs affected
   * @param {'close' | 'load' | 'unload'} action
   * @returns {Promise<boolean>}
   */
  async function confirmMultipleTabsAction(manager, count, action) {
    if (count < MULTIPLE_TABS_CONFIRM_THRESHOLD || !await getConfirmMultipleTabsAction(action)) {
      return true
    }

    const browserWindow = manager?.browserWindow
    if (!browserWindow || browserWindow.isDestroyed()) {
      return true
    }

    const requestId = `${action}-multiple-tabs-${++multipleTabsActionRequestCount}`
    return new Promise(resolve => {
      /**
       * @param {import('electron').IpcMainEvent} _event
       * @param {{ requestId?: string, confirmed?: boolean }} response
       */
      const listener = (_event, response) => {
        if (response?.requestId !== requestId) return

        finish(response.confirmed === true)
      }

      const handleWindowClosed = () => finish(false)

      /**
       * @param {boolean} confirmed
       */
      function finish(confirmed) {
        clearTimeout(timeoutId)
        ipcMain.removeListener(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, listener)
        browserWindow.removeListener('closed', handleWindowClosed)
        resolve(confirmed)
      }

      const timeoutId = setTimeout(() => finish(false), 30_000)
      ipcMain.on(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, listener)
      browserWindow.once('closed', handleWindowClosed)
      manager.bridge.send(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION, { requestId, count, action })
    })
  }

  return { confirmCloseApp, confirmCloseWindowWithMultipleTabs, confirmMultipleTabsAction }
}
