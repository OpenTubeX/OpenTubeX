<template>
  <div class="settingsCategory">
    <div class="focusPanel">
      <DistractionSettings v-if="activeTab === 'distraction'" />
      <DigitalWellbeingSettings v-else-if="activeTab === 'wellbeing'" />
      <ParentalControlSettings v-else />
    </div>
  </div>
</template>

<script setup>
import DistractionSettings from './DistractionSettings.vue'
import DigitalWellbeingSettings from './DigitalWellbeingSettings.vue'
import ParentalControlSettings from './ParentalControlSettings.vue'

defineProps({
  activeTab: {
    type: String,
    default: 'distraction',
    validator: value => ['distraction', 'wellbeing', 'parental'].includes(value)
  }
})
</script>

<style scoped>
.focusPanel {
  min-inline-size: 0;
}
</style>
