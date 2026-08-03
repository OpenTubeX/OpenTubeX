import { inject, onBeforeUnmount } from 'vue'

import store from '../store/index'
import { getTabNavigationService } from './TabNavigationService'
import { removeLegacyTabAvatar } from '../helpers/channelThumbnailStorage'

export const tabIdKey = Symbol('logical-tab-id')
export const tabPresentedKey = Symbol('logical-tab-presented')
export const tabLifecycleKey = Symbol('logical-tab-lifecycle')

export function useTabContext() {
  return {
    tabId: inject(tabIdKey, null),
    isTabPresented: inject(tabPresentedKey, null),
    lifecycle: inject(tabLifecycleKey, null)
  }
}

export function useTabTitle() {
  const { tabId } = useTabContext()
  let isMounted = true

  onBeforeUnmount(() => {
    isMounted = false
  })

  return (title, options) => {
    if (!isMounted) {
      return
    }

    if (process.env.IS_ELECTRON && tabId) {
      getTabNavigationService().setTitle(tabId, title, options)
    } else {
      store.commit('setAppTitle', title)
    }
  }
}

export function useTabAvatar() {
  const { tabId } = useTabContext()
  let isMounted = true

  onBeforeUnmount(() => {
    isMounted = false
  })

  return (avatarUrl) => {
    if (isMounted && process.env.IS_ELECTRON && tabId && store.getters.getShowTabIcons) {
      window.ftElectron.tabs.updateAvatar(avatarUrl, tabId).then(cached => {
        if (cached) {
          removeLegacyTabAvatar(store.getters.getTabById(tabId)?.route)
        }
      }).catch(error => {
        console.error('Failed to cache tab avatar:', error)
      })
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
