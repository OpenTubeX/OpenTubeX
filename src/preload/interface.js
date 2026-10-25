import { ipcRenderer, webFrame } from 'electron/renderer'
import { DBActions, IpcChannels } from '../constants.js'
import { tabs } from './tabs.js'

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
const ytDlpBinaryUpdatedListeners = new Set()
const castProgressListeners = new Map()

ipcRenderer.on(IpcChannels.CAST_PROGRESS, (_, progress) => {
  castProgressListeners.get(progress?.preparationId)?.(progress.stage)
})

ipcRenderer.on(IpcChannels.YT_DLP_BINARY_DOWNLOAD_PROGRESS, (_, progress) => {
  for (const listener of ytDlpBinaryDownloadProgressListeners) {
    listener(progress)
  }
})

ipcRenderer.on(IpcChannels.YT_DLP_BINARY_UPDATED, () => {
  for (const listener of ytDlpBinaryUpdatedListeners) {
    listener()
  }
})

/** @type {Set<{ handler: (videoId: string, scheduled: boolean) => void }>} */
const liveReminderUpdatedListeners = new Set()
const videoMetadataCacheClearedListeners = new Set()
/** @type {Set<{ handler: (minimized: boolean) => void }>} */
const windowMinimizedStateListeners = new Set()
/** @type {Set<{ handler: (focused: boolean) => void }>} */
const windowFocusedStateListeners = new Set()

// Video lists subscribe once per row, which would exceed Node's listener
// warning threshold on this channel, so they share a single IPC listener.
ipcRenderer.on(IpcChannels.LIVE_REMINDER_UPDATED, (_, videoId, scheduled) => {
  for (const { handler } of liveReminderUpdatedListeners) {
    handler(videoId, scheduled)
  }
})

ipcRenderer.on(IpcChannels.VIDEO_METADATA_CACHE_CLEARED, () => {
  for (const listener of videoMetadataCacheClearedListeners) {
    listener()
  }
})

ipcRenderer.on(IpcChannels.WINDOW_MINIMIZED_STATE, (_, minimized) => {
  for (const { handler } of windowMinimizedStateListeners) {
    handler(minimized)
  }
})

ipcRenderer.on(IpcChannels.WINDOW_FOCUSED_STATE, (_, focused) => {
  for (const { handler } of windowFocusedStateListeners) {
    handler(focused)
  }
})

