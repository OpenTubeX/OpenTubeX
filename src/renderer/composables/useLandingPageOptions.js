import { computed } from 'vue'
import { useRouter } from 'vue-router'

import store from '../store/index'
import { translateWindowTitle } from '../helpers/strings'
import { filterAvailableNavigationItems } from '../../navigationAvailability'

const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API

/** The pages the app can open with, in navigation order */
export function useLandingPageOptions() {
  const router = useRouter()

  const pages = computed(() => {
    const routeByPath = new Map(router.getRoutes().map(route => [route.path.slice(1), route]))
    return filterAvailableNavigationItems(store.getters.getNavigationItems, {
      supportsLocalApi: SUPPORTS_LOCAL_API,
      backendPreference: store.getters.getBackendPreference,
      backendFallback: store.getters.getBackendFallback,
      showWatchStats: store.getters.getRememberHistory && store.getters.getEnableWatchStats,
    })
      .map(id => routeByPath.get(id))
      .filter(route => route != null)
  })

  return {
    landingPageNames: computed(() => pages.value.map(route => translateWindowTitle(route.meta.title))),
    // Avoid Vue parsing issues by excluding '/' from path values
    landingPageValues: computed(() => pages.value.map(route => route.path.slice(1))),
  }
}
