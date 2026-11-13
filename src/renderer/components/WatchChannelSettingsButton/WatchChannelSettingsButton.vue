<template>
  <FtIconButton
    v-if="actions.length > 0"
    ref="button"
    :title="t('Video.Save Channel Setting')"
    :icon="['fas', 'floppy-disk']"
    :overlay-icon="actions.some(action => action.saved) ? ['fas', 'check'] : null"
    theme="base-no-default"
    :dropdown-portal="dropdownPortal"
    dropdown-class="channelSettingsDropdown"
    dropdown-position-x="left"
    force-dropdown
    :mobile-actions="mobileActions"
  >
    <div
      v-for="action in actions"
      :key="action.value"
      class="channelSettingRow"
    >
      <button
        type="button"
        class="channelSettingSave"
        :disabled="action.disabled"
        @click="save(action.value)"
      >
        <FtIcon
          :icon="action.icon"
          aria-hidden="true"
        />
        <span>{{ action.label }}</span>
      </button>
      <FtIconButton
        :disabled="!action.saved"
        :size="14"
        theme="base-no-default"
        :title="t('Settings.Channel Settings.Forget Value')"
        :icon="['fas', 'trash']"
        @click="remove(action.value)"
      />
    </div>
  </FtIconButton>
</template>

<script setup>
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtIconButton from '../FtIconButton/FtIconButton.vue'

import store from '../../store'
import {
  CHANNEL_PREFERENCE_TYPES,
  formatChannelPreferenceValue,
  parseChannelPreferences,
  removeChannelPreference
} from '../../helpers/channel-preferences'

/** @typedef {'playbackSpeed' | 'videoQuality' | 'subtitlesState' | 'volume'} ChannelPreferenceType */

const props = defineProps({
  /** The key the settings are saved under, empty when the channel is unknown */
  channelId: { type: String, required: true },
  currentPlaybackRate: { type: Number, default: null },
  currentVideoQuality: { type: String, default: null },
  currentSubtitlesState: { type: Boolean, default: null },
  currentVolume: { type: Number, default: null },
  /**
   * The settings that apply to the playing media
   * @type {import('vue').PropType<ChannelPreferenceType[]>}
   */
  types: { type: Array, default: () => CHANNEL_PREFERENCE_TYPES.map(({ type }) => type) },
  dropdownPortal: { type: Boolean, default: false }
})

const emit = defineEmits(['save'])

const { t } = useI18n()

const button = useTemplateRef('button')

const actionDetails = computed(() => ({
  playbackSpeed: {
    label: t('Video.Save Channel Playback Speed'),
    settingLabel: t('Settings.Player Settings.Playback Speed'),
    icon: ['fas', 'gauge'],
    current: props.currentPlaybackRate
  },
  videoQuality: {
    label: t('Video.Save Channel Video Quality'),
    settingLabel: t('Settings.Channel Settings.Video Quality'),
    icon: ['fas', 'photo-film'],
    current: props.currentVideoQuality
  },
  subtitlesState: {
    label: t('Video.Save Channel Subtitles State'),
    settingLabel: t('Search Listing.Label.Subtitles'),
    icon: ['fas', 'closed-captioning'],
    current: props.currentSubtitlesState
  },
  volume: {
    label: t('Video.Save Channel Volume'),
    settingLabel: t('Settings.Channel Settings.Volume'),
    icon: ['fas', 'volume-high'],
    current: props.currentVolume
  }
}))

const actions = computed(() => {
  if (!store.getters.getEnableChannelSettings || props.channelId === '') {
    return []
  }

  return CHANNEL_PREFERENCE_TYPES
    // Settings that save on their own need no button, and phones keep the system volume
    .filter(({ type, autoUpdateKey }) => props.types.includes(type) &&
      !store.getters[`get${autoUpdateKey[0].toUpperCase()}${autoUpdateKey.slice(1)}`] &&
      (type !== 'volume' || !process.env.IS_CAPACITOR))
    .map(({ type, valuesKey }) => {
      const { label, settingLabel, icon, current } = actionDetails.value[type]
      const savedValue = parseChannelPreferences(store.state.settings[valuesKey], valuesKey)[props.channelId]
      const saved = savedValue !== undefined
      // Player-driven values (especially volume) stay null until initialization finishes;
      // keep the action disabled so the parent handler cannot silently no-op.
      const isAlreadyCurrent = current !== null && saved && String(savedValue) === String(current)
      const formattedValue = saved ? formatChannelPreferenceValue(type, savedValue, t) : ''

      return {
        value: type,
        label: isAlreadyCurrent
          ? t('Video.Channel Setting Already Set', { setting: settingLabel, value: formattedValue })
          : saved ? `${label}: ${formattedValue}` : label,
        settingLabel,
        icon,
        saved,
        disabled: current === null || isAlreadyCurrent
      }
    })
})

// The bottom sheet has no room for trailing buttons, so saved values get their own rows.
const mobileActions = computed(() => [
  ...actions.value.map(action => ({
    label: action.label,
    icon: action.icon,
    enabled: !action.disabled,
    run: () => save(action.value)
  })),
  { type: 'separator' },
  ...actions.value.filter(action => action.saved).map(action => ({
    label: t('Display Label', { label: t('Settings.Channel Settings.Forget Value'), value: action.settingLabel }),
    icon: ['fas', 'trash'],
    run: () => remove(action.value)
  }))
])

/** @param {ChannelPreferenceType} type */
function save(type) {
  button.value?.hideDropdown()
  emit('save', type)
}

/** @param {ChannelPreferenceType} type */
async function remove(type) {
  await removeChannelPreference(store, props.channelId, type)
  button.value?.hideDropdown()
}
</script>

<style scoped src="./WatchChannelSettingsButton.css" />
