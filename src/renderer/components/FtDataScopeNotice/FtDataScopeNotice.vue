<template>
  <p
    v-if="profile"
    class="dataScopeNotice"
  >
    <FtIcon
      class="dataScopeNoticeIcon"
      :icon="settings ? ['fas', 'circle-user'] : ['fas', 'user-lock']"
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
  },
  /** Whether it explains that settings changes only apply to the active profile, which has its own settings */
  settings: {
    type: Boolean,
    default: false
  }
})

const { t } = useI18n()

/** The active profile while it keeps its data, or its settings, separate */
const profile = computed(() => {
  if (props.settings) return store.getters.getProfileSettingsTarget === null ? null : store.getters.getActiveProfile
  return store.getters.getActiveDataScope === null ? null : store.getters.getActiveProfile
})

const message = computed(() => {
  const name = profile.value?.name ?? ''
  if (props.settings) return t('Profile.Own Settings Notice', { profile: name })
  return props.storage
    ? t('Profile.Separate Data Storage Notice', { profile: name })
    : t('Profile.Separate Data Notice', { profile: name })
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
