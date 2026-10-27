<template>
  <div class="settingsCategory">
    <PlayerSettings />
    <BufferSettings />
    <ChannelSettings />
    <YtDlpStreamingSettings v-if="supportsYtDlp" />
    <CaptionSettings />
  </div>
</template>

<script setup>
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'
import BufferSettings from './BufferSettings.vue'
import CaptionSettings from './CaptionSettings.vue'
import ChannelSettings from './ChannelSettings.vue'
import PlayerSettings from './PlayerSettings.vue'
import YtDlpStreamingSettings from './YtDlpStreamingSettings.vue'

</script>
