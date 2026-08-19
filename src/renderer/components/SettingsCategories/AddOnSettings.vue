<template>
  <div class="settingsCategory">
    <SponsorBlockSettings />
    <RydSettings />
    <VoiceOverTranslationSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import RydSettings from '../RydSettings.vue'
import SponsorBlockSettings from '../SponsorBlockSettings.vue'
import VoiceOverTranslationSettings from '../VoiceOverTranslationSettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
