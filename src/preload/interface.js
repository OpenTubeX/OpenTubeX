import { ipcRenderer, webFrame } from 'electron/renderer'
import { IpcChannels } from '../constants.js'

/**
 * Linux fix for dynamically updating theme preference, this works on
 * all systems running the electron app.
 */
ipcRenderer.on(IpcChannels.NATIVE_THEME_UPDATE, (_, shouldUseDarkColors) => {
  document.body.dataset.systemTheme = shouldUseDarkColors ? 'dark' : 'light'
})

let currentUpdateSearchInputTextListener
let currentYtDlpBinaryDownloadProgressListener
const ytDlpBinaryDownloadProgressListeners = new Set()

ipcRenderer.on(IpcChannels.YT_DLP_BINARY_DOWNLOAD_PROGRESS, (_, progress) => {
  for (const listener of ytDlpBinaryDownloadProgressListeners) {
    listener(progress)
  }
})

export default {
  /**
   * @param {string} title
   * @param {string} tabId
   */
  setWindowTitle: (title, tabId) => {
    ipcRenderer.send(IpcChannels.SET_WINDOW_TITLE, { title, tabId })
  },

  /**
   * @returns {Promise<string>}
   */
  getSystemLocale: () => {
    return ipcRenderer.invoke(IpcChannels.GET_SYSTEM_LOCALE)
  },

  /**
   * @returns {Promise<boolean>}
   */
  isWaylandPlatform: () => {
    return ipcRenderer.invoke(IpcChannels.IS_WAYLAND_PLATFORM)
  },

  /**
   * @param {string} path
   * @param {Record<string, string> | null | undefined} query
   * @param {string | null | undefined} searchQueryText
   */
  openInNewWindow: (path, query, searchQueryText) => {
    ipcRenderer.send(IpcChannels.CREATE_NEW_WINDOW, path, query, searchQueryText)
  },

  /**
   * @param {string} url
   */
  enableProxy: (url) => {
    ipcRenderer.send(IpcChannels.ENABLE_PROXY, url)
  },

  disableProxy: () => {
    ipcRenderer.send(IpcChannels.DISABLE_PROXY)
  },

  /**
   * @param {string} authorization
   * @param {string} url
   */
  setInvidiousAuthorization: (authorization, url) => {
    ipcRenderer.send(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, authorization, url)
  },

  clearInvidiousAuthorization: () => {
    ipcRenderer.send(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, null)
  },

  startPowerSaveBlocker: () => {
    ipcRenderer.send(IpcChannels.START_POWER_SAVE_BLOCKER)
  },

  stopPowerSaveBlocker: () => {
    ipcRenderer.send(IpcChannels.STOP_POWER_SAVE_BLOCKER)
  },

  /**
   * @returns {Promise<boolean>}
   */
  getReplaceHttpCache: () => {
    return ipcRenderer.invoke(IpcChannels.GET_REPLACE_HTTP_CACHE)
  },

  toggleReplaceHttpCache: () => {
    ipcRenderer.send(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE)
  },

  // Allows programmatic toggling of picture-in-picture mode without accompanying user interaction.
  // See: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation#transient_activation
  requestPiP: (tabId) => {
    // Fire-and-forget: swallow rejection so it never surfaces as an unhandled rejection.
    ipcRenderer.invoke(IpcChannels.TABS_REQUEST_PICTURE_IN_PICTURE, tabId).catch(() => {})
  },

  // Allows programmatic toggling of fullscreen without accompanying user interaction.
  // See: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation#transient_activation
  requestFullscreen: (tabId) => {
    // Fire-and-forget: swallow rejection so it never surfaces as an unhandled rejection.
    ipcRenderer.invoke(IpcChannels.TABS_REQUEST_FULLSCREEN, tabId).catch(() => {})
  },

  /**
   * Listen for native window minimize/restore, which the renderer can't reliably
   * detect on its own (notably on Wayland).
   * @param {(minimized: boolean) => void} handler
   * @returns {() => void} unsubscribe
   */
  handleWindowMinimizedState: (handler) => {
    const listener = (_, minimized) => handler(minimized)
    ipcRenderer.on(IpcChannels.WINDOW_MINIMIZED_STATE, listener)
    return () => ipcRenderer.removeListener(IpcChannels.WINDOW_MINIMIZED_STATE, listener)
  },

  /**
   * @param {string} key
   * @returns {Promise<ArrayBuffer>}
   */
  playerCacheGet: (key) => {
    return ipcRenderer.invoke(IpcChannels.PLAYER_CACHE_GET, key)
  },

  /**
   * @param {string} key
   * @param {ArrayBuffer} value
   */
  playerCacheSet: async (key, value) => {
    await ipcRenderer.invoke(IpcChannels.PLAYER_CACHE_SET, key, value)
  },

  /**
   * @param {string} videoId
   * @param {string} context
   * @returns {Promise<string>}
   */
  generatePoToken: (videoId, context) => {
    return ipcRenderer.invoke(IpcChannels.GENERATE_PO_TOKEN, videoId, context)
  },

  chooseDefaultFolder: () => {
    ipcRenderer.send(IpcChannels.CHOOSE_DEFAULT_FOLDER)
  },

  /**
   * @param {string} currentPath
   * @returns {Promise<string | undefined>}
   */
  chooseIpBlockRecoveryScript: (currentPath) => {
    return ipcRenderer.invoke(IpcChannels.CHOOSE_IP_BLOCK_RECOVERY_SCRIPT, currentPath)
  },

  /**
   * @param {string} filename
   * @param {ArrayBuffer} contents
   * @returns {Promise<boolean>}
   */
  writeToDefaultFolder: async (filename, contents) => {
    return await ipcRenderer.invoke(IpcChannels.WRITE_TO_DEFAULT_FOLDER, filename, contents)
  },

  /**
   * Atomically starts the shared IP block recovery run.
   * @param {string} scriptPath
   * @returns {Promise<boolean>} whether this caller started the run
   */
  startIpBlockRecoveryScript: async (scriptPath) => {
    return await ipcRenderer.invoke(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT, scriptPath)
  },

  /**
   * @param {string} scriptPath
   * @returns {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
   */
  executeIpBlockRecoveryScript: async (scriptPath) => {
    return await ipcRenderer.invoke(IpcChannels.EXECUTE_IP_BLOCK_RECOVERY_SCRIPT, scriptPath)
  },

  /**
   * Waits for the active IP block recovery run, if any.
   * @returns {Promise<void>}
   */
  waitForIpBlockRecoveryScript: async () => {
    await ipcRenderer.invoke(IpcChannels.WAIT_FOR_IP_BLOCK_RECOVERY_SCRIPT)
  },

  relaunch: () => {
    ipcRenderer.send(IpcChannels.RELAUNCH_REQUEST)
  },

  /**
   * @param {import('../main/externalPlayer').ExternalPlayerPayload} payload
   */
  openInExternalPlayer: (payload) => {
    // require the user to have interacted with the page recently
    if (navigator.userActivation.isActive) {
      ipcRenderer.send(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, payload)
    }
  },

  /**
   * @param {(
   *   externalPlayer: string,
   *   unsuportedActions: (import('../constants').UnsupportedPlayerAction)[],
   *   isPlaylist: boolean
   * ) => void} handler
   */
  handleOpenInExternalPlayerResult: (handler) => {
    ipcRenderer.on(IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT,
      (event, externalPlayer, unsupportedActions, isPlaylist) => {
        handler(externalPlayer, unsupportedActions, isPlaylist)
      })
  },

  /**
   * @param {import('../main/ytDlp').YtDlpDownloadPayload} payload
   * @returns {Promise<{ id: number } | { error: string } | null>}
   */
  ytDlpDownload: (payload) => {
    // require the user to have interacted with the page recently
    if (navigator.userActivation.isActive) {
      return ipcRenderer.invoke(IpcChannels.YT_DLP_DOWNLOAD, payload)
    }

    return Promise.resolve(null)
  },

  /**
   * @param {number} id
   */
  ytDlpCancelDownload: (id) => {
    ipcRenderer.send(IpcChannels.YT_DLP_CANCEL_DOWNLOAD, id)
  },

  /**
   * @param {(status: import('../main/ytDlp').YtDlpDownloadStatus) => void} handler
   */
  handleYtDlpDownloadStatus: (handler) => {
    ipcRenderer.on(IpcChannels.YT_DLP_DOWNLOAD_STATUS, (event, status) => {
      handler(status)
    })
  },

  /**
   * @param {string | undefined} currentPath
   * @returns {Promise<string | undefined>}
   */
  ytDlpChooseDownloadFolder: (currentPath) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER, currentPath)
  },

  /**
   * @param {string} currentPath
   * @returns {Promise<string | undefined>}
   */
  ytDlpChooseExecutable: (currentPath) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CHOOSE_EXECUTABLE, currentPath)
  },

  /**
   * @param {{
   *   ytDlpSource: 'system' | 'managed',
   *   ytDlpPath: string,
   *   ffmpegSource: 'system' | 'managed',
   *   ffmpegPath: string
   * } | undefined} [options]
   * @returns {Promise<{
   *   ytDlp: import('../main/ytDlp').YtDlpBinaryInfo,
   *   ffmpeg: import('../main/ytDlp').YtDlpBinaryInfo
   * } | null>}
   */
  ytDlpGetInfo: (options) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_GET_INFO, options)
  },

  /**
   * @param {'yt-dlp' | 'ffmpeg'} binary
   * @returns {Promise<{ version: string, updated: boolean } | { error: string } | null>}
   */
  ytDlpDownloadBinary: (binary) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_DOWNLOAD_BINARY, binary)
  },

  /**
   * Only one listener can be active at a time, pass null to remove it again
   * @param {((progress: { binary: 'yt-dlp' | 'ffmpeg', percent: number | null, inProgress: boolean }) => void) | null} handler
   */
  setYtDlpBinaryDownloadProgressListener: (handler) => {
    if (currentYtDlpBinaryDownloadProgressListener) {
      ytDlpBinaryDownloadProgressListeners.delete(currentYtDlpBinaryDownloadProgressListener)
      currentYtDlpBinaryDownloadProgressListener = undefined
    }

    if (handler) {
      currentYtDlpBinaryDownloadProgressListener = handler
      ytDlpBinaryDownloadProgressListeners.add(handler)
    }
  },

  /**
   * Adds a binary download progress listener without replacing other listeners
   * @param {(progress: { binary: 'yt-dlp' | 'ffmpeg', percent: number | null, inProgress: boolean }) => void} handler
   * @returns {() => void}
   */
  addYtDlpBinaryDownloadProgressListener: (handler) => {
    ytDlpBinaryDownloadProgressListeners.add(handler)
    return () => ytDlpBinaryDownloadProgressListeners.delete(handler)
  },

  /**
   * @param {number} factor
   */
  setZoomFactor: (factor) => {
    if (typeof factor === 'number' && factor > 0) {
      webFrame.setZoomFactor(factor)
    }
  },

  /**
   * @returns {Promise<{ label: string, value: number, active: boolean }[]>}
   */
  getNavigationHistory: () => {
    return ipcRenderer.invoke(IpcChannels.GET_NAVIGATION_HISTORY)
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSettings: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_SETTINGS, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbHistory: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_HISTORY, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbWatchStats: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_WATCH_STATS, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbProfiles: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_PROFILES, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbPlaylists: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_PLAYLISTS, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSearchHistory: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_SEARCH_HISTORY, data ? { action, data } : { action })
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSubscriptionCache: (action, data) => {
    return ipcRenderer.invoke(IpcChannels.DB_SUBSCRIPTION_CACHE, data ? { action, data } : { action })
  },

  /**
   * @param {(route: string, tabId?: string) => void} handler
   * @returns {() => void}
   */
  handleChangeView: (handler) => {
    const listener = (_event, payload) => {
      if (typeof payload === 'string') {
        handler(payload)
      } else {
        handler(payload?.route, payload?.tabId)
      }
    }
    ipcRenderer.on(IpcChannels.CHANGE_VIEW, listener)
    return () => ipcRenderer.removeListener(IpcChannels.CHANGE_VIEW, listener)
  },

  /**
   * @param {(url: string, tabId?: string) => void} handler
   * @returns {() => void}
   */
  handleOpenUrl: (handler) => {
    const listener = (_event, payload) => {
      if (typeof payload === 'string') {
        handler(payload)
      } else {
        handler(payload?.url, payload?.tabId)
      }
    }
    ipcRenderer.on(IpcChannels.OPEN_URL, listener)
    ipcRenderer.send(IpcChannels.APP_READY)
    return () => ipcRenderer.removeListener(IpcChannels.OPEN_URL, listener)
  },

  /**
   * @param {string} message
   * @param {number | null} time
   */
  showToastOnAllTabs: (message, time) => {
    ipcRenderer.send(IpcChannels.SHOW_TOAST, message, time)
  },

  subscriptionAutoRefresh: {
    /**
     * Atomically claim ownership of the subscription auto refresh.
     * @param {string} tabId
     * @param {'videos' | 'shorts' | 'live' | 'posts'} feedTab
     * @returns {Promise<boolean>}
     */
    acquire: (tabId, feedTab) => {
      return ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE, tabId, feedTab)
    },

    /**
     * Check whether a renderer currently owns the subscription refresh.
     * @returns {Promise<{inProgress: boolean, percentage: number, tab: string | null}>}
     */
    isInProgress: () => {
      return ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_GET_STATE)
    },

    /**
     * Publish subscription refresh progress to every renderer.
     * @param {string} tabId
     * @param {number} percentage
     */
    setProgress: (tabId, percentage) => {
      ipcRenderer.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS, tabId, percentage)
    },

    /**
     * Release ownership of the subscription auto refresh.
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    release: (tabId) => {
      return ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE, tabId)
    },

    /**
     * Listen for app-wide subscription refresh ownership changes.
     * @param {(state: {inProgress: boolean, percentage: number}) => void} handler
     * @returns {() => void}
     */
    onStateChanged: (handler) => {
      const listener = (_event, state) => {
        handler(state)
      }
      ipcRenderer.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED, listener)
      }
    }
  },

  subscriptionFeeds: {
    /**
     * Listen for a reload requested from a subscription feed tab's context menu.
     * @param {(payload: {tabId: string, feedTab: 'videos' | 'shorts' | 'live' | 'posts' | 'all'}) => void} handler
     * @returns {() => void}
     */
    onRequestReload: (handler) => {
      const listener = (_event, payload) => handler(payload)
      ipcRenderer.on(IpcChannels.SUBSCRIPTION_FEED_REQUEST_RELOAD, listener)
      return () => ipcRenderer.removeListener(IpcChannels.SUBSCRIPTION_FEED_REQUEST_RELOAD, listener)
    }
  },

  /**
   * @param {(message: string, time: number | null) => void} handler
   * @returns {() => void}
   */
  handleShowToast: (handler) => {
    const listener = (_, message, time) => {
      handler(message, time)
    }

    ipcRenderer.on(IpcChannels.SHOW_TOAST, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.SHOW_TOAST, listener)
    }
  },

  /**
   * Pass `null` to clear the handler
   * @param {(text: string) => void | null} handler
   */
  handleUpdateSearchInputText: (handler) => {
    if (currentUpdateSearchInputTextListener) {
      ipcRenderer.off(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, currentUpdateSearchInputTextListener)
      currentUpdateSearchInputTextListener = undefined
    }

    if (handler) {
      currentUpdateSearchInputTextListener = (_, text) => {
        handler(text)
      }

      ipcRenderer.on(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, currentUpdateSearchInputTextListener)
      ipcRenderer.send(IpcChannels.SEARCH_INPUT_HANDLING_READY)
    }
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncSettings: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_SETTINGS, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncHistory: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_HISTORY, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncWatchStats: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_WATCH_STATS, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncSearchHistory: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_SEARCH_HISTORY, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncProfiles: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_PROFILES, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncPlaylists: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_PLAYLISTS, (_, { event, data }) => {
      handler(event, data)
    })
  },

  /**
   * @param {(event: number, data: any) => void} handler
   */
  handleSyncSubscriptionCache: (handler) => {
    ipcRenderer.on(IpcChannels.SYNC_SUBSCRIPTION_CACHE, (_, { event, data }) => {
      handler(event, data)
    })
  },

  // Tab management API
  tabs: {
    rendererReady: () => {
      ipcRenderer.send(IpcChannels.TABS_RENDERER_READY)
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
    restoreClosed: () => {
      return ipcRenderer.invoke(IpcChannels.TABS_RESTORE_CLOSED)
    },

    /**
     * Complete preparation and logically reload one tab.
     * @param {string} tabId
     */
    reload: (tabId) => {
      ipcRenderer.send(IpcChannels.TABS_RELOAD, tabId)
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
     * @param {'playing' | 'paused' | 'none'} state
     * @param {string} tabId
     */
    setPlaybackState: (state, tabId) => {
      ipcRenderer.send(IpcChannels.TABS_SET_PLAYBACK_STATE, state, tabId)
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
     * Sync a logical tab's back/forward history to the main process
     * so it can be persisted with the tab session. Pass `history: null`
     * to clear any previously synced history.
     * @param {{tabId: string, history: object[] | null, historyIndex?: number}} payload
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
     * @param {{ tabId: string | null, surface: 'tab' | 'tabBar' | 'content' | 'subscriptionFeedTab', feedTab?: 'videos' | 'shorts' | 'live' | 'posts' | 'all' | null, verticalLayout?: boolean }} payload
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
     * Listen for persisted changes that should trigger automatic session sync.
     * @param {() => void} handler
     * @returns {() => void}
     */
    onSyncSessionUpdated: (handler) => {
      const listener = () => handler()
      ipcRenderer.on(IpcChannels.TABS_SYNC_SESSION_UPDATED, listener)
      return () => ipcRenderer.removeListener(IpcChannels.TABS_SYNC_SESSION_UPDATED, listener)
    },

    /**
     * Listen for exit fullscreen notification for a logical tab.
     * @param {(tabId: string) => void} handler
     * @param {string} [tabId]
     * @returns {() => void}
     */
    onExitFullscreen: (handler, tabId) => {
      const listener = (_event, targetTabId) => {
        if (tabId == null || targetTabId === tabId) {
          handler(targetTabId)
        }
      }
      ipcRenderer.on(IpcChannels.TABS_EXIT_FULLSCREEN, listener)
      return () => ipcRenderer.removeListener(IpcChannels.TABS_EXIT_FULLSCREEN, listener)
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
}
