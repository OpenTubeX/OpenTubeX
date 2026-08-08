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
  await router.back()

  setTimeout(() => {
    if (route.path.startsWith('/settings')) {
      router.replace('/')
    }
  }, 100)
})
</script>
