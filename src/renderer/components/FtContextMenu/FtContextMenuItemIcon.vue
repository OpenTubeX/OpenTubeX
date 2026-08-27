<template>
  <span
    class="itemIcon"
    :class="iconClass"
    aria-hidden="true"
  >
    <img
      v-if="hasImageIcon"
      class="itemImageIcon"
      :src="item.icon"
      alt=""
      referrerpolicy="no-referrer"
      @error="failedImageIcon = item.icon"
    >
    <FtIcon
      v-else-if="item.groupColor == null"
      :icon="icon"
    />
    <span
      v-else
      class="groupColorSwatch"
      :style="groupColorStyle"
    />
    <FtIcon
      v-if="item.checked"
      class="checkedMark"
      :icon="['fas', 'check']"
    />
  </span>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref } from 'vue'

import { getTabAccentColor } from '../../constants/tabColors'

const props = defineProps({
  item: {
    type: Object,
    required: true
  },
  icon: {
    type: Array,
    required: true
  },
  iconClass: {
    type: [String, Array, Object],
    default: undefined
  }
})

const failedImageIcon = ref(null)

const groupColorStyle = computed(() => ({
  '--group-color': getTabAccentColor(props.item.groupColor) ?? 'var(--secondary-text-color)'
}))

const hasImageIcon = computed(() => {
  return typeof props.item.icon === 'string' &&
    props.item.icon.length > 0 &&
    props.item.icon !== failedImageIcon.value
})
</script>

<style scoped src="./FtContextMenuItemIcon.css" />
