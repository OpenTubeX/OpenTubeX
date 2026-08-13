<template>
  <span
    class="profileIcon"
    :style="{ background: profile.bgColor, color: profile.textColor }"
  >
    <img
      v-if="imageSource"
      class="profileIconImage"
      :src="imageSource"
      alt=""
    >
    <span
      v-else
      class="profileIconText"
      dir="auto"
    >
      {{ iconText }}
    </span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

import { getCustomIconImageSource } from '../../helpers/customIcons'

const props = defineProps({
  profile: {
    type: Object,
    required: true
  },
  fallback: {
    type: String,
    default: ''
  }
})

const imageSource = computed(() => getCustomIconImageSource(props.profile.icon))

const iconText = computed(() => {
  const icon = props.profile.icon
  return icon?.type === 'emoji' && typeof icon.value === 'string'
    ? icon.value
    : props.fallback
})
</script>

<style scoped>
.profileIcon {
  align-items: center;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  overflow: hidden;
  user-select: none;
}

.profileIconImage {
  block-size: 100%;
  inline-size: 100%;
  object-fit: cover;
}

.profileIconText {
  line-height: 1;
}
</style>
