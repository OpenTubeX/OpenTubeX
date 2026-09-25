import { ClosedWindowHistory } from './tabs/ClosedWindowHistory.js'
import {
  app, BrowserWindow, dialog, Menu, ipcMain,
  powerSaveBlocker, screen, session,
  nativeTheme, net, protocol, clipboard,
  shell, Tray, Notification, ShareMenu, nativeImage
} from 'electron'
import './applicationDataBootstrap'
import { isPortableBuild } from './applicationDataPaths'
import path from 'path'
import { createDesktopShareHandler, loadWindowsShare } from './desktopShare'
import cp from 'child_process'
import { load as loadYaml } from 'js-yaml'
import { getFonts } from 'font-list'

import {
  IpcChannels,
  SyncEvents,
  getConfiguredKeyboardShortcuts,
  getElectronAccelerator,
  MULTIPLE_TABS_CONFIRM_THRESHOLD,
  LIGHT_BASE_THEMES,
  DARK_BASE_THEMES,
} from '../constants'
import { CUSTOM_THEMES_DIRECTORY, isCustomThemeValue } from '../customTheme'
import { createCustomThemeStore } from './customThemeStore'
import { registerCustomThemeIpc } from './customThemeIpc'
import { registerDatastoreIpc } from './datastoreIpc'
import { registerSettingsIpc } from './settingsIpc'
import { registerYtDlpFileDialogs } from './ytDlpFileDialogs'
import { registerSystemInfoIpc } from './systemInfoIpc'
import { createProxyController, registerProxyIpc } from './proxyController'
import { createIpBlockRecoveryScriptRunner, registerIpBlockRecoveryIpc } from './ipBlockRecoveryIpc'
import * as baseHandlers from '../datastores/handlers/base'
import { liveReminders } from '../datastores'
import { existsSync } from 'fs'
import asyncFs from 'fs/promises'
import { promisify } from 'util'
import { hostname, release } from 'node:os'
import { brotliDecompress } from 'zlib'

