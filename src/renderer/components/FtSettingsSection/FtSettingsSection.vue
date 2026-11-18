<template>
  <div
    class="settingsSection"
  >
    <h3
      v-if="!hideTitle"
      class="sectionTitle"
    >
      {{ title }}
    </h3>
    <div class="sectionBody">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true
  },
  hideTitle: {
    type: Boolean,
    default: false
  }
})
</script>

<style scoped src="./FtSettingsSection.scss" lang="scss" />
