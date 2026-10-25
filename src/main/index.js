import { ClosedWindowHistory } from './tabs/ClosedWindowHistory.js'
import { createFileWatchQueue } from './watchQueue.js'
import {
  app, BrowserWindow, dialog, Menu, ipcMain,
  powerSaveBlocker, screen, session,
  nativeTheme, systemPreferences, net, protocol, clipboard,
  shell, Tray, Notification, ShareMenu, nativeImage
} from 'electron'
import './applicationDataBootstrap'
import { isPortableBuild } from './applicationDataPaths'
import path from 'path'
import { createDesktopShareHandler, loadWindowsShare } from './desktopShare'
import cp from 'child_process'
import { getFonts } from 'font-list'

import {
  IpcChannels,
  DBActions,
  SyncEvents,
  PlaylistVideoAddResult,
  getConfiguredKeyboardShortcuts,
  getElectronAccelerator,
  SEARCH_CHAR_LIMIT,
  BASE_THEME_BACKGROUND_COLORS,
  LIGHT_BASE_THEMES,
  DARK_BASE_THEMES,
} from '../constants'
import { isCustomThemeValue } from '../customTheme'
import { MATERIAL_SYSTEM_SEED, MATERIAL_THEME_VALUES, materialColorScheme, materialSeedPalette, materialThemeMode, normalizeSystemAccentColor } from '../materialTheme.js'
import { resolveSystemTheme } from '../appearanceSettings'
import { applySyncServerUserAgent } from '../syncServerUserAgent'
import * as baseHandlers from '../datastores/handlers/base'
import { liveReminders, onLegacyDatastoreChanges, onLegacyDatastoreImported, waitForDatastores } from '../datastores'
import { extractExpiryTimestamp, ImageCache } from './ImageCache'
import { constants as fsConstants, existsSync } from 'fs'
import asyncFs from 'fs/promises'
import { promisify } from 'util'
import { hostname, release } from 'node:os'
import { brotliDecompress } from 'zlib'

import packageDetails from '../../package.json'
import { handleOpenInExternalPlayer } from './externalPlayer'
import { stopDlnaCast } from './dlnaCast'
import { ChromecastManager } from './chromecast'
import { FcastManager } from './fcast'
import { handleTwitchChatReplayPage, handleTwitchSubOnlyVod } from './twitchChat'
import { applyTwitchPlaylistOrigin } from '../twitchPlaylistOrigin'
import { isYtDlpStoryboardUrl, getYtDlpExternalStreamCookieHeader, getYtDlpExternalStreamHeaders, refreshYtDlpDownloadQueue, restoreYtDlpDownloadQueue, shutdownYtDlpDownloads } from './ytDlp'
import { applyYtDlpPlaybackCacheSettings } from './ytDlpPlaybackCache'
import { generatePoToken } from './poTokenGenerator'
import { buildProxyUrl, DEFAULT_PROXY_SETTINGS, isOpenTubeXUrl } from './utils'
import { isInvidiousInstanceUrl } from './invidiousAuthorization'
import { normalizeYatteeServerUrl } from '../renderer/helpers/api/yattee'
import { usesInvidiousApi, usesInvidiousInstance } from '../apiBackends'
import { RendererCors } from './rendererCors'
import { TabManager } from './tabs/TabManager'
import { tabPreviewStorage } from './tabs/TabPreviewStorage'
import { setupTabsIPC } from './tabs/tabIpc'
import { clearAllTabSessions, loadAllTabSessions } from './tabs/TabSessionStore'
import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from '../renderer/helpers/share'
import { DEFAULT_SEARCH_ENGINES_SETTING } from '../searchEngines'
import { LiveReminderManager } from './LiveReminderManager'
import { requestVoiceOverTranslation } from './voiceOverTranslation'
import { setupVideoMetadataCacheIpc } from './videoMetadataCache'
import { shouldAdvanceDockMediaSequence } from './dockMediaSession'
import { clearStorage, compactStorageDatabases, getStorageUsage } from './storage'
import { getLinuxDistributionInfo } from './linuxDistribution'
import {
  createKdeWaylandWindowStateBackend,
  isWaylandPlatform as detectWaylandPlatform,
  monitorKdeWaylandWindowState,
  shouldMonitorKdeWaylandWindowState,
} from './kdeWaylandWindowState'
import { createSubscriptionBackgroundService } from './subscriptionBackground'
import { createUploadNotifier } from './uploadNotifications'
import { supportsNativeNotifications } from './nativeNotifications'
import { getTrayMenuIcon } from './trayMenuIcons'
import { createScheduledBackups } from './scheduledBackups'
import { createBackupArchiveFactory } from './backupArchive'
import { createDatastoreRequestTracker } from './datastoreRequests'
import { getWindowButtonLayout, onWindowButtonLayoutChanged } from './windowButtonLayout'
import { setDiagnosticLogging, setupDiagnosticLogIpc } from './diagnosticLog'
import { createMainTranslator } from './mainTranslator'
import { createConfirmations } from './confirmations'
import { setupCustomThemes } from './customThemes'
import { contextMenuLabel, setupContextMenu, truncateSelectionForLabel } from './contextMenu'
import { setupIpBlockRecoveryIpc } from './ipBlockRecovery'
import { isSubscriptionAutoRefreshInProgress, setupSubscriptionAutoRefreshIpc } from './subscriptionAutoRefresh'
import { setupCastIpc } from './castIpc'
import { createUrlOpener, getDirectOpenUrl } from './openUrl'
import { handleDownloadMediaRequest, setupYtDlpIpc } from './ytDlpIpc'

function getSystemAccentColor() {
  try {
    return normalizeSystemAccentColor(systemPreferences.getAccentColor())
  } catch {
    return null
  }
}

const castSenderPath = path.resolve(__dirname, process.env.NODE_ENV === 'development' ? '../../dist/opentubex-cast' : 'opentubex-cast') + (process.platform === 'win32' ? '.exe' : '')
const chromecast = new ChromecastManager(castSenderPath.replace(/\.asar([\\/])/, '.asar.unpacked$1'), powerSaveBlocker)
// The packaged Cast helper also discovers FCast receivers.
const fcast = new FcastManager(castSenderPath.replace(/\.asar([\\/])/, '.asar.unpacked$1'), powerSaveBlocker, { appVersion: packageDetails.version })
const brotliDecompressAsync = promisify(brotliDecompress)
if (process.argv.includes('--version')) {
  console.log(`v${packageDetails.version} Beta`) // eslint-disable-line no-console
  app.exit()
} else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  app.exit()
} else {
  // Only allow single instance of the application
  // Exit if we didn't get the lock, because another instance already has it
  if (process.env.NODE_ENV !== 'development' && !app.requestSingleInstanceLock()) {
    app.exit()
  } else {
    baseHandlers.loadDatastores()
    runApp()
  }
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`\
usage: ${process.argv0} [options...] [url]
Options:
  --help, -h           show this message, then exit
  --version            print the current version, then exit
  --new-window         reuse an existing instance if possible`)
}

