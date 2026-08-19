<template>
  <div class="settingsCategory">
    <PlayerSettings />
    <ChannelSettings />
    <CaptionSettings />
  </div>
</template>

<script setup>
import CaptionSettings from '../CaptionSettings/CaptionSettings.vue'
import ChannelSettings from '../ChannelSettings/ChannelSettings.vue'
import PlayerSettings from '../PlayerSettings/PlayerSettings.vue'
</script>
