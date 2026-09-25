/**
 * @typedef {{
 *   window: import('electron').BrowserWindow,
 *   tabManager: import('./tabs/TabManager').TabManager,
 *   BrowserWindow: Pick<typeof import('electron').BrowserWindow, 'getAllWindows'>,
 *   isQuitting: () => boolean,
 *   isTrayOnClose: () => boolean,
 *   isTrayEnabled: () => boolean,
 *   trayClosingWindowIds: Set<number>,
 *   hideWindowToTray: (window: import('electron').BrowserWindow) => void,
 *   closeConfirmedWindowIds: Set<number>,
 *   closingWindowIds: Set<number>,
 *   confirmCloseApp: (window: import('electron').BrowserWindow, allowHideWindow?: boolean) => Promise<boolean>,
 *   confirmCloseWindowWithMultipleTabs: (window: import('electron').BrowserWindow, count: number) => Promise<boolean>,
 *   keepRefreshingInBackground: () => boolean,
 *   confirmQuit: () => void,
 *   closedWindows: import('./tabs/ClosedWindowHistory').ClosedWindowHistory,
 *   htmlFullscreenWindowIds: Set<number>,
 *   settings: Pick<typeof import('../datastores/handlers/base').settings, '_updateBounds'>
 * }} WindowCloseDependencies
 */

/**
 * Attach the close policy for a browser window. The mutable application state
 * is read through callbacks at close time, after asynchronous prompts finish.
 * @param {WindowCloseDependencies} dependencies
 */
export function attachWindowCloseLifecycle({
  window,
  tabManager,
  BrowserWindow,
  isQuitting,
  isTrayOnClose,
  isTrayEnabled,
  trayClosingWindowIds,
  hideWindowToTray,
  closeConfirmedWindowIds,
  closingWindowIds,
  confirmCloseApp,
  confirmCloseWindowWithMultipleTabs,
  keepRefreshingInBackground,
  confirmQuit,
  closedWindows,
  htmlFullscreenWindowIds,
  settings
}) {
  window.on('close', async (event) => {
    if (!isQuitting() && isTrayOnClose() && isTrayEnabled() &&
          !trayClosingWindowIds.has(window.id) && tabManager.tabs.size > 0) {
      event.preventDefault()
      hideWindowToTray(window)
      return
    }

    const wasLastWindow = BrowserWindow.getAllWindows().length === 1

    if (!isQuitting() && !closeConfirmedWindowIds.delete(window.id) &&
          (wasLastWindow || tabManager.tabs.size > 1)) {
      event.preventDefault()

      let quitsApp = wasLastWindow
      let confirmed = quitsApp
        ? await confirmCloseApp(window, keepRefreshingInBackground())
        : await confirmCloseWindowWithMultipleTabs(window, tabManager.tabs.size)
      const openWindowCount = BrowserWindow.getAllWindows()
        .filter(window => !closingWindowIds.has(window.id)).length
      if (confirmed && !wasLastWindow && openWindowCount === 1) {
        confirmed = await confirmCloseApp(window, keepRefreshingInBackground())
        quitsApp = confirmed
      }
      if (confirmed && quitsApp) {
        confirmQuit()
      } else if (confirmed) {
        closeConfirmedWindowIds.add(window.id)
        window.close()
      } else {
        trayClosingWindowIds.delete(window.id)
      }

      return
    }

    if (!isQuitting()) {
      closedWindows.remember(tabManager.getSessionDataForWindowClose())
    }

    closingWindowIds.add(window.id)

    // A confirmation can remain open while another window closes. Recompute
    // this after the async prompt so the session decision uses current state.
    const isLastWindow = BrowserWindow.getAllWindows()
      .filter(candidate => candidate.id === window.id || !closingWindowIds.has(candidate.id))
      .length === 1

    // returns true if the element existed in the set
    const htmlFullscreen = htmlFullscreenWindowIds.delete(window.id)

    const value = {
      ...window.getNormalBounds(),
      maximized: window.isMaximized(),

      // Don't save the full screen state if it was triggered by an HTML API e.g. the video player
      fullScreen: window.isFullScreen() && !htmlFullscreen
    }

    // The current window is still part of getAllWindows() at the point the
    // `close` event fires, so length === 1 means we're closing the last one.
    // Preserve this window's tab session when:
    //   - the app is quitting (so every open window comes back on next launch)
    //   - or this is the last window closing (single-window sessions have
    //     always been restored historically, keep that behavior)
    // Otherwise the user manually closed one of several windows and we don't
    // want it resurrected the next time the app runs.
    if (isQuitting() || isLastWindow) {
      try {
        await tabManager._saveSession()
      } catch (err) {
        console.error('Failed to persist tab session on window close', err)
      }
    } else {
      try {
        await tabManager.clearSession()
      } catch (err) {
        console.error('Failed to clear tab session on window close', err)
      }
    }

    // Keep the legacy single-window `bounds` setting up to date so brand-new
    // windows (with no saved session of their own) still open at the user's
    // preferred size/position.
    if (isLastWindow) {
      await settings._updateBounds(value)
    }
  })
}
