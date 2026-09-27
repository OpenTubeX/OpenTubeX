<template>
  <div
    ref="previewHost"
    class="watchPreviewHost"
    :class="{ watchRouteActive: isWatchRoute, watchPreviewing: previewActive }"
  >
    <div
      v-show="isWatchRoute || previewStyle"
      ref="watchRoot"
      :class="{ watchDragPreview: previewStyle }"
      :style="previewStyle"
      :inert="!isWatchRoute"
      :aria-hidden="String(!isWatchRoute)"
    >
      <component
        :is="component"
        v-if="watchRoute"
        ref="watchView"
        class="routerView"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, provide, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import store from '../../store/index'
import { resolveRouteComponent } from '../../router/index'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { tabLifecycleService } from '../../tabs/TabLifecycleService'
import { tabLifecycleKey, tabPresentedKey, watchNavigationKey } from '../../tabs/TabContext'
import { getPreviousBrowsingRoute } from '../../tabs/playerDockDestination'

const props = defineProps({
  tabId: { type: String, required: true },
  route: { type: Object, required: true },
  presented: Boolean
})

const navigation = getTabNavigationService()
const watchRoot = useTemplateRef('watchRoot')
const previewHost = useTemplateRef('previewHost')
const previewActive = ref(false)
const previewStyle = shallowRef(null)
let previewScroll = null
let previewOrigin = null
let previewRestoring = false
const watchView = useTemplateRef('watchView')
// Freeze the watch route while browsing, so its route watchers do not reload
// or tear down the video when the tab moves to another page.
const watchRoute = shallowRef(null)
const retained = ref(false)
const minimized = ref(false)
const isWatchRoute = computed(() => props.route.path.startsWith('/watch/'))
const presented = computed(() => props.presented && (isWatchRoute.value || previewActive.value))
const detached = computed(() => retained.value && !isWatchRoute.value)
const enabled = computed(() => store.getters.getKeepPlayingOnNavigation)
const component = computed(() => watchRoute.value && resolveRouteComponent(watchRoute.value))
const injectedRoute = reactive({})
const hooks = new Set()
let disposed = false
let watchTitle = ''
let watchTitleOptions
let disposalPromise = null

async function run(name, context) {
  for (const entry of [...hooks]) {
    try {
      await entry[name]?.(context)
    } catch (error) {
      console.error(`Watch lifecycle hook "${name}" failed:`, error)
    }
  }
}

function dispose(context) {
  if (disposed || !watchRoute.value) return disposalPromise
  disposed = true
  disposalPromise = run('beforeDispose', context)
  return disposalPromise
}

const unregister = tabLifecycleService.register(props.tabId, {
  async beforeNavigate(context) {
    await disposalPromise
    if (!isWatchRoute.value) return
    // Android teleports even the scrolling mini player outside this view.
    const player = watchView.value?.$refs.player
    retained.value = Boolean(player) && !context.to.path.startsWith('/watch/') &&
      (minimized.value || (enabled.value && player.hasLoaded === true && !player.isPaused()))
    if (retained.value) {
      const tab = store.getters.getTabById(props.tabId)
      const entry = tab?.history[tab.historyIndex]
      watchTitle = entry?.title || ''
      watchTitleOptions = { resolveHistoryEntry: entry?.titlePending !== true }
      await run('deactivate', context)
    } else {
      await dispose(context)
    }
  },
  async afterNavigate(context) {
    if (isWatchRoute.value) {
      if (retained.value && watchTitle) navigation.setTitle(props.tabId, watchTitle, watchTitleOptions)
      retained.value = false
      minimized.value = false
      await run('activate', context)
    }
  },
  activate: context => presented.value && run('activate', context),
  deactivate: context => run('deactivate', context),
  beforeReload: dispose,
  beforeDispose: dispose
})

provide(tabLifecycleKey, {
  register(_tabId, entry) {
    hooks.add(entry)
    return () => hooks.delete(entry)
  }
})
provide(tabPresentedKey, presented)
provide('isTabActive', presented)
provide(routeLocationKey, injectedRoute)
provide('tabRoute', injectedRoute)
const router = navigation.createRouterFacade(props.tabId)
const watchRouter = Object.create(router)
Object.defineProperty(watchRouter, 'currentRoute', { value: computed(() => watchRoute.value) })
provide(routerKey, watchRouter)
async function minimize() {
  minimized.value = true
  const tab = store.getters.getTabById(props.tabId)
  if (getPreviousBrowsingRoute(tab)) {
    await navigation.back(props.tabId)
  } else {
    await navigation.push(props.tabId, '/subscriptions')
  }
  if (isWatchRoute.value) minimized.value = false
}

