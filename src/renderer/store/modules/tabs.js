import packageDetails from '../../../../package.json'
import { getTabPageIcon } from '../../tabs/tabPageIcon'
import { DEFAULT_VIDEO_ZOOM } from '../../helpers/player/videoZoom'
import { reconcilePendingTabOrder } from '../../tabs/pendingTabOrder'
import { getTabHistoryState, reuseEqualSnapshot, reconcileSnapshotList, reconcileTab, normalizeRoute, cloneRoute, normalizeHistoryEntry, normalizeScroll } from '../../tabs/tabSessionModel.js'
import { formatTabTitle } from '../../tabs/tabTitle'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'

const MAX_LOGICAL_HISTORY_ENTRIES = 100

const state = {
  tabs: [],
  groups: [],
  closedTabs: [],
  pendingTabOrder: null,
  pendingTabOrderRequestId: null,
  activeTabId: null,
  selectedTabIds: [],
  presentedTabId: null,
  mainPresentedTabId: null,
  selectionRevision: 0,
  transitionRevision: 0,
  transitionTargetTabId: null,
  containerIds: [],
  tabBarScrollPosition: 0,
  currentWatchTimestamps: {},
  videoZoomByTabId: {},
  lightsOffByTabId: {},
  skipSilenceByTabId: {}
}

const getters = {
  getTabLightsOff: (state) => (tabId) => state.lightsOffByTabId[tabId] ?? false,
  getTabs: (state) => state.tabs,
  getTabGroups: (state) => state.groups,
  getClosedTabs: (state) => state.closedTabs,
  getActiveTabId: (state) => state.activeTabId,
  getTabsById: (state) => new Map(state.tabs.map(tab => [tab.id, tab])),
  getActiveTab: (state, getters) => getters.getTabsById.get(state.activeTabId) ?? null,
  getSelectedTabIds: (state) => state.selectedTabIds,
  getPresentedTabId: (state) => state.presentedTabId,
  getPresentedTab: (state, getters) => getters.getTabsById.get(state.presentedTabId) ?? null,
  getTabById: (_state, getters) => (tabId) => getters.getTabsById.get(tabId) ?? null,
  getTabCount: (state) => state.tabs.length,
  getTabContainerIds: (state) => state.containerIds,
  getTabBarScrollPosition: (state) => state.tabBarScrollPosition,
  getCurrentWatchTimestamp: (state) => state.currentWatchTimestamps[state.activeTabId] ?? null,
  getWatchTimestamp: (state) => (tabId) => state.currentWatchTimestamps[tabId] ?? null,
  getTabVideoZoom: (state) => (tabId) => state.videoZoomByTabId[tabId] ?? DEFAULT_VIDEO_ZOOM,
  getTabSkipSilence: (state) => (tabId) => state.skipSilenceByTabId[tabId] ?? false,
  getTabHistoryState: (state) => (tabId) => {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    return tab ? getTabHistoryState(tab, getTabPageIcon) : { canGoBack: false, canGoForward: false, options: [] }
  }
}