export default {
  /**
   * @param {string[]} sections
   * @param {object} [settings] transferable settings, read from the profile when omitted
   * @returns {Promise<Uint8Array>} the zip archive
   */
  createBackupArchive: (sections, settings) => ipcRenderer.invoke(IpcChannels.CREATE_BACKUP_ARCHIVE, sections, settings),
  chooseScheduledBackupFolder: () => ipcRenderer.invoke(IpcChannels.CHOOSE_SCHEDULED_BACKUP_FOLDER),
  watchQueue: {
    update: async request => {
      const snapshot = await ipcRenderer.invoke(IpcChannels.WATCH_QUEUE_UPDATE, JSON.parse(JSON.stringify(request)))
      if (snapshot.error) throw new Error(snapshot.error)
      return snapshot
    },
    onUpdated: handler => {
      const listener = (_event, snapshot) => handler(snapshot)
      ipcRenderer.on(IpcChannels.WATCH_QUEUE_UPDATED, listener)
      return () => ipcRenderer.removeListener(IpcChannels.WATCH_QUEUE_UPDATED, listener)
    }
  },
  libraryNotices: {
    /**
     * Gets the library notices no window has dismissed yet.
     * @returns {Promise<Array<'olderVersionChanges' | 'libraryFormatChanged'>>}
     */
    get: () => ipcRenderer.invoke(IpcChannels.GET_LIBRARY_NOTICES),
    /**
     * @param {'olderVersionChanges' | 'libraryFormatChanged'} key
     */
    dismiss: key => ipcRenderer.send(IpcChannels.DISMISS_LIBRARY_NOTICE, key),
    /**
     * @param {() => void} handler
     * @returns {() => void}
     */
    onChanged: handler => {
      const listener = () => handler()
      ipcRenderer.on(IpcChannels.LIBRARY_NOTICES_CHANGED, listener)
      return () => ipcRenderer.removeListener(IpcChannels.LIBRARY_NOTICES_CHANGED, listener)
    }
  },
  setTrayIcon: image => ipcRenderer.invoke(IpcChannels.SET_TRAY_ICON, image),
  shareLink: url => ipcRenderer.invoke(IpcChannels.SHARE_LINK, url),
  startupSplashReady: () => ipcRenderer.send(IpcChannels.STARTUP_SPLASH_READY),
  startupAppearance: {
    background: process.argv.find(argument => argument.startsWith('--startup-background='))?.slice('--startup-background='.length),
    dark: process.argv.includes('--startup-dark=true'),
    systemAccentColor: process.argv.find(argument => argument.startsWith('--system-accent-color='))?.slice('--system-accent-color='.length),
    hideSplash: process.argv.includes('--hide-startup-splash=true')
  },
  customTitleBar: process.argv.includes('--custom-title-bar=true'),
  /**
   * @param {{ color: string, symbolColor: string, height: number }} overlay height in CSS pixels
   */
  setTitleBarOverlay: ({ color, symbolColor, height }) => {
    ipcRenderer.send(IpcChannels.SET_TITLE_BAR_OVERLAY, {
      color,
      symbolColor,
      height: height * webFrame.getZoomFactor()
    })
  },
  /**
   * Middle clicks on the custom title bar that the window received instead of
   * the page, on Windows.
   * @param {(point: { x: number, y: number }) => void} handler point in CSS pixels
   * @returns {() => void} unsubscribe
   */
  onTitleBarMiddleClick: handler => {
    const listener = (_event, { x, y }) => {
      const zoomFactor = webFrame.getZoomFactor()
      handler({ x: x / zoomFactor, y: y / zoomFactor })
    }
    ipcRenderer.on(IpcChannels.TITLE_BAR_MIDDLE_CLICK, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TITLE_BAR_MIDDLE_CLICK, listener)
  },
  /** Window controls the renderer draws with the custom title bar on Linux. */
  windowControls: {
    /** Plasma's Breeze decoration, or Adwaita for GNOME and other desktops */
    style: /(^|:)KDE(:|$)/i.test(process.env.XDG_CURRENT_DESKTOP ?? '') ? 'breeze' : 'adwaita',
    /**
     * @returns {Promise<{ layout: string, maximized: boolean, fullScreen: boolean }>}
     */
    getState: () => ipcRenderer.invoke(IpcChannels.WINDOW_CONTROLS_GET),
    /**
     * @param {(state: { layout: string, maximized: boolean, fullScreen: boolean }) => void} handler
     * @returns {() => void} unsubscribe
     */
    onState: handler => {
      const listener = (_event, state) => handler(state)
      ipcRenderer.on(IpcChannels.WINDOW_CONTROLS_STATE, listener)
      return () => ipcRenderer.removeListener(IpcChannels.WINDOW_CONTROLS_STATE, listener)
    },
    /**
     * @param {'minimize' | 'maximize' | 'close'} action
     */
    run: action => ipcRenderer.send(IpcChannels.WINDOW_CONTROL_ACTION, action)
  },
  isFlatpak: process.env.FLATPAK_ID !== undefined,
  /**
   * @returns {{ usedHeapSize: number, heapSizeLimit: number }} V8 heap usage of this renderer in KB
   */
  getHeapStatistics: () => {
    const { usedHeapSize, heapSizeLimit } = process.getHeapStatistics()
    return { usedHeapSize, heapSizeLimit }
  },
  runtimeVersions: Object.freeze({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8
  }),

  /**
   * @returns {Promise<string | undefined>}
   */
  getDeviceName: () => {
    return ipcRenderer.invoke(IpcChannels.GET_DEVICE_NAME)
  },

  /**
   * @returns {Promise<{platform: string, architecture: string, release: string} | undefined>}
   */
  getDeviceInfo: () => {
    return ipcRenderer.invoke(IpcChannels.GET_DEVICE_INFO)
  },

  /**
   * @param {{ time: number, level: string, message: string }} entry
   */
  addDiagnosticLogEntry: (entry) => {
    ipcRenderer.send(IpcChannels.DIAGNOSTIC_LOG_ADD, entry)
  },

  /**
   * @returns {Promise<{ time: number, level: string, source: string, message: string }[]>}
   */
  getDiagnosticLog: () => {
    return ipcRenderer.invoke(IpcChannels.DIAGNOSTIC_LOG_GET)
  },

  /**
   * @returns {Promise<void>}
   */
  clearDiagnosticLog: () => {
    return ipcRenderer.invoke(IpcChannels.DIAGNOSTIC_LOG_CLEAR)
  },

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
   * @returns {Promise<string[]>}
   */
  getSystemFonts: () => {
    return ipcRenderer.invoke(IpcChannels.GET_SYSTEM_FONTS)
  },

  /** @returns {Promise<string | null>} */
  getSystemAccentColor: () => ipcRenderer.invoke(IpcChannels.GET_SYSTEM_ACCENT_COLOR),

  /**
   * @param {(color: string | null) => void} handler
   * @returns {() => void}
   */
  handleSystemAccentColorUpdated: (handler) => {
    const listener = (_, color) => handler(color)
    ipcRenderer.on(IpcChannels.SYSTEM_ACCENT_COLOR_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.SYSTEM_ACCENT_COLOR_UPDATED, listener)
  },

  /**
   * @returns {Promise<string>}
   */
  readClipboard: () => {
    return ipcRenderer.invoke(IpcChannels.READ_CLIPBOARD)
  },

  loadCustomTheme: () => {
    return ipcRenderer.invoke(IpcChannels.CUSTOM_THEME_LOAD)
  },

  saveCustomTheme: (theme) => {
    return ipcRenderer.invoke(IpcChannels.CUSTOM_THEME_SAVE, theme)
  },

  deleteCustomTheme: (themeId) => {
    return ipcRenderer.invoke(IpcChannels.CUSTOM_THEME_DELETE, themeId)
  },

  replaceCustomThemes: (themes) => {
    return ipcRenderer.invoke(IpcChannels.CUSTOM_THEME_REPLACE, themes)
  },

  handleCustomThemeUpdated: (handler) => {
    const listener = (_, theme) => handler(theme)
    ipcRenderer.on(IpcChannels.CUSTOM_THEME_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.CUSTOM_THEME_UPDATED, listener)
  },

  /**
   * @returns {Promise<boolean>}
   */
  isWaylandPlatform: () => {
    return ipcRenderer.invoke(IpcChannels.IS_WAYLAND_PLATFORM)
  },

  /**
   * @returns {Promise<boolean>}
   */
  supportsAutoPictureInPictureMinimize: () => {
    return ipcRenderer.invoke(IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE)
  },

  reopenClosedWindow: () => {
    ipcRenderer.send(IpcChannels.RESTORE_CLOSED_WINDOW)
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

  /**
   * @returns {Promise<boolean>}
   */
  getDisableHardwareAcceleration: () => {
    return ipcRenderer.invoke(IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION)
  },

  toggleReplaceHttpCache: () => {
    ipcRenderer.send(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE)
  },

  toggleDisableHardwareAcceleration: () => {
    ipcRenderer.send(IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION)
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
    const subscription = { handler }
    windowMinimizedStateListeners.add(subscription)
    return () => windowMinimizedStateListeners.delete(subscription)
  },

  /**
   * Listen for native window focus changes, which are more reliable than DOM
   * focus events when another application closes its covering window.
   * @param {(focused: boolean) => void} handler
   * @returns {() => void} unsubscribe
   */
  handleWindowFocusedState: (handler) => {
    const subscription = { handler }
    windowFocusedStateListeners.add(subscription)
    return () => windowFocusedStateListeners.delete(subscription)
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
   * @param {{ videoId: string, duration: number, responseLanguage: 'ru' | 'en' | 'kk', cache?: boolean }} payload
   * @returns {Promise<{ translated: boolean, url?: string, remainingTime: number, status: number }>}
   */
  requestVoiceOverTranslation: (payload) => {
    return ipcRenderer.invoke(IpcChannels.VOICE_OVER_TRANSLATION_REQUEST, payload)
  },

  /**
   * @param {string} videoId YouTube video ID
   * @param {string} context
   * @param {string} initialAttestationData
   * @param {string} ytConfig
   * @returns {Promise<string>}
   */
  generatePoToken: (videoId, context, initialAttestationData, ytConfig) => {
    return ipcRenderer.invoke(IpcChannels.GENERATE_PO_TOKEN, videoId, context, initialAttestationData, ytConfig)
  },

  openProfileDirectory: () => {
    ipcRenderer.send(IpcChannels.OPEN_PROFILE_DIRECTORY)
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

  dlna: {
    discover: () => navigator.userActivation.isActive
      ? ipcRenderer.invoke(IpcChannels.DLNA_DISCOVER)
      : Promise.resolve([]),
    start: async payload => {
      if (!navigator.userActivation.isActive) return { error: 'Casting requires a user action' }
      return ipcRenderer.invoke(IpcChannels.DLNA_START, payload)
    },
    stop: castId => ipcRenderer.invoke(IpcChannels.DLNA_STOP, castId),
    hasFailed: castId => ipcRenderer.invoke(IpcChannels.DLNA_HAS_FAILED, castId),
    recover: (castId, payload) => ipcRenderer.invoke(IpcChannels.DLNA_RECOVER, castId, payload)
  },

  chromecast: {
    discover: () => navigator.userActivation.isActive
      ? ipcRenderer.invoke(IpcChannels.CAST_DISCOVER)
      : Promise.resolve([]),
    start: async (preparePayload, onProgress) => {
      // Authorize the click before subtitle preparation can outlive activation.
      if (!navigator.userActivation.isActive) return { error: 'Casting requires a user action', errorCode: 'CAST_NOT_AUTHORIZED' }
      const preparation = await ipcRenderer.invoke(IpcChannels.CAST_PREPARE)
      if (preparation.error) return preparation
      castProgressListeners.set(preparation.preparationId, onProgress)
      try {
        const payload = await preparePayload()
        if (!payload) return { error: 'Cast start cancelled', errorCode: 'CAST_CANCELLED' }
        return await ipcRenderer.invoke(IpcChannels.CAST_START, payload, preparation.preparationId)
      } finally {
        castProgressListeners.delete(preparation.preparationId)
        ipcRenderer.send(IpcChannels.CAST_CANCEL_PREPARATION, preparation.preparationId)
      }
    },
    status: castId => ipcRenderer.invoke(IpcChannels.CAST_STATUS, castId),
    control: (castId, action, value) => navigator.userActivation.isActive
      ? ipcRenderer.invoke(IpcChannels.CAST_CONTROL, castId, action, value)
      : Promise.resolve({ error: 'Casting requires a user action', errorCode: 'CAST_NOT_AUTHORIZED' }),
    stop: castId => ipcRenderer.invoke(IpcChannels.CAST_STOP, castId)
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
   * @param {number} [retryDownloadId]
   * @returns {Promise<{ id: number } | { error: string } | { skipped: string } | null>}
   */
  ytDlpDownload: (payload, retryDownloadId) => {
    // require the user to have interacted with the page recently
    if (payload?.automatic === true || navigator.userActivation.isActive) {
      return ipcRenderer.invoke(IpcChannels.YT_DLP_DOWNLOAD, payload, retryDownloadId)
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
   * @param {number} id
   * @param {'pause' | 'resume' | 'move'} action
   * @param {number} [value]
   */
  ytDlpControlDownload: (id, action, value) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CONTROL_DOWNLOAD, id, action, value)
  },

  /**
   * @param {'pause-all' | 'resume-all' | 'retry-all' | 'refresh'} action
   */
  ytDlpQueueAction: (action) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_QUEUE_ACTION, action)
  },

  /**
   * @param {number} id
   */
  ytDlpOpenDownload: (id) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_OPEN_DOWNLOAD, id)
  },

  /**
   * @param {number} id
   */
  ytDlpRemoveDownload: (id) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_REMOVE_DOWNLOAD, id)
  },

  ytDlpListDownloads: () => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_LIST_DOWNLOADS)
  },

  /**
   * @param {number[]} ids
   */
  ytDlpClearDownloads: (ids) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CLEAR_DOWNLOADS, ids)
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
   * @param {(ids: number[]) => void} handler
   */
  handleYtDlpDownloadsRemoved: (handler) => {
    ipcRenderer.on(IpcChannels.YT_DLP_DOWNLOADS_REMOVED, (event, ids) => {
      handler(ids)
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

  ytDlpChooseCookies: (currentPath) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CHOOSE_COOKIES, currentPath)
  },

  ytDlpChooseBrowserProfile: (currentPath) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CHOOSE_BROWSER_PROFILE, currentPath)
  },

  /**
   * @param {{
   *   ytDlpSource: 'system' | 'managed',
   *   ytDlpPath: string,
   *   ffmpegSource: 'system' | 'managed',
   *   ffmpegPath: string
   * } | undefined} [options]
   * @returns {Promise<{
   *   ytDlp: import('../main/ytDlp').YtDlpInfo,
   *   ffmpeg: import('../main/ytDlp').YtDlpBinaryInfo,
   *   ffprobe: import('../main/ytDlp').YtDlpBinaryInfo
   * } | null>}
   */
  ytDlpGetInfo: (options) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_GET_INFO, options)
  },

  ytDlpCancelHistoryRepair: () => ipcRenderer.invoke(IpcChannels.YT_DLP_CANCEL_HISTORY_REPAIR),
  ytDlpGetHistoryMetadata: videoId => ipcRenderer.invoke(IpcChannels.YT_DLP_GET_HISTORY_METADATA, videoId),

  /**
   * @param {string} videoId
   * @param {boolean} [useDefaultClients]
   * @param {boolean} [useAuthentication]
   * @param {boolean} [includeSubtitles]
   * @returns {Promise<import('../main/ytDlp').YtDlpPlaybackInfo | { error: string } | null>}
   */
  ytDlpGetPlaybackInfo: (videoId, useDefaultClients = false, useAuthentication = false, includeSubtitles = true) => {
    return ipcRenderer.invoke(
      IpcChannels.YT_DLP_GET_PLAYBACK_INFO,
      videoId,
      useDefaultClients,
      useAuthentication,
      includeSubtitles
    )
  },

  twitchChatReplayPage: (videoId, position) => ipcRenderer.invoke(IpcChannels.TWITCH_CHAT_REPLAY_PAGE, videoId, position),
  twitchSubOnlyVod: videoId => ipcRenderer.invoke(IpcChannels.TWITCH_SUB_ONLY_VOD, videoId),

  /**
   * @param {string} currentVideoId
   * @returns {Promise<import('../main/ytDlp').YtDlpRecommendation[] | { error: string } | null>}
   */
  ytDlpGetRecommendations: (currentVideoId) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_GET_RECOMMENDATIONS, currentVideoId)
  },

  ytDlpSearch: (query, params, page) => ipcRenderer.invoke(IpcChannels.YT_DLP_SEARCH, query, params, page),

  ytDlpGetSubtitle: (url) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_GET_SUBTITLE, url)
  },

  ytDlpPlaybackCacheGet: (videoId, cacheKey) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_PLAYBACK_CACHE_GET, videoId, cacheKey)
  },

  ytDlpPlaybackCacheSet: (videoId, cacheKey, expiryTime, source) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_PLAYBACK_CACHE_SET, videoId, cacheKey, expiryTime, source)
  },

  ytDlpPlaybackCacheDelete: (videoId) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_PLAYBACK_CACHE_DELETE, videoId)
  },

  ytDlpPlaybackCacheClear: () => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_PLAYBACK_CACHE_CLEAR)
  },

  /**
   * @param {'yt-dlp' | 'ffmpeg'} binary
   * @returns {Promise<{ available: boolean } | { error: string } | null>}
   */
  ytDlpCheckBinaryUpdate: (binary) => {
    return ipcRenderer.invoke(IpcChannels.YT_DLP_CHECK_BINARY_UPDATE, binary)
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
   * @param {() => void} handler
   * @returns {() => void}
   */
  addYtDlpBinaryUpdatedListener: (handler) => {
    ytDlpBinaryUpdatedListeners.add(handler)
    return () => ytDlpBinaryUpdatedListeners.delete(handler)
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
   * @param {string} url
   * @returns {Promise<string>}
   */
  resolveFavicon: (url) => {
    return ipcRenderer.invoke(IpcChannels.RESOLVE_FAVICON, url)
  },

  /**
   * Authorizes one queued rule write while its initiating user action is active.
   * @returns {((value: string) => Promise<null>) | null}
   */
  prepareAutomaticDownloadRulesWrite: () => {
    if (!navigator.userActivation.isActive) return null
    let used = false
    return value => {
      if (used) return Promise.reject(new Error('Automatic download rule writer already used'))
      used = true
      if (typeof value !== 'string') return Promise.reject(new Error('Automatic download rules must be a string'))
      return ipcRenderer.invoke(IpcChannels.DB_SETTINGS, {
        action: DBActions.GENERAL.UPSERT,
        data: { _id: 'ytDlpAutomaticDownloadRules', value }
      })
    }
  },

  /**
   * @param {number} action
   * @param {any} [data]
   */
  dbSettings: (action, data) => {
    if (action === DBActions.GENERAL.UPSERT && data?._id === 'ytDlpAutomaticDownloadRules' &&
      !navigator.userActivation.isActive) {
      return Promise.resolve(null)
    }
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

  dbRecommendations: (action, data) => ipcRenderer.invoke(IpcChannels.DB_RECOMMENDATIONS, { action, data }),

  handleSyncRecommendations: handler => {
    ipcRenderer.on(IpcChannels.SYNC_RECOMMENDATIONS, (_, data) => handler(data))
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
   * @param {(route: string, tabId?: string, toggle?: boolean) => void} handler
   * @returns {() => void}
   */
  handleChangeView: (handler) => {
    const listener = (_event, payload) => {
      if (typeof payload === 'string') {
        handler(payload)
      } else {
        handler(payload?.route, payload?.tabId, payload?.toggle)
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
   * @param {[string, string] | null} icon
   * @param {'open-sync-settings' | null} buttonAction
   */
  showToastOnAllTabs: (message, time, icon = null, buttonAction = null) => {
    ipcRenderer.send(IpcChannels.SHOW_TOAST, message, time, icon, buttonAction)
  },

  liveReminder: {
    list: () => ipcRenderer.invoke(IpcChannels.LIVE_REMINDER_LIST),

    /**
     * @param {string} videoId
     */
    get: (videoId) => ipcRenderer.invoke(IpcChannels.LIVE_REMINDER_GET, videoId),

    /**
     * @param {{ videoId: string, startTimestamp: number, notificationTitle: string, notificationBody: string }} reminder
     */
    schedule: (reminder) => ipcRenderer.invoke(IpcChannels.LIVE_REMINDER_SCHEDULE, reminder),

    /**
     * @param {string} videoId
     */
    cancel: (videoId) => ipcRenderer.invoke(IpcChannels.LIVE_REMINDER_CANCEL, videoId),

    /**
     * @param {(videoId: string, scheduled: boolean) => void} handler
     * @returns {() => void}
     */
    onUpdated: (handler) => {
      const subscription = { handler }
      liveReminderUpdatedListeners.add(subscription)
      return () => liveReminderUpdatedListeners.delete(subscription)
    }
  },

  videoMetadataCache: {
    /**
     * @param {{ videoId: string, title: string, description: string, thumbnailUrl: string, observedAt: number }} metadata
     * @returns {Promise<{ revisions: object[] } | null>}
     */
    update: (metadata) => ipcRenderer.invoke(IpcChannels.VIDEO_METADATA_CACHE_UPDATE, metadata),

    /** @returns {Promise<number>} */
    getSize: () => ipcRenderer.invoke(IpcChannels.VIDEO_METADATA_CACHE_GET_SIZE),

    /** @returns {Promise<boolean>} */
    clear: () => ipcRenderer.invoke(IpcChannels.VIDEO_METADATA_CACHE_CLEAR),

    /**
     * @param {() => void} handler
     * @returns {() => void}
     */
    onCleared: (handler) => {
      videoMetadataCacheClearedListeners.add(handler)
      return () => videoMetadataCacheClearedListeners.delete(handler)
    }
  },

  storage: {
    /** @returns {Promise<Record<string, number | null>>} */
    getUsage: () => ipcRenderer.invoke(IpcChannels.STORAGE_GET_USAGE),

    /**
     * @param {'http-cache' | 'tab-previews' | 'yt-dlp-playback' | 'player-cache'} category
     * @returns {Promise<boolean>}
     */
    clear: (category) => ipcRenderer.invoke(IpcChannels.STORAGE_CLEAR, category),

    /** @returns {Promise<boolean>} */
    compactDatabases: () => ipcRenderer.invoke(IpcChannels.STORAGE_COMPACT_DATABASES)
  },

  subscriptionAutoRefresh: {
    processFeed: value => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'processFeed', value),
    onBackgroundResultsAvailable: handler => {
      const listener = () => handler()
      ipcRenderer.on(IpcChannels.SUBSCRIPTION_BACKGROUND, listener)
      return () => ipcRenderer.removeListener(IpcChannels.SUBSCRIPTION_BACKGROUND, listener)
    },
    configureBackground: configuration => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'configure', configuration),
    nextBackgroundResult: () => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'next'),
    acknowledgeBackgroundResult: id => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'acknowledge', id),
    backgroundCompleted: value => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'completed', value),
    configureUploadNotifications: configuration => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'configureUploadNotifications', configuration),
    observeUploads: value => ipcRenderer.invoke(IpcChannels.SUBSCRIPTION_BACKGROUND, 'observeUploads', value),
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
     * Ask the renderer that owns the subscription refresh to cancel it.
     */
    cancel: () => {
      ipcRenderer.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL)
    },

    /**
     * Listen for cancellation requests from other windows.
     * @param {() => void} handler
     * @returns {() => void}
     */
    onCancelRequested: (handler) => {
      const listener = () => {
        handler()
      }
      ipcRenderer.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_CANCEL, listener)
      }
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
     * @param {(state: {inProgress: boolean, percentage: number, tab: string | null}) => void} handler
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
     * Listen for a mark-seen request from a tabbed New feed category's context menu.
     * @param {(payload: {tabId: string, feedTab: 'videos' | 'shorts' | 'live' | 'posts'}) => void} handler
     * @returns {() => void}
     */
    onRequestMarkSeen: (handler) => {
      const listener = (_event, payload) => handler(payload)
      ipcRenderer.on(IpcChannels.SUBSCRIPTION_FEED_REQUEST_MARK_SEEN, listener)
      return () => ipcRenderer.removeListener(IpcChannels.SUBSCRIPTION_FEED_REQUEST_MARK_SEEN, listener)
    },

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

  contextMenu: {
    /**
     * Build the custom context menu for the element under the pointer.
     * @param {object} parameters
     * @returns {Promise<{sessionId: number, items: Array}>}
     */
    open: (parameters) => {
      return ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_OPEN, parameters)
    },

    /**
     * Run an action from the currently open custom context menu.
     * @param {number} sessionId
     * @param {string} actionId
     * @returns {Promise<void>}
     */
    execute: (sessionId, actionId) => {
      return ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_EXECUTE, { sessionId, actionId })
    }
  },

  /**
   * @param {(message: string, time: number | null, icon: [string, string] | null, buttonAction: 'open-sync-settings' | null) => void} handler
   * @returns {() => void}
   */
  handleShowToast: (handler) => {
    const listener = (_, message, time, icon, buttonAction) => {
      handler(message, time, icon, buttonAction)
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
  tabs
}
