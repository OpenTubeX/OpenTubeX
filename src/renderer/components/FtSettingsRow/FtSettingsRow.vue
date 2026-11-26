<template>
  <div
    class="settingsRow"
    :class="{ stacked }"
  >
    <span
      v-if="icon"
      class="settingsRowIcon"
      aria-hidden="true"
    >
      <FtIcon :icon="icon" />
    </span>
    <div class="settingsRowText">
      <span
        :id="titleId"
        class="settingsRowTitle"
      >
        {{ title }}
        <FtTooltip
          v-if="tooltip"
          class="settingsRowTooltip"
          position="top"
          :tooltip="tooltip"
          allow-newlines
        />
      </span>
      <p
        v-if="description"
        class="settingsRowDescription"
      >
        {{ description }}
      </p>
    </div>
    <div class="settingsRowControl">
      <slot :title-id="titleId" />
    </div>
  </div>
</template>

<script setup>
import { useId } from 'vue'
import { FtIcon } from '@opentubex/icons'

import FtTooltip from '../FtTooltip/FtTooltip.vue'

defineProps({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  // Details too long for the description, shown beside the title
  tooltip: {
    type: String,
    default: ''
  },
  icon: {
    type: Array,
    default: null
  },
  // Puts the control below the text, for wide controls such as chip groups
  stacked: {
    type: Boolean,
    default: false
  }
})

const titleId = `${useId()}-title`
</script>

<style scoped src="./FtSettingsRow.css" />
