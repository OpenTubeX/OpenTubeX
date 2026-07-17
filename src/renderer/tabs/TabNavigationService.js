import { computed, nextTick } from 'vue'
import { START_LOCATION } from 'vue-router'

import packageDetails from '../../../package.json'
import { translateWindowTitle } from '../helpers/strings'
import { cloneRoute, normalizeRoute } from '../store/modules/tabs'
import { tabLifecycleService } from './TabLifecycleService'
import { tabMediaCoordinator } from './TabMediaCoordinator'
import { tabRuntimeRegistry } from './TabRuntimeRegistry'

const TAB_ROUTE_LOADING_MIN_MS = 450
const TAB_ROUTE_LOADING_SOURCE = 'route'
const MAX_LOGICAL_HISTORY_ENTRIES = 100

let service = null

export function initializeTabNavigationService(router, store) {
  service = new TabNavigationService(router, store)
  return service
}

export function getTabNavigationService() {
  if (!service) {
    throw new Error('Tab navigation service has not been initialized')
  }
  return service
}

export class TabNavigationService {
  constructor(router, store) {
    this.router = router
    this.store = store
    this.latestTransitionRequestId = 0
    this.transitionQueue = Promise.resolve()
    this.staleTransitionResolvers = new Map()
    this.loadingSourcesByTabId = new Map()
    this.navigationQueuesByTabId = new Map()
    this.routeLoadingStateByTabId = new Map()
    this.beforeEachHooksByTabId = new Map()
    this.afterEachHooksByTabId = new Map()
  }

  requestPresentation(tabId, revision) {
    if (!tabId || !Number.isInteger(revision)) {
      return Promise.resolve(false)
    }

    const requestId = ++this.latestTransitionRequestId
    for (const [olderRequestId, resolve] of this.staleTransitionResolvers) {
      if (olderRequestId < requestId) {
        this.staleTransitionResolvers.delete(olderRequestId)
        resolve(false)
      }
    }

    this.transitionQueue = this.transitionQueue
      .catch(error => console.error('Logical tab transition failed:', error))
      .then(() => this.presentTab(tabId, revision, requestId))

    return this.transitionQueue
  }

  async presentTab(tabId, revision, requestId) {
    if (this.isTransitionStale(tabId, revision, requestId)) {
      return false
    }

    this.store.commit('setTabTransition', { revision, tabId })
    let targetTab = this.store.getters.getTabById(tabId)
    if (!targetTab) {
      return false
    }

    const resolvedTargetRoute = this.resolve(targetTab.route)
    if (typeof resolvedTargetRoute.name === 'string') {
      this.setTitle(tabId, routeTitle(resolvedTargetRoute))
    }

    if (targetTab.loadState === 'mounting') {
      const mounted = await Promise.race([
        tabRuntimeRegistry.waitForMount(tabId, targetTab.mountRevision),
        new Promise(resolve => this.staleTransitionResolvers.set(requestId, resolve))
      ])
      this.staleTransitionResolvers.delete(requestId)

      if (!mounted || this.isTransitionStale(tabId, revision, requestId)) {
        return false
      }
    }

    const outgoingTabId = this.store.getters.getPresentedTabId
    if (outgoingTabId && outgoingTabId !== tabId) {
      this.saveScroll(outgoingTabId)
      // The single renderer only paints the presented tab, so a backgrounded tab
      // (display:none) can't be captured on demand. Snapshot the outgoing tab now,
      // while it is still the painted/presented one, so its switcher preview stays
      // fresh. Main persists the result; a failure just keeps the previous cache.
      await this.captureLeavingTabPreview(outgoingTabId)
      if (this.isTransitionStale(tabId, revision, requestId)) {
        return false
      }
    }

    // The tab's route can change while we await mounting and the outgoing preview
    // capture (a same-tab navigation keeps activeTabId/selectionRevision, so
    // isTransitionStale won't catch it). Re-read the snapshot so projectRoute
    // projects the current route rather than the one captured before waiting.
    const refreshedTargetTab = this.store.getters.getTabById(tabId)
    if (!refreshedTargetTab) {
      return false
    }
    targetTab = refreshedTargetTab

    await this.projectRoute(targetTab.route)
    if (this.isTransitionStale(tabId, revision, requestId)) {
      return false
    }

    if (outgoingTabId && outgoingTabId !== tabId) {
      await tabLifecycleService.run(outgoingTabId, 'deactivate', { toTabId: tabId })
    }

    this.store.commit('setPresentedTab', tabId)
    tabMediaCoordinator.setPresented(tabId)
    this.projectTitle(tabId)

    await nextTick()
    await nextAnimationFrame()
    this.restoreScroll(tabId)

    await tabLifecycleService.run(tabId, 'activate', { fromTabId: outgoingTabId })
    if (this.isTransitionStale(tabId, revision, requestId)) {
      return false
    }

    window.ftElectron?.tabs?.presented?.(tabId, revision)
    return true
  }

