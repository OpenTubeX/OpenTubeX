<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <GeneralSettings />
    <CommentSettings />
    <TranslationSettings v-if="SUPPORTS_LOCAL_API" />
    <ContextMenuSearchSettings v-if="!IS_CAPACITOR" />
  </div>
</template>

<script setup>
import ContextMenuSearchSettings from './ContextMenuSearchSettings.vue'
import CommentSettings from './CommentSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import TranslationSettings from './TranslationSettings.vue'

const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
</script>
