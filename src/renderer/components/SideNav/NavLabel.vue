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

  /* SideNav measures the spelling it does not show, so it stays laid out. */
  .navLabel > .shortLabel,
  .navLabel.useShortLabel > .fullLabel {
    position: absolute;
    visibility: hidden;
  }

  .navLabel.useShortLabel > .shortLabel {
    position: static;
    visibility: inherit;
  }
}
</style>