  async captureLeavingTabPreview(tabId) {
    if (typeof window.ftElectron?.tabs?.capturePreview !== 'function') {
      return
    }

    try {
      await window.ftElectron.tabs.capturePreview(tabId)
    } catch {
      // A failed snapshot just leaves the previously cached preview in place.
    }
  }

  isTransitionStale(tabId, revision, requestId) {
    return requestId !== this.latestTransitionRequestId ||
      revision !== this.store.state.tabs.selectionRevision ||
      tabId !== this.store.state.tabs.activeTabId
  }

  getPresentedTabId() {
    return this.store.getters.getPresentedTabId ?? this.store.getters.getActiveTabId
  }

  async push(tabId, location) {
    return await this.navigate(tabId, location, 'push')
  }

  async pushPresented(location) {
    const tabId = this.store.getters.getPresentedTabId ?? this.store.getters.getActiveTabId
    if (tabId) {
      return await this.push(tabId, location)
    }
  }

  async replace(tabId, location) {
    return await this.navigate(tabId, location, 'replace')
  }

  prepareReload(tabId, location) {
    const tab = this.store.getters.getTabById(tabId)
    if (!tab) {
      return
    }

    const route = serializeResolvedRoute(this.resolve(location, this.resolve(tab.route)))
    this.saveScroll(tabId)
    this.store.commit('prepareTabReloadRoute', { tabId, route })
    this.publishRoute(tabId, route)
  }

  async go(tabId, offset) {
    const tab = this.store.getters.getTabById(tabId)
    if (!tab || !Number.isInteger(offset) || offset === 0) {
      return
    }

    const historyIndex = tab.historyIndex + offset
    if (historyIndex < 0 || historyIndex >= tab.history.length) {
      return
    }

    this.saveScroll(tabId)
    const targetEntry = tab.history[historyIndex]
    // Pass the offset, not a snapshot: an earlier queued push/replace may change
    // the live history before this navigation runs, so _performNavigate re-derives
    // the target from the live history inside the queue.
    await this.navigate(tabId, targetEntry.route, 'history', { offset })
  }

  back(tabId) {
    return this.go(tabId, -1)
  }

  forward(tabId) {
    return this.go(tabId, 1)
  }

  async navigate(tabId, location, mode, historyState = null) {
    // Serialise navigations per tab so concurrent callers (e.g. a component
    // mounting and a lifecycle hook both pushing) don't read the same history
    // snapshot and clobber each other's setTabNavigation commit.
    const previous = this.navigationQueuesByTabId.get(tabId) ?? Promise.resolve()
    const run = previous
      .catch(() => {})
      .then(() => this._performNavigate(tabId, location, mode, historyState))
    this.navigationQueuesByTabId.set(tabId, run)

    try {
      return await run
    } finally {
      if (this.navigationQueuesByTabId.get(tabId) === run) {
        this.navigationQueuesByTabId.delete(tabId)
      }
    }
  }

