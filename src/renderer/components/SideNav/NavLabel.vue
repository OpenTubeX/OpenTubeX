<template>
  <p
    class="navLabel"
  >
    <span>{{ label }}</span>
  </p>
</template>

<script setup>
defineProps({
  label: { type: String, required: true }
})
</script>

<style scoped>
@media only screen and (width <= 680px) {
  .navLabel > span {
    display: inline-block;
    vertical-align: top;
    white-space: nowrap;
    font-size: var(--fitted-nav-label-size, inherit);
  }
}
</style>
