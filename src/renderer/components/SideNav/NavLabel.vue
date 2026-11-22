<template>
  <p
    class="navLabel"
  >
    <span :class="{ fullLabel: shortLabel }">{{ label }}</span>
    <span
      v-if="shortLabel"
      class="shortLabel"
    >{{ shortLabel }}</span>
  </p>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  shortLabel: { type: String, default: '' }
})
</script>

<style scoped>
.shortLabel {
  display: none;
}

@media only screen and (width <= 680px) {
  .navLabel > span {
    display: inline-block;
    vertical-align: top;
    white-space: nowrap;
    font-size: var(--fitted-nav-label-size, inherit);
  }

  .navLabel.useShortLabel > .fullLabel {
    display: none;
  }

  .navLabel > .shortLabel {
    display: none;
  }

  .navLabel.useShortLabel > .shortLabel {
    display: inline-block;
  }
}
</style>
