<template>
  <div
    class="materialTabs"
    :class="{ segmented: props.variant === 'segmented' }"
    role="tablist"
  >
    <slot />
  </div>
</template>

<script setup>
const props = defineProps({
  variant: {
    type: String,
    default: 'pills',
    validator: value => ['pills', 'segmented'].includes(value)
  }
})
</script>

<style scoped src="./FtTabs.css" />
