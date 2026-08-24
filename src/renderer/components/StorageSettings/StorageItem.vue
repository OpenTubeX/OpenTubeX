<template>
  <article class="storageItem">
    <header class="storageItemHeader">
      <div>
        <h4>{{ title }}</h4>
        <span
          v-if="kind"
          class="storageKind"
        >{{ kind }}</span>
      </div>
      <strong
        class="storageSize"
      >{{ size }}</strong>
    </header>
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
    <div class="storageActions">
      <slot />
    </div>
  </article>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

defineProps({
  title: { type: String, required: true },
  kind: { type: String, default: '' },
  size: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, default: '' },
  locationIsDirectory: { type: Boolean, default: false }
})
</script>

<style scoped src="./StorageItem.css" />
