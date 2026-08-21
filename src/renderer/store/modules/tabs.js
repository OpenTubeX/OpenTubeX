import packageDetails from '../../../../package.json'
import { getTabPageIcon } from '../../tabs/tabPageIcon'
import { DEFAULT_VIDEO_ZOOM } from '../../helpers/player/videoZoom'

const MAX_LOGICAL_HISTORY_ENTRIES = 100
const NAV_HISTORY_DISPLAY_LIMIT = 15
const HALF_NAV_HISTORY_DISPLAY_LIMIT = Math.trunc(NAV_HISTORY_DISPLAY_LIMIT / 2)

const state = {
  tabs: [],
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
  skipSilenceByTabId: {}
}

const getters = {
  getTabs: (state) => state.tabs,
  getActiveTabId: (state) => state.activeTabId,
  getActiveTab: (state) => state.tabs.find(tab => tab.id === state.activeTabId) ?? null,
  getSelectedTabIds: (state) => state.selectedTabIds,
  getPresentedTabId: (state) => state.presentedTabId,
  getPresentedTab: (state) => state.tabs.find(tab => tab.id === state.presentedTabId) ?? null,
  getTabById: (state) => (tabId) => state.tabs.find(tab => tab.id === tabId) ?? null,
  getTabCount: (state) => state.tabs.length,
  getTabContainerIds: (state) => state.containerIds,
  getTabBarScrollPosition: (state) => state.tabBarScrollPosition,
  getCurrentWatchTimestamp: (state) => state.currentWatchTimestamps[state.activeTabId] ?? null,
  getWatchTimestamp: (state) => (tabId) => state.currentWatchTimestamps[tabId] ?? null,
  getTabVideoZoom: (state) => (tabId) => state.videoZoomByTabId[tabId] ?? DEFAULT_VIDEO_ZOOM,
  getTabSkipSilence: (state) => (tabId) => state.skipSilenceByTabId[tabId] ?? false,
  getTabHistoryState: (state) => (tabId) => {
    const tab = state.tabs.find(candidate => candidate.id === tabId)
    if (!tab) {
      return { canGoBack: false, canGoForward: false, options: [] }
    }

    const historyLength = tab.history.length
    let end
    if (tab.historyIndex < HALF_NAV_HISTORY_DISPLAY_LIMIT) {
      end = Math.min(historyLength - 1, NAV_HISTORY_DISPLAY_LIMIT - 1)
    } else if (historyLength - tab.historyIndex < HALF_NAV_HISTORY_DISPLAY_LIMIT + 1) {
      end = historyLength - 1
    } else {
      end = tab.historyIndex + HALF_NAV_HISTORY_DISPLAY_LIMIT
    }

    const options = []
    for (let index = end; index >= Math.max(0, end + 1 - NAV_HISTORY_DISPLAY_LIMIT); index--) {
      const entry = tab.history[index]
      options.push({
        label: entry.title || entry.route.fullPath,
        value: index - tab.historyIndex,
        active: index === tab.historyIndex,
        icon: getTabPageIcon(entry)
      })
    }

    return {
      canGoBack: tab.historyIndex > 0,
      canGoForward: tab.historyIndex < historyLength - 1,
      options
    }
  }
}