function runApp() {
  let deferredDatastoresStarted = false

  const libraryNotices = new Set()
  /** @type {string[]} */
  let pendingLibraryNotices = []
  function sendLibraryNoticesChanged() {
    for (const window of BrowserWindow.getAllWindows()) {
      TabManager.getForWindow(window.id)?.bridge.send(IpcChannels.LIBRARY_NOTICES_CHANGED)
    }
  }
  /**
   * Datastores open one after another, so each notice shows once per start
   * for all of them. Every window shows it in an app dialog until one of
   * them dismisses it, so a reloaded or closed window doesn't lose it.
   * @param {'olderVersionChanges' | 'libraryFormatChanged'} key
   */
  function showLibraryNotice(key) {
    // E2E profiles start from seeded NeDB files, so every test would import
    // them. Only tests that opt in see these notices.
    if (process.env.OPENTUBEX_E2E_USER_DATA_DIR && process.env.OPENTUBEX_E2E_LIBRARY_NOTICES !== 'true') return
    if (libraryNotices.has(key)) return
    libraryNotices.add(key)
    pendingLibraryNotices.push(key)
    // Windows that haven't loaded yet get the notices once they mount.
    sendLibraryNoticesChanged()
  }

  ipcMain.handle(IpcChannels.GET_LIBRARY_NOTICES, event => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !TabManager.getFromWebContents(event.sender)) return []
    return pendingLibraryNotices
  })

  ipcMain.on(IpcChannels.DISMISS_LIBRARY_NOTICE, (event, key) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !TabManager.getFromWebContents(event.sender)) return
    if (!pendingLibraryNotices.includes(key)) return
    pendingLibraryNotices = pendingLibraryNotices.filter(notice => notice !== key)
    sendLibraryNoticesChanged()
  })

  // Registered synchronously, before any datastore loading started above can finish.
  onLegacyDatastoreChanges(change => {
    console.warn('Applied library changes made by an older version', change)
    showLibraryNotice('olderVersionChanges')
  })
  onLegacyDatastoreImported(() => showLibraryNotice('libraryFormatChanged'))
  /** @type {Set<string>} */
  const ALLOWED_RENDERER_FILES = process.env.NODE_ENV === 'production'
    // __FREETUBE_ALLOWED_PATHS__ is replaced by the injectAllowedPaths.mjs script
    ? new Set(__FREETUBE_ALLOWED_PATHS__)
    : new Set()

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'imagecache',
      privileges: {
        secure: true,
        corsEnabled: true
      }
    },
    {
      scheme: 'downloadmedia',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    },
    ...(process.env.NODE_ENV === 'production'
      ? [{
          scheme: 'app',
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            codeCache: true
          }
        }]
      : []),
  ])

  const devServerPort = process.env.OPENTUBEX_DEV_SERVER_PORT ?? '9080'
  const ROOT_APP_URL = process.env.NODE_ENV === 'development' ? `http://localhost:${devServerPort}` : 'app://bundle/index.html'

  const dockMediaSessions = new Map()
  const dockMediaTrackedWindowIds = new Set()
  let dockMediaPlaySequence = 0
  let dockMediaLabels = {
    previous: 'Previous',
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    newWindow: 'New Window'
  }

  function getDockMediaSession() {
    const sessions = Array.from(dockMediaSessions.values())
      .filter(({ manager }) => !manager.browserWindow.isDestroyed())
    const playingSessions = sessions.filter(({ playbackState }) => playbackState === 'playing')

    if (playingSessions.length > 0) {
      return playingSessions.reduce((latest, session) => (
        session.lastPlayedAt > latest.lastPlayedAt ? session : latest
      ))
    }

    const focusedSession = sessions.find(({ manager, hasMetadata }) => (
      hasMetadata && manager.browserWindow.isFocused()
    ))
    if (focusedSession) {
      return focusedSession
    }

    return sessions
      .filter(({ hasMetadata }) => hasMetadata)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  }

  function requestDockMediaAction(action) {
    const session = getDockMediaSession()
    if (!session || !session.actions.has(action)) {
      return
    }
    session.manager.bridge.send(IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, action)
  }

  function updateDockMenu() {
    createTrayContextMenu()
    if (process.platform !== 'darwin' || !app.dock) {
      return
    }

    const dockMenu = Menu.buildFromTemplate([
      ...createMediaMenuItems(),
      { type: 'separator' },
      {
        label: dockMediaLabels.newWindow,
        click: () => {
          createWindow({
            replaceMainWindow: false,
            showWindowNow: true
          })
        }
      }
    ])
    app.dock.setMenu(dockMenu)
  }

  function updateDockMediaSession(manager, state) {
    const windowId = manager.browserWindow.id
    const previous = dockMediaSessions.get(windowId)
    const playbackState = ['playing', 'paused', 'none'].includes(state.playbackState)
      ? state.playbackState
      : 'none'
    const shouldAdvanceSequence = shouldAdvanceDockMediaSequence(
      playbackState,
      state.playbackStarted
    )
    dockMediaSessions.set(windowId, {
      manager,
      playbackState,
      hasMetadata: state.hasMetadata === true,
      actions: new Set(Array.isArray(state.actions) ? state.actions : []),
      lastPlayedAt: shouldAdvanceSequence
        ? ++dockMediaPlaySequence
        : previous?.lastPlayedAt ?? 0,
      updatedAt: Date.now()
    })

    if (!dockMediaTrackedWindowIds.has(windowId)) {
      dockMediaTrackedWindowIds.add(windowId)
      manager.browserWindow.on('focus', updateDockMenu)
      manager.browserWindow.once('closed', () => {
        dockMediaSessions.delete(windowId)
        dockMediaTrackedWindowIds.delete(windowId)
        updateDockMenu()
      })
    }
    updateDockMenu()
  }

  let backendPreference = 'local'
  let backendFallback = true
  const DEFAULT_STARTUP_BEHAVIOR = 'loadLastActiveTab'
  const VALID_STARTUP_BEHAVIORS = new Set([
    'loadAllTabs',
    'restoreTabLoadState',
    'loadLastActiveTab',
    'loadLandingPage',
    'emptySession'
  ])
  const closeConfirmedWindowIds = new Set()
  const closingWindowIds = new Set()
  const appShortcutBlockedWindows = new WeakSet()
  let isQuitConfirmed = false
  async function getStartupBehavior() {
    try {
      const value = (await baseHandlers.settings._findOne('startupBehavior'))?.value
      return VALID_STARTUP_BEHAVIORS.has(value) ? value : DEFAULT_STARTUP_BEHAVIOR
    } catch (error) {
      console.error('Failed to load startup behavior preference:', error)
      return DEFAULT_STARTUP_BEHAVIOR
    }
  }

  /**
   * Persist a setting changed by a native main-process prompt and update every
   * open renderer so its Settings UI remains accurate.
   * @param {string} settingKey
   * @param {unknown} value
   * @param {unknown} [expectedValue] Only repair a value that has not changed.
   */
  async function updateSettingFromMain(settingKey, value, expectedValue) {
    if (expectedValue !== undefined) {
      if (!await baseHandlers.settings._updateIfUnchanged(settingKey, expectedValue, value)) return
    } else {
      await baseHandlers.settings.upsert(settingKey, value)
    }
    const syncPayload = {
      event: SyncEvents.GENERAL.UPSERT,
      data: { _id: settingKey, value }
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SYNC_SETTINGS, syncPayload)
      }
    }
  }

  const {
    confirmCloseApp,
    confirmCloseWindowWithMultipleTabs,
    confirmMultipleTabsAction
  } = createConfirmations({
    isQuitting: () => isQuitting,
    isQuitConfirmed: () => isQuitConfirmed,
    confirmQuit: () => { isQuitConfirmed = true },
    hideWindowToTray,
    updateSettingFromMain
  })

  // Becomes true once the user asks the app to quit (e.g. Ctrl+Q / "Quit" menu
  // item / last-window-closed on non-darwin). Window close handlers use this to
  // decide whether their persisted tab session record should be kept (so the
  // window is restored on the next launch) or cleared (so a window that was
  // manually closed while the app keeps running is forgotten).
  let isQuitting = false
  let relaunchRequested = false
  const closedWindows = new ClosedWindowHistory()

  async function reopenClosedWindow() {
    try {
      await closedWindows.restore(sessionData => createWindow({
        replaceMainWindow: false,
        sessionData,
        restoreTabLoadStateOnRestore: true,
        waitForInitialization: true
      }))
    } catch (error) {
      console.error('Failed to reopen closed window:', error)
    }
  }

  // Registered per-webContents in 'web-contents-created' so the shared
  // BrowserWindow renderer can resolve native menu targets through TabManager.
  /** @type {Record<string, Function | boolean>} */
  const contextMenuOptions = {
    showSearchWithGoogle: false,
    showSaveImageAs: true,
    showCopyImageAddress: true,
    showSelectAll: false,
    showCopyLink: false,
    prepend: (defaultActions, parameters, webContents) => {
      const pageUrl = parameters.pageURL || ''
      const isInAppUrl = isOpenTubeXUrl(pageUrl) && parameters.linkURL.split('#')[0] === pageUrl.split('#')[0]

      return [
        ...contextMenu.createTabItems(webContents),
        {
          label: contextMenuLabel('Open in a New Tab'),
          // Only show the option for in-app URLs and not external ones
          visible: isInAppUrl,
          click: () => {
            const manager = TabManager.getFromWebContents(webContents)
            if (manager) {
              manager.createTabWithPreferenceFromOpener(
                { url: parameters.linkURL, makeActive: true },
                manager.contextMenuTabId ?? manager.presentedTabId ?? manager.activeTabId
              ).catch(error => {
                console.error('Failed to open link in a new tab:', error)
              })
            }
          }
        },
        {
          label: contextMenuLabel('Open in a New Window'),
          // Only show the option for in-app URLs and not external ones
          visible: isInAppUrl,
          click: () => {
            createWindow({ replaceMainWindow: false, windowStartupUrl: parameters.linkURL, showWindowNow: true })
          }
        },
        // Only show select all in text fields
        {
          label: contextMenuLabel('Select All'),
          enabled: parameters.editFlags.canSelectAll,
          visible: parameters.isEditable,
          click: () => {
            webContents.selectAll()
          }
        }
      ]
    },
    // only show the copy link entry for external links and the /playlist, /channel and /watch in-app URLs
    // the /playlist, /channel and /watch in-app URLs get transformed to their equivalent YouTube or Invidious URLs
    append: async (defaultActions, parameters, webContents) => {
      const pageUrl = parameters.pageURL || ''
      let visible = false
      const urlParts = parameters.linkURL.split('#')
      const isInAppUrl = isOpenTubeXUrl(pageUrl) && urlParts[0] === pageUrl.split('#')[0]

      if (parameters.linkURL.length > 0) {
        if (isInAppUrl) {
          visible = isShareableOpenTubeXRoute(urlParts[1])
        } else {
          visible = true
        }
      }

      const copy = (url) => {
        if (parameters.linkText) {
          clipboard.write({
            bookmark: parameters.linkText,
            text: url
          })
        } else {
          clipboard.writeText(url)
        }
      }

      const selectionText = parameters.selectionText.trim()
      const selectionLabelText = truncateSelectionForLabel(selectionText)
      const textShortEnoughForSearch = selectionText.length <= SEARCH_CHAR_LIMIT
      const externalSearch = await contextMenu.createExternalSearchItem(selectionText)

      return [
        {
          label: contextMenuLabel('Copy Link'),
          visible: visible && !isInAppUrl,
          click: () => {
            copy(parameters.linkURL)
          }
        },
        {
          label: contextMenuLabel('Copy YouTube Link'),
          visible: visible && isInAppUrl,
          click: () => {
            copy(transformOpenTubeXRouteUrl(urlParts[1], true))
          }
        },
        {
          label: contextMenuLabel('Copy Invidious Link'),
          visible: visible && isInAppUrl && usesInvidiousInstance(backendPreference, backendFallback),
          click: () => {
            copy(transformOpenTubeXRouteUrl(urlParts[1], false))
          }
        },
        // Only show search in new tab/window for
        // Static text or link
        // NOT internal link
        // NOT link with no customized link text
        // NOT link for timestamp
        {
          label: textShortEnoughForSearch
            ? contextMenuLabel(
                'Search Selection in New Tab',
                { selection: selectionLabelText },
                `Search "${selectionLabelText}" in a New Tab`
              )
            : contextMenuLabel(
                'Selection Too Long',
                { count: SEARCH_CHAR_LIMIT },
                `"${selectionLabelText}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`
              ),
          enabled: textShortEnoughForSearch,
          visible: (
            !isInAppUrl &&
            !parameters.isEditable &&
            (parameters.linkURL != null && !parameters.linkURL.includes(parameters.selectionText) && !(/(\d{1,2}:)*\d{1,2}:\d{2}/.test(parameters.linkText))) &&
            selectionText.length > 0
          ),
          click: () => {
            const manager = TabManager.getFromWebContents(webContents)
            if (manager) {
              manager.createTabWithPreferenceFromOpener(
                {
                  route: `/search/${encodeURIComponent(selectionText)}`,
                  makeActive: true
                },
                manager.contextMenuTabId ?? manager.presentedTabId ?? manager.activeTabId
              ).catch(error => {
                console.error('Failed to open search in a new tab:', error)
              })
            }
          }
        },
        {
          label: textShortEnoughForSearch
            ? contextMenuLabel(
                'Search Selection in New Window',
                { selection: selectionLabelText },
                `Search "${selectionLabelText}" in a New Window`
              )
            : contextMenuLabel(
                'Selection Too Long',
                { count: SEARCH_CHAR_LIMIT },
                `"${selectionLabelText}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`
              ),
          enabled: textShortEnoughForSearch,
          visible: (
            !isInAppUrl &&
            !parameters.isEditable &&
            (parameters.linkURL != null && !parameters.linkURL.includes(parameters.selectionText) && !(/(\d{1,2}:)*\d{1,2}:\d{2}/.test(parameters.linkText))) &&
            selectionText.length > 0
          ),
          click: () => {
            createWindow({
              replaceMainWindow: false,
              windowStartupUrl: `${ROOT_APP_URL}#/search/${encodeURIComponent(selectionText)}`,
              searchQueryText: selectionText,
              showWindowNow: true,
            })
          }
        },
        externalSearch,
      ]
    },
  }

  const contextMenu = setupContextMenu(contextMenuOptions, {
    createWindow,
    confirmCloseApp,
    confirmMultipleTabsAction,
    closeConfirmedWindowIds
  })

  const updateWatchQueue = createFileWatchQueue(path.join(app.getPath('userData'), 'watch-queue.json'))
  let broadcastWatchQueueRevision = 0
  ipcMain.handle(IpcChannels.WATCH_QUEUE_UPDATE, async (event, request) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return { error: 'Invalid watch queue sender' }
    }
    try {
      const snapshot = await updateWatchQueue(request)
      if (snapshot.revision > broadcastWatchQueueRevision) {
        broadcastWatchQueueRevision = snapshot.revision
        for (const window of BrowserWindow.getAllWindows()) {
          try {
            if (window.isDestroyed() || window.webContents.isDestroyed() || !isOpenTubeXUrl(window.webContents.getURL())) continue
            window.webContents.send(IpcChannels.WATCH_QUEUE_UPDATED, snapshot)
          } catch (error) {
            console.warn('Could not update a window\'s watch queue', error)
          }
        }
      }
      return snapshot
    } catch (error) {
      return { error: error.message }
    }
  })

  if (process.platform === 'win32' && !isPortableBuild()) {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--new-window',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'New Window',
        description: 'Open New Window'
      }
    ])
  }

  // disable electron warning
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
  const isDebug = process.argv.includes('--debug')

  let mainWindow
  let startupUrl
  let trayMenuSignature = null
  let tray = null
  let useTrayIcon = true
  let trayOnClose = false
  let trayOnMinimize = false
  let trayTranslate = key => key
  let trayMenuIconPack = 'material'
  const trayClosingWindowIds = new Set()
  let trayWindows = []
  const trayMaximizedWindows = {}
  const activeNotifications = new Set()
  const ozonePlatform = app.commandLine.getSwitchValue('ozone-platform')
  const isWaylandPlatform = detectWaylandPlatform({
    platform: process.platform,
    ozonePlatform,
    environment: process.env,
  })
  const monitorsKdeWaylandWindowState = shouldMonitorKdeWaylandWindowState({
    platform: process.platform,
    ozonePlatform,
    environment: process.env,
  })
  const kdeWaylandWindowStateBackend = monitorsKdeWaylandWindowState
    ? createKdeWaylandWindowStateBackend()
    : Promise.resolve(null)
  app.once('will-quit', () => {
    kdeWaylandWindowStateBackend.then(backend => backend?.close()).catch(() => {})
  })
  const supportsAutoPictureInPictureMinimize = isWaylandPlatform
    ? kdeWaylandWindowStateBackend.then(backend => backend !== null)
    : Promise.resolve(true)
  let isTrayOnMinimizeSupported = !isWaylandPlatform
  supportsAutoPictureInPictureMinimize.then(supported => { isTrayOnMinimizeSupported = supported })

  const userDataPath = app.getPath('userData')
  const uploadNotifier = createUploadNotifier({
    file: path.join(userDataPath, 'upload-notifications.json'),
    show: showUrlNotification
  })
  const backgroundSubscriptions = createSubscriptionBackgroundService(userDataPath, {
    onUploads: value => uploadNotifier.observe(value).catch(() => {})
  })
  // Builds archives in a worker from read-only database snapshots, so neither
  // this process nor the renderer stalls on large libraries.
  // The worker reads from its own connection, so an archive includes a write
  // only once its request has finished.
  const datastoreRequests = createDatastoreRequestTracker()
  /**
   * @param {string} channel
   * @param {(event: import('electron').IpcMainInvokeEvent, request: { action: number, data: unknown }) => Promise<unknown>} handler
   */
  function handleDatastoreRequests(channel, handler) {
    ipcMain.handle(channel, (event, request) => datastoreRequests.track(handler(event, request)))
  }
  const createBackupArchive = createBackupArchiveFactory(userDataPath,
    path.join(__dirname, process.env.NODE_ENV === 'development' ? '../../dist/backupArchiveWorker.js' : 'backupArchiveWorker.js'), {
      waitForDatastores: async () => {
        await waitForDatastores()
        await datastoreRequests.settled()
      },
      settings: baseHandlers.settings,
      watchStats: baseHandlers.watchStats,
    })
  const scheduledBackups = createScheduledBackups({
    async readConfiguration() {
      const keys = ['scheduledBackupEnabled', 'scheduledBackupFolderPath', 'scheduledBackupInterval', 'scheduledBackupKeepCount', 'scheduledBackupStatus']
      const [enabled, directory, interval, keepCount, status] = await Promise.all(keys.map(async key => (await baseHandlers.settings._findOne(key))?.value))
      return { enabled, directory, interval: interval ?? 7, keepCount: keepCount ?? 5, status }
    },
    createArchive: () => createBackupArchive(),
    saveStatus: status => updateSettingFromMain('scheduledBackupStatus', status),
  })
  function checkScheduledBackup() {
    scheduledBackups.tick().catch(error => console.error('Could not check scheduled backups', error))
  }
  let scheduledBackupTimer
  let keepRefreshingInBackground = false

  ipcMain.handle(IpcChannels.SUBSCRIPTION_BACKGROUND, async (event, method, value) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !TabManager.getFromWebContents(event.sender)) return
    switch (method) {
      case 'processFeed': return backgroundSubscriptions.processFeed(value)
      case 'configure':
        keepRefreshingInBackground = value.enabled === true
        await backgroundSubscriptions.configure(value)
        updateTrayEnabled()
        return
      case 'next':
        await backgroundSubscriptions.setBackground(false)
        return backgroundSubscriptions.next()
      case 'acknowledge': return backgroundSubscriptions.acknowledge(value)
      case 'completed': return backgroundSubscriptions.completed(value)
      case 'configureUploadNotifications':
        await uploadNotifier.configure(value)
        return backgroundSubscriptions.configureUploads(value)
      case 'observeUploads': return uploadNotifier.observe(value)
    }
  })

  function updateBackgroundSubscriptionVisibility() {
    const hidden = BrowserWindow.getAllWindows().every(window => !window.isVisible() || window.isMinimized())
    backgroundSubscriptions.setBackground(hidden && !isSubscriptionAutoRefreshInProgress()).catch(console.error)
  }

  const trayIconCachePath = path.join(userDataPath, 'tray-icon.png')
  let selectedTrayImage = nativeImage.createFromPath(trayIconCachePath)
  let trayIconWrite = Promise.resolve()
  ipcMain.handle(IpcChannels.SET_TRAY_ICON, async (event, dataUrl) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !TabManager.getFromWebContents(event.sender)) return
    if (dataUrl !== null && (typeof dataUrl !== 'string' || dataUrl.length > 65536 || !dataUrl.startsWith('data:image/png;base64,'))) return
    const image = dataUrl === null ? nativeImage.createEmpty() : nativeImage.createFromDataURL(dataUrl)
    if (dataUrl !== null && (image.isEmpty() || image.getSize().width !== 64 || image.getSize().height !== 64)) return
    selectedTrayImage = image
    if (tray) tray.setImage(getTrayImage())
    // Serialize writes so rapid palette changes also preserve the latest icon on restart.
    trayIconWrite = trayIconWrite.catch(() => {}).then(() => dataUrl === null
      ? asyncFs.rm(trayIconCachePath, { force: true })
      : asyncFs.writeFile(trayIconCachePath, image.toPNG()))
    await trayIconWrite
  })

  const MAC_TRAY_ICON_HEIGHT = 18

  /**
   * macOS status items draw an image at its point size, so the full-size app
   * logo would fill the menu bar. Supply 1x and 2x representations at the
   * standard menu bar height instead.
   * @param {Electron.NativeImage} image
   * @returns {Electron.NativeImage}
   */
  function createMacTrayImage(image) {
    const resized = nativeImage.createEmpty()
    resized.addRepresentation({
      scaleFactor: 1,
      buffer: image.resize({ height: MAC_TRAY_ICON_HEIGHT }).toPNG()
    })
    resized.addRepresentation({
      scaleFactor: 2,
      buffer: image.resize({ height: MAC_TRAY_ICON_HEIGHT * 2 }).toPNG()
    })
    return resized
  }

  function getTrayImage() {
    if (!selectedTrayImage.isEmpty()) {
      return process.platform === 'darwin' ? createMacTrayImage(selectedTrayImage) : selectedTrayImage
    }
    const defaultTrayIconPath = process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '..', '..', '_icons', 'iconColor.png')
      : path.join(__dirname, '..', '_icons', 'iconColor.png')
    const image = nativeImage.createFromPath(defaultTrayIconPath)
    // Chromium keeps several copies of the tray bitmap, so the 512px logo
    // would cost ~55 MB. Match the 64px size of the selectable tray icons.
    return process.platform === 'darwin'
      ? createMacTrayImage(image)
      : image.resize({ width: 64, height: 64, quality: 'best' })
  }

  function ensureBackgroundTray() {
    if (!tray) {
      tray = new Tray(getTrayImage())
      trayMenuSignature = null
      tray.setToolTip('OpenTubeX')
      tray.on('click', toggleTrayWindow)
      if (process.platform === 'darwin') {
        tray.setIgnoreDoubleClickEvents(true)
        tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(defaultTrayMenu())))
      }
    }
    createTrayContextMenu()
  }

  asyncFs.rm(path.join(userDataPath, 'voice_over_translation_cache'), {
    force: true,
    recursive: true
  }).catch(error => {
    console.error('Failed to remove the obsolete voice-over translation cache:', error)
  })

  function broadcastLiveReminderUpdate(videoId, scheduled) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.LIVE_REMINDER_UPDATED, videoId, scheduled)
      }
    }
  }

  function showLiveReminderNotification(reminder) {
    showUrlNotification({
      title: reminder.notificationTitle,
      body: reminder.notificationBody,
      url: `https://www.youtube.com/watch?v=${reminder.videoId}`
    })
  }

  /**
   * @param {{ title: string, body: string, url: string }} options
   */
  function showUrlNotification({ title, body, url }) {
    if (!supportsNativeNotifications(Notification)) return

    const notification = new Notification({ title, body })
    activeNotifications.add(notification)
    notification.once('close', () => activeNotifications.delete(notification))
    notification.once('click', () => {
      activeNotifications.delete(notification)

      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindowForOpenUrl(url, {
          showWindowNow: true,
          reuseEmptyRootTab: true
        }).catch(error => {
          console.error('Failed to open notification URL', error)
        })
        return
      }

      const isHiddenInTray = trayWindows.some(window => window.id === mainWindow.id)
      if (isHiddenInTray) {
        trayClick(mainWindow)
      } else if (mainWindow.isMinimized()) {
        mainWindow.restore()
      } else if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      openUrlInWindow(mainWindow, url)
    })
    notification.show()
  }

  const liveReminderManager = new LiveReminderManager({
    notify: showLiveReminderNotification,
    onChange: broadcastLiveReminderUpdate,
    datastore: liveReminders
  })

  // command line switches need to be added before the app ready event first
  // that means we can't use the normal settings system as that is asynchronous,
  // doing it synchronously ensures that we add it before the event fires
  const REPLACE_HTTP_CACHE_PATH = `${userDataPath}/experiment-replace-http-cache`
  const replaceHttpCache = existsSync(REPLACE_HTTP_CACHE_PATH)
  if (replaceHttpCache) {
    // the http cache causes excessive disk usage during video playback
    // we've got a custom image cache to make up for disabling the http cache
    // experimental as it increases RAM use in favour of reduced disk use
    app.commandLine.appendSwitch('disable-http-cache')
  }

  if (process.platform === 'linux') {
    const middleClickAutoscrollFeature = 'MiddleClickAutoscroll'
    const enabledBlinkFeatures = app.commandLine.getSwitchValue('enable-blink-features')
      .split(',')
      .filter(Boolean)

    if (!enabledBlinkFeatures.includes(middleClickAutoscrollFeature)) {
      app.commandLine.appendSwitch('enable-blink-features', [
        ...enabledBlinkFeatures,
        middleClickAutoscrollFeature
      ].join(','))
    }
  }

  const DISABLE_HARDWARE_ACCELERATION_PATH = `${userDataPath}/experiment-disable-hardware-acceleration`
  const disableHardwareAcceleration = existsSync(DISABLE_HARDWARE_ACCELERATION_PATH)
  if (disableHardwareAcceleration) {
    app.commandLine.appendSwitch('disable-gpu')
  }

  const PLAYER_CACHE_PATH = `${userDataPath}/player_cache`

  if (!isPortableBuild()) {
    // See: https://stackoverflow.com/questions/45570589/electron-protocol-handler-not-working-on-windows
    // remove so we can register each time as we run the app.
    app.removeAsDefaultProtocolClient('opentubex')

    // If we are running a non-packaged version of the app && on windows
    if (process.env.NODE_ENV === 'development' && process.platform === 'win32') {
      // Set the path of electron.exe and your app.
      // These two additional parameters are only available on windows.
      app.setAsDefaultProtocolClient('opentubex', process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('opentubex')
    }
  }

  if (process.env.NODE_ENV !== 'development') {
    app.on('second-instance', async (_, commandLine, __) => {
      // Keep the profile locked until cleanup finishes. Opening a window now
      // would lose the launch when the pending quit closes it again.
      // AppImage cannot use Electron's relaunch on its FUSE mount.
      if (isQuitting && !process.env.APPIMAGE) {
        // Retry scheduling once; later launch requests can retry if both fail.
        for (let attempt = 0; attempt < 2 && !relaunchRequested; attempt++) {
          try {
            const scheduled = app.relaunch({
              args: commandLine.slice(1),
              execPath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
            })
            if (scheduled === false) throw new Error('Electron could not schedule the relaunch')
            relaunchRequested = true
          } catch (error) {
            console.error('Failed to schedule app relaunch', error)
          }
        }
        return
      }

      // Someone tried to run a second instance
      if (typeof commandLine !== 'undefined') {
        const newStartupUrl = getLinkUrl(commandLine)

        if (!(mainWindow && mainWindow.webContents)) {
          startupUrl = newStartupUrl
          if (app.isReady()) {
            await createWindowForOpenUrl(startupUrl, {
              reuseEmptyRootTab: true
            })
            startupUrl = null
          }
          return
        }

        if (commandLine.includes('--new-window')) {
          // The user wants to create a new window in the existing instance
          await createWindowForOpenUrl(newStartupUrl, {
            showWindowNow: true,
            replaceMainWindow: true,
            reuseEmptyRootTab: true
          })
          return
        }

        const openDeepLinksInNewWindow = (await baseHandlers.settings._findOne('openDeepLinksInNewWindow'))?.value
        if (!openDeepLinksInNewWindow) {
          // Just focus the main window (instead of starting a new instance)
          if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
            if (trayWindows.includes(mainWindow)) {
              trayClick(mainWindow)
            } else {
              mainWindow.restore()
            }
          }
          mainWindow.focus()
          openUrlInWindow(mainWindow, newStartupUrl)
          return
        }

        await createWindowForOpenUrl(newStartupUrl, {
          replaceMainWindow: false,
          showWindowNow: true,
          reuseEmptyRootTab: true
        })
      }
    })
  }

  let proxyUrl

  app.on('ready', async (_, __) => {
    scheduledBackupTimer = setInterval(checkScheduledBackup, 60_000)
    checkScheduledBackup()
    // None of these gate the first window: the playback cache and download
    // list handlers wait for their own setup, and the tray and dock menus are
    // rebuilt once the translations are loaded.
    applyYtDlpPlaybackCacheSettings().catch(error => {
      console.warn('Could not apply the yt-dlp playback cache settings', error)
    })
    restoreYtDlpDownloadQueue().catch(error => {
      console.warn('Could not restore the download queue', error)
    })
    createMainTranslator().then(t => {
      trayTranslate = t
      dockMediaLabels = {
        previous: t('Video.Previous'),
        play: t('Video.Player.Scroll Mini Player.Play'),
        pause: t('Video.Player.Scroll Mini Player.Pause'),
        next: t('Video.Next'),
        newWindow: t('New Window')
      }
      updateDockMenu()
    }).catch(error => {
      console.warn('Could not load the tray translations', error)
    })

    if (process.env.NODE_ENV === 'production') {
      protocol.handle('app', async (request) => {
        if (request.method !== 'GET') {
          return new Response(null, {
            status: 405,
            headers: {
              Allow: 'GET'
            }
          })
        }

        const { host, pathname } = new URL(request.url)

        if (host !== 'bundle' || !ALLOWED_RENDERER_FILES.has(pathname)) {
          return new Response(null, {
            status: 400
          })
        }

        const contents = await asyncFs.readFile(path.join(__dirname, pathname))

        if (pathname.endsWith('.json.br')) {
          const decompressed = await brotliDecompressAsync(contents)

          return new Response(decompressed, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'br'
            }
          })
        } else {
          return new Response(contents.buffer, {
            status: 200,
            headers: {
              'Content-Type': contentTypeFromFileExtension(pathname.split('.').at(-1))
            }
          })
        }
      })
    }

    // Electron defaults to approving all permission checks and permission requests.
    // OpenTubeX only needs a few permissions, so we reject requests for other permissions
    // and reject all requests on non-OpenTubeX URLs.
    //
    // OpenTubeX needs the following permissions:
    // - "fullscreen": So that the video player can enter full screen
    // - "clipboard-sanitized-write": To allow the user to copy video URLs and error messages
    // - "fileSystem" Needed for the Web File System API (e.g. importing and exporting data)
    // - video-only "media": To scan secure sync pairing QR codes

    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!isOpenTubeXUrl(requestingOrigin)) {
        return false
      }

      return (
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.mediaType === 'video') ||
        (permission === 'fileSystem' && !details.isDirectory)
      )
    })

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (!isOpenTubeXUrl(webContents.getURL())) {
        // eslint-disable-next-line n/no-callback-literal
        callback(false)
        return
      }

      callback(
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
        (permission === 'media' &&
          details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'video') ||
        (permission === 'fileSystem' && !details.isDirectory)
      )
    })

    session.defaultSession.on('file-system-access-restricted', (event, details, callback) => {
      if (!isOpenTubeXUrl(details.origin)) {
        // eslint-disable-next-line n/no-callback-literal
        callback('deny')
        return
      }

      // eslint-disable-next-line n/no-callback-literal
      callback(details.isDirectory ? 'deny' : 'allow')
    })

    let docArray
    try {
      docArray = await baseHandlers.settings._findAppReadyRelatedSettings()
    } catch (err) {
      console.error(err)
      app.exit()
      return
    }

    let disableSmoothScrolling = false
    let useProxy = false
    let proxyProtocol = DEFAULT_PROXY_SETTINGS.protocol
    let proxyHostname = DEFAULT_PROXY_SETTINGS.hostname
    let proxyPort = DEFAULT_PROXY_SETTINGS.port

    if (docArray?.length > 0) {
      docArray.forEach((doc) => {
        switch (doc._id) {
          case 'disableSmoothScrolling':
            disableSmoothScrolling = doc.value
            break
          case 'useProxy':
            useProxy = doc.value
            break
          case 'proxyProtocol':
            proxyProtocol = doc.value
            break
          case 'proxyHostname':
            proxyHostname = doc.value
            break
          case 'proxyPort':
            proxyPort = doc.value
            break
          case 'backendFallback':
            backendFallback = doc.value
            break
          case 'backendPreference':
            backendPreference = doc.value
            break
          case 'useTrayIcon':
            useTrayIcon = doc.value
            break
          case 'hideToTrayOnClose':
            trayOnClose = doc.value
            break
          case 'hideToTrayOnMinimize':
            trayOnMinimize = doc.value
            break
          case 'iconPack':
            trayMenuIconPack = doc.value
            break
        }
      })
    }

    updateTrayEnabled()

    if (disableSmoothScrolling) {
      app.commandLine.appendSwitch('disable-smooth-scrolling')
    } else {
      app.commandLine.appendSwitch('enable-smooth-scrolling')
    }

    if (useProxy) {
      proxyUrl = buildProxyUrl({ protocol: proxyProtocol, hostname: proxyHostname, port: proxyPort })

      session.defaultSession.setProxy({
        proxyRules: proxyUrl
      })
    }

    const fixedUserAgent = session.defaultSession.getUserAgent()
      .split(' ')
      .filter(part => !part.includes('Electron') && !part.includes(packageDetails.productName))
      .join(' ')
    session.defaultSession.setUserAgent(fixedUserAgent)

    // Set CONSENT cookie on reasonable domains
    const consentCookieDomains = [
      'https://www.youtube.com',
      'https://youtube.com'
    ]
    consentCookieDomains.forEach(url => {
      session.defaultSession.cookies.set({
        url: url,
        name: 'CONSENT',
        value: 'YES+',
        sameSite: 'no_restriction'
      })
    })

    session.defaultSession.cookies.set({
      url: 'https://www.youtube.com',
      name: 'SOCS',
      value: 'CAI',
      sameSite: 'no_restriction',
    })

    const onBeforeSendHeadersRequestFilter = {
      urls: ['https://*/*', 'http://*/*'],
      types: ['xhr', 'media', 'image']
    }
    const rendererCors = new RendererCors()
    const storyboardRequestIds = new Set()
    session.defaultSession.webRequest.onBeforeSendHeaders(onBeforeSendHeadersRequestFilter, (details, callback) => {
      // Capture the app's original Origin before the YouTube header adjustments.
      const originalOrigin = new Headers(details.requestHeaders).get('Origin')
      let { requestHeaders } = details
      const { url, webContents } = details
      const urlObj = new URL(url)

      if (webContents && isOpenTubeXUrl(webContents.getURL())) {
        applySyncServerUserAgent(requestHeaders)
      }

      if (url.startsWith('https://www.youtube.com/youtubei/')) {
        // make InnerTube requests work with the fetch function
        // InnerTube rejects requests if the referer isn't YouTube or empty
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'

        requestHeaders['Sec-Fetch-Site'] = 'same-origin'
        requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
        requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
      } else if (
        url.startsWith('https://www.youtube.com/watch') ||
        (urlObj.hostname === 'www.youtube.com' && urlObj.pathname === '/')
      ) {
        delete requestHeaders.Referer
        delete requestHeaders.Origin
        requestHeaders['Sec-Fetch-Dest'] = 'document'
        requestHeaders['Sec-Fetch-Mode'] = 'navigate'
        requestHeaders['Sec-Fetch-Site'] = 'none'
        requestHeaders['Sec-Fetch-User'] = '?1'

        if (requestHeaders['X-Cookie']) {
          requestHeaders.Cookie = requestHeaders.Cookie
            ? requestHeaders.Cookie + ';' + requestHeaders['X-Cookie']
            : requestHeaders['X-Cookie']

          delete requestHeaders['X-Cookie']
        }
      } else if (url === 'https://www.youtube.com/sw.js_data' || url.startsWith('https://www.youtube.com/api/timedtext')) {
        requestHeaders.Referer = 'https://www.youtube.com/sw.js'
        requestHeaders['Sec-Fetch-Site'] = 'same-origin'
        requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
      } else if (
        urlObj.origin.endsWith('.googleusercontent.com') ||
        urlObj.origin.endsWith('.ggpht.com') ||
        urlObj.origin.endsWith('.ytimg.com')
      ) {
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'
      } else if (urlObj.origin.endsWith('.googlevideo.com') && urlObj.pathname === '/videoplayback') {
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'

        // YouTube doesn't send the Content-Type header for the media requests, so we shouldn't either
        delete requestHeaders['Content-Type']
      } else if (urlObj.origin === 'https://ipwho.is') {
        // Fix the CORS error with the proxy test button
        requestHeaders = {}
      } else if (webContents) {
        const invidiousAuthorization = invidiousAuthorizations.get(webContents.id)

        if (invidiousAuthorization && isInvidiousInstanceUrl(url, invidiousAuthorization.url)) {
          requestHeaders.Authorization = invidiousAuthorization.authorization
        }
      }

      if (webContents && isOpenTubeXUrl(webContents.getURL())) {
        Object.assign(requestHeaders, getYtDlpExternalStreamHeaders(webContents, url))
        applyTwitchPlaylistOrigin(urlObj, requestHeaders)
        if (isYtDlpStoryboardUrl(webContents, url)) storyboardRequestIds.add(details.id)
        if (url.startsWith('http:') && storyboardRequestIds.has(details.id)) {
          for (const name of Object.keys(requestHeaders)) {
            if (name.toLowerCase() === 'cookie') delete requestHeaders[name]
          }
        } else {
          const streamCookies = getYtDlpExternalStreamCookieHeader(webContents, url)
          if (streamCookies !== null) {
            const names = new Set(streamCookies.split('; ').map(cookie => cookie.split('=')[0]))
            const existing = (requestHeaders.Cookie ?? '').split('; ')
              .filter(cookie => cookie && !names.has(cookie.split('=')[0]))
            requestHeaders.Cookie = [...existing, streamCookies].join('; ')
          }
        }
      }

      rendererCors.rememberRequest({ ...details, requestHeaders }, originalOrigin)
      // eslint-disable-next-line n/no-callback-literal
      callback({ requestHeaders })
    })

    // when we create a real session on the watch page, youtube returns tracking cookies, which we definitely don't want
    const httpRequestFilter = { urls: ['https://*/*', 'http://*/*'] }
    session.defaultSession.webRequest.onHeadersReceived(httpRequestFilter, (details, callback) => {
      const { url, responseHeaders } = details
      if (responseHeaders && (
        url === 'https://www.youtube.com/sw.js_data' ||
        url === 'https://www.youtube.com/iframe_api' ||
        url.startsWith('https://www.youtube.com/watch?') ||
        (new URL(url).origin === 'https://www.youtube.com' && new URL(url).pathname === '/')
      )) {
        delete responseHeaders['set-cookie']
        delete responseHeaders['content-security-policy']
        delete responseHeaders['cross-origin-opener-policy']
        delete responseHeaders['report-to']
        delete responseHeaders['reporting-endpoints']
      }

      // eslint-disable-next-line n/no-callback-literal
      callback({ responseHeaders, ...rendererCors.allowResponse(details) })
    })
    session.defaultSession.webRequest.onBeforeRedirect(httpRequestFilter, details => {
      rendererCors.rememberRedirect(details)
    })
    session.defaultSession.webRequest.onCompleted(httpRequestFilter, details => {
      rendererCors.forgetRequest(details)
      storyboardRequestIds.delete(details.id)
    })
    session.defaultSession.webRequest.onErrorOccurred(httpRequestFilter, details => {
      rendererCors.forgetRequest(details)
      storyboardRequestIds.delete(details.id)
    })

    protocol.handle('downloadmedia', handleDownloadMediaRequest)

    if (replaceHttpCache) {
      // in-memory image cache

      const imageCache = new ImageCache()

      protocol.handle('imagecache', (request) => {
        const [requestUrl, rawWebContentsId] = request.url.split('#')

        return new Promise((resolve, reject) => {
          const url = decodeURIComponent(requestUrl.substring(13))
          if (imageCache.has(url)) {
            const cached = imageCache.get(url)

            resolve(new Response(cached.data, {
              headers: { 'content-type': cached.mimeType }
            }))
            return
          }

          let headers

          if (rawWebContentsId) {
            const invidiousAuthorization = invidiousAuthorizations.get(parseInt(rawWebContentsId))

            if (invidiousAuthorization && isInvidiousInstanceUrl(url, invidiousAuthorization.url)) {
              headers = {
                Authorization: invidiousAuthorization.authorization
              }
            }
          }

          const newRequest = net.request({
            method: request.method,
            url,
            headers
          })

          // Electron doesn't allow certain headers to be set:
          // https://www.electronjs.org/docs/latest/api/client-request#requestsetheadername-value
          // also blacklist Origin and Referrer as we don't want to let YouTube know about them
          const blacklistedHeaders = ['content-length', 'host', 'trailer', 'te', 'upgrade', 'cookie2', 'keep-alive', 'transfer-encoding', 'origin', 'referrer']

          for (const header of Object.keys(request.headers)) {
            if (!blacklistedHeaders.includes(header.toLowerCase())) {
              newRequest.setHeader(header, request.headers[header])
            }
          }

          newRequest.on('response', (response) => {
            const chunks = []
            response.on('data', (chunk) => {
              chunks.push(chunk)
            })

            response.on('end', () => {
              const data = Buffer.concat(chunks)
              const mimeType = response.headers['content-type']

              // Only a complete 200 response is an image worth keeping; an error
              // page or a partial 206 answer would be served to every later
              // request for the URL as if it were the whole image.
              if (response.statusCode === 200) {
                imageCache.add(url, mimeType, data, extractExpiryTimestamp(response.headers))
              }

              // Response() only accepts 200-599 and throws when a body accompanies
              // a status that forbids one.
              const status = response.statusCode >= 200 && response.statusCode <= 599
                ? response.statusCode
                : 502
              const bodyAllowed = ![204, 205, 304].includes(status)
              resolve(new Response(bodyAllowed ? data : null, {
                status,
                headers: { 'content-type': mimeType }
              }))
            })

            response.on('error', (error) => {
              console.error('image cache error', error)
              reject(error)
            })
          })

          newRequest.on('error', (err) => {
            // Settle the request so the <img> fires its error event and the
            // renderer can show a placeholder instead of waiting forever.
            console.error(err)
            reject(err)
          })

          newRequest.end()
        })
      })

      const imageRequestFilter = { urls: ['https://*/*', 'http://*/*'], types: ['image'] }
      session.defaultSession.webRequest.onBeforeRequest(imageRequestFilter, (details, callback) => {
        // the requests made by the imagecache:// handler to fetch the image,
        // are allowed through, as their resourceType is 'other'

        let redirectURL = `imagecache://${encodeURIComponent(details.url)}`

        if (details.webContents) {
          redirectURL += `#${details.webContents.id}`
        }

        // eslint-disable-next-line n/no-callback-literal
        callback({
          redirectURL
        })
      })

      // --- end of `if experimentsDisableDiskCache` ---
    }

    const themeReady = (async () => {
      try {
        const baseTheme = await baseHandlers.settings._findOne('baseTheme')

        if (baseTheme?.value) {
          if (isCustomThemeValue(baseTheme.value)) {
            nativeTheme.themeSource = (await getSelectedCustomTheme(baseTheme.value))?.isDark ? 'dark' : 'light'
          } else {
            updateThemeSource(baseTheme.value)
          }
        }
      } catch {}
    })()

    // Setup tab IPC handlers
    const tabsIpcReady = setupTabsIPC({
      confirmCloseWindow: (browserWindow) => {
        const isLastWindow = BrowserWindow.getAllWindows().length === 1
        if (isLastWindow) return confirmCloseApp(browserWindow)

        const manager = TabManager.getForWindow(browserWindow.id)
        return manager && manager.tabs.size > 1
          ? confirmCloseWindowWithMultipleTabs(browserWindow, manager.tabs.size)
          : true
      },
      confirmMultipleTabsAction,
      markWindowCloseConfirmed: (browserWindow) => {
        if (BrowserWindow.getAllWindows().length === 1) {
          closeConfirmedWindowIds.add(browserWindow.id)
        }
      },
      mediaSessionStateChanged: updateDockMediaSession
    })

    // Reminder initialization is ordered with later reminder operations by the
    // manager itself, so loading and pruning its datastore need not hold the
    // first window open.
    liveReminderManager.initialize().catch(error => {
      console.error('Failed to initialize live stream reminders', error)
    })
    const startupBehaviorReady = getStartupBehavior()

    await Promise.all([themeReady, tabsIpcReady])

    // Restore every window that was open last time the app quit. Each window
    // has its own persisted session record, so a multi-window Ctrl+Q session
    // is fully rebuilt here (one window per saved session). If there are no
    // saved sessions yet, fall back to creating a single empty window.
    const startupBehavior = await startupBehaviorReady
    const shouldRestoreSession = startupBehavior !== 'emptySession'
    const savedSessions = shouldRestoreSession ? await loadAllTabSessions() : []

    if (!shouldRestoreSession) {
      await clearAllTabSessions()
    }

    // Start dropping cache entries that no restored tab points at. Captures wait
    // on this maintenance inside TabManager, but window creation does not.
    tabPreviewStorage.startPrune(
      savedSessions.flatMap(session => (
        Array.isArray(session?.tabs)
          ? session.tabs.flatMap(tab => [tab?.previewFileName, tab?.avatarFileName])
          : []
      ))
    )

    let firstWindow

    const directStartupUrl = getDirectOpenUrl(startupUrl, ROOT_APP_URL)

    if (savedSessions.length === 0) {
      firstWindow = await createWindow({
        windowStartupUrl: directStartupUrl
      })
    } else {
      firstWindow = await createWindow({
        sessionData: savedSessions[0],
        loadInactiveTabsOnRestore: startupBehavior === 'loadAllTabs',
        restoreTabLoadStateOnRestore: startupBehavior === 'restoreTabLoadState',
        loadLandingPageOnRestore: startupBehavior === 'loadLandingPage'
      })
      for (let i = 1; i < savedSessions.length; i++) {
        await createWindow({
          replaceMainWindow: false,
          showWindowNow: true,
          sessionData: savedSessions[i],
          loadInactiveTabsOnRestore: startupBehavior === 'loadAllTabs',
          restoreTabLoadStateOnRestore: startupBehavior === 'restoreTabLoadState',
          loadLandingPageOnRestore: startupBehavior === 'loadLandingPage'
        })
      }
    }

    if (startupUrl) {
      if (directStartupUrl === null || savedSessions.length > 0) {
        openUrlInWindow(firstWindow, startupUrl, {
          reuseEmptyRootTab: savedSessions.length === 0
        })
      }
      startupUrl = null
    }
    if (isDebug) {
      // Logical tabs share the BrowserWindow renderer.
      const tabManager = TabManager.getForWindow(mainWindow.id)
      if (tabManager) {
        const webContents = tabManager.getActiveWebContents()
        if (webContents) {
          webContents.openDevTools()
        }
      }
    }
  })

  app.on('login', async (event, webContents, request, authInfo, callback) => {
    if (authInfo.isProxy) {
      event.preventDefault()
      const proxyUsername = (await baseHandlers.settings._findOne('proxyUsername'))?.value
      const proxyPassword = (await baseHandlers.settings._findOne('proxyPassword'))?.value
      callback(proxyUsername, proxyPassword)
    }
  })

  function isTrayEnabled() {
    return useTrayIcon || keepRefreshingInBackground
  }

  function updateTrayEnabled() {
    if (isTrayEnabled()) {
      ensureBackgroundTray()
    } else {
      // Restore every hidden window before removing its way back into the app.
      showHiddenWindows()
      destroyTray()
    }
  }

  function hideWindowToTray(window) {
    if (!isTrayEnabled() || isQuitting || window.isDestroyed()) return
    ensureBackgroundTray()
    if (!trayWindows.includes(window)) {
      trayWindows.push(window)
      if (window.isMaximized()) trayMaximizedWindows[window.id] = true
    }
    window.hide()
    createTrayContextMenu()
  }

  function toggleTrayWindow() {
    const window = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0]
    if (!window) {
      createWindow({ showWindowNow: true })
    } else if (window.isVisible() && !window.isMinimized() && !trayWindows.includes(window)) {
      hideWindowToTray(window)
    } else {
      trayClick(window)
    }
  }

  function trayClick(window) {
    if (window.isDestroyed()) return
    trayWindows = trayWindows.filter(item => item.id !== window.id)
    if (window.isMinimized()) window.restore()
    window.show()
    if (window.id in trayMaximizedWindows) window.maximize()
    delete trayMaximizedWindows[window.id]
    window.focus()
    mainWindow = window
    createTrayContextMenu()
  }

  function createTrayContextMenu() {
    if (!tray || tray.isDestroyed()) return
    // macOS opens an attached context menu on left click; show it explicitly
    // on right click so left click can toggle the window on every platform.
    if (process.platform !== 'darwin') {
      const template = defaultTrayMenu()
      // Media position updates do not change menu items. Replacing an identical
      // menu interrupts the open StatusNotifier menu on Plasma.
      const signature = JSON.stringify([trayMenuIconPack, template])
      if (signature === trayMenuSignature) return
      tray.setContextMenu(Menu.buildFromTemplate(template))
      trayMenuSignature = signature
    }
  }

  function createMediaMenuItems(iconFor = () => undefined) {
    const session = getDockMediaSession()
    const actions = session?.actions ?? new Set()
    const toggleAction = session?.playbackState === 'playing' ? 'pause' : 'play'
    return [
      {
        label: dockMediaLabels.previous,
        icon: iconFor('step-backward'),
        enabled: actions.has('previoustrack'),
        click: () => requestDockMediaAction('previoustrack')
      },
      {
        label: toggleAction === 'pause' ? dockMediaLabels.pause : dockMediaLabels.play,
        icon: iconFor(toggleAction),
        enabled: actions.has(toggleAction),
        click: () => requestDockMediaAction(toggleAction)
      },
      {
        label: dockMediaLabels.next,
        icon: iconFor('step-forward'),
        enabled: actions.has('nexttrack'),
        click: () => requestDockMediaAction('nexttrack')
      }
    ]
  }

  function defaultTrayMenu() {
    const windows = BrowserWindow.getAllWindows()
    const iconFor = name => getTrayMenuIcon(name, trayMenuIconPack)
    const isShown = window => window.isVisible() && !window.isMinimized() && !trayWindows.includes(window)
    return [
      ...windows.map(window => ({
        id: `window-${window.id}`,
        icon: iconFor('display'),
        label: window.getTitle().replace(/\u2063[\u200b\u200c]+$/, '').replace(/ - OpenTubeX$/, ''),
        submenu: [
          {
            label: trayTranslate(isShown(window) ? 'Video.Player.Hide' : 'Video.Player.Show'),
            icon: iconFor(isShown(window) ? 'eye-slash' : 'eye'),
            click: () => isShown(window) ? hideWindowToTray(window) : trayClick(window)
          },
          {
            label: trayTranslate('Close'),
            icon: iconFor('times'),
            click: () => {
              trayClick(window)
              trayClosingWindowIds.add(window.id)
              window.close()
            }
          }
        ]
      })),
      { type: 'separator' },
      ...createMediaMenuItems(iconFor),
      { type: 'separator' },
      {
        label: dockMediaLabels.newWindow,
        icon: iconFor('clone'),
        click: () => createWindow({
          showWindowNow: true,
          replaceMainWindow: !mainWindow || mainWindow.isDestroyed() || trayWindows.includes(mainWindow)
        })
      },
      ...(windows.some(window => !isShown(window))
        ? [{
            label: trayTranslate('Tray.Show All Windows'),
            icon: iconFor('eye'),
            click: () => {
              for (const window of BrowserWindow.getAllWindows()) {
                if (!isShown(window)) trayClick(window)
              }
            }
          }]
        : []),
      ...(windows.some(isShown)
        ? [{
            label: trayTranslate('Tray.Hide All Windows'),
            icon: iconFor('eye-slash'),
            click: () => {
              for (const window of BrowserWindow.getAllWindows()) {
                if (isShown(window)) hideWindowToTray(window)
              }
            }
          }]
        : []),
      {
        label: trayTranslate('Quit'),
        icon: iconFor('power-off'),
        click: () => requestQuit(BrowserWindow.getFocusedWindow() ?? mainWindow)
      }
    ]
  }

  function destroyTray() {
    if (!tray || isTrayEnabled()) return
    tray.destroy()
    tray = null
    trayMenuSignature = null
  }

  function showHiddenWindows() {
    for (const window of [...trayWindows]) trayClick(window)
  }

  /**
   * @param {string} extension
   */
  function contentTypeFromFileExtension(extension) {
    switch (extension) {
      case 'html':
        return 'text/html'
      case 'css':
        return 'text/css'
      case 'js':
        return 'text/javascript'
      case 'wasm':
        return 'application/wasm'
      case 'ttf':
        return 'font/ttf'
      case 'woff2':
        return 'font/woff2'
      case 'svg':
        return 'image/svg+xml'
      case 'png':
        return 'image/png'
      case 'json':
        return 'application/json'
      case 'txt':
        return 'text/plain'
      default:
        return 'application/octet-stream'
    }
  }

  const htmlFullscreenWindowIds = new Set()

  async function createWindow(
    {
      replaceMainWindow = true,
      windowStartupUrl = null,
      searchQueryText = null,
      sessionData = null,
      loadInactiveTabsOnRestore = false,
      restoreTabLoadStateOnRestore = false,
      loadLandingPageOnRestore = false,
      waitForInitialization = false
    } = { }) {
    await backgroundSubscriptions.setBackground(false)
    // Syncing new window background to theme choice.
    const windowBackground = await baseHandlers.settings._findOne('baseTheme').then(async (setting) => {
      let theme = setting?.value ?? 'system'
      if (theme === 'system') {
        const classification = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
        const selected = await baseHandlers.settings._findOne(
          classification === 'dark' ? 'systemDarkTheme' : 'systemLightTheme'
        )
        const customThemes = isCustomThemeValue(selected?.value) ? await loadCustomThemes() : []
        theme = resolveSystemTheme(selected?.value, classification, customThemes)
      }

      // Determine window color to be shown (shown most prominently during initial app load)
      // Uses the --bg-color for each corresponding theme
      if (isCustomThemeValue(theme)) {
        return (await getSelectedCustomTheme(theme))?.colors.background ??
          (nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1')
      }
      if (MATERIAL_THEME_VALUES.includes(theme)) {
        const mode = materialThemeMode(theme, nativeTheme.shouldUseDarkColors)
        if (mode === 'black') return '#000000'
        const seed = await baseHandlers.settings._findOne('materialSeedColor')
        const color = theme === 'dynamic' || seed?.value === MATERIAL_SYSTEM_SEED ? getSystemAccentColor() ?? seed?.value : seed?.value
        return materialColorScheme(materialSeedPalette(color), mode === 'dark').surface
      }
      return BASE_THEME_BACKGROUND_COLORS[theme] ??
        (nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1')
    }).catch((error) => {
      console.error(error)
      // Default to nativeTheme settings if nothing is found.
      return nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f1f1f1'
    })

    let savedBounds, savedMaximized

    /**
     * Check that the saved bounds still lie on one of the currently connected
     * displays. If a monitor was disconnected since the bounds were saved, we
     * want to fall back to a default position instead of placing the window
     * off-screen.
     * @param {{x: number, y: number, width: number, height: number}} bounds
     */
    const boundsOnVisibleDisplay = (bounds) => {
      return screen.getAllDisplays().some(display => {
        const { x, y, width, height } = display.bounds
        return !(bounds.x > x + width || bounds.x + bounds.width < x || bounds.y > y + height || bounds.y + bounds.height < y)
      })
    }

    // Prefer this window's own persisted bounds (from its last session) if
    // available. Otherwise fall back to the legacy app-wide `bounds` setting
    // so brand-new windows still open where the user last had one.
    if (sessionData?.bounds && typeof sessionData.bounds === 'object') {
      const { maximized, fullScreen: _fullScreen, ...bounds } = sessionData.bounds
      if (boundsOnVisibleDisplay(bounds)) {
        savedBounds = bounds
      }
      savedMaximized = maximized
    } else {
      const boundsDoc = await baseHandlers.settings._findOne('bounds')
      if (typeof boundsDoc?.value === 'object') {
        const { maximized, ...bounds } = boundsDoc.value
        if (boundsOnVisibleDisplay(bounds)) {
          savedBounds = bounds
        }
        savedMaximized = maximized
      }
    }

    const hideStartupSplash = (await baseHandlers.settings._findOne('hideStartupSplash'))?.value === true
    // The renderer draws its tab bar or top navigation where the system title
    // bar would be, leaving only the window controls overlay.
    const customTitleBar = (await baseHandlers.settings._findOne('customTitleBar'))?.value === true

    const newWindow = new BrowserWindow({
      // The initial HTML paints a splash before the shared renderer boots.
      show: false,
      backgroundColor: windowBackground,
      icon: process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../../_icons/iconColor.png')
        : path.join(__dirname, '../_icons/iconColor.png'),
      autoHideMenuBar: true,
      ...customTitleBar
        ? {
            titleBarStyle: 'hidden',
            // Linux draws the controls in the renderer to match the desktop's
            // decorations, which the overlay's generic buttons don't follow.
            ...process.platform === 'linux'
              ? {}
              : {
                  titleBarOverlay: process.platform === 'darwin'
                    ? true
                    : {
                        color: windowBackground,
                        symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
                        height: 32
                      }
                }
          }
        : {},
      // useContentSize: true,
      webPreferences: {
        backgroundThrottling: false,
        additionalArguments: [
          `--startup-background=${windowBackground}`,
          `--startup-dark=${nativeTheme.shouldUseDarkColors}`,
          `--system-accent-color=${getSystemAccentColor() ?? ''}`,
          `--hide-startup-splash=${hideStartupSplash}`,
          `--custom-title-bar=${customTitleBar}`
        ],
        preload: process.env.NODE_ENV === 'development'
          ? path.resolve(__dirname, '../../dist/preload.js')
          : path.resolve(__dirname, 'preload.js')
      },
      minWidth: 340,
      minHeight: 380,
      ...savedBounds
        ? {
            x: savedBounds.x,
            y: savedBounds.y,
            width: savedBounds.width,
            height: savedBounds.height
          }
        : {
            width: 1200,
            height: 800
          }
    })
    newWindow.once('show', () => {
      if (deferredDatastoresStarted) return
      deferredDatastoresStarted = true
      // Give the native splash its first frame before parsing the larger stores.
      setImmediate(() => { baseHandlers.loadDeferredDatastores() })
    })
    const kdeWindowIdentity = monitorsKdeWaylandWindowState
      ? `\u2063${newWindow.id.toString(2).replaceAll('0', '\u200b').replaceAll('1', '\u200c')}`
      : ''
    let kdeWindowIdentityReleased = false
    const formatKdeWindowTitle = title => (
      kdeWindowIdentityReleased || kdeWindowIdentity === '' || title.endsWith(kdeWindowIdentity)
        ? title
        : `${title}${kdeWindowIdentity}`
    )
    const applyKdeWindowIdentity = () => {
      const title = formatKdeWindowTitle(newWindow.getTitle())
      if (title !== newWindow.getTitle()) newWindow.setTitle(title)
    }
    const releaseKdeWindowIdentity = () => {
      kdeWindowIdentityReleased = true
      if (kdeWindowIdentity !== '' && !newWindow.isDestroyed() && newWindow.getTitle().endsWith(kdeWindowIdentity)) {
        newWindow.setTitle(newWindow.getTitle().slice(0, -kdeWindowIdentity.length))
      }
    }

    // The single BrowserWindow renderer owns window.open handling through its
    // TabManager; logical tabs do not create child webContents.

    // Initialize TabManager for this window
    const preloadPath = process.env.NODE_ENV === 'development'
      ? path.resolve(__dirname, '../../dist/preload.js')
      : path.resolve(__dirname, 'preload.js')

    const tabManager = new TabManager(
      newWindow,
      ROOT_APP_URL,
      preloadPath,
      sessionData?.sessionId,
      title => newWindow.setTitle(formatKdeWindowTitle(title))
    )

    // Forward the native window minimized state to the renderer. The renderer can't
    // reliably detect minimize on its own (`document.hidden` doesn't fire on Wayland),
    // so the auto Picture-in-Picture feature relies on these events instead.
    const sendMinimizedState = (minimized) => {
      if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
        newWindow.webContents.send(IpcChannels.WINDOW_MINIMIZED_STATE, minimized)
      }
    }
    newWindow.on('minimize', () => sendMinimizedState(true))
    newWindow.on('restore', () => sendMinimizedState(false))
    // Cover minimize-to-tray (and app hide), where the window is hidden rather than minimized.
    newWindow.on('hide', () => sendMinimizedState(true))
    newWindow.on('show', () => sendMinimizedState(false))

    // Renderer focus events can be skipped on Windows when focus returns after
    // another application's window is closed. Forward the native state so
    // blur-triggered auto PiP can still re-embed the video. KDE Wayland checks
    // KWin first because desktop popups blur the Wayland surface without
    // switching away from the app's top-level window.
    const sendFocusedState = (focused) => {
      if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
        newWindow.webContents.send(IpcChannels.WINDOW_FOCUSED_STATE, focused)
      }
    }
    if (monitorsKdeWaylandWindowState) {
      monitorKdeWaylandWindowState({
        browserWindow: newWindow,
        backend: kdeWaylandWindowStateBackend,
        applyWindowIdentity: applyKdeWindowIdentity,
        onFocusedState: sendFocusedState,
        onMinimizedState: minimized => {
          // KWin can report restored after restore-before-hide; the window
          // still counts as minimized for auto PiP while it remains hidden.
          sendMinimizedState(minimized || !newWindow.isVisible())
          if (minimized) minimizeToTray()
        },
        releaseWindowIdentity: releaseKdeWindowIdentity,
      })
    } else {
      newWindow.on('focus', () => sendFocusedState(true))
      newWindow.on('blur', () => sendFocusedState(false))
    }

    let minimizeToTrayTimer = null
    const minimizeToTray = () => {
      if (!isTrayOnMinimizeSupported || !trayOnMinimize || !isTrayEnabled() ||
          isQuitting || newWindow.isDestroyed() || trayWindows.includes(newWindow)) return
      if (minimizeToTrayTimer !== null) return
      // Restore before hiding on Linux to avoid Electron's stuck minimized state.
      if (process.platform === 'linux') {
        minimizeToTrayTimer = setTimeout(() => {
          minimizeToTrayTimer = null
          if (newWindow.isDestroyed() || isQuitting || !trayOnMinimize || !isTrayEnabled()) return
          newWindow.restore()
          hideWindowToTray(newWindow)
        }, 100)
      } else {
        hideWindowToTray(newWindow)
      }
    }
    newWindow.on('minimize', minimizeToTray)
    newWindow.on('maximize', () => { trayMaximizedWindows[newWindow.id] = true })
    newWindow.on('unmaximize', () => {
      if (!trayWindows.includes(newWindow)) delete trayMaximizedWindows[newWindow.id]
    })
    const cancelMinimizeToTray = () => {
      clearTimeout(minimizeToTrayTimer)
      minimizeToTrayTimer = null
    }
    newWindow.on('restore', cancelMinimizeToTray)
    newWindow.on('focus', cancelMinimizeToTray)
    newWindow.on('show', () => {
      cancelMinimizeToTray()
      trayWindows = trayWindows.filter(window => window !== newWindow)
      createTrayContextMenu()
    })
    newWindow.on('focus', () => { mainWindow = newWindow })
    newWindow.on('page-title-updated', createTrayContextMenu)
    newWindow.once('closed', () => {
      clearTimeout(minimizeToTrayTimer)
      trayWindows = trayWindows.filter(window => window !== newWindow)
      delete trayMaximizedWindows[newWindow.id]
      trayClosingWindowIds.delete(newWindow.id)
      createTrayContextMenu()
    })

    if (replaceMainWindow) {
      mainWindow = newWindow
    }

    // A dead renderer (e.g. V8 out of memory) otherwise leaves a frozen window
    // until the app is restarted. Stop after repeated crashes to avoid a loop.
    let lastRendererCrash = 0
    newWindow.webContents.on('render-process-gone', async (_event, { reason, exitCode }) => {
      if (reason === 'clean-exit') return
      console.error(`Renderer process gone (${reason}, exit code ${exitCode})`)
      const now = Date.now()
      if (now - lastRendererCrash < 60_000) return
      lastRendererCrash = now
      await TabManager.getFromWebContents(newWindow.webContents)?.unloadBackgroundTabs().catch(error => {
        console.error('Failed to unload background tabs after a renderer crash:', error)
      })
      if (!newWindow.isDestroyed()) newWindow.webContents.reload()
    })

    if (savedMaximized) {
      newWindow.maximize()
    }

    // If called multiple times
    // Duplicate menu items will be added
    if (replaceMainWindow) {
      setMenu()
    }

    let startupWindowShown = false
    const showWindow = () => {
      // A later load/presentation callback must not resurface a window the user
      // already minimized or hid while its splash was visible.
      if (newWindow.isDestroyed() || startupWindowShown) return
      startupWindowShown = true
      if (newWindow.isVisible()) {
        // only open the dev tools if they aren't already open
        if (process.env.NODE_ENV === 'development' && !newWindow.webContents.isDevToolsOpened()) {
          newWindow.webContents.openDevTools({ activate: false })
        }
        return
      }

      if (isTrayOnMinimizeSupported && trayOnMinimize && trayWindows.length > 0) {
        trayClick(newWindow)
      } else {
        applyKdeWindowIdentity()
        newWindow.show()
        newWindow.focus()
      }

      if (process.env.NODE_ENV === 'development') {
        newWindow.webContents.openDevTools({ activate: false })
      }
    }

    if (customTitleBar && process.platform === 'linux') {
      const getWindowControlsState = async () => ({
        layout: await getWindowButtonLayout(),
        maximized: newWindow.isMaximized(),
        fullScreen: newWindow.isFullScreen()
      })
      const sendWindowControlsState = async () => {
        const state = await getWindowControlsState()
        if (!newWindow.isDestroyed() && !newWindow.webContents.isDestroyed()) {
          newWindow.webContents.send(IpcChannels.WINDOW_CONTROLS_STATE, state)
        }
      }
      for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
        newWindow.on(event, sendWindowControlsState)
      }
      newWindow.once('closed', onWindowButtonLayoutChanged(sendWindowControlsState))

      newWindow.webContents.ipc.handle(IpcChannels.WINDOW_CONTROLS_GET, (event) => {
        if (!isOpenTubeXUrl(event.senderFrame.url)) return null
        return getWindowControlsState()
      })
      newWindow.webContents.ipc.on(IpcChannels.WINDOW_CONTROL_ACTION, (event, action) => {
        if (!isOpenTubeXUrl(event.senderFrame.url) || newWindow.isDestroyed()) return
        if (action === 'minimize') {
          newWindow.minimize()
        } else if (action === 'maximize') {
          if (newWindow.isMaximized()) {
            newWindow.unmaximize()
          } else {
            newWindow.maximize()
          }
        } else if (action === 'close') {
          newWindow.close()
        }
      })
    } else if (customTitleBar) {
      // The renderer reports the colors and height of the bar under the
      // window controls whenever its theme, layout or UI scale changes.
      newWindow.webContents.ipc.on(IpcChannels.SET_TITLE_BAR_OVERLAY, (event, overlay) => {
        if (!isOpenTubeXUrl(event.senderFrame.url) || newWindow.isDestroyed()) return
        const { color, symbolColor, height } = overlay ?? {}
        if (typeof color !== 'string' || typeof symbolColor !== 'string' ||
          !Number.isFinite(height) || height <= 0) return
        if (process.platform === 'darwin') {
          // The overlay spans the traffic lights' 16 px tall frames and their
          // margins, so equal margins center them in the bar at its scaled
          // height. 7 px is the system's horizontal margin.
          newWindow.setWindowButtonPosition({ x: 7, y: Math.max(0, Math.round((height - 16) / 2)) })
        } else {
          newWindow.setTitleBarOverlay({ color, symbolColor, height: Math.round(height) })
        }
      })

      if (process.platform === 'win32') {
        // Windows treats drag regions as the title bar, so their mouse buttons
        // never reach the page. Forward middle clicks so the empty tab strip
        // still opens tabs.
        const WM_NCMBUTTONUP = 0x00A8
        const HTCAPTION = 2
        newWindow.hookWindowMessage(WM_NCMBUTTONUP, (wParam, lParam) => {
          if (wParam.readUInt32LE(0) !== HTCAPTION || newWindow.webContents.isDestroyed()) return
          const point = screen.screenToDipPoint({ x: lParam.readInt16LE(0), y: lParam.readInt16LE(2) })
          const bounds = newWindow.getContentBounds()
          newWindow.webContents.send(IpcChannels.TITLE_BAR_MIDDLE_CLICK, {
            x: point.x - bounds.x,
            y: point.y - bounds.y
          })
        })
      }
    }

    newWindow.once('ready-to-show', showWindow)
    newWindow.webContents.ipc.once(IpcChannels.STARTUP_SPLASH_READY, showWindow)

    // Initialize tabs - try to restore session or create initial tab
    const initializeTabs = async () => {
      // Restore tabs from the pre-loaded session data if one was passed in
      // (the startup flow loads every window's session up-front so that each
      // window gets its own data).
      let sessionRestored = false
      if (!windowStartupUrl) {
        sessionRestored = await tabManager.restoreFromData(sessionData, {
          loadInactiveTabs: loadInactiveTabsOnRestore,
          restoreTabLoadState: restoreTabLoadStateOnRestore,
          loadLandingPage: loadLandingPageOnRestore
        })
      }

      if (!sessionRestored) {
        // Create initial tab
        if (windowStartupUrl != null) {
          tabManager.createTab({ url: windowStartupUrl, makeActive: true })
        } else {
          await tabManager.createTabWithPreference({ makeActive: true })
        }
      }

      // Load the shared Vue shell exactly once. Logical tab routes are projected
      // by the renderer after it reconciles the main-owned metadata.
      await newWindow.loadURL(ROOT_APP_URL)
      // The shared shell has finished loading and can paint its themed frame.
      // Do not keep the whole native window hidden while the initial logical
      // route finishes mounting; that made startup feel substantially slower.
      showWindow()
      await tabManager.waitForInitialPresentation()
      if (typeof searchQueryText === 'string' && searchQueryText.length > 0) {
        newWindow.webContents.send(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, searchQueryText)
      }
    }

    const initialization = initializeTabs()
    if (!waitForInitialization) {
      initialization.catch(error => {
        console.error('Failed to initialize tabs', error)
        showWindow()
      })
    }

    // Renderer presentation readiness above has a bounded timeout, so the
    // window cannot remain hidden if the initial logical tab fails to mount.

    newWindow.on('enter-html-full-screen', () => {
      htmlFullscreenWindowIds.add(newWindow.id)
    })

    newWindow.on('leave-html-full-screen', () => {
      htmlFullscreenWindowIds.delete(newWindow.id)
    })

    newWindow.on('close', async (event) => {
      if (!isQuitting && trayOnClose && isTrayEnabled() &&
          !trayClosingWindowIds.has(newWindow.id) && tabManager.tabs.size > 0) {
        event.preventDefault()
        hideWindowToTray(newWindow)
        return
      }

      const wasLastWindow = BrowserWindow.getAllWindows().length === 1

      if (!isQuitting && !closeConfirmedWindowIds.delete(newWindow.id) &&
          (wasLastWindow || tabManager.tabs.size > 1)) {
        event.preventDefault()

        // An explicit tray Close or closing the last tab still quits instead of hiding the window.
        const hideWithoutPrompt = keepRefreshingInBackground &&
          !trayClosingWindowIds.has(newWindow.id) && tabManager.tabs.size > 0
        let quitsApp = wasLastWindow
        let confirmed = quitsApp
          ? await confirmCloseApp(newWindow, keepRefreshingInBackground, hideWithoutPrompt)
          : await confirmCloseWindowWithMultipleTabs(newWindow, tabManager.tabs.size)
        const openWindowCount = BrowserWindow.getAllWindows()
          .filter(window => !closingWindowIds.has(window.id)).length
        if (confirmed && !wasLastWindow && openWindowCount === 1) {
          confirmed = await confirmCloseApp(newWindow, keepRefreshingInBackground, hideWithoutPrompt)
          quitsApp = confirmed
        }
        if (confirmed && quitsApp) {
          isQuitConfirmed = true
          app.quit()
        } else if (confirmed) {
          closeConfirmedWindowIds.add(newWindow.id)
          newWindow.close()
        } else {
          trayClosingWindowIds.delete(newWindow.id)
        }

        return
      }

      if (!isQuitting) {
        closedWindows.remember(tabManager.getSessionDataForWindowClose())
      }

      closingWindowIds.add(newWindow.id)

      // A confirmation can remain open while another window closes. Recompute
      // this after the async prompt so the session decision uses current state.
      const isLastWindow = BrowserWindow.getAllWindows()
        .filter(window => window.id === newWindow.id || !closingWindowIds.has(window.id))
        .length === 1

      // returns true if the element existed in the set
      const htmlFullscreen = htmlFullscreenWindowIds.delete(newWindow.id)

      const value = {
        ...newWindow.getNormalBounds(),
        maximized: newWindow.isMaximized(),

        // Don't save the full screen state if it was triggered by an HTML API e.g. the video player
        fullScreen: newWindow.isFullScreen() && !htmlFullscreen
      }

      // The current window is still part of getAllWindows() at the point the
      // `close` event fires, so length === 1 means we're closing the last one.
      // Preserve this window's tab session when:
      //   - the app is quitting (so every open window comes back on next launch)
      //   - or this is the last window closing (single-window sessions have
      //     always been restored historically, keep that behavior)
      // Otherwise the user manually closed one of several windows and we don't
      // want it resurrected the next time the app runs.
      if (isQuitting || isLastWindow) {
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
        await baseHandlers.settings._updateBounds(value)
      }
    })

    for (const event of ['show', 'hide', 'minimize', 'restore']) {
      newWindow.on(event, () => {
        updateBackgroundSubscriptionVisibility()
        // backgroundThrottling is disabled, so Chromium may not emit visibilitychange.
        if (event === 'show' || event === 'restore') {
          newWindow.webContents.send(IpcChannels.SUBSCRIPTION_BACKGROUND)
        }
      })
    }
    newWindow.once('closed', () => {
      closingWindowIds.delete(newWindow.id)
      const allWindows = BrowserWindow.getAllWindows()
      if (allWindows.length !== 0 && newWindow === mainWindow) {
        // Replace mainWindow to avoid accessing `mainWindow.webContents`
        // Which raises "Object has been destroyed" error
        mainWindow = allWindows[0]
      }

      stopPowerSaveBlockerForWindow(newWindow)
      updateBackgroundSubscriptionVisibility()
    })

    if (waitForInitialization) {
      try {
        await initialization
      } catch (error) {
        try {
          await tabManager.clearSession({
            preservePersistedSession: typeof sessionData?.sessionId === 'string' &&
              sessionData.sessionId === tabManager.sessionId
          })
        } finally {
          // Destroy skips the close handler, so a failed partial restore is not
          // remembered as another recently closed window.
          if (!newWindow.isDestroyed()) newWindow.destroy()
        }
        throw error
      }
    }

    return newWindow
  }

  const {
    createWindowForOpenUrl,
    openUrlInWindow,
    openPendingUrlForReadyWebContents,
    forgetOpenUrlRenderer,
    forgetOpenUrlWebContents
  } = createUrlOpener({ rootAppUrl: ROOT_APP_URL, createWindow })

  ipcMain.handle(IpcChannels.SHARE_LINK, createDesktopShareHandler({
    platform: process.platform,
    isTrustedSender: event => event.senderFrame === event.sender.mainFrame && isOpenTubeXUrl(event.senderFrame.url),
    getWindow: event => BrowserWindow.fromWebContents(event.sender),
    ShareMenu,
    loadWindowsShare: () => loadWindowsShare(__dirname, process.env.NODE_ENV === 'development')
  }))

  ipcMain.on(IpcChannels.APP_READY, (event) => {
    openPendingUrlForReadyWebContents(event)
  })

  ipcMain.on(IpcChannels.SHOW_TOAST, (event, message, time, icon, buttonAction) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      typeof message !== 'string' ||
      (time !== null && typeof time !== 'number') ||
      (icon != null && (!Array.isArray(icon) || icon.length !== 2 || icon.some(part => typeof part !== 'string'))) ||
      (buttonAction != null && buttonAction !== 'open-sync-settings')
    ) {
      return
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SHOW_TOAST, message, time, icon ?? null, buttonAction ?? null)
      }
    }
  })

  const isValidLiveReminderSender = event => isOpenTubeXUrl(event.senderFrame.url)
  const isValidVideoId = videoId => typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId)

  ipcMain.handle(IpcChannels.LIVE_REMINDER_GET, (event, videoId) => {
    if (!isValidLiveReminderSender(event) || !isValidVideoId(videoId) || !supportsNativeNotifications(Notification)) {
      return null
    }
    return liveReminderManager.get(videoId)
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_LIST, (event) => {
    if (!isValidLiveReminderSender(event) || !supportsNativeNotifications(Notification)) {
      return []
    }
    return liveReminderManager.list()
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_SCHEDULE, (event, reminder) => {
    if (
      !isValidLiveReminderSender(event) ||
      !supportsNativeNotifications(Notification) ||
      !isValidVideoId(reminder?.videoId) ||
      !Number.isFinite(reminder?.startTimestamp) ||
      reminder.startTimestamp <= Date.now() ||
      typeof reminder.notificationTitle !== 'string' ||
      reminder.notificationTitle.length === 0 ||
      reminder.notificationTitle.length > 200 ||
      typeof reminder.notificationBody !== 'string' ||
      reminder.notificationBody.length === 0 ||
      reminder.notificationBody.length > 500
    ) {
      return false
    }
    return liveReminderManager.schedule(reminder)
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_CANCEL, (event, videoId) => {
    if (!isValidLiveReminderSender(event) || !isValidVideoId(videoId)) {
      return false
    }
    return liveReminderManager.cancel(videoId)
  })

  setupVideoMetadataCacheIpc({ getConfiguredApiServerUrl })

  ipcMain.handle(IpcChannels.STORAGE_GET_USAGE, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return {}
    return getStorageUsage()
  })

  ipcMain.handle(IpcChannels.STORAGE_CLEAR, async (event, category) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !event.sender.isFocused()) return false
    return clearStorage(category)
  })

  ipcMain.handle(IpcChannels.STORAGE_COMPACT_DATABASES, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return false
    return compactStorageDatabases()
  })

  setupSubscriptionAutoRefreshIpc({ backgroundSubscriptions, updateBackgroundSubscriptionVisibility })

  ipcMain.on(IpcChannels.SET_WINDOW_TITLE, (event, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const title = payload?.title
    const tabId = payload?.tabId
    const manager = TabManager.getFromWebContents(event.sender)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null

    if (manager && tab && typeof title === 'string') {
      manager.applyTabTitle(tab, title)
    }
  })

  function relaunch() {
    if (process.env.NODE_ENV === 'development') {
      app.exit(parseInt(process.env.OPENTUBEX_RELAUNCH_EXIT_CODE))
      return
    }

    // The AppImage and Windows portable formats must be accounted for
    // because `process.execPath` points at the temporarily extracted
    // executables, not the executables themselves
    //
    // It's possible to detect these formats and identify their
    // executables' paths by checking the environmental variables
    const { env: { APPIMAGE, PORTABLE_EXECUTABLE_FILE } } = process

    if (!APPIMAGE) {
      // If it's a Windows portable, PORTABLE_EXECUTABLE_FILE will
      // hold a value.
      // Otherwise, `process.execPath` should be used instead.
      const scheduled = app.relaunch({
        args: process.argv.slice(1),
        execPath: PORTABLE_EXECUTABLE_FILE || process.execPath
      })
      if (scheduled !== false) relaunchRequested = true
    } else {
      // If it's an AppImage, things must be done the "hard way"
      // `app.relaunch` doesn't work because of FUSE limitations
      // Spawn a new process using the APPIMAGE env variable
      const subprocess = cp.spawn(APPIMAGE, { detached: true, stdio: 'ignore' })
      subprocess.unref()
    }

    isQuitConfirmed = true
    app.quit()
  }

  ipcMain.once(IpcChannels.RELAUNCH_REQUEST, () => {
    relaunch()
  })

  nativeTheme.on('updated', () => {
    const allWindows = BrowserWindow.getAllWindows()

    allWindows.forEach((window) => {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.NATIVE_THEME_UPDATE, nativeTheme.shouldUseDarkColors)
      }
    })
  })

  const publishSystemAccentColor = () => {
    const color = getSystemAccentColor()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SYSTEM_ACCENT_COLOR_UPDATED, color)
      }
    }
  }
  systemPreferences.on('accent-color-changed', publishSystemAccentColor)
  if (process.platform === 'darwin') {
    const subscription = systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', publishSystemAccentColor)
    app.once('will-quit', () => systemPreferences.unsubscribeNotification(subscription))
  }

  ipcMain.handle(IpcChannels.GENERATE_PO_TOKEN, (event, videoId, context, initialAttestationData, ytConfig) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return generatePoToken(videoId, context, initialAttestationData, ytConfig, proxyUrl)
    }
  })

  ipcMain.on(IpcChannels.ENABLE_PROXY, (event, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    session.defaultSession.setProxy({
      proxyRules: url
    })
    proxyUrl = url
    session.defaultSession.closeAllConnections()
  })

  ipcMain.on(IpcChannels.DISABLE_PROXY, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    session.defaultSession.setProxy({})
    proxyUrl = undefined
    session.defaultSession.closeAllConnections()
  })

  // #region navigation history

  ipcMain.handle(IpcChannels.GET_NAVIGATION_HISTORY, ({ senderFrame }) => {
    if (!isOpenTubeXUrl(senderFrame.url)) {
      return
    }

    // Logical tab history is renderer-owned. The retained API returns an empty
    // list for older callers; TopNav reads the active tab runtime directly.
    return []
  })

  // #endregion navigation history

  ipcMain.handle(IpcChannels.GET_DEVICE_NAME, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return hostname()
    }
  })

  setupDiagnosticLogIpc()
  baseHandlers.settings._findOne('diagnosticLogging').then((setting) => {
    setDiagnosticLogging(setting?.value === true)
  }).catch(error => console.error('Failed to read the diagnostic logging setting', error))

  ipcMain.handle(IpcChannels.GET_DEVICE_INFO, async (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      const linuxDistribution = process.platform === 'linux'
        ? await getLinuxDistributionInfo()
        : null
      return {
        platform: linuxDistribution?.platform || process.platform,
        architecture: process.arch,
        release: linuxDistribution?.release || release(),
      }
    }
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_LOCALE, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      // we should switch to getPreferredSystemLanguages at some point and iterate through until we find a supported locale
      return app.getSystemLocale()
    }
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_FONTS, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return []

    const fonts = await getFonts({ disableQuoting: true })
    return [...new Set(fonts
      .filter(font => typeof font === 'string')
      .map(font => font.trim())
      .filter(Boolean))]
  })

  ipcMain.handle(IpcChannels.GET_SYSTEM_ACCENT_COLOR, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) return getSystemAccentColor()
    return null
  })

  ipcMain.handle(IpcChannels.IS_WAYLAND_PLATFORM, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return isWaylandPlatform
    }
  })

  ipcMain.handle(IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE, async (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return supportsAutoPictureInPictureMinimize
    }
  })

  ipcMain.on(IpcChannels.OPEN_PROFILE_DIRECTORY, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    shell.openPath(app.getPath('userData')).then((error) => {
      if (error) {
        console.error(`Unable to open profile directory: ${error}`)
      }
    }).catch((error) => {
      console.error('Unable to open profile directory', error)
    })
  })

  ipcMain.handle(IpcChannels.CREATE_BACKUP_ARCHIVE, async (event, sections, settings) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return null
    if (!Array.isArray(sections) || sections.some(section => typeof section !== 'string') ||
      (settings !== undefined && (settings === null || typeof settings !== 'object' || Array.isArray(settings)))) {
      throw new TypeError('Invalid backup sections or settings')
    }
    return createBackupArchive({ sections, settings })
  })

  ipcMain.handle(IpcChannels.CHOOSE_SCHEDULED_BACKUP_FOLDER, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return
    const currentPath = (await baseHandlers.settings._findOne('scheduledBackupFolderPath'))?.value
    const options = { defaultPath: currentPath || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    if (result.canceled || !result.filePaths[0]) return
    await updateSettingFromMain('scheduledBackupFolderPath', result.filePaths[0])
    checkScheduledBackup()
    return result.filePaths[0]
  })

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string | undefined} [currentPath]
   */
  async function chooseDefaultFolder(webContents, currentPath) {
    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('pictures')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    let result

    const window = BrowserWindow.fromWebContents(webContents)
    if (window) {
      result = await dialog.showOpenDialog(window, dialogOptions)
    } else {
      result = await dialog.showOpenDialog(dialogOptions)
    }

    if (result.canceled) {
      return
    }

    const settingId = 'screenshotFolderPath'

    await baseHandlers.settings.upsert(settingId, result.filePaths[0])

    const syncPayload = {
      event: SyncEvents.GENERAL.UPSERT,
      data: {
        _id: settingId,
        value: result.filePaths[0]
      }
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SYNC_SETTINGS, syncPayload)
      }
    })

    return result.filePaths[0]
  }

  ipcMain.on(IpcChannels.CHOOSE_DEFAULT_FOLDER, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const currentPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

    await chooseDefaultFolder(event.sender, currentPath)
  })

  ipcMain.handle(IpcChannels.WRITE_TO_DEFAULT_FOLDER, async (event, filename, arrayBuffer) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      typeof filename !== 'string' ||
      !(arrayBuffer instanceof ArrayBuffer)) {
      return
    }

    const folderPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

    let directory
    if (typeof folderPath === 'string' && folderPath.length > 0) {
      try {
        await asyncFs.access(path.normalize(folderPath), fsConstants.W_OK)
        directory = folderPath
      } catch {}
    }

    // if setting is not set or we do not have write access to the folder
    // prompt the user for a folder
    // not having write access can happen if the user copies their settings to different machines
    // or if they revoke a previously permitted folder in flatseal
    if (directory === undefined) {
      directory = await chooseDefaultFolder(event.sender)

      if (typeof directory !== 'string' || directory.length === 0) {
        return false
      }
    }

    directory = path.normalize(directory)

    const filePath = path.resolve(directory, filename)

    // Ensure that we are only writing inside of the expected directory
    // 'path.dirname' does not return trailing slash, remove it from 'directory' path to ensure consistent comparison
    if (path.dirname(filePath) !== directory.replace(/\/$/, '')) {
      throw new Error('Invalid save location')
    }

    try {
      await asyncFs.mkdir(directory, { recursive: true })

      await asyncFs.writeFile(filePath, new DataView(arrayBuffer))
    } catch (error) {
      console.error('WRITE_TO_DEFAULT_FOLDER failed', error)
      // throw a new error so that we don't expose the real error to the renderer
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Failed to save')
    }

    return true
  })

  setupIpBlockRecoveryIpc()

  /** @type {Map<number, number>} */
  const activePowerSaveBlockers = new Map()

  ipcMain.handle(IpcChannels.TABS_SET_SHORTCUTS_BLOCKED, (event, blocked) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof blocked !== 'boolean') {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) return

    if (blocked) {
      appShortcutBlockedWindows.add(browserWindow)
    } else {
      appShortcutBlockedWindows.delete(browserWindow)
    }
  })

  /**
   * @param {BrowserWindow} window
   */
  function stopPowerSaveBlockerForWindow(window) {
    const powerSaveBlockerId = activePowerSaveBlockers.get(window.id)

    if (typeof powerSaveBlockerId === 'number') {
      powerSaveBlocker.stop(powerSaveBlockerId)

      activePowerSaveBlockers.delete(window.id)
    }
  }

  ipcMain.on(IpcChannels.STOP_POWER_SAVE_BLOCKER, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    if (browserWindow) {
      stopPowerSaveBlockerForWindow(browserWindow)
    }
  })

  ipcMain.on(IpcChannels.START_POWER_SAVE_BLOCKER, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    if (browserWindow && !activePowerSaveBlockers.has(browserWindow.id)) {
      const powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')

      activePowerSaveBlockers.set(browserWindow.id, powerSaveBlockerId)
    }
  })

  ipcMain.on(IpcChannels.RESTORE_CLOSED_WINDOW, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow || appShortcutBlockedWindows.has(browserWindow)) return
    reopenClosedWindow()
  })

  ipcMain.on(IpcChannels.CREATE_NEW_WINDOW, (event, path, query, searchQueryText) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (
      typeof path !== 'string' ||
      (query != null && typeof query !== 'object') ||
      (searchQueryText != null && typeof searchQueryText !== 'string')
    ) {
      return
    }

    if (path.charAt(0) !== '/') {
      path = `/${path}`
    }

    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && item !== undefined) {
            searchParams.append(key, String(item))
          }
        }
      } else if (value !== null && value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const search = searchParams.toString()
    const windowStartupUrl = `${ROOT_APP_URL}#${path}${search.length > 0 ? `?${search}` : ''}`

    createWindow({
      replaceMainWindow: false,
      showWindowNow: true,
      windowStartupUrl,
      searchQueryText
    })
  })

  // Handler for creating new tab from renderer
  ipcMain.on(IpcChannels.CREATE_NEW_TAB, (event, path, query) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const manager = TabManager.getFromWebContents(event.sender)
    if (manager) {
      manager.createTabWithPreference({ route: path, query, makeActive: true }).catch(error => {
        console.error('Failed to create a new tab from the renderer:', error)
      })
    }
  })

  ipcMain.on(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, handleOpenInExternalPlayer)
  /** The API server the user configured, which may run on a private network */
  async function getConfiguredApiServerUrl() {
    if ((await baseHandlers.settings._findOne('backendPreference'))?.value === 'yattee') {
      return normalizeYatteeServerUrl((await baseHandlers.settings._findOne('yatteeServerUrl'))?.value)
    }
    return (await baseHandlers.settings._findOne('defaultInvidiousInstance'))?.value
  }

  setupYtDlpIpc()
  ipcMain.handle(IpcChannels.TWITCH_CHAT_REPLAY_PAGE, handleTwitchChatReplayPage)
  ipcMain.handle(IpcChannels.TWITCH_SUB_ONLY_VOD, handleTwitchSubOnlyVod)

  ipcMain.handle(IpcChannels.GET_REPLACE_HTTP_CACHE, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return replaceHttpCache
    }
  })

  ipcMain.once(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (replaceHttpCache) {
      await asyncFs.rm(REPLACE_HTTP_CACHE_PATH)
    } else {
      // create an empty file
      const handle = await asyncFs.open(REPLACE_HTTP_CACHE_PATH, 'w')
      await handle.close()
    }

    relaunch()
  })

  ipcMain.handle(IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return disableHardwareAcceleration
    }
  })

  ipcMain.once(IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (disableHardwareAcceleration) {
      await asyncFs.rm(DISABLE_HARDWARE_ACCELERATION_PATH)
    } else {
      // create an empty file
      const handle = await asyncFs.open(DISABLE_HARDWARE_ACCELERATION_PATH, 'w')
      await handle.close()
    }

    relaunch()
  })

  function playerCachePathForKey(key) {
    // Remove path separators and period characters,
    // to prevent any files outside of the player_cache directory,
    // from being read or written
    const sanitizedKey = `${key}`.replaceAll(/[./\\]/g, '__')

    return path.join(PLAYER_CACHE_PATH, sanitizedKey)
  }

  ipcMain.handle(IpcChannels.PLAYER_CACHE_GET, async (event, key) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const filePath = playerCachePathForKey(key)

    try {
      const contents = await asyncFs.readFile(filePath)

      return contents.buffer
    } catch (e) {
      // Don't log the error if the file doesn't exist as we'll just fetch it from YouTube
      // this usually happens when YouTube updates their player JavaScript
      if (e.code !== 'ENOENT') {
        console.error(e)
      }

      return undefined
    }
  })

  ipcMain.handle(IpcChannels.PLAYER_CACHE_SET, async (event, key, value) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const filePath = playerCachePathForKey(key)

    await asyncFs.mkdir(PLAYER_CACHE_PATH, { recursive: true })

    await asyncFs.writeFile(filePath, new Uint8Array(value))
  })

  ipcMain.handle(IpcChannels.VOICE_OVER_TRANSLATION_REQUEST, async (event, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    return await requestVoiceOverTranslation(payload)
  })

  /** @type {Map<number, { url: string, authorization: string }>} */
  const invidiousAuthorizations = new Map()

  ipcMain.on(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, (event, authorization, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    if (!authorization) {
      invidiousAuthorizations.delete(event.sender.id)
    } else if (typeof authorization === 'string' && typeof url === 'string') {
      invidiousAuthorizations.set(event.sender.id, { authorization, url })
    }
  })

  function updateThemeSource(baseTheme) {
    nativeTheme.themeSource = LIGHT_BASE_THEMES.includes(baseTheme)
      ? 'light'
      : (DARK_BASE_THEMES.includes(baseTheme)
          ? 'dark'
          : 'system')
  }

  ipcMain.handle(IpcChannels.READ_CLIPBOARD, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) throw new Error('Untrusted clipboard request')
    return clipboard.readText()
  })

  const { loadCustomThemes, getSelectedCustomTheme } = setupCustomThemes({ updateSettingFromMain, updateThemeSource })
  setupCastIpc({ chromecast, fcast, invidiousAuthorizations, getConfiguredApiServerUrl })

  // ************************************************* //
  // DB related IPC calls
  // *********** //

  // Settings
  handleDatastoreRequests(IpcChannels.DB_SETTINGS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.SETTINGS.MERGE_SEEN_VIDEOS: {
          const value = await baseHandlers.settings.mergeSeenVideos(data)
          syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
            event: SyncEvents.GENERAL.UPSERT,
            data: { _id: 'subscriptionSeenVideos', value }
          })
          return value
        }

        case DBActions.SETTINGS.MERGE_SEEN_POSTS: {
          const value = await baseHandlers.settings.mergeSeenPosts(data)
          syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
            event: SyncEvents.GENERAL.UPSERT,
            data: { _id: 'subscriptionSeenPosts', value }
          })
          return value
        }

        case DBActions.GENERAL.FIND:
          return await baseHandlers.settings.find()

        case DBActions.GENERAL.UPSERT:
          // Destinations require a native folder picker. Backup status is written by the scheduler.
          if (['screenshotFolderPath', 'scheduledBackupFolderPath', 'scheduledBackupStatus'].includes(data._id)) {
            return null
          }

          await baseHandlers.settings.upsert(data._id, data.value)
          syncOtherWindows(
            IpcChannels.SYNC_SETTINGS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          switch (data._id) {
            case 'scheduledBackupEnabled':
            case 'scheduledBackupInterval':
            case 'scheduledBackupKeepCount':
              checkScheduledBackup()
              break
            case 'contextMenuSearchEngines':
              contextMenu.setSearchEngines(data.value)
              break
            // Update app menu on related setting update
            case 'backendFallback':
              backendFallback = data.value
              await setMenu()
              break
            case 'backendPreference':
              backendPreference = data.value
              await setMenu()
              break
            case 'keyboardShortcuts':
              await setMenu()
              break
            case 'tabCloseFocus':
              TabManager.setTabCloseFocus(data.value)
              break
            case 'diagnosticLogging':
              setDiagnosticLogging(data.value === true)
              break
            case 'showSkipSilenceButton':
              TabManager.setShowSkipSilenceButton(data.value)
              break
            case 'enableSkipSilenceByDefault':
              TabManager.setEnableSkipSilenceByDefault(data.value)
              break
            case 'useTrayIcon':
              useTrayIcon = data.value
              updateTrayEnabled()
              break
            case 'hideToTrayOnClose':
              trayOnClose = data.value
              break
            case 'hideToTrayOnMinimize':
              trayOnMinimize = data.value
              break
            case 'iconPack':
              trayMenuIconPack = data.value
              createTrayContextMenu()
              break
            case 'baseTheme':
              if (isCustomThemeValue(data.value)) {
                nativeTheme.themeSource = (await getSelectedCustomTheme(data.value))?.isDark ? 'dark' : 'light'
              } else {
                updateThemeSource(data.value)
              }
              break
            case 'ytDlpMaxConcurrentDownloads':
            case 'ytDlpDownloadBandwidthLimit':
            case 'ytDlpAutomaticDownloadsRequireCharging':
              await refreshYtDlpDownloadQueue()
              break
            case 'ytDlpPlaybackCacheMaxEntrySize':
              try {
                await applyYtDlpPlaybackCacheSettings()
              } catch (error) {
                console.warn('Could not apply the yt-dlp playback cache settings', error)
              }
              break

            default:
              // Do nothing for unmatched settings
          }
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.settings.delete(data)
          if (data === 'contextMenuSearchEngines') {
            contextMenu.setSearchEngines(DEFAULT_SEARCH_ENGINES_SETTING)
          }
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid settings db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // History
  handleDatastoreRequests(IpcChannels.DB_HISTORY, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.HISTORY.UPDATE_SUBSCRIPTION_STATE: {
          const result = await baseHandlers.history.updateSubscriptionState(data)
          if (result.records.length > 0) {
            syncOtherWindows(IpcChannels.SYNC_HISTORY, event, result.records.length === 1
              ? { event: SyncEvents.GENERAL.UPSERT, data: result.records[0] }
              : {
                  event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES,
                  data: { insertions: [], updates: result.records, deletions: [] }
                })
          }
          if (result.seenVideos != null) {
            syncOtherWindows(IpcChannels.SYNC_SETTINGS, event, {
              event: SyncEvents.GENERAL.UPSERT,
              data: { _id: 'subscriptionSeenVideos', value: result.seenVideos }
            })
          }
          return result
        }

        case DBActions.GENERAL.FIND:
          return await baseHandlers.history.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.history.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.GENERAL.OVERWRITE:
          if (typeof data === 'string') data = JSON.parse(data)
          await baseHandlers.history.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.HISTORY.APPLY_SYNC_CHANGES: {
          if (typeof data === 'string') data = JSON.parse(data)
          // Other windows must keep stored records that were newer than the sync.
          const skipped = new Set(await baseHandlers.history.applySyncChanges(data))
          if (skipped.size > 0) data.insertions = data.insertions.filter(record => !skipped.has(record.videoId))
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES, data }
          )
          return [...skipped]
        }

        case DBActions.HISTORY.UPDATE_WATCH_PROGRESS:
          await baseHandlers.history.updateWatchProgress(data.videoId, data.watchProgress)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_WATCH_PROGRESS, data }
          )
          return null

        case DBActions.HISTORY.UPDATE_PLAYLIST:
          await baseHandlers.history.updateLastViewedPlaylist(data.videoId, data.lastViewedPlaylistId, data.lastViewedPlaylistType, data.lastViewedPlaylistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UPDATE_PLAYLIST, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS:
          await baseHandlers.history.unsetLastViewedPlaylistForVideos(data.videoIds, data.lastViewedPlaylistId)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS, data }
          )
          return null

        case DBActions.HISTORY.UNSET_PLAYLISTS:
          await baseHandlers.history.unsetLastViewedPlaylists(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.UNSET_PLAYLISTS, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.history.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.HISTORY.DELETE_OLDER_THAN: {
          if (
            typeof data !== 'number' ||
            !Number.isFinite(data) ||
            data < 0 ||
            data > Date.now()
          ) {
            throw new TypeError('invalid history cutoff')
          }

          const videoIds = await baseHandlers.history.deleteOlderThan(data, getPlayingVideoIds())
          if (videoIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_HISTORY,
              event,
              { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data: videoIds }
            )
          }
          return videoIds
        }

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.history.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid history db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Recommendation learning
  handleDatastoreRequests(IpcChannels.DB_RECOMMENDATIONS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) return
    let result
    if (action === DBActions.GENERAL.FIND) result = await baseHandlers.recommendations.find()
    else if (action === DBActions.GENERAL.UPSERT) result = await baseHandlers.recommendations.record(data)
    else if (action === DBActions.GENERAL.DELETE_MULTIPLE) result = await baseHandlers.recommendations.remove(data)
    else if (action === DBActions.GENERAL.DELETE_ALL) result = await baseHandlers.recommendations.reset()
    else throw new Error('Invalid recommendation action')
    syncOtherWindows(IpcChannels.SYNC_RECOMMENDATIONS, event, result)
    return result
  })

  // Watch Stats
  handleDatastoreRequests(IpcChannels.DB_WATCH_STATS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.watchStats.find()

        case DBActions.WATCH_STATS.MERGE_BACKUP: {
          const merged = await baseHandlers.watchStats.mergeBackup(data)
          syncOtherWindows(IpcChannels.SYNC_WATCH_STATS, event, { event: SyncEvents.GENERAL.OVERWRITE, data: merged })
          return merged
        }

        case DBActions.WATCH_STATS.ADD_WATCH_TIME:
          await baseHandlers.watchStats.addWatchTime(data.date, data.seconds)
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADD_WATCH_TIME, data }
          )
          return null

        case DBActions.WATCH_STATS.MIGRATE_HISTORY:
          return await baseHandlers.watchStats.migrateHistory()

        case DBActions.WATCH_STATS.GET_HISTORICAL_ADJUSTMENT:
          return await baseHandlers.watchStats.getHistoricalAdjustment()

        case DBActions.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME: {
          const result = await baseHandlers.watchStats.adjustHistoricalWatchTime(
            data.defaultSpeed,
            data.channelPlaybackSpeeds
          )
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME, data: result }
          )
          return result
        }

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.watchStats.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_WATCH_STATS,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid watch stats db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Profiles
  handleDatastoreRequests(IpcChannels.DB_PROFILES, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.CREATE: {
          const newProfile = await baseHandlers.profiles.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.CREATE, data: newProfile }
          )
          return newProfile
        }

        case DBActions.GENERAL.FIND:
          return await baseHandlers.profiles.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.profiles.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PROFILES.ADD_CHANNEL:
          await baseHandlers.profiles.addChannelToProfiles(data.channel, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.ADD_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.REMOVE_CHANNEL:
          await baseHandlers.profiles.removeChannelFromProfiles(data.channelId, data.profileIds)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.PROFILES.REMOVE_CHANNEL, data }
          )
          return null

        case DBActions.PROFILES.UPDATE_CHANNEL_SETTINGS:
        case DBActions.PROFILES.BATCH_UPDATE_CHANNEL_SETTINGS: {
          const profileIds = data.updates
            ? await baseHandlers.profiles.batchUpdateChannelSettings(data.updates, data.profileIds)
            : await baseHandlers.profiles.updateChannelSettings(data.channel, data.profileIds)
          if (profileIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              {
                event: SyncEvents.PROFILES.UPDATE_CHANNEL_SETTINGS,
                data: { ...data, profileIds }
              }
            )
          }
          return profileIds
        }

        case DBActions.PROFILES.UPDATE_SUBSCRIPTION_DETAILS: {
          const result = await baseHandlers.profiles.updateSubscriptionDetails(data)
          const { profileIds } = result
          if (profileIds.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_PROFILES,
              event,
              { event: SyncEvents.PROFILES.UPDATE_SUBSCRIPTION_DETAILS, data: { channels: data, profileIds } }
            )
          }
          return result
        }

        case DBActions.GENERAL.DELETE:
          await baseHandlers.profiles.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PROFILES,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid profile db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Playlists
  // ! NOTE: A lot of these actions are currently not used for anything
  // As such, only the currently used actions have synchronization implemented
  // The remaining should have it implemented only when playlists
  // get fully implemented into the app
  handleDatastoreRequests(IpcChannels.DB_PLAYLISTS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.CREATE:
          await baseHandlers.playlists.create(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.CREATE, data }
          )
          return null

        case DBActions.GENERAL.FIND:
          return await baseHandlers.playlists.find()

        case DBActions.GENERAL.UPSERT:
          if (typeof data === 'string') data = JSON.parse(data)
          await baseHandlers.playlists.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PLAYLISTS.UPSERT_IF_UNCHANGED: {
          const saved = await baseHandlers.playlists.upsertIfUnchanged(data.playlist, data.previous)
          if (saved) {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data: data.playlist })
          }
          return saved
        }

        case DBActions.PLAYLISTS.UPDATE_SORT_ORDER: {
          const saved = await baseHandlers.playlists.updateSortOrder(data._id, data.sortOrder)
          if (saved) {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.GENERAL.UPSERT, data })
          }
          return saved
        }

        case DBActions.PLAYLISTS.REPAIR_METADATA:
          return await baseHandlers.playlists.repairMetadata(data, update => {
            syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: SyncEvents.PLAYLISTS.REPAIR_METADATA, data: update })
          })

        case DBActions.PLAYLISTS.UPSERT_VIDEO: {
          const result = await baseHandlers.playlists.upsertVideoByPlaylistId(data._id, data.lastUpdatedAt, data.videoData)

          // Nothing was written when the video is already in the playlist or the
          // playlist is gone, so the other windows have nothing to apply
          if (result.status === PlaylistVideoAddResult.ADDED) {
            data.addVideosToTop = result.addVideosToTop
            data.lastUpdatedAt = result.lastUpdatedAt
            syncOtherWindows(
              IpcChannels.SYNC_PLAYLISTS,
              event,
              { event: SyncEvents.PLAYLISTS.UPSERT_VIDEO, data }
            )
          }

          return result
        }

        case DBActions.PLAYLISTS.UPSERT_VIDEOS: {
          const result = await baseHandlers.playlists.upsertVideosByPlaylistId(data._id, data.lastUpdatedAt, data.videos, data.deduplicate)
          if (result.status === PlaylistVideoAddResult.ADDED) {
            data.videos = result.videos
            data.addVideosToTop = result.addVideosToTop
            data.lastUpdatedAt = result.lastUpdatedAt
            syncOtherWindows(
              IpcChannels.SYNC_PLAYLISTS,
              event,
              { event: SyncEvents.PLAYLISTS.UPSERT_VIDEOS, data }
            )
          }
          return result
        }

        case DBActions.GENERAL.DELETE:
          await baseHandlers.playlists.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_ID:
          await baseHandlers.playlists.deleteVideoIdByPlaylistId(data._id, data.lastUpdatedAt, data.videoId, data.playlistItemId)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEO, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_VIDEO_IDS:
          await baseHandlers.playlists.deleteVideoIdsByPlaylistId(data._id, data.lastUpdatedAt, data.playlistItemIds)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.DELETE_VIDEOS, data }
          )
          return null

        case DBActions.PLAYLISTS.DELETE_ALL_VIDEOS:
          await baseHandlers.playlists.deleteAllVideosByPlaylistId(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await baseHandlers.playlists.deleteMultiple(data)
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.playlists.deleteAll()
          // TODO: Syncing (implement only when it starts being used)
          // syncOtherWindows(IpcChannels.SYNC_PLAYLISTS, event, { event: '_', data })
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid playlist db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //

  // ************** //
  // Search History
  handleDatastoreRequests(IpcChannels.DB_SEARCH_HISTORY, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.searchHistory.find()

        case DBActions.GENERAL.UPSERT: {
          const updatedEntry = await baseHandlers.searchHistory.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data: updatedEntry }
          )
          return updatedEntry
        }

        case DBActions.GENERAL.OVERWRITE:
          await baseHandlers.searchHistory.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.GENERAL.DELETE:
          await baseHandlers.searchHistory.delete(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.searchHistory.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid search history db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //
  // Profiles
  handleDatastoreRequests(IpcChannels.DB_SUBSCRIPTION_CACHE, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.subscriptionCache.find()

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateVideosByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN:
          await baseHandlers.subscriptionCache.markEntriesAsSeen(data.channelId, data.tab, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN_MANY:
          await baseHandlers.subscriptionCache.markEntriesAsSeenMany(data)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN_MANY, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_FEEDS: {
          const applied = await baseHandlers.subscriptionCache.updateFeeds(data)
          const updates = data.filter((_, index) => applied[index])
          if (updates.length > 0) {
            syncOtherWindows(
              IpcChannels.SYNC_SUBSCRIPTION_CACHE,
              event,
              { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_FEEDS, data: updates }
            )
          }
          return applied
        }

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateLiveStreamsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateShortsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL:
          await baseHandlers.subscriptionCache.updateShortsWithChannelPageShortsByChannelId(data.channelId, data.entries)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL:
          if (!await baseHandlers.subscriptionCache.updateCommunityPostsByChannelId(data.channelId, data.entries, data.timestamp)) return false
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL, data }
          )
          return null

        case DBActions.GENERAL.DELETE_MULTIPLE:
          await baseHandlers.subscriptionCache.deleteMultipleChannels(data)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_MULTIPLE, data }
          )
          return null

        case DBActions.GENERAL.DELETE_ALL:
          await baseHandlers.subscriptionCache.deleteAll()
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.GENERAL.DELETE_ALL, data }
          )
          return null

        default:
          // eslint-disable-next-line no-throw-literal
          throw 'invalid subscriptionCache db action'
      }
    } catch (err) {
      if (typeof err === 'string') throw err
      else throw err.toString()
    }
  })

  // *********** //

  function syncOtherWindows(channel, event, payload) {
    const allWindows = BrowserWindow.getAllWindows()

    for (const window of allWindows) {
      if (
        window.webContents.id !== event.sender.id &&
        !window.webContents.isDestroyed() &&
        isOpenTubeXUrl(window.webContents.getURL())
      ) {
        window.webContents.send(channel, payload)
      }
    }
  }

  function getPlayingVideoIds() {
    const videoIds = []

    for (const window of BrowserWindow.getAllWindows()) {
      const tabManager = TabManager.getForWindow(window.id)
      if (!tabManager) { continue }

      for (const tab of tabManager.tabs.values()) {
        if (!tab.isPlaying) { continue }

        const videoId = URL.parse(tab.url)?.hash.match(/^#\/watch\/(?<videoId>[^/?]+)/)?.groups?.videoId
        if (videoId) {
          videoIds.push(decodeURIComponent(videoId))
        }
      }
    }

    return videoIds
  }

  // ************************************************* //

  let resourcesCleanUpDone = false
  let resourcesCleanUpPromise = null

  // `before-quit` fires on every platform before any windows start closing.
  // Confirm app-level quit requests here, then mark the app as quitting so
  // BrowserWindow close handlers preserve their tab sessions.
  app.on('before-quit', (event) => {
    if (!isQuitConfirmed) {
      event.preventDefault()
      requestQuit(BrowserWindow.getFocusedWindow() ?? mainWindow)
      return
    }

    isQuitting = true
    stopDlnaCast().catch(error => console.error('Failed to stop DLNA casting', error))
    chromecast.stop().catch(error => console.error('Failed to stop Google Cast', error))
    fcast.stop().catch(error => console.error('Failed to stop FCast', error))
    backgroundSubscriptions.stop()
    if (tray) { tray.destroy(); tray = null }
  })

  app.on('window-all-closed', () => {
    mainWindow = null
    trayWindows = []
    if (keepRefreshingInBackground && !isQuitting) {
      ensureBackgroundTray()
      backgroundSubscriptions.setBackground(true).catch(error => console.error(error))
      return
    }
    // macOS keeps the app and its backup schedule running without open windows.
    if (process.platform === 'darwin' && !isQuitting) return
    // Clean up resources (datastores' compaction + Electron cache and storage data clearing)
    handleQuit()
  })

  // Actual Quit also needs cleanup after the last window closed into background mode.
  app.on('will-quit', event => {
    if (resourcesCleanUpDone) return
    event.preventDefault()
    cleanUpResources().finally(() => app.quit())
  })

  function handleQuit() {
    cleanUpResources().finally(() => {
      mainWindow = null
      if (process.platform !== 'darwin' && !isQuitting) {
        app.quit()
      }
    })
  }

  /**
   * @param {import('electron').BrowserWindow | null | undefined} browserWindow
   */
  function requestQuit(browserWindow) {
    confirmCloseApp(browserWindow).then((shouldQuit) => {
      if (!shouldQuit) {
        return
      }

      isQuitConfirmed = true
      app.quit()
    }).catch((error) => {
      console.error('Failed to confirm app quit:', error)
    })
  }

  async function cleanUpResources() {
    if (resourcesCleanUpDone) {
      return
    }

    resourcesCleanUpPromise ??= (async () => {
      clearInterval(scheduledBackupTimer)
      await scheduledBackups.stop().catch(error => console.error('Could not finish scheduled backup', error))

      await Promise.allSettled([
        trayIconWrite,
        // Queue requests run in order, so a read waits for pending queue writes
        updateWatchQueue({}),
        baseHandlers.compactAllDatastores(),
        shutdownYtDlpDownloads(),
        session.defaultSession.clearCache(),
        session.defaultSession.clearStorageData({
          storages: [
            'appcache',
            'cookies',
            'filesystem',
            'indexdb',
            'shadercache',
            'websql',
            'serviceworkers',
            'cachestorage'
          ]
        })
      ])

      resourcesCleanUpDone = true
    })()
    return resourcesCleanUpPromise
  }

  // MacOS event
  // https://www.electronjs.org/docs/latest/api/app#event-activate-macos
  app.on('activate', (_event, hasVisibleWindows) => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (!hasVisibleWindows) {
      // Windows hidden to the tray or kept for background refreshes come back from the Dock.
      showHiddenWindows()
    }
  })

  /*
   * Callback when processing an opentubex:// link (macOS)
   */
  app.on('open-url', async (event, url) => {
    event.preventDefault()

    const newStartupUrl = baseUrl(url)
    if (!(mainWindow && mainWindow.webContents)) {
      startupUrl = newStartupUrl
      if (app.isReady()) {
        await createWindowForOpenUrl(startupUrl, {
          reuseEmptyRootTab: true
        })
        startupUrl = null
      }
      return
    }

    const openDeepLinksInNewWindow = (await baseHandlers.settings._findOne('openDeepLinksInNewWindow'))?.value
    if (!openDeepLinksInNewWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      openUrlInWindow(mainWindow, newStartupUrl)
      return
    }

    await createWindowForOpenUrl(newStartupUrl, {
      replaceMainWindow: false,
      showWindowNow: true,
      reuseEmptyRootTab: true
    })
  })

  app.on('web-contents-created', (_, webContents) => {
    // When a main-frame document starts loading, the previous renderer is gone.
    // Drop its readiness entry so sendOpenUrlToWebContents queues messages until
    // the new renderer signals APP_READY again, instead of delivering to a
    // renderer that has not registered its OPEN_URL listener yet.
    webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        forgetOpenUrlRenderer(webContents.id)
        const browserWindow = BrowserWindow.fromWebContents(webContents)
        if (browserWindow) {
          appShortcutBlockedWindows.delete(browserWindow)
        }
      }
    })

    webContents.once('destroyed', () => {
      contextMenu.forgetWebContents(webContents.id)
      forgetOpenUrlWebContents(webContents.id)
      invidiousAuthorizations.delete(webContents.id)
    })
  })

  /*
   * Check if an argument was passed and send it over to the GUI (Linux / Windows).
   * Remove app protocol if present
   */
  const url = getLinkUrl(process.argv)
  if (url) {
    startupUrl = url
  }

  function baseUrl(arg) {
    let newArg = arg.replace(/^(?:opentubex|freetube):\/\//, '')
    // add support for authority free url
      .replace(/^(?:opentubex|freetube):/, '')

    // fix for Qt URL, like `opentubex://https//www.youtube.com/watch?v=...`
    // For details see https://github.com/FreeTubeApp/FreeTube/pull/3119
    if (newArg.startsWith('https') && newArg.charAt(5) !== ':') {
      newArg = 'https:' + newArg.substring(5)
    }
    return newArg
  }

  /**
   * @param {string} arg
   * @returns {string | null}
   */
  function getNormalizedLinkArg(arg) {
    if (typeof arg !== 'string' || arg.trim().length === 0 || arg.startsWith('-')) {
      return null
    }

    const url = baseUrl(arg.trim())
    const parsed = URL.parse(url)

    if (parsed?.protocol === 'http:' || parsed?.protocol === 'https:') {
      return url
    }

    return null
  }

  function getLinkUrl(argv) {
    for (let i = argv.length - 1; i > 0; i--) {
      const url = getNormalizedLinkArg(argv[i])
      if (url) {
        return url
      }
    }

    return null
  }

  /*
   * Auto Updater
   *
   * Uncomment the following code below and install `electron-updater` to
   * support auto updating. Code Signing with a valid certificate is required.
   * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-electron-builder.html#auto-updating
   */

  /*
  import { autoUpdater } from 'electron-updater'
  autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall()
  })

  app.on('ready', () => {
    if (process.env.NODE_ENV === 'production') autoUpdater.checkForUpdates()
  })
   */

  function navigateTo(path, browserWindow, toggle = false) {
    if (browserWindow == null) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager?.activeTabId && isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, {
        tabId: tabManager.activeTabId,
        route: path,
        toggle
      })
    } else if (isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, toggle ? { route: path, toggle } : path)
    }
  }

  async function setMenu() {
    const keyboardShortcutsSetting = await baseHandlers.settings._findOne('keyboardShortcuts')
    const keyboardShortcuts = getConfiguredKeyboardShortcuts(keyboardShortcutsSetting?.value)
    const reloadTabs = (_menuItem, browserWindow) => {
      if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
        const tabManager = TabManager.getForWindow(browserWindow.id)
        if (tabManager) {
          const tabIds = tabManager.selectedTabIds.length > 1
            ? tabManager.selectedTabIds
            : [tabManager.activeTabId]
          for (const tabId of tabIds) {
            tabManager.requestReload(tabId)
          }
        }
      }
    }

    const template = [
      ...process.platform === 'darwin'
        ? [
            {
              label: app.getName(),
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
              ]
            }
          ]
        : [],
      {
        label: 'File',
        submenu: [
          {
            label: 'New Window',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NEW_WINDOW),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              createWindow({
                replaceMainWindow: false,
                showWindowNow: true
              })
            },
            type: 'normal'
          },
          {
            label: 'Reopen Closed Window',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RESTORE_CLOSED_WINDOW),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) return
              reopenClosedWindow()
            }
          },
          { type: 'separator' },
          {
            label: 'Preferences',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_SETTINGS),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              navigateTo('/settings', browserWindow, true)
            },
            type: 'normal'
          },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'cut' },
          {
            role: 'copy',
            accelerator: 'CmdOrCtrl+C',
            selector: 'copy:'
          },
          {
            role: 'paste',
            accelerator: 'CmdOrCtrl+V',
            selector: 'paste:'
          },
          { role: 'pasteandmatchstyle' },
          { role: 'delete' },
          { role: 'selectall' }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Developer Tools',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.TOGGLE_DEVTOOLS),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.webContents.toggleDevTools()
            }
          },
          {
            label: 'Enter Inspect Element Mode',
            accelerator: 'CmdOrCtrl+Shift+Alt+C',
            click: (_, window) => {
              if (appShortcutBlockedWindows.has(window)) { return }
              if (window.webContents.isDevToolsOpened()) {
                window.devToolsWebContents.executeJavaScript('DevToolsAPI.enterInspectElementMode()')
              } else {
                window.webContents.once('devtools-opened', () => {
                  window.devToolsWebContents.executeJavaScript('DevToolsAPI.enterInspectElementMode()')
                })
                window.webContents.openDevTools()
              }
            }
          },
          {
            label: 'GPU Internals (chrome://gpu)',
            click() {
              const gpuWindow = new BrowserWindow({
                show: true,
                autoHideMenuBar: true,
                webPreferences: {
                  devTools: false
                }
              })
              gpuWindow.loadURL('chrome://gpu')
            }
          },
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RESET_ZOOM),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.webContents.setZoomLevel(0)
            }
          },
          {
            label: 'Zoom In',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.ZOOM_IN),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                browserWindow.webContents.setZoomLevel(browserWindow.webContents.getZoomLevel() + 0.5)
              }
            }
          },
          {
            label: 'Zoom Out',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.ZOOM_OUT),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                browserWindow.webContents.setZoomLevel(browserWindow.webContents.getZoomLevel() - 0.5)
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Toggle Full Screen',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.FULLSCREEN),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.setFullScreen(!browserWindow.isFullScreen())
            }
          },
          { type: 'separator' },
          {
            label: 'Back',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_BACKWARD),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

              TabManager.getForWindow(browserWindow.id)?.navigateHistory(-1)
            },
            type: 'normal',
          },
          ...(process.platform === 'darwin'
            ? [
                {
                  label: 'Back',
                  accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_BACKWARD_ALT_MAC),
                  click: (_menuItem, browserWindow, _event) => {
                    if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

                    TabManager.getForWindow(browserWindow.id)?.navigateHistory(-1)
                  },
                  visible: false,
                },
              ]
            : []),
          {
            label: 'Forward',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_FORWARD),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

              TabManager.getForWindow(browserWindow.id)?.navigateHistory(1)
            },
            type: 'normal',
          },
          ...(process.platform === 'darwin'
            ? [
                {
                  label: 'Forward',
                  accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_FORWARD_ALT_MAC),
                  click: (_menuItem, browserWindow, _event) => {
                    if (browserWindow == null || appShortcutBlockedWindows.has(browserWindow)) { return }

                    TabManager.getForWindow(browserWindow.id)?.navigateHistory(1)
                  },
                  visible: false,
                },
              ]
            : []),
        ]
      },
      {
        label: 'Navigate',
        submenu: [
          {
            label: 'Home',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/home', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Subscriptions',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/subscriptions', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Channels',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/subscribedchannels', browserWindow)
            },
            type: 'normal'
          },
          (backendFallback || backendPreference === 'local') && {
            label: 'Trending',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/trending', browserWindow)
            },
            type: 'normal'
          },
          (backendFallback || usesInvidiousApi(backendPreference)) && {
            label: 'Most Popular',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/popular', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Playlists',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/userplaylists', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Downloads',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_DOWNLOADS),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              navigateTo('/downloads', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'History',
            accelerator: getElectronAccelerator(process.platform === 'darwin'
              ? keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY_MAC
              : keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              navigateTo('/history', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'Profile Manager',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/settings/profile/', browserWindow)
            },
            type: 'normal'
          },
        ].filter((v) => v !== false),
      },
      {
        label: 'Tabs',
        submenu: [
          {
            label: 'New Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NEW_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager) {
                  tabManager.createTabWithPreference({ makeActive: true }).catch(error => {
                    console.error('Failed to create a new tab from the app menu:', error)
                  })
                }
              }
            }
          },
          {
            label: 'Close Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.CLOSE_TAB),
            click: async (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.activeTabId) {
                  const tabIds = tabManager.selectedTabIds.length > 1
                    ? [...tabManager.selectedTabIds]
                    : [tabManager.activeTabId]
                  const closesLastWindow = tabIds.length === tabManager.tabs.size &&
                    BrowserWindow.getAllWindows().length === 1
                  if (!closesLastWindow && !await confirmMultipleTabsAction(tabManager, tabIds.length, 'close')) {
                    return
                  }
                  const hasRemainingTabs = await tabManager.closeTabs(tabIds)
                  if (!hasRemainingTabs) {
                    browserWindow.close()
                  }
                } else {
                  browserWindow.close()
                }
              }
            }
          },
          {
            label: 'Reload Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RELOAD_TAB),
            click: reloadTabs,
          },
          {
            label: 'Reload Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RELOAD_TAB_ALT),
            click: reloadTabs,
            visible: false,
          },
          {
            label: 'Reopen Closed Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RESTORE_CLOSED_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager) {
                  tabManager.restoreClosedTab()
                }
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Next Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NEXT_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.tabs.size > 1) {
                  const tabIds = Array.from(tabManager.tabs.keys())
                  const currentIndex = tabIds.indexOf(tabManager.activeTabId)
                  const nextIndex = (currentIndex + 1) % tabIds.length
                  tabManager.activateTab(tabIds[nextIndex])
                }
              }
            }
          },
          {
            label: 'Previous Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.PREV_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && !appShortcutBlockedWindows.has(browserWindow)) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.tabs.size > 1) {
                  const tabIds = Array.from(tabManager.tabs.keys())
                  const currentIndex = tabIds.indexOf(tabManager.activeTabId)
                  const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length
                  tabManager.activateTab(tabIds[prevIndex])
                }
              }
            }
          }
        ]
      },
      {
        role: 'window',
        submenu: [
          {
            label: 'Minimize',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.MINIMIZE_WINDOW),
            click: (_menuItem, browserWindow) => {
              if (browserWindow && appShortcutBlockedWindows.has(browserWindow)) { return }
              browserWindow?.minimize()
            }
          },
          {
            label: 'Close Window',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.CLOSE_WINDOW),
            click: (_menuItem, browserWindow) => browserWindow?.close()
          }
        ]
      },
      ...process.platform === 'darwin'
        ? [
            { role: 'window' },
            { role: 'help' },
            { role: 'services' }
          ]
        : []
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }
}
