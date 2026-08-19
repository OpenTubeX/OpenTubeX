<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <PrivacySettings />
    <MetadataHistorySettings v-if="USING_ELECTRON" />
    <PasswordSettings />
  </div>
</template>

<script setup>
import MetadataHistorySettings from '../MetadataHistorySettings.vue'
import PasswordSettings from '../PasswordSettings/PasswordSettings.vue'
import PrivacySettings from '../PrivacySettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
