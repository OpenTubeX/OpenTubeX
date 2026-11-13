import { ClosedWindowHistory } from './tabs/ClosedWindowHistory.js'
import { createFileWatchQueue } from './watchQueue.js'
import { createSerialQueue } from './serialQueue.js'
import { writeFileAtomic } from './writeFileAtomic.js'
import { fetchRumblePage } from './rumblePages.js'
import {
  app, BrowserWindow, Menu, ipcMain,
  powerSaveBlocker, screen, session,
  nativeTheme, net, protocol, clipboard, ClipboardItem,
  shell, Tray, Notification, ShareMenu, nativeImage,
  webContents as electronWebContents
} from 'electron'
import './applicationDataBootstrap'
import { isPortableBuild } from './applicationDataPaths'
import path from 'path'
import { createDesktopShareHandler, loadWindowsShare } from './desktopShare'
import cp from 'child_process'

import {
  IpcChannels,
  getConfiguredKeyboardShortcuts,
  getElectronAccelerator,
  SEARCH_CHAR_LIMIT,
  BASE_THEME_BACKGROUND_COLORS,
  LIGHT_BASE_THEMES,
  DARK_BASE_THEMES,
  DEFAULT_SYSTEM_THEMES,
} from '../constants'
import { isCustomThemeValue } from '../customTheme'
import { MATERIAL_SYSTEM_SEED, MATERIAL_THEME_VALUES, materialColorScheme, materialSeedPalette, materialThemeMode } from '../materialTheme.js'
import { resolveSystemTheme } from '../appearanceSettings'
import { applySyncServerUserAgent } from '../syncServerUserAgent'
import { applyYouTubeUserAgent } from '../youTubeUserAgent'
import * as baseHandlers from '../datastores/handlers/base'
import { liveReminders, waitForDatastores } from '../datastores'
import { createImageCacheHandler, ImageCache } from './ImageCache'
import { existsSync } from 'fs'
import asyncFs from 'fs/promises'
import { promisify } from 'util'
import { brotliDecompress } from 'zlib'

