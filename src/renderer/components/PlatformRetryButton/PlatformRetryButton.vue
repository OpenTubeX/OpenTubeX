<template>
  <!-- A browser check fails every retry until the user passes it -->
  <FtButton
    v-if="canPassBrowserCheck(error)"
    :label="t('Platforms.Verify')"
    :icon="['fas', 'shield-halved']"
    :disabled="verifying"
    @click="verify"
  />
  <FtButton
    v-else
    :label="t('User Playlists.SinglePlaylistView.Retry')"
    :icon="['fas', 'arrows-rotate']"
    @click="emit('retry')"
  />
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'

import { canPassBrowserCheck, passBrowserCheck } from '../../helpers/platformFetch'

const props = defineProps({
  /** What failed the request */
  error: {
    type: null,
    default: null
  }
})

const emit = defineEmits(['retry'])

const { t } = useI18n()

const verifying = ref(false)

async function verify() {
  if (verifying.value || !canPassBrowserCheck(props.error)) return
  verifying.value = true
  try {
    await passBrowserCheck(props.error)
  } catch (error) {
    console.error('Failed to open the browser check', error)
  } finally {
    verifying.value = false
  }
  // Also after the user closed the window, as the page may have loaded without a check
  emit('retry')
}
</script>
