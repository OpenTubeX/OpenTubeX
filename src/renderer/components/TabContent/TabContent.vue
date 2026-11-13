<template>
  <div
    v-show="isPresented || isSwipeFrom || isSwipeTarget || isPrewarmed"
    ref="tabContentRef"
    class="tabContent"
    :class="{
      pageSwipeFrom: isSwipeFrom,
      pageSwipeTo: isSwipeTarget,
      pageSwipePresented: isPresented && isCapacitor,
      pageSwipePrewarm: isPrewarmed,
      pageSwipeSettling: pageSwipe?.settling,
      hasWatchPreview: watchPreviewing
    }"
    :style="pageSwipeStyle"
    :data-tab-id="tab.id"
    :inert="!isPresented"
    :aria-hidden="String(!isPresented)"
  >
    <div
      v-if="isCapacitor && isSwipeTarget && !initialized"
      class="pageSwipePlaceholder"
    >
      <CapacitorTabPreview :tab="tab" />
      <span dir="auto">{{ tab.contentTitle || tab.title || tab.route.fullPath }}</span>
    </div>
    <template v-if="browsingInitialized">
      <template
        v-for="page in pages"
        :key="`${tab.refreshKey || 0}:${page.key}`"
      >
        <TabBrowsingPage
          :tab-id="tab.id"
          :route="page.route"
          :current="page.key === currentPageKey"
          :presented="isBrowsingPresented && page.key === currentPageKey"
          class="routerView"
          :class="page.key === currentPageKey
            ? { browsingBehindWatch: isWatchRoute }
            : { retainedPage: true, retainedPagePreview: backReveal?.key === page.key }"
          :inert="isWatchRoute || page.key !== currentPageKey"
          :aria-hidden="String(isWatchRoute || page.key !== currentPageKey)"
        />
        <!-- Dims the page Back reveals, between it and the current page. -->
        <div
          v-if="page.key !== currentPageKey && backReveal?.key === page.key"
          class="retainedPageScrim"
        />
      </template>
    </template>
    <TabWatchContent
      v-if="initialized"
      ref="watchContent"
      :key="tab.refreshKey || 0"
      :tab-id="tab.id"
      :route="resolvedRoute"
      :presented="isPresented"
      @preview="watchPreviewing = $event"
    />
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  provide,
  ref,
  shallowRef,
  useTemplateRef,
  watch
} from 'vue'
import { routerKey } from 'vue-router'
import TabBrowsingPage from './TabBrowsingPage.vue'
import TabWatchContent from './TabWatchContent.vue'
import CapacitorTabPreview from '../TabBar/CapacitorTabPreview.vue'

import store from '../../store/index'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { tabLifecycleService } from '../../tabs/TabLifecycleService'
import { tabRuntimeRegistry } from '../../tabs/TabRuntimeRegistry'
import { playInBackgroundKey, tabIdKey, tabLifecycleKey } from '../../tabs/TabContext'
import { getPreviousBrowsingRoute, isPlayerRoutePath } from '../../tabs/playerDockDestination'
import { showTabPage } from '../../tabs/tabPages'
import { registerAndroidBackPage } from '../../helpers/androidBackGesture'
import { createAndroidBackPagePreview } from '../../helpers/androidBackPage'

const TAB_LOADER_SELECTOR = '[data-tab-loading-indicator]'
const TAB_LOADER_LOADING_SOURCE = 'loader'
const TAB_LOADER_SETTLE_DELAY_MS = 100
// Android keeps the page a tab leaves mounted, so Back can show it behind the
// predictive back gesture and return to it without reloading.
const RETAINS_PAGES = process.env.IS_CAPACITOR && !process.env.IS_IOS
const RETAINED_PAGE_LIMIT = 1

const props = defineProps({
  tab: {
    type: Object,
    required: true
  },
  pageSwipe: {
    type: Object,
    default: null
  },
  prewarm: {
    type: Boolean,
    default: false
  }
})

