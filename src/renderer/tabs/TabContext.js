import { computed, inject, onBeforeUnmount, watch } from 'vue'

import store from '../store/index'
import { getTabNavigationService } from './TabNavigationService'
import { removeLegacyTabAvatar } from '../helpers/channelThumbnailStorage'
import { fetchTabAvatarBytes } from '../helpers/tabAvatar'
import { getTabAvatarPath } from '../../tabAvatarRoute.js'

export const tabIdKey = Symbol('logical-tab-id')
export const tabPresentedKey = Symbol('logical-tab-presented')
export const tabLifecycleKey = Symbol('logical-tab-lifecycle')
export const watchNavigationKey = Symbol('watch-navigation')

export function useTabContext() {
  return {
    tabId: inject(tabIdKey, null),
    isTabPresented: inject(tabPresentedKey, null),
    lifecycle: inject(tabLifecycleKey, null)
  }
}

export function useTabTitle() {
  const { tabId } = useTabContext()
  const watchNavigation = inject(watchNavigationKey, null)
  const route = inject('tabRoute', null)
  // Browsing pages stay mounted behind Watch. Their late metadata and locale
  // updates belong to that page, rather than the video currently in the tab.
  const isCurrentBrowsingRoute = !watchNavigation && tabId && route
    ? computed(() => {
        const tab = store.getters.getTabById(tabId)
        const navigation = getTabNavigationService()
        return tab && navigation.resolve(tab.route).fullPath === navigation.resolve(route).fullPath
      })
    : null
  let isMounted = true
  let browsingTitle = null

  if (isCurrentBrowsingRoute) {
    watch(isCurrentBrowsingRoute, current => {
      if (current && browsingTitle?.fullPath === route.fullPath) {
        publishTitle(browsingTitle.title, browsingTitle.options)
      }
    }, { flush: 'post' })
  }

  onBeforeUnmount(() => {
    isMounted = false
  })

  function publishTitle(title, options) {
    if (!isMounted) {
      return
    }
    if (watchNavigation?.detached.value) {
      watchNavigation.setTitle(title, options)
      return
    }

    const targetTabId = process.env.IS_ELECTRON || process.env.IS_CAPACITOR
      ? tabId ?? store.getters.getActiveTabId
      : null

    if (targetTabId) {
      getTabNavigationService().setTitle(targetTabId, title, options)
    } else {
      store.commit('setAppTitle', title)
    }
  }

  return (title, options) => {
    if (isCurrentBrowsingRoute) {
      browsingTitle = { title, options, fullPath: route.fullPath }
      if (!isCurrentBrowsingRoute.value) return
    }
    publishTitle(title, options)
  }
}

export function useTabAvatar() {
  const { tabId } = useTabContext()
  const watchNavigation = inject(watchNavigationKey, null)
  let isMounted = true

  onBeforeUnmount(() => {
    isMounted = false
  })

  function getRouteKey(route) {
    if (route?.path !== '/external-media') return getTabAvatarPath(route?.path)
    const url = new URL(route.fullPath, 'https://opentubex.invalid')
    return `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ''}${url.hash}`
  }

  return async (avatarUrl) => {
    if (!isMounted || watchNavigation?.detached.value || !process.env.IS_ELECTRON || !tabId || !store.getters.getShowTabIcons) return

    try {
      const route = store.getters.getTabById(tabId)?.route
      const routeKey = getRouteKey(route)
      const avatarBytes = await fetchTabAvatarBytes(avatarUrl)
      const currentRoute = store.getters.getTabById(tabId)?.route
      const currentRouteKey = getRouteKey(currentRoute)
      if (!isMounted || watchNavigation?.detached.value || avatarBytes == null || routeKey == null || currentRouteKey !== routeKey) return

      const cached = await window.ftElectron.tabs.updateAvatar(avatarBytes, tabId, routeKey)
      if (cached) {
        removeLegacyTabAvatar(route)
      }
    } catch (error) {
      console.error('Failed to cache tab avatar:', error)
    }
  }
}

export function useTabLifecycle(hooks) {
  const { tabId, lifecycle } = useTabContext()
  if (!tabId || !lifecycle) {
    return () => {}
  }

  const unregister = lifecycle.register(tabId, hooks)
  onBeforeUnmount(unregister)
  return unregister
}
