import { computed } from 'vue'
import { useRouter } from 'vue-router'

import store from '../store/index'
import { translateWindowTitle } from '../helpers/strings'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'
import { filterAvailableNavigationItems } from '../../navigationAvailability'
import { NAVIGATION_ITEM_DEFINITIONS } from '../../navigationItems'

const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
const ICON_BY_ID = new Map(NAVIGATION_ITEM_DEFINITIONS.map(item => [item.id, item.icon]))

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
      supportsYtDlp,
      enableTwitchPage: store.getters.getEnableTwitchPage,
    })
      .map(id => routeByPath.get(id))
      .filter(route => route != null)
  })

  // Avoid Vue parsing issues by excluding '/' from path values
  const landingPageValues = computed(() => pages.value.map(route => route.path.slice(1)))

  return {
    landingPageNames: computed(() => pages.value.map(route => translateWindowTitle(route.meta.title))),
    landingPageValues,
    landingPageIcons: computed(() => landingPageValues.value.map(id => ICON_BY_ID.get(id) ?? null)),
  }
}
