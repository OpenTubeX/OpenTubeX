<template>
  <FtSettingsSection
    :title="$t('Settings.Privacy Settings.Privacy Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember History')"
          compact
          :default-value="rememberHistory"
          setting-key="rememberHistory"
          @change="handleRememberHistory"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Enable Watch Statistics')"
          compact
          :disabled="!rememberHistory"
          :default-value="enableWatchStats"
          setting-key="enableWatchStats"
          @change="updateEnableWatchStats"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember Search History')"
          compact
          :default-value="rememberSearchHistory"
          setting-key="rememberSearchHistory"
          @change="updateRememberSearchHistory"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Save Watched Videos With Last Viewed Playlist')"
          compact
          :disabled="!rememberHistory"
          :default-value="saveVideoHistoryWithLastViewedPlaylist"
          setting-key="saveVideoHistoryWithLastViewedPlaylist"
          @change="updateSaveVideoHistoryWithLastViewedPlaylist"
        />
      </div>
    </div>
    <br>
    <FtFlexBox>
      <FtInput
        :placeholder="$t('Settings.Privacy Settings.Automatic History Retention Placeholder')"
        :label="$t('Settings.Privacy Settings.Automatic History Retention')"
        input-type="number"
        :value="historyRetentionDaysInput"
        setting-key="historyRetentionDays"
        :show-label="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'check']"
        :tooltip="$t('Settings.Privacy Settings.Automatic History Retention Tooltip')"
        :disabled="!rememberHistory"
        @input="historyRetentionDaysInput = $event"
        @click="saveHistoryRetention"
      />
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtSlider
        :label="$t('Settings.Privacy Settings.Watched Percentage Threshold')"
        :default-value="watchedPercentageThreshold"
        setting-key="watchedPercentageThreshold"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="!rememberHistory"
        :tooltip="$t('Settings.Privacy Settings.Watched Percentage Threshold Tooltip')"
        @change="updateWatchedPercentageThreshold"
      />
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtSelect
        :placeholder="$t('Settings.Privacy Settings.Week Starts On')"
        :value="statsWeekStartsOn"
        setting-key="statsWeekStartsOn"
        :select-names="weekStartNames"
        :select-values="WEEK_START_VALUES"
        :icon="['fas', 'chart-line']"
        :disabled="!rememberHistory || !enableWatchStats"
        @change="updateStatsWeekStartsOn"
      />
      <FtSelect
        :placeholder="$t('Settings.Privacy Settings.Save Watched Progress')"
        :value="watchedProgressSavingMode"
        setting-key="watchedProgressSavingMode"
        :select-names="watchedProgressSavingModeNames"
        :select-values="WATCHED_PROGRESS_SAVING_MODE_VALUES"
        :icon="['fas', 'bars-progress']"
        :tooltip="$t('Settings.Privacy Settings.Watched Progress Saving Mode.Tooltip')"
        :disabled="!rememberHistory"
        @change="updateWatchedProgressSavingMode"
      />
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtButton
        :label="$t('Settings.Privacy Settings.Clear Search History and Cache')"
        text-color="var(--destructive-text-color)"
        background-color="var(--destructive-color)"
        :icon="['fas', 'trash']"
        @click="showSearchCachePrompt = true"
      />
      <FtButton
        :label="$t('Settings.Privacy Settings.Remove Watch History')"
        text-color="var(--destructive-text-color)"
        background-color="var(--destructive-color)"
        :icon="['fas', 'trash']"
        @click="showRemoveHistoryPrompt = true"
      />
      <FtButton
        :label="$t('Settings.Privacy Settings.Remove All Subscriptions / Profiles')"
        text-color="var(--destructive-text-color)"
        background-color="var(--destructive-color)"
        :icon="['fas', 'trash']"
        @click="showRemoveSubscriptionsPrompt = true"
      />
      <FtButton
        :label="$t('Settings.Privacy Settings.Remove All Playlists')"
        text-color="var(--destructive-text-color)"
        background-color="var(--destructive-color)"
        :icon="['fas', 'trash']"
        @click="showRemovePlaylistsPrompt = true"
      />
    </FtFlexBox>
    <FtPrompt
      v-if="showSearchCachePrompt"
      :label="$t('Settings.Privacy Settings.Are you sure you want to clear out your search history and cache?')"
      :option-names="promptNames"
      :option-values="PROMPT_VALUES"
      is-first-option-destructive
      @click="handleSearchCache"
    />
    <FtPrompt
      v-if="showRemoveHistoryPrompt"
      :label="$t('Settings.Privacy Settings.Are you sure you want to remove your entire watch history?')"
      :option-names="promptNames"
      :option-values="PROMPT_VALUES"
      is-first-option-destructive
      @click="handleRemoveHistory"
    />
    <FtPrompt
      v-if="showRemoveSubscriptionsPrompt"
      :label="removeSubscriptionsPromptMessage"
      :option-names="promptNames"
      :option-values="PROMPT_VALUES"
      is-first-option-destructive
      @click="handleRemoveSubscriptions"
    />
    <FtPrompt
      v-if="showRemovePlaylistsPrompt"
      :label="$t('Settings.Privacy Settings.Are you sure you want to remove all your playlists?')"
      :option-names="promptNames"
      :option-values="PROMPT_VALUES"
      is-first-option-destructive
      @click="handleRemovePlaylists"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from './FtButton/FtButton.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtInput from './FtInput/FtInput.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'

