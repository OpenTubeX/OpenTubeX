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
      <FtSyncedSettingIndicator
        v-if="syncSettingKey"
        :setting-keys="[syncSettingKey]"
      />
    </h3>
    <div class="sectionBody">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

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
  },
  /** Offers a sync toggle in the title for a section that edits a single setting. */
  syncSettingKey: {
    type: String,
    default: ''
  }
})
</script>

<style scoped src="./FtSettingsSection.scss" lang="scss" />
