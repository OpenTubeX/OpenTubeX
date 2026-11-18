<template>
  <p
    v-if="separateProfile"
    class="dataScopeNotice"
  >
    <FtIcon
      class="dataScopeNoticeIcon"
      :icon="['fas', 'user-lock']"
      aria-hidden="true"
    />
    <span>{{ message }}</span>
  </p>
</template>

<script setup>
import { computed } from 'vue'
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'

const props = defineProps({
  /** Whether it explains storage usage and deletion instead of imports and exports */
  storage: {
    type: Boolean,
    default: false
  }
})

const { t } = useI18n()

/** The active profile while it keeps its data separate */
const separateProfile = computed(() => {
  return store.getters.getActiveDataScope === null ? null : store.getters.getActiveProfile
})

const message = computed(() => {
  const profile = separateProfile.value?.name ?? ''
  return props.storage
    ? t('Profile.Separate Data Storage Notice', { profile })
    : t('Profile.Separate Data Notice', { profile })
})
</script>

<style scoped>
.dataScopeNotice {
  display: flex;
  margin-block: 12px;
  padding-block: 12px;
  padding-inline: 16px;
  align-items: flex-start;
  gap: 12px;
  border-radius: var(--shape-corner-medium);
  background-color: color-mix(in srgb, var(--accent-color) 12%, transparent);
  color: var(--primary-text-color);
}

.dataScopeNoticeIcon {
  flex-shrink: 0;
  margin-block-start: 2px;
  color: var(--accent-color);
}
</style>
