/**
 * TabManager - Manages tabs for a single BrowserWindow using WebContentsView
 */
import { WebContentsView, ipcMain, app } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels } from '../../constants.js'
import * as baseHandlers from '../../datastores/handlers/base.js'
import { saveTabSession, clearTabSession } from './TabSessionStore.js'
import { isOpenTubeXUrl } from '../utils.js'

/** @type {Map<number, TabManager>} windowId -> TabManager */
const tabManagers = new Map()

const isX11 = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'x11'
const DEFAULT_NEW_TAB_POSITION = 'afterCurrent'
const VALID_NEW_TAB_POSITIONS = new Set(['end', 'afterCurrent'])
const VALID_TAB_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
const TAB_PREVIEW_MAX_WIDTH = 360
const TAB_PREVIEW_MAX_HEIGHT = 220
const TAB_PREVIEW_REFRESH_DELAY_MS = 700
const TAB_PREVIEW_TOOLTIP_HIDE_STYLE_ID = 'opentubex-tab-preview-hide-style'
const TAB_PREVIEW_CACHE_DIR_NAME = 'tab-previews'
const TAB_PREVIEW_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i

/**
 * @typedef {object} TabInfo
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {number} lastActiveAt
 * @property {boolean} isPlaying
 * @property {boolean} isPinned
 * @property {boolean} isLoading
 * @property {string | null} color
 * @property {string | null} previewDataUrl
 * @property {number} previewCapturedAt
 * @property {string | null} previewFileName
 * @property {ReturnType<typeof setTimeout> | null} previewCaptureTimeoutId
 * @property {Promise<string | null> | null} previewCapturePromise
 * @property {WebContentsView} view
 * @property {boolean} hasStartedLoading
 * @property {boolean} preloadInBackground
 */

export class TabManager {
  static _isX11 = isX11

  /**
   * @param {unknown} value
   * @returns {'end' | 'afterCurrent'}
   */
  static normalizeNewTabPosition(value) {
    return VALID_NEW_TAB_POSITIONS.has(value)
      ? value
      : DEFAULT_NEW_TAB_POSITION
  }

  /**
   * @param {unknown} value
   * @returns {string | null}
   */
  static normalizeTabColor(value) {
    return VALID_TAB_COLORS.has(value) ? value : null
  }

  /**
   * @param {unknown} value
   * @returns {string | null}
   */
  static normalizePreviewFileName(value) {
    return typeof value === 'string' && TAB_PREVIEW_FILE_PATTERN.test(value)
      ? value
      : null
  }

  /**
   * @returns {string}
   */
  static getTabPreviewCacheDirectory() {
    return join(app.getPath('userData'), TAB_PREVIEW_CACHE_DIR_NAME)
  }

  /**
   * @param {string} dataUrl
   * @returns {Buffer | null}
   */
  static tabPreviewDataUrlToBuffer(dataUrl) {
    if (typeof dataUrl !== 'string') {
      return null
    }

    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
    if (!match) {
      return null
    }

    return Buffer.from(match[1], 'base64')
  }

  /**
   * @param {Buffer} buffer
   * @returns {string}
   */
  static tabPreviewBufferToDataUrl(buffer) {
    return 'data:image/png;base64,' + buffer.toString('base64')
  }

  /**
   * @returns {Promise<'end' | 'afterCurrent'>}
   */
  static async getStoredNewTabPosition() {
    try {
      const value = (await baseHandlers.settings._findOne('newTabPosition'))?.value
      return TabManager.normalizeNewTabPosition(value)
    } catch (error) {
      console.error('Failed to load new tab position preference:', error)
      return DEFAULT_NEW_TAB_POSITION
    }
  }