const isCapacitor = process.env.IS_CAPACITOR
const navigation = getTabNavigationService()
const tabContentRef = useTemplateRef('tabContentRef')
const watchContent = useTemplateRef('watchContent')
const isPresented = computed(() => store.getters.getPresentedTabId === props.tab.id)
const isSwipeFrom = computed(() => props.pageSwipe?.fromId === props.tab.id)
const isSwipeTarget = computed(() => props.pageSwipe?.toId === props.tab.id)
const isPrewarmed = computed(() => props.prewarm && !isPresented.value && !isSwipeFrom.value && !isSwipeTarget.value)
const pageSwipeStyle = computed(() => {
  if (isSwipeFrom.value) return { left: `${props.pageSwipe.offset}px` }
  if (isSwipeTarget.value) {
    const startingEdge = props.pageSwipe.direction
    const left = `${props.pageSwipe.offset + startingEdge * props.pageSwipe.width}px`
    // The document keeps the outgoing tab's scroll position. Offset the
    // incoming tab so it shows its own, which presentation then restores.
    if (isPresented.value) return { left, right: 'auto' }
    const savedTop = initialized.value ? props.tab.history[props.tab.historyIndex]?.scroll?.top ?? 0 : 0
    return { left, right: 'auto', top: `${props.pageSwipe.scrollTop - savedTop}px` }
  }
  return undefined
})
const shouldMount = computed(() => !props.tab.mountDeferred && props.tab.loadState !== 'unloaded' && props.tab.loadState !== 'unloading')
const initialized = ref(shouldMount.value)
// Main metadata snapshots replace the containing tab object frequently (title,
// loading, preview, playback, etc.). Resolve from the serialized fullPath so a
// metadata-only update does not manufacture a new route object and retrigger
// every deep route watcher in the mounted page.
const routeFullPath = computed(() => props.tab.route?.fullPath || '/')
const resolvedRoute = computed(() => navigation.resolve(routeFullPath.value))
const isWatchRoute = computed(() => isPlayerRoutePath(resolvedRoute.value.path))
const isBrowsingPresented = computed(() => isPresented.value && !isWatchRoute.value)
const browsingInitialized = ref(false)

/** The history entry of the browsing page, which stays mounted behind the player. */
function getBrowsingEntry(route) {
  const index = props.tab.historyIndex
  if (!isPlayerRoutePath(route.path)) return { index, route }
  const previous = getPreviousBrowsingRoute(props.tab)
  return previous
    ? { index: index - 1, route: navigation.resolve(previous) }
    : { index: -1, route: navigation.resolve('/subscriptions') }
}

function getEntryPath(index) {
  const entry = props.tab.history[index]
  return entry && navigation.resolve(entry.route).fullPath
}

let nextPageKey = 0
// Mounted browsing pages in history order. The last one is the page the tab shows.
const pages = shallowRef([])
const currentPageKey = computed(() => pages.value.at(-1)?.key)
// The retained page Back shows behind the current page while the gesture lasts.
const backReveal = shallowRef(null)

/** @param {{ key: number, top: number } | null} reveal */
async function setBackReveal(reveal) {
  backReveal.value = reveal
  // Offset through the preview class, so Vue never replaces the page's inline
  // styles and the offset ends in the same render that shows the page.
  if (reveal) tabContentRef.value?.style.setProperty('--retained-page-top', `${reveal.top}px`)
  else tabContentRef.value?.style.removeProperty('--retained-page-top')
  if (!reveal) return null
  await nextTick()
  const root = tabContentRef.value
  return root && {
    page: root.querySelector(':scope > .retainedPagePreview'),
    scrim: root.querySelector(':scope > .retainedPageScrim')
  }
}

watch([resolvedRoute, () => props.tab.historyIndex], ([route]) => {
  const target = getBrowsingEntry(route)
  if (RETAINS_PAGES) {
    // An unmounted tab keeps nothing, so mounting it loads only its current page.
    const limit = browsingInitialized.value ? RETAINED_PAGE_LIMIT : 0
    pages.value = showTabPage(pages.value, target, getEntryPath, () => ++nextPageKey, limit)
  } else if (pages.value[0]?.route.fullPath !== target.route.fullPath) {
    // Other platforms reuse one page, which follows the route like a RouterView.
    pages.value = [{ key: 0, index: target.index, route: target.route }]
  }
}, { immediate: true })

const watchPreviewing = ref(false)
// Background Watch tabs only need to preload the video. Mount their browsing
// page on first presentation, then retain it so a dock gesture can reveal it
// without mounting a route while the video is moving. Mobile swipe prewarming
// continues to prepare both views.
watch([initialized, isPresented, isWatchRoute], ([mounted, presented, watchRoute]) => {
  if (!mounted) {
    browsingInitialized.value = false
    // Mount only the current page again, rather than loading retained ones.
    pages.value = pages.value.slice(-1)
  } else if (isCapacitor || presented || !watchRoute) {
    browsingInitialized.value = true
  }
}, { immediate: true })