function beginMinimizePreview() {
  if (previewActive.value) return
  previewRestoring = false
  previewScroll = { left: window.scrollX, top: window.scrollY }
  const bounds = watchRoot.value.getBoundingClientRect()
  // Use an explicit positioned host: Chromium versions disagree on whether
  // inline-size query containers establish a fixed-position containing block.
  const parentBounds = previewHost.value.getBoundingClientRect()
  previewOrigin = {
    left: bounds.left - (parentBounds?.left ?? 0),
    top: bounds.top - (parentBounds?.top ?? 0)
  }
  previewStyle.value = {
    left: `${previewOrigin.left}px`,
    top: `${previewOrigin.top}px`,
    width: `${bounds.width}px`,
    height: `${window.innerHeight - bounds.top}px`
  }
  window.addEventListener('scroll', updatePreviewPosition, { passive: true })
  previewActive.value = true
}

function beginRestorePreview() {
  if (previewActive.value || !detached.value) return false
  previewRestoring = true
  previewScroll = { left: window.scrollX, top: window.scrollY }
  const parentBounds = previewHost.value.getBoundingClientRect()
  const targetBounds = document.querySelector('.app.capacitorTabs')
    ? previewHost.value.closest('.tabContent')?.getBoundingClientRect() ?? parentBounds
    : parentBounds
  previewOrigin = {
    left: window.scrollX + targetBounds.left - parentBounds.left,
    top: window.scrollY + targetBounds.top - parentBounds.top
  }
  previewStyle.value = {
    left: `${previewOrigin.left}px`,
    top: `${previewOrigin.top}px`,
    width: `${targetBounds.width}px`,
    height: `${window.innerHeight - targetBounds.top - window.scrollY}px`
  }
  watchRoot.value.style.opacity = '0'
  watchRoot.value.firstElementChild.style.opacity = '0'
  previewActive.value = true
  window.addEventListener('scroll', updatePreviewPosition, { passive: true })
  return true
}

function updatePreviewPosition() {
  const root = watchRoot.value
  if (!root || !previewOrigin) return
  root.style.left = `${previewOrigin.left + window.scrollX - previewScroll.left}px`
  root.style.top = `${previewOrigin.top + window.scrollY - previewScroll.top}px`
}

function updateMinimizePreview(progress) {
  const root = watchRoot.value
  if (!root) return
  if (!previewRestoring) {
    root.style.opacity = String(1 - progress)
    return
  }
  // Cover the previous page first. Watch content only fades in once its
  // background is opaque, so the two pages never show through each other.
  const reveal = 1 - progress
  root.style.opacity = String(Math.max(0, Math.min(1, (reveal - 0.08) / 0.22)))
  root.firstElementChild.style.opacity = String(Math.max(0, Math.min(1, (reveal - 0.3) / 0.7)))
}

async function finishMinimizePreview(commit) {
  if (previewRestoring) {
    if (commit && !disposed) {
      await navigation.push(props.tabId, watchRoute.value.fullPath)
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
    }
    return
  }
  if (commit && !disposed) {
    await minimize().catch(error => {
      console.error('Unable to dock player', error)
    })
  }
}

function clearMinimizePreview() {
  previewActive.value = false
  previewStyle.value = null
  watchRoot.value?.style.removeProperty('opacity')
  watchRoot.value?.firstElementChild.style.removeProperty('opacity')
  window.removeEventListener('scroll', updatePreviewPosition)
}

async function dismiss() {
  if (!detached.value) return
  await dispose()
  if (!isWatchRoute.value) {
    retained.value = false
    minimized.value = false
    watchRoute.value = null
  }
}

provide(watchNavigationKey, {
  dismiss,
  detached,
  minimized,
  minimize,
  beginMinimizePreview,
  beginRestorePreview,
  updateMinimizePreview,
  finishMinimizePreview,
  clearMinimizePreview,
  tabPresented: computed(() => props.presented),
  setTitle: (title, options) => {
    watchTitle = title
    watchTitleOptions = options
  },
  returnToVideo: () => navigation.push(props.tabId, watchRoute.value.fullPath)
})

watch(() => props.route, route => {
  if (route.path.startsWith('/watch/')) {
    if (watchRoute.value?.fullPath !== route.fullPath) watchTitle = ''
    disposed = false
    watchRoute.value = route
    for (const key of Object.keys(injectedRoute)) {
      if (!(key in route)) delete injectedRoute[key]
    }
    Object.assign(injectedRoute, route)
  } else if (!retained.value) {
    watchRoute.value = null
  }
}, { immediate: true })

watch(enabled, value => {
  if (!value && detached.value) {
    // Finish cleanup and unmount before a return can mount a fresh Watch.
    disposalPromise = dispose().then(async () => {
      retained.value = false
      watchRoute.value = null
      await nextTick()
    })
  }
}, { flush: 'sync' })

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePreviewPosition)
  unregister()
  dispose()
})
</script>

<style scoped>
.watchPreviewHost {
  position: relative;
  z-index: 1;
}

.watchRouteActive:not(.watchPreviewing) {
  background: var(--bg-color);
}

.watchDragPreview {
  position: absolute;
  z-index: 100;
  pointer-events: none;
  overflow: clip;
  background: var(--bg-color);
  will-change: opacity;
}
</style>
