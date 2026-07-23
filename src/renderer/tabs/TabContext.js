import { inject, onBeforeUnmount } from 'vue'

import store from '../store/index'
import { getTabNavigationService } from './TabNavigationService'

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

  return (title) => {
    if (!isMounted) {
      return
    }

    if (process.env.IS_ELECTRON && tabId) {
      getTabNavigationService().setTitle(tabId, title)
    } else {
      store.commit('setAppTitle', title)
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
