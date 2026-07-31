<template>
  <FontAwesomeIcon
    v-if="useFontAwesome"
    :icon="icon"
    :fixed-width="fixedWidth"
    :size="size"
    :transform="transform"
    :class="iconClass"
    :style="iconStyle"
  />
  <Icon
    v-else-if="iconifyId"
    :icon="iconifyId"
    :class="['ft-icon', { 'ft-icon--fw': fixedWidth }, iconClass]"
    :style="iconStyle"
    width="1em"
    height="1em"
    aria-hidden="true"
  />
</template>

<script setup>
import { computed, useAttrs } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome-original'

import { currentIconPack } from '../../icons/iconPackState'
import { resolveIconifyId } from '../../icons/resolveIconifyId'

defineOptions({
  inheritAttrs: false
})

const props = defineProps({
  icon: {
    type: [Array, String, Object],
    required: true
  },
  fixedWidth: {
    type: Boolean,
    default: false
  },
  size: {
    type: [String, Number],
    default: null
  },
  transform: {
    type: [String, Object],
    default: null
  }
})

const attrs = useAttrs()

const useFontAwesome = computed(() => currentIconPack.value === 'fontawesome')

const iconifyId = computed(() => resolveIconifyId(props.icon))

const iconClass = computed(() => attrs.class)

const iconStyle = computed(() => {
  const style = { ...(typeof attrs.style === 'object' && attrs.style ? attrs.style : {}) }
  if (props.size != null && props.size !== '') {
    const value = typeof props.size === 'number' || /^\d+$/.test(String(props.size))
      ? `${props.size}px`
      : props.size
    style.fontSize = value
  }
  return style
})
</script>

<style>
.ft-icon {
  display: inline-block;
  flex-shrink: 0;
  overflow: visible;
  vertical-align: -0.125em;
}

.ft-icon--fw {
  inline-size: 1.25em;
  text-align: center;
}
</style>