import packageDetails from '../../package.json'
import { handleOpenInExternalPlayer } from './externalPlayer'
import { stopDlnaCast } from './dlnaCast'
import { ChromecastManager } from './chromecast'
import { FcastManager } from './fcast'
import { handleTwitchChatReplayPage, handleTwitchSubOnlyVod } from './twitchChat'
import { applyTwitchPlaylistOrigin } from '../twitchPlaylistOrigin'
import { createTwitchLiveNotifier } from './twitchLiveNotifications'
import { isYtDlpStoryboardUrl, getYtDlpExternalStreamCookieHeader, getYtDlpExternalStreamHeaders, refreshYtDlpDownloadQueue, restoreYtDlpDownloadQueue, shutdownYtDlpDownloads } from './ytDlp'
import { applyYtDlpPlaybackCacheSettings } from './ytDlpPlaybackCache'
import { generatePoToken, mintPoTokenFromAttestation } from './poTokenGenerator'
import { buildProxyUrl, DEFAULT_PROXY_SETTINGS, isConfiguredProxyChallenge, isExternalBrowserUrl, isOpenTubeXUrl } from './utils'
import { createBackgroundExternalLinkOpener } from './backgroundExternalLink'
import { isInvidiousInstanceUrl } from './invidiousAuthorization'
import { normalizeYatteeServerUrl, usesInvidiousApi, usesInvidiousInstance } from '../apiBackends'
import { RendererCors } from './rendererCors'
import { RequestErrors } from './requestErrors'
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
import { setupStorageIpc } from './storage'
import {
  createKdeWaylandWindowStateBackend,
  isKdePlasmaDesktop,
  isWaylandPlatform as detectWaylandPlatform,
  monitorKdeWaylandWindowState,
  shouldMonitorKdeWaylandWindowState,
} from './kdeWaylandWindowState'
import { createSubscriptionBackgroundService } from './subscriptionBackground'
import {
  createNativePictureInPictureBounds,
  createPictureInPictureBoundsStore,
  loadMacosNative
} from './pictureInPictureBounds'
import { startKwinPictureInPictureBounds } from './kwinPictureInPictureBounds'
import { createUploadNotifier } from './uploadNotifications'
import { createNotificationHistory, createNotifier, createSystemNotificationLinks } from './notificationHistory'
import { loadNotificationImage, setNotificationImagesAllowed } from './notificationImage'
import { setAutomaticDownloadNotifier } from './ytDlpAutomaticDownloads'
import { getLiveReminderTarget } from '../notificationHistory'
import { supportsNativeNotifications } from './nativeNotifications'
import { getTrayMenuIcon } from './trayMenuIcons'
import { createScheduledBackups } from './scheduledBackups'
import { createBackupArchiveFactory } from './backupArchive'
import { createDatastoreRequestTracker } from './datastoreRequests'
import { setupDatastoreIpc } from './datastoreIpc'
import { settingSyncMessage, writeSynced } from './datastoreSync'
import { getWindowButtonLayout, onWindowButtonLayoutChanged } from './windowButtonLayout'
import { watchTrayColorScheme } from './trayColorScheme'
import { setDiagnosticLogging, setupDiagnosticLogIpc } from './diagnosticLog'
import { createMainTranslator } from './mainTranslator'
import { createConfirmations } from './confirmations'
import { setupCustomThemes } from './customThemes'
import { contextMenuLabel, setupContextMenu, truncateSelectionForLabel } from './contextMenu'
import { setupIpBlockRecoveryIpc } from './ipBlockRecovery'
import { isSubscriptionAutoRefreshInProgress, setupSubscriptionAutoRefreshIpc } from './subscriptionAutoRefresh'
import { setupCastIpc } from './castIpc'
import { createUrlOpener, getDirectOpenUrl } from './openUrl'
import { handleTrusted, isTrustedSender, onTrusted, sendToAppWindows } from './ipc'
import { setupPlayerCacheIpc } from './playerCacheIpc'
import { setupPowerSaveBlockerIpc } from './powerSaveBlockerIpc'
import { setupScreenshotFolderIpc } from './screenshotFolderIpc'
import { setupBackupIpc } from './backupIpc'
import { setupLibraryNotices } from './libraryNotices'
import { setupLiveReminderIpc } from './liveReminderIpc'
import { getSystemAccentColor, setupSystemInfoIpc } from './systemInfoIpc'
import { setupToastIpc } from './toastIpc'
import { setupWatchQueueIpc } from './watchQueueIpc'
import { handleDownloadMediaRequest, setupYtDlpIpc } from './ytDlpIpc'
import { isSyncServerOidcCallbackUrl } from '../renderer/helpers/sync-server-oidc'

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

  // Electron otherwise builds its default menu before the app is ready, only
  // for the app's own menu to replace it with the first window.
  Menu.setApplicationMenu(null)

  // Registered synchronously, before any datastore loading started above can finish.
  setupLibraryNotices()
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
  /** @type {Set<Promise<void>>} */
  const windowSessionWrites = new Set()
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
  function updateSettingFromMain(settingKey, value, expectedValue) {
    return writeSynced([IpcChannels.SYNC_SETTINGS], async () => {
      if (expectedValue !== undefined) {
        if (!await baseHandlers.settings._updateIfUnchanged(settingKey, expectedValue, value)) return
      } else {
        await baseHandlers.settings.upsert(settingKey, value)
      }
      sendToAppWindows(IpcChannels.SYNC_SETTINGS, settingSyncMessage(settingKey, value))
    })
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

  /**
   * @param {BrowserWindow} browserWindow
   */
  async function confirmCloseWindow(browserWindow) {
    const isLastWindow = BrowserWindow.getAllWindows().length === 1
    if (isLastWindow) return confirmCloseApp(browserWindow)

    const manager = TabManager.getForWindow(browserWindow.id)
    if (manager && manager.tabs.size > 1 && !await confirmCloseWindowWithMultipleTabs(browserWindow, manager.tabs.size)) {
      return false
    }
    // Closing the other windows meanwhile turns this close into a quit. A
    // window stays in getAllWindows() until it is destroyed, after its close.
    const openWindowCount = BrowserWindow.getAllWindows()
      .filter(window => !closingWindowIds.has(window.id)).length
    return openWindowCount > 1 || confirmCloseApp(browserWindow)
  }

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

      const copy = async (url) => {
        if (parameters.linkText) {
          await clipboard.write([
            new ClipboardItem({
              'text/plain': url,
              'electron application/bookmark': {
                title: parameters.linkText,
                url,
              },
            })
          ])
        } else {
          await clipboard.writeText(url)
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
          click: () => copy(parameters.linkURL)
        },
        {
          label: contextMenuLabel('Copy YouTube Link'),
          visible: visible && isInAppUrl,
          click: () => copy(transformOpenTubeXRouteUrl(urlParts[1], true))
        },
        {
          label: contextMenuLabel('Copy Invidious Link'),
          visible: visible && isInAppUrl && usesInvidiousInstance(backendPreference, backendFallback),
          click: () => copy(transformOpenTubeXRouteUrl(urlParts[1], false))
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
    confirmCloseWindow,
    confirmMultipleTabsAction,
    closeConfirmedWindowIds
  })

  const updateWatchQueue = createFileWatchQueue(path.join(app.getPath('userData'), 'watch-queue.json'))
  setupWatchQueueIpc(updateWatchQueue)

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
  const pictureInPictureBoundsStore = createPictureInPictureBoundsStore(path.join(userDataPath, 'picture-in-picture-bounds.json'))
  const usesKwinPictureInPictureBounds = process.platform === 'linux' && isKdePlasmaDesktop(process.env)
  const closeKwinPictureInPictureBounds = usesKwinPictureInPictureBounds
    ? startKwinPictureInPictureBounds({ store: pictureInPictureBoundsStore })
    : Promise.resolve(null)
  if (!usesKwinPictureInPictureBounds) {
    try {
      const development = process.env.NODE_ENV === 'development'
      const native = process.platform === 'win32'
        ? loadWindowsShare(__dirname, development)
        : process.platform === 'darwin' ? loadMacosNative(__dirname, development) : null
      if (native !== null) {
        const pictureInPictureBounds = createNativePictureInPictureBounds({
          native,
          store: pictureInPictureBoundsStore,
          getWorkAreas: () => screen.getAllDisplays().map(display => display.workArea),
          getExcludedHandles: () => BrowserWindow.getAllWindows().map(window => window.getNativeWindowHandle()),
          // Windows reports physical pixels
          ...(process.platform === 'win32' && {
            toNative: rect => screen.dipToScreenRect(null, rect),
            fromNative: rect => screen.screenToDipRect(null, rect)
          })
        })
        onTrusted(IpcChannels.PICTURE_IN_PICTURE_SHOWN, event => {
          pictureInPictureBounds.shown(event.sender).catch(error => {
            console.error('Failed to restore the Picture-in-Picture bounds', error)
          })
        })
        onTrusted(IpcChannels.PICTURE_IN_PICTURE_HIDDEN, event => pictureInPictureBounds.hidden(event.sender))
      }
    } catch (error) {
      console.error('Failed to load the Picture-in-Picture window integration', error)
    }
  }
  const systemNotificationLinks = createSystemNotificationLinks(id => notificationHistory.markRead(id))
  const notificationHistory = createNotificationHistory({
    file: path.join(userDataPath, 'notification-history.json'),
    dismissalsFile: path.join(userDataPath, 'notification-dismissals.json'),
    onChange: entries => sendToAppWindows(IpcChannels.NOTIFICATION_HISTORY_UPDATED, entries),
    onDismissalsChange: () => sendToAppWindows(IpcChannels.NOTIFICATION_DISMISSALS_UPDATED),
    onStale: entries => systemNotificationLinks.close(entries)
  })
  /** @type {import('./notificationHistory').NotificationMode} */
  let notificationMode = 'both'
  let thumbnailPreference = ''
  let blurThumbnails = false
  setNotificationImagesAllowed(() => thumbnailPreference !== 'hidden' && !blurThumbnails)
  const notify = createNotifier({
    history: notificationHistory,
    getMode: () => notificationMode,
    getForegroundWindow: () => {
      const window = BrowserWindow.getFocusedWindow()
      return window && !window.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL()) ? window : null
    },
    showInApp: (window, entry) => window.webContents.send(IpcChannels.NOTIFICATION_SHOW_IN_APP, entry),
    link: systemNotificationLinks.link
  })
  setAutomaticDownloadNotifier(notify)
  handleTrusted(IpcChannels.NOTIFICATION_HISTORY_LIST, () => notificationHistory.list(), [])
  handleTrusted(IpcChannels.NOTIFICATION_HISTORY_MARK_READ, (_event, id) => (
    id === undefined || typeof id === 'string' ? notificationHistory.markRead(id) : undefined))
  handleTrusted(IpcChannels.NOTIFICATION_HISTORY_REMOVE, (_event, id) => (
    typeof id === 'string' ? notificationHistory.remove(id) : undefined))
  handleTrusted(IpcChannels.NOTIFICATION_HISTORY_CLEAR, () => notificationHistory.clear())
  handleTrusted(IpcChannels.NOTIFICATION_DISMISSALS_GET, () => notificationHistory.getDismissals())
  handleTrusted(IpcChannels.NOTIFICATION_DISMISSALS_MERGE, (_event, dismissals) => notificationHistory.mergeDismissals(dismissals))
  // Runs without windows too, for example while the app refreshes subscriptions from the tray.
  const twitchLiveNotifier = createTwitchLiveNotifier({
    file: path.join(userDataPath, 'twitch-live-notifications.json'),
    // Uses the session's proxy settings, like the background refresh requests.
    fetch: (url, options) => net.fetch(url, options),
    show: showUrlNotification,
    onLive: live => sendToAppWindows(IpcChannels.TWITCH_LIVE_UPDATED, live)
  })
  handleTrusted(IpcChannels.TWITCH_LIVE_CONFIGURE, (_event, configuration) => twitchLiveNotifier.configure(configuration))
  handleTrusted(IpcChannels.RUMBLE_FETCH, (_event, url) => fetchRumblePage(net, url))
  const uploadNotifier = createUploadNotifier({
    file: path.join(userDataPath, 'upload-notifications.json'),
    show: showUrlNotification,
    // Uses the session's proxy settings, like the background refresh requests.
    fetch: (input, init) => net.fetch(input, init)
  })
  const backgroundSubscriptions = createSubscriptionBackgroundService(userDataPath, {
    onUploads: value => uploadNotifier.observe(value).catch(() => {})
  })
  // Builds archives in a worker from read-only database snapshots, so neither
  // this process nor the renderer stalls on large libraries.
  // The worker reads from its own connection, so an archive includes a write
  // only once its request has finished.
  const datastoreRequests = createDatastoreRequestTracker()
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

  handleTrusted(IpcChannels.SUBSCRIPTION_BACKGROUND, async (event, method, value) => {
    if (!TabManager.getFromWebContents(event.sender)) return
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
  // The suffix also makes macOS load the cached monochrome icon as a template image.
  const monochromeTrayIconCachePath = path.join(userDataPath, 'tray-iconTemplate.png')
  let selectedTrayImage = nativeImage.createFromPath(trayIconCachePath)
  let isTrayIconMonochrome = false
  if (selectedTrayImage.isEmpty()) {
    selectedTrayImage = nativeImage.createFromPath(monochromeTrayIconCachePath)
    isTrayIconMonochrome = !selectedTrayImage.isEmpty()
  }
  let isTrayDark = true
  /** @type {(() => void) | null} */
  let stopWatchingTrayColorScheme = null
  function updateTrayColorSchemeWatcher() {
    if (isTrayIconMonochrome && process.platform !== 'darwin') {
      stopWatchingTrayColorScheme ??= watchTrayColorScheme(dark => {
        if (dark === isTrayDark) return
        isTrayDark = dark
        if (tray) tray.setImage(getTrayImage())
      })
    } else {
      stopWatchingTrayColorScheme?.()
      stopWatchingTrayColorScheme = null
    }
  }
  app.whenReady().then(updateTrayColorSchemeWatcher)
  const enqueueTrayIconWrite = createSerialQueue()
  handleTrusted(IpcChannels.SET_TRAY_ICON, async (event, dataUrl, monochrome) => {
    if (!TabManager.getFromWebContents(event.sender)) return
    if (dataUrl !== null && (typeof dataUrl !== 'string' || dataUrl.length > 65536 || !dataUrl.startsWith('data:image/png;base64,'))) return
    if (typeof monochrome !== 'boolean') return
    const image = dataUrl === null ? nativeImage.createEmpty() : nativeImage.createFromDataURL(dataUrl)
    if (dataUrl !== null && (image.isEmpty() || image.getSize().width !== 64 || image.getSize().height !== 64)) return
    selectedTrayImage = image
    isTrayIconMonochrome = dataUrl !== null && monochrome
    updateTrayColorSchemeWatcher()
    if (tray) tray.setImage(getTrayImage())
    const cachePath = isTrayIconMonochrome ? monochromeTrayIconCachePath : trayIconCachePath
    const otherCachePath = isTrayIconMonochrome ? trayIconCachePath : monochromeTrayIconCachePath
    // Serialize writes so rapid palette changes also preserve the latest icon on restart.
    await enqueueTrayIconWrite(async () => {
      await asyncFs.rm(otherCachePath, { force: true })
      await (dataUrl === null
        ? asyncFs.rm(cachePath, { force: true })
        : writeFileAtomic(cachePath, image.toPNG()))
    })
  })

  /**
   * Monochrome tray icons arrive as a black glyph. Bitmaps use premultiplied
   * alpha, so white keeps each pixel's alpha in its color channels.
   * @param {Electron.NativeImage} image
   * @returns {Electron.NativeImage}
   */
  function createWhiteTrayImage(image) {
    const bitmap = image.toBitmap()
    for (let i = 0; i < bitmap.length; i += 4) {
      bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = bitmap[i + 3]
    }
    return nativeImage.createFromBitmap(bitmap, image.getSize())
  }

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
      if (process.platform === 'darwin') {
        const image = createMacTrayImage(selectedTrayImage)
        // macOS recolors template images to match the menu bar.
        image.setTemplateImage(isTrayIconMonochrome)
        return image
      }
      return isTrayIconMonochrome && isTrayDark ? createWhiteTrayImage(selectedTrayImage) : selectedTrayImage
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
    sendToAppWindows(IpcChannels.LIVE_REMINDER_UPDATED, videoId, scheduled)
  }

  function showLiveReminderNotification(reminder) {
    showUrlNotification({
      title: reminder.notificationTitle,
      body: reminder.notificationBody,
      thumbnail: reminder.thumbnail,
      url: `https://www.youtube.com/watch?v=${reminder.videoId}`,
      // Every device dates the reminder by its start, so dismissals match it even when it fires late.
      createdAt: reminder.startTimestamp,
      target: getLiveReminderTarget(reminder.videoId)
    })
  }

  /**
   * @param {{ title: string, body: string, url: string, silent?: boolean, thumbnail?: string, createdAt?: number, target: import('../notificationHistory').NotificationHistoryTarget | null }} options
   */
  function showUrlNotification({ title, body, url, silent = false, thumbnail, createdAt, target }) {
    return notify({ title, body, thumbnail, createdAt, target, showSystemNotification: () => showSystemUrlNotification({ title, body, url, silent, thumbnail }) })
      .catch(error => console.error('Failed to show a notification', error))
  }

  /**
   * @param {{ title: string, body: string, url: string, silent: boolean, thumbnail?: string }} options
   */
  async function showSystemUrlNotification({ title, body, url, silent, thumbnail }) {
    if (!supportsNativeNotifications(Notification)) return

    const icon = await loadNotificationImage(thumbnail)
    const notification = new Notification({ title, body, silent, ...(icon ? { icon } : {}) })
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
    return notification
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

  // Registering asks the desktop and blocks this process until it has answered,
  // so it waits until the first window has shown its content.
  let protocolClientRegistered = false
  function registerProtocolClient() {
    if (protocolClientRegistered || isPortableBuild()) return
    protocolClientRegistered = true

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
        if (sendSyncServerOidcCallback(commandLine.slice(1))) return

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
          const headers = {
            'Content-Type': contentTypeFromFileExtension(pathname.split('.').at(-1))
          }

          if (pathname.endsWith('.html')) {
            // Restrict only what the renderer never uses. index.ejs repeats the
            // directives a meta tag supports for dev, web and Capacitor builds;
            // frame-ancestors only works as a header.
            headers['Content-Security-Policy'] = "object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
          }

          return new Response(contents.buffer, {
            status: 200,
            headers
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
          case 'notificationMode':
            if (['both', 'system', 'off'].includes(doc.value)) notificationMode = doc.value
            break
          case 'thumbnailPreference':
            thumbnailPreference = doc.value
            break
          case 'blurThumbnails':
            blurThumbnails = doc.value === true
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
        applyYouTubeUserAgent(url, requestHeaders)
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
      if (details.resourceType === 'xhr' && webContents && isOpenTubeXUrl(webContents.getURL())) {
        requestErrors.rememberRequest(details)
      }
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
      requestErrors.forgetRequest(details)
      storyboardRequestIds.delete(details.id)
    })
    session.defaultSession.webRequest.onErrorOccurred(httpRequestFilter, details => {
      rendererCors.forgetRequest(details)
      requestErrors.recordError(details)
      storyboardRequestIds.delete(details.id)
    })

    protocol.handle('downloadmedia', handleDownloadMediaRequest)

    if (replaceHttpCache) {
      // in-memory image cache

      protocol.handle('imagecache', createImageCacheHandler(new ImageCache(), (url, webContentsId) => {
        const invidiousAuthorization = invidiousAuthorizations.get(webContentsId)

        if (invidiousAuthorization && isInvidiousInstanceUrl(url, invidiousAuthorization.url)) {
          return { Authorization: invidiousAuthorization.authorization }
        }
      }, net.request))

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
      confirmCloseWindow,
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
    if (!authInfo.isProxy) return
    // The settings are read asynchronously, so take over the challenge and cancel it with an empty callback when it is not ours.
    event.preventDefault()
    const setting = async id => (await baseHandlers.settings._findOne(id))?.value
    const [useProxy, hostname, port] = await Promise.all([setting('useProxy'), setting('proxyHostname'), setting('proxyPort')])
    if (!isConfiguredProxyChallenge(authInfo, { useProxy, hostname, port })) {
      callback()
      return
    }
    callback(await setting('proxyUsername'), await setting('proxyPassword'))
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
    const defaultBackground = () =>
      BASE_THEME_BACKGROUND_COLORS[DEFAULT_SYSTEM_THEMES[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']]
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
        return (await getSelectedCustomTheme(theme))?.colors.background ?? defaultBackground()
      }
      if (MATERIAL_THEME_VALUES.includes(theme)) {
        const mode = materialThemeMode(theme, nativeTheme.shouldUseDarkColors)
        if (mode === 'black') return '#000000'
        const seed = await baseHandlers.settings._findOne('materialSeedColor')
        const color = theme === 'dynamic' || seed?.value === MATERIAL_SYSTEM_SEED ? getSystemAccentColor() ?? seed?.value : seed?.value
        return materialColorScheme(materialSeedPalette(color), mode === 'dark').surface
      }
      return BASE_THEME_BACKGROUND_COLORS[theme] ?? defaultBackground()
    }).catch((error) => {
      console.error(error)
      // Default to nativeTheme settings if nothing is found.
      return defaultBackground()
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
    // Electron loads its fetch implementation when the first request reaches a
    // protocol handler. Load it while the renderer process starts instead.
    Reflect.get(globalThis, 'Request')
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
        if (!isTrustedSender(event)) return null
        return getWindowControlsState()
      })
      newWindow.webContents.ipc.on(IpcChannels.WINDOW_CONTROL_ACTION, (event, action) => {
        if (!isTrustedSender(event) || newWindow.isDestroyed()) return
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
        if (!isTrustedSender(event) || newWindow.isDestroyed()) return
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
    initialization.then(registerProtocolClient, registerProtocolClient)
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
      const sessionWrite = isQuitting || isLastWindow
        ? tabManager._saveSession().catch(err => console.error('Failed to persist tab session on window close', err))
        : tabManager.clearSession().catch(err => console.error('Failed to clear tab session on window close', err))
      // Quitting waits for this, so a window closed just before does not come back.
      windowSessionWrites.add(sessionWrite)
      await sessionWrite
      windowSessionWrites.delete(sessionWrite)

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
    isTrustedSender: event => event.senderFrame === event.sender.mainFrame && isTrustedSender(event),
    getWindow: event => BrowserWindow.fromWebContents(event.sender),
    ShareMenu,
    loadWindowsShare: () => loadWindowsShare(__dirname, process.env.NODE_ENV === 'development')
  }))

  const openExternalInBackground = createBackgroundExternalLinkOpener({
    platform: process.platform,
    openExternal: (url, options) => shell.openExternal(url, options),
    loadWindowsNative: () => loadWindowsShare(__dirname, process.env.NODE_ENV === 'development')
  })

  handleTrusted(IpcChannels.OPEN_EXTERNAL_LINK_IN_BACKGROUND, async (event, url) => {
    const parsedUrl = typeof url === 'string' ? URL.parse(url) : null
    if (event.senderFrame !== event.sender.mainFrame || parsedUrl === null || !isExternalBrowserUrl(parsedUrl)) {
      return
    }
    try {
      await openExternalInBackground(url)
    } catch (error) {
      console.error('Failed to open external link in the background:', error)
    }
  })

  onTrusted(IpcChannels.APP_READY, openPendingUrlForReadyWebContents)

  setupToastIpc()
  setupLiveReminderIpc(liveReminderManager)

  setupVideoMetadataCacheIpc({ getConfiguredApiServerUrl })

  setupStorageIpc()

  setupSubscriptionAutoRefreshIpc({ backgroundSubscriptions, updateBackgroundSubscriptionVisibility })

  let isRelaunching = false

  function relaunch() {
    // A second request would start a second instance
    if (isRelaunching) return
    isRelaunching = true

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

    try {
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
    } catch (error) {
      // Let a later request try again
      isRelaunching = false
      throw error
    }

    isQuitConfirmed = true
    app.quit()
  }

  onTrusted(IpcChannels.RELAUNCH_REQUEST, () => relaunch())

  nativeTheme.on('updated', () => {
    sendToAppWindows(IpcChannels.NATIVE_THEME_UPDATE, nativeTheme.shouldUseDarkColors)
  })

  handleTrusted(IpcChannels.GENERATE_PO_TOKEN, (_event, videoId, context, initialAttestationData, ytConfig) => {
    if ([videoId, context, initialAttestationData, ytConfig].every(value => typeof value === 'string')) {
      return generatePoToken(videoId, context, initialAttestationData, ytConfig, proxyUrl)
    }
  })

  handleTrusted(IpcChannels.MINT_PO_TOKEN, (_event, videoId) => (
    typeof videoId === 'string' ? mintPoTokenFromAttestation(videoId, proxyUrl) : null
  ), null)

  // Resolve once requests use the new proxy, so a proxy test cannot reach the
  // IP check through the previous connection.
  handleTrusted(IpcChannels.ENABLE_PROXY, async (_event, url) => {
    proxyUrl = url
    await session.defaultSession.setProxy({
      proxyRules: url
    })
    await session.defaultSession.closeAllConnections()
  })

  handleTrusted(IpcChannels.DISABLE_PROXY, async () => {
    proxyUrl = undefined
    await session.defaultSession.setProxy({ mode: 'system' })
    await session.defaultSession.closeAllConnections()
  })

  // Logical tab history is renderer-owned. The retained API returns an empty
  // list for older callers; TopNav reads the active tab runtime directly.
  handleTrusted(IpcChannels.GET_NAVIGATION_HISTORY, () => [])

  setupSystemInfoIpc()
  setupDiagnosticLogIpc()
  baseHandlers.settings._findOne('diagnosticLogging').then((setting) => {
    setDiagnosticLogging(setting?.value === true)
  }).catch(error => console.error('Failed to read the diagnostic logging setting', error))

  // we should switch to getPreferredSystemLanguages at some point and iterate through until we find a supported locale
  handleTrusted(IpcChannels.GET_SYSTEM_LOCALE, () => app.getSystemLocale())

  handleTrusted(IpcChannels.IS_WAYLAND_PLATFORM, () => isWaylandPlatform)

  handleTrusted(IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE, () => supportsAutoPictureInPictureMinimize)

  onTrusted(IpcChannels.OPEN_PROFILE_DIRECTORY, () => {
    shell.openPath(app.getPath('userData')).then((error) => {
      if (error) {
        console.error(`Unable to open profile directory: ${error}`)
      }
    }).catch((error) => {
      console.error('Unable to open profile directory', error)
    })
  })

  setupBackupIpc({ createBackupArchive, updateSettingFromMain, checkScheduledBackup })

  setupScreenshotFolderIpc()

  setupIpBlockRecoveryIpc({ updateSettingFromMain })

  const { stopPowerSaveBlockerForWindow } = setupPowerSaveBlockerIpc()

  handleTrusted(IpcChannels.TABS_SET_SHORTCUTS_BLOCKED, (event, blocked) => {
    if (typeof blocked !== 'boolean') {
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

  onTrusted(IpcChannels.RESTORE_CLOSED_WINDOW, (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow || appShortcutBlockedWindows.has(browserWindow)) return
    reopenClosedWindow()
  })

  onTrusted(IpcChannels.CREATE_NEW_WINDOW, (event, path, query, searchQueryText) => {
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

  ipcMain.handle(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, async (event, payload) => {
    try {
      return await handleOpenInExternalPlayer(event, payload)
    } catch (error) {
      console.error('Could not open the external player', error)
      return null
    }
  })
  /** The API server the user configured, which may run on a private network */
  async function getConfiguredApiServerUrl() {
    if ((await baseHandlers.settings._findOne('backendPreference'))?.value === 'yattee') {
      return normalizeYatteeServerUrl((await baseHandlers.settings._findOne('yatteeServerUrl'))?.value)
    }
    return (await baseHandlers.settings._findOne('defaultInvidiousInstance'))?.value
  }

  setupYtDlpIpc({ updateSettingFromMain })
  ipcMain.handle(IpcChannels.TWITCH_CHAT_REPLAY_PAGE, handleTwitchChatReplayPage)
  ipcMain.handle(IpcChannels.TWITCH_SUB_ONLY_VOD, handleTwitchSubOnlyVod)

  handleTrusted(IpcChannels.GET_REPLACE_HTTP_CACHE, () => replaceHttpCache)

  /**
   * Toggles a setting stored as a marker file, which only applies after a restart.
   * @param {string} channel
   * @param {boolean} isEnabled
   * @param {string} markerPath
   */
  function onRestartSettingToggle(channel, isEnabled, markerPath) {
    onTrusted(channel, async () => {
      try {
        if (isEnabled) {
          await asyncFs.rm(markerPath, { force: true })
        } else {
          await asyncFs.writeFile(markerPath, '')
        }
        relaunch()
      } catch (error) {
        console.error(`Failed to toggle ${channel}`, error)
      }
    })
  }

  onRestartSettingToggle(IpcChannels.TOGGLE_REPLACE_HTTP_CACHE, replaceHttpCache, REPLACE_HTTP_CACHE_PATH)

  handleTrusted(IpcChannels.GET_DISABLE_HARDWARE_ACCELERATION, () => disableHardwareAcceleration)

  onRestartSettingToggle(IpcChannels.TOGGLE_DISABLE_HARDWARE_ACCELERATION, disableHardwareAcceleration, DISABLE_HARDWARE_ACCELERATION_PATH)

  setupPlayerCacheIpc(PLAYER_CACHE_PATH)

  handleTrusted(IpcChannels.VOICE_OVER_TRANSLATION_REQUEST, (_event, payload) => requestVoiceOverTranslation(payload))

  /** @type {Map<number, { url: string, authorization: string }>} */
  const invidiousAuthorizations = new Map()

  const requestErrors = new RequestErrors()

  handleTrusted(IpcChannels.GET_REQUEST_ERROR, (event, url) => (
    typeof url === 'string' ? requestErrors.getError(event.sender.id, url) : null
  ), null)

  onTrusted(IpcChannels.SET_INVIDIOUS_AUTHORIZATION, (event, authorization, url) => {
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

  handleTrusted(IpcChannels.READ_CLIPBOARD, () => clipboard.readText())

  const { loadCustomThemes, getSelectedCustomTheme } = setupCustomThemes({ updateSettingFromMain, updateThemeSource })
  setupCastIpc({ chromecast, fcast, invidiousAuthorizations, getConfiguredApiServerUrl })

  setupDatastoreIpc({
    datastoreRequests,
    onSettingUpserted: applyUpdatedSetting,
    onSettingDeleted: id => {
      if (id === 'contextMenuSearchEngines') contextMenu.setSearchEngines(DEFAULT_SEARCH_ENGINES_SETTING)
    }
  })

  /** @param {{ _id: string, value: any }} data */
  async function applyUpdatedSetting(data) {
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
      case 'notificationMode':
        if (['both', 'system', 'off'].includes(data.value)) notificationMode = data.value
        break
      case 'thumbnailPreference':
        thumbnailPreference = data.value
        break
      case 'blurThumbnails':
        blurThumbnails = data.value === true
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
    twitchLiveNotifier.stop()
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
      await Promise.all(windowSessionWrites)

      await Promise.allSettled([
        enqueueTrayIconWrite(() => {}),
        // A script left in KWin would act on a later process with the same ID
        closeKwinPictureInPictureBounds.then(close => close?.())
          .finally(() => pictureInPictureBoundsStore.settled()),
        // Queue requests run in order, so a read waits for pending queue writes
        updateWatchQueue({}),
        baseHandlers.compactAllDatastores(),
        shutdownYtDlpDownloads(),
        // Uploads are saved as notified before an original title lookup, so a
        // quit during the lookup would otherwise lose their alerts.
        uploadNotifier.settle(),
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
    if (sendSyncServerOidcCallback([url])) return

    // Like links from the command line, only web links may open, not internal app routes
    const newStartupUrl = getNormalizedLinkArg(url)
    if (!newStartupUrl) return
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
    // Blocked navigations to other documents keep the previous renderer.
    webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && isOpenTubeXUrl(url)) {
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

  /**
   * Hands a sync server OIDC callback to the app's renderers. Each ignores it
   * unless it started the sign-in, so a cold start, which no window could have started,
   * needs no handling: getLinkUrl skips the link.
   * @param {string[]} args
   * @returns {boolean} whether the arguments contained a callback
   */
  function sendSyncServerOidcCallback(args) {
    const url = args.find(isSyncServerOidcCallbackUrl)
    if (!url) return false
    // Tabs run in their own renderers. Only app pages may receive the token.
    for (const contents of electronWebContents.getAllWebContents()) {
      if (!contents.isDestroyed() && isOpenTubeXUrl(contents.getURL())) {
        contents.send(IpcChannels.SYNC_SERVER_OIDC_CALLBACK, url)
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (trayWindows.includes(mainWindow)) {
        trayClick(mainWindow)
      } else if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
    return true
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

  function navigateTo(path, browserWindow) {
    if (browserWindow == null || !isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, tabManager?.activeTabId
      ? { tabId: tabManager.activeTabId, route: path }
      : path)
  }

  /**
   * @param {BrowserWindow | undefined} browserWindow
   * @param {'downloads' | 'profile' | null} view
   * @param {boolean} [toggle]
   */
  function showSettingsWindow(browserWindow, view, toggle = false) {
    if (browserWindow != null && isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.SHOW_SETTINGS_WINDOW, { view, toggle })
    }
  }

  async function setMenu() {
    // The app has no other menu to fall back on, so a failed read uses the default shortcuts.
    const keyboardShortcutsSetting = await baseHandlers.settings._findOne('keyboardShortcuts').catch((error) => {
      console.error('Could not read the keyboard shortcuts for the menu', error)
      return null
    })
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
              showSettingsWindow(browserWindow, null, true)
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
              showSettingsWindow(browserWindow, 'downloads')
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
              showSettingsWindow(browserWindow, 'profile')
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
                  const closesLastWindow = BrowserWindow.getAllWindows().length === 1 &&
                    await tabManager.closingTabsClosesWindow(tabIds.length)
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
