<template>
  <div
    class="container"
    :class="{ fullscreen }"
    :data-tab-loading-indicator="tabLoadingIndicator ? '' : undefined"
  >
    <div class="spinner">
      <div class="double-bounce1" />
      <div class="double-bounce2" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  fullscreen: {
    type: Boolean,
    default: false
  },
  tabLoadingIndicator: {
    type: Boolean,
    default: true
  }
})
</script>

<style scoped src="./FtLoader.css" />
