<template>
  <div
    ref="tabContentRef"
    class="tabContent"
    :class="{
      backgroundTab: isBackground,
      pageSwipeFrom: isSwipeFrom,
      pageSwipeTo: isSwipeTarget,
      pageSwipePresented: isPresented && isCapacitor,
      pageSwipePrewarm: isPrewarmed,
      pageSwipeWarm: isPrewarmed && !prewarmSettling,
      pageSwipeSettling: pageSwipe?.settling,
      hasWatchPreview: watchPreviewing
    }"
    :style="pageSwipeStyle"
    :data-tab-id="tab.id"
    :inert="!HIDES_WITH_CONTENT_VISIBILITY && !isPresented && !isBackground"
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
        <!-- Gives the page Back slides away its background and shadow, below it. -->
        <div
          v-if="page.key === currentPageKey && backReveal"
          class="backSlideCover"
          :style="backReveal.cover"
        >
          <div class="backSlideCoverField" />
        </div>
        <TabBrowsingPage
          :tab-id="tab.id"
          :route="page.route"
          :current="page.key === currentPageKey"
          :presented="isBrowsingPresented && page.key === currentPageKey"
          :suspended="isWatchRoute && !watchPreviewing && page.key === currentPageKey"
          class="routerView"
          :class="page.key === currentPageKey
            ? { browsingBehindWatch: isWatchRoute, browsingSettling: isWatchRoute && behindWatchSettling, backSlidePage: RETAINS_PAGES }
            : { retainedPage: true, retainedPagePreview: backReveal?.key === page.key }"
          :inert="!HIDES_WITH_CONTENT_VISIBILITY && isWatchRoute"
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
import { createAndroidBackSlidePreview } from '../../helpers/androidBackSlide'
import { getFixedBackgroundContainment } from '../../helpers/fixedBackground'
import { resumeWindowedListRemeasures } from '../../helpers/windowedList'

const TAB_LOADER_SELECTOR = '[data-tab-loading-indicator]'
const TAB_LOADER_LOADING_SOURCE = 'loader'
const TAB_LOADER_SETTLE_DELAY_MS = 100
// Android keeps the page a tab leaves mounted, so Back can show it behind the
// predictive back gesture and return to it without reloading.
const RETAINS_PAGES = process.env.IS_CAPACITOR && !process.env.IS_IOS
const RETAINED_PAGE_LIMIT = 1
// Engines that hide content that isn't shown with content-visibility: hidden,
// which keeps its style and layout and keeps it from being focused or read by
// assistive technology. Toggling inert or an inherited property such as
// pointer-events instead restyles every element of the page. Matches the
// @supports conditions of the styles below.
const HIDES_WITH_CONTENT_VISIBILITY = globalThis.CSS?.supports?.(
  '(content-visibility: hidden) and selector(:has(*)) and (not (font: -apple-system-body))'
) ?? false

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
const isBackground = computed(() => !isPresented.value && !isSwipeFrom.value && !isSwipeTarget.value && !isPrewarmed.value)
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
// The retained page Back shows behind the current page while the gesture
// lasts, if any, and where to cover it.
const backReveal = shallowRef(null)
/** @type {HTMLElement | null} */
let backRevealPage = null
/** @type {{ element: HTMLElement, name: string }[]} */
let backRevealFields = []

function clearBackRevealFields() {
  backRevealFields.forEach(({ element, name }) => element.style.removeProperty(name))
  backRevealFields = []
}

// The page Back reveals loses its layer hint in the render that makes it the
// current page, which Back can reach frames before the gesture ends. Its card
// fields must return to the viewport in the same render.
watch(currentPageKey, clearBackRevealFields, { flush: 'sync' })

