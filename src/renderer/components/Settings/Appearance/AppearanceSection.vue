<template>
  <div class="settingsCategory">
    <ThemeSettings />
    <LayoutSettings />
    <ContentAppearanceSettings />
  </div>
</template>

<script setup>
import ContentAppearanceSettings from './ContentAppearanceSettings.vue'
import LayoutSettings from './LayoutSettings.vue'
import ThemeSettings from './ThemeSettings.vue'
</script>
