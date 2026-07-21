<template>
  <span
    v-if="isSynced"
    class="syncedSettingIndicator"
    role="img"
    :aria-label="t('Settings.Sync Settings.Synced Setting')"
    :title="t('Settings.Sync Settings.Synced Setting')"
  >
    <FontAwesomeIcon :icon="['fas', 'sync']" />
  </span>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { SYNCABLE_SETTINGS } from '../../helpers/sync-server'
import store from '../../store/index'

const props = defineProps({
  settingKey: {
    type: String,
    default: ''
  }
})

const { t } = useI18n()

const isSynced = computed(() => {
  const settings = store.state.settings
  return settings.syncServerToken !== '' &&
    settings.syncServerSyncSettings &&
    SYNCABLE_SETTINGS.has(props.settingKey)
})
</script>

<style scoped>
.syncedSettingIndicator {
  display: inline-flex;
  font-size: 0.75em;
  margin-inline-start: 6px;
  vertical-align: middle;
}
</style>
