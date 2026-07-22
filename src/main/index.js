import {
  app, BrowserWindow, dialog, Menu, ipcMain,
  powerSaveBlocker, screen, session,
  nativeTheme, net, protocol, clipboard,
  Tray
} from 'electron'
import './e2eUserDataOverride'
import path from 'path'
import cp from 'child_process'
import { load as loadYaml } from 'js-yaml'

import {
  IpcChannels,
  DBActions,
  SyncEvents,
  getConfiguredKeyboardShortcuts,
  getElectronAccelerator,
  SEARCH_CHAR_LIMIT,
} from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { extractExpiryTimestamp, ImageCache } from './ImageCache'
import { constants as fsConstants, existsSync } from 'fs'
import asyncFs from 'fs/promises'
import { promisify } from 'util'
import { brotliDecompress } from 'zlib'

import packageDetails from '../../package.json'
import { handleOpenInExternalPlayer } from './externalPlayer'
import { handleYtDlpCancelDownload, handleYtDlpDownload, handleYtDlpDownloadBinary, handleYtDlpGetInfo } from './ytDlp'
import { generatePoToken } from './poTokenGenerator'
import { isOpenTubeXUrl } from './utils'
import { TabManager, setupTabsIPC } from './tabs/TabManager'
import { clearAllTabSessions, loadAllTabSessions } from './tabs/TabSessionStore'
import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from '../renderer/helpers/share'

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

  const ROOT_APP_URL = process.env.NODE_ENV === 'development' ? 'http://localhost:9080' : 'app://bundle/index.html'

  let backendPreference = 'local'
  let backendFallback = true
  const DEFAULT_CONFIRM_CLOSE_APP = true
  const DEFAULT_STARTUP_BEHAVIOR = 'loadLastActiveTab'
  const VALID_STARTUP_BEHAVIORS = new Set([
    'loadAllTabs',
    'restoreTabLoadState',
    'loadLastActiveTab',
    'emptySession'
  ])
  const closeConfirmedWindowIds = new Set()
  let quitPromptInProgress = null
  let isQuitConfirmed = false
  /** @type {{ webContents: import('electron').WebContents, tabId: string } | null} */
  let subscriptionAutoRefreshOwner = null
  let subscriptionAutoRefreshProgress = 0
  /** @type {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }> | null} */
  let ipBlockRecoveryScriptPromise = null

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
   * @returns {Promise<Record<string, unknown>>}
   */
  async function loadLocaleMessages(locale) {
    const localePath = process.env.NODE_ENV === 'development'
      ? path.resolve(__dirname, '../../static/locales', `${locale}.yaml`)
      : path.resolve(__dirname, 'static/locales', `${locale}.json.br`)

    if (process.env.NODE_ENV === 'development') {
      const contents = await asyncFs.readFile(localePath, 'utf8')
      return loadYaml(contents)
    }

    const contents = await asyncFs.readFile(localePath)
    const decompressed = await brotliDecompressAsync(contents)
    return JSON.parse(decompressed.toString('utf8'))
  }

  /**
   * @returns {Promise<(key: string) => string>}
   */
  async function createMainTranslator() {
    const fallbackLocale = 'en-US'
    const storedLocale = (await baseHandlers.settings._findOne('currentLocale'))?.value
    const currentLocale = typeof storedLocale === 'string' && storedLocale !== 'system'
      ? storedLocale
      : app.getLocale().replace('_', '-')

    const messagesByLocale = []
    for (const locale of [currentLocale, currentLocale.split('-')[0], fallbackLocale]) {
      if (!locale || messagesByLocale.some(entry => entry.locale === locale)) {
        continue
      }

      try {
        messagesByLocale.push({
          locale,
          messages: await loadLocaleMessages(locale)
        })
      } catch (error) {
        if (locale === fallbackLocale) {
          console.error('Failed to load fallback locale for close confirmation dialog:', error)
        }
      }
    }

    return (key) => {
      for (const { messages } of messagesByLocale) {
        const message = getLocaleMessage(key, messages)
        if (message) {
          return message
        }
      }

      return key
    }
  }

  /**
   * @param {import('electron').BrowserWindow | null | undefined} browserWindow
   * @returns {Promise<boolean>}
   */
  async function confirmCloseApp(browserWindow) {
    if (isQuitting || isQuitConfirmed || !await getConfirmCloseApp()) {
      return true
    }

    if (quitPromptInProgress) {
      return quitPromptInProgress
    }

    quitPromptInProgress = (async () => {
      const t = await createMainTranslator()
      const { response } = await dialog.showMessageBox(browserWindow ?? undefined, {
        type: 'question',
        title: t('Close Confirmation.Title'),
        message: t('Close Confirmation.Message'),
        buttons: [
          t('Close Confirmation.Quit'),
          t('Cancel'),
          t('Close Confirmation.Never Ask Again')
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })

      if (response === 2) {
        await baseHandlers.settings.upsert('confirmCloseApp', false)
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

  // Becomes true once the user asks the app to quit (e.g. Ctrl+Q / "Quit" menu
  // item / last-window-closed on non-darwin). Window close handlers use this to
  // decide whether their persisted tab session record should be kept (so the
  // window is restored on the next launch) or cleared (so a window that was
  // manually closed while the app keeps running is forgotten).
  let isQuitting = false

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
      const manager = TabManager.getFromWebContents(webContents)
      const contextMenuTab = manager?.contextMenuTabId != null
        ? manager.tabs.get(manager.contextMenuTabId)
        : undefined
      const contextMenuTabs = contextMenuTab && manager
        ? (manager.contextMenuSelectedTabIds.length > 0
            ? manager.contextMenuSelectedTabIds
            : [contextMenuTab.id])
            .map(tabId => manager.tabs.get(tabId))
            .filter(Boolean)
        : []
      const isBulkTabAction = contextMenuTabs.length > 1
      const isContextMenuTabUnloaded = contextMenuTab?.loadState === 'unloaded'
      const isTabBarContextMenu = contextMenuTab != null || manager?.contextMenuSurface === 'tabBar'
      const subscriptionFeedTab = manager?.contextMenuSurface === 'subscriptionFeedTab'
        ? manager.contextMenuSubscriptionFeedTab
        : null
      const subscriptionFeedLabels = {
        videos: 'Videos',
        shorts: 'Shorts',
        live: 'Live',
        posts: 'Posts',
        all: 'All Feeds'
      }
      const contextMenuTabYouTubeUrls = contextMenuTabs.map(tab => {
        const route = getOpenTubeXRouteFromUrl(tab.url)
        return isShareableOpenTubeXRoute(route)
          ? transformOpenTubeXRouteUrl(route, true)
          : null
      })
      const pageUrl = parameters.pageURL || ''
      const isInAppUrl = isOpenTubeXUrl(pageUrl) && parameters.linkURL.split('#')[0] === pageUrl.split('#')[0]

      const moveTargets = contextMenuTab != null && manager != null
        ? TabManager.listMoveTargets(manager.browserWindow.id)
        : []
      const contextMenuTabIds = contextMenuTab != null && manager != null
        ? Array.from(manager.tabs.keys())
        : []
      const contextMenuTabIndex = contextMenuTabIds.indexOf(contextMenuTab?.id)
      const selectedTabIndexes = contextMenuTabs
        .map(tab => contextMenuTabIds.indexOf(tab.id))
        .filter(index => index !== -1)
      const firstSelectedTabIndex = selectedTabIndexes.length > 0
        ? Math.min(...selectedTabIndexes)
        : contextMenuTabIndex
      const lastSelectedTabIndex = selectedTabIndexes.length > 0
        ? Math.max(...selectedTabIndexes)
        : contextMenuTabIndex
      const allSelectedTabsPinned = contextMenuTabs.every(tab => tab.isPinned === true)
      const selectedTabIdSet = new Set(contextMenuTabs.map(tab => tab.id))
      const canMoveContextMenuTabsTo = (toEnd) => {
        return [true, false].some(isPinned => {
          const groupIds = Array.from(manager?.tabs.values() ?? [])
            .filter(tab => tab.isPinned === isPinned)
            .map(tab => tab.id)
          const selectedGroupIds = groupIds.filter(tabId => selectedTabIdSet.has(tabId))
          if (selectedGroupIds.length === 0) return false

          const destinationIds = toEnd
            ? groupIds.slice(-selectedGroupIds.length)
            : groupIds.slice(0, selectedGroupIds.length)
          return destinationIds.some((tabId, index) => tabId !== selectedGroupIds[index])
        })
      }
      const canMoveContextMenuTabsToBeginning = canMoveContextMenuTabsTo(false)
      const canMoveContextMenuTabsToEnd = canMoveContextMenuTabsTo(true)
      const selectedTabColor = contextMenuTabs.every(tab => tab.color === contextMenuTabs[0]?.color)
        ? contextMenuTabs[0]?.color ?? null
        : undefined
      const hasSelectedUnloadedTab = contextMenuTabs.some(tab => tab.loadState === 'unloaded')
      const hasSelectedLoadedTab = contextMenuTabs.some(tab => !['unloaded', 'unloading'].includes(tab.loadState))
      const closeContextMenuTabs = async (tabIds) => {
        if (!manager) return

        const existingTabIds = tabIds.filter(tabId => manager.tabs.has(tabId))
        const isLastWindow = BrowserWindow.getAllWindows().length === 1
        if (
          existingTabIds.length === manager.tabs.size &&
          isLastWindow &&
          !await confirmCloseApp(manager.browserWindow)
        ) {
          return
        }

        // Close the presented tab last so its replacement can be shown before
        // the composited subtree is removed.
        existingTabIds.sort((a, b) => Number(a === manager.presentedTabId) - Number(b === manager.presentedTabId))
        let hasRemainingTabs = true
        for (const tabId of existingTabIds) {
          hasRemainingTabs = manager.closeTab(tabId)
        }
        if (!hasRemainingTabs) {
          if (isLastWindow) closeConfirmedWindowIds.add(manager.browserWindow.id)
          manager.browserWindow.close()
        }
      }

      return [
        {
          label: `Reload ${subscriptionFeedLabels[subscriptionFeedTab] ?? 'Feed'}`,
          visible: subscriptionFeedTab != null,
          click: () => {
            if (!manager || !subscriptionFeedTab || !manager.presentedTabId) return

            manager.bridge.send(IpcChannels.SUBSCRIPTION_FEED_REQUEST_RELOAD, {
              tabId: manager.presentedTabId,
              feedTab: subscriptionFeedTab
            })
          }
        },
        {
          type: 'separator',
          visible: subscriptionFeedTab != null
        },
        {
          label: isBulkTabAction ? `Close ${contextMenuTabs.length} Tabs` : 'Close Tab',
          visible: contextMenuTab != null,
          click: async () => {
            if (!manager || !contextMenuTab) return

            await closeContextMenuTabs(contextMenuTabs.map(tab => tab.id))
          }
        },
        {
          label: isBulkTabAction ? `Duplicate ${contextMenuTabs.length} Tabs` : 'Duplicate Tab',
          visible: contextMenuTab != null,
          click: () => {
            if (!manager || !contextMenuTab) return

            for (const tab of contextMenuTabs) manager.duplicateTab(tab.id)
          }
        },
        {
          label: isBulkTabAction ? 'Move Tabs' : 'Move Tab',
          visible: contextMenuTab != null,
          submenu: [
            {
              label: 'To Beginning',
              enabled: canMoveContextMenuTabsToBeginning,
              click: () => {
                if (!manager || !contextMenuTab) return

                if (isBulkTabAction) {
                  for (const tab of [...contextMenuTabs].reverse()) {
                    manager.moveTab(tab.id, 0)
                  }
                } else {
                  manager.moveTab(contextMenuTab.id, 0)
                }
              }
            },
            {
              label: 'To End',
              enabled: canMoveContextMenuTabsToEnd,
              click: () => {
                if (!manager || !contextMenuTab) return

                if (isBulkTabAction) {
                  for (const tab of contextMenuTabs) {
                    manager.moveTab(tab.id, manager.tabs.size)
                  }
                } else {
                  manager.moveTab(contextMenuTab.id, manager.tabs.size)
                }
              }
            }
          ]
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: 'Close Tabs',
          visible: contextMenuTab != null,
          submenu: [
            {
              label: manager?.contextMenuTabBarVertical ? 'To the Top' : 'To the Left',
              enabled: firstSelectedTabIndex > 0,
              click: () => {
                closeContextMenuTabs(contextMenuTabIds.slice(0, firstSelectedTabIndex))
              }
            },
            {
              label: manager?.contextMenuTabBarVertical ? 'To the Bottom' : 'To the Right',
              enabled: lastSelectedTabIndex < contextMenuTabIds.length - 1,
              click: () => {
                closeContextMenuTabs(contextMenuTabIds.slice(lastSelectedTabIndex + 1))
              }
            },
            {
              label: 'Other Tabs',
              enabled: contextMenuTabIds.length > contextMenuTabs.length,
              click: () => {
                const selectedIds = new Set(contextMenuTabs.map(tab => tab.id))
                closeContextMenuTabs(contextMenuTabIds.filter(tabId => !selectedIds.has(tabId)))
              }
            }
          ]
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: isBulkTabAction ? 'Copy YouTube Links' : 'Copy YouTube Link',
          visible: contextMenuTabYouTubeUrls.length > 0 && contextMenuTabYouTubeUrls.every(Boolean),
          click: () => {
            if (!contextMenuTabYouTubeUrls.every(Boolean)) return

            clipboard.writeText(contextMenuTabYouTubeUrls.join('\n'))
          }
        },
        {
          type: 'separator',
          visible: contextMenuTabYouTubeUrls.length > 0 && contextMenuTabYouTubeUrls.every(Boolean)
        },
        {
          label: allSelectedTabsPinned
            ? isBulkTabAction ? 'Unpin Tabs' : 'Unpin Tab'
            : isBulkTabAction ? 'Pin Tabs' : 'Pin Tab',
          visible: contextMenuTab != null,
          click: () => {
            if (!manager || !contextMenuTab) return

            for (const tab of contextMenuTabs) {
              manager.setTabPinned(tab.id, !allSelectedTabsPinned)
            }
          }
        },
        {
          label: 'Tab Color',
          visible: contextMenuTab != null,
          submenu: [
            { label: 'Default', color: null },
            { label: 'Red', color: 'red' },
            { label: 'Orange', color: 'orange' },
            { label: 'Yellow', color: 'yellow' },
            { label: 'Green', color: 'green' },
            { label: 'Blue', color: 'blue' },
            { label: 'Purple', color: 'purple' }
          ].map(({ label, color }) => ({
            label,
            type: 'radio',
            checked: selectedTabColor === color,
            click: () => {
              if (!manager || !contextMenuTab) return

              for (const tab of contextMenuTabs) manager.setTabColor(tab.id, color)
            }
          }))
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: 'New Tab',
          visible: isTabBarContextMenu && contextMenuTab == null,
          click: () => {
            manager?.createTabWithPreference({ makeActive: true }).catch(error => {
              console.error('Failed to create a new tab from the tab bar context menu:', error)
            })
          }
        },
        {
          label: 'Reopen Closed Tab',
          visible: isTabBarContextMenu && contextMenuTab == null,
          enabled: manager?.closedTabs.length > 0,
          click: () => {
            manager?.restoreClosedTab()
          }
        },
        {
          label: isBulkTabAction ? 'Reload Tabs' : 'Reload Tab',
          visible: contextMenuTab != null,
          click: () => {
            if (!manager || !contextMenuTab) return

            for (const tab of contextMenuTabs) manager.requestReload(tab.id)
          }
        },
        {
          label: 'Load Tabs',
          visible: contextMenuTab != null && isBulkTabAction,
          enabled: hasSelectedUnloadedTab,
          click: () => {
            if (!manager || !contextMenuTab) return

            for (const tab of contextMenuTabs) manager.loadTab(tab.id)
          }
        },
        {
          label: isBulkTabAction ? 'Unload Tabs' : isContextMenuTabUnloaded ? 'Load Tab' : 'Unload Tab',
          visible: contextMenuTab != null,
          enabled: isBulkTabAction
            ? hasSelectedLoadedTab
            : contextMenuTab != null && (
              isContextMenuTabUnloaded ||
                (contextMenuTab.loadState !== 'unloaded' &&
                  (contextMenuTab.id !== manager?.activeTabId || (manager?.tabs.size ?? 0) > 1))
            ),
          click: async () => {
            if (!manager || !contextMenuTab) return

            if (!isBulkTabAction && isContextMenuTabUnloaded) {
              manager.loadTab(contextMenuTab.id)
              return
            }

            for (const tab of contextMenuTabs) {
              await manager.unloadTab(tab.id).catch(error => {
                console.error('Failed to unload tab:', error)
              })
            }
          }
        },
        {
          type: 'separator',
          visible: contextMenuTab != null && moveTargets.length > 0
        },
        {
          label: isBulkTabAction ? 'Move Tabs to Window' : 'Move Tab to Window',
          visible: contextMenuTab != null && moveTargets.length > 0,
          submenu: moveTargets.map(({ windowId, label }) => ({
            label,
            click: async () => {
              if (!contextMenuTab) {
                return
              }
              for (const tab of contextMenuTabs) {
                await TabManager.moveTabToWindow(tab.id, windowId)
              }
            }
          }))
        },
        {
          type: 'separator',
          visible: contextMenuTab != null
        },
        {
          label: 'Open in a New Tab',
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
          label: 'Open in a New Window',
          // Only show the option for in-app URLs and not external ones
          visible: isInAppUrl,
          click: () => {
            createWindow({ replaceMainWindow: false, windowStartupUrl: parameters.linkURL, showWindowNow: true })
          }
        },
        // Only show select all in text fields
        {
          label: 'Select All',
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
    append: (defaultActions, parameters, webContents) => {
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
      const textShortEnoughForSearch = selectionText.length <= SEARCH_CHAR_LIMIT

      return [
        {
          label: 'Copy Link',
          visible: visible && !isInAppUrl,
          click: () => {
            copy(parameters.linkURL)
          }
        },
        {
          label: 'Copy YouTube Link',
          visible: visible && isInAppUrl,
          click: () => {
            copy(transformOpenTubeXRouteUrl(urlParts[1], true))
          }
        },
        {
          label: 'Copy Invidious Link',
          visible: visible && isInAppUrl && (backendPreference === 'invidious' || backendFallback),
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
          label: textShortEnoughForSearch ? `Search "${selectionText}" in a New Tab` : `"${selectionText}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`,
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
          label: textShortEnoughForSearch ? `Search "${selectionText}" in a New Window` : `"${selectionText}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`,
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
      ]
    },
  }

  let contextMenuSessionId = 0
  /** @type {Map<number, { sessionId: number, actions: Map<string, Function> }>} */
  const contextMenuSessions = new Map()

  function createDefaultContextMenuActions(parameters, webContents) {
    const hasSelection = parameters.selectionText.length > 0
    const can = action => parameters.editFlags[`can${action}`] === true

    return {
      separator: () => ({ type: 'separator' }),
      cut: () => ({
        label: 'Cut',
        visible: parameters.isEditable,
        enabled: can('Cut') && hasSelection,
        click: () => webContents.cut()
      }),
      copy: () => ({
        label: 'Copy',
        visible: parameters.isEditable || hasSelection,
        enabled: can('Copy') && hasSelection,
        click: () => webContents.copy()
      }),
      paste: () => ({
        label: 'Paste',
        visible: parameters.isEditable,
        enabled: can('Paste'),
        click: () => webContents.paste()
      }),
      selectAll: () => ({
        label: 'Select All',
        click: () => webContents.selectAll()
      }),
      saveImageAs: () => ({
        label: 'Save Image As…',
        visible: parameters.mediaType === 'image',
        click: () => webContents.downloadURL(parameters.srcURL)
      }),
      copyImage: () => ({
        label: 'Copy Image',
        visible: parameters.mediaType === 'image',
        click: () => webContents.copyImageAt(parameters.x, parameters.y)
      }),
      copyImageAddress: () => ({
        label: 'Copy Image Address',
        visible: parameters.mediaType === 'image',
        click: () => clipboard.writeText(parameters.srcURL)
      })
    }
  }

  function removeUnusedContextMenuItems(items) {
    const visibleItems = items.filter(item => item && item.visible !== false)
    const cleanedItems = []

    for (const item of visibleItems) {
      if (item.type === 'separator' && (cleanedItems.length === 0 || cleanedItems.at(-1).type === 'separator')) {
        continue
      }
      cleanedItems.push(item)
    }

    if (cleanedItems.at(-1)?.type === 'separator') cleanedItems.pop()
    return cleanedItems
  }

  function serializeContextMenuItems(items, actions, actionPrefix = 'item') {
    return removeUnusedContextMenuItems(items).map((item, index) => {
      if (item.type === 'separator') return { type: 'separator' }

      const actionId = `${actionPrefix}-${index}`
      if (typeof item.click === 'function') actions.set(actionId, () => item.click(item))

      const submenu = Array.isArray(item.submenu)
        ? serializeContextMenuItems(item.submenu, actions, actionId)
        : undefined

      return {
        type: item.type ?? 'normal',
        label: String(item.label ?? ''),
        enabled: item.enabled !== false,
        checked: item.checked === true,
        actionId: typeof item.click === 'function' ? actionId : undefined,
        submenu
      }
    })
  }

  ipcMain.handle(IpcChannels.CONTEXT_MENU_OPEN, (event, rawParameters = {}) => {
    const webContents = event.sender
    const parameters = {
      x: Number.isFinite(rawParameters.x) ? rawParameters.x : 0,
      y: Number.isFinite(rawParameters.y) ? rawParameters.y : 0,
      pageURL: typeof rawParameters.pageURL === 'string' ? rawParameters.pageURL : '',
      linkURL: typeof rawParameters.linkURL === 'string' ? rawParameters.linkURL : '',
      linkText: typeof rawParameters.linkText === 'string' ? rawParameters.linkText : '',
      srcURL: typeof rawParameters.srcURL === 'string' ? rawParameters.srcURL : '',
      mediaType: ['image', 'video'].includes(rawParameters.mediaType) ? rawParameters.mediaType : 'none',
      selectionText: typeof rawParameters.selectionText === 'string' ? rawParameters.selectionText : '',
      isEditable: rawParameters.isEditable === true,
      editFlags: {
        canCut: rawParameters.editFlags?.canCut === true,
        canCopy: rawParameters.editFlags?.canCopy === true,
        canPaste: rawParameters.editFlags?.canPaste === true,
        canSelectAll: rawParameters.editFlags?.canSelectAll === true
      }
    }
    const defaultActions = createDefaultContextMenuActions(parameters, webContents)
    const defaultItems = [
      defaultActions.cut(),
      defaultActions.copy(),
      defaultActions.paste(),
      defaultActions.separator(),
      defaultActions.saveImageAs(),
      defaultActions.copyImage(),
      defaultActions.copyImageAddress(),
      defaultActions.separator()
    ]
    const items = [
      ...contextMenuOptions.prepend(defaultActions, parameters, webContents),
      ...defaultItems,
      ...contextMenuOptions.append(defaultActions, parameters, webContents)
    ]
    const actions = new Map()
    const sessionId = ++contextMenuSessionId
    const serializedItems = serializeContextMenuItems(items, actions)

    contextMenuSessions.set(webContents.id, { sessionId, actions })
    return { sessionId, items: serializedItems }
  })

  ipcMain.handle(IpcChannels.CONTEXT_MENU_EXECUTE, async (event, payload) => {
    const session = contextMenuSessions.get(event.sender.id)
    if (!session || payload?.sessionId !== session.sessionId) return

    const action = session.actions.get(payload?.actionId)
    if (action) await action()
  })

  if (process.platform === 'win32') {
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
  let tray = null
  let trayOnMinimize = false
  let trayWindows = []
  const trayMaximizedWindows = {}
  /** @type {Map<number, Array<{url: string, tabId: string | null}>>} */
  const pendingOpenUrlsByWebContentsId = new Map()
  const openUrlReadyWebContentsIds = new Set()
  const isTrayOnMinimizeSupported = process.platform !== 'darwin' && (process.platform !== 'linux' || app.commandLine.getSwitchValue('ozone-platform') !== 'wayland')

  const userDataPath = app.getPath('userData')

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

  const PLAYER_CACHE_PATH = `${userDataPath}/player_cache`

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
          if (mainWindow.isMinimized()) {
            if (isTrayOnMinimizeSupported && trayOnMinimize) {
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
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Window',
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

          return new Response(decompressed.buffer, {
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

    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!isOpenTubeXUrl(requestingOrigin)) {
        return false
      }

      return (
        permission === 'fullscreen' ||
        permission === 'clipboard-sanitized-write' ||
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
    let proxyProtocol = 'socks5'
    let proxyHostname = '127.0.0.1'
    let proxyPort = '9050'

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
          case 'hideToTrayOnMinimize':
            if (isTrayOnMinimizeSupported) {
              trayOnMinimize = doc.value
            }
            break
        }
      })
    }

    if (disableSmoothScrolling) {
      app.commandLine.appendSwitch('disable-smooth-scrolling')
    } else {
      app.commandLine.appendSwitch('enable-smooth-scrolling')
    }

    if (useProxy) {
      proxyUrl = `${proxyProtocol}://${proxyHostname}:${proxyPort}`

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
    session.defaultSession.webRequest.onBeforeSendHeaders(onBeforeSendHeadersRequestFilter, ({ requestHeaders, url, webContents }, callback) => {
      const urlObj = new URL(url)

      if (url.startsWith('https://www.youtube.com/youtubei/')) {
        // make InnerTube requests work with the fetch function
        // InnerTube rejects requests if the referer isn't YouTube or empty
        requestHeaders.Referer = 'https://www.youtube.com/'
        requestHeaders.Origin = 'https://www.youtube.com'

        requestHeaders['Sec-Fetch-Site'] = 'same-origin'
        requestHeaders['Sec-Fetch-Mode'] = 'same-origin'
        requestHeaders['X-Youtube-Bootstrap-Logged-In'] = 'false'
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

        if (invidiousAuthorization && url.startsWith(invidiousAuthorization.url)) {
          requestHeaders.Authorization = invidiousAuthorization.authorization
        }
      }

      // eslint-disable-next-line n/no-callback-literal
      callback({ requestHeaders })
    })

    // when we create a real session on the watch page, youtube returns tracking cookies, which we definitely don't want
    const trackingCookieRequestFilter = { urls: ['https://www.youtube.com/sw.js_data', 'https://www.youtube.com/iframe_api'] }

    session.defaultSession.webRequest.onHeadersReceived(trackingCookieRequestFilter, ({ responseHeaders }, callback) => {
      if (responseHeaders) {
        delete responseHeaders['set-cookie']
      }

      // eslint-disable-next-line n/no-callback-literal
      callback({ responseHeaders })
    })

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

            if (invidiousAuthorization && url.startsWith(invidiousAuthorization.url)) {
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

              const expiryTimestamp = extractExpiryTimestamp(response.headers)
              const mimeType = response.headers['content-type']

              imageCache.add(url, mimeType, data, expiryTimestamp)

              resolve(new Response(data, {
                headers: { 'content-type': mimeType }
              }))
            })

            response.on('error', (error) => {
              console.error('image cache error', error)
              reject(error)
            })
          })

          newRequest.on('error', (err) => {
            console.error(err)
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

    // Setup tab IPC handlers
    setupTabsIPC({
      confirmCloseWindow: (browserWindow) => {
        const isLastWindow = BrowserWindow.getAllWindows().length === 1
        return isLastWindow ? confirmCloseApp(browserWindow) : true
      },
      markWindowCloseConfirmed: (browserWindow) => {
        if (BrowserWindow.getAllWindows().length === 1) {
          closeConfirmedWindowIds.add(browserWindow.id)
        }
      }
    })

    // Restore every window that was open last time the app quit. Each window
    // has its own persisted session record, so a multi-window Ctrl+Q session
    // is fully rebuilt here (one window per saved session). If there are no
    // saved sessions yet, fall back to creating a single empty window.
    const startupBehavior = await getStartupBehavior()
    const shouldRestoreSession = startupBehavior !== 'emptySession'
    const savedSessions = shouldRestoreSession ? await loadAllTabSessions() : []

    if (!shouldRestoreSession) {
      await clearAllTabSessions()
    }

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
        restoreTabLoadStateOnRestore: startupBehavior === 'restoreTabLoadState'
      })
      for (let i = 1; i < savedSessions.length; i++) {
        await createWindow({
          replaceMainWindow: false,
          showWindowNow: true,
          sessionData: savedSessions[i],
          loadInactiveTabsOnRestore: startupBehavior === 'loadAllTabs',
          restoreTabLoadStateOnRestore: startupBehavior === 'restoreTabLoadState'
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

  function trayClick(window, close = false) {
    if (!close) {
      if (window.id in trayMaximizedWindows) {
        window.maximize()
      } else {
        window.show()

        // Calling hide() inside minimize is broken for some Linux distros (window minimizes again when trying to drag,
        // resize or maximize it, among other shenanigans). It seems to work as intended with this workaround.
        if (process.platform === 'linux') {
          window.hide()
          window.show()
        }
      }

      if (trayWindows.length === BrowserWindow.getAllWindows().length) { mainWindow = window }
    } else if (trayWindows.length > 0) {
      window.close()
    }

    trayWindows.splice(trayWindows.findIndex(item => item.id === window.id), 1)

    if (trayWindows.length > 0) {
      createTrayContextMenu()
    } else {
      destroyTray()
    }
  }

  function createTrayContextMenu() {
    const menuItems = []
    trayWindows.forEach(window => {
      menuItems.push({
        label: window.title,
        submenu: [
          {
            label: 'Show',
            click: () => trayClick(window)
          },
          {
            label: 'Close',
            click: () => trayClick(window, true)
          }
        ]
      })
    })

    menuItems.push(
      {
        type: 'separator'
      },
      ...defaultTrayMenu()
    )

    const menu = Menu.buildFromTemplate(menuItems)
    tray.setContextMenu(menu)
  }

  function defaultTrayMenu() {
    return [
      {
        label: 'New Window',
        click: () => createWindow({
          showWindowNow: true,
          replaceMainWindow: trayWindows.some(item => item.id === mainWindow.id)
        })
      },
      {
        label: 'Show All Windows',
        click: () => {
          // Use while loop instead of for loop as trayClick modifies the trayWindows array
          while (trayWindows.length > 0) {
            trayClick(trayWindows[0])
          }
        }
      },
      {
        label: 'Quit',
        click: () => requestQuit(BrowserWindow.getFocusedWindow() ?? mainWindow)
      }
    ]
  }

  function destroyTray() {
    if (!tray) return

    if (process.platform !== 'linux') {
      tray.destroy()
      tray = null
    } else {
      const menu = Menu.buildFromTemplate(defaultTrayMenu())
      tray.setContextMenu(menu)
    }
  }

  function showHiddenWindows() {
    trayWindows.forEach(window => {
      window.minimize()
    })

    destroyTray()
    trayWindows = []
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
      restoreTabLoadStateOnRestore = false
    } = { }) {
    // Syncing new window background to theme choice.
    const windowBackground = await baseHandlers.settings._findOne('baseTheme').then((setting) => {
      if (!setting) {
        return nativeTheme.shouldUseDarkColors ? '#212121' : '#f1f1f1'
      }

      // Determine window color to be shown (shown most prominently during initial app load)
      // Uses the --bg-color for each corresponding theme
      switch (setting.value) {
        case 'dark':
          return '#212121'
        case 'light':
          return '#f1f1f1'
        case 'black':
          return '#000000'
        case 'dracula':
          return '#282a36'
        case 'catppuccin-mocha':
          return '#1e1e2e'
        case 'pastel-pink':
          return '#ffd1dc'
        case 'hot-pink':
          return '#de1c85'
        case 'nordic':
          return '#2b2f3a'
        case 'solarized-dark':
          return '#002B36'
        case 'solarized-light':
          return '#fdf6e3'
        case 'gruvbox-dark':
          return '#282828'
        case 'gruvbox-light':
          return '#fbf1c7'
        case 'catppuccin-frappe':
          return '#303446'
        case 'everforest-dark-hard':
          return '#272e33'
        case 'everforest-dark-medium':
          return '#2d353b'
        case 'everforest-dark-low':
          return '#333c43'
        case 'everforest-light-hard':
          return '#fffbef'
        case 'everforest-light-medium':
          return '#fdf6e3'
        case 'everforest-light-low':
          return '#f3ead3'
        case 'catppuccin-latte':
          return '#eff1f5'
        case 'system':
        default:
          return nativeTheme.shouldUseDarkColors ? '#212121' : '#f1f1f1'
      }
    }).catch((error) => {
      console.error(error)
      // Default to nativeTheme settings if nothing is found.
      return nativeTheme.shouldUseDarkColors ? '#212121' : '#f1f1f1'
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

    const newWindow = new BrowserWindow({
      // Always wait for the shared renderer's first logical presentation. Even
      // explicitly requested windows otherwise expose a blank shell while the
      // initial container is mounting.
      show: false,
      backgroundColor: windowBackground,
      darkTheme: nativeTheme.shouldUseDarkColors,
      icon: process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../../_icons/iconColor.png')
        : path.join(__dirname, '../_icons/iconColor.png'),
      autoHideMenuBar: true,
      // useContentSize: true,
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
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
      windowBackground,
      sessionData?.sessionId
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

    if (isTrayOnMinimizeSupported) {
      function manageTray(window, removeWindow = false) {
        if (tray) {
          if (!removeWindow) {
            trayWindows.push(window)
            createTrayContextMenu()
          } else if (trayWindows.some(item => item.id === window.id)) {
            trayClick(window)
          }
        } else {
          const icon = process.env.NODE_ENV === 'development'
            ? path.join(__dirname, '..', '..', '_icons', 'iconColor.png')
            : path.join(__dirname, '..', '_icons', 'iconColor.png')

          tray = new Tray(icon)

          tray.setIgnoreDoubleClickEvents(true)
          tray.setToolTip('OpenTubeX')

          trayWindows = [window]
          createTrayContextMenu()

          if (process.platform !== 'linux') {
            tray.on('click', (event) => {
              if (trayWindows.length === 1) { trayClick(trayWindows[0]) }
            })
          }
        }
      }

      newWindow.on('minimize', () => {
        if (trayOnMinimize) {
          // Workaround for https://github.com/electron/electron/issues/49253
          if (process.platform === 'linux') {
            setTimeout(() => {
              newWindow.restore()
              newWindow.hide()
            }, 100)
          } else {
            newWindow.hide()
          }

          manageTray(newWindow)

          if (newWindow === mainWindow) {
            // A timer is needed because getFocusedWindow doesn't update until the minimize event ends
            setTimeout(() => {
              const newMainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(window => window.isVisible())
              if (newMainWindow) { mainWindow = newMainWindow }
            }, 100)
          }
        }
      })

      newWindow.on('maximize', () => {
        if (trayOnMinimize) { trayMaximizedWindows[newWindow.id] = true }
      })

      newWindow.on('unmaximize', () => {
        if (trayOnMinimize) { delete trayMaximizedWindows[newWindow.id] }
      })
    }

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

    const showWindow = () => {
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
        newWindow.show()
        newWindow.focus()
      }

      if (process.env.NODE_ENV === 'development') {
        newWindow.webContents.openDevTools({ activate: false })
      }
    }

    // Initialize tabs - try to restore session or create initial tab
    const initializeTabs = async () => {
      // Restore tabs from the pre-loaded session data if one was passed in
      // (the startup flow loads every window's session up-front so that each
      // window gets its own data).
      let sessionRestored = false
      if (!windowStartupUrl) {
        sessionRestored = await tabManager.restoreFromData(sessionData, {
          loadInactiveTabs: loadInactiveTabsOnRestore,
          restoreTabLoadState: restoreTabLoadStateOnRestore
        })
      }

      if (!sessionRestored) {
        // Create initial tab
        if (windowStartupUrl != null) {
          tabManager.createTab({ url: windowStartupUrl, makeActive: true })
        } else {
          tabManager.createTab({ url: ROOT_APP_URL, makeActive: true })
        }
      }

      // Load the shared Vue shell exactly once. Logical tab routes are projected
      // by the renderer after it reconciles the main-owned metadata.
      await newWindow.loadURL(ROOT_APP_URL)
      await tabManager.waitForInitialPresentation()
      if (typeof searchQueryText === 'string' && searchQueryText.length > 0) {
        newWindow.webContents.send(IpcChannels.UPDATE_SEARCH_INPUT_TEXT, searchQueryText)
      }
      showWindow()
    }

    // Kick off tab initialization (errors are logged but shouldn't crash the app)
    initializeTabs().catch(error => {
      console.error('Failed to initialize tabs', error)
      showWindow()
    })

    // Renderer presentation readiness above has a bounded timeout, so the
    // window cannot remain hidden if the initial logical tab fails to mount.

    newWindow.on('enter-html-full-screen', () => {
      htmlFullscreenWindowIds.add(newWindow.id)
    })

    newWindow.on('leave-html-full-screen', () => {
      htmlFullscreenWindowIds.delete(newWindow.id)
    })

    newWindow.on('close', async (event) => {
      const isLastWindow = BrowserWindow.getAllWindows().length === 1

      if (!isQuitting && isLastWindow && !closeConfirmedWindowIds.delete(newWindow.id)) {
        event.preventDefault()

        if (await confirmCloseApp(newWindow)) {
          closeConfirmedWindowIds.add(newWindow.id)
          newWindow.close()
        }

        return
      }

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

    newWindow.once('closed', () => {
      const allWindows = BrowserWindow.getAllWindows()
      if (allWindows.length !== 0 && newWindow === mainWindow) {
        // Replace mainWindow to avoid accessing `mainWindow.webContents`
        // Which raises "Object has been destroyed" error
        mainWindow = allWindows[0]
      }

      stopPowerSaveBlockerForWindow(newWindow)
    })

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

  /**
   * @param {import('electron').BrowserWindow | undefined | null} browserWindow
   * @param {string | null | undefined} url
   * @param {{ reuseEmptyRootTab?: boolean }} [options]
   */
  function openUrlInWindow(browserWindow, url, options = {}) {
    if (!browserWindow || browserWindow.isDestroyed() || !url) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager) {
      openUrlInTab(tabManager, url, options).catch(error => {
        console.error('Failed to open URL in a tab:', error)
      })
      return
    }

    sendOpenUrlToWebContents(browserWindow.webContents, url)
  }

  /**
   * @param {TabManager} tabManager
   * @param {string} url
   * @param {{ reuseEmptyRootTab?: boolean }} options
   */
  async function openUrlInTab(tabManager, url, options) {
    const directOpenUrl = getDirectOpenUrl(url)
    if (directOpenUrl) {
      await tabManager.createTabWithPreference({
        url: directOpenUrl,
        makeActive: true
      })
      return
    }

    let tab = options.reuseEmptyRootTab ? getReusableOpenUrlTab(tabManager) : null

    if (!tab) {
      tab = await tabManager.createTabWithPreference({
        url: ROOT_APP_URL,
        makeActive: true
      })
    }

    sendOpenUrlToWebContents(tabManager.browserWindow.webContents, url, tab.id)
  }

  /**
   * @param {TabManager} tabManager
   * @returns {import('./tabs/TabManager').TabInfo | null}
   */
  function getReusableOpenUrlTab(tabManager) {
    if (tabManager.tabs.size !== 1 || !tabManager.activeTabId) {
      return null
    }

    const activeTab = tabManager.tabs.get(tabManager.activeTabId)
    return activeTab && TabManager.getOpenTubeXRoute(activeTab.url) === '/'
      ? activeTab
      : null
  }

  /**
   * @param {string | null | undefined} url
   * @returns {string | null}
   */
  function getDirectOpenUrl(url) {
    if (typeof url !== 'string' || url.trim().length === 0) {
      return null
    }

    const parsed = URL.parse(url)
    if (!parsed) {
      return null
    }

    if (isOpenTubeXUrl(parsed)) {
      return url
    }

    const videoParams = getDirectVideoParams(parsed)
    if (videoParams.videoId) {
      return createAppRouteUrl(`/watch/${videoParams.videoId}`, {
        timestamp: videoParams.timestamp,
        playlistId: videoParams.playlistId
      })
    }

    const playlistId = getDirectPlaylistId(parsed)
    if (playlistId) {
      return createAppRouteUrl(`/playlist/${encodeURIComponent(playlistId)}`, getRemainingUrlQuery(parsed, ['list']))
    }

    const searchQuery = getDirectSearchQuery(parsed)
    if (searchQuery) {
      return createAppRouteUrl(`/search/${encodeURIComponent(searchQuery)}`, getRemainingUrlQuery(parsed, ['q', 'search_query']))
    }

    const hashtag = parsed.pathname.match(/^\/hashtag\/(?<tag>[^#&/?]+)\/?$/)?.groups?.tag
    if (hashtag) {
      return createAppRouteUrl(`/hashtag/${encodeURIComponent(hashtag)}`)
    }

    const postId = parsed.pathname.match(/^\/post\/(?<postId>.+)/)?.groups?.postId
    if (postId) {
      return createAppRouteUrl(`/post/${encodeURIComponent(postId)}`, {
        authorId: parsed.searchParams.get('ucid')
      })
    }

    const feedType = parsed.pathname.match(/^\/feed\/(?<type>trending|subscriptions|history|playlists|you|library)/)?.groups?.type
    if (feedType) {
      return createAppRouteUrl(feedType === 'playlists' || feedType === 'you' || feedType === 'library'
        ? '/userplaylists'
        : `/${feedType}`)
    }

    return null
  }

  /**
   * @param {URL} url
   * @returns {{ videoId: string | null, timestamp: string | null, playlistId: string | null }}
   */
  function getDirectVideoParams(url) {
    const params = {
      videoId: null,
      timestamp: null,
      playlistId: null
    }

    const setVideoId = (value) => {
      const videoId = getYoutubeId(value)
      if (videoId) {
        params.videoId = videoId
        params.timestamp = getDirectTimestamp(url)
        params.playlistId = url.searchParams.get('list')
      }
    }

    if (url.pathname === '/watch') {
      setVideoId(url.searchParams.get('v'))
    } else if (url.hostname === 'youtu.be') {
      setVideoId(url.pathname.slice(1))
    } else {
      const videoPath = url.pathname.match(/^\/(?:embed|shorts|live)\/(?<videoId>[\w-]+)/)?.groups?.videoId
      setVideoId(videoPath)
    }

    return params
  }

  /**
   * @param {string | null | undefined} value
   * @returns {string | null}
   */
  function getYoutubeId(value) {
    return typeof value === 'string'
      ? value.match(/^[\w-]{11}/)?.[0] ?? null
      : null
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectTimestamp(url) {
    const timestamp = url.searchParams.get('t')
    if (!timestamp) {
      return null
    }

    const timeParts = timestamp.match(/^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s?)?$/)?.groups
    if (!timeParts || (!timeParts.hours && !timeParts.minutes && !timeParts.seconds)) {
      return timestamp
    }

    return String(
      Number(timeParts.seconds ?? 0) +
      (Number(timeParts.minutes ?? 0) * 60) +
      (Number(timeParts.hours ?? 0) * 3600)
    )
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectPlaylistId(url) {
    if (!/^(\/playlist\/?|\/embed\/videoseries\/?)$/.test(url.pathname)) {
      return null
    }

    return url.searchParams.get('list')
  }

  /**
   * @param {URL} url
   * @returns {string | null}
   */
  function getDirectSearchQuery(url) {
    if (!/^(\/results|\/search\/?)$/.test(url.pathname)) {
      return null
    }

    return url.searchParams.get('search_query') ?? url.searchParams.get('q')
  }

  /**
   * @param {URL} url
   * @param {string[]} excludedKeys
   * @returns {Record<string, string>}
   */
  function getRemainingUrlQuery(url, excludedKeys) {
    const excluded = new Set(excludedKeys)
    const query = {}

    for (const [key, value] of url.searchParams) {
      if (!excluded.has(key)) {
        query[key] = value
      }
    }

    return query
  }

  /**
   * @param {string} path
   * @param {Record<string, string | number | null | undefined>} [query]
   * @returns {string}
   */
  function createAppRouteUrl(path, query = {}) {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && String(value).length > 0) {
        searchParams.set(key, String(value))
      }
    }

    const search = searchParams.toString()
    return `${ROOT_APP_URL}#${path}${search.length > 0 ? `?${search}` : ''}`
  }

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string} url
   * @param {string | null} [tabId]
   * @returns {boolean}
   */
  function sendOpenUrlToWebContents(webContents, url, tabId = null) {
    const payload = { url, tabId }
    if (
      !webContents.isDestroyed() &&
      openUrlReadyWebContentsIds.has(webContents.id) &&
      isOpenTubeXUrl(webContents.getURL())
    ) {
      webContents.send(IpcChannels.OPEN_URL, payload)
      return true
    }

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(webContents.id) ?? []
    pendingOpenUrls.push(payload)
    // Protocol activations are user-driven, but keep the startup queue bounded
    // in case a desktop environment repeatedly delivers the same URL.
    if (pendingOpenUrls.length > 20) {
      pendingOpenUrls.shift()
    }
    pendingOpenUrlsByWebContentsId.set(webContents.id, pendingOpenUrls)
    return false
  }

  /**
   * @param {import('electron').IpcMainEvent} event
   */
  function openPendingUrlForReadyWebContents(event) {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    openUrlReadyWebContentsIds.add(event.sender.id)

    const pendingOpenUrls = pendingOpenUrlsByWebContentsId.get(event.sender.id)
    if (!pendingOpenUrls || !BrowserWindow.fromWebContents(event.sender)) {
      return
    }

    pendingOpenUrlsByWebContentsId.delete(event.sender.id)
    for (const pendingOpenUrl of pendingOpenUrls) {
      event.reply(IpcChannels.OPEN_URL, pendingOpenUrl)
    }
  }

  ipcMain.on(IpcChannels.APP_READY, (event) => {
    openPendingUrlForReadyWebContents(event)
  })

  ipcMain.on(IpcChannels.SHOW_TOAST, (event, message, time) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      typeof message !== 'string' ||
      (time !== null && typeof time !== 'number')
    ) {
      return
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SHOW_TOAST, message, time)
      }
    }
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE, async (event, tabId, feedTab) => {
    const canAcquire = () => {
      const manager = TabManager.getFromWebContents(event.sender)
      return manager != null &&
        typeof tabId === 'string' &&
        manager.activeTabId === tabId &&
        !event.sender.isDestroyed() &&
        isOpenTubeXUrl(event.senderFrame.url)
    }

    if (!canAcquire()) {
      return false
    }

    const activeIpBlockRecovery = ipBlockRecoveryScriptPromise
    if (activeIpBlockRecovery != null) {
      try {
        await activeIpBlockRecovery
      } catch {
        // Refresh after the recovery attempt finishes, even when it failed.
      }
    }

    if (
      !canAcquire() ||
      (subscriptionAutoRefreshOwner && !subscriptionAutoRefreshOwner.webContents.isDestroyed())
    ) {
      return false
    }

    const owner = event.sender
    subscriptionAutoRefreshOwner = {
      webContents: owner,
      tabId,
      feedTab: typeof feedTab === 'string' ? feedTab : null
    }
    subscriptionAutoRefreshProgress = 0
    owner.once('destroyed', () => {
      if (subscriptionAutoRefreshOwner?.webContents.id === owner.id) {
        subscriptionAutoRefreshOwner = null
        subscriptionAutoRefreshProgress = 0
        broadcastSubscriptionAutoRefreshState()
      }
    })
    broadcastSubscriptionAutoRefreshState()
    return true
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_GET_STATE, (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return { inProgress: false, percentage: 0, tab: null }
    }

    return {
      inProgress: subscriptionAutoRefreshOwner !== null && !subscriptionAutoRefreshOwner.webContents.isDestroyed(),
      percentage: subscriptionAutoRefreshProgress,
      tab: subscriptionAutoRefreshOwner?.feedTab ?? null
    }
  })

  ipcMain.on(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_SET_PROGRESS, (event, tabId, percentage) => {
    if (
      subscriptionAutoRefreshOwner?.webContents.id !== event.sender.id ||
      subscriptionAutoRefreshOwner?.tabId !== tabId ||
      !Number.isFinite(percentage)
    ) {
      return
    }

    subscriptionAutoRefreshProgress = Math.min(100, Math.max(0, percentage))
    broadcastSubscriptionAutoRefreshState()
  })

  ipcMain.handle(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE, (event, tabId) => {
    if (
      subscriptionAutoRefreshOwner?.webContents.id === event.sender.id &&
      subscriptionAutoRefreshOwner?.tabId === tabId
    ) {
      subscriptionAutoRefreshOwner = null
      subscriptionAutoRefreshProgress = 0
      broadcastSubscriptionAutoRefreshState()
    }
  })

  function broadcastSubscriptionAutoRefreshState() {
    const state = {
      inProgress: subscriptionAutoRefreshOwner !== null && !subscriptionAutoRefreshOwner.webContents.isDestroyed(),
      percentage: subscriptionAutoRefreshProgress,
      tab: subscriptionAutoRefreshOwner?.feedTab ?? null
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed() && isOpenTubeXUrl(window.webContents.getURL())) {
        window.webContents.send(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED, state)
      }
    }
  }

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

  ipcMain.handle(IpcChannels.GENERATE_PO_TOKEN, (event, videoId, context) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return generatePoToken(videoId, context, proxyUrl)
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

  ipcMain.handle(IpcChannels.GET_SYSTEM_LOCALE, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      // we should switch to getPreferredSystemLanguages at some point and iterate through until we find a supported locale
      return app.getSystemLocale()
    }
  })

  ipcMain.handle(IpcChannels.IS_WAYLAND_PLATFORM, (event) => {
    if (isOpenTubeXUrl(event.senderFrame.url)) {
      return app.commandLine.getSwitchValue('ozone-platform') === 'wayland'
    }
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

  /**
   * @param {import('electron').WebContents} webContents
   * @param {string | undefined} [currentPath]
   * @returns {Promise<string | undefined>}
   */
  async function chooseIpBlockRecoveryScript(webContents, currentPath) {
    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    /** @type {import('electron').FileFilter[]} */
    const filters = process.platform === 'win32'
      ? [
          { name: 'Windows Script Files', extensions: ['bat', 'ps1', 'vbs'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      : [
          { name: 'Shell Script Files', extensions: ['sh'] },
          { name: 'All Files', extensions: ['*'] }
        ]

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters
    }

    const window = BrowserWindow.fromWebContents(webContents)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  }

  ipcMain.on(IpcChannels.CHOOSE_DEFAULT_FOLDER, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    const currentPath = (await baseHandlers.settings._findOne('screenshotFolderPath'))?.value

    await chooseDefaultFolder(event.sender, currentPath)
  })

  ipcMain.handle(IpcChannels.CHOOSE_IP_BLOCK_RECOVERY_SCRIPT, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    return await chooseIpBlockRecoveryScript(event.sender, currentPath)
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

  /**
   * @param {string} scriptPath
   * @returns {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
   */
  async function executeIpBlockRecoveryScript(scriptPath) {
    const normalizedPath = path.normalize(path.resolve(scriptPath))
    const maxOutputLength = 16_384

    return new Promise((resolve, reject) => {
      const child = cp.spawn(normalizedPath, [], {
        shell: process.platform === 'win32',
        windowsHide: true
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
        if (stdout.length > maxOutputLength) {
          stdout = stdout.slice(-maxOutputLength)
        }
      })

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
        if (stderr.length > maxOutputLength) {
          stderr = stderr.slice(-maxOutputLength)
        }
      })

      child.once('error', (error) => {
        reject(error)
      })

      child.once('close', (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          stdout,
          stderr
        })
      })
    })
  }

  const ipBlockRecoveryScriptCooldownMs = 10_000

  /**
   * @param {string} scriptPath
   * @returns {boolean} whether a new run was started
   */
  function startIpBlockRecoveryScript(scriptPath) {
    if (ipBlockRecoveryScriptPromise != null) {
      return false
    }

    ipBlockRecoveryScriptPromise = executeIpBlockRecoveryScript(scriptPath)
      .finally(() => {
        setTimeout(() => {
          ipBlockRecoveryScriptPromise = null
        }, ipBlockRecoveryScriptCooldownMs)
      })

    // The execute handler still observes and forwards the rejection. Attaching a
    // handler here prevents a fast spawn failure from becoming unhandled before
    // the renderer has time to invoke it.
    ipBlockRecoveryScriptPromise.catch(() => {})
    return true
  }

  /**
   * @param {import('electron').IpcMainInvokeEvent} event
   * @param {unknown} scriptPath
   * @returns {scriptPath is string}
   */
  function isValidIpBlockRecoveryRequest(event, scriptPath) {
    return isOpenTubeXUrl(event.senderFrame.url) &&
      typeof scriptPath === 'string' &&
      scriptPath.trim().length > 0
  }

  ipcMain.handle(IpcChannels.START_IP_BLOCK_RECOVERY_SCRIPT, (event, scriptPath) => {
    if (!isValidIpBlockRecoveryRequest(event, scriptPath)) {
      return false
    }

    return startIpBlockRecoveryScript(scriptPath)
  })

  ipcMain.handle(IpcChannels.EXECUTE_IP_BLOCK_RECOVERY_SCRIPT, async (event, scriptPath) => {
    if (
      !isValidIpBlockRecoveryRequest(event, scriptPath)
    ) {
      return
    }

    try {
      startIpBlockRecoveryScript(scriptPath)

      return await ipBlockRecoveryScriptPromise
    } catch (error) {
      console.error('EXECUTE_IP_BLOCK_RECOVERY_SCRIPT failed', error)
      throw new Error('Failed to execute script', { cause: error })
    }
  })

  ipcMain.handle(IpcChannels.WAIT_FOR_IP_BLOCK_RECOVERY_SCRIPT, async (event) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      await ipBlockRecoveryScriptPromise
    } catch {
      // Resume subscription fetching after the recovery attempt finishes.
    }
  })

  /** @type {Map<number, number>} */
  const activePowerSaveBlockers = new Map()

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

    let windowStartupUrl = `${ROOT_APP_URL}#${path}`

    if (query) {
      windowStartupUrl += '?' + new URLSearchParams(query).toString()
    }

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

  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD, handleYtDlpDownload)

  ipcMain.on(IpcChannels.YT_DLP_CANCEL_DOWNLOAD, handleYtDlpCancelDownload)

  ipcMain.handle(IpcChannels.YT_DLP_GET_INFO, handleYtDlpGetInfo)

  ipcMain.handle(IpcChannels.YT_DLP_DOWNLOAD_BINARY, handleYtDlpDownloadBinary)

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_EXECUTABLE, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('home')
    }

    /** @type {import('electron').FileFilter[]} */
    const filters = process.platform === 'win32'
      ? [
          { name: 'Executable Files', extensions: ['exe'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      : [{ name: 'All Files', extensions: ['*'] }]

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openFile'],
      filters
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER, async (event, currentPath) => {
    if (
      !isOpenTubeXUrl(event.senderFrame.url) ||
      (currentPath != null && typeof currentPath !== 'string')
    ) {
      return
    }

    if (typeof currentPath !== 'string' || currentPath.length === 0) {
      currentPath = app.getPath('downloads')
    }

    const dialogOptions = {
      defaultPath: currentPath,
      properties: ['openDirectory']
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }

    return result.filePaths[0]
  })

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

  // ************************************************* //
  // DB related IPC calls
  // *********** //

  // Settings
  ipcMain.handle(IpcChannels.DB_SETTINGS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.settings.find()

        case DBActions.GENERAL.UPSERT:
          // This one is only allowed to be changed by the CHOOSE_DEFAULT_FOLDER IPC action
          // to avoid the "write to default folder" IPC calls being abused to write to arbitrary locations
          if (data._id === 'screenshotFolderPath') {
            return null
          }

          await baseHandlers.settings.upsert(data._id, data.value)
          syncOtherWindows(
            IpcChannels.SYNC_SETTINGS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
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
            case 'hideTrendingVideos':
            case 'hidePopularVideos':
            case 'hidePlaylists':
            case 'keyboardShortcuts':
              await setMenu()
              break
            case 'hideToTrayOnMinimize':
              if (isTrayOnMinimizeSupported) {
                trayOnMinimize = data.value
                if (!trayOnMinimize) { showHiddenWindows() }
              }
              break

            default:
              // Do nothing for unmatched settings
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
  ipcMain.handle(IpcChannels.DB_HISTORY, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
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
          await baseHandlers.history.overwrite(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.GENERAL.OVERWRITE, data }
          )
          return null

        case DBActions.HISTORY.APPLY_SYNC_CHANGES:
          await baseHandlers.history.applySyncChanges(data)
          syncOtherWindows(
            IpcChannels.SYNC_HISTORY,
            event,
            { event: SyncEvents.HISTORY.APPLY_SYNC_CHANGES, data }
          )
          return null

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
  // Watch Stats
  ipcMain.handle(IpcChannels.DB_WATCH_STATS, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.watchStats.find()

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
  ipcMain.handle(IpcChannels.DB_PROFILES, async (event, { action, data }) => {
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
  ipcMain.handle(IpcChannels.DB_PLAYLISTS, async (event, { action, data }) => {
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
          await baseHandlers.playlists.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

        case DBActions.PLAYLISTS.UPSERT_VIDEO:
          await baseHandlers.playlists.upsertVideoByPlaylistId(data._id, data.lastUpdatedAt, data.videoData)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.UPSERT_VIDEO, data }
          )
          return null

        case DBActions.PLAYLISTS.UPSERT_VIDEOS:
          await baseHandlers.playlists.upsertVideosByPlaylistId(data._id, data.lastUpdatedAt, data.videos)
          syncOtherWindows(
            IpcChannels.SYNC_PLAYLISTS,
            event,
            { event: SyncEvents.PLAYLISTS.UPSERT_VIDEOS, data }
          )
          return null

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
  ipcMain.handle(IpcChannels.DB_SEARCH_HISTORY, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.searchHistory.find()

        case DBActions.GENERAL.UPSERT:
          await baseHandlers.searchHistory.upsert(data)
          syncOtherWindows(
            IpcChannels.SYNC_SEARCH_HISTORY,
            event,
            { event: SyncEvents.GENERAL.UPSERT, data }
          )
          return null

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
  ipcMain.handle(IpcChannels.DB_SUBSCRIPTION_CACHE, async (event, { action, data }) => {
    if (!isOpenTubeXUrl(event.senderFrame.url)) {
      return
    }

    try {
      switch (action) {
        case DBActions.GENERAL.FIND:
          return await baseHandlers.subscriptionCache.find()

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
          await baseHandlers.subscriptionCache.updateVideosByChannelId(data.channelId, data.entries, data.timestamp)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
          await baseHandlers.subscriptionCache.updateLiveStreamsByChannelId(data.channelId, data.entries, data.timestamp)
          syncOtherWindows(
            IpcChannels.SYNC_SUBSCRIPTION_CACHE,
            event,
            { event: SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL, data }
          )
          return null

        case DBActions.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
          await baseHandlers.subscriptionCache.updateShortsByChannelId(data.channelId, data.entries, data.timestamp)
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
          await baseHandlers.subscriptionCache.updateCommunityPostsByChannelId(data.channelId, data.entries, data.timestamp)
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
    if (process.platform !== 'darwin' && tray) { tray.destroy() }
  })

  app.on('window-all-closed', () => {
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
      baseHandlers.compactAllDatastores(),
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
        openUrlReadyWebContentsIds.delete(webContents.id)
      }
    })

    webContents.once('destroyed', () => {
      contextMenuSessions.delete(webContents.id)
      pendingOpenUrlsByWebContentsId.delete(webContents.id)
      openUrlReadyWebContentsIds.delete(webContents.id)
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

  function navigateTo(path, browserWindow) {
    if (browserWindow == null) {
      return
    }

    const tabManager = TabManager.getForWindow(browserWindow.id)
    if (tabManager?.activeTabId && isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, {
        tabId: tabManager.activeTabId,
        route: path
      })
    } else if (isOpenTubeXUrl(browserWindow.webContents.getURL())) {
      browserWindow.webContents.send(IpcChannels.CHANGE_VIEW, path)
    }
  }

  async function setMenu() {
    const sidenavSettings = baseHandlers.settings._findSidenavSettings()
    const keyboardShortcutsSetting = await baseHandlers.settings._findOne('keyboardShortcuts')
    const keyboardShortcuts = getConfiguredKeyboardShortcuts(keyboardShortcutsSetting?.value)
    const hideTrendingVideos = (await sidenavSettings.hideTrendingVideos)?.value
    const hidePopularVideos = (await sidenavSettings.hidePopularVideos)?.value
    const hidePlaylists = (await sidenavSettings.hidePlaylists)?.value

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
            click: (_menuItem, _browserWindow, _event) => {
              createWindow({
                replaceMainWindow: false,
                showWindowNow: true
              })
            },
            type: 'normal'
          },
          { type: 'separator' },
          {
            label: 'Preferences',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_SETTINGS),
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/settings', browserWindow)
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
            click: (_menuItem, browserWindow) => browserWindow?.webContents.toggleDevTools()
          },
          {
            label: 'Enter Inspect Element Mode',
            accelerator: 'CmdOrCtrl+Shift+C',
            click: (_, window) => {
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
            click: (_menuItem, browserWindow) => browserWindow?.webContents.setZoomLevel(0)
          },
          {
            label: 'Zoom In',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.ZOOM_IN),
            click: (_menuItem, browserWindow) => {
              if (browserWindow) {
                browserWindow.webContents.setZoomLevel(browserWindow.webContents.getZoomLevel() + 0.5)
              }
            }
          },
          {
            label: 'Zoom Out',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.ZOOM_OUT),
            click: (_menuItem, browserWindow) => {
              if (browserWindow) {
                browserWindow.webContents.setZoomLevel(browserWindow.webContents.getZoomLevel() - 0.5)
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Toggle Full Screen',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.FULLSCREEN),
            click: (_menuItem, browserWindow) => {
              browserWindow?.setFullScreen(!browserWindow.isFullScreen())
            }
          },
          { type: 'separator' },
          {
            label: 'Back',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.HISTORY_BACKWARD),
            click: (_menuItem, browserWindow, _event) => {
              if (browserWindow == null) { return }

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
                    if (browserWindow == null) { return }

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
              if (browserWindow == null) { return }

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
                    if (browserWindow == null) { return }

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
          (!hideTrendingVideos && (backendFallback || backendPreference === 'local')) && {
            label: 'Trending',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/trending', browserWindow)
            },
            type: 'normal'
          },
          (!hidePopularVideos && (backendFallback || backendPreference === 'invidious')) && {
            label: 'Most Popular',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/popular', browserWindow)
            },
            type: 'normal'
          },
          !hidePlaylists && {
            label: 'Playlists',
            click: (_menuItem, browserWindow, _event) => {
              navigateTo('/userplaylists', browserWindow)
            },
            type: 'normal'
          },
          {
            label: 'History',
            accelerator: getElectronAccelerator(process.platform === 'darwin'
              ? keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY_MAC
              : keyboardShortcuts.APP.GENERAL.NAVIGATE_TO_HISTORY),
            click: (_menuItem, browserWindow, _event) => {
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
              if (browserWindow) {
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
            click: (_menuItem, browserWindow) => {
              if (browserWindow) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager && tabManager.activeTabId) {
                  const hasRemainingTabs = tabManager.closeTab(tabManager.activeTabId)
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
            click: (_menuItem, browserWindow) => {
              if (browserWindow) {
                const tabManager = TabManager.getForWindow(browserWindow.id)
                if (tabManager) {
                  tabManager.requestReload()
                }
              }
            }
          },
          {
            label: 'Reopen Closed Tab',
            accelerator: getElectronAccelerator(keyboardShortcuts.APP.GENERAL.RESTORE_CLOSED_TAB),
            click: (_menuItem, browserWindow) => {
              if (browserWindow) {
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
              if (browserWindow) {
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
              if (browserWindow) {
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
            click: (_menuItem, browserWindow) => browserWindow?.minimize()
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
