<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <GeneralSettings />
    <CommentSettings />
    <ContextMenuSearchSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import ContextMenuSearchSettings from './ContextMenuSearchSettings.vue'
import CommentSettings from './CommentSettings.vue'
import GeneralSettings from './GeneralSettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
