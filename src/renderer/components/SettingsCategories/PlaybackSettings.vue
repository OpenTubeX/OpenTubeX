<template>
  <div class="settingsCategory">
    <PlayerSettings />
    <ChannelSettings />
    <YtDlpStreamingSettings v-if="USING_ELECTRON" />
    <CaptionSettings />
  </div>
</template>

<script setup>
import CaptionSettings from '../CaptionSettings/CaptionSettings.vue'
import ChannelSettings from '../ChannelSettings/ChannelSettings.vue'
import PlayerSettings from '../PlayerSettings/PlayerSettings.vue'
import YtDlpStreamingSettings from '../YtDlpStreamingSettings/YtDlpStreamingSettings.vue'

const USING_ELECTRON = process.env.IS_ELECTRON
</script>
