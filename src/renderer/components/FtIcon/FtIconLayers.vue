<template>
  <FontAwesomeLayers
    v-if="useFontAwesome"
    v-bind="attrs"
  >
    <slot />
  </FontAwesomeLayers>
  <span
    v-else
    v-bind="attrs"
    class="ft-icon-layers"
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