import packageDetails from '../../package.json'
import { handleOpenInExternalPlayer } from './externalPlayer'
import { handleTwitchChatReplayPage } from './twitchChat'
import { isYtDlpStoryboardUrl, getYtDlpDownloadFile, getYtDlpExternalStreamCookieHeader, getYtDlpExternalStreamHeaders, handleYtDlpCancelDownload, handleYtDlpCheckBinaryUpdate, handleYtDlpClearDownloads, handleYtDlpControlDownload, handleYtDlpDownload, handleYtDlpDownloadBinary, handleYtDlpGetInfo, handleYtDlpGetSubtitle, handleYtDlpGetPlaybackInfo, handleYtDlpGetHistoryMetadata, handleYtDlpCancelHistoryRepair, handleYtDlpGetRecommendations, handleYtDlpListDownloads, handleYtDlpOpenDownload, handleYtDlpQueueAction, handleYtDlpRemoveDownload, refreshYtDlpDownloadQueue, restoreYtDlpDownloadQueue, shutdownYtDlpDownloads } from './ytDlp'
import { applyYtDlpPlaybackCacheSettings, handleYtDlpPlaybackCacheClear, handleYtDlpPlaybackCacheDelete, handleYtDlpPlaybackCacheGet, handleYtDlpPlaybackCacheSet } from './ytDlpPlaybackCache'
import { generatePoToken } from './poTokenGenerator'
import { expandMultipleOnlyPluralMessages, selectPluralForm } from '../renderer/i18n/plurals'
import { composeLocaleMessages } from '../localeComposition'
import { buildProxyUrl, DEFAULT_PROXY_SETTINGS, isOpenTubeXUrl } from './utils'
import { isInvidiousInstanceUrl } from './invidiousAuthorization'
import { registerInvidiousAuthorizationIpc } from './invidiousAuthorizationIpc'
import { registerRuntimeFlagsIpc } from './runtimeFlagsIpc'
import { configureRequestNetworking } from './requestNetworking'
import { TabManager } from './tabs/TabManager'
import { tabPreviewStorage } from './tabs/TabPreviewStorage'
import { setupTabsIPC } from './tabs/tabIpc'
import { clearAllTabSessions, loadAllTabSessions } from './tabs/TabSessionStore'
import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from '../renderer/helpers/share'
import {
  DEFAULT_SEARCH_ENGINES_SETTING,
  getFaviconUrl,
  parseSearchEngines
} from '../searchEngines'
import { fetchFaviconDataUrl, resolveFaviconUrl } from './favicon'
import { LiveReminderManager } from './LiveReminderManager'
import { requestVoiceOverTranslation } from './voiceOverTranslation'
import { clearVideoMetadataCache, getVideoMetadataCacheSize, updateVideoMetadataCache } from './videoMetadataCache'
import { registerVideoMetadataCacheIpc } from './videoMetadataCacheIpc'
import { registerDownloadedMediaProtocol } from './downloadMediaProtocol'
import { registerDownloadIpc } from './downloadIpc'
import { createOpenUrlRouter } from './openUrlRouting'
import { registerScreenshotStorageIpc } from './screenshotStorageIpc'
import { registerLiveReminderIpc } from './liveReminderIpc'
import { createWindowOpenCoordinator } from './windowOpenCoordinator'
import { registerSubscriptionAutoRefreshIpc } from './subscriptionAutoRefreshIpc'
import { registerWindowActionsIpc } from './windowActionsIpc'
import { registerContextMenuIpc } from './contextMenuIpc'
import { resolveWindowBackground, resolveWindowBounds } from './windowConfiguration'
import { attachWindowCloseLifecycle } from './windowCloseLifecycle'
import { registerToastIpc } from './toastIpc'
import { createDockMediaSessionController } from './dockMediaSession'
import { clearStorage, compactStorageDatabases, getStorageUsage } from './storage'
import { registerStorageIpc } from './storageIpc'
import { registerPlayerCacheIpc } from './playerCacheIpc'
import { registerWindowPowerSaveIpc } from './windowPowerSaveIpc'
import { getLinuxDistributionInfo } from './linuxDistribution'
import {
  createKdeWaylandWindowStateBackend,
  isWaylandPlatform as detectWaylandPlatform,
  monitorKdeWaylandWindowState,
  shouldMonitorKdeWaylandWindowState,
} from './kdeWaylandWindowState'
import { createSubscriptionBackgroundService } from './subscriptionBackground'
import { supportsNativeNotifications } from './nativeNotifications'

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
            supportFetchAPI: true
          }
        }]
      : []),
  ])

  const devServerPort = process.env.OPENTUBEX_DEV_SERVER_PORT ?? '9080'
  const ROOT_APP_URL = process.env.NODE_ENV === 'development' ? `http://localhost:${devServerPort}` : 'app://bundle/index.html'
  const {
    load: loadCustomThemes,
    save: saveCustomTheme,
    remove: deleteCustomTheme,
    replace: replaceCustomThemes,
    getSelected: getSelectedCustomTheme
  } = createCustomThemeStore(path.join(app.getPath('userData'), CUSTOM_THEMES_DIRECTORY))

  let dockMediaLabels = {
    previous: 'Previous',
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    newWindow: 'New Window'
  }

  const dockMedia = createDockMediaSessionController({
    onChange: updateDockMenu,
    sendAction: (manager, action) => manager.bridge.send(IpcChannels.TABS_REQUEST_MEDIA_SESSION_ACTION, action)
  })

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

  let backendPreference = 'local'
  let backendFallback = true
  const DEFAULT_CONFIRM_CLOSE_APP = true
  const DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS = true
  const MULTIPLE_TABS_CONFIRMATION_SETTING_KEYS = {
    close: 'confirmCloseMultipleTabs',
    load: 'confirmLoadMultipleTabs',
    unload: 'confirmUnloadMultipleTabs'
  }
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
  let quitPromptInProgress = null
  const windowClosePromptsInProgress = new Map()
  let isQuitConfirmed = false
  /** @type {{ webContents: import('electron').WebContents, tabId: string } | null} */
  const faviconPromises = new Map()

  /**
   * @returns {Promise<ReturnType<typeof parseSearchEngines>>}
   */
  async function getConfiguredSearchEngines() {
    const setting = (await baseHandlers.settings._findOne('contextMenuSearchEngines'))?.value ??
      DEFAULT_SEARCH_ENGINES_SETTING
    return parseSearchEngines(setting)
  }

  /**
   * @param {string} searchUrl
   * @returns {Promise<string>}
   */
  function resolveSearchEngineFavicon(searchUrl) {
    const fallback = getFaviconUrl(searchUrl)
    if (!fallback) return Promise.resolve('')

    const origin = new URL(fallback).origin
    if (!faviconPromises.has(origin)) {
      const promise = process.env.OPENTUBEX_E2E_USER_DATA_DIR
        ? Promise.resolve(fallback)
        : resolveFaviconUrl(searchUrl, (url, options) => net.fetch(url, options))
            .then(icon => fetchFaviconDataUrl(icon, (url, options) => net.fetch(url, options)))
      faviconPromises.set(origin, promise)
    }

    return faviconPromises.get(origin)
  }

  /**
   * @param {string} url
   * @returns {string | null}
   */
  function getOpenTubeXRouteFromUrl(url) {
    const parsed = URL.parse(url)

    if (!parsed || !isOpenTubeXUrl(parsed)) {
      return null
    }

    if (!parsed.hash) {
      return '/'
    }

    const route = parsed.hash.startsWith('#')
      ? parsed.hash.slice(1)
      : parsed.hash

    return route || '/'
  }

  async function getStartupBehavior() {
    try {
      const value = (await baseHandlers.settings._findOne('startupBehavior'))?.value
      return VALID_STARTUP_BEHAVIORS.has(value) ? value : DEFAULT_STARTUP_BEHAVIOR
    } catch (error) {
      console.error('Failed to load startup behavior preference:', error)
      return DEFAULT_STARTUP_BEHAVIOR
    }
  }

  async function getConfirmCloseApp() {
    try {
      const value = (await baseHandlers.settings._findOne('confirmCloseApp'))?.value
      return typeof value === 'boolean' ? value : DEFAULT_CONFIRM_CLOSE_APP
    } catch (error) {
      console.error('Failed to load close confirmation preference:', error)
      return DEFAULT_CONFIRM_CLOSE_APP
    }
  }

  async function getConfirmCloseWindowWithMultipleTabs() {
    try {
      const value = (await baseHandlers.settings._findOne('confirmCloseWindowWithMultipleTabs'))?.value
      return typeof value === 'boolean' ? value : DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS
    } catch (error) {
      console.error('Failed to load window close confirmation preference:', error)
      return DEFAULT_CONFIRM_CLOSE_WINDOW_WITH_MULTIPLE_TABS
    }
  }

  /**
   * @param {'close' | 'load' | 'unload'} action
   * @returns {Promise<boolean>}
   */
  async function getConfirmMultipleTabsAction(action) {
    const settingKey = MULTIPLE_TABS_CONFIRMATION_SETTING_KEYS[action]
    try {
      const value = (await baseHandlers.settings._findOne(settingKey))?.value
      return typeof value === 'boolean' ? value : true
    } catch (error) {
      console.error(`Failed to load ${action} tabs confirmation preference:`, error)
      return true
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

  /**
   * @param {string} key
   * @param {Record<string, unknown>} messages
   * @returns {string | undefined}
   */
  function getLocaleMessage(key, messages) {
    const value = key.split('.').reduce((current, segment) => {
      return current != null && typeof current === 'object' ? current[segment] : undefined
    }, messages)

    return typeof value === 'string' ? value : undefined
  }

  /**
   * @param {string} locale
   * @param {'human' | 'ai'} source
   * @returns {Promise<Record<string, unknown>>}
   */
  async function loadLocaleMessages(locale, source = 'human') {
    const directory = source === 'ai' ? 'locales/ai' : 'locales'
    const localePath = process.env.NODE_ENV === 'development'
      ? path.resolve(__dirname, `../../static/${directory}`, `${locale}.yaml`)
      : path.resolve(__dirname, `static/${directory}`, `${locale}.json.br`)

    if (process.env.NODE_ENV === 'development') {
      const contents = await asyncFs.readFile(localePath, 'utf8')
      return loadYaml(contents)
    }

    const contents = await asyncFs.readFile(localePath)
    const decompressed = await brotliDecompressAsync(contents)
    return JSON.parse(decompressed.toString('utf8'))
  }

  /**
   * @returns {Promise<(key: string, parameters?: Record<string, string | number>, pluralChoice?: number) => string>}
   */
  async function createMainTranslator() {
    const fallbackLocale = 'en-US'
    const storedLocale = (await baseHandlers.settings._findOne('currentLocale'))?.value
    const storedAITranslationPreference = (await baseHandlers.settings._findOne('useAITranslationCompletions'))?.value
    const useAITranslationCompletions = storedAITranslationPreference == null
      ? true
      : storedAITranslationPreference === true
    const currentLocale = typeof storedLocale === 'string' && storedLocale !== 'system'
      ? storedLocale
      : app.getLocale().replace('_', '-')

    const baseLocale = currentLocale.split('-')[0]
    const candidateLocales = [...new Set([currentLocale, baseLocale, fallbackLocale].filter(Boolean))]
    const humanMessages = new Map()
    const aiMessages = new Map()

    for (const locale of candidateLocales) {
      try {
        humanMessages.set(locale, await loadLocaleMessages(locale))
      } catch (error) {
        if (locale === fallbackLocale) {
          console.error('Failed to load fallback locale for close confirmation dialog:', error)
        }
      }
    }

    if (useAITranslationCompletions) {
      for (const locale of [currentLocale, baseLocale]) {
        if (!locale || aiMessages.has(locale)) continue
        try {
          aiMessages.set(locale, await loadLocaleMessages(locale, 'ai'))
        } catch {
          // Complete locales do not have an AI overlay.
        }
      }
    }

    const messagesByLocale = []
    const currentMessages = composeLocaleMessages({
      locale: currentLocale,
      humanMessages,
      aiMessages,
      includeAI: useAITranslationCompletions,
    })
    if (Object.keys(currentMessages).length > 0) {
      messagesByLocale.push({
        locale: currentLocale,
        messages: expandMultipleOnlyPluralMessages(currentLocale, currentMessages),
      })
    }

    if (currentLocale !== fallbackLocale && humanMessages.has(fallbackLocale)) {
      messagesByLocale.push({
        locale: fallbackLocale,
        messages: expandMultipleOnlyPluralMessages(fallbackLocale, humanMessages.get(fallbackLocale)),
      })
    }

    return (key, parameters = {}, pluralChoice) => {
      for (const { locale, messages } of messagesByLocale) {
        const message = getLocaleMessage(key, messages)
        if (message) {
          const selectedMessage = pluralChoice == null
            ? message
            : selectPluralForm(locale, message, pluralChoice)

          if (selectedMessage == null) continue

          return Object.entries(parameters).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            selectedMessage
          )
        }
      }

      return key
    }
  }

  /**
   * @param {import('electron').BrowserWindow | null | undefined} browserWindow
   * @returns {Promise<boolean>}
   */
  async function confirmCloseApp(browserWindow, allowHideWindow = false) {
    if (isQuitting || isQuitConfirmed || !await getConfirmCloseApp()) {
      return true
    }

    if (quitPromptInProgress) {
      return quitPromptInProgress
    }

    quitPromptInProgress = (async () => {
      const t = await createMainTranslator()
      const buttons = allowHideWindow
        ? [
            t('Close Confirmation.Quit'),
            t('Close Confirmation.Hide Window'),
            t('Cancel'),
            t('Close Confirmation.Never Ask Again')
          ]
        : [
            t('Close Confirmation.Quit'),
            t('Cancel'),
            t('Close Confirmation.Never Ask Again')
          ]
      const { response } = await dialog.showMessageBox(browserWindow ?? undefined, {
        type: 'question',
        title: t('Close Confirmation.Title'),
        message: t('Close Confirmation.Message'),
        detail: allowHideWindow
          ? `${t('Close Confirmation.Background Sync Warning')}\n\n${t('Confirmations.Settings Hint')}`
          : t('Confirmations.Settings Hint'),
        buttons,
        defaultId: 1,
        cancelId: allowHideWindow ? 2 : 1,
        noLink: true
      })

      if (allowHideWindow && response === 1) {
        hideWindowToTray(browserWindow)
        return false
      }

      if (response === (allowHideWindow ? 3 : 2)) {
        try {
          await updateSettingFromMain('confirmCloseApp', false)
        } catch (error) {
          console.error('Failed to disable the app close confirmation:', error)
        }
        isQuitConfirmed = true
        return true
      }

      if (response === 0) {
        isQuitConfirmed = true
        return true
      }

      return false
    })().finally(() => {
      quitPromptInProgress = null
    })

    return quitPromptInProgress
  }

  /**
   * @param {import('electron').BrowserWindow} browserWindow
   * @param {number} count
   * @returns {Promise<boolean>}
   */
  async function confirmCloseWindowWithMultipleTabs(browserWindow, count) {
    if (isQuitting || !await getConfirmCloseWindowWithMultipleTabs()) {
      return true
    }

    const existingPrompt = windowClosePromptsInProgress.get(browserWindow.id)
    if (existingPrompt) return existingPrompt

    const prompt = (async () => {
      const t = await createMainTranslator()
      const { response } = await dialog.showMessageBox(browserWindow, {
        type: 'question',
        title: t('Close Window Confirmation.Title'),
        message: t('Close Window Confirmation.Message', { count }, count),
        detail: t('Confirmations.Settings Hint'),
        buttons: [
          t('Close Window Confirmation.Close Window'),
          t('Cancel'),
          t('Confirmations.Never Ask Again')
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })

      if (response === 2) {
        try {
          await updateSettingFromMain('confirmCloseWindowWithMultipleTabs', false)
        } catch (error) {
          console.error('Failed to disable the multi-tab window close confirmation:', error)
        }
        return true
      }

      return response === 0
    })().finally(() => {
      windowClosePromptsInProgress.delete(browserWindow.id)
    })

    windowClosePromptsInProgress.set(browserWindow.id, prompt)
    return prompt
  }

  let multipleTabsActionRequestCount = 0

  /**
   * Ask the renderer to confirm a bulk tab action.
   * @param {TabManager | null | undefined} manager
   * @param {number} count the number of tabs affected
   * @param {'close' | 'load' | 'unload'} action
   * @returns {Promise<boolean>}
   */
  async function confirmMultipleTabsAction(manager, count, action) {
    if (count < MULTIPLE_TABS_CONFIRM_THRESHOLD || !await getConfirmMultipleTabsAction(action)) {
      return true
    }

    const browserWindow = manager?.browserWindow
    if (!browserWindow || browserWindow.isDestroyed()) {
      return true
    }

    const requestId = `${action}-multiple-tabs-${++multipleTabsActionRequestCount}`
    return new Promise(resolve => {
      /**
       * @param {import('electron').IpcMainEvent} _event
       * @param {{ requestId?: string, confirmed?: boolean }} response
       */
      const listener = (_event, response) => {
        if (response?.requestId !== requestId) return

        finish(response.confirmed === true)
      }

      const handleWindowClosed = () => finish(false)

      /**
       * @param {boolean} confirmed
       */
      function finish(confirmed) {
        clearTimeout(timeoutId)
        ipcMain.removeListener(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, listener)
        browserWindow.removeListener('closed', handleWindowClosed)
        resolve(confirmed)
      }

      const timeoutId = setTimeout(() => finish(false), 30_000)
      ipcMain.on(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION_RESPONSE, listener)
      browserWindow.once('closed', handleWindowClosed)
      manager.bridge.send(IpcChannels.TABS_CONFIRM_MULTIPLE_ACTION, { requestId, count, action })
    })
  }

  // Becomes true once the user asks the app to quit (e.g. Ctrl+Q / "Quit" menu
  // item / last-window-closed on non-darwin). Window close handlers use this to
  // decide whether their persisted tab session record should be kept (so the
  // window is restored on the next launch) or cleared (so a window that was
  // manually closed while the app keeps running is forgotten).
  let isQuitting = false
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

  const contextMenuIpc = registerContextMenuIpc({
    ipcMain,
    TabManager,
    BrowserWindow,
    clipboard,
    shell,
    isTrustedUrl: isOpenTubeXUrl,
    getOpenTubeXRouteFromUrl,
    isShareableOpenTubeXRoute,
    transformOpenTubeXRouteUrl,
    getConfiguredSearchEngines,
    createWindow,
    reopenClosedWindow,
    confirmCloseApp,
    confirmMultipleTabsAction,
    closeConfirmedWindowIds,
    getSubscriptionAutoRefresh: () => subscriptionAutoRefresh,
    getBackendPreference: () => backendPreference,
    getBackendFallback: () => backendFallback,
    rootAppUrl: ROOT_APP_URL
  })

  ipcMain.handle(IpcChannels.RESOLVE_FAVICON, async (event, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof url !== 'string') return ''

    if (!(await getConfiguredSearchEngines()).some(engine => engine.enabled && engine.url === url)) {
      return ''
    }

    return resolveSearchEngineFavicon(url)
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
  const trayClosingWindowIds = new Set()
  let trayWindows = []
  const trayMaximizedWindows = {}
  const activeLiveNotifications = new Set()
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
  const backgroundSubscriptions = createSubscriptionBackgroundService(userDataPath)
  let keepRefreshingInBackground = false

  ipcMain.handle(IpcChannels.SUBSCRIPTION_BACKGROUND, async (event, method, value) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || !TabManager.getFromWebContents(event.sender)) return
    switch (method) {
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
    }
  })

  function updateBackgroundSubscriptionVisibility() {
    const hidden = BrowserWindow.getAllWindows().every(window => !window.isVisible() || window.isMinimized())
    backgroundSubscriptions.setBackground(hidden && !subscriptionAutoRefresh.isInProgress()).catch(console.error)
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

  function getTrayImage() {
    if (!selectedTrayImage.isEmpty()) {
      return process.platform === 'darwin' ? selectedTrayImage.resize({ height: 18 }) : selectedTrayImage
    }
    return process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '..', '..', '_icons', 'iconColor.png')
      : path.join(__dirname, '..', '_icons', 'iconColor.png')
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
    if (!supportsNativeNotifications(Notification)) return

    const notification = new Notification({
      title: reminder.notificationTitle,
      body: reminder.notificationBody
    })
    activeLiveNotifications.add(notification)
    notification.once('close', () => activeLiveNotifications.delete(notification))
    notification.once('click', () => {
      activeLiveNotifications.delete(notification)
      const videoUrl = `https://www.youtube.com/watch?v=${reminder.videoId}`

      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindowForOpenUrl(videoUrl, {
          showWindowNow: true,
          reuseEmptyRootTab: true
        }).catch(error => {
          console.error('Failed to open live stream reminder', error)
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
      openUrlInWindow(mainWindow, videoUrl)
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

  let proxyController

  app.on('ready', async (_, __) => {
    proxyController = createProxyController(session.defaultSession)
    try {
      await applyYtDlpPlaybackCacheSettings()
    } catch (error) {
      console.warn('Could not apply the yt-dlp playback cache settings', error)
    }
    try {
      await restoreYtDlpDownloadQueue()
    } catch (error) {
      console.warn('Could not restore the download queue', error)
    }
    {
      const t = await createMainTranslator()
      trayTranslate = t
      dockMediaLabels = {
        previous: t('Video.Previous'),
        play: t('Video.Player.Scroll Mini Player.Play'),
        pause: t('Video.Player.Scroll Mini Player.Pause'),
        next: t('Video.Next'),
        newWindow: t('New Window')
      }
      updateDockMenu()
    }

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
      proxyController.set(buildProxyUrl({ protocol: proxyProtocol, hostname: proxyHostname, port: proxyPort }), {
        closeConnections: false
      })
    }

    configureRequestNetworking({
      session: session.defaultSession,
      protocol,
      net,
      productName: packageDetails.productName,
      replaceHttpCache,
      invidiousAuthorizations,
      getExternalStreamHeaders: getYtDlpExternalStreamHeaders,
      getExternalStreamCookieHeader: getYtDlpExternalStreamCookieHeader,
      isStoryboardUrl: isYtDlpStoryboardUrl
    })

    registerDownloadedMediaProtocol({
      protocol,
      getDownloadFile: getYtDlpDownloadFile
    })

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
      mediaSessionStateChanged: dockMedia.updateSession
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

    const directStartupUrl = getDirectOpenUrl(startupUrl)

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
      const signature = JSON.stringify(template)
      if (signature === trayMenuSignature) return
      tray.setContextMenu(Menu.buildFromTemplate(template))
      trayMenuSignature = signature
    }
  }

  function createMediaMenuItems() {
    const session = dockMedia.getSession()
    const actions = session?.actions ?? new Set()
    const toggleAction = session?.playbackState === 'playing' ? 'pause' : 'play'
    return [
      {
        label: dockMediaLabels.previous,
        enabled: actions.has('previoustrack'),
        click: () => dockMedia.requestAction('previoustrack')
      },
      {
        label: toggleAction === 'pause' ? dockMediaLabels.pause : dockMediaLabels.play,
        enabled: actions.has(toggleAction),
        click: () => dockMedia.requestAction(toggleAction)
      },
      {
        label: dockMediaLabels.next,
        enabled: actions.has('nexttrack'),
        click: () => dockMedia.requestAction('nexttrack')
      }
    ]
  }

  function defaultTrayMenu() {
    const windows = BrowserWindow.getAllWindows()
    const isShown = window => window.isVisible() && !window.isMinimized() && !trayWindows.includes(window)
    return [
      ...windows.map(window => ({
        id: `window-${window.id}`,
        label: window.getTitle().replace(/\u2063[\u200b\u200c]+$/, '').replace(/ - OpenTubeX$/, ''),
        submenu: [
          {
            label: trayTranslate(isShown(window) ? 'Video.Player.Hide' : 'Video.Player.Show'),
            click: () => isShown(window) ? hideWindowToTray(window) : trayClick(window)
          },
          {
            label: trayTranslate('Close'),
            click: () => {
              trayClick(window)
              trayClosingWindowIds.add(window.id)
              window.close()
            }
          }
        ]
      })),
      { type: 'separator' },
      ...createMediaMenuItems(),
      { type: 'separator' },
      {
        label: dockMediaLabels.newWindow,
        click: () => createWindow({
          showWindowNow: true,
          replaceMainWindow: !mainWindow || mainWindow.isDestroyed() || trayWindows.includes(mainWindow)
        })
      },
      ...(windows.some(window => !isShown(window))
        ? [{
            label: trayTranslate('Tray.Show All Windows'),
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
            click: () => {
              for (const window of BrowserWindow.getAllWindows()) {
                if (isShown(window)) hideWindowToTray(window)
              }
            }
          }]
        : []),
      {
        label: trayTranslate('Quit'),
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
    const windowBackground = await resolveWindowBackground({
      settings: baseHandlers.settings,
      nativeTheme,
      loadCustomThemes,
      getSelectedCustomTheme
    })
    const { savedBounds, savedMaximized } = await resolveWindowBounds({
      settings: baseHandlers.settings,
      screen,
      sessionData
    })

    const hideStartupSplash = (await baseHandlers.settings._findOne('hideStartupSplash'))?.value === true

    const newWindow = new BrowserWindow({
      // The initial HTML paints a splash before the shared renderer boots.
      show: false,
      backgroundColor: windowBackground,
      icon: process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../../_icons/iconColor.png')
        : path.join(__dirname, '../_icons/iconColor.png'),
      autoHideMenuBar: true,
      // useContentSize: true,
      webPreferences: {
        backgroundThrottling: false,
        additionalArguments: [
          `--startup-background=${windowBackground}`,
          `--startup-dark=${nativeTheme.shouldUseDarkColors}`,
          `--hide-startup-splash=${hideStartupSplash}`
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

    attachWindowCloseLifecycle({
      window: newWindow,
      tabManager,
      BrowserWindow,
      isQuitting: () => isQuitting,
      isTrayOnClose: () => trayOnClose,
      isTrayEnabled,
      trayClosingWindowIds,
      hideWindowToTray,
      closeConfirmedWindowIds,
      closingWindowIds,
      confirmCloseApp,
      confirmCloseWindowWithMultipleTabs,
      keepRefreshingInBackground: () => keepRefreshingInBackground,
      confirmQuit: () => { isQuitConfirmed = true; app.quit() },
      closedWindows,
      htmlFullscreenWindowIds,
      settings: baseHandlers.settings
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

      windowPowerSave.stopForWindow(newWindow)
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

  /**
   * @param {string | null | undefined} url
   * @param {object} [options]
   * @param {boolean} [options.replaceMainWindow]
   * @param {boolean} [options.showWindowNow]
   * @param {boolean} [options.reuseEmptyRootTab]
   * @returns {Promise<import('electron').BrowserWindow>}
   */
  async function createWindowForOpenUrl(url, options = {}) {
    const { reuseEmptyRootTab = false, ...createWindowOptions } = options
    const directOpenUrl = getDirectOpenUrl(url)
    const newWindow = await createWindow({
      ...createWindowOptions,
      ...(directOpenUrl ? { windowStartupUrl: directOpenUrl } : {})
    })

    if (!directOpenUrl) {
      openUrlInWindow(newWindow, url, { reuseEmptyRootTab })
    }

    return newWindow
  }

  const getDirectOpenUrl = createOpenUrlRouter({
    rootAppUrl: ROOT_APP_URL,
    isTrustedUrl: isOpenTubeXUrl
  })

  const { openUrlInWindow, openPendingUrlForReadyWebContents, resetReady, forget } = createWindowOpenCoordinator({
    rootAppUrl: ROOT_APP_URL,
    getDirectOpenUrl,
    isTrustedUrl: isOpenTubeXUrl,
    BrowserWindow,
    TabManager
  })

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

  registerToastIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    getWindows: () => BrowserWindow.getAllWindows()
  })

  registerLiveReminderIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    canNotify: () => supportsNativeNotifications(Notification),
    manager: liveReminderManager
  })

  registerVideoMetadataCacheIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    resolveHost: (hostname, options) => session.defaultSession.resolveHost(hostname, options),
    fetch: (url, options) => net.fetch(url, options),
    getDefaultInvidiousInstance: async () => (await baseHandlers.settings._findOne('defaultInvidiousInstance'))?.value,
    updateCache: updateVideoMetadataCache,
    clearCache: clearVideoMetadataCache,
    getCacheSize: getVideoMetadataCacheSize,
    getWindows: () => BrowserWindow.getAllWindows()
  })

  registerStorageIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    getStorageUsage,
    clearStorage,
    compactStorageDatabases
  })

  const subscriptionAutoRefresh = registerSubscriptionAutoRefreshIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    TabManager,
    getActiveRecovery: () => ipBlockRecovery.getActivePromise(),
    backgroundSubscriptions,
    updateBackgroundVisibility: updateBackgroundSubscriptionVisibility,
    getWindows: () => BrowserWindow.getAllWindows()
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
      app.relaunch({
        args: process.argv.slice(1),
        execPath: PORTABLE_EXECUTABLE_FILE || process.execPath
      })
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

  ipcMain.handle(IpcChannels.GENERATE_PO_TOKEN, (event, videoId, context, initialAttestationData, ytConfig) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return generatePoToken(videoId, context, initialAttestationData, ytConfig, proxyController.getUrl())
    }
  })

  registerProxyIpc({
    ipcMain,
    controller: proxyController,
    isTrustedUrl: isOpenTubeXUrl
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

  registerSystemInfoIpc({
    ipcMain,
    app,
    isTrustedUrl: isOpenTubeXUrl,
    hostname,
    release,
    getLinuxDistributionInfo,
    getFonts,
    platform: process.platform,
    architecture: process.arch,
    isWaylandPlatform,
    supportsAutoPictureInPictureMinimize
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

  registerScreenshotStorageIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    settings: baseHandlers.settings,
    app,
    BrowserWindow,
    dialog
  })

  const ipBlockRecovery = registerIpBlockRecoveryIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    executeScript: createIpBlockRecoveryScriptRunner({
      path,
      platform: process.platform,
      systemRoot: process.env.SystemRoot,
      spawn: cp.spawn,
      stat: asyncFs.stat,
      settings: baseHandlers.settings
    }),
    app,
    BrowserWindow,
    dialog,
    platform: process.platform
  })

  const windowPowerSave = registerWindowPowerSaveIpc({
    ipcMain,
    BrowserWindow,
    powerSaveBlocker,
    isTrustedUrl: isOpenTubeXUrl
  })

  registerWindowActionsIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    BrowserWindow,
    TabManager,
    appShortcutBlockedWindows,
    reopenClosedWindow,
    createWindow,
    rootAppUrl: ROOT_APP_URL
  })

  ipcMain.on(IpcChannels.OPEN_IN_EXTERNAL_PLAYER, handleOpenInExternalPlayer)

  registerDownloadIpc({
    ipcMain,
    download: handleYtDlpDownload,
    cancelDownload: handleYtDlpCancelDownload,
    isAutomaticDownloadAuthorized: subscriptionAutoRefresh.isAutomaticDownloadAuthorized,
    handlers: {
      controlDownload: handleYtDlpControlDownload,
      queueAction: handleYtDlpQueueAction,
      listDownloads: handleYtDlpListDownloads,
      clearDownloads: handleYtDlpClearDownloads,
      openDownload: handleYtDlpOpenDownload,
      removeDownload: handleYtDlpRemoveDownload,
      getInfo: handleYtDlpGetInfo,
      getSubtitle: handleYtDlpGetSubtitle,
      cancelHistoryRepair: handleYtDlpCancelHistoryRepair,
      getHistoryMetadata: handleYtDlpGetHistoryMetadata,
      getPlaybackInfo: handleYtDlpGetPlaybackInfo,
      getRecommendations: handleYtDlpGetRecommendations,
      playbackCacheGet: handleYtDlpPlaybackCacheGet,
      playbackCacheSet: handleYtDlpPlaybackCacheSet,
      playbackCacheDelete: handleYtDlpPlaybackCacheDelete,
      playbackCacheClear: handleYtDlpPlaybackCacheClear,
      checkBinaryUpdate: handleYtDlpCheckBinaryUpdate,
      downloadBinary: handleYtDlpDownloadBinary
    }
  })
  ipcMain.handle(IpcChannels.TWITCH_CHAT_REPLAY_PAGE, handleTwitchChatReplayPage)

  registerYtDlpFileDialogs({
    ipcMain,
    app,
    BrowserWindow,
    dialog,
    isTrustedUrl: isOpenTubeXUrl,
    platform: process.platform
  })

  registerRuntimeFlagsIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    replaceHttpCache: { enabled: replaceHttpCache, path: REPLACE_HTTP_CACHE_PATH },
    disableHardwareAcceleration: { enabled: disableHardwareAcceleration, path: DISABLE_HARDWARE_ACCELERATION_PATH },
    files: asyncFs,
    relaunch
  })

  registerPlayerCacheIpc({
    ipcMain,
    directory: path.join(userDataPath, 'player_cache'),
    isTrustedUrl: isOpenTubeXUrl
  })

  ipcMain.handle(IpcChannels.VOICE_OVER_TRANSLATION_REQUEST, async (event, payload) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    return await requestVoiceOverTranslation(payload)
  })

  const invidiousAuthorizations = registerInvidiousAuthorizationIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    isInvidiousInstanceUrl
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

  registerCustomThemeIpc({
    ipcMain,
    isTrustedUrl: isOpenTubeXUrl,
    store: {
      load: loadCustomThemes,
      save: saveCustomTheme,
      replace: replaceCustomThemes,
      remove: deleteCustomTheme
    },
    settings: baseHandlers.settings,
    updateSetting: updateSettingFromMain,
    nativeTheme,
    getWindows: () => BrowserWindow.getAllWindows(),
    setBaseThemeSource: updateThemeSource
  })

  // ************************************************* //
  // DB related IPC calls
  // *********** //

  // Settings
  registerSettingsIpc({
    ipcMain,
    settings: baseHandlers.settings,
    isTrustedUrl: isOpenTubeXUrl,
    syncOtherWindows,
    onSettingUpsert
  })

  async function onSettingUpsert(data) {
    switch (data._id) {
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
      case 'baseTheme':
        if (isCustomThemeValue(data.value)) {
          nativeTheme.themeSource = (await getSelectedCustomTheme(data.value))?.isDark ? 'dark' : 'light'
        } else {
          updateThemeSource(data.value)
        }
        break
      case 'ytDlpMaxConcurrentDownloads':
      case 'ytDlpDownloadBandwidthLimit':
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

  registerDatastoreIpc({
    ipcMain,
    handlers: baseHandlers,
    isTrustedUrl: isOpenTubeXUrl,
    syncOtherWindows,
    getPlayingVideoIds
  })

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
    // Clean up resources (datastores' compaction + Electron cache and storage data clearing)
    handleQuit()
  })

  if (process.platform === 'darwin') {
    // `window-all-closed` doesn't fire for Cmd+Q
    // https://www.electronjs.org/docs/latest/api/app#event-window-all-closed
    // This is also fired when `app.quit` called
    // Not using `before-quit` since that one is fired before windows are closed
    app.on('will-quit', e => {
      // Let app quit when the cleanup is finished

      if (resourcesCleanUpDone) { return }

      e.preventDefault()
      cleanUpResources().finally(() => {
        // Quit AFTER the resources cleanup is finished
        // Which calls the listener again, which is why we have the variable

        app.quit()
      })
    })
  }

  function handleQuit() {
    cleanUpResources().finally(() => {
      mainWindow = null
      if (process.platform !== 'darwin') {
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

    await Promise.allSettled([
      trayIconWrite,
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
  }

  // MacOS event
  // https://www.electronjs.org/docs/latest/api/app#event-activate-macos
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
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
        resetReady(webContents.id)
        const browserWindow = BrowserWindow.fromWebContents(webContents)
        if (browserWindow) {
          appShortcutBlockedWindows.delete(browserWindow)
        }
      }
    })

    webContents.once('destroyed', () => {
      contextMenuIpc.forget(webContents.id)
      forget(webContents.id)
      invidiousAuthorizations.forget(webContents.id)
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
          (backendFallback || backendPreference === 'invidious') && {
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