provide(tabIdKey, props.tab.id)
provide(playInBackgroundKey, location => watchContent.value?.playInBackground(location))
provide(tabLifecycleKey, tabLifecycleService)
provide('tabId', props.tab.id)
provide(routerKey, navigation.createRouterFacade(props.tab.id))

let removeRootRegistration = null
let removeAndroidBackPage = null
let loaderObserver = null
let loaderAnimationFrameId = null
let loaderSettleTimeoutId = null
let acknowledgedMountRevision = 0
let previousRefreshKey = props.tab.refreshKey ?? 0
let lifecycleRevision = 0
// Guards against notifying `beforeDispose` twice for the same mounted instance:
// the unload watcher and onBeforeUnmount can both fire for one instance. Reset
// when the tab mounts again so a subsequent mount receives one notification.
let disposalNotified = false
let pictureInPictureExitRequested = false

async function disposeMountedContent() {
  const pictureInPictureElement = document.pictureInPictureElement
  let exitPictureInPicture = Promise.resolve()
  if (
    !pictureInPictureExitRequested &&
    pictureInPictureElement &&
    tabContentRef.value?.contains(pictureInPictureElement)
  ) {
    pictureInPictureExitRequested = true
    try {
      exitPictureInPicture = document.exitPictureInPicture().catch(error => {
        console.error(`Failed to exit Picture-in-Picture for logical tab ${props.tab.id}:`, error)
      }).finally(() => {
        pictureInPictureExitRequested = false
      })
    } catch (error) {
      pictureInPictureExitRequested = false
      console.error(`Failed to exit Picture-in-Picture for logical tab ${props.tab.id}:`, error)
    }
  }

  const notifyBeforeDispose = disposalNotified
    ? Promise.resolve()
    : tabLifecycleService.run(props.tab.id, 'beforeDispose')

  disposalNotified = true
  await Promise.all([exitPictureInPicture, notifyBeforeDispose])
}

watch(
  [shouldMount, () => props.tab.mountRevision, () => props.tab.refreshKey],
  async ([mount, mountRevision, refreshKey]) => {
    const revision = ++lifecycleRevision
    if (!mount) {
      if (initialized.value && !disposalNotified) {
        await disposeMountedContent()
        if (revision !== lifecycleRevision || shouldMount.value) return
        initialized.value = false
      }
      navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, false)
      return
    }

    if (refreshKey !== previousRefreshKey) {
      await tabLifecycleService.run(props.tab.id, 'beforeReload')
      if (revision !== lifecycleRevision) return
      previousRefreshKey = refreshKey
      initialized.value = false
      await nextTick()
      if (revision !== lifecycleRevision) return
      store.commit('applyPendingReloadRoute', props.tab.id)
    }

    if (!shouldMount.value || mountRevision !== props.tab.mountRevision || refreshKey !== props.tab.refreshKey) {
      return
    }

    initialized.value = true
    disposalNotified = false
    pictureInPictureExitRequested = false
    await nextTick()
    updateLoaderState()
    if (mountRevision > acknowledgedMountRevision) {
      acknowledgedMountRevision = mountRevision
      tabRuntimeRegistry.markMounted(props.tab.id, mountRevision)
      window.ftElectron?.tabs?.mountReady?.(props.tab.id, mountRevision)
      if (process.env.IS_CAPACITOR) {
        getCapacitorTabService().markTabMounted(props.tab.id, mountRevision)
      }
      // Mount readiness can race the initial active-tab watcher. Retry now that
      // the runtime is guaranteed to exist so the tab cannot remain hidden.
      if (
        store.getters.getActiveTabId === props.tab.id &&
        store.getters.getPresentedTabId !== props.tab.id
      ) {
        navigation.requestPresentation(props.tab.id, store.state.tabs.selectionRevision)
      }
    }
    scheduleLoaderUpdate()
  },
  { immediate: true }
)

watch(isWatchRoute, scheduleLoaderUpdate)
// A retained page keeps its loader in the DOM, so leaving it adds or removes none.
watch(currentPageKey, scheduleLoaderUpdate)

/**
 * Back shrinks the current page over the retained page it returns to. Without
 * one, such as on Watch or after an earlier Back, the whole tab shrinks.
 */
