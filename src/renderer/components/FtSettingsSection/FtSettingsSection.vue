<template>
  <div
    class="settingsSection"
  >
    <h3
      v-if="!hideTitle"
      :id="titleId"
      class="sectionTitle"
    >
      <span
        v-if="icon"
        class="sectionTitleIcon"
        aria-hidden="true"
      >
        <FtIcon :icon="icon" />
      </span>
      {{ title }}
    </h3>
    <div class="sectionBody">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

defineProps({
  title: {
    type: String,
    required: true
  },
  icon: {
    type: Array,
    default: null
  },
  hideTitle: {
    type: Boolean,
    default: false
  },
  /** Lets controls that repeat another section's label refer to this title. */
  titleId: {
    type: String,
    default: undefined
  }
})
</script>

<style scoped src="./FtSettingsSection.scss" lang="scss" />
