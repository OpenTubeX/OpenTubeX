<template>
  <span
    class="ftInlineMetadata"
    :class="{ iconLabels }"
  ><slot /></span>
</template>

<script setup>
defineProps({
  /** Items start with a `.statIcon`, which replaces the dot separators. */
  iconLabels: {
    type: Boolean,
    default: false
  }
})
</script>

<style src="./FtInlineMetadata.css" />
