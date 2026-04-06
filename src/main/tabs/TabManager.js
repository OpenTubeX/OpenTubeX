/**
 * TabManager - Manages tabs for a single BrowserWindow using WebContentsView
 */
import { WebContentsView, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { IpcChannels } from '../../constants.js'
import { saveTabSession, loadTabSession } from './TabSessionStore.js'
import { isOpenTubeXUrl } from '../utils.js'

/** @type {Map<number, TabManager>} windowId -> TabManager */
const tabManagers = new Map()

const isX11 = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'x11'

/**
 * @typedef {object} TabInfo
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {number} lastActiveAt
 * @property {boolean} isPlaying
 * @property {WebContentsView} view
 */

export class TabManager {
  static _isX11 = isX11

  /**
   * @param {import('electron').BrowserWindow} browserWindow
   * @param {string} rootAppUrl
   * @param {string} preloadPath
   * @param {string} [backgroundColor='#212121']
   */
  constructor(browserWindow, rootAppUrl, preloadPath, backgroundColor = '#212121') {
    /** @type {import('electron').BrowserWindow} */
    this.browserWindow = browserWindow
    /** @type {string} */
    this.rootAppUrl = rootAppUrl
    /** @type {string} */
    this.preloadPath = preloadPath
    /** @type {string} */
    this.backgroundColor = backgroundColor
    /** @type {Map<string, TabInfo>} */
    this.tabs = new Map()
    /** @type {string|null} */
    this.activeTabId = null
    /** @type {string[]} */
    this.closedTabUrls = [] // For restore closed tab functionality
    /** @type {number} */
    this.tabCounter = 0
    /** @type {number} */
    this.tabBarScrollPosition = 0

    tabManagers.set(browserWindow.id, this)

    // Update view bounds when window resizes or fullscreen state changes.
    // On X11, entering/leaving fullscreen from a WebContentsView may not
    // reliably trigger a resize event, so we listen explicitly.
    this.browserWindow.on('resize', () => this._updateActiveViewBounds())
    this.browserWindow.on('enter-full-screen', () => this._updateActiveViewBounds())
    this.browserWindow.on('leave-full-screen', () => this._updateActiveViewBounds())
    this.browserWindow.on('enter-html-full-screen', () => this._updateActiveViewBounds())
    this.browserWindow.on('leave-html-full-screen', () => this._updateActiveViewBounds())

    // Clean up when window closes
    this.browserWindow.on('closed', () => {
      tabManagers.delete(browserWindow.id)
    })
  }

  /**
   * Get TabManager for a window
   * @param {number} windowId
   * @returns {TabManager|undefined}
   */
  static getForWindow(windowId) {
    return tabManagers.get(windowId)
  }

  /**
   * Get TabManager from a webContents
   * @param {import('electron').WebContents} webContents
   * @returns {TabManager|undefined}
   */
  static getFromWebContents(webContents) {
    for (const manager of tabManagers.values()) {
      for (const tab of manager.tabs.values()) {
        if (tab.view.webContents.id === webContents.id) {
          return manager
        }
      }
    }
    return undefined
  }

  /**
   * Get tab ID from webContents
   * @param {import('electron').WebContents} webContents
   * @returns {string|undefined}
   */
  static getTabIdFromWebContents(webContents) {
    for (const manager of tabManagers.values()) {
      for (const [tabId, tab] of manager.tabs.entries()) {
        if (tab.view.webContents.id === webContents.id) {
          return tabId
        }
      }
    }
    return undefined
  }

  /**
   * Create a new tab
   * @param {object} options
   * @param {string} [options.url] - Full URL to load
   * @param {string} [options.route] - Hash route (e.g., '/watch/xyz')
   * @param {object} [options.query] - Query params for the route
   * @param {boolean} [options.makeActive=true] - Whether to activate the tab immediately
   * @returns {TabInfo}
   */
  createTab({ url, route, query, makeActive = true } = {}) {
    const id = randomUUID()

    // Determine the URL to load
    let loadUrl = this.rootAppUrl
    if (url) {
      loadUrl = url
    } else if (route) {
      loadUrl = this.rootAppUrl
      if (route.startsWith('/')) {
        loadUrl += '#' + route
      } else {
        loadUrl += '#/' + route
      }
      if (query && Object.keys(query).length > 0) {
        loadUrl += '?' + new URLSearchParams(query).toString()
      }
    }

    // Create WebContentsView with same webPreferences as main window
    const view = new WebContentsView({
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false, // Keep audio playing in background tabs
        preload: this.preloadPath
      }
    })

    // Set background color to match theme and prevent white flash
    view.setBackgroundColor(this.backgroundColor)

    // Set initial bounds immediately to prevent flash
    const bounds = this.browserWindow.getContentBounds()
    view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    })

    // Set up window.open handler for this tab
    view.webContents.setWindowOpenHandler((details) => {
      const parsedUrl = URL.parse(details.url)

      if (parsedUrl !== null && isOpenTubeXUrl(view.webContents.getURL())) {
        if (isOpenTubeXUrl(parsedUrl)) {
          // Open in new tab instead of new window
          this.createTab({ url: details.url, makeActive: true })
        } else if (
          parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ||
          parsedUrl.protocol === 'mailto:' || parsedUrl.protocol === 'tel:'
        ) {
          const { shell } = require('electron')
          shell.openExternal(details.url)
        }
      }

      return { action: 'deny' }
    })

    // Update view bounds when this tab enters or leaves HTML fullscreen.
    // On X11, the BrowserWindow fullscreen events may not fire reliably for
    // WebContentsView children, so we also listen on the individual webContents.
    view.webContents.on('enter-html-full-screen', () => {
      this._updateActiveViewBounds()
    })
    view.webContents.on('leave-html-full-screen', () => {
      this._updateActiveViewBounds()
    })

    // Listen for title updates
    view.webContents.on('page-title-updated', (_, title) => {
      const tabInfo = this.tabs.get(id)
      if (tabInfo) {
        tabInfo.title = title
        this._broadcastStateUpdate()
      }
    })

    // Listen for navigation to update URL
    view.webContents.on('did-navigate-in-page', (_, url) => {
      const tabInfo = this.tabs.get(id)
      if (tabInfo) {
        tabInfo.url = url
        this._saveSession()
      }
    })

    view.webContents.on('did-navigate', (_, url) => {
      const tabInfo = this.tabs.get(id)
      if (tabInfo) {
        tabInfo.url = url
        this._saveSession()
      }
    })

    const tabInfo = {
      id,
      url: loadUrl,
      title: `Tab ${++this.tabCounter}`,
      lastActiveAt: Date.now(),
      isPlaying: false,
      view
    }

    this.tabs.set(id, tabInfo)

    // Load the URL
    view.webContents.loadURL(loadUrl)

    // When opening a new tab while another one is already active, keep the
    // current tab visible until the new tab has finished loading. This avoids
    // the window flashing the background color while the new tab bootstraps.
    if (makeActive) {
      if (this.activeTabId == null) {
        // Initial tab for this window – activate immediately so that
        // createWindow's startup logic can wait on did-finish-load.
        this.activateTab(id)
      } else {
        const activateWhenReady = () => {
          // Clean up both listeners in case did-fail-load fires instead
          view.webContents.removeListener('did-finish-load', activateWhenReady)
          view.webContents.removeListener('did-fail-load', activateWhenReady)
          // Force activation since we know the tab has finished loading
          this.activateTab(id, true)
        }

        view.webContents.once('did-finish-load', activateWhenReady)
        view.webContents.once('did-fail-load', activateWhenReady)
      }
    }

    this._broadcastStateUpdate()
    this._saveSession()

    return tabInfo
  }

  /**
   * Activate a tab
   * @param {string} tabId
   * @param {boolean} [forceImmediate=false] - If true, skip loading check and activate immediately
   */
  activateTab(tabId, forceImmediate = false) {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    // Keep track of the previously active tab so we can update state before
    // swapping views. This ensures renderers know which tab is active by the
    // time their view becomes visible, preventing a brief flash where the old
    // tab still appears active in the tab bar.
    const previousActiveId = this.activeTabId

    // Exit fullscreen on the previous tab before switching
    if (previousActiveId && previousActiveId !== tabId) {
      const previousTab = this.tabs.get(previousActiveId)
      if (previousTab && !previousTab.view.webContents.isDestroyed()) {
        try {
          const url = previousTab.view.webContents.getURL()
          if (url && isOpenTubeXUrl(url)) {
            previousTab.view.webContents.send(IpcChannels.TABS_EXIT_FULLSCREEN)
          }
        } catch (error) {
          // Silently ignore errors if webContents is not ready
          console.error('Error sending exit fullscreen message:', error)
        }
      }
    }

    // Update tab state *before* changing the visible WebContentsView so that
    // all renderers (including the one we are about to show) can update their
    // UI to reflect the new active tab without a visible flicker.
    tab.lastActiveAt = Date.now()
    this.activeTabId = tabId

    // Update window title to match tab title
    this.browserWindow.setTitle(tab.title)

    this._broadcastStateUpdate()
    this._saveSession()

    // If forceImmediate is true, we know the tab has finished loading (e.g., from did-finish-load)
    // so skip the loading check and activate immediately
    if (forceImmediate) {
      this._doActivateTab(tab, previousActiveId)
      return
    }

    // Check if the tab is still loading. If so, and there's a previous active tab,
    // wait for it to finish loading before showing it to prevent flashing.
    // This is especially important for tabs restored from session that haven't been shown yet.
    const isTabLoading = tab.view.webContents.isLoading()
    const isSwitchingToDifferentTab = previousActiveId && previousActiveId !== tabId

    // If tab is loading and we're switching from another tab, keep the previous tab
    // visible until the new tab finishes loading to prevent flashing
    if (isTabLoading && isSwitchingToDifferentTab) {
      const activateWhenReady = () => {
        // Clean up both listeners in case did-fail-load fires instead
        tab.view.webContents.removeListener('did-finish-load', activateWhenReady)
        tab.view.webContents.removeListener('did-fail-load', activateWhenReady)

        // Only activate if this tab is still the active tab (user might have switched away)
        if (this.activeTabId === tab.id) {
          this._doActivateTab(tab, previousActiveId)
        }
      }

      tab.view.webContents.once('did-finish-load', activateWhenReady)
      tab.view.webContents.once('did-fail-load', activateWhenReady)
      return
    }

    // Tab is ready or no previous tab to hide - activate immediately
    this._doActivateTab(tab, previousActiveId)
  }

  /**
   * Internal method to actually perform the tab activation (show/hide views)
   * @param {TabInfo} tab
   * @param {string|null} previousActiveId
   * @private
   */
  _doActivateTab(tab, previousActiveId) {
    // Hide current active tab
    if (previousActiveId && previousActiveId !== tab.id) {
      const currentTab = this.tabs.get(previousActiveId)
      if (currentTab) {
        this.browserWindow.contentView.removeChildView(currentTab.view)
      }
    }

    // Set bounds BEFORE adding the view to prevent flash
    const bounds = this.browserWindow.getContentBounds()
    tab.view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    })

    // Show new active tab
    this.browserWindow.contentView.addChildView(tab.view)
    tab.view.webContents.focus()
  }

  /**
   * Close a tab
   * @param {string} tabId
   */
  closeTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    // Exit fullscreen on the tab being closed if it's the active tab
    if (this.activeTabId === tabId) {
      // Exit BrowserWindow fullscreen directly
      if (this.browserWindow.isFullScreen()) {
        this.browserWindow.setFullScreen(false)
      }

      // Also send IPC message to exit video player fullscreen
      if (!tab.view.webContents.isDestroyed()) {
        try {
          const url = tab.view.webContents.getURL()
          if (url && isOpenTubeXUrl(url)) {
            tab.view.webContents.send(IpcChannels.TABS_EXIT_FULLSCREEN)
          }
        } catch (error) {
          // Silently ignore errors if webContents is not ready
          console.error('Error sending exit fullscreen message:', error)
        }
      }
    }

    // Store URL for potential restore
    this.closedTabUrls.push(tab.url)
    if (this.closedTabUrls.length > 10) {
      this.closedTabUrls.shift()
    }

    // Get ordered tabs BEFORE deleting to find the previous tab
    const orderedTabs = Array.from(this.tabs.entries())
    const closedTabIndex = orderedTabs.findIndex(([id]) => id === tabId)
    let tabToActivate = null

    // If we closed the active tab, determine which tab to activate
    if (this.activeTabId === tabId && closedTabIndex !== -1) {
      if (closedTabIndex > 0) {
        // Not the first tab - activate the previous tab
        tabToActivate = orderedTabs[closedTabIndex - 1][1]
      } else if (orderedTabs.length > 1) {
        // First tab - activate the next tab (which becomes first after deletion)
        tabToActivate = orderedTabs[1][1]
      }
    }

    // Remove from view if active
    if (this.activeTabId === tabId) {
      this.browserWindow.contentView.removeChildView(tab.view)
    }

    // Destroy the webContents
    tab.view.webContents.close()

    this.tabs.delete(tabId)

    // Activate the determined tab
    if (tabToActivate) {
      this.activeTabId = null
      this.activateTab(tabToActivate.id)
    } else if (this.activeTabId === tabId) {
      this.activeTabId = null
    }

    this._broadcastStateUpdate()
    this._saveSession()

    // Return whether there are tabs remaining
    return this.tabs.size > 0
  }

  /**
   * Duplicate a tab
   * @param {string} tabId
   * @returns {TabInfo|null}
   */
  duplicateTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return null

    return this.createTab({ url: tab.url, makeActive: true })
  }

  /**
   * Restore the last closed tab
   * @returns {TabInfo|null}
   */
  restoreClosedTab() {
    const url = this.closedTabUrls.pop()
    if (!url) return null

    return this.createTab({ url, makeActive: true })
  }

  /**
   * Ask the renderer to prepare (e.g. save watch timestamp) and reload; used by menu.
   * The renderer will send TABS_RELOAD when ready, which triggers reloadTab().
   */
  requestReload() {
    if (!this.activeTabId) return

    const tab = this.tabs.get(this.activeTabId)
    if (!tab || tab.view.webContents.isDestroyed()) return

    tab.view.webContents.send(IpcChannels.TABS_REQUEST_RELOAD)
  }

  /**
   * Reload the active tab
   */
  reloadTab() {
    if (!this.activeTabId) return

    const tab = this.tabs.get(this.activeTabId)
    if (!tab || tab.view.webContents.isDestroyed()) return

    tab.view.webContents.reload()
  }

  /**
   * Move a tab to a new position
   * @param {string} tabId
   * @param {number} toIndex
   */
  moveTab(tabId, toIndex) {
    const entries = Array.from(this.tabs.entries())
    const fromIndex = entries.findIndex(([id]) => id === tabId)
    if (fromIndex === -1) return

    const [entry] = entries.splice(fromIndex, 1)
    entries.splice(toIndex, 0, entry)

    this.tabs = new Map(entries)
    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * Get current tab state for renderer
   * @returns {object}
   */
  getState() {
    const tabs = Array.from(this.tabs.values()).map(tab => {
      const isActive = tab.id === this.activeTabId

      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        isActive,
        // Consider a tab "loading" if it is not yet active and its webContents
        // has not finished loading. This is used by the renderer to show a
        // visual loading indicator in the tab bar while the new tab is
        // bootstrapping in the background.
        isLoading: !isActive && !tab.view.webContents.isLoadingMainFrame()
          ? false
          : !isActive && tab.view.webContents.isLoading(),
        isPlaying: tab.isPlaying || false
      }
    })

    return {
      tabs,
      activeTabId: this.activeTabId,
      tabBarScrollPosition: this.tabBarScrollPosition
    }
  }

  /**
   * Get the active tab's webContents
   * @returns {import('electron').WebContents|null}
   */
  getActiveWebContents() {
    if (!this.activeTabId) return null
    const tab = this.tabs.get(this.activeTabId)
    return tab ? tab.view.webContents : null
  }

  /**
   * Update the active view bounds to match the window content area.
   * On X11, window manager fullscreen transitions are asynchronous so the
   * content bounds may not be final when this is first called. A deferred
   * second pass ensures the view is correctly sized once the transition
   * settles.
   */
  _updateActiveViewBounds() {
    if (!this.activeTabId) return
    const tab = this.tabs.get(this.activeTabId)
    if (!tab) return

    const applyBounds = () => {
      if (tab.view.webContents.isDestroyed()) return
      const bounds = this.browserWindow.getContentBounds()
      tab.view.setBounds({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height
      })
    }

    applyBounds()

    if (TabManager._isX11) {
      if (this._boundsUpdateTimer) {
        clearTimeout(this._boundsUpdateTimer)
      }
      this._boundsUpdateTimer = setTimeout(() => {
        this._boundsUpdateTimer = null
        applyBounds()
      }, 100)
    }
  }

  /**
   * Broadcast state update to all tabs in this window
   */
  _broadcastStateUpdate() {
    const state = this.getState()
    for (const tab of this.tabs.values()) {
      if (isOpenTubeXUrl(tab.view.webContents.getURL())) {
        tab.view.webContents.send(IpcChannels.TABS_STATE_UPDATED, state)
      }
    }
  }

  /**
   * Save session to persistent storage
   */
  async _saveSession() {
    const tabs = Array.from(this.tabs.values()).map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title
    }))

    await saveTabSession({
      tabs,
      activeTabId: this.activeTabId
    })
  }

  /**
   * Restore session from persistent storage
   * @returns {Promise<boolean>} Whether session was restored
   */
  async restoreSession() {
    const session = await loadTabSession()
    if (!session || !session.tabs || session.tabs.length === 0) {
      return false
    }

    // Create tabs from session
    for (const tabData of session.tabs) {
      this.createTab({
        url: tabData.url,
        makeActive: tabData.id === session.activeTabId
      })
    }

    return true
  }

  /**
   * Navigate all tabs to handle deep link
   * @param {string} url
   */
  navigateActiveTabTo(url) {
    const activeTab = this.tabs.get(this.activeTabId)
    if (activeTab && isOpenTubeXUrl(activeTab.view.webContents.getURL())) {
      activeTab.view.webContents.send(IpcChannels.OPEN_URL, url)
    }
  }
}

