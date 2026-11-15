<template>
  <article
    class="storageItem"
    :class="{ hasSetting: !!$slots.setting }"
  >
    <span
      class="storageItemIcon"
      aria-hidden="true"
    >
      <FtIcon :icon="icon" />
    </span>
    <h4>{{ title }}</h4>
    <p class="storageDescription">
      {{ description }}
    </p>
    <p
      v-if="location"
      class="storageLocation"
    >
      <FtIcon
        :icon="locationIsDirectory ? ['fas', 'folder-open'] : ['fas', 'file-lines']"
        aria-hidden="true"
      />
      <code>{{ location }}</code>
    </p>
    <strong class="storageSize">{{ size }}</strong>
    <div class="storageControls">
      <div
        v-if="$slots.setting"
        class="storageSettingControl"
      >
        <slot name="setting" />
      </div>
      <div class="storageActions">
        <slot />
      </div>
    </div>
  </article>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

defineProps({
  icon: { type: Array, required: true },
  title: { type: String, required: true },
  size: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, default: '' },
  locationIsDirectory: { type: Boolean, default: false }
})
</script>

<style scoped src="./StorageItem.css" />