const mutations = {
  setTabsState(state, payload = {}) {
    const previousTabsById = new Map(state.tabs.map(tab => [tab.id, tab]))
    const incomingTabs = Array.isArray(payload.tabs) ? payload.tabs : []
    const incomingIds = new Set(incomingTabs.map(tab => tab.id))

    state.containerIds = state.containerIds.filter(tabId => incomingIds.has(tabId))
    for (const tab of incomingTabs) {
      if (!state.containerIds.includes(tab.id)) {
        state.containerIds.push(tab.id)
      }
    }

    state.tabs = incomingTabs.map(tab => reconcileTab(previousTabsById.get(tab.id), tab))
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

  reorderTabs(_context, tabIds) {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.tabs.reorder(tabIds)
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

  async restoreClosedTab() {
    if (!process.env.IS_ELECTRON) return null
    return await window.ftElectron.tabs.restoreClosed()
  },

  reloadTab(_context, tabId) {
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

function reconcileTab(previous, incoming) {
  const incomingRoute = normalizeRoute(incoming.route ?? routeFromUrl(incoming.url))
  if (!previous) {
    return createRuntimeTab(incoming, incomingRoute)
  }

  let history = previous.history
  let historyIndex = previous.historyIndex
  let route = previous.route
  let pendingReloadRoute = previous.pendingReloadRoute
  let contentTitle = previous.contentTitle

  // Ordinary incoming routes echo renderer-owned navigation and can be stale.
  // A sync revision explicitly hands authority to the remote session instead.
  if (
    Number.isInteger(incoming.syncedNavigationRevision) &&
    incoming.syncedNavigationRevision !== previous.syncedNavigationRevision
  ) {
    const title = stripDocumentTitle(incoming.title || incomingRoute.fullPath)
    const restored = restoredHistoryState(incoming, incomingRoute, title)
    history = restored.history
    historyIndex = restored.historyIndex
    route = incomingRoute
    pendingReloadRoute = null
    contentTitle = title
  } else if (incoming.loadState === 'unloaded' && previous.loadState !== 'unloaded') {
    const currentEntry = normalizeHistoryEntry(history[historyIndex] ?? { route })
    history = [currentEntry]
    historyIndex = 0
    route = currentEntry.route
  }

  return {
    ...previous,
    ...incoming,
    route,
    history,
    historyIndex,
    pendingReloadRoute,
    contentTitle,
    refreshKey: incoming.refreshKey ?? previous.refreshKey ?? 0
  }
}

function createRuntimeTab(incoming, route) {
  const title = stripDocumentTitle(incoming.title || route.fullPath)
  return {
    ...incoming,
    route,
    ...restoredHistoryState(incoming, route, title),
    pendingReloadRoute: null,
    contentTitle: title,
    refreshKey: incoming.refreshKey ?? 0
  }
}

/**
 * Seed a new runtime tab's back/forward history from a persisted history
 * (restored tab sessions), falling back to a single entry for the current
 * route. The tab's live route and title stay authoritative for the current
 * entry, as persisted history can lag slightly behind them.
 */
function restoredHistoryState(incoming, route, title) {
  if (!Array.isArray(incoming.history) || incoming.history.length === 0) {
    return {
      history: [{ route: cloneRoute(route), title, scroll: { left: 0, top: 0 } }],
      historyIndex: 0
    }
  }

  const history = incoming.history.map(normalizeHistoryEntry)
  const historyIndex = Number.isInteger(incoming.historyIndex)
    ? Math.max(0, Math.min(incoming.historyIndex, history.length - 1))
    : history.length - 1

  const currentEntry = history[historyIndex]
  if (currentEntry.route.fullPath !== route.fullPath) {
    currentEntry.route = cloneRoute(route)
  }
  if (title) {
    currentEntry.title = title
  }

  return { history, historyIndex }
}

export function normalizeRoute(route) {
  const path = typeof route?.path === 'string' && route.path.length > 0
    ? route.path
    : '/'
  const query = normalizeQuery(route?.query)
  const hash = typeof route?.hash === 'string' ? route.hash : ''
  const fullPath = typeof route?.fullPath === 'string' && route.fullPath.length > 0
    ? route.fullPath
    : buildFullPath(path, query, hash)

  return {
    name: typeof route?.name === 'string' ? route.name : null,
    path: path.startsWith('/') ? path : `/${path}`,
    params: normalizeQuery(route?.params),
    query,
    hash,
    fullPath
  }
}

export function cloneRoute(route) {
  const normalized = normalizeRoute(route)
  return {
    ...normalized,
    params: { ...normalized.params },
    query: cloneQuery(normalized.query)
  }
}

function normalizeHistoryEntry(entry) {
  return {
    route: cloneRoute(entry?.route),
    title: typeof entry?.title === 'string' ? entry.title : entry?.route?.fullPath || '/',
    titlePending: entry?.titlePending === true,
    scroll: normalizeScroll(entry?.scroll)
  }
}

function normalizeScroll(scroll) {
  return {
    left: Number.isFinite(scroll?.left) ? scroll.left : 0,
    top: Number.isFinite(scroll?.top) ? scroll.top : 0
  }
}

function normalizeQuery(query) {
  if (!query || typeof query !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])
  )
}

function cloneQuery(query) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
  )
}

function buildFullPath(path, query, hash) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, item)
    }
  }
  const queryString = search.toString()
  return `${path.startsWith('/') ? path : `/${path}`}${queryString ? `?${queryString}` : ''}${hash}`
}

function stripDocumentTitle(title) {
  const suffix = ` - ${packageDetails.productName}`
  if (title === packageDetails.productName) {
    return ''
  }
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title
}

function searchParamsToQuery(searchParams) {
  const query = {}
  for (const [key, value] of searchParams) {
    if (key in query) {
      const existing = query[key]
      query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      query[key] = value
    }
  }
  return query
}

function routeFromUrl(url) {
  try {
    const parsed = new URL(url)
    const hashRoute = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
    const routeUrl = new URL(hashRoute || '/', parsed.origin)
    return normalizeRoute({
      path: routeUrl.pathname,
      query: searchParamsToQuery(routeUrl.searchParams),
      hash: routeUrl.hash
    })
  } catch {
    return normalizeRoute({ path: '/' })
  }
}

export default {
  state,
  getters,
  mutations,
  actions
}