  async _performNavigate(tabId, location, mode, historyState = null) {
    const tab = this.store.getters.getTabById(tabId)
    if (!tab) {
      return
    }

    // Re-derive history navigation from the live tab inside the queue: the
    // snapshot go() captured may be stale if an earlier queued push/replace
    // already changed the history and index.
    let historyTargetIndex
    if (mode === 'history') {
      historyTargetIndex = tab.historyIndex + historyState.offset
      if (historyTargetIndex < 0 || historyTargetIndex >= tab.history.length) {
        return
      }
      location = tab.history[historyTargetIndex].route
    }

    const from = this.resolve(tab.route)
    const to = this.resolve(location, from)
    const route = serializeResolvedRoute(to)
    const sameRoute = route.fullPath === tab.route.fullPath

    if (mode === 'push' && sameRoute) {
      return
    }

    this.saveScroll(tabId)
    const loadingToken = location?.state?.skipTabRouteLoading === true
      ? null
      : this.startRouteLoading(tabId)

    try {
      const componentChanged = getDeepestRouteComponent(from) !== getDeepestRouteComponent(to)
      if (componentChanged) {
        await tabLifecycleService.run(tabId, 'beforeNavigate', { to, from })
      }

      for (const hook of this.beforeEachHooksByTabId.get(tabId) ?? []) {
        const result = await hook(to, from)
        if (result === false) {
          return
        }
      }

      let history
      let historyIndex
      if (mode === 'history') {
        history = tab.history.map(cloneHistoryEntry)
        historyIndex = historyTargetIndex
      } else if (mode === 'replace') {
        history = tab.history.map(cloneHistoryEntry)
        historyIndex = tab.historyIndex
        history[historyIndex] = {
          route: cloneRoute(route),
          title: history[historyIndex]?.title || routeTitle(to),
          scroll: sameRoute ? { ...history[historyIndex]?.scroll } : { left: 0, top: 0 }
        }
      } else {
        history = tab.history.slice(0, tab.historyIndex + 1).map(cloneHistoryEntry)
        history.push({
          route: cloneRoute(route),
          title: routeTitle(to),
          scroll: { left: 0, top: 0 }
        })
        if (history.length > MAX_LOGICAL_HISTORY_ENTRIES) {
          history = history.slice(-MAX_LOGICAL_HISTORY_ENTRIES)
        }
        historyIndex = history.length - 1
      }

      this.store.commit('setTabNavigation', { tabId, route, history, historyIndex })
      if (typeof to.name === 'string') {
        this.setTitle(tabId, routeTitle(to))
      }
      this.publishRoute(tabId, route)

      if (this.store.getters.getPresentedTabId === tabId) {
        await this.projectRoute(route)
        await nextTick()
        await nextAnimationFrame()
        this.restoreScroll(tabId)
        this.projectTitle(tabId)
      }

      for (const hook of this.afterEachHooksByTabId.get(tabId) ?? []) {
        await hook(to, from)
      }

      await tabLifecycleService.run(tabId, 'afterNavigate', { to, from })
    } finally {
      if (loadingToken !== null) {
        this.finishRouteLoading(tabId, loadingToken)
      }
    }
  }

  resolve(location, currentRoute = START_LOCATION) {
    return this.router.resolve(location, currentRoute)
  }

  createPresentedRouterFacade() {
    const facade = Object.create(this.router)
    Object.defineProperties(facade, {
      currentRoute: { value: this.router.currentRoute },
      push: { value: location => this.pushPresented(location) },
      replace: {
        value: location => {
          const tabId = this.store.getters.getPresentedTabId ?? this.store.getters.getActiveTabId
          return tabId ? this.replace(tabId, location) : Promise.resolve()
        }
      },
      go: {
        value: offset => {
          const tabId = this.store.getters.getPresentedTabId ?? this.store.getters.getActiveTabId
          return tabId ? this.go(tabId, offset) : Promise.resolve()
        }
      },
      back: { value: () => facade.go(-1) },
      forward: { value: () => facade.go(1) }
    })
    return facade
  }

  createRouterFacade(tabId) {
    const currentRoute = computed(() => {
      const tab = this.store.getters.getTabById(tabId)
      return this.resolve(tab?.route ?? '/')
    })
    const facade = Object.create(this.router)

    Object.defineProperties(facade, {
      currentRoute: { value: currentRoute },
      push: { value: location => this.push(tabId, location) },
      replace: { value: location => this.replace(tabId, location) },
      go: { value: offset => this.go(tabId, offset) },
      back: { value: () => this.back(tabId) },
      forward: { value: () => this.forward(tabId) },
      resolve: { value: location => this.resolve(location, currentRoute.value) },
      beforeEach: { value: hook => this.registerRouterHook(this.beforeEachHooksByTabId, tabId, hook) },
      afterEach: { value: hook => this.registerRouterHook(this.afterEachHooksByTabId, tabId, hook) }
    })

    return facade
  }

  registerRouterHook(registry, tabId, hook) {
    let hooks = registry.get(tabId)
    if (!hooks) {
      hooks = new Set()
      registry.set(tabId, hooks)
    }
    hooks.add(hook)

    return () => {
      hooks.delete(hook)
      if (hooks.size === 0) {
        registry.delete(tabId)
      }
    }
  }

  saveScroll(tabId) {
    if (this.store.getters.getPresentedTabId !== tabId) {
      return
    }

    const tab = this.store.getters.getTabById(tabId)
    if (!tab) {
      return
    }

    this.store.commit('setHistoryEntryScroll', {
      tabId,
      historyIndex: tab.historyIndex,
      scroll: { left: window.scrollX, top: window.scrollY }
    })
  }

  restoreScroll(tabId) {
    const tab = this.store.getters.getTabById(tabId)
    const scroll = tab?.history[tab.historyIndex]?.scroll ?? { left: 0, top: 0 }
    window.scrollTo({ left: scroll.left, top: scroll.top, behavior: 'instant' })
  }

