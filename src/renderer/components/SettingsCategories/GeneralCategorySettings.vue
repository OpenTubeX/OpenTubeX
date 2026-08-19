<template>
  <div class="settingsCategory hideFirstSectionTitle">
    <GeneralSettings />
    <ContextMenuSearchSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import ContextMenuSearchSettings from '../ContextMenuSearchSettings/ContextMenuSearchSettings.vue'
import GeneralSettings from '../GeneralSettings/GeneralSettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