const mutations = {
  setTabsState(state, payload = {}) {
    const previousTabsById = new Map(state.tabs.map(tab => [tab.id, tab]))
    const incomingTabs = Array.isArray(payload.tabs) ? payload.tabs : []
    const incomingIds = new Set(incomingTabs.map(tab => tab.id))

    const containerIds = state.containerIds.filter(tabId => incomingIds.has(tabId))
    const containerIdSet = new Set(containerIds)
    for (const tab of incomingTabs) {
      if (!containerIdSet.has(tab.id)) {
        containerIds.push(tab.id)
        containerIdSet.add(tab.id)
      }
    }
    state.containerIds = reuseEqualSnapshot(state.containerIds, containerIds)

    const reconciledTabs = incomingTabs.map(tab => reconcileTab(previousTabsById.get(tab.id), tab, stripDocumentTitle))
    const pendingOrderAcknowledged = payload.reorderRequestId === state.pendingTabOrderRequestId
    const reconciledOrder = reconcilePendingTabOrder(
      reconciledTabs,
      state.pendingTabOrder,
      pendingOrderAcknowledged
    )
    state.tabs = reuseEqualSnapshot(state.tabs, reconciledOrder.tabs)
    state.groups = reconcileSnapshotList(state.groups, payload.groups)
    state.closedTabs = reconcileSnapshotList(state.closedTabs, payload.closedTabs)
    state.pendingTabOrder = reconciledOrder.pendingTabOrder
    if (reconciledOrder.pendingTabOrder == null) {
      state.pendingTabOrderRequestId = null
    }
    for (const tab of incomingTabs) {
      state.skipSilenceByTabId[tab.id] = tab.skipSilence === true
    }
    state.selectedTabIds = state.selectedTabIds.filter(tabId => incomingIds.has(tabId))
    state.activeTabId = payload.activeTabId ?? null
    state.mainPresentedTabId = payload.presentedTabId ?? null
    state.selectionRevision = Number.isInteger(payload.selectionRevision)
      ? payload.selectionRevision
      : state.selectionRevision

    if (payload.tabBarScrollPosition != null) {
      state.tabBarScrollPosition = payload.tabBarScrollPosition
    }

    for (const tabId of Object.keys(state.currentWatchTimestamps)) {
      if (!incomingIds.has(tabId)) {
        delete state.currentWatchTimestamps[tabId]
      }
    }
    for (const tabId of Object.keys(state.videoZoomByTabId)) {
      if (tabId !== 'web' && !incomingIds.has(tabId)) {
        delete state.videoZoomByTabId[tabId]
      }
    }
    for (const tabId of Object.keys(state.lightsOffByTabId)) {
      if (tabId !== 'web' && !incomingIds.has(tabId)) {
        delete state.lightsOffByTabId[tabId]
      }
    }
    for (const tabId of Object.keys(state.skipSilenceByTabId)) {
      if (tabId !== 'web' && !incomingIds.has(tabId)) {
        delete state.skipSilenceByTabId[tabId]
      }
    }
  },

  setPresentedTab(state, tabId) {
    state.presentedTabId = tabId
  },

  setSelectedTabIds(state, tabIds) {
    const existingIds = new Set(state.tabs.map(tab => tab.id))
    state.selectedTabIds = Array.from(new Set(tabIds.filter(tabId => existingIds.has(tabId))))
  },

  reorderTabsOptimistically(state, { tabIds, requestId }) {
    const tabsById = new Map(state.tabs.map(tab => [tab.id, tab]))
    if (
      tabIds.length !== state.tabs.length ||
      new Set(tabIds).size !== tabIds.length ||
      !tabIds.every(tabId => tabsById.has(tabId))
    ) {
      return
    }

    state.pendingTabOrder = [...tabIds]
    state.pendingTabOrderRequestId = requestId
    state.tabs = tabIds.map(tabId => tabsById.get(tabId))
  },

  setTabTransition(state, { revision, tabId }) {
    state.transitionRevision = revision
    state.transitionTargetTabId = tabId
  },

  setTabNavigation(state, { tabId, route, history, historyIndex }) {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    if (!tab) {
      return
    }

    tab.route = normalizeRoute(route)
    tab.history = history.map(normalizeHistoryEntry).slice(-MAX_LOGICAL_HISTORY_ENTRIES)
    tab.historyIndex = Math.max(0, Math.min(historyIndex, tab.history.length - 1))
  },

  prepareTabReloadRoute(state, { tabId, route }) {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    if (!tab) {
      return
    }

    tab.pendingReloadRoute = normalizeRoute(route)
    const entry = tab.history[tab.historyIndex]
    if (entry) {
      entry.route = cloneRoute(tab.pendingReloadRoute)
    }
  },

  applyPendingReloadRoute(state, tabId) {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    if (tab?.pendingReloadRoute) {
      tab.route = tab.pendingReloadRoute
      tab.pendingReloadRoute = null
    }
  },

  setHistoryEntryScroll(state, { tabId, historyIndex, scroll }) {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    const entry = tab?.history[historyIndex]
    if (entry) {
      entry.scroll = normalizeScroll(scroll)
    }
  },

  setTabContentTitle(state, {
    tabId,
    title,
    skipHistoryEntry = false,
    resolveHistoryEntry = true
  }) {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    if (!tab) {
      return
    }

    tab.contentTitle = title
    if (skipHistoryEntry) {
      return
    }
    const entry = tab.history[tab.historyIndex]
    if (entry) {
      if (resolveHistoryEntry) {
        entry.titlePending = false
      }
      const resolvedTitle = title || entry.route.fullPath
      // A caller can provide a title it already knows before a dynamic page
      // finishes loading. Do not replace that useful history label with the
      // route placeholder while the page is mounting.
      if (resolvedTitle !== entry.route.fullPath || entry.title === entry.route.fullPath) {
        entry.title = resolvedTitle
      }
    }
  },

  setCurrentWatchTimestamp(state, payload) {
    const tabId = typeof payload === 'object' ? payload.tabId : state.activeTabId
    const value = typeof payload === 'object' ? payload.value : payload
    if (!tabId) {
      return
    }

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      state.currentWatchTimestamps[tabId] = value
    } else {
      delete state.currentWatchTimestamps[tabId]
    }
  },

  setTabVideoZoom(state, { tabId, value }) {
    state.videoZoomByTabId[tabId] = value
  },

  setTabLightsOff(state, { tabId, value }) {
    state.lightsOffByTabId[tabId] = value === true
  },

  setTabSkipSilence(state, { tabId, value }) {
    state.skipSilenceByTabId[tabId] = value === true
  },

  clearTabSkipSilence(state) {
    for (const tabId of Object.keys(state.skipSilenceByTabId)) {
      state.skipSilenceByTabId[tabId] = false
    }
  }
}