  setTitle(tabId, title) {
    if (typeof title !== 'string') {
      return
    }

    this.store.commit('setTabContentTitle', { tabId, title })
    window.ftElectron?.tabs?.updateTitle?.(formatDocumentTitle(title), tabId)

    if (this.store.getters.getPresentedTabId === tabId) {
      this.store.commit('setAppTitle', title)
    }
  }

  projectTitle(tabId) {
    const tab = this.store.getters.getTabById(tabId)
    if (tab) {
      this.store.commit('setAppTitle', tab.contentTitle || tab.title || '')
    }
  }

  publishRoute(tabId, route) {
    window.ftElectron?.tabs?.updateRoute?.({
      tabId,
      route: cloneRoute(route),
      url: urlFromRoute(route)
    })
    window.ftElectron?.tabs?.requestPreviewRefresh?.({ tabId })
  }

  async projectRoute(route) {
    const resolved = this.resolve(route)
    if (this.router.currentRoute.value.fullPath !== resolved.fullPath) {
      await this.router.replace({
        path: resolved.path,
        query: resolved.query,
        hash: resolved.hash
      })
    }
  }

  setLoadingSource(tabId, source, isLoading) {
    let sources = this.loadingSourcesByTabId.get(tabId)
    if (!sources) {
      sources = new Set()
      this.loadingSourcesByTabId.set(tabId, sources)
    }

    if (isLoading) {
      sources.add(source)
    } else {
      sources.delete(source)
    }

    if (sources.size === 0) {
      this.loadingSourcesByTabId.delete(tabId)
    }
    window.ftElectron?.tabs?.setLoading?.(sources.size > 0, tabId)
  }

  startRouteLoading(tabId) {
    const previous = this.routeLoadingStateByTabId.get(tabId)
    if (previous?.timeoutId != null) {
      window.clearTimeout(previous.timeoutId)
    }

    const token = (previous?.token ?? 0) + 1
    this.routeLoadingStateByTabId.set(tabId, {
      token,
      startedAt: Date.now(),
      timeoutId: null
    })
    this.setLoadingSource(tabId, TAB_ROUTE_LOADING_SOURCE, true)
    return token
  }

  finishRouteLoading(tabId, token) {
    const state = this.routeLoadingStateByTabId.get(tabId)
    if (!state || state.token !== token) {
      return
    }

    const delay = Math.max(0, TAB_ROUTE_LOADING_MIN_MS - (Date.now() - state.startedAt))
    state.timeoutId = window.setTimeout(() => {
      const current = this.routeLoadingStateByTabId.get(tabId)
      if (current?.token === token) {
        this.routeLoadingStateByTabId.delete(tabId)
        this.setLoadingSource(tabId, TAB_ROUTE_LOADING_SOURCE, false)
      }
    }, delay)
  }

  disposeTab(tabId) {
    this.loadingSourcesByTabId.delete(tabId)
    this.navigationQueuesByTabId.delete(tabId)
    const routeLoadingState = this.routeLoadingStateByTabId.get(tabId)
    if (routeLoadingState?.timeoutId != null) {
      window.clearTimeout(routeLoadingState.timeoutId)
    }
    this.routeLoadingStateByTabId.delete(tabId)
    this.beforeEachHooksByTabId.delete(tabId)
    this.afterEachHooksByTabId.delete(tabId)
    tabRuntimeRegistry.dispose(tabId)
    tabLifecycleService.clear(tabId)
    tabMediaCoordinator.unregister(tabId)
    window.ftElectron?.tabs?.setLoading?.(false, tabId)
  }
}

function serializeResolvedRoute(route) {
  return normalizeRoute({
    name: typeof route.name === 'string' ? route.name : null,
    path: route.path,
    params: route.params,
    query: route.query,
    hash: route.hash,
    fullPath: route.fullPath
  })
}

function cloneHistoryEntry(entry) {
  return {
    route: cloneRoute(entry.route),
    title: entry.title,
    scroll: { ...entry.scroll }
  }
}

function routeTitle(route) {
  return typeof route.meta?.title === 'string'
    ? translateWindowTitle(route.meta.title) ?? route.meta.title
    : route.fullPath
}

function getDeepestRouteComponent(route) {
  return route.matched.at(-1)?.components?.default ?? null
}

function urlFromRoute(route) {
  return `${window.location.origin}${window.location.pathname}#${route.fullPath}`
}

function nextAnimationFrame() {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

function formatDocumentTitle(title) {
  return title.length > 0 ? `${title} - ${packageDetails.productName}` : packageDetails.productName
}

export default TabNavigationService