  /**
   * @param {import('electron').BrowserWindow} browserWindow
   * @param {string} rootAppUrl
   * @param {string} preloadPath
   * @param {string} [backgroundColor='#212121']
   * @param {string} [sessionId] - Stable id used to persist this window's tab session. Generated if omitted.
   */
  constructor(browserWindow, rootAppUrl, preloadPath, backgroundColor = '#212121', sessionId) {
    /** @type {import('electron').BrowserWindow} */
    this.browserWindow = browserWindow
    /** @type {string} */
    this.rootAppUrl = rootAppUrl
    /** @type {string} */
    this.preloadPath = preloadPath
    /** @type {string} */
    this.backgroundColor = backgroundColor
    /** @type {string} */
    this.sessionId = sessionId || randomUUID()
    /** @type {Map<string, TabInfo>} */
    this.tabs = new Map()
    /** @type {string|null} */
    this.activeTabId = null
    /** @type {Array<{ url: string, title?: string, isPinned?: boolean, color?: string | null }>} */
    this.closedTabs = [] // For restore closed tab functionality
    /** @type {number} */
    this.tabBarScrollPosition = 0
    /** @type {string | null} */
    this.contextMenuTabId = null
    /** @type {boolean} */
    this.contextMenuOnTabBar = false
    /** @type {boolean} */
    this._sessionPersistenceDisabled = false
    /** @type {Set<string>} */
    this._attachedTabIds = new Set()
    /** @type {string|null} */
    this._visibleTabId = null
    /** @type {number} */
    this._activationToken = 0

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
   * @param {string} tabId
   * @returns {TabManager|undefined}
   */
  static getManagerForTabId(tabId) {
    for (const manager of tabManagers.values()) {
      if (manager.tabs.has(tabId)) {
        return manager
      }
    }
    return undefined
  }

  /**
   * Derive a readable placeholder tab title from a tab URL before the page sets one.
   * @param {string} url
   * @returns {string}
   */
  static formatDefaultTabTitle(url) {
    try {
      const parsed = URL.parse(url)
      if (!parsed) {
        return url
      }

      if (parsed.hash) {
        const route = parsed.hash.startsWith('#')
          ? parsed.hash.slice(1)
          : parsed.hash
        if (route.length > 0) {
          return route
        }
      }

      if (isOpenTubeXUrl(parsed)) {
        return '/'
      }

      const path = `${parsed.pathname || '/'}${parsed.search || ''}`
      if (path !== '/') {
        return path
      }

      return parsed.host ? `${parsed.host}${path}` : url
    } catch {
      return url
    }
  }

  /**
   * Whether a page title is the app bootstrap default, not page-specific content.
   * @param {string} title
   * @returns {boolean}
   */
  static isGenericTitle(title) {
    if (typeof title !== 'string') {
      return true
    }

    const trimmed = title.trim()
    return trimmed.length === 0 || trimmed === app.getName()
  }

  /**
   * Keep a meaningful tab title during page load when the renderer briefly
   * resets document.title to the bare product name.
   * @param {string | undefined} currentTitle
   * @param {string} newTitle
   * @returns {string}
   */
  static resolveTabTitle(currentTitle, newTitle) {
    if (typeof newTitle !== 'string') {
      return currentTitle ?? ''
    }

    if (
      TabManager.isGenericTitle(newTitle) &&
      currentTitle &&
      !TabManager.isGenericTitle(currentTitle)
    ) {
      return currentTitle
    }

    return newTitle
  }

  /**
   * @param {TabInfo} tab
   * @param {string} title
   * @returns {boolean} Whether the tab title changed
   */
  applyTabTitle(tab, title) {
    const nextTitle = TabManager.resolveTabTitle(tab.title, title)
    if (nextTitle === tab.title) {
      return false
    }

    tab.title = nextTitle

    if (this.activeTabId === tab.id) {
      this.browserWindow.setTitle(nextTitle)
    }

    this._broadcastStateUpdate()
    this._saveSession()
    return true
  }

  /**
   * Other windows for "move tab to window", with disambiguated labels.
   * @param {number} excludeWindowId
   * @returns {Array<{ windowId: number, label: string }>}
   */
  static listMoveTargets(excludeWindowId) {
    const candidates = Array.from(tabManagers.values())
      .filter(m => !m.browserWindow.isDestroyed() && m.browserWindow.id !== excludeWindowId)
      .sort((a, b) => a.browserWindow.id - b.browserWindow.id)

    const baseTitle = (m) => {
      const t = m.browserWindow.getTitle()
      return (t && t.trim()) ? t : app.getName()
    }

    const counts = new Map()
    for (const m of candidates) {
      const t = baseTitle(m)
      counts.set(t, (counts.get(t) || 0) + 1)
    }

    const indexByTitle = new Map()
    return candidates.map(m => {
      const t = baseTitle(m)
      const n = counts.get(t) ?? 1
      let label = t
      if (n > 1) {
        const i = (indexByTitle.get(t) || 0) + 1
        indexByTitle.set(t, i)
        label = `${t} (${i})`
      }
      return { windowId: m.browserWindow.id, label }
    })
  }

  /**
   * Ask every other loaded OpenTubeX tab to leave PiP before a new tab enters it.
   * @param {import('electron').WebContents} ownerWebContents
   * @returns {Promise<void>}
   */
  static async clearPictureInPictureFromOtherTabs(ownerWebContents) {
    const cleanupPromises = []

    for (const manager of tabManagers.values()) {
      for (const tab of manager.tabs.values()) {
        const webContents = tab.view.webContents
        if (webContents.id === ownerWebContents.id || webContents.isDestroyed()) {
          continue
        }

        try {
          if (tab.hasStartedLoading && isOpenTubeXUrl(webContents.getURL())) {
            cleanupPromises.push(
              webContents.executeJavaScript(`
                (async () => {
                  const video = document.querySelector('video.player')
                  const controls = video?.ui?.getControls?.()
                  const mightBeInPip = document.pictureInPictureElement || controls?.isPiPEnabled?.()

                  if (document.pictureInPictureElement && document.exitPictureInPicture) {
                    try {
                      await document.exitPictureInPicture()
                    } catch {}
                  }

                  if (mightBeInPip && video) {
                    video.dispatchEvent(new Event('leavepictureinpicture'))
                  }
                })()
              `, true).catch(error => {
                console.error('Error clearing PiP in replaced tab:', error)
              })
            )
          }
        } catch (error) {
          console.error('Error preparing PiP cleanup for replaced tab:', error)
        }
      }
    }

    await Promise.all(cleanupPromises)
  }

  /**
   * @param {string} tabId
   * @param {number} targetWindowId
   */
  static moveTabToWindow(tabId, targetWindowId) {
    const source = TabManager.getManagerForTabId(tabId)
    const target = TabManager.getForWindow(targetWindowId)
    if (!source || !target || source.browserWindow.id === targetWindowId) {
      return
    }
    if (source.browserWindow.isDestroyed() || target.browserWindow.isDestroyed()) {
      return
    }

    const tabInfo = source.detachTabForTransfer(tabId)
    if (!tabInfo) {
      return
    }

    target.adoptTransferredTab(tabInfo)

    if (source.tabs.size === 0) {
      source.browserWindow.close()
    }
  }

  /**
   * Create a WebContentsView and attach the standard tab event handlers.
   * @returns {WebContentsView}
   */
  _createTabView() {
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

    // Set up window.open handler for this tab (lookup manager so moved tabs open in the right window)
    view.webContents.setWindowOpenHandler((details) => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      if (!mgr) {
        return { action: 'deny' }
      }

      const parsedUrl = URL.parse(details.url)

      if (parsedUrl !== null && isOpenTubeXUrl(view.webContents.getURL())) {
        if (isOpenTubeXUrl(parsedUrl)) {
          mgr.createTabWithPreference({ url: details.url, makeActive: true }).catch(error => {
            console.error('Failed to open window.open URL in a new tab:', error)
          })
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
      TabManager.getFromWebContents(view.webContents)?._updateActiveViewBounds()
    })
    view.webContents.on('leave-html-full-screen', () => {
      TabManager.getFromWebContents(view.webContents)?._updateActiveViewBounds()
    })

    view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isInPlace || !isMainFrame) {
        return
      }

      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }

      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        mgr._setTabLoading(tabInfo, true)
      }
    })

    view.webContents.on('did-start-loading', () => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }

      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        mgr._setTabLoading(tabInfo, true)
      }
    })

    view.webContents.on('did-stop-loading', () => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }

      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        mgr._setTabLoading(tabInfo, false)
      }
    })

    // Listen for title updates
    view.webContents.on('page-title-updated', (_, title) => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }
      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        mgr.applyTabTitle(tabInfo, title)
      }
    })

    view.webContents.on('did-finish-load', () => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }

      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        mgr._setTabLoading(tabInfo, false)
        if (mgr.activeTabId === tid) {
          mgr._scheduleTabPreviewRefresh(tabInfo)
        }
      }
    })

    view.webContents.on('did-fail-load', () => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }

      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        mgr._setTabLoading(tabInfo, false)
      }
    })

    // Listen for navigation to update URL
    view.webContents.on('did-navigate-in-page', (_, url) => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }
      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        tabInfo.url = url
        if (mgr.activeTabId === tid) {
          mgr._scheduleTabPreviewRefresh(tabInfo)
        }
        mgr._saveSession()
      }
    })

    view.webContents.on('did-navigate', (_, url) => {
      const mgr = TabManager.getFromWebContents(view.webContents)
      const tid = TabManager.getTabIdFromWebContents(view.webContents)
      if (!mgr || !tid) {
        return
      }
      const tabInfo = mgr.tabs.get(tid)
      if (tabInfo) {
        tabInfo.url = url
        if (mgr.activeTabId === tid) {
          mgr._scheduleTabPreviewRefresh(tabInfo)
        }
        mgr._saveSession()
      }
    })

    return view
  }

  /**
   * Insert a tab while preserving the invariant that all pinned tabs stay
   * before all unpinned tabs.
   * @param {string} tabId
   * @param {TabInfo} tabInfo
   * @param {number} preferredIndex
   */
  _insertTabEntry(tabId, tabInfo, preferredIndex) {
    const entries = Array.from(this.tabs.entries())
    const pinnedCount = entries.filter(([, tab]) => tab.isPinned).length
    let insertIndex = Math.max(0, Math.min(preferredIndex, entries.length))

    if (tabInfo.isPinned) {
      insertIndex = Math.min(insertIndex, pinnedCount)
    } else {
      insertIndex = Math.max(insertIndex, pinnedCount)
    }

    entries.splice(insertIndex, 0, [tabId, tabInfo])
    this.tabs = new Map(entries)
  }

  /**
   * @param {TabInfo} tab
   * @param {number} [delay]
   */
  _scheduleTabPreviewRefresh(tab, delay = TAB_PREVIEW_REFRESH_DELAY_MS) {
    this._clearTabPreviewRefresh(tab)

    tab.previewCaptureTimeoutId = setTimeout(() => {
      tab.previewCaptureTimeoutId = null
      if (this.activeTabId !== tab.id) {
        return
      }

      this._refreshTabPreview(tab).catch(error => {
        console.error('Failed to refresh tab preview:', error)
      })
    }, delay)
  }

  /**
   * @param {TabInfo} tab
   */
  _clearTabPreviewRefresh(tab) {
    if (tab.previewCaptureTimeoutId != null) {
      clearTimeout(tab.previewCaptureTimeoutId)
      tab.previewCaptureTimeoutId = null
    }
  }

  /**
   * @param {string | null | undefined} fileName
   * @returns {string | null}
   */
  _getTabPreviewFilePath(fileName) {
    const normalizedFileName = TabManager.normalizePreviewFileName(fileName)
    if (normalizedFileName == null) {
      return null
    }

    return join(TabManager.getTabPreviewCacheDirectory(), normalizedFileName)
  }

  /**
   * @param {TabInfo} tab
   * @param {string} dataUrl
   * @returns {Promise<void>}
   */
  async _persistTabPreview(tab, dataUrl) {
    const buffer = TabManager.tabPreviewDataUrlToBuffer(dataUrl)
    if (buffer == null || buffer.length === 0) {
      return
    }

    const fileName = TabManager.normalizePreviewFileName(tab.previewFileName) ?? randomUUID() + '.png'
    const cacheDirectory = TabManager.getTabPreviewCacheDirectory()
    const filePath = join(cacheDirectory, fileName)

    await mkdir(cacheDirectory, { recursive: true })
    await writeFile(filePath, buffer)

    tab.previewFileName = fileName
  }

  /**
   * @param {string | null | undefined} fileName
   * @returns {Promise<string | null>}
   */
  async _loadTabPreviewDataUrl(fileName) {
    const filePath = this._getTabPreviewFilePath(fileName)
    if (filePath == null) {
      return null
    }

    try {
      const buffer = await readFile(filePath)
      return buffer.length > 0
        ? TabManager.tabPreviewBufferToDataUrl(buffer)
        : null
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('Failed to load tab preview:', error)
      }
      return null
    }
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _getCachedTabPreviewDataUrl(tab) {
    if (typeof tab.previewDataUrl === 'string' && tab.previewDataUrl.length > 0) {
      return tab.previewDataUrl
    }

    const dataUrl = await this._loadTabPreviewDataUrl(tab.previewFileName)
    if (dataUrl == null) {
      return null
    }

    tab.previewDataUrl = dataUrl
    return dataUrl
  }

  /**
   * @param {string | null | undefined} fileName
   * @returns {Promise<void>}
   */
  async _deleteTabPreviewFile(fileName) {
    const filePath = this._getTabPreviewFilePath(fileName)
    if (filePath == null) {
      return
    }

    try {
      await unlink(filePath)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('Failed to delete tab preview:', error)
      }
    }
  }

  /**
   * @param {TabInfo} tab
   * @param {boolean} isLoading
   */
  _setTabLoading(tab, isLoading) {
    const nextLoading = Boolean(isLoading)
    if (tab.isLoading === nextLoading) {
      return
    }

    tab.isLoading = nextLoading
    this._broadcastStateUpdate()
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _refreshTabPreview(tab) {
    if (tab.previewCapturePromise != null) {
      return tab.previewCapturePromise
    }

    tab.previewCapturePromise = (async () => {
      const dataUrl = await this._captureTabPreviewDataUrl(tab)
      if (dataUrl == null) {
        return await this._getCachedTabPreviewDataUrl(tab)
      }

      tab.previewDataUrl = dataUrl
      tab.previewCapturedAt = Date.now()
      await this._persistTabPreview(tab, dataUrl).catch(error => {
        console.error('Failed to persist tab preview:', error)
      })
      await this._saveSession()
      return dataUrl
    })()

    try {
      return await tab.previewCapturePromise
    } finally {
      tab.previewCapturePromise = null
    }
  }

  /**
   * @param {TabInfo} tab
   * @returns {Promise<string | null>}
   */
  async _captureTabPreviewDataUrl(tab) {
    if (
      !tab.hasStartedLoading ||
      tab.view.webContents.isDestroyed() ||
      !this._attachedTabIds.has(tab.id)
    ) {
      return null
    }

    const webContents = tab.view.webContents

    try {
      await this._setTabPreviewCaptureMode(webContents, true)

      const image = await webContents.capturePage()
      if (image.isEmpty()) {
        return null
      }

      const { width, height } = image.getSize()
      if (width <= 0 || height <= 0) {
        return null
      }

      const ratio = Math.min(TAB_PREVIEW_MAX_WIDTH / width, TAB_PREVIEW_MAX_HEIGHT / height, 1)
      const preview = ratio < 1
        ? image.resize({
            width: Math.max(1, Math.round(width * ratio)),
            height: Math.max(1, Math.round(height * ratio)),
            quality: 'good'
          })
        : image

      return preview.toDataURL()
    } catch (error) {
      console.error('Failed to capture tab preview:', error)
      return null
    } finally {
      await this._setTabPreviewCaptureMode(webContents, false)
    }
  }

  /**
   * Hide tab tooltip UI inside the captured renderer so previews do not
   * recursively include another preview tooltip.
   * @param {import('electron').WebContents} webContents
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async _setTabPreviewCaptureMode(webContents, enabled) {
    if (webContents.isDestroyed()) {
      return
    }

    const script = enabled
      ? `
        (() => {
          const styleId = ${JSON.stringify(TAB_PREVIEW_TOOLTIP_HIDE_STYLE_ID)}
          let style = document.getElementById(styleId)
          if (!style) {
            style = document.createElement('style')
            style.id = styleId
            style.textContent = '.tabTooltip { visibility: hidden !important; }'
            document.documentElement.append(style)
          }
        })()
      `
      : `
        (() => {
          document.getElementById(${JSON.stringify(TAB_PREVIEW_TOOLTIP_HIDE_STYLE_ID)})?.remove()
        })()
      `

    try {
      await webContents.executeJavaScript(script, true)
      if (enabled) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } catch {
      // The renderer may be navigating or already torn down; the caller can
      // still try capturePage and fall back to the cached preview.
    }
  }

  /**
   * Create a new tab
   * @param {object} options
   * @param {string} [options.url] - Full URL to load
   * @param {string} [options.route] - Hash route (e.g., '/watch/xyz')
   * @param {object} [options.query] - Query params for the route
   * @param {string} [options.title] - Initial tab title
   * @param {boolean} [options.isPinned=false] - Whether the tab is pinned
   * @param {string | null} [options.color=null] - Semantic tab color key
   * @param {string | null} [options.previewDataUrl=null] - Restored thumbnail data URL
   * @param {number} [options.previewCapturedAt=0] - Thumbnail capture timestamp
   * @param {string | null} [options.previewFileName=null] - Cached thumbnail file name
   * @param {boolean} [options.makeActive=true] - Whether to activate the tab immediately
   * @param {'end' | 'afterCurrent'} [options.openPosition='end'] - Where to insert the tab
   * @param {boolean} [options.lazyLoad=false] - Whether to defer loading until activation
   * @param {boolean} [options.preloadInBackground=false] - Whether to attach an inactive tab while it loads
   * @returns {TabInfo}
   */
  createTab({ url, route, query, title, isPinned = false, color = null, previewDataUrl = null, previewCapturedAt = 0, previewFileName = null, makeActive = true, openPosition = DEFAULT_NEW_TAB_POSITION, lazyLoad = false, preloadInBackground = false } = {}) {
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

    const view = this._createTabView()
    const restoredPreviewDataUrl = typeof previewDataUrl === 'string' && previewDataUrl.startsWith('data:image/png;base64,')
      ? previewDataUrl
      : null
    const restoredPreviewFileName = TabManager.normalizePreviewFileName(previewFileName)
    const restoredPreviewCapturedAt = (restoredPreviewDataUrl != null || restoredPreviewFileName != null) && Number.isFinite(previewCapturedAt)
      ? previewCapturedAt
      : 0

    const tabInfo = {
      id,
      url: loadUrl,
      title: title || TabManager.formatDefaultTabTitle(loadUrl),
      lastActiveAt: Date.now(),
      isPlaying: false,
      isPinned: Boolean(isPinned),
      isLoading: false,
      color: TabManager.normalizeTabColor(color),
      previewDataUrl: restoredPreviewDataUrl,
      previewCapturedAt: restoredPreviewCapturedAt,
      previewFileName: restoredPreviewFileName,
      previewCaptureTimeoutId: null,
      previewCapturePromise: null,
      view,
      hasStartedLoading: false,
      preloadInBackground: Boolean(preloadInBackground)
    }

    let preferredIndex = this.tabs.size
    if (TabManager.normalizeNewTabPosition(openPosition) === 'afterCurrent' && this.activeTabId != null) {
      const entries = Array.from(this.tabs.entries())
      const activeTabIndex = entries.findIndex(([tabId]) => tabId === this.activeTabId)

      if (activeTabIndex !== -1) {
        preferredIndex = activeTabIndex + 1
      }
    }

    this._insertTabEntry(id, tabInfo, preferredIndex)

    if (!makeActive && preloadInBackground) {
      this._attachBackgroundTab(tabInfo)
    }

    if (!lazyLoad || makeActive) {
      this._startTabLoad(tabInfo)
    }

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
   * Start loading a tab if it was restored lazily.
   * @param {TabInfo} tab
   */
  _startTabLoad(tab) {
    if (tab.hasStartedLoading || tab.view.webContents.isDestroyed()) {
      return
    }

    tab.hasStartedLoading = true
    tab.isLoading = true
    tab.view.webContents.loadURL(tab.url).catch(error => {
      console.error(`Failed to load tab URL ${tab.url}:`, error)
      this._setTabLoading(tab, false)
    })
  }

  /**
   * Create a new tab using the user's preferred insertion position unless overridden.
   * @param {object} options
   * @param {string} [options.url]
   * @param {string} [options.route]
   * @param {object} [options.query]
   * @param {string} [options.title]
   * @param {boolean} [options.isPinned=false]
   * @param {string | null} [options.color=null]
   * @param {boolean} [options.makeActive=true]
   * @param {'end' | 'afterCurrent'} [options.openPosition]
   * @param {boolean} [options.lazyLoad=false]
   * @param {boolean} [options.preloadInBackground=false]
   * @returns {Promise<TabInfo>}
   */
  async createTabWithPreference(options = {}) {
    const openPosition = options.openPosition == null
      ? await TabManager.getStoredNewTabPosition()
      : TabManager.normalizeNewTabPosition(options.openPosition)

    return this.createTab({
      ...options,
      openPosition
    })
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
    const previousVisibleId = this._visibleTabId ?? previousActiveId
    const activationToken = ++this._activationToken

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

    const isSwitchingToDifferentTab = previousActiveId && previousActiveId !== tabId
    const shouldWaitForInitialLoad = !forceImmediate && !tab.hasStartedLoading && isSwitchingToDifferentTab
    if (shouldWaitForInitialLoad) {
      const activateWhenReady = () => {
        // Clean up both listeners in case did-fail-load fires instead
        tab.view.webContents.removeListener('did-finish-load', activateWhenReady)
        tab.view.webContents.removeListener('did-fail-load', activateWhenReady)

        // Only activate if this tab is still the active tab (user might have switched away)
        if (this.activeTabId === tab.id) {
          this._finishTabActivation(tab, previousVisibleId, activationToken)
        }
      }

      tab.view.webContents.once('did-finish-load', activateWhenReady)
      tab.view.webContents.once('did-fail-load', activateWhenReady)
    }

    this._startTabLoad(tab)

    this._broadcastStateUpdate()
    this._saveSession()

    if (shouldWaitForInitialLoad) {
      return
    }

    // If forceImmediate is true, we know the tab has finished loading (e.g., from did-finish-load)
    // so skip the loading check and activate immediately
    if (forceImmediate) {
      this._finishTabActivation(tab, previousVisibleId, activationToken)
      return
    }

    // Check if the tab is still loading. If so, and there's a previous active tab,
    // wait for it to finish loading before showing it to prevent flashing.
    // This is especially important for tabs restored from session that haven't been shown yet.
    const isTabLoading = tab.view.webContents.isLoading()

    // If tab is loading and we're switching from another tab, keep the previous tab
    // visible until the new tab finishes loading to prevent flashing
    if (isTabLoading && isSwitchingToDifferentTab) {
      const activateWhenReady = () => {
        // Clean up both listeners in case did-fail-load fires instead
        tab.view.webContents.removeListener('did-finish-load', activateWhenReady)
        tab.view.webContents.removeListener('did-fail-load', activateWhenReady)

        // Only activate if this tab is still the active tab (user might have switched away)
        if (this.activeTabId === tab.id) {
          this._finishTabActivation(tab, previousVisibleId, activationToken)
        }
      }

      tab.view.webContents.once('did-finish-load', activateWhenReady)
      tab.view.webContents.once('did-fail-load', activateWhenReady)
      return
    }

    // Tab is ready or no previous tab to hide - activate immediately
    this._finishTabActivation(tab, previousVisibleId, activationToken)
  }

  /**
   * @param {TabInfo} tab
   * @param {string|null} previousVisibleId
   * @param {number} activationToken
   * @private
   */
  _finishTabActivation(tab, previousVisibleId, activationToken) {
    this._doActivateTab(tab, previousVisibleId, activationToken).catch(error => {
      console.error('Failed to finish tab activation:', error)
    })
  }

  /**
   * Internal method to actually perform the tab activation (show/hide views).
   * If another tab is visible, capture its final frame before detaching it so
   * tooltip previews stay current after switching away.
   * @param {TabInfo} tab
   * @param {string|null} previousVisibleId
   * @param {number} activationToken
   * @private
   */
  async _doActivateTab(tab, previousVisibleId, activationToken) {
    if (
      activationToken !== this._activationToken ||
      this.activeTabId !== tab.id ||
      !this.tabs.has(tab.id)
    ) {
      return
    }

    // Hide current visible tab
    if (previousVisibleId && previousVisibleId !== tab.id) {
      const currentTab = this.tabs.get(previousVisibleId)
      if (currentTab) {
        this._clearTabPreviewRefresh(currentTab)
        await this._refreshTabPreview(currentTab).catch(error => {
          console.error('Failed to refresh preview for hidden tab:', error)
        })

        if (
          activationToken !== this._activationToken ||
          this.activeTabId !== tab.id ||
          !this.tabs.has(tab.id)
        ) {
          return
        }

        this._detachView(currentTab)
        if (this._visibleTabId === currentTab.id) {
          this._visibleTabId = null
        }

        if (!currentTab.view.webContents.isDestroyed()) {
          try {
            currentTab.view.webContents.send(IpcChannels.TABS_ACTIVE_CHANGED, false)
          } catch (error) {
            console.error('Error sending tab inactive notification:', error)
          }
        }
      }
    }

    if (
      activationToken !== this._activationToken ||
      this.activeTabId !== tab.id ||
      !this.tabs.has(tab.id) ||
      tab.view.webContents.isDestroyed()
    ) {
      return
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
    this._detachView(tab)
    this._attachView(tab)
    this._visibleTabId = tab.id
    tab.view.webContents.focus()

    if (!tab.view.webContents.isDestroyed()) {
      try {
        tab.view.webContents.send(IpcChannels.TABS_ACTIVE_CHANGED, true)
      } catch (error) {
        console.error('Error sending tab active notification:', error)
      }
    }

    this._scheduleTabPreviewRefresh(tab)
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

    this._clearTabPreviewRefresh(tab)

    // Store URL and visual metadata for potential restore.
    this.closedTabs.push({
      url: tab.url,
      title: tab.title,
      isPinned: tab.isPinned,
      color: tab.color
    })
    if (this.closedTabs.length > 10) {
      this.closedTabs.shift()
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

    this._detachView(tab)

    // Destroy the webContents
    tab.view.webContents.close()
    this._deleteTabPreviewFile(tab.previewFileName).catch(error => {
      console.error('Failed to delete closed tab preview:', error)
    })

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

    return this.createTab({
      url: tab.url,
      title: tab.title,
      isPinned: tab.isPinned,
      color: tab.color,
      makeActive: true
    })
  }

  /**
   * Restore the last closed tab
   * @returns {TabInfo|null}
   */
  restoreClosedTab() {
    const closedTab = this.closedTabs.pop()
    if (!closedTab) return null

    return this.createTab({
      url: closedTab.url,
      title: closedTab.title,
      isPinned: closedTab.isPinned,
      color: closedTab.color,
      makeActive: true
    })
  }

  /**
   * Pin or unpin a tab and move it to the matching tab group.
   * @param {string} tabId
   * @param {boolean} isPinned
   * @returns {boolean} Whether the tab changed
   */
  setTabPinned(tabId, isPinned) {
    const tab = this.tabs.get(tabId)
    if (!tab) return false

    const nextPinned = Boolean(isPinned)
    if (tab.isPinned === nextPinned) {
      return false
    }

    tab.isPinned = nextPinned

    const entries = Array.from(this.tabs.entries()).filter(([id]) => id !== tabId)
    const pinnedCount = entries.filter(([, candidate]) => candidate.isPinned).length
    entries.splice(pinnedCount, 0, [tabId, tab])
    this.tabs = new Map(entries)

    this._broadcastStateUpdate()
    this._saveSession()

    return true
  }

  /**
   * Set a tab's semantic color key.
   * @param {string} tabId
   * @param {string | null} color
   * @returns {boolean} Whether the tab changed
   */
  setTabColor(tabId, color) {
    const tab = this.tabs.get(tabId)
    if (!tab) return false

    const nextColor = TabManager.normalizeTabColor(color)
    if (tab.color === nextColor) {
      return false
    }

    tab.color = nextColor

    this._broadcastStateUpdate()
    this._saveSession()

    return true
  }

  /**
   * Capture a small thumbnail of a tab if its webContents can provide one.
   * @param {string} tabId
   * @returns {Promise<string | null>} Data URL for the thumbnail, or null.
   */
  async captureTabPreview(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return null
    }

    const canCaptureLive = tab.hasStartedLoading &&
      !tab.view.webContents.isDestroyed() &&
      this.activeTabId === tab.id &&
      this._attachedTabIds.has(tab.id)

    if (!canCaptureLive) {
      return await this._getCachedTabPreviewDataUrl(tab)
    }

    return this._refreshTabPreview(tab)
  }

  /**
   * Ask the renderer to prepare (e.g. save watch timestamp) and reload; used by menu.
   * The renderer will send TABS_RELOAD when ready, which triggers reloadTab().
   * @param {string | null} [tabId]
   */
  requestReload(tabId = this.activeTabId) {
    if (!tabId) return

    const tab = this.tabs.get(tabId)
    if (!tab || tab.view.webContents.isDestroyed()) return

    tab.view.webContents.send(IpcChannels.TABS_REQUEST_RELOAD)
  }

  /**
   * Reload a tab
   * @param {string | null} [tabId]
   */
  reloadTab(tabId = this.activeTabId) {
    if (!tabId) return

    const tab = this.tabs.get(tabId)
    if (!tab || tab.view.webContents.isDestroyed()) return

    tab.view.webContents.reload()
  }

  /**
   * Unload a tab's renderer while keeping its URL and title in the tab strip.
   * @param {string} tabId
   * @returns {Promise<boolean>} Whether the tab was unloaded
   */
  async unloadTab(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.hasStartedLoading || tab.view.webContents.isDestroyed()) {
      return false
    }

    this._clearTabPreviewRefresh(tab)
    await this._refreshTabPreview(tab).catch(error => {
      console.error('Failed to refresh preview before unloading tab:', error)
    })

    const wasActive = this.activeTabId === tabId
    let tabToActivate = null

    if (wasActive) {
      const orderedTabs = Array.from(this.tabs.entries())
      const unloadedTabIndex = orderedTabs.findIndex(([id]) => id === tabId)

      if (unloadedTabIndex > 0) {
        tabToActivate = orderedTabs[unloadedTabIndex - 1][1]
      } else if (orderedTabs.length > 1) {
        tabToActivate = orderedTabs[1][1]
      } else {
        return false
      }

      this.activeTabId = null
    }

    this._detachView(tab)

    const previousView = tab.view
    tab.view = this._createTabView()
    tab.hasStartedLoading = false
    tab.isPlaying = false
    tab.isLoading = false
    tab.preloadInBackground = false

    if (!previousView.webContents.isDestroyed()) {
      previousView.webContents.close({ waitForBeforeUnload: false })
    }

    if (tabToActivate) {
      this.activateTab(tabToActivate.id)
    } else {
      this._broadcastStateUpdate()
      this._saveSession()
    }

    return true
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
    const [, tab] = entry
    const pinnedCount = entries.filter(([, candidate]) => candidate.isPinned).length
    let targetIndex = Math.max(0, Math.min(toIndex, entries.length))

    if (tab.isPinned) {
      targetIndex = Math.min(targetIndex, pinnedCount)
    } else {
      targetIndex = Math.max(targetIndex, pinnedCount)
    }

    entries.splice(targetIndex, 0, entry)

    this.tabs = new Map(entries)
    this._broadcastStateUpdate()
    this._saveSession()
  }

  /**
   * Remove a tab from this window without destroying its webContents (for cross-window transfer).
   * @param {string} tabId
   * @returns {TabInfo|null}
   */
  detachTabForTransfer(tabId) {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return null
    }

    if (this.activeTabId === tabId) {
      if (this.browserWindow.isFullScreen()) {
        this.browserWindow.setFullScreen(false)
      }

      if (!tab.view.webContents.isDestroyed()) {
        try {
          const url = tab.view.webContents.getURL()
          if (url && isOpenTubeXUrl(url)) {
            tab.view.webContents.send(IpcChannels.TABS_EXIT_FULLSCREEN)
          }
        } catch (error) {
          console.error('Error sending exit fullscreen message:', error)
        }
      }
    }

    this._clearTabPreviewRefresh(tab)

    const orderedTabs = Array.from(this.tabs.entries())
    const detachedIndex = orderedTabs.findIndex(([id]) => id === tabId)
    let tabToActivate = null

    if (this.activeTabId === tabId && detachedIndex !== -1) {
      if (detachedIndex > 0) {
        tabToActivate = orderedTabs[detachedIndex - 1][1]
      } else if (orderedTabs.length > 1) {
        tabToActivate = orderedTabs[1][1]
      }
    }

    this._detachView(tab)

    const entries = orderedTabs.filter(([id]) => id !== tabId)
    this.tabs = new Map(entries)

    if (this.contextMenuTabId === tabId) {
      this.contextMenuTabId = null
    }

    if (tabToActivate) {
      this.activeTabId = null
      this.activateTab(tabToActivate.id)
    } else if (this.activeTabId === tabId) {
      this.activeTabId = null
    }

    this._broadcastStateUpdate()
    this._saveSession()

    return tab
  }

  /**
   * Attach a tab transferred from another window after the current tab and activate it.
   * @param {TabInfo} tabInfo
   */
  adoptTransferredTab(tabInfo) {
    const activeTabIndex = Array.from(this.tabs.keys()).indexOf(this.activeTabId)
    const preferredIndex = activeTabIndex === -1 ? this.tabs.size : activeTabIndex + 1

    this._insertTabEntry(tabInfo.id, tabInfo, preferredIndex)
    tabInfo.view.setBackgroundColor(this.backgroundColor)
    this.activateTab(tabInfo.id)
    this.browserWindow.focus()
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
        // Lazy-restored tabs should look idle until the user activates them.
        isUnloaded: !tab.hasStartedLoading,
        isLoading: tab.isLoading || (tab.hasStartedLoading && tab.view.webContents.isLoading()),
        isPlaying: tab.isPlaying || false,
        isPinned: tab.isPinned || false,
        color: TabManager.normalizeTabColor(tab.color)
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
   * @param {TabInfo} tab
   */
  _attachView(tab) {
    if (tab.view.webContents.isDestroyed()) {
      return
    }

    const bounds = this.browserWindow.getContentBounds()
    tab.view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    })
    this.browserWindow.contentView.addChildView(tab.view)
    this._attachedTabIds.add(tab.id)
  }

  /**
   * @param {TabInfo} tab
   */
  _detachView(tab) {
    if (!this._attachedTabIds.has(tab.id)) {
      return
    }

    try {
      this.browserWindow.contentView.removeChildView(tab.view)
    } catch (error) {
      console.error('Error detaching tab view:', error)
    } finally {
      this._attachedTabIds.delete(tab.id)
    }
  }

  /**
   * Attach an inactive tab behind the current active tab so its renderer can
   * initialize media work without stealing focus.
   * @param {TabInfo} tab
   */
  _attachBackgroundTab(tab) {
    if (this.activeTabId === tab.id || this._attachedTabIds.has(tab.id)) {
      return
    }

    const activeTab = this.activeTabId ? this.tabs.get(this.activeTabId) : null

    this._attachView(tab)

    if (activeTab && activeTab.id !== tab.id && !activeTab.view.webContents.isDestroyed()) {
      this._detachView(activeTab)
      this._attachView(activeTab)
      activeTab.view.webContents.focus()
    }
  }

  /**
   * Broadcast state update to all tabs in this window
   */
  _broadcastStateUpdate() {
    const state = this.getState()
    for (const tab of this.tabs.values()) {
      if (tab.hasStartedLoading && isOpenTubeXUrl(tab.view.webContents.getURL())) {
        tab.view.webContents.send(IpcChannels.TABS_STATE_UPDATED, state)
      }
    }
  }

  /**
   * Save session to persistent storage. Each window persists its state
   * under its own stable sessionId so multiple open windows can be
   * restored on the next launch.
   */
  async _saveSession() {
    if (this._sessionPersistenceDisabled) return

    const tabs = Array.from(this.tabs.values()).map(tab => {
      const tabData = {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        isPinned: tab.isPinned,
        color: TabManager.normalizeTabColor(tab.color)
      }

      const previewFileName = TabManager.normalizePreviewFileName(tab.previewFileName)
      if (previewFileName != null && tab.previewCapturedAt > 0) {
        tabData.previewFileName = previewFileName
        tabData.previewCapturedAt = tab.previewCapturedAt
      }

      return tabData
    })

    await saveTabSession(this.sessionId, {
      tabs,
      activeTabId: this.activeTabId,
      bounds: this._getCurrentBounds()
    })
  }

  /**
   * @returns {import('./TabSessionStore').TabSessionBounds | undefined}
   * @private
   */
  _getCurrentBounds() {
    const win = this.browserWindow
    if (!win || win.isDestroyed()) return undefined

    try {
      return {
        ...win.getNormalBounds(),
        maximized: win.isMaximized(),
        fullScreen: win.isFullScreen()
      }
    } catch {
      return undefined
    }
  }

  /**
   * Forget this window's persisted session. Used when a window is closed
   * by the user while the app keeps running, so we don't resurrect it on
   * the next launch.
   */
  async clearSession() {
    // Setting the flag synchronously before awaiting the clear ensures that
    // any later `_saveSession` call (e.g. from a trailing webContents event)
    // short-circuits instead of re-creating the record we're about to remove.
    // NeDB serializes writes per datastore, so an already-in-flight save will
    // land before this clear and still be erased by it.
    this._sessionPersistenceDisabled = true
    await Promise.all(Array.from(this.tabs.values(), tab => this._deleteTabPreviewFile(tab.previewFileName)))
    await clearTabSession(this.sessionId)
  }

  /**
   * Restore tabs from previously loaded session data. The caller is
   * responsible for loading the data (e.g. via loadAllTabSessions) and
   * deciding which window should own which session.
   * @param {{ tabs?: Array<{id?: string, url: string, title?: string, isPinned?: boolean, color?: string | null, previewFileName?: string | null, previewCapturedAt?: number}>, activeTabId?: string }} sessionData
   * @param {{ loadInactiveTabs?: boolean }} [options]
   * @returns {Promise<boolean>} Whether any tabs were restored
   */
  async restoreFromData(sessionData, { loadInactiveTabs = false } = {}) {
    if (!sessionData || !Array.isArray(sessionData.tabs) || sessionData.tabs.length === 0) {
      return false
    }

    for (const tabData of sessionData.tabs) {
      const makeActive = tabData.id === sessionData.activeTabId
      const hasSavedTitle = typeof tabData.title === 'string' && tabData.title.trim().length > 0
      const previewFileName = TabManager.normalizePreviewFileName(tabData.previewFileName)
      const previewDataUrl = previewFileName == null
        ? null
        : await this._loadTabPreviewDataUrl(previewFileName)
      const previewCapturedAt = previewFileName != null && Number.isFinite(tabData.previewCapturedAt)
        ? tabData.previewCapturedAt
        : 0

      this.createTab({
        url: tabData.url,
        title: hasSavedTitle ? tabData.title : undefined,
        isPinned: tabData.isPinned === true,
        color: tabData.color,
        previewDataUrl,
        previewCapturedAt,
        previewFileName,
        makeActive,
        openPosition: 'end',
        lazyLoad: !loadInactiveTabs && !makeActive && hasSavedTitle
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
  ipcMain.handle(IpcChannels.TABS_CREATE, async (event, options) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      const tab = await manager.createTabWithPreference(options || {})
      return { id: tab.id, url: tab.url, title: tab.title, isPinned: tab.isPinned, color: tab.color }
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

  ipcMain.handle(IpcChannels.TABS_IS_ACTIVE, (event) => {
    const manager = TabManager.getFromWebContents(event.sender)
    const tabId = TabManager.getTabIdFromWebContents(event.sender)
    return manager != null && tabId != null && manager.activeTabId === tabId
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
        return { id: tab.id, url: tab.url, title: tab.title, isPinned: tab.isPinned, color: tab.color }
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

  ipcMain.on(IpcChannels.TABS_SET_PINNED, (event, tabId, isPinned) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string') {
      manager.setTabPinned(tabId, isPinned === true)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_COLOR, (event, tabId, color) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string') {
      manager.setTabColor(tabId, color)
    }
  })

  ipcMain.handle(IpcChannels.TABS_CAPTURE_PREVIEW, (event, tabId) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager && typeof tabId === 'string') {
      return manager.captureTabPreview(tabId)
    }
    return null
  })

  // Restore closed tab
  ipcMain.handle(IpcChannels.TABS_RESTORE_CLOSED, (event) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      const tab = manager.restoreClosedTab()
      if (tab) {
        return { id: tab.id, url: tab.url, title: tab.title, isPinned: tab.isPinned, color: tab.color }
      }
    }
    return null
  })

  // Reload tab
  ipcMain.on(IpcChannels.TABS_RELOAD, (event) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      const tabId = TabManager.getTabIdFromWebContents(event.sender)
      manager.reloadTab(tabId)
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

  // Track which tab the shared Electron context menu should act on.
  ipcMain.on(IpcChannels.TABS_SET_CONTEXT_MENU_TAB, (event, payload) => {
    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      manager.contextMenuTabId = typeof payload?.tabId === 'string' && manager.tabs.has(payload.tabId)
        ? payload.tabId
        : null
      manager.contextMenuOnTabBar = payload?.isTabBar === true
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

  ipcMain.on(IpcChannels.TABS_SET_LOADING, (event, isLoading) => {
    const manager = TabManager.getFromWebContents(event.sender)
    const tabId = TabManager.getTabIdFromWebContents(event.sender)

    if (manager && tabId) {
      const tab = manager.tabs.get(tabId)
      if (tab) {
        manager._setTabLoading(tab, isLoading === true)
      }
    }
  })

  ipcMain.handle(IpcChannels.TABS_REQUEST_PICTURE_IN_PICTURE, async (event) => {
    await TabManager.clearPictureInPictureFromOtherTabs(event.sender)

    return event.sender.executeJavaScript(
      'document.querySelector("video.player")?.ui.getControls().togglePiP()',
      true
    )
  })
}

export default TabManager