/** @param {{ key: number | null, top: number, cover: Record<string, string> } | null} reveal */
async function setBackReveal(reveal) {
  backReveal.value = reveal
  // The preview class shows the page at this offset. It is set on the page
  // alone, before the render that shows it, since an inherited property on the
  // tab would restyle the current page as well.
  backRevealPage?.style.removeProperty('--retained-page-top')
  backRevealPage = null
  clearBackRevealFields()
  if (!reveal) return null
  await nextTick()
  const root = tabContentRef.value
  if (!root || backReveal.value !== reveal) return null
  const page = root.querySelector(':scope > .retainedPagePreview')
  if (page instanceof HTMLElement) {
    page.style.setProperty('--retained-page-top', `${reveal.top}px`)
    // Its layer hint would move its card fields, see getFixedBackgroundContainment.
    backRevealFields = getFixedBackgroundContainment(page)
    backRevealFields.forEach(({ element, name, value }) => element.style.setProperty(name, value))
    backRevealPage = page
  }
  return {
    page,
    scrim: root.querySelector(':scope > .retainedPageScrim'),
    cover: root.querySelector(':scope > .backSlideCover')
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

/**
 * Content hidden with content-visibility keeps its layout, but lists, grids
 * and other components that measure themselves skip it, and resize observers
 * don't report in it. While settling, it renders once more, transparent, until
 * those measurements have run.
 */
function createHiddenContentSettle() {
  const settling = ref(false)
  let generation = 0
  let idleId = null
  function stop() {
    generation++
    settling.value = false
    if (idleId === null) return
    if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
    else window.clearTimeout(idleId)
    idleId = null
  }
  function settle() {
    stop()
    if (!HIDES_WITH_CONTENT_VISIBILITY) return
    settling.value = true
    const current = generation
    // Resize observers report in the frame after the content renders, and the
    // measurements they start run in the frames after that.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (current !== generation) return
      const done = () => {
        idleId = null
        settling.value = false
      }
      idleId = typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(done, { timeout: 1000 })
        : window.setTimeout(done, 100)
    }))
  }
  return { settling, settle, stop }
}

// A neighbor kept for page swipes settles before it hides, so a swipe shows
// it laid out like a background tab.
const { settling: prewarmSettling, settle: settlePrewarm, stop: stopPrewarmSettle } = createHiddenContentSettle()
watch(isPrewarmed, prewarmed => {
  if (prewarmed) settlePrewarm()
  else stopPrewarmSettle()
})

// The page behind Watch settles when Watch hides it, and again when it
// changes or the window resizes, so the dock gesture shows it laid out and
// can restore its scroll position.
const isBehindWatch = computed(() => isWatchRoute.value && !watchPreviewing.value)
const { settling: behindWatchSettling, settle: settleBehindWatch, stop: stopBehindWatchSettle } = createHiddenContentSettle()
let behindWatchObserver = null
function stopObservingBehindWatch() {
  behindWatchObserver?.disconnect()
  window.removeEventListener('resize', settleBehindWatch)
}
watch([isBehindWatch, currentPageKey, browsingInitialized], ([behindWatch]) => {
  stopObservingBehindWatch()
  stopBehindWatchSettle()
  const page = behindWatch && HIDES_WITH_CONTENT_VISIBILITY && tabContentRef.value?.querySelector(':scope > .browsingBehindWatch')
  if (!page) return
  behindWatchObserver ??= new MutationObserver(settleBehindWatch)
  behindWatchObserver.observe(page, { childList: true, characterData: true, subtree: true })
  window.addEventListener('resize', settleBehindWatch)
  settleBehindWatch()
}, { flush: 'post' })

// Background tabs, settled neighbors, retained pages and the page behind
// Watch keep their layout, so their rows report no resize when shown.
const browsingRendered = computed(() => !isBackground.value && !(isPrewarmed.value && !prewarmSettling.value) &&
  (!isBehindWatch.value || behindWatchSettling.value))
watch([browsingRendered, currentPageKey], ([rendered]) => {
  if (rendered) resumeWindowedListRemeasures()
}, { flush: 'post' })
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
 * Back slides the current page off the retained page it returns to. Without
 * one, such as after an earlier Back, the page Back shows slides in once it
 * loads. On Watch, the whole tab slides.
 */