function getAndroidBackTarget() {
  const root = tabContentRef.value
  if (!root) return null
  const current = pages.value.at(-1)
  const previous = pages.value.at(-2)
  const index = props.tab.historyIndex
  const element = root.querySelector(':scope > .routerView:not(.retainedPage)')
  if (!isWatchRoute.value && element && current?.index === index && previous?.index === index - 1 &&
    previous.route.fullPath === getEntryPath(index - 1)) {
    // Show the retained page at its own scroll position, which Back restores.
    const scrollTop = props.tab.history[index - 1].scroll?.top ?? 0
    return { element, reveal: { key: previous.key, top: window.scrollY - scrollTop } }
  }
  return { element: root, reveal: null }
}

onMounted(() => {
  if (tabContentRef.value) {
    removeRootRegistration = tabRuntimeRegistry.registerRoot(props.tab.id, tabContentRef.value)
  }

  if (RETAINS_PAGES) {
    removeAndroidBackPage = registerAndroidBackPage(props.tab.id, options => createAndroidBackPagePreview({
      ...options,
      getTarget: getAndroidBackTarget,
      setReveal: setBackReveal
    }))
  }

  if (typeof MutationObserver === 'function' && tabContentRef.value) {
    loaderObserver = new MutationObserver((records) => {
      if (records.some(recordAffectsLoader)) scheduleLoaderUpdate()
    })
    loaderObserver.observe(tabContentRef.value, {
      attributes: true,
      attributeFilter: ['data-tab-loading-indicator'],
      childList: true,
      subtree: true
    })
  }
  scheduleLoaderUpdate()
})

onErrorCaptured((error) => {
  console.error(`Logical tab ${props.tab.id} failed to render:`, error)
  const mountRevision = props.tab.mountRevision
  // Only treat this as a mount failure while the current mount revision has not
  // yet been acknowledged as mounted. A later descendant render error on an
  // already-mounted tab is logged but must not flip the tab back to failed.
  if (mountRevision > acknowledgedMountRevision) {
    tabRuntimeRegistry.markMountFailed(props.tab.id, mountRevision)
    window.ftElectron?.tabs?.mountFailed?.(props.tab.id, mountRevision)
    if (process.env.IS_CAPACITOR) {
      getCapacitorTabService().markTabMountFailed(props.tab.id, mountRevision)
    }
  }
  // Return undefined (not false) so the error still propagates to the app-level
  // errorHandler in main.js after our IPC notification, preserving observability.
})

onBeforeUnmount(() => {
  lifecycleRevision += 1
  disposeMountedContent().catch(error => {
    console.error(`Failed to dispose logical tab ${props.tab.id}:`, error)
  })
  loaderObserver?.disconnect()
  loaderObserver = null
  if (loaderAnimationFrameId != null) {
    window.cancelAnimationFrame(loaderAnimationFrameId)
    loaderAnimationFrameId = null
  }
  cancelLoaderSettle()
  removeRootRegistration?.()
  removeAndroidBackPage?.()
  navigation.disposeTab(props.tab.id)
})

function scheduleLoaderUpdate() {
  if (loaderAnimationFrameId != null) {
    return
  }

  loaderAnimationFrameId = window.requestAnimationFrame(() => {
    loaderAnimationFrameId = null
    updateLoaderState()
  })
}

/**
 * Pages such as live chat and comments add nodes continuously. Only changes
 * that add, remove or toggle a loading indicator can change the tab's state.
 * @param {MutationRecord} record
 */
function recordAffectsLoader(record) {
  if (record.type === 'attributes') return true
  for (const nodes of [record.addedNodes, record.removedNodes]) {
    for (const node of nodes) {
      if (node instanceof Element && (node.matches(TAB_LOADER_SELECTOR) || node.querySelector(TAB_LOADER_SELECTOR) != null)) {
        return true
      }
    }
  }
  return false
}

function hasCurrentPageLoader() {
  // Watch tabs keep a browsing page mounted beneath the video.
  const currentPage = tabContentRef.value?.querySelector(isWatchRoute.value ? '.watchPreviewHost' : ':scope > .routerView:not(.retainedPage)')
  return currentPage?.querySelector(TAB_LOADER_SELECTOR) != null
}