import store from '../store/index'

import { MAIN_PROFILE_ID } from '../../constants'
import { showToast } from '../helpers/utils'

const { locale, t } = useI18n()

const PROMPT_VALUES = ['delete', 'cancel']
const promptNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

const removeSubscriptionsPromptMessage = computed(() => {
  return t('Settings.Privacy Settings["Are you sure you want to remove all subscriptions and profiles?  This cannot be undone."]')
})

/** @type {import('vue').ComputedRef<boolean>} */
const rememberHistory = computed(() => store.getters.getRememberHistory)

/** @type {import('vue').ComputedRef<boolean>} */
const enableWatchStats = computed(() => store.getters.getEnableWatchStats)

/**
 * @param {boolean} value
 */
function updateEnableWatchStats(value) {
  store.dispatch('updateEnableWatchStats', value)
}

const WEEK_START_VALUES = ['0', '1', '2', '3', '4', '5', '6']
const weekStartNames = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'long' })
  const sunday = new Date(2024, 0, 7, 12)

  return WEEK_START_VALUES.map((_, index) => {
    const date = new Date(sunday)
    date.setDate(date.getDate() + index)
    return formatter.format(date)
  })
})

/** @type {import('vue').ComputedRef<string>} */
const statsWeekStartsOn = computed(() => store.getters.getStatsWeekStartsOn)

/**
 * @param {string} value
 */
function updateStatsWeekStartsOn(value) {
  store.dispatch('updateStatsWeekStartsOn', value)
}

/**
 * @param {boolean} value
 */
function handleRememberHistory(value) {
  store.dispatch('updateRememberHistory', value)
}

/** @type {import('vue').ComputedRef<string>} */
const historyRetentionDays = computed(() => store.getters.getHistoryRetentionDays)
const historyRetentionDaysInput = ref(historyRetentionDays.value)

watch(historyRetentionDays, value => {
  historyRetentionDaysInput.value = value
})

function parseDays(value, allowEmpty = false) {
  if (allowEmpty && value === '') {
    return ''
  }

  const days = Number(value)
  return Number.isInteger(days) && days > 0 ? String(days) : null
}