const actions = {
  async initializeTabs({ commit }) {
    if (!process.env.IS_ELECTRON) return () => {}

    const removeStateListener = window.ftElectron.tabs.onStateUpdated((newState) => {
      commit('setTabsState', newState)
    })
    const tabState = await window.ftElectron.tabs.getState()
    if (tabState) {
      commit('setTabsState', tabState)
    }

    return () => {
      removeStateListener()
    }
  },

  updateTabSkipSilence({ commit }, { tabId, value }) {
    commit('setTabSkipSilence', { tabId, value })
    window.ftElectron?.tabs?.setSkipSilence?.(value, tabId)
  },

  clearTabSkipSilence({ commit, state }) {
    commit('clearTabSkipSilence')
    for (const tab of state.tabs) {
      window.ftElectron?.tabs?.setSkipSilence?.(false, tab.id)
    }
  },

  async createTab({ rootGetters }, options = {}) {
    if (!process.env.IS_ELECTRON) return null

    const tabOptions = options.route || options.url
      ? options
      : { ...options, route: '/' + rootGetters.getLandingPage }

    return await window.ftElectron.tabs.create(tabOptions)
  },

  activateTab(_context, tabId) {
    if (!process.env.IS_ELECTRON) return
    window.ftElectron.tabs.activate(tabId)
  },

  setTabSelection({ commit }, tabIds) {
    if (!process.env.IS_ELECTRON) return
    commit('setSelectedTabIds', tabIds)
    window.ftElectron.tabs.setSelected(tabIds)
  },

  async closeTab(_context, tabId) {
    if (!process.env.IS_ELECTRON) return false
    const result = await window.ftElectron.tabs.close(tabId)
    return result?.hasRemainingTabs ?? false
  },

  async closeTabs(_context, tabIds) {
    if (!process.env.IS_ELECTRON) return false
    try {
      const result = await window.ftElectron.tabs.closeMultiple(tabIds)
      return result?.hasRemainingTabs ?? false
    } catch (error) {
      console.error('Failed to close tabs:', error)
      return true
    }
  },

  async closeActiveTab({ state, dispatch }) {
    return state.activeTabId ? await dispatch('closeTab', state.activeTabId) : false
  },

  async duplicateTab(_context, tabId) {
    if (!process.env.IS_ELECTRON) return null
    return await window.ftElectron.tabs.duplicate(tabId)
  },

  moveTab(_context, { tabId, toIndex }) {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.tabs.move(tabId, toIndex)
    }
  },

  reorderTabs({ commit }, tabIds) {
    if (process.env.IS_ELECTRON) {
      const requestId = window.crypto.randomUUID()
      commit('reorderTabsOptimistically', { tabIds, requestId })
      window.ftElectron.tabs.reorder(tabIds, requestId)
    }
  },

  setTabPinned(_context, { tabId, isPinned }) {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.tabs.setPinned(tabId, isPinned)
    }
  },

  setTabColor(_context, { tabId, color }) {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.tabs.setColor(tabId, color)
    }
  },

  async restoreClosedTab(_context, closedTabId = null) {
    if (process.env.IS_CAPACITOR) {
      return await getCapacitorTabService().restoreClosedTab()
    }
    if (!process.env.IS_ELECTRON) return null
    return await window.ftElectron.tabs.restoreClosed(closedTabId)
  },

  async clearClosedTabs() {
    if (!process.env.IS_ELECTRON) return false
    return await window.ftElectron.tabs.clearClosed()
  },

  async createTabGroup(_context, group) {
    if (!process.env.IS_ELECTRON) return null
    return await window.ftElectron.tabs.createGroup(group)
  },

  async updateTabGroup(_context, { groupId, changes }) {
    if (!process.env.IS_ELECTRON) return false
    return await window.ftElectron.tabs.updateGroup(groupId, changes)
  },

  async deleteTabGroup(_context, groupId) {
    if (!process.env.IS_ELECTRON) return false
    return await window.ftElectron.tabs.deleteGroup(groupId)
  },

  async setTabsGroup(_context, { tabIds, groupId }) {
    if (!process.env.IS_ELECTRON) return 0
    return await window.ftElectron.tabs.setGroup(tabIds, groupId)
  },

  async runTabOrganizerAction(_context, { action, tabIds }) {
    if (!process.env.IS_ELECTRON) return { success: false, hasRemainingTabs: true }
    return await window.ftElectron.tabs.runOrganizerAction(action, tabIds)
  },

  reloadTab(_context, tabId) {
    if (process.env.IS_CAPACITOR && tabId) {
      return getCapacitorTabService().reloadTab(tabId)
    }
    if (process.env.IS_ELECTRON && tabId) {
      window.ftElectron.tabs.reload(tabId)
    }
  },

  reloadActiveTab({ state, dispatch }) {
    if (state.activeTabId) {
      dispatch('reloadTab', state.activeTabId)
    }
  },

  nextTab({ state }) {
    if (!process.env.IS_ELECTRON || state.tabs.length <= 1) return
    const currentIndex = state.tabs.findIndex(tab => tab.id === state.activeTabId)
    window.ftElectron.tabs.activate(state.tabs[(currentIndex + 1) % state.tabs.length].id)
  },

  prevTab({ state }) {
    if (!process.env.IS_ELECTRON || state.tabs.length <= 1) return
    const currentIndex = state.tabs.findIndex(tab => tab.id === state.activeTabId)
    window.ftElectron.tabs.activate(state.tabs[(currentIndex - 1 + state.tabs.length) % state.tabs.length].id)
  }
}

function stripDocumentTitle(title) {
  if (title === packageDetails.productName) return ''
  return formatTabTitle(title)
}

export { normalizeRoute, cloneRoute } from '../../tabs/tabSessionModel.js'

export default {
  state,
  getters,
  mutations,
  actions
}
