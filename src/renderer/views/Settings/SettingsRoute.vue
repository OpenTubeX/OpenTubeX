<template>
  <span hidden />
</template>

<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import store from '../../store/index'

const route = useRoute()
const router = useRouter()

onMounted(async () => {
  const view = route.path.startsWith('/settings/profile') ? 'profile' : null
  await store.dispatch('showSettingsWindow', view)
  const tabId = store.getters.getPresentedTabId ?? store.getters.getActiveTabId
  const tab = store.getters.getTabById(tabId)
  const previousRoute = tab?.history[tab.historyIndex - 1]?.route
  const previousPath = typeof previousRoute === 'string' ? previousRoute : previousRoute?.path
  const browserBackPath = window.history.state?.back
  const safePreviousPath = process.env.IS_ELECTRON ? previousPath : browserBackPath

  if (typeof safePreviousPath === 'string' && !safePreviousPath.startsWith('/settings')) {
    await router.back()
  } else {
    await router.replace('/')
  }
})
</script>
