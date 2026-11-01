<template>
  <div class="settingsCategory">
    <SubscriptionSettings />
    <RssFeedSettings v-if="supportsYtDlp" />
  </div>
</template>

<script setup>
import RssFeedSettings from './RssFeedSettings.vue'
import SubscriptionSettings from './SubscriptionSettings.vue'

// Feed items from other platforms open through yt-dlp
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'
</script>
