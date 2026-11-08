<template>
  <span
    v-bind="attrs"
    class="ft-icon-layers"
  >
    <slot />
  </span>
</template>

<script setup>
import { useAttrs } from 'vue'

defineOptions({
  inheritAttrs: false
})

const attrs = useAttrs()
</script>

<style>
.ft-icon-layers {
  display: inline-block;
  position: relative;
  line-height: 1;
}

.ft-icon-layers > .ft-icon {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  transform: translate(-50%, -50%);
}

.ft-icon-layers > .ft-icon:first-child {
  position: relative;
  inset: auto;
  transform: none;
}
</style>