function updateLoaderState() {
  if (hasCurrentPageLoader()) {
    cancelLoaderSettle()
    navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, true)
    return
  }

  // Async route placeholders and the mounted view can hand loading indicators
  // off across adjacent renders. Require a short indicator-free quiet period
  // before clearing this source so the tab bar cannot flash cached metadata.
  if (loaderSettleTimeoutId == null) {
    loaderSettleTimeoutId = window.setTimeout(settleLoaderState, TAB_LOADER_SETTLE_DELAY_MS)
  }
}

function settleLoaderState() {
  loaderSettleTimeoutId = null
  if (hasCurrentPageLoader()) {
    navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, true)
    return
  }

  navigation.setLoadingSource(props.tab.id, TAB_LOADER_LOADING_SOURCE, false)
}

function cancelLoaderSettle() {
  if (loaderSettleTimeoutId != null) {
    window.clearTimeout(loaderSettleTimeoutId)
    loaderSettleTimeoutId = null
  }
}
</script>

<style scoped>
.tabContent {
  position: relative;
  min-inline-size: 0;
  inline-size: 100%;
}

.browsingBehindWatch {
  position: absolute;
  inset: 0;
  z-index: 0;
  inline-size: 100%;
  pointer-events: none;
  visibility: hidden;
}

/* Retained browsing content must not extend the Watch page's scroll range. */
.tabContent:not(.hasWatchPreview) > .browsingBehindWatch {
  overflow: clip;
}

/* Keep positioned items in the browsing page below the returning Watch preview. */
.tabContent.hasWatchPreview > .routerView:not(.browsingBehindWatch, .retainedPage) {
  position: relative;
  z-index: 0;
}

.tabContent.hasWatchPreview .browsingBehindWatch {
  position: relative;
  inset: auto;
  visibility: visible;
}

/* A page kept for Back stays laid out without rendering, so it can appear
   behind the gesture at once. It precedes the current page, which paints over it. */
.retainedPage {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  content-visibility: hidden;
  pointer-events: none;
  /* Positioned overlays inside it, such as thumbnail badges, must not paint over the current page. */
  isolation: isolate;
}

/* Back shows the kept page at its own scroll position behind the current page. */
.retainedPage.retainedPagePreview {
  inset-block-start: var(--retained-page-top, 0);
  content-visibility: visible;
  /* It slides in behind the current page. */
  will-change: transform;
}

.retainedPageScrim {
  position: fixed;
  inset: 0;
  background-color: #000;
  opacity: 0;
  pointer-events: none;
  will-change: opacity;
}

.pageSwipePresented {
  position: relative;
  z-index: 1;
}

.pageSwipePrewarm {
  position: absolute;
  inset: 0;
  z-index: 0;
  /* Keep neighbors laid out for swiping without painting through short pages
     or allowing their fixed-position children to show over the active tab. */
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

/* Android WebView ticks animations under this opacity: 0 layer on the main
   thread. A spinner in a neighbor would otherwise render a frame per refresh.
   Hidden browsing pages behind Watch keep ticking their animations as well. */
.pageSwipePrewarm,
.pageSwipePrewarm :deep(*),
.pageSwipePrewarm :deep(*::before),
.pageSwipePrewarm :deep(*::after),
.tabContent:not(.hasWatchPreview) > .browsingBehindWatch,
.tabContent:not(.hasWatchPreview) > .browsingBehindWatch :deep(*),
.tabContent:not(.hasWatchPreview) > .browsingBehindWatch :deep(*::before),
.tabContent:not(.hasWatchPreview) > .browsingBehindWatch :deep(*::after) {
  animation-play-state: paused !important;
}

.pageSwipePlaceholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-block-size: calc(100dvh - var(--top-nav-height) - var(--app-safe-area-inset-top) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
  gap: 16px;
  padding: 24px;
  color: var(--primary-text-color);
  font-size: 20px;
  text-align: center;
  overflow-wrap: anywhere;
}

.pageSwipePlaceholder :deep(.capacitorTabPreview) {
  max-inline-size: 320px;
  border-radius: var(--shape-corner-medium);
}

.pageSwipeFrom {
  position: relative;
  z-index: 2;
}

.pageSwipeTo {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: 1;
}

.pageSwipeSettling {
  transition: left 200ms cubic-bezier(0.2, 0, 0, 1);
}

:root[data-reduced-motion='reduce'] .pageSwipeSettling {
  transition-duration: 0ms;
}
</style>
