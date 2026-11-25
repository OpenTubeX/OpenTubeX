<template>
  <component
    :is="component"
    v-if="component"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, provide, reactive, watch } from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import { resolveRouteComponent } from '../../router/index'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { tabLifecycleService } from '../../tabs/TabLifecycleService'
import { tabLifecycleKey, tabPresentedKey } from '../../tabs/TabContext'

const props = defineProps({
  tabId: { type: String, required: true },
  route: { type: Object, required: true },
  /** Whether the tab shows this page, rather than keeping it mounted for Back. */
  current: Boolean,
  presented: Boolean
})

const component = computed(() => resolveRouteComponent(props.route))
const injectedRoute = reactive({})
watch(() => props.route, route => {
  if (injectedRoute.fullPath === route.fullPath) return
  for (const key of Object.keys(injectedRoute)) {
    if (!(key in route)) delete injectedRoute[key]
  }
  Object.assign(injectedRoute, route)
}, { immediate: true })

// A retained page keeps running until Back shows it again. It must not act on
// the tab's navigation, presentation or pull to refresh, which belong to the
// page the tab shows.
const hooks = new Set()
let disposed = false

async function run(name, context) {
  for (const entry of [...hooks]) {
    try {
      await entry[name]?.(context)
    } catch (error) {
      console.error(`Tab lifecycle hook "${name}" failed for tab ${props.tabId}:`, error)
    }
  }
}

function dispose(context) {
  if (disposed) return
  disposed = true
  return run('beforeDispose', context)
}

const forwarded = {
  beforeDispose: dispose,
  beforeReload(context) {
    disposed = true
    return run('beforeReload', context)
  }
}
for (const name of ['activate', 'deactivate', 'beforeNavigate', 'afterNavigate', 'pullToRefresh']) {
  forwarded[name] = context => props.current ? run(name, context) : undefined
}
const unregister = tabLifecycleService.register(props.tabId, forwarded)
provide(tabLifecycleKey, {
  register(_tabId, entry) {
    hooks.add(entry)
    return () => hooks.delete(entry)
  }
})

const navigation = getTabNavigationService()
const tabRouter = navigation.createRouterFacade(props.tabId)
const router = Object.create(tabRouter)
Object.defineProperties(router, {
  currentRoute: { value: computed(() => props.route) },
  resolve: { value: location => navigation.resolve(location, props.route) }
})
// A retained page must not navigate the page the tab shows. It can still
// replace its own entry, such as a channel URL it resolved, once Back shows it.
let pendingReplace = null
for (const method of ['push', 'replace', 'go', 'back', 'forward']) {
  Object.defineProperty(router, method, {
    value: (...args) => {
      if (props.current) return tabRouter[method](...args)
      if (method === 'replace') pendingReplace = args[0]
      return Promise.resolve()
    }
  })
}
watch(() => props.current, current => {
  if (!current || pendingReplace === null) return
  const location = pendingReplace
  pendingReplace = null
  tabRouter.replace(location)
})

const presented = computed(() => props.presented)
provide(tabPresentedKey, presented)
provide('isTabActive', presented)
provide('tabRoute', injectedRoute)
provide(routeLocationKey, injectedRoute)
provide(routerKey, router)

onBeforeUnmount(() => {
  unregister()
  // Pages kept for Back, and the page Back leaves, unmount without the tab's
  // navigation hooks. Give them the cleanup a closing tab would.
  dispose()
})
</script>
