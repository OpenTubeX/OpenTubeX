import { ipcMain } from 'electron'
import { IpcChannels } from '../../constants.js'
import { TabManager } from './TabManager.js'
import { replaceAllTabSessions } from './TabSessionStore.js'

/**
 * @param {object} [options]
 * @param {(browserWindow: import('electron').BrowserWindow) => boolean | Promise<boolean>} [options.confirmCloseWindow]
 * @param {(manager: TabManager, count: number, action: 'close' | 'load' | 'unload') => boolean | Promise<boolean>} [options.confirmMultipleTabsAction]
 * @param {(browserWindow: import('electron').BrowserWindow) => void} [options.markWindowCloseConfirmed]
 * @param {(manager: TabManager, state: object) => void} [options.mediaSessionStateChanged]
 */
export async function setupTabsIPC(options = {}) {
  const {
    confirmCloseWindow = () => true,
    confirmMultipleTabsAction = () => true,
    markWindowCloseConfirmed = () => {},
    mediaSessionStateChanged = () => {}
  } = options

  // Load synchronous tab-lifecycle preferences before the first window exists.
  await Promise.all([
    TabManager.refreshStoredTabCloseFocus(),
    TabManager.refreshStoredSkipSilenceSettings()
  ])

  const getManager = event => TabManager.getFromWebContents(event.sender)

  ipcMain.on(IpcChannels.TABS_RENDERER_READY, (event) => {
    getManager(event)?.markRendererReady()
  })

  ipcMain.handle(IpcChannels.TABS_GET_STATE, (event) => {
    return getManager(event)?.getState() ?? null
  })

  ipcMain.handle(IpcChannels.TABS_GET_SYNC_SESSIONS, () => {
    return Array.from(TabManager.getAll(), manager => manager.getSyncSession())
  })

  ipcMain.handle(IpcChannels.TABS_APPLY_SYNC_SESSIONS, async (event, sessions) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(sessions) || sessions.length === 0) return false

    const validSessions = sessions.filter(session => (
      session &&
      typeof session.sessionId === 'string' &&
      session.sessionId.length > 0 &&
      Array.isArray(session.tabs) &&
      session.tabs.length > 0 &&
      session.tabs.every(tab => tab && typeof tab.url === 'string')
    ))
    if (validSessions.length === 0) return false

    const liveManagers = Array.from(TabManager.getAll())
    const remaining = new Map(validSessions.map(session => [session.sessionId, session]))
    const assignments = new Map()

    for (const liveManager of liveManagers) {
      const matching = remaining.get(liveManager.sessionId)
      if (matching) {
        assignments.set(liveManager, matching)
        remaining.delete(liveManager.sessionId)
      }
    }
    if (!assignments.has(manager) && remaining.size > 0) {
      const first = remaining.values().next().value
      assignments.set(manager, first)
      remaining.delete(first.sessionId)
    }

    for (const [liveManager, session] of assignments) {
      await liveManager.replaceFromSyncData(session)
    }
    const localBounds = new Map(Array.from(assignments, ([liveManager, session]) => (
      [session.sessionId, liveManager._getCurrentBounds()]
    )))
    await replaceAllTabSessions(validSessions.map(session => ({
      ...session,
      ...(localBounds.get(session.sessionId) && {
        bounds: localBounds.get(session.sessionId)
      })
    })))
    return true
  })

  ipcMain.handle(IpcChannels.TABS_CREATE, async (event, options) => {
    const manager = getManager(event)
    if (!manager) return null

    const {
      inheritColorFromOpener = false,
      openerTabId,
      // Never let a renderer choose the internal tab id; it is always generated.
      id,
      // Silence skipping starts from the main-owned default, not renderer input.
      skipSilence,
      // Restored tabs alone may choose their previous position.
      _preferredIndex,
      ...tabOptions
    } = options != null && typeof options === 'object' ? options : {}

    const resolvedOpenerTabId = typeof openerTabId === 'string'
      ? openerTabId
      : manager.presentedTabId ?? manager.activeTabId
    const tab = inheritColorFromOpener === true
      ? await manager.createTabWithPreferenceFromOpener(tabOptions, resolvedOpenerTabId)
      : await manager.createTabWithPreference({ ...tabOptions, openerTabId: resolvedOpenerTabId })

    return {
      id: tab.id,
      url: tab.url,
      route: structuredClone(tab.route),
      title: tab.title,
      isPinned: tab.isPinned,
      color: tab.color
    }
  })

  ipcMain.on(IpcChannels.TABS_ACTIVATE, (event, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.activateTab(tabId)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_SELECTED, (event, tabIds) => {
    const manager = getManager(event)
    if (!manager) return

    manager.selectedTabIds = Array.isArray(tabIds)
      ? Array.from(new Set(tabIds.filter(tabId => {
          return typeof tabId === 'string' && manager.tabs.has(tabId)
        })))
      : []
  })

  ipcMain.handle(IpcChannels.TABS_IS_ACTIVE, (event, tabId) => {
    const manager = getManager(event)
    if (!manager) return false
    return typeof tabId === 'string' ? manager.activeTabId === tabId : manager.activeTabId != null
  })

  ipcMain.handle(IpcChannels.TABS_CLOSE, async (event, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      if (manager.tabs.size === 1 && !await confirmCloseWindow(manager.browserWindow)) {
        return { hasRemainingTabs: true }
      }

      const hasRemainingTabs = manager.closeTab(tabId)
      if (!hasRemainingTabs) {
        markWindowCloseConfirmed(manager.browserWindow)
        manager.browserWindow.close()
      }
      return { hasRemainingTabs }
    }
    return { hasRemainingTabs: false }
  })

  ipcMain.handle(IpcChannels.TABS_CLOSE_MULTIPLE, async (event, tabIds) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(tabIds)) {
      return { hasRemainingTabs: false }
    }

    const closingTabIds = Array.from(new Set(
      tabIds.filter(tabId => typeof tabId === 'string' && manager.tabs.has(tabId))
    ))
    if (closingTabIds.length === 0) {
      return { hasRemainingTabs: manager.tabs.size > 0 }
    }

    if (
      closingTabIds.length === manager.tabs.size &&
      !await confirmCloseWindow(manager.browserWindow)
    ) {
      return { hasRemainingTabs: true }
    }

    let hasRemainingTabs
    try {
      hasRemainingTabs = await manager.closeTabs(closingTabIds)
    } catch (error) {
      console.error('Failed to close tabs:', error)
      hasRemainingTabs = manager.tabs.size > 0
    }
    if (!hasRemainingTabs) {
      markWindowCloseConfirmed(manager.browserWindow)
      manager.browserWindow.close()
    }
    return { hasRemainingTabs }
  })

  ipcMain.handle(IpcChannels.TABS_DUPLICATE, (event, tabId) => {
    const manager = getManager(event)
    const tab = manager && typeof tabId === 'string' ? manager.duplicateTab(tabId) : null
    return tab
      ? { id: tab.id, url: tab.url, route: structuredClone(tab.route), title: tab.title, isPinned: tab.isPinned, color: tab.color }
      : null
  })

  ipcMain.on(IpcChannels.TABS_MOVE, (event, tabId, toIndex) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string' && typeof toIndex === 'number') {
      manager.moveTab(tabId, toIndex)
    }
  })

  ipcMain.on(IpcChannels.TABS_REORDER, (event, tabIds, requestId) => {
    const manager = getManager(event)
    const normalizedTabIds = Array.isArray(tabIds) ? Array.from(tabIds) : null
    if (
      manager &&
      normalizedTabIds?.every(tabId => typeof tabId === 'string') &&
      (requestId === null || typeof requestId === 'string')
    ) {
      manager.reorderTabs(normalizedTabIds, requestId)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_PINNED, (event, tabId, isPinned) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.setTabPinned(tabId, isPinned === true)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_COLOR, (event, tabId, color) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.setTabColor(tabId, color)
    }
  })

  ipcMain.handle(IpcChannels.TABS_CREATE_GROUP, (event, group) => {
    return getManager(event)?.createTabGroup(group) ?? null
  })

  ipcMain.handle(IpcChannels.TABS_UPDATE_GROUP, (event, groupId, changes) => {
    const manager = getManager(event)
    return manager != null && typeof groupId === 'string'
      ? manager.updateTabGroup(groupId, changes)
      : false
  })

  ipcMain.handle(IpcChannels.TABS_DELETE_GROUP, (event, groupId) => {
    const manager = getManager(event)
    return manager != null && typeof groupId === 'string'
      ? manager.deleteTabGroup(groupId)
      : false
  })

  ipcMain.handle(IpcChannels.TABS_SET_GROUP, (event, tabIds, groupId) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(tabIds) || (groupId !== null && typeof groupId !== 'string')) {
      return 0
    }
    return manager.setTabsGroup(tabIds.filter(tabId => typeof tabId === 'string'), groupId)
  })

  ipcMain.handle(IpcChannels.TABS_RUN_ORGANIZER_ACTION, async (event, action, tabIds) => {
    const manager = getManager(event)
    if (!manager || !['close', 'load', 'unload'].includes(action) || !Array.isArray(tabIds)) {
      return { success: false, hasRemainingTabs: manager?.tabs.size > 0 }
    }

    const uniqueTabIds = Array.from(new Set(tabIds.filter(tabId => (
      typeof tabId === 'string' && manager.tabs.has(tabId)
    ))))
    const actionableTabIds = action === 'load'
      ? uniqueTabIds.filter(tabId => manager.tabs.get(tabId)?.loadState === 'unloaded')
      : action === 'unload'
        ? uniqueTabIds.filter(tabId => !['unloaded', 'unloading'].includes(manager.tabs.get(tabId)?.loadState))
        : uniqueTabIds
    if (actionableTabIds.length === 0) {
      return { success: true, hasRemainingTabs: manager.tabs.size > 0 }
    }
    if (!await confirmMultipleTabsAction(manager, actionableTabIds.length, action)) {
      return { success: false, hasRemainingTabs: manager.tabs.size > 0 }
    }

    if (action === 'load') {
      await manager.runBatched(() => {
        for (const tabId of actionableTabIds) manager.loadTab(tabId)
      })
      return { success: true, hasRemainingTabs: true }
    }
    if (action === 'unload') {
      await manager.unloadTabs(actionableTabIds)
      return { success: true, hasRemainingTabs: true }
    }

    if (actionableTabIds.length === manager.tabs.size && !await confirmCloseWindow(manager.browserWindow)) {
      return { success: false, hasRemainingTabs: true }
    }
    const hasRemainingTabs = await manager.closeTabs(actionableTabIds)
    if (!hasRemainingTabs) {
      markWindowCloseConfirmed(manager.browserWindow)
      manager.browserWindow.close()
    }
    return { success: true, hasRemainingTabs }
  })

  ipcMain.handle(IpcChannels.TABS_GET_MOVE_TARGETS, (event) => {
    const manager = getManager(event)
    return manager ? TabManager.listMoveTargets(manager.browserWindow.id) : []
  })

  ipcMain.handle(IpcChannels.TABS_MOVE_TO_WINDOW, async (event, tabIds, targetWindowId) => {
    const manager = getManager(event)
    if (!manager || !Array.isArray(tabIds) || !Number.isInteger(targetWindowId)) return 0

    let moved = 0
    for (const tabId of new Set(tabIds)) {
      if (typeof tabId === 'string' && manager.tabs.has(tabId) && await TabManager.moveTabToWindow(tabId, targetWindowId)) {
        moved += 1
      }
    }
    return moved
  })

  ipcMain.handle(IpcChannels.TABS_CAPTURE_PREVIEW, (event, tabId) => {
    const manager = getManager(event)
    return manager && typeof tabId === 'string' ? manager.captureTabPreview(tabId) : null
  })

  ipcMain.handle(IpcChannels.TABS_GET_CACHED_PREVIEWS, (event, tabIds) => {
    const manager = getManager(event)
    if (!manager) {
      return {}
    }

    const validTabIds = Array.isArray(tabIds)
      ? tabIds.filter(tabId => typeof tabId === 'string' && manager.tabs.has(tabId))
      : []
    return manager.getCachedTabPreviews(validTabIds)
  })

  ipcMain.on(IpcChannels.TABS_SET_PREVIEWS_ENABLED, (event, enabled) => {
    const manager = getManager(event)
    manager?.setTabPreviewsEnabled(enabled === true).catch(error => {
      console.error('Failed to update tab previews:', error)
    })
  })

  ipcMain.on(IpcChannels.TABS_SET_PREVIEW_CAPTURE_PAUSED, (event, paused) => {
    const manager = getManager(event)
    manager?.setPreviewCapturePaused(paused === true)
  })

  ipcMain.on(IpcChannels.TABS_REQUEST_PREVIEW_REFRESH, (event, options = {}) => {
    const manager = getManager(event)
    const tabId = typeof options?.tabId === 'string' ? options.tabId : null
    const tab = tabId ? manager?.tabs.get(tabId) : null
    if (!manager || !tab) {
      return
    }

    const delayMs = Number.isFinite(options.delayMs)
      ? Math.max(0, Math.min(5000, options.delayMs))
      : undefined
    manager._scheduleTabPreviewRefresh(tab, delayMs)
  })

  ipcMain.handle(IpcChannels.TABS_RESTORE_CLOSED, async (event, closedTabId = null) => {
    const manager = getManager(event)
    const tab = await manager?.restoreClosedTab(typeof closedTabId === 'string' ? closedTabId : null)
    return tab
      ? { id: tab.id, url: tab.url, route: structuredClone(tab.route), title: tab.title, isPinned: tab.isPinned, color: tab.color }
      : null
  })

  ipcMain.handle(IpcChannels.TABS_CLEAR_CLOSED, (event) => {
    return getManager(event)?.clearClosedTabs() ?? false
  })

  ipcMain.on(IpcChannels.TABS_RELOAD, (event, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.reloadTab(tabId)
    }
  })

  ipcMain.on(IpcChannels.TABS_UPDATE_TITLE, (event, title, tabId) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    if (manager && tab && typeof title === 'string') {
      manager.applyTabTitle(tab, title)
    }
  })

  ipcMain.handle(IpcChannels.TABS_UPDATE_AVATAR, async (event, avatarBytes, tabId, routePath) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    if (manager && tab && typeof routePath === 'string') {
      return await manager.applyTabAvatar(tab, avatarBytes, routePath)
    }
    return false
  })

  ipcMain.on(IpcChannels.TABS_SET_AVATARS_ENABLED, (event, enabled) => {
    const manager = getManager(event)
    manager?.setTabAvatarsEnabled(enabled === true).catch(error => {
      console.error('Failed to update tab avatar caching:', error)
    })
  })

  ipcMain.on(IpcChannels.TABS_UPDATE_ROUTE, (event, payload) => {
    const manager = getManager(event)
    if (
      manager &&
      typeof payload?.tabId === 'string' &&
      typeof payload?.route?.path === 'string' &&
      (payload.url == null || typeof payload.url === 'string')
    ) {
      manager.updateTabRoute(payload.tabId, payload.route, payload.url)
    }
  })

  ipcMain.on(IpcChannels.TABS_UPDATE_NAV_HISTORY, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string') {
      manager.updateTabNavigationHistory(
        payload.tabId,
        payload.history,
        payload.historyIndex,
        payload.persistHistory
      )
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_TAB_BAR_SCROLL, (event, position) => {
    const manager = getManager(event)
    if (manager && typeof position === 'number') {
      manager.tabBarScrollPosition = position
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_CONTEXT_MENU_TAB, (event, payload) => {
    const manager = getManager(event)
    if (!manager) return

    manager.contextMenuTabId = typeof payload?.tabId === 'string' && manager.tabs.has(payload.tabId)
      ? payload.tabId
      : null
    manager.contextMenuSelectedTabIds = Array.isArray(payload?.selectedTabIds)
      ? Array.from(new Set(payload.selectedTabIds.filter(tabId => {
          return typeof tabId === 'string' && manager.tabs.has(tabId)
        })))
      : []
    if (
      manager.contextMenuTabId &&
      !manager.contextMenuSelectedTabIds.includes(manager.contextMenuTabId)
    ) {
      manager.contextMenuSelectedTabIds = [manager.contextMenuTabId]
    }
    manager.contextMenuSurface = ['tab', 'tabBar', 'content', 'subscriptionFeedTab'].includes(payload?.surface)
      ? payload.surface
      : payload?.isTabBar === true ? 'tabBar' : 'content'
    manager.contextMenuSubscriptionFeedTab = manager.contextMenuSurface === 'subscriptionFeedTab' &&
      ['videos', 'shorts', 'live', 'posts', 'all'].includes(payload?.feedTab)
      ? payload.feedTab
      : null
    manager.contextMenuSubscriptionNewFeedTab = manager.contextMenuSubscriptionFeedTab !== null &&
      payload?.isNewFeedTab === true
    manager.contextMenuSubscriptionNewFeedHasContent = manager.contextMenuSubscriptionNewFeedTab &&
      payload?.hasNewContent === true
    manager.contextMenuTabBarVertical = payload?.verticalLayout === true
  })

  ipcMain.on(IpcChannels.TABS_SET_PLAYBACK_STATE, (event, playbackState, tabId) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    if (manager && tab && typeof playbackState === 'string') {
      tab.isPlaying = playbackState === 'playing'
      manager._broadcastStateUpdate()
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_MEDIA_SESSION_STATE, (event, state) => {
    const manager = getManager(event)
    if (manager && state && typeof state === 'object') {
      mediaSessionStateChanged(manager, state)
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_SKIP_SILENCE, (event, enabled, tabId) => {
    const manager = getManager(event)
    const tab = typeof tabId === 'string' ? manager?.tabs.get(tabId) : null
    const skipSilence = enabled === true
    if (tab && tab.skipSilence !== skipSilence) {
      tab.skipSilence = skipSilence
      manager._broadcastStateUpdate()
      manager._scheduleSessionSave()
    }
  })

  ipcMain.on(IpcChannels.TABS_SET_LOADING, (event, isLoading, tabId) => {
    const manager = getManager(event)
    if (manager && typeof tabId === 'string') {
      manager.setTabLoading(tabId, isLoading === true)
    }
  })

  ipcMain.on(IpcChannels.TABS_MOUNT_READY, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string' && Number.isInteger(payload?.mountRevision)) {
      manager.markTabMounted(payload.tabId, payload.mountRevision)
    }
  })

  ipcMain.on(IpcChannels.TABS_MOUNT_FAILED, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string' && Number.isInteger(payload?.mountRevision)) {
      manager.markTabMountFailed(payload.tabId, payload.mountRevision)
    }
  })

  ipcMain.on(IpcChannels.TABS_PRESENTED, (event, payload) => {
    const manager = getManager(event)
    if (manager && typeof payload?.tabId === 'string' && Number.isInteger(payload?.selectionRevision)) {
      manager.markTabPresented(payload.tabId, payload.selectionRevision)
    }
  })

  ipcMain.handle(IpcChannels.TABS_REQUEST_PICTURE_IN_PICTURE, async (event, tabId) => {
    const manager = getManager(event)
    if (
      !manager ||
      typeof tabId !== 'string' ||
      !manager.tabs.has(tabId) ||
      manager._deferredCloseTabIds.has(tabId) ||
      manager._deferredUnloadTabIds.has(tabId)
    ) {
      return false
    }

    return manager.browserWindow.webContents.executeJavaScript(`
      (async () => {
        const root = Array.from(document.querySelectorAll('.tabContent[data-tab-id]'))
          .find(element => element.dataset.tabId === ${JSON.stringify(tabId)})
        const detachedPlayer = Array.from(document.querySelectorAll('.ftVideoPlayer[data-tab-id]'))
          .find(element => element.dataset.tabId === ${JSON.stringify(tabId)})
        const target = root?.querySelector('video.player') ?? detachedPlayer?.querySelector('video.player')
        if (!target?.ui?.getControls) return false

        if (document.pictureInPictureElement && document.pictureInPictureElement !== target) {
          try { await document.exitPictureInPicture() } catch {}
        }

        target.ui.getControls().togglePiP()
        return true
      })()
    `, true)
  })

  ipcMain.handle(IpcChannels.TABS_REQUEST_FULLSCREEN, (event, tabId) => {
    const manager = getManager(event)
    if (!manager || typeof tabId !== 'string' || !manager.tabs.has(tabId)) {
      return false
    }

    return manager.browserWindow.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('.tabContent[data-tab-id]'))
        .find(element => element.dataset.tabId === ${JSON.stringify(tabId)})
        ?.querySelector('video.player')
        ?.ui?.getControls?.().toggleFullScreen()
    `, true)
  })
}