function getAndroidBackTarget() {
  const root = tabContentRef.value
  if (!root) return null
  const current = pages.value.at(-1)
  const previous = pages.value.at(-2)
  const index = props.tab.historyIndex
  const element = root.querySelector(':scope > .routerView:not(.retainedPage)')
  const area = root.closest('.app > .routerView')
  if (!isWatchRoute.value && element) {
    const retained = current?.index === index && previous?.index === index - 1 &&
      previous.route.fullPath === getEntryPath(index - 1)
    // Show the retained page at its own scroll position, which Back restores.
    const scrollTop = retained ? props.tab.history[index - 1].scroll?.top ?? 0 : 0
    const reveal = { key: retained ? previous.key : null, top: window.scrollY - scrollTop, cover: getAndroidBackCoverArea(element) }
    return {
      element,
      area,
      covered: true,
      reveal: shown => setBackReveal(shown ? reveal : null),
      // The page Back shows mounts in this tab, which slides in instead.
      getEntering: retained ? undefined : () => root
    }
  }
  return { element: root, area, styles: getAndroidBackCover(root) }
}

/**
 * The part of the viewport the page covers, also below the end of a short page.
 * @param {HTMLElement} element
 */
function getAndroidBackCoverArea(element) {
  const { top, left, width } = element.getBoundingClientRect()
  const coverTop = Math.max(0, top)
  const { size, position } = getWindowFieldPlacement(left, coverTop)
  return {
    top: `${coverTop}px`,
    left: `${left}px`,
    width: `${width}px`,
    '--window-field-size': size,
    '--window-field-position': position
  }
}

/**
 * Places the window's field (body::before), which pages let show through, on
 * a box at this viewport position, so the box matches what it covers.
 * @param {number} left
 * @param {number} top
 */
function getWindowFieldPlacement(left, top) {
  const { clientWidth, clientHeight } = document.documentElement
  return { size: `${clientWidth}px ${clientHeight}px`, position: `${-left}px ${-top}px` }
}

/**
 * Cover the page behind, also below the end of a short page.
 * @param {HTMLElement} element
 */
function getAndroidBackCover(element) {
  const { top, left } = element.getBoundingClientRect()
  const { size, position } = getWindowFieldPlacement(left, top)
  return {
    'background-color': 'var(--bg-color)',
    'background-image': 'var(--bg-image)',
    'background-repeat': 'no-repeat',
    'background-size': size,
    'background-position': position,
    'min-block-size': `${Math.max(0, window.innerHeight - top)}px`
  }
}

