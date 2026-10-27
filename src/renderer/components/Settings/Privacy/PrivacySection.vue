<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <PrivacySettings />
    <PasswordSettings />
  </div>
</template>

<script setup>
import PasswordSettings from './PasswordSettings.vue'
import PrivacySettings from './PrivacySettings.vue'
</script>
