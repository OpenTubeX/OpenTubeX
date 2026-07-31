<template>
  <FontAwesomeLayers
    v-if="useFontAwesome"
    :class="attrs.class"
    :style="attrs.style"
  >
    <slot />
  </FontAwesomeLayers>
  <span
    v-else
    class="ft-icon-layers"
    :class="attrs.class"
    :style="attrs.style"
  >
    <slot />
  </span>
</template>

<script setup>
import { computed, useAttrs } from 'vue'
import { FontAwesomeLayers } from '@fortawesome/vue-fontawesome-original'

import { currentIconPack } from '../../icons/iconPackState'

defineOptions({
  inheritAttrs: false
})

const attrs = useAttrs()
const useFontAwesome = computed(() => currentIconPack.value === 'fontawesome')
</script>

<style>
.ft-icon-layers {
  display: inline-block;
  position: relative;
  line-height: 1;
}

.ft-icon-layers > .ft-icon,
.ft-icon-layers > .svg-inline--fa {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  transform: translate(-50%, -50%);
}

.ft-icon-layers > .ft-icon:first-child,
.ft-icon-layers > .svg-inline--fa:first-child {
  position: relative;
  inset: auto;
  transform: none;
}
</style>
