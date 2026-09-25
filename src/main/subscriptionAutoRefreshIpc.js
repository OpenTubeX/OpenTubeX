import { IpcChannels } from '../constants.js'

/**
 * @typedef {{
 *   webContents: import('electron').WebContents,
 *   tabId: string,
 *   feedTab: string | null
 * }} RefreshOwner
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle' | 'on'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   TabManager: typeof import('./tabs/TabManager').TabManager,
 *   getActiveRecovery: () => Promise<unknown> | null,
 *   backgroundSubscriptions: {setBackground: (background: boolean) => Promise<unknown>},
 *   updateBackgroundVisibility: () => void,
 *   getWindows: () => import('electron').BrowserWindow[]
 * }} SubscriptionRefreshDependencies
 */

/** @param {SubscriptionRefreshDependencies} dependencies */
export function registerSubscriptionAutoRefreshIpc({
  ipcMain,
  isTrustedUrl,
  TabManager,
  getActiveRecovery,
  backgroundSubscriptions,
  updateBackgroundVisibility,
  getWindows
}) {
  /** @type {RefreshOwner | null} */
  let subscriptionAutoRefreshOwner = null
  let subscriptionAutoRefreshProgress = 0

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE, async (event, tabId, feedTab) => {
    const canAcquire = () => {
      const manager = TabManager.getFromWebContents(event.sender)
      return manager != null &&
        typeof tabId === 'string' &&
        manager.activeTabId === tabId &&
        !event.sender.isDestroyed() &&
        isTrustedUrl(event.senderFrame.url)
    }

    if (!canAcquire()) {
      return false
    }

    const activeIpBlockRecovery = getActiveRecovery()
    if (activeIpBlockRecovery != null) {
      try {
        await activeIpBlockRecovery
      } catch {
        // Refresh after the recovery attempt finishes, even when it failed.
      }
    }

    if (
      !canAcquire() ||
      (subscriptionAutoRefreshOwner && !subscriptionAutoRefreshOwner.webContents.isDestroyed())
    ) {
      return false
    }

    await backgroundSubscriptions.setBackground(false)
    if (!canAcquire() || isSubscriptionAutoRefreshInProgress()) return false
    const owner = event.sender
    subscriptionAutoRefreshOwner = {
      webContents: owner,
      tabId,
      feedTab: typeof feedTab === 'string' ? feedTab : null
    }
    subscriptionAutoRefreshProgress = 0
    owner.once('destroyed', () => {
      if (subscriptionAutoRefreshOwner?.webContents.id === owner.id) {
        subscriptionAutoRefreshOwner = null
        subscriptionAutoRefreshProgress = 0
        broadcastSubscriptionAutoRefreshState()
      }
    })
    broadcastSubscriptionAutoRefreshState()
    return true
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_GET_STATE, (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return { inProgress: false, percentage: 0, tab: null }
    }

    return {
      inProgress: isSubscriptionAutoRefreshInProgress(),
      percentage: subscriptionAutoRefreshProgress,
      tab: subscriptionAutoRefreshOwner?.feedTab ?? null
    }
  })

  ipcMain.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS, (event, tabId, percentage) => {
    if (
      subscriptionAutoRefreshOwner?.webContents.id !== event.sender.id ||
      subscriptionAutoRefreshOwner?.tabId !== tabId ||
      !Number.isFinite(percentage)
    ) {
      return
    }

    subscriptionAutoRefreshProgress = Math.min(100, Math.max(0, percentage))
    broadcastSubscriptionAutoRefreshState()
  })

  ipcMain.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL, (event) => {
    if (!isTrustedUrl(event.senderFrame.url)) {
      return
    }

    requestSubscriptionAutoRefreshCancellation()
  })

  function isSubscriptionAutoRefreshInProgress() {
    return subscriptionAutoRefreshOwner !== null && !subscriptionAutoRefreshOwner.webContents.isDestroyed()
  }

  // Any window may ask for the cancellation, only the one running the refresh
  // can carry it out
  function requestSubscriptionAutoRefreshCancellation() {
    if (isSubscriptionAutoRefreshInProgress()) {
      subscriptionAutoRefreshOwner.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL)
    }
  }

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE, (event, tabId) => {
    if (
      subscriptionAutoRefreshOwner?.webContents.id === event.sender.id &&
      subscriptionAutoRefreshOwner?.tabId === tabId
    ) {
      subscriptionAutoRefreshOwner = null
      subscriptionAutoRefreshProgress = 0
      broadcastSubscriptionAutoRefreshState()
      updateBackgroundVisibility()
    }
  })

  function broadcastSubscriptionAutoRefreshState() {
    const state = {
      inProgress: isSubscriptionAutoRefreshInProgress(),
      percentage: subscriptionAutoRefreshProgress,
      tab: subscriptionAutoRefreshOwner?.feedTab ?? null
    }

    for (const window of getWindows()) {
      if (!window.webContents.isDestroyed() && isTrustedUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED, state)
      }
    }
  }

  return {
    isInProgress: isSubscriptionAutoRefreshInProgress,
    requestCancellation: requestSubscriptionAutoRefreshCancellation,
    isAutomaticDownloadAuthorized: (event, payload) => (
      subscriptionAutoRefreshOwner?.webContents.id === event.sender.id &&
      payload?.refreshOwnerTabId === subscriptionAutoRefreshOwner.tabId
    )
  }
}
