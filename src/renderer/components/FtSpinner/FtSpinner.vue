<template>
  <div
    class="spinnerContainer"
    :class="{ inline }"
    role="status"
    :aria-label="label"
  >
    <span
      class="spinner"
      :style="{
        blockSize: size,
        borderWidth,
        inlineSize: size
      }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup>
defineProps({
  label: {
    type: String,
    default: 'Loading'
  },
  size: {
    type: String,
    default: '32px'
  },
  borderWidth: {
    type: String,
    default: '3px'
  },
  inline: {
    type: Boolean,
    default: false
  }
})
</script>

<style scoped src="./FtSpinner.css" />
