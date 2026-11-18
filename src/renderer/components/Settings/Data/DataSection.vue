<template>
  <div class="settingsCategory">
    <div class="dataStoragePanel">
      <DataSettings v-if="activeTab === 'data'" />
      <StorageSettings v-else />
    </div>
  </div>
</template>

<script setup>
import DataSettings from './DataSettings.vue'
import StorageSettings from './StorageSettings.vue'

defineProps({
  activeTab: {
    type: String,
    default: 'data',
    validator: value => ['data', 'storage'].includes(value)
  }
})
</script>

<style scoped>
/* The tab's sections join the category's grid, so they are spaced like the
   sections of other categories. */
.dataStoragePanel {
  display: contents;
}
</style>
