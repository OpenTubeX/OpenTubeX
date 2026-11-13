<template>
  <div class="settingsCategory">
    <YouTubeAccountSettings
      v-if="supportsYouTubeAccount && activeTab === 'youtube-account'"
      hide-title
    />
    <SyncSettings
      v-else
      :hide-title="supportsYouTubeAccount"
    />
  </div>
</template>

<script setup>
import SyncSettings from '../Sync/SyncSettings.vue'
import YouTubeAccountSettings from '../YouTubeAccount/YouTubeAccountSettings.vue'
import { supportsYouTubeAccount } from '../../../helpers/youtube-account-state'

defineProps({
  activeTab: {
    type: String,
    default: 'sync',
    validator: value => ['sync', 'youtube-account'].includes(value)
  }
})
</script>
