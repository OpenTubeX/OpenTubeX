<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <GeneralSettings />
    <CommentSettings />
    <ContextMenuSearchSettings v-if="!IS_CAPACITOR" />
  </div>
</template>

<script setup>
import ContextMenuSearchSettings from './ContextMenuSearchSettings.vue'
import CommentSettings from './CommentSettings.vue'
import GeneralSettings from './GeneralSettings.vue'

const IS_CAPACITOR = !!process.env.IS_CAPACITOR
</script>
