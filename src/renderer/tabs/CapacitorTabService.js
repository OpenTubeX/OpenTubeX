import {
  activateCapacitorTab,
  addCapacitorTab,
  closeCapacitorTab,
  createCapacitorTab,
  moveCapacitorTab,
  restoreClosedCapacitorTab,
  restoreCapacitorTabSession,
  setCapacitorTabPinned,
  toRuntimeTabState
} from './capacitorTabState'

const STORAGE_KEY = 'opentubex-capacitor-tabs'
const PERSISTED_MUTATIONS = new Set([
  'setHistoryEntryScroll',
  'setPresentedTab',
  'setTabContentTitle',
  'setTabNavigation',
  'setTabsState'
])

let service = null

export function initializeCapacitorTabService(router, store, navigation) {
  service?.dispose()
  service = new CapacitorTabService(router, store, navigation)
  return service
}

export function getCapacitorTabService() {
  if (!service) throw new Error('Capacitor tab service has not been initialized')
  return service
}

class CapacitorTabService {
  constructor(router, store, navigation) {
    this.router = router
    this.store = store
    this.navigation = navigation
    this.initialized = false
    this.removeRouterHook = () => {}
    this.removeStoreSubscription = () => {}
  }

  async initialize(currentRoute) {
    if (this.initialized) return

    const persisted = readPersistedSession()
    this.sessionUpdatedAt = Number.isFinite(persisted?.updatedAt)
      ? persisted.updatedAt
      : Date.now()
    const session = restoreCapacitorTabSession(
      persisted,
      currentRoute
    )
    this.commitSession(session)
    this.store.commit('setPresentedTab', session.activeTabId)
    this.initialized = true

    this.removeRouterHook = this.router.afterEach((to, _from, failure) => {
      if (failure || !this.initialized) return

      const tabId = this.store.getters.getActiveTabId
      const tab = this.store.getters.getTabById(tabId)
      if (!tab || tab.route.fullPath === to.fullPath) return

      this.navigation.push(tabId, to).catch(error => {
        console.error('Failed to record Capacitor tab navigation:', error)
      })
    })
    this.removeStoreSubscription = this.store.subscribe((mutation) => {
      if (PERSISTED_MUTATIONS.has(mutation.type)) this.persist()
    })

    const activeTab = this.store.getters.getActiveTab
    if (activeTab?.route.fullPath !== this.router.currentRoute.value.fullPath) {
      await this.navigation.projectRoute(activeTab.route)
      this.navigation.restoreScroll(activeTab.id)
    }
    this.navigation.projectTitle(session.activeTabId)
    this.persist()
  }

  async createTab(location = `/${this.store.getters.getLandingPage}`, title = '') {
    const tab = createCapacitorTab(this.router.resolve(location), title)
    const session = addCapacitorTab(this.currentSession(), tab)
    this.commitSession(session)
    await this.navigation.requestPresentation(session.activeTabId, session.selectionRevision)
    return tab.id
  }

  async activateTab(tabId) {
    const previous = this.currentSession()
    const session = activateCapacitorTab(previous, tabId)
    if (session === previous) return false

    this.commitSession(session)
    return await this.navigation.requestPresentation(tabId, session.selectionRevision)
  }

  async duplicateTab(tabId) {
    const source = this.store.getters.getTabById(tabId)
    if (!source) return null

    const tab = createCapacitorTab(source.route)
    tab.title = source.contentTitle || source.title || source.route.fullPath
    const session = addCapacitorTab(this.currentSession(), tab)
    this.commitSession(session)
    await this.navigation.requestPresentation(session.activeTabId, session.selectionRevision)
    return tab.id
  }

  async closeTab(tabId) {
    const previous = this.currentSession()
    if (!previous.tabs.some(tab => tab.id === tabId)) return false

    const wasActive = previous.activeTabId === tabId
    if (wasActive) this.navigation.saveScroll(tabId)

    const landingRoute = this.router.resolve(`/${this.store.getters.getLandingPage}`)
    const session = closeCapacitorTab(previous, tabId, landingRoute)
    this.commitSession(session)

    if (wasActive) {
      await this.navigation.requestPresentation(session.activeTabId, session.selectionRevision)
    }
    return true
  }

