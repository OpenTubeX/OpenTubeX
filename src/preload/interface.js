import { ipcRenderer, webFrame } from 'electron/renderer'
import { IpcChannels } from '../constants.js'

/**
 * Linux fix for dynamically updating theme preference, this works on
 * all systems running the electron app.
 */
ipcRenderer.on(IpcChannels.NATIVE_THEME_UPDATE, (_, shouldUseDarkColors) => {
  document.body.dataset.systemTheme = shouldUseDarkColors ? 'dark' : 'light'
})

// Force update the window title whenever the page title changes
// as Electron doesn't do it when the back button is pressed, probably a bug.
// It doesn't even fire the `page-title-updated` in the main process.

function getTitleForCurrentRoute(title) {
  const trimmedTitle = title.trim()
  if (
    window.location.hash.startsWith('#/watch/') &&
    (trimmedTitle.length === 0 || trimmedTitle === 'OpenTubeX')
  ) {
    return window.location.hash.slice(1)
  }

  return title
}

const titleMutationObserver = new MutationObserver((mutations) => {
  const title = mutations[0].addedNodes[0].textContent
  ipcRenderer.send(IpcChannels.SET_WINDOW_TITLE, getTitleForCurrentRoute(title))
})
document.addEventListener('DOMContentLoaded', () => {
  titleMutationObserver.observe(document.querySelector('title'), { childList: true })
}, { once: true })

let currentUpdateSearchInputTextListener

export default {
  /**
   * @param {string} title
   */
  setWindowTitle: (title) => {
    ipcRenderer.send(IpcChannels.SET_WINDOW_TITLE, getTitleForCurrentRoute(title))
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
  requestPiP: () => {
    ipcRenderer.invoke(IpcChannels.TABS_REQUEST_PICTURE_IN_PICTURE).catch()
  },

  // Allows programmatic toggling of fullscreen without accompanying user interaction.
  // See: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation#transient_activation
  requestFullscreen: () => {
    webFrame.executeJavaScript('document.querySelector("video.player")?.ui.getControls().toggleFullScreen()', true).catch()
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
   * @param {string} scriptPath
   * @returns {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
   */
  executeIpBlockRecoveryScript: async (scriptPath) => {
    return await ipcRenderer.invoke(IpcChannels.EXECUTE_IP_BLOCK_RECOVERY_SCRIPT, scriptPath)
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
   * @param {(route: string) => void} handler
   */
  handleChangeView: (handler) => {
    ipcRenderer.on(IpcChannels.CHANGE_VIEW, (_, route) => {
      handler(route)
    })
  },

  /**
   * @param {(url: string) => void} handler
   */
  handleOpenUrl: (handler) => {
    ipcRenderer.on(IpcChannels.OPEN_URL, (_, url) => {
      handler(url)
    })
    ipcRenderer.send(IpcChannels.APP_READY)
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
    /**
     * Get the current tab state
     * @returns {Promise<{tabs: Array<{id: string, url: string, title: string, isActive: boolean}>, activeTabId: string|null}>}
     */
    getState: () => {
      return ipcRenderer.invoke(IpcChannels.TABS_GET_STATE)
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
     * Check whether this renderer owns the active tab.
     * @returns {Promise<boolean>}
     */
    isActive: () => {
      return ipcRenderer.invoke(IpcChannels.TABS_IS_ACTIVE)
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
     * Ask the main process to refresh this tab's cached thumbnail preview.
     * Useful when renderer-only UI changes without navigation/loading events.
     * @param {{ delayMs?: number }} [options]
     */
    requestPreviewRefresh: (options = {}) => {
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
     * Reload the active tab
     */
    reload: () => {
      ipcRenderer.send(IpcChannels.TABS_RELOAD)
    },

    /**
     * Listen for reload request from main (e.g. menu "Reload Tab")
     * @param {() => void} handler
     */
    onRequestReload: (handler) => {
      ipcRenderer.on(IpcChannels.TABS_REQUEST_RELOAD, handler)
    },

    /**
     * Set playback state for the current tab (used to show play indicator)
     * @param {'playing' | 'paused' | 'none'} state - The current playback state
     */
    setPlaybackState: (state) => {
      ipcRenderer.send(IpcChannels.TABS_SET_PLAYBACK_STATE, state)
    },

    /**
     * Set loading state for client-side tab navigation.
     * @param {boolean} isLoading
     */
    setLoading: (isLoading) => {
      ipcRenderer.send(IpcChannels.TABS_SET_LOADING, isLoading === true)
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
     * @param {{ tabId: string | null, isTabBar: boolean }} payload
     */
    setContextMenuTab: (payload) => {
      ipcRenderer.send(IpcChannels.TABS_SET_CONTEXT_MENU_TAB, payload)
    },

    /**
     * Listen for tab state updates
     * @param {(state: {tabs: Array, activeTabId: string|null}) => void} handler
     */
    onStateUpdated: (handler) => {
      ipcRenderer.on(IpcChannels.TABS_STATE_UPDATED, (_, state) => {
        handler(state)
      })
    },

    /**
     * Listen for exit fullscreen notification (when tab becomes inactive)
     * @param {() => void} handler
     * @returns {() => void} Function to remove the listener
     */
    onExitFullscreen: (handler) => {
      const listener = () => {
        handler()
      }
      ipcRenderer.on(IpcChannels.TABS_EXIT_FULLSCREEN, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.TABS_EXIT_FULLSCREEN, listener)
      }
    },

    /**
     * Listen for active tab changes (notifies this tab when it becomes active or inactive)
     * @param {(isActive: boolean) => void} handler
     * @returns {() => void} Function to remove the listener
     */
    onActiveChanged: (handler) => {
      const listener = (_event, isActive) => {
        handler(isActive)
      }
      ipcRenderer.on(IpcChannels.TABS_ACTIVE_CHANGED, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.TABS_ACTIVE_CHANGED, listener)
      }
    }
  }
}
