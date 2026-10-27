<template>
  <div class="settingsCategory">
    <SponsorBlockSettings />
    <DeArrowSettings />
    <RydSettings />
    <AiSlopListSettings v-if="SUPPORTS_LOCAL_API" />
    <VoiceOverTranslationSettings v-if="USING_ELECTRON || IS_CAPACITOR" />
  </div>
</template>

<script setup>
import AiSlopListSettings from './AiSlopListSettings.vue'
import DeArrowSettings from './DeArrowSettings.vue'
import RydSettings from './RydSettings.vue'
import SponsorBlockSettings from './SponsorBlockSettings.vue'
import VoiceOverTranslationSettings from './VoiceOverTranslationSettings.vue'

const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
const IS_CAPACITOR = !!process.env.IS_CAPACITOR && !process.env.IS_IOS
const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
