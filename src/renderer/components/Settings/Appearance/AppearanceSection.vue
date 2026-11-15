<template>
  <div class="settingsCategory">
    <ThemeSettings />
    <LayoutSettings />
    <InterfaceCustomizer />
    <ContentAppearanceSettings />
  </div>
</template>

<script setup>
import ContentAppearanceSettings from './ContentAppearanceSettings.vue'
import InterfaceCustomizer from './InterfaceCustomizer/InterfaceCustomizer.vue'
import LayoutSettings from './LayoutSettings.vue'
import ThemeSettings from './ThemeSettings.vue'
</script>
