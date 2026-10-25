import { BrowserWindow, clipboard, ipcMain, net, shell } from 'electron'

import { IpcChannels } from '../constants'
import * as baseHandlers from '../datastores/handlers/base'
import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from '../renderer/helpers/share'
import {
  buildSearchUrl,
  DEFAULT_SEARCH_ENGINES_SETTING,
  getFaviconUrl,
  parseSearchEngines
} from '../searchEngines'
import { fetchFaviconDataUrl, resolveFaviconUrl } from './favicon'
import {
  isSubscriptionAutoRefreshInProgress,
  requestSubscriptionAutoRefreshCancellation
} from './subscriptionAutoRefresh'
import { TabManager } from './tabs/TabManager'
import { isOpenTubeXUrl } from './utils'

const sharedContextMenuLabelKeys = {
  Blue: 'Settings.Theme Settings.Main Color Theme.Blue',
  'Close Tab': 'Close Tab',
  Copy: 'Copy',
  Cut: 'Cut',
  Green: 'Settings.Theme Settings.Main Color Theme.Green',
  'Mark All as Seen': 'Subscriptions.Mark All as Seen',
  'New Tab': 'New Tab',
  'New Window': 'New Window',
  Orange: 'Settings.Theme Settings.Main Color Theme.Orange',
  Paste: 'Paste',
  Pink: 'Settings.Theme Settings.Main Color Theme.Pink',
  Red: 'Settings.Theme Settings.Main Color Theme.Red',
  Ungrouped: 'Tab Organizer.Ungrouped',
  Yellow: 'Settings.Theme Settings.Main Color Theme.Yellow'
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [parameters]
 * @param {string} [fallback]
 * @returns {{ key: string, parameters: Record<string, string | number>, fallback: string }}
 */
export function contextMenuLabel(key, parameters = {}, fallback = key) {
  return {
    key: sharedContextMenuLabelKeys[key] ?? `Context Menu.${key}`,
    parameters,
    fallback
  }
}

// Keep the interpolated selection short, so that the surrounding translated text
// (e.g. the trailing "in a New Tab") stays readable instead of being cut off
const SELECTION_LABEL_MAX_LENGTH = 30

// Counting grapheme clusters rather than UTF-16 code units, so that the cut
// never lands inside an emoji or a combining character sequence
const selectionLabelSegmenter = new Intl.Segmenter()

/**
 * @param {string} text
 */
export function truncateSelectionForLabel(text) {
  const graphemes = []
  for (const { segment } of selectionLabelSegmenter.segment(text)) {
    if (graphemes.length === SELECTION_LABEL_MAX_LENGTH) {
      return `${graphemes.join('').trimEnd()}…`
    }
    graphemes.push(segment)
  }

  return text
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

function createDefaultContextMenuActions(parameters, webContents) {
  const hasSelection = parameters.selectionText.length > 0
  const can = action => parameters.editFlags[`can${action}`] === true

  return {
    separator: () => ({ type: 'separator' }),
    cut: () => ({
      label: contextMenuLabel('Cut'),
      visible: parameters.isEditable,
      enabled: can('Cut') && hasSelection,
      click: () => webContents.cut()
    }),
    copy: () => ({
      label: contextMenuLabel('Copy'),
      visible: parameters.isEditable || hasSelection,
      enabled: can('Copy') && hasSelection,
      click: () => webContents.copy()
    }),
    paste: () => ({
      label: contextMenuLabel('Paste'),
      visible: parameters.isEditable,
      enabled: can('Paste'),
      click: () => webContents.paste()
    }),
    selectAll: () => ({
      label: contextMenuLabel('Select All'),
      click: () => webContents.selectAll()
    }),
    saveImageAs: () => ({
      label: contextMenuLabel('Save Image As…'),
      visible: parameters.mediaType === 'image',
      click: () => webContents.downloadURL(parameters.srcURL)
    }),
    copyImage: () => ({
      label: contextMenuLabel('Copy Image'),
      visible: parameters.mediaType === 'image',
      click: () => webContents.copyImageAt(parameters.x, parameters.y)
    }),
    copyImageAddress: () => ({
      label: contextMenuLabel('Copy Image Address'),
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

/**
 * @param {unknown} label
 * @returns {{ text: string, key: string | undefined, parameters: unknown }}
 */
function serializeContextMenuLabel(label) {
  if (
    label != null &&
    typeof label === 'object' &&
    typeof label.key === 'string' &&
    typeof label.fallback === 'string'
  ) {
    return {
      text: label.fallback,
      key: label.key,
      parameters: label.parameters
    }
  }

  return {
    text: String(label ?? ''),
    key: undefined,
    parameters: undefined
  }
}

function serializeContextMenuItems(items, actions, actionPrefix = 'item') {
  return removeUnusedContextMenuItems(items).map((item, index) => {
    if (item.type === 'separator') return { type: 'separator' }

    const actionId = `${actionPrefix}-${index}`
    const hasAction = item.enabled !== false && typeof item.click === 'function'
    if (hasAction) actions.set(actionId, () => item.click(item))

    const submenu = Array.isArray(item.submenu)
      ? serializeContextMenuItems(item.submenu, actions, actionId)
      : undefined
    const label = serializeContextMenuLabel(item.label)
    const refreshingLabel = item.refreshingLabel == null
      ? null
      : serializeContextMenuLabel(item.refreshingLabel)

    return {
      type: item.type ?? 'normal',
      label: label.text,
      labelKey: label.key,
      labelParameters: label.parameters,
      // Shown instead of the label while a subscription refresh is running,
      // so that an open menu doesn't go stale when the refresh ends
      refreshingLabel: refreshingLabel?.text,
      refreshingLabelKey: refreshingLabel?.key,
      refreshingLabelParameters: refreshingLabel?.parameters,
      enabled: item.enabled !== false,
      checked: item.checked === true,
      icon: typeof item.icon === 'string' ? item.icon : undefined,
      groupColor: typeof item.groupColor === 'string' ? item.groupColor : undefined,
      faviconSource: typeof item.faviconSource === 'string' ? item.faviconSource : undefined,
      actionId: hasAction ? actionId : undefined,
      submenu
    }
  })
}

/**
 * Builds context menus in the main process, where the targeted tabs and
 * windows live, for the renderer to draw. The renderer runs a chosen item by
 * its action ID, which only stays valid until the next menu opens.
 * @param {{ prepend: Function, append: Function }} contextMenuOptions
 * @param {object} options
 * @param {(options?: object) => Promise<import('electron').BrowserWindow>} options.createWindow
 * @param {(browserWindow: import('electron').BrowserWindow) => Promise<boolean>} options.confirmCloseApp
 * @param {(manager: TabManager, count: number, action: 'close' | 'load' | 'unload') => Promise<boolean>} options.confirmMultipleTabsAction
 * @param {Set<number>} options.closeConfirmedWindowIds Windows that may close without another prompt
 */
export function setupContextMenu(contextMenuOptions, { createWindow, confirmCloseApp, confirmMultipleTabsAction, closeConfirmedWindowIds }) {
  const faviconPromises = new Map()
  let configuredSearchEngines = parseSearchEngines(DEFAULT_SEARCH_ENGINES_SETTING)
  // Menus must not queue a settings read behind unrelated writes on slow storage.
  const configuredSearchEnginesReady = baseHandlers.settings._findOne('contextMenuSearchEngines')
    .then(setting => {
      configuredSearchEngines = parseSearchEngines(setting?.value ?? DEFAULT_SEARCH_ENGINES_SETTING)
    })
    .catch(error => {
      console.warn('Failed to load context-menu search engines:', error)
    })

  /**
   * @returns {Promise<ReturnType<typeof parseSearchEngines>>}
   */
  async function getConfiguredSearchEngines() {
    await configuredSearchEnginesReady
    return configuredSearchEngines
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
   * Items for the tab bar, its selected tabs and the subscription feed tabs,
   * which the renderer records on the window's TabManager before the menu opens.
   * @param {import('electron').WebContents} webContents
   */
  function createTabItems(webContents) {
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
    const isSubscriptionNewFeedTab = subscriptionFeedTab != null &&
      manager?.contextMenuSubscriptionNewFeedTab === true
    const subscriptionFeedLabelKeys = {
      videos: 'Reload Videos',
      shorts: 'Reload Shorts',
      live: 'Reload Live',
      posts: 'Reload Posts',
      all: 'Reload All Feeds'
    }
    const contextMenuTabYouTubeUrls = contextMenuTabs.map(tab => {
      const route = tab.route?.fullPath ?? getOpenTubeXRouteFromUrl(tab.url)
      return isShareableOpenTubeXRoute(route)
        ? transformOpenTubeXRouteUrl(route, true)
        : null
    })

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
    const selectedTabGroupId = contextMenuTabs.length > 0 &&
      contextMenuTabs.every(tab => tab.groupId === contextMenuTabs[0].groupId)
      ? contextMenuTabs[0].groupId ?? null
      : undefined
    const tabGroups = Array.from(manager?.tabGroups.values() ?? [])
    const selectedTabGroup = typeof selectedTabGroupId === 'string'
      ? manager?.tabGroups.get(selectedTabGroupId)
      : null
    const hasSelectedUnloadedTab = contextMenuTabs.some(tab => tab.loadState === 'unloaded')
    const hasSelectedLoadedTab = contextMenuTabs.some(tab => !['unloaded', 'unloading'].includes(tab.loadState))
    /**
     * Apply a bulk tab action as one renderer update instead of one per tab.
     * @param {() => void} run
     */
    const runBatchedTabAction = (run) => {
      manager?.runBatched(run).catch(error => {
        console.error('Failed to apply a bulk tab action:', error)
      })
    }
    const closeContextMenuTabs = async (tabIds) => {
      if (!manager) return

      const existingTabIds = tabIds.filter(tabId => manager.tabs.has(tabId))
      if (existingTabIds.length === 0) return

      const isLastWindow = BrowserWindow.getAllWindows().length === 1
      const closesWindow = existingTabIds.length === manager.tabs.size
      if (closesWindow && isLastWindow) {
        // The quit confirmation already covers this case
        if (!await confirmCloseApp(manager.browserWindow)) return
      } else if (!await confirmMultipleTabsAction(manager, existingTabIds.length, 'close')) {
        return
      }

      const hasRemainingTabs = await manager.closeTabs(existingTabIds)
      if (!hasRemainingTabs) {
        if (isLastWindow) closeConfirmedWindowIds.add(manager.browserWindow.id)
        manager.browserWindow.close()
      }
    }

    return [
      {
        // While a refresh runs, the same entry cancels it
        label: contextMenuLabel(subscriptionFeedLabelKeys[subscriptionFeedTab] ?? 'Reload Videos'),
        refreshingLabel: contextMenuLabel('Cancel Refresh'),
        visible: subscriptionFeedTab != null,
        click: () => {
          if (!manager || !subscriptionFeedTab) return

          if (isSubscriptionAutoRefreshInProgress()) {
            requestSubscriptionAutoRefreshCancellation()
            return
          }

          if (!manager.presentedTabId) return

          manager.bridge.send(IpcChannels.SUBSCRIPTION_FEED_REQUEST_RELOAD, {
            tabId: manager.presentedTabId,
            feedTab: subscriptionFeedTab
          })
        }
      },
      {
        label: contextMenuLabel('Mark All as Seen'),
        visible: isSubscriptionNewFeedTab &&
          manager?.contextMenuSubscriptionNewFeedHasContent === true,
        click: () => {
          if (!manager?.presentedTabId || !subscriptionFeedTab || subscriptionFeedTab === 'all') {
            return
          }

          manager.bridge.send(IpcChannels.SUBSCRIPTION_FEED_REQUEST_MARK_SEEN, {
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
        label: isBulkTabAction
          ? contextMenuLabel(
              'Close Multiple Tabs',
              { count: contextMenuTabs.length },
              `Close ${contextMenuTabs.length} Tabs`
            )
          : contextMenuLabel('Close Tab'),
        visible: contextMenuTab != null,
        click: async () => {
          if (!manager || !contextMenuTab) return

          await closeContextMenuTabs(contextMenuTabs.map(tab => tab.id))
        }
      },
      {
        label: isBulkTabAction
          ? contextMenuLabel(
              'Duplicate Multiple Tabs',
              { count: contextMenuTabs.length },
              `Duplicate ${contextMenuTabs.length} Tabs`
            )
          : contextMenuLabel('Duplicate Tab'),
        visible: contextMenuTab != null,
        click: () => {
          if (!manager || !contextMenuTab) return

          runBatchedTabAction(() => {
            for (const tab of contextMenuTabs) manager.duplicateTab(tab.id)
          })
        }
      },
      {
        label: contextMenuLabel(isBulkTabAction ? 'Move Tabs' : 'Move Tab'),
        visible: contextMenuTab != null,
        submenu: [
          {
            label: contextMenuLabel('To Beginning'),
            enabled: canMoveContextMenuTabsToBeginning,
            click: () => {
              if (!manager || !contextMenuTab) return

              if (isBulkTabAction) {
                runBatchedTabAction(() => {
                  for (const tab of [...contextMenuTabs].reverse()) {
                    manager.moveTab(tab.id, 0)
                  }
                })
              } else {
                manager.moveTab(contextMenuTab.id, 0)
              }
            }
          },
          {
            label: contextMenuLabel('To End'),
            enabled: canMoveContextMenuTabsToEnd,
            click: () => {
              if (!manager || !contextMenuTab) return

              if (isBulkTabAction) {
                runBatchedTabAction(() => {
                  for (const tab of contextMenuTabs) {
                    manager.moveTab(tab.id, manager.tabs.size)
                  }
                })
              } else {
                manager.moveTab(contextMenuTab.id, manager.tabs.size)
              }
            }
          }
        ]
      },
      {
        label: contextMenuLabel(isBulkTabAction ? 'Move Tabs to Group' : 'Move Tab to Group'),
        visible: contextMenuTab != null,
        submenu: [
          {
            label: contextMenuLabel('Ungrouped'),
            type: 'radio',
            checked: selectedTabGroupId === null,
            click: () => {
              manager?.setTabsGroup(contextMenuTabs.map(tab => tab.id), null)
            }
          },
          ...tabGroups.map(group => ({
            label: group.name,
            type: 'radio',
            groupColor: group.color ?? 'default',
            checked: selectedTabGroupId === group.id,
            click: () => {
              manager?.setTabsGroup(contextMenuTabs.map(tab => tab.id), group.id)
            }
          })),
          { type: 'separator' },
          {
            label: contextMenuLabel('Manage Tab Groups…'),
            click: () => {
              manager?.bridge.send(IpcChannels.TABS_OPEN_ORGANIZER)
            }
          }
        ]
      },
      {
        label: contextMenuLabel('Collapse Group'),
        visible: contextMenuTab != null && selectedTabGroup != null && !selectedTabGroup.isCollapsed,
        click: () => {
          manager?.updateTabGroup(selectedTabGroup.id, { isCollapsed: true })
        }
      },
      {
        type: 'separator',
        visible: contextMenuTab != null
      },
      {
        label: contextMenuLabel('Close Tabs'),
        visible: contextMenuTab != null,
        submenu: [
          {
            label: contextMenuLabel(manager?.contextMenuTabBarVertical ? 'To the Top' : 'To the Left'),
            enabled: firstSelectedTabIndex > 0,
            click: () => {
              closeContextMenuTabs(contextMenuTabIds.slice(0, firstSelectedTabIndex))
            }
          },
          {
            label: contextMenuLabel(manager?.contextMenuTabBarVertical ? 'To the Bottom' : 'To the Right'),
            enabled: lastSelectedTabIndex < contextMenuTabIds.length - 1,
            click: () => {
              closeContextMenuTabs(contextMenuTabIds.slice(lastSelectedTabIndex + 1))
            }
          },
          {
            label: contextMenuLabel('Other Tabs'),
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
        label: contextMenuLabel(isBulkTabAction ? 'Copy YouTube Links' : 'Copy YouTube Link'),
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
        label: contextMenuLabel(allSelectedTabsPinned
          ? isBulkTabAction ? 'Unpin Tabs' : 'Unpin Tab'
          : isBulkTabAction ? 'Pin Tabs' : 'Pin Tab'),
        visible: contextMenuTab != null,
        click: () => {
          if (!manager || !contextMenuTab) return

          runBatchedTabAction(() => {
            for (const tab of contextMenuTabs) {
              manager.setTabPinned(tab.id, !allSelectedTabsPinned)
            }
          })
        }
      },
      {
        label: contextMenuLabel('Tab Color'),
        visible: contextMenuTab != null,
        submenu: [
          { key: 'Default', color: null },
          { key: 'Red', color: 'red' },
          { key: 'Orange', color: 'orange' },
          { key: 'Yellow', color: 'yellow' },
          { key: 'Green', color: 'green' },
          { key: 'Blue', color: 'blue' },
          { key: 'Purple', color: 'purple' },
          { key: 'Pink', color: 'pink' }
        ].map(({ key, color }) => ({
          label: contextMenuLabel(key),
          type: 'radio',
          checked: selectedTabColor === color,
          click: () => {
            if (!manager || !contextMenuTab) return

            runBatchedTabAction(() => {
              for (const tab of contextMenuTabs) manager.setTabColor(tab.id, color)
            })
          }
        }))
      },
      {
        type: 'separator',
        visible: contextMenuTab != null
      },
      {
        label: contextMenuLabel('New Tab'),
        visible: isTabBarContextMenu && contextMenuTab == null,
        click: () => {
          manager?.createTabWithPreference({ makeActive: true }).catch(error => {
            console.error('Failed to create a new tab from the tab bar context menu:', error)
          })
        }
      },
      {
        label: contextMenuLabel('New Window'),
        visible: isTabBarContextMenu && contextMenuTab == null,
        click: () => {
          createWindow({ replaceMainWindow: false }).catch(error => {
            console.error('Failed to create a new window from the tab bar context menu:', error)
          })
        }
      },
      {
        label: contextMenuLabel('Reopen Closed Tab'),
        visible: isTabBarContextMenu && contextMenuTab == null,
        enabled: manager?.closedTabs.length > 0,
        click: () => {
          manager?.restoreClosedTab()
        }
      },
      {
        label: contextMenuLabel(isBulkTabAction ? 'Reload Tabs' : 'Reload Tab'),
        visible: contextMenuTab != null,
        click: () => {
          if (!manager || !contextMenuTab) return

          for (const tab of contextMenuTabs) manager.requestReload(tab.id)
        }
      },
      {
        label: contextMenuLabel('Load Tabs'),
        visible: contextMenuTab != null && isBulkTabAction,
        enabled: hasSelectedUnloadedTab,
        click: async () => {
          if (!manager || !contextMenuTab) return

          const tabIds = contextMenuTabs
            .filter(tab => tab.loadState === 'unloaded')
            .map(tab => tab.id)
          if (!await confirmMultipleTabsAction(manager, tabIds.length, 'load')) return

          await manager.runBatched(() => {
            for (const tabId of tabIds) manager.loadTab(tabId)
          })
        }
      },
      {
        label: contextMenuLabel(
          isBulkTabAction ? 'Unload Tabs' : isContextMenuTabUnloaded ? 'Load Tab' : 'Unload Tab'
        ),
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

          const tabIds = contextMenuTabs
            .filter(tab => !['unloaded', 'unloading'].includes(tab.loadState))
            .map(tab => tab.id)
          if (!await confirmMultipleTabsAction(manager, tabIds.length, 'unload')) return

          await manager.unloadTabs(tabIds)
        }
      },
      {
        type: 'separator',
        visible: contextMenuTab != null && moveTargets.length > 0
      },
      {
        label: contextMenuLabel(isBulkTabAction ? 'Move Tabs to Window' : 'Move Tab to Window'),
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
      }
    ]
  }

  /**
   * @param {string} selectionText
   */
  async function createExternalSearchItem(selectionText) {
    const activeSearchEngines = (await getConfiguredSearchEngines())
      .filter(engine => engine.enabled)
    const externalSearchItems = activeSearchEngines.map(engine => ({
      label: engine.name,
      icon: getFaviconUrl(engine.url),
      faviconSource: engine.url,
      click: async () => {
        try {
          await shell.openExternal(buildSearchUrl(engine.url, selectionText))
        } catch (error) {
          console.error(`Failed to search with ${engine.name}:`, error)
        }
      }
    }))
    return activeSearchEngines.length === 1
      ? {
          label: contextMenuLabel(
            'Search With',
            { engine: activeSearchEngines[0].name },
            `Search with ${activeSearchEngines[0].name}`
          ),
          icon: getFaviconUrl(activeSearchEngines[0].url),
          faviconSource: activeSearchEngines[0].url,
          visible: selectionText.length > 0,
          click: externalSearchItems[0].click
        }
      : {
          label: contextMenuLabel('Search With Multiple', {}, 'Search with...'),
          visible: selectionText.length > 0 && activeSearchEngines.length > 1,
          submenu: externalSearchItems
        }
  }

  let contextMenuSessionId = 0
  /** @type {Map<number, { sessionId: number, actions: Map<string, Function> }>} */
  const contextMenuSessions = new Map()
  /** @type {Map<number, number>} */
  const latestContextMenuRequests = new Map()

  ipcMain.handle(IpcChannels.CONTEXT_MENU_OPEN, async (event, rawParameters = {}) => {
    const webContents = event.sender
    const sessionId = ++contextMenuSessionId
    latestContextMenuRequests.set(webContents.id, sessionId)
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
      ...await contextMenuOptions.append(defaultActions, parameters, webContents)
    ]
    const actions = new Map()
    const serializedItems = serializeContextMenuItems(items, actions)

    if (latestContextMenuRequests.get(webContents.id) === sessionId) {
      contextMenuSessions.set(webContents.id, { sessionId, actions })
    }
    return { sessionId, items: serializedItems }
  })

  ipcMain.handle(IpcChannels.CONTEXT_MENU_EXECUTE, async (event, payload) => {
    const session = contextMenuSessions.get(event.sender.id)
    if (!session || payload?.sessionId !== session.sessionId) return

    const action = session.actions.get(payload?.actionId)
    if (action) await action()
  })

  ipcMain.handle(IpcChannels.RESOLVE_FAVICON, async (event, url) => {
    if (!isOpenTubeXUrl(event.senderFrame.url) || typeof url !== 'string') return ''

    if (!(await getConfiguredSearchEngines()).some(engine => engine.enabled && engine.url === url)) {
      return ''
    }

    return resolveSearchEngineFavicon(url)
  })

  return {
    createTabItems,
    createExternalSearchItem,
    /**
     * @param {unknown} setting
     */
    setSearchEngines(setting) {
      configuredSearchEngines = parseSearchEngines(setting)
    },
    /**
     * @param {number} webContentsId
     */
    forgetWebContents(webContentsId) {
      contextMenuSessions.delete(webContentsId)
      latestContextMenuRequests.delete(webContentsId)
    }
  }
}