async function saveHistoryRetention() {
  const days = parseDays(historyRetentionDaysInput.value, true)
  if (days === null) {
    showToast({
      message: t('Settings.Privacy Settings.Invalid History Retention Days'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  historyRetentionDaysInput.value = days
  await store.dispatch('updateHistoryRetentionDays', days)
  if (days !== '') {
    await store.dispatch('removeHistoryOlderThan', days)
  }
  showToast({ message: t('Settings.Privacy Settings.History Retention Saved'), icon: ['fas', 'check'] })
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberSearchHistory = computed(() => store.getters.getRememberSearchHistory)

/**
 * @param {boolean} value
 */
function updateRememberSearchHistory(value) {
  store.dispatch('updateRememberSearchHistory', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const saveVideoHistoryWithLastViewedPlaylist = computed(() => store.getters.getSaveVideoHistoryWithLastViewedPlaylist)

/**
 * @param {boolean} value
 */
function updateSaveVideoHistoryWithLastViewedPlaylist(value) {
  store.dispatch('updateSaveVideoHistoryWithLastViewedPlaylist', value)
}

const WATCHED_PROGRESS_SAVING_MODE_VALUES = ['auto', 'semi-auto', 'never']
const watchedProgressSavingModeNames = computed(() => [
  t('Settings.Privacy Settings.Watched Progress Saving Mode.Modes.Auto'),
  t('Settings.Privacy Settings.Watched Progress Saving Mode.Modes.Semi-auto'),
  t('Settings.Privacy Settings.Watched Progress Saving Mode.Modes.Never')
])

/** @type {import('vue').ComputedRef<'auto' | 'semi-auto' | 'never'>} */
const watchedProgressSavingMode = computed(() => store.getters.getWatchedProgressSavingMode)

/**
 * @param {'auto' | 'semi-auto' | 'never'} value
 */
function updateWatchedProgressSavingMode(value) {
  store.dispatch('updateWatchedProgressSavingMode', value)
}

/** @type {import('vue').ComputedRef<number>} */
const watchedPercentageThreshold = computed(() => store.getters.getWatchedPercentageThreshold)

/**
 * @param {number} value
 */
function updateWatchedPercentageThreshold(value) {
  store.dispatch('updateWatchedPercentageThreshold', value)
}

const showSearchCachePrompt = ref(false)

/**
 * @param {'delete' | 'cancel' | null} option
 */
function handleSearchCache(option) {
  showSearchCachePrompt.value = false

  if (option !== 'delete') { return }

  store.dispatch('clearSessionSearchHistory')
  store.dispatch('removeAllSearchHistoryEntries')
  showToast({
    message: t('Settings.Privacy Settings.Search history and cache have been cleared'),
    icon: ['fas', 'trash'],
  })
}

const showRemoveHistoryPrompt = ref(false)

/**
 * @param {'delete' | 'cancel' | null} option
 */
function handleRemoveHistory(option) {
  showRemoveHistoryPrompt.value = false

  if (option !== 'delete') { return }

  store.dispatch('removeAllHistory')
  showToast({ message: t('Settings.Privacy Settings.Watch history has been cleared'), icon: ['fas', 'trash'] })
}

const showRemoveSubscriptionsPrompt = ref(false)

const profileList = computed(() => store.getters.getProfileList)

/**
 * @param {'delete' | 'cancel' | null} option
 */
function handleRemoveSubscriptions(option) {
  showRemoveSubscriptionsPrompt.value = false

  if (option !== 'delete') { return }

  store.dispatch('updateActiveProfile', MAIN_PROFILE_ID)

  profileList.value.forEach((profile) => {
    if (profile._id === MAIN_PROFILE_ID) {
      const newProfile = {
        _id: MAIN_PROFILE_ID,
        name: profile.name,
        bgColor: profile.bgColor,
        textColor: profile.textColor,
        subscriptions: []
      }
      store.dispatch('updateProfile', newProfile)
    } else {
      store.dispatch('removeProfile', profile._id)
    }
  })

  store.dispatch('clearSubscriptionsCache')
}

const showRemovePlaylistsPrompt = ref(false)

/**
 * @param {'delete' | 'cancel' | null} option
 */
function handleRemovePlaylists(option) {
  showRemovePlaylistsPrompt.value = false

  if (option !== 'delete') { return }

  store.dispatch('removeAllPlaylists')
  store.dispatch('updateQuickBookmarkTargetPlaylistId', 'favorites')
  showToast({ message: t('Settings.Privacy Settings.All playlists have been removed'), icon: ['fas', 'trash'] })
}
</script>
