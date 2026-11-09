<template>
  <span
    class="settingsRoute"
    hidden
  />
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import store from '../../store/index'
import { useTabContext } from '../../tabs/TabContext'

const route = useRoute()
const router = useRouter()
const { isTabPresented } = useTabContext()

// A tab loaded in the background must not open the window over the current
// tab or leave its own route until the user selects it.
onMounted(() => {
  if (!isTabPresented || isTabPresented.value) {
    openWindow()
    return
  }
  const stop = watch(isTabPresented, (presented) => {
    if (!presented) return
    stop()
    openWindow()
  })
})

async function openWindow() {
  const view = route.name === 'downloads' || route.name === 'about'
    ? route.name
    : route.path.startsWith('/settings/profile') ? 'profile' : null
  await store.dispatch('showSettingsWindow', view)
  const tabId = store.getters.getPresentedTabId ?? store.getters.getActiveTabId
  const tab = store.getters.getTabById(tabId)
  const previousRoute = tab?.history[tab.historyIndex - 1]?.route
  const previousPath = typeof previousRoute === 'string' ? previousRoute : previousRoute?.path
  const browserBackPath = window.history.state?.back
  const safePreviousPath = process.env.IS_ELECTRON ? previousPath : browserBackPath

  const previousRouteName = typeof safePreviousPath === 'string' ? router.resolve(safePreviousPath).name : null
  const previousWasUtilityRoute = ['downloads', 'about'].includes(previousRouteName) || safePreviousPath?.startsWith('/settings')
  if (typeof safePreviousPath === 'string' && !previousWasUtilityRoute) {
    await router.back()
  } else {
    await router.replace('/')
  }
}
</script>