  async restoreClosedTab() {
    const previous = this.currentSession()
    const session = restoreClosedCapacitorTab(previous)
    if (session === previous) return null

    this.commitSession(session)
    await this.navigation.requestPresentation(session.activeTabId, session.selectionRevision)
    return session.activeTabId
  }

  getSyncSessions() {
    const session = this.currentSession()
    return [{
      sessionId: 'mobile',
      updatedAt: this.sessionUpdatedAt,
      activeTabId: session.activeTabId,
      tabs: session.tabs.map(tab => ({
        id: tab.id,
        url: new URL(tab.route.fullPath, window.location.origin).toString(),
        title: tab.title,
        isPinned: tab.isPinned,
      })),
    }]
  }

  async applySyncSessions(sessions) {
    const synced = sessions.find(session => Array.isArray(session?.tabs) && session.tabs.length > 0)
    if (!synced) return false

    const tabs = synced.tabs.map(tab => createCapacitorTab(
      this.router.resolve(syncTabRoute(tab.url)),
      tab.title,
      tab.id
    )).map((tab, index) => ({
      ...tab,
      isPinned: synced.tabs[index].isPinned === true,
    }))
    const session = restoreCapacitorTabSession({
      tabs,
      activeTabId: tabs.some(tab => tab.id === synced.activeTabId)
        ? synced.activeTabId
        : tabs[0].id,
      closedTabs: [],
    }, this.router.currentRoute.value)
    this.sessionUpdatedAt = Number.isFinite(synced.updatedAt) ? synced.updatedAt : Date.now()
    this.commitSession(session)
    await this.navigation.requestPresentation(session.activeTabId, session.selectionRevision)
    this.persist()
    return true
  }

  async openSyncedSession(session) {
    if (!Array.isArray(session?.tabs) || session.tabs.length === 0) return false

    for (const tab of session.tabs) {
      const tabId = await this.createTab(syncTabRoute(tab.url), tab.title)
      if (tab.isPinned === true) this.setPinned(tabId, true)
    }
    return true
  }

  setPinned(tabId, pinned) {
    const previous = this.currentSession()
    const session = setCapacitorTabPinned(previous, tabId, pinned)
    if (session === previous) return false

    this.commitSession(session)
    return true
  }

  moveTab(tabId, targetIndex) {
    const previous = this.currentSession()
    const session = moveCapacitorTab(previous, tabId, targetIndex)
    if (session === previous) return false

    this.commitSession(session)
    return true
  }

  currentSession() {
    return {
      tabs: this.store.getters.getTabs.map(tab => ({
        id: tab.id,
        title: tab.contentTitle || tab.title || tab.route.fullPath,
        isPinned: tab.isPinned === true,
        route: tab.route,
        history: tab.history,
        historyIndex: tab.historyIndex
      })),
      closedTabs: this.store.getters.getClosedTabs.toReversed().map(tab => ({
        id: tab.id,
        title: tab.title || tab.route.fullPath,
        isPinned: tab.isPinned === true,
        route: tab.route,
        history: tab.history,
        historyIndex: tab.historyIndex
      })),
      activeTabId: this.store.getters.getActiveTabId,
      selectionRevision: this.store.state.tabs.selectionRevision,
      updatedAt: this.sessionUpdatedAt,
    }
  }

  commitSession(session) {
    this.store.commit('setTabsState', toRuntimeTabState(session))
  }

  persist() {
    try {
      this.sessionUpdatedAt = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentSession()))
    } catch (error) {
      console.error('Failed to persist Capacitor tabs:', error)
    }
  }

  dispose() {
    this.removeRouterHook()
    this.removeStoreSubscription()
    this.initialized = false
  }
}

function syncTabRoute(value) {
  try {
    const url = new URL(value, window.location.origin)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

function readPersistedSession() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === null ? null : JSON.parse(value)
  } catch (error) {
    console.error('Failed to restore Capacitor tabs:', error)
    return null
  }
}
