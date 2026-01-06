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

/**
 * @typedef {object} TabInfo
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {number} lastActiveAt
 * @property {WebContentsView} view
 */

export class TabManager {
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

    tabManagers.set(browserWindow.id, this)

    // Update view bounds when window resizes
    this.browserWindow.on('resize', () => this._updateActiveViewBounds())

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
      view
    }

    this.tabs.set(id, tabInfo)

    // Load the URL
    view.webContents.loadURL(loadUrl)

    if (makeActive) {
      this.activateTab(id)
    }

    this._broadcastStateUpdate()
    this._saveSession()

    return tabInfo
  }

  /**
   * Activate a tab
   * @param {string} tabId
   */
  activateTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    // Exit fullscreen on the previous tab before switching
    if (this.activeTabId && this.activeTabId !== tabId) {
      const previousTab = this.tabs.get(this.activeTabId)
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

    // Hide current active tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const currentTab = this.tabs.get(this.activeTabId)
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

    tab.lastActiveAt = Date.now()
    this.activeTabId = tabId

    // Update window title to match tab title
    this.browserWindow.setTitle(tab.title)

    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * Close a tab
   * @param {string} tabId
   */
  closeTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) return

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
    const tabs = Array.from(this.tabs.values()).map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      isActive: tab.id === this.activeTabId
    }))

    return {
      tabs,
      activeTabId: this.activeTabId
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
   * Update the active view bounds to match the window content area
   */
  _updateActiveViewBounds() {
    if (!this.activeTabId) return
    const tab = this.tabs.get(this.activeTabId)
    if (!tab) return

    const bounds = this.browserWindow.getContentBounds()
    tab.view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    })
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
}

export default TabManager
