<template>
  <span
    v-if="canConfigureSync"
    class="syncedSettingIndicator"
    :class="{ syncDisabled: !isSynced }"
    role="button"
    tabindex="0"
    :aria-pressed="isSynced"
    :aria-label="label"
    :title="label"
    @click.prevent.stop="toggleSync"
    @keydown.enter.prevent.stop="toggleSync"
    @keydown.space.prevent.stop="toggleSync"
  >
    <FontAwesomeIcon :icon="isSynced ? ['fas', 'link'] : ['fas', 'link-slash']" />
  </span>
  <span
    v-if="showReset"
    class="changedSettingIndicator"
    role="button"
    tabindex="0"
    :aria-label="resetLabel"
    :title="resetLabel"
    @click.prevent.stop="resetToDefault"
    @keydown.enter.prevent.stop="resetToDefault"
    @keydown.space.prevent.stop="resetToDefault"
  >
    <FontAwesomeIcon :icon="['fas', 'undo']" />
  </span>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  DEFAULT_SETTINGS,
  isSettingSyncEnabled,
  isSettingSyncable
} from '../../store/modules/settings'
import store from '../../store/index'

const props = defineProps({
  settingKey: {
    type: String,
    default: ''
  },
  isChanged: {
    type: Boolean,
    default: null
  }
})

const emit = defineEmits(['reset'])

const { t } = useI18n()

const canConfigureSync = computed(() => {
  const settings = store.state.settings
  return settings.syncServerEnabled &&
    settings.syncServerToken !== '' &&
    settings.syncServerSyncSettings &&
    isSettingSyncable(props.settingKey)
})

const isSynced = computed(() => {
  return isSettingSyncEnabled(store.state.settings, props.settingKey)
})

const showReset = computed(() => {
  return store.state.settings.highlightChangedSettings === true &&
    props.settingKey !== 'highlightChangedSettings' &&
    (props.isChanged ?? (
      Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, props.settingKey) &&
      !settingsValuesEqual(store.state.settings[props.settingKey], DEFAULT_SETTINGS[props.settingKey])
    ))
})

const label = computed(() => isSynced.value
  ? t('Settings.Sync Settings.Disable Setting Sync')
  : t('Settings.Sync Settings.Enable Setting Sync'))

const resetLabel = computed(() => t('Settings.Reset Setting to Default'))

function settingsValuesEqual(currentValue, defaultValue) {
  if (Object.is(currentValue, defaultValue)) {
    return true
  }

  if (typeof currentValue !== 'object' || currentValue === null ||
      typeof defaultValue !== 'object' || defaultValue === null) {
    return false
  }

  return JSON.stringify(currentValue) === JSON.stringify(defaultValue)
}

function resetToDefault() {
  if (props.isChanged !== null) {
    emit('reset')
  } else {
    store.dispatch('resetSettingToDefault', props.settingKey)
  }
}

async function toggleSync() {
  const excluded = Array.isArray(store.state.settings.syncServerSettingsExcluded)
    ? store.state.settings.syncServerSettingsExcluded
    : []
  const next = isSynced.value
    ? [...excluded, props.settingKey]
    : excluded.filter(settingKey => settingKey !== props.settingKey)
  await store.dispatch('updateSyncServerSettingsExcluded', next)
  if (!next.includes(props.settingKey)) {
    store.dispatch('scheduleSyncServer', 'settings')
  }
}
</script>

<style scoped>
.syncedSettingIndicator,
.changedSettingIndicator {
  padding: 0;
  border: 0;
  color: inherit;
  background: none;
  cursor: pointer;
  display: inline-flex;
  font-size: 0.75em;
  margin-inline-start: 6px;
  vertical-align: middle;
}

.syncedSettingIndicator:hover,
.syncedSettingIndicator:focus-visible,
.changedSettingIndicator:hover,
.changedSettingIndicator:focus-visible {
  color: var(--primary-color);
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.changedSettingIndicator {
  color: var(--primary-color);
}

.syncDisabled {
  opacity: 0.55;
}
</style>
