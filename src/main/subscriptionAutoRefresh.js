import { BrowserWindow, ipcMain } from 'electron'

import { IpcChannels } from '../constants'
import { getIpBlockRecoveryScriptRun } from './ipBlockRecovery'
import { TabManager } from './tabs/TabManager'
import { isOpenTubeXUrl } from './utils'

/** @type {{ webContents: import('electron').WebContents, tabId: string } | null} */
let subscriptionAutoRefreshOwner = null
let subscriptionAutoRefreshProgress = 0
/** @type {WeakSet<import('electron').WebContents>} */
const trackedWebContents = new WeakSet()

export function isSubscriptionAutoRefreshInProgress() {
  return subscriptionAutoRefreshOwner !== null && !subscriptionAutoRefreshOwner.webContents.isDestroyed()
}

// Any window may ask for the cancellation, only the one running the refresh
// can carry it out
export function requestSubscriptionAutoRefreshCancellation() {
  if (isSubscriptionAutoRefreshInProgress()) {
    subscriptionAutoRefreshOwner.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL)
  }
}

/**
 * The tab whose automatic downloads belong to the refresh in progress.
 */
export function getSubscriptionAutoRefreshOwner() {
  return subscriptionAutoRefreshOwner
}

function broadcastSubscriptionAutoRefreshState() {
  const state = {
    inProgress: isSubscriptionAutoRefreshInProgress(),
    percentage: subscriptionAutoRefreshProgress,
    tab: subscriptionAutoRefreshOwner?.feedTab ?? null
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
      window.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED, state)
    }
  }
}

/**
 * Only one tab of any window refreshes the subscriptions automatically at a
 * time. Every window shows its progress and can cancel it.
 * @param {object} options
 * @param {{ setBackground: (background: boolean) => Promise<void> }} options.backgroundSubscriptions
 * @param {() => void} options.updateBackgroundSubscriptionVisibility
 */
export function setupSubscriptionAutoRefreshIpc({ backgroundSubscriptions, updateBackgroundSubscriptionVisibility }) {
  /** @param {import('electron').WebContents} webContents */
  const releaseOwner = (webContents) => {
    if (subscriptionAutoRefreshOwner?.webContents.id !== webContents.id) return false
    subscriptionAutoRefreshOwner = null
    subscriptionAutoRefreshProgress = 0
    broadcastSubscriptionAutoRefreshState()
    return true
  }

  // A renderer that reloads or crashes never releases its refresh, and a
  // reload keeps the same WebContents
  /** @param {import('electron').WebContents} webContents */
  const trackOwnerLifecycle = (webContents) => {
    if (trackedWebContents.has(webContents)) return
    trackedWebContents.add(webContents)
    const release = () => {
      if (releaseOwner(webContents)) updateBackgroundSubscriptionVisibility()
    }
    webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && isOpenTubeXUrl(url)) release()
    })
    webContents.on('render-process-gone', release)
    // The window's 'closed' handler updates the background visibility
    webContents.once('destroyed', () => releaseOwner(webContents))
  }

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE, async (event, tabId, feedTab) => {
    const canAcquire = () => {
      const manager = TabManager.getFromWebContents(event.sender)
      return manager != null &&
        typeof tabId === 'string' &&
        manager.activeTabId === tabId &&
        !event.sender.isDestroyed() &&
        isOpenTubeXUrl(event.senderFrame.url)
    }

    if (!canAcquire()) {
      return false
    }

    const activeIpBlockRecovery = getIpBlockRecoveryScriptRun()
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
    trackOwnerLifecycle(owner)
    broadcastSubscriptionAutoRefreshState()
    return true
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_GET_STATE, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
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
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    requestSubscriptionAutoRefreshCancellation()
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE, (event, tabId) => {
    if (subscriptionAutoRefreshOwner?.tabId === tabId && releaseOwner(event.sender)) {
      updateBackgroundSubscriptionVisibility()
    }
  })
}