/**
 * Set up IPC handlers for tabs
 */
export function setupTabsIPC() {
  // Get tab state
  ipcMain.handle(IpcChannels.TABS_GET_STATE, (event) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      return manager.getState()
    }
    return null
  })

  // Create new tab
  ipcMain.handle(IpcChannels.TABS_CREATE, (event, options) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      const tab = manager.createTab(options || {})
      return { id: tab.id, url: tab.url, title: tab.title }
    }
    return null
  })

  // Activate tab
  ipcMain.on(IpcChannels.TABS_ACTIVATE, (event, tabId) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string') {
      manager.activateTab(tabId)
    }
  })

  // Close tab
  ipcMain.handle(IpcChannels.TABS_CLOSE, (event, tabId) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string') {
      const hasRemainingTabs = manager.closeTab(tabId)
      // Close the window if no tabs remain
      if (!hasRemainingTabs) {
        manager.browserWindow.close()
      }
      return { hasRemainingTabs }
    }
    return { hasRemainingTabs: false }
  })

  // Duplicate tab
  ipcMain.handle(IpcChannels.TABS_DUPLICATE, (event, tabId) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string') {
      const tab = manager.duplicateTab(tabId)
      if (tab) {
        return { id: tab.id, url: tab.url, title: tab.title }
      }
    }
    return null
  })

  // Move tab
  ipcMain.on(IpcChannels.TABS_MOVE, (event, tabId, toIndex) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string' && typeof toIndex === 'number') {
      manager.moveTab(tabId, toIndex)
    }
  })

  // Restore closed tab
  ipcMain.handle(IpcChannels.TABS_RESTORE_CLOSED, (event) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      const tab = manager.restoreClosedTab()
      if (tab) {
        return { id: tab.id, url: tab.url, title: tab.title }
      }
    }
    return null
  })

  // Reload tab
  ipcMain.on(IpcChannels.TABS_RELOAD, (event) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      manager.reloadTab()
    }
  })

  // Update tab title (called from renderer when page title changes)
  ipcMain.on(IpcChannels.TABS_UPDATE_TITLE, (event, title) => {
    if (typeof title !== 'string') return

    const manager = TabManager.getFromWebContents(event.sender)
    const tabId = TabManager.getTabIdFromWebContents(event.sender)

    if (manager && tabId) {
      const tab = manager.tabs.get(tabId)
      if (tab) {
        tab.title = title
        // Update window title if this is the active tab
        if (manager.activeTabId === tabId) {
          manager.browserWindow.setTitle(title)
        }
        manager._broadcastStateUpdate()
        manager._saveSession()
      }
    }
  })

  // Update tab bar scroll position (keeps scroll in sync across all tab renderers)
  ipcMain.on(IpcChannels.TABS_SET_TAB_BAR_SCROLL, (event, position) => {
    if (typeof position !== 'number') return

    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      manager.tabBarScrollPosition = position
    }
  })

  // Update tab playback state (called from renderer when video plays/pauses/ends)
  ipcMain.on(IpcChannels.TABS_SET_PLAYBACK_STATE, (event, playbackState) => {
    if (typeof playbackState !== 'string') return

    const manager = TabManager.getFromWebContents(event.sender)
    const tabId = TabManager.getTabIdFromWebContents(event.sender)

    if (manager && tabId) {
      const tab = manager.tabs.get(tabId)
      if (tab) {
        tab.isPlaying = playbackState === 'playing'
        // Broadcast state update but don't save to session (isPlaying is ephemeral)
        manager._broadcastStateUpdate()
      }
    }
  })
}

export default TabManager
