// @ts-check
import { ipcRenderer } from 'electron/renderer'
import { IpcChannels } from '../constants.js'

/** @type {Set<{ handler: (tabId: string) => void, tabId?: string }>} */
const tabsExitFullscreenListeners = new Set()

ipcRenderer.on(IpcChannels.TABS_EXIT_FULLSCREEN, (_, targetTabId) => {
  for (const { handler, tabId } of tabsExitFullscreenListeners) {
    if (tabId == null || targetTabId === tabId) {
      handler(targetTabId)
    }
  }
})

// Tab management API
export const tabs = {
  rendererReady: () => {
    ipcRenderer.send(IpcChannels.TABS_RENDERER_READY)
  },

  /**
   * Block native tab menu accelerators while a modal owns keyboard input.
   * @param {boolean} blocked
   */
  setShortcutsBlocked: (blocked) => {
    return ipcRenderer.invoke(IpcChannels.TABS_SET_SHORTCUTS_BLOCKED, blocked === true)
  },

  /**
   * Get the current tab state
   * @returns {Promise<{tabs: Array<{id: string, url: string, title: string, isActive: boolean}>, activeTabId: string|null}>}
   */
  getState: () => {
    return ipcRenderer.invoke(IpcChannels.TABS_GET_STATE)
  },

  /**
   * Get all open windows as portable session snapshots for encrypted sync.
   * @returns {Promise<Array>}
   */
  getSyncSessions: () => {
    return ipcRenderer.invoke(IpcChannels.TABS_GET_SYNC_SESSIONS)
  },

  /**
   * Apply portable session snapshots received through encrypted sync.
   * @param {Array} sessions
   * @returns {Promise<boolean>}
   */
  applySyncSessions: (sessions) => {
    return ipcRenderer.invoke(IpcChannels.TABS_APPLY_SYNC_SESSIONS, sessions)
  },

  /**
   * Create a new tab
   * @param {object} options
   * @param {string} [options.url] - Full URL to load
   * @param {string} [options.route] - Hash route (e.g., '/watch/xyz')
   * @param {object} [options.query] - Query params for the route
   * @param {boolean} [options.makeActive=true] - Whether to activate the tab
   * @param {boolean} [options.inheritColorFromOpener=false] - Whether to inherit the opener tab color
   * @param {string} [options.openerTabId] - Tab whose ordered placement group this tab belongs to
   * @param {boolean} [options.preloadInBackground=false] - Whether to attach an inactive tab while it loads
   * @returns {Promise<{id: string, url: string, title: string}|null>}
   */
  create: (options) => {
    return ipcRenderer.invoke(IpcChannels.TABS_CREATE, options)
  },

  /**
   * Activate a tab
   * @param {string} tabId
   */
  activate: (tabId) => {
    ipcRenderer.send(IpcChannels.TABS_ACTIVATE, tabId)
  },

  /**
   * Check whether a logical tab is selected in this window.
   * @param {string} [tabId]
   * @returns {Promise<boolean>}
   */
  isActive: (tabId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_IS_ACTIVE, tabId)
  },

  /**
   * Close a tab
   * @param {string} tabId
   * @returns {Promise<{hasRemainingTabs: boolean}>}
   */
  close: (tabId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_CLOSE, tabId)
  },

  /**
   * Close several tabs at once
   * @param {string[]} tabIds
   * @returns {Promise<{hasRemainingTabs: boolean}>}
   */
  closeMultiple: (tabIds) => {
    return ipcRenderer.invoke(IpcChannels.TABS_CLOSE_MULTIPLE, tabIds)
  },

  /**
   * Duplicate a tab
   * @param {string} tabId
   * @returns {Promise<{id: string, url: string, title: string}|null>}
   */
  duplicate: (tabId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_DUPLICATE, tabId)
  },

  /**
   * Move a tab to a new position
   * @param {string} tabId
   * @param {number} toIndex
   */
  move: (tabId, toIndex) => {
    ipcRenderer.send(IpcChannels.TABS_MOVE, tabId, toIndex)
  },

  /**
   * Apply a complete tab order atomically.
   * @param {string[]} tabIds
   * @param {string | null} [requestId]
   */
  reorder: (tabIds, requestId = null) => {
    ipcRenderer.send(IpcChannels.TABS_REORDER, tabIds, requestId)
  },

  /**
   * Pin or unpin a tab.
   * @param {string} tabId
   * @param {boolean} isPinned
   */
  setPinned: (tabId, isPinned) => {
    ipcRenderer.send(IpcChannels.TABS_SET_PINNED, tabId, isPinned)
  },

  /**
   * Set a semantic color on a tab.
   * @param {string} tabId
   * @param {'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | null} color
   */
  setColor: (tabId, color) => {
    ipcRenderer.send(IpcChannels.TABS_SET_COLOR, tabId, color)
  },

  createGroup: (group) => {
    return ipcRenderer.invoke(IpcChannels.TABS_CREATE_GROUP, group)
  },

  updateGroup: (groupId, changes) => {
    return ipcRenderer.invoke(IpcChannels.TABS_UPDATE_GROUP, groupId, changes)
  },

  deleteGroup: (groupId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_DELETE_GROUP, groupId)
  },

  setGroup: (tabIds, groupId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_SET_GROUP, tabIds, groupId)
  },

  runOrganizerAction: (action, tabIds) => {
    return ipcRenderer.invoke(IpcChannels.TABS_RUN_ORGANIZER_ACTION, action, tabIds)
  },

  /**
   * @returns {Promise<number>} The number of unloaded tabs
   */
  unloadLeastRecentlyUsed: (percentage, keptTabIds) => {
    return ipcRenderer.invoke(IpcChannels.TABS_UNLOAD_LEAST_RECENTLY_USED, percentage, keptTabIds)
  },

  getMoveTargets: () => {
    return ipcRenderer.invoke(IpcChannels.TABS_GET_MOVE_TARGETS)
  },

  moveToWindow: (tabIds, targetWindowId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_MOVE_TO_WINDOW, tabIds, targetWindowId)
  },

  /**
   * Capture a thumbnail preview for a tab when available.
   * @param {string} tabId
   * @returns {Promise<string | null>} Data URL for the thumbnail, or null.
   */
  capturePreview: (tabId) => {
    return ipcRenderer.invoke(IpcChannels.TABS_CAPTURE_PREVIEW, tabId)
  },

  /**
   * Read cached thumbnail previews without triggering a new page capture.
   * @param {string[]} tabIds
   * @returns {Promise<Record<string, string | null>>}
   */
  getCachedPreviews: (tabIds) => {
    return ipcRenderer.invoke(IpcChannels.TABS_GET_CACHED_PREVIEWS, tabIds)
  },

  /**
   * Enable or disable thumbnail previews for this window's tabs.
   * @param {boolean} enabled
   */
  setPreviewsEnabled: (enabled) => {
    ipcRenderer.send(IpcChannels.TABS_SET_PREVIEWS_ENABLED, enabled === true)
  },

  /**
   * Pause background page captures while preview UI is visible.
   * @param {boolean} paused
   */
  setPreviewCapturePaused: (paused) => {
    ipcRenderer.send(IpcChannels.TABS_SET_PREVIEW_CAPTURE_PAUSED, paused)
  },

  /**
   * Ask the main process to refresh a tab's cached thumbnail preview.
   * @param {{ tabId: string, delayMs?: number }} options
   */
  requestPreviewRefresh: (options) => {
    ipcRenderer.send(IpcChannels.TABS_REQUEST_PREVIEW_REFRESH, options)
  },

  /**
   * Restore the last closed tab
   * @returns {Promise<{id: string, url: string, title: string}|null>}
   */
  restoreClosed: (closedTabId = null) => {
    return ipcRenderer.invoke(IpcChannels.TABS_RESTORE_CLOSED, closedTabId)
  },

  clearClosed: () => {
    return ipcRenderer.invoke(IpcChannels.TABS_CLEAR_CLOSED)
  },

  /**
   * Complete preparation and logically reload one tab.
   * @param {string} tabId
   */
  reload: (tabId) => {
    ipcRenderer.send(IpcChannels.TABS_RELOAD, tabId)
  },

  /**
   * Keep the main process aware of the tab bar's multi-selection so native
   * menu shortcuts can target the same tabs.
   * @param {string[]} tabIds
   */
  setSelected: (tabIds) => {
    ipcRenderer.send(IpcChannels.TABS_SET_SELECTED, tabIds)
  },

  /**
   * Listen for bulk tab action confirmation requests from main.
   * @param {(request: { requestId: string, count: number, action: 'close' | 'load' | 'unload' }) => void} handler
   * @returns {() => void}
   */
  onConfirmMultipleAction: (handler) => {
    const listener = (_event, request) => handler(request)
    ipcRenderer.on(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION, listener)
  },

  /**
   * Answer a bulk tab action confirmation request from main.
   * @param {string} requestId
   * @param {boolean} confirmed
   */
  respondConfirmMultipleAction: (requestId, confirmed) => {
    ipcRenderer.send(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, { requestId, confirmed })
  },

  /**
   * Listen for reload requests from main (e.g. menu "Reload Tab").
   * @param {(tabId: string) => void} handler
   * @returns {() => void}
   */
  onRequestReload: (handler) => {
    const listener = (_event, tabId) => handler(tabId)
    ipcRenderer.on(IpcChannels.TABS_REQUEST_RELOAD, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_REQUEST_RELOAD, listener)
  },

  /**
   * Set playback state for a logical tab.
   * @param {'playing' | 'paused' | 'waiting' | 'failed' | 'none'} state
   * @param {string} tabId
   */
  setPlaybackState: (state, tabId) => {
    ipcRenderer.send(IpcChannels.TABS_SET_PLAYBACK_STATE, state, tabId)
  },

  /**
   * Keep native media menus in sync with the renderer-owned Media Session.
   * @param {{playbackState: 'playing' | 'paused' | 'none', playbackStarted: boolean, hasMetadata: boolean, actions: string[]}} state
   */
  setMediaSessionState: (state) => {
    ipcRenderer.send(IpcChannels.TABS_SET_MEDIA_SESSION_STATE, state)
  },

  /**
   * Listen for media actions requested by native application menus.
   * @param {(action: string) => void} handler
   * @returns {() => void}
   */
  onMediaSessionAction: (handler) => {
    const listener = (_event, action) => handler(action)
    ipcRenderer.on(IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, listener)
  },

  /**
   * Set silence skipping for a logical tab.
   * @param {boolean} enabled
   * @param {string} tabId
   */
  setSkipSilence: (enabled, tabId) => {
    ipcRenderer.send(IpcChannels.TABS_SET_SKIP_SILENCE, enabled === true, tabId)
  },

  /**
   * Publish a logical tab title.
   * @param {string} title
   * @param {string} tabId
   */
  updateTitle: (title, tabId) => {
    ipcRenderer.send(IpcChannels.TABS_UPDATE_TITLE, title, tabId)
  },

  /**
   * Persist the resolved profile picture for a logical tab.
   * @param {ArrayBuffer} avatarBytes
   * @param {string} tabId
   * @param {string} routePath
   * @returns {Promise<boolean>}
   */
  updateAvatar: (avatarBytes, tabId, routePath) => {
    return ipcRenderer.invoke(IpcChannels.TABS_UPDATE_AVATAR, avatarBytes, tabId, routePath)
  },

  /**
   * Enable or disable avatar caching for this window's tabs.
   * @param {boolean} enabled
   */
  setAvatarsEnabled: (enabled) => {
    ipcRenderer.send(IpcChannels.TABS_SET_AVATARS_ENABLED, enabled === true)
  },

  /**
   * Set loading state for a logical tab.
   * @param {boolean} isLoading
   * @param {string} tabId
   */
  setLoading: (isLoading, tabId) => {
    ipcRenderer.send(IpcChannels.TABS_SET_LOADING, isLoading === true, tabId)
  },

  /**
   * Update the main-owned current URL for a logical tab.
   * @param {{tabId: string, route: object, url?: string}} payload
   */
  updateRoute: (payload) => {
    ipcRenderer.send(IpcChannels.TABS_UPDATE_ROUTE, payload)
  },

  /**
   * Sync a logical tab's back/forward history to the main process.
   * @param {{tabId: string, history: object[] | null, historyIndex?: number, persistHistory?: boolean}} payload
   */
  updateNavigationHistory: (payload) => {
    ipcRenderer.send(IpcChannels.TABS_UPDATE_NAV_HISTORY, payload)
  },

  mountReady: (tabId, mountRevision) => {
    ipcRenderer.send(IpcChannels.TABS_MOUNT_READY, { tabId, mountRevision })
  },

  mountFailed: (tabId, mountRevision) => {
    ipcRenderer.send(IpcChannels.TABS_MOUNT_FAILED, { tabId, mountRevision })
  },

  presented: (tabId, selectionRevision) => {
    ipcRenderer.send(IpcChannels.TABS_PRESENTED, { tabId, selectionRevision })
  },

  /**
   * Set the tab bar scroll position (synced across all tab renderers via main process)
   * @param {number} position
   */
  setTabBarScroll: (position) => {
    ipcRenderer.send(IpcChannels.TABS_SET_TAB_BAR_SCROLL, position)
  },

  /**
   * Track which tab-related surface the next context menu should target.
   * @param {{ tabId: string | null, selectedTabIds?: string[], surface: 'tab' | 'tabBar' | 'content' | 'subscriptionFeedTab', feedTab?: 'videos' | 'shorts' | 'live' | 'posts' | 'all' | null, isNewFeedTab?: boolean, hasNewContent?: boolean, verticalLayout?: boolean }} payload
   */
  setContextMenuTab: (payload) => {
    ipcRenderer.send(IpcChannels.TABS_SET_CONTEXT_MENU_TAB, payload)
  },

  /**
   * Listen for tab state updates.
   * @param {(state: {tabs: Array, activeTabId: string|null}) => void} handler
   * @returns {() => void}
   */
  onStateUpdated: (handler) => {
    const listener = (_event, state) => handler(state)
    ipcRenderer.on(IpcChannels.TABS_STATE_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_STATE_UPDATED, listener)
  },

  /**
   * Listen for requests to open the tab organizer from native UI.
   * @param {() => void} handler
   * @returns {() => void}
   */
  onOpenOrganizer: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(IpcChannels.TABS_OPEN_ORGANIZER, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_OPEN_ORGANIZER, listener)
  },

  /**
   * Listen for exit fullscreen notification for a logical tab.
   * @param {(tabId: string) => void} handler
   * @param {string} [tabId]
   * @returns {() => void}
   */
  onExitFullscreen: (handler, tabId) => {
    const subscription = { handler, tabId }
    tabsExitFullscreenListeners.add(subscription)
    return () => tabsExitFullscreenListeners.delete(subscription)
  },

  /**
   * Listen for selected-tab changes.
   * @param {(isActive: boolean, activeTabId: string, revision: number) => void} handler
   * @param {string} [tabId]
   * @returns {() => void}
   */
  onActiveChanged: (handler, tabId) => {
    const listener = (_event, activeTabId, revision) => {
      handler(tabId == null ? true : activeTabId === tabId, activeTabId, revision)
    }
    ipcRenderer.on(IpcChannels.TABS_ACTIVE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_ACTIVE_CHANGED, listener)
  },

  /**
   * Listen for native Back/Forward commands.
   * @param {(payload: {tabId: string, offset: number}) => void} handler
   * @returns {() => void}
   */
  onGoHistory: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on(IpcChannels.TABS_GO_HISTORY, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TABS_GO_HISTORY, listener)
  }
}
