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
        <FtPerformanceImpact
          v-if="performanceImpactKey"
          class="settingsRowPerformanceImpact"
          compact
          :setting-key="performanceImpactKey"
        />
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
        :id="descriptionId"
        class="settingsRowDescription"
      >
        {{ description }}
      </p>
    </div>
    <div class="settingsRowControl">
      <slot :title-id="titleId" />
    </div>
    <!-- Controls that refine the row's setting, such as a slider for its
         amount, below the text and control. -->
    <div
      v-if="$slots.details"
      class="settingsRowDetails"
    >
      <slot name="details" />
    </div>
  </div>
</template>

<script setup>
import { computed, provide, useId } from 'vue'
import { FtIcon } from '@opentubex/icons'

import FtPerformanceImpact from '../FtPerformanceImpact/FtPerformanceImpact.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'
import { SETTINGS_ROW_DESCRIPTION_ID } from './settingsRowContext'

const props = defineProps({
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
  // Shows the badge for controls that hide the label it normally sits in, such as selects
  performanceImpactKey: {
    type: String,
    default: ''
  },
  // Puts the control below the text, for wide controls such as chip groups
  stacked: {
    type: Boolean,
    default: false
  }
})

const id = useId()
const titleId = `${id}-title`
const descriptionId = `${id}-description`

// The row's control is described by the description beside its title.
provide(SETTINGS_ROW_DESCRIPTION_ID, computed(() => props.description ? descriptionId : null))
</script>

<style scoped src="./FtSettingsRow.css" />