onMounted(() => {
  if (tabContentRef.value) {
    removeRootRegistration = tabRuntimeRegistry.registerRoot(props.tab.id, tabContentRef.value)
  }

  if (RETAINS_PAGES) {
    removeAndroidBackPage = registerAndroidBackPage(props.tab.id, options => createAndroidBackSlidePreview({
      ...options,
      getTarget: getAndroidBackTarget
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
  stopPrewarmSettle()
  stopBehindWatchSettle()
  stopObservingBehindWatch()
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

/* A background tab keeps its style and layout without rendering them, so
   showing it again does not restyle and lay out the whole page, which takes
   long for large pages such as a long channel list. Like display: none, this
   keeps its content from being focused or read by assistive technology.
   Inherited properties set here, such as pointer-events, or an inert
   attribute would restyle every element of the tab on each switch. */
.backgroundTab {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  content-visibility: hidden;
}

/* WebKit builds from before 2025 could keep showing a tab after hiding it
   this way, and VoiceOver missed a tab shown again. CSS can't tell those
   builds apart, so every WebKit build, the only engine that supports this
   system font, hides background tabs with display: none. Chromium 85 to 104 lacks checkVisibility(), which isRendered()
   needs to tell a background tab apart; :has() arrived with it in 105. */
@supports not ((content-visibility: hidden) and selector(:has(*)) and (not (font: -apple-system-body))) {
  .backgroundTab {
    display: none;
  }
}

/* TabBrowsingPage sets the width a page behind Watch keeps on the page itself.
   Its descendants don't use it, and an inherited custom property would
   restyle every one of them when it changes. */
@property --browsing-page-width {
  syntax: '*';
  inherits: false;
}

.browsingBehindWatch {
  position: absolute;
  inset: 0;
  z-index: 0;
  inline-size: var(--browsing-page-width, 100%);
}

/* Retained browsing content must not extend the Watch page's scroll range. */
.tabContent:not(.hasWatchPreview) > .browsingBehindWatch {
  overflow: clip;
}

/* The page behind Watch keeps its style and layout without rendering them,
   like a background tab, so returning to it or revealing it for the dock
   gesture does not restyle every element of a long page. */
@supports (content-visibility: hidden) and selector(:has(*)) and (not (font: -apple-system-body)) {
  /* Below Watch and transparent, its own box neither paints nor takes input. */
  .tabContent:not(.hasWatchPreview) > .browsingBehindWatch {
    z-index: -1;
    opacity: 0;
    content-visibility: hidden;
  }

  .tabContent:not(.hasWatchPreview) > .browsingBehindWatch.browsingSettling {
    content-visibility: visible;
  }
}

@supports not ((content-visibility: hidden) and selector(:has(*)) and (not (font: -apple-system-body))) {
  .browsingBehindWatch {
    pointer-events: none;
    visibility: hidden;
  }
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

/* Back slides the current page from script. Promoting the page, or changing
   its background, shadow or height, only then repaints all of it as the
   gesture starts, and Android WebView can draw that frame before the page is
   rastered again, so it flashes. The page keeps its layer instead, and this
   cover gives it a background and shadow while it slides. Dialogs, menus and
   players render outside pages. */
.backSlidePage {
  will-change: transform;
}

/* The hint would also anchor the fixed card fields of themes that paint them
   (FtFixedBackground) to the page instead of the viewport, so those pages get
   their layer only while they slide. */
@container style(--fixed-background-display: block) {
  .backSlidePage {
    will-change: auto;
  }
}

.backSlideCover {
  position: fixed;
  inset-block-end: 0;
  background-color: var(--bg-color);
  pointer-events: none;
  will-change: transform;
}

/* Pages let the window's field show through in themes that paint one, so the
   cover paints it too, where it covers it (getWindowFieldPlacement). Its own
   layer keeps the cover a solid color, which shows if the field is not
   rastered yet as the gesture starts. */
.backSlideCoverField {
  display: var(--fixed-background-display, none);
  position: absolute;
  inset: 0;
  background-image: var(--bg-image);
  background-repeat: no-repeat;
  background-size: var(--window-field-size);
  background-position: var(--window-field-position);
  will-change: transform;
}

/* A shadow on each side, like the one androidBackSlide gives other views. The
   page slides away from the edge the swipe starts at, which takes the other
   side's shadow off the screen. Their own layers keep the cover a solid color,
   which Chromium draws without rastering it. */
.backSlideCover::before,
.backSlideCover::after {
  position: absolute;
  inset: 0;
  content: '';
  will-change: transform;
}

.backSlideCover::before {
  box-shadow: -2px 0 16px rgb(0 0 0 / 30%);
  clip-path: inset(0 100% 0 -32px);
}

.backSlideCover::after {
  box-shadow: 2px 0 16px rgb(0 0 0 / 30%);
  clip-path: inset(0 -32px 0 100%);
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
}

/* Once its content has settled, a neighbor keeps its style and layout without
   rendering them. Toggling an inherited property such as pointer-events on
   each neighbor change, and on the tab a swipe lands on, would restyle every
   element of those tabs. */
.pageSwipeWarm {
  content-visibility: hidden;
}

/* The thumbnail morph names every player (themes.css). A neighbor's player
   would duplicate the name, which makes Chromium skip the whole transition. */
.pageSwipePrewarm :deep(.videoPlayer) {
  view-transition-name: none !important;
}

/* Engines that keep neighbors rendered, transparent, and pages behind Watch
   hidden with visibility tick their animations, a spinner a frame per
   refresh. Content hidden with content-visibility does not. */
@supports not ((content-visibility: hidden) and selector(:has(*)) and (not (font: -apple-system-body))) {
  .pageSwipePrewarm {
    pointer-events: none;
  }

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
  /* stylelint-disable-next-line liberty/use-logical-spec, plugin/no-low-performance-animation-properties -- the swipe sets a physical left offset, and a translated page would become the containing block of its fixed-position children */
  transition: left 200ms cubic-bezier(0.2, 0, 0, 1);
}

:root[data-reduced-motion='reduce'] .pageSwipeSettling {
  transition-duration: 0ms;
}
</style>
