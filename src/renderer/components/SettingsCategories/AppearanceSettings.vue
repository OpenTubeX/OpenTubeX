<template>
  <div class="settingsCategory">
    <ThemeSettings />
    <GeneralSettings mode="appearance" />
  </div>
</template>

<script setup>
import GeneralSettings from '../GeneralSettings/GeneralSettings.vue'
import ThemeSettings from '../ThemeSettings.vue'
</script>
