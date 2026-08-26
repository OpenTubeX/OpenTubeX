<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <GeneralSettings />
    <CommentTranslationSettings v-if="SUPPORTS_LOCAL_API" />
    <ContextMenuSearchSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import ContextMenuSearchSettings from '../ContextMenuSearchSettings/ContextMenuSearchSettings.vue'
import CommentTranslationSettings from '../CommentTranslationSettings/CommentTranslationSettings.vue'
import GeneralSettings from '../GeneralSettings/GeneralSettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API
</script>
