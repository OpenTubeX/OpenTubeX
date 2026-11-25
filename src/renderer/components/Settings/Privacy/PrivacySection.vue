<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <PrivacySettings />
    <PasswordSettings />
    <AppLockSettings v-if="IS_ANDROID" />
  </div>
</template>

<script setup>
import AppLockSettings from './AppLockSettings.vue'
import PasswordSettings from './PasswordSettings.vue'
import PrivacySettings from './PrivacySettings.vue'

const IS_ANDROID = process.env.IS_CAPACITOR && !process.env.IS_IOS
</script>
