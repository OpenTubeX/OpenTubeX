<template>
  <FtSettingsSection
    :title="$t('Settings.Privacy Settings.Privacy Settings')"
    :icon="['fas', 'user-lock']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        :title="$t('Settings.Privacy Settings.Remember History')"
        :icon="['fas', 'clock-rotate-left']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember History')"
          hide-label
          :default-value="rememberHistory"
          setting-key="rememberHistory"
          @change="handleRememberHistory"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :tooltip="$t('Settings.Privacy Settings.Watched Progress Saving Mode.Tooltip')"
        :title="$t('Settings.Privacy Settings.Save Watched Progress')"
        :icon="['fas', 'bars-progress']"
      >
        <FtSelect
          hide-label
          :placeholder="$t('Settings.Privacy Settings.Save Watched Progress')"
          :value="watchedProgressSavingMode"
          setting-key="watchedProgressSavingMode"
          :select-names="watchedProgressSavingModeNames"
          :select-values="WATCHED_PROGRESS_SAVING_MODE_VALUES"
          :disabled="!rememberHistory"
          @change="updateWatchedProgressSavingMode"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Privacy Settings.Save Watched Videos With Last Viewed Playlist')"
        :icon="['fas', 'playlist-check']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Save Watched Videos With Last Viewed Playlist')"
          hide-label
          :disabled="!rememberHistory"
          :default-value="saveVideoHistoryWithLastViewedPlaylist"
          setting-key="saveVideoHistoryWithLastViewedPlaylist"
          @change="updateSaveVideoHistoryWithLastViewedPlaylist"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Privacy Settings.Enable Watch Statistics')"
        :icon="['fas', 'chart-line']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Enable Watch Statistics')"
          hide-label
          :disabled="!rememberHistory"
          :default-value="enableWatchStats"
          setting-key="enableWatchStats"
          @change="store.dispatch('updateEnableWatchStats', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Privacy Settings.Week Starts On')"
        :icon="['fas', 'calendar-days']"
      >
        <FtSelect
          hide-label
          :placeholder="$t('Settings.Privacy Settings.Week Starts On')"
          :value="store.getters.getStatsWeekStartsOn"
          setting-key="statsWeekStartsOn"
          :select-names="weekStartNames"
          :select-values="WEEK_START_VALUES"
          :disabled="!rememberHistory || !enableWatchStats"
          @change="store.dispatch('updateStatsWeekStartsOn', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Privacy Settings.Remember Search History')"
        :icon="['fas', 'magnifying-glass']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember Search History')"
          hide-label
          :default-value="rememberSearchHistory"
          setting-key="rememberSearchHistory"
          @change="updateRememberSearchHistory"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.General Settings.Enable Search Suggestions')"
        :icon="['fas', 'search-suggestions']"
      >
        <FtToggleSwitch
          :label="$t('Settings.General Settings.Enable Search Suggestions')"
          hide-label
          :default-value="enableSearchSuggestions"
          setting-key="enableSearchSuggestions"
          @change="updateEnableSearchSuggestions"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="USING_ELECTRON || IS_CAPACITOR"
        :description="$t('Tooltips.General Settings.Remember Tab Navigation History')"
        :title="$t('Settings.General Settings.Remember Tab Navigation History')"
        :icon="['fas', 'tab-history']"
      >
        <FtToggleSwitch
          :label="$t('Settings.General Settings.Remember Tab Navigation History')"
          hide-label
          :default-value="rememberTabNavigationHistory"
          setting-key="rememberTabNavigationHistory"
          @change="updateRememberTabNavigationHistory"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="$t('Tooltips.General Settings.External Link Handling')"
        :title="$t('Settings.General Settings.External Link Handling.External Link Handling')"
        :icon="['fas', 'up-right-from-square']"
      >
        <FtSelect
          hide-label
          :placeholder="$t('Settings.General Settings.External Link Handling.External Link Handling')"
          :value="externalLinkHandling"
          setting-key="externalLinkHandling"
          :select-names="externalLinkHandlingNames"
          :select-values="EXTERNAL_LINK_HANDLING_VALUES"
          @change="updateExternalLinkHandling"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="$t('Settings.Privacy Settings.Internet Connectivity Checks Tooltip')"
        :title="$t('Settings.Privacy Settings.Internet Connectivity Checks')"
        :icon="['fas', 'wifi']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Internet Connectivity Checks')"
          hide-label
          :default-value="internetConnectivityChecks"
          setting-key="internetConnectivityChecks"
          @change="updateInternetConnectivityChecks"
        />
      </FtSettingsRow>
    </div>
    <div
      class="privacyRetention"
      role="group"
      :aria-labelledby="retentionTitleId"
    >
      <h4
        :id="retentionTitleId"
        class="groupTitle"
      >
        {{ $t('Settings.Privacy Settings.Automatic History Deletion') }}
        <FtTooltip
          class="selectTooltip"
          position="top"
          :tooltip="$t('Settings.Privacy Settings.Automatic History Retention Tooltip')"
        />
      </h4>
      <FtFlexBox>
        <FtInput
          :placeholder="$t('Settings.Privacy Settings.Keep Forever Placeholder')"
          :icon="['fas', 'clock-rotate-left']"
          :label="$t('Settings.Privacy Settings.Watch History Retention')"
          input-type="number"
          min="1"
          :value="historyRetentionDaysInput"
          setting-key="historyRetentionDays"
          :show-label="true"
          :allow-action-button-when-empty="true"
          :force-action-button-icon-name="['fas', 'check']"
          :disabled="!rememberHistory"
          @input="historyRetentionDaysInput = $event"
          @click="saveRetention('watch')"
        />
        <FtInput
          :placeholder="$t('Settings.Privacy Settings.Keep Forever Placeholder')"
          :icon="['fas', 'magnifying-glass']"
          :label="$t('Settings.Privacy Settings.Search History Retention')"
          input-type="number"
          min="1"
          :value="searchHistoryRetentionDaysInput"
          setting-key="searchHistoryRetentionDays"
          :show-label="true"
          :allow-action-button-when-empty="true"
          :force-action-button-icon-name="['fas', 'check']"
          :disabled="!rememberSearchHistory"
          @input="searchHistoryRetentionDaysInput = $event"
          @click="saveRetention('search')"
        />
      </FtFlexBox>
    </div>
    <FtFlexBox>
      <FtSlider
        :label="$t('Settings.Privacy Settings.Watched Percentage Threshold')"
        :default-value="watchedPercentageThreshold"
        setting-key="watchedPercentageThreshold"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="!rememberHistory && !playlistRemovesWatchedVideos"
        :tooltip="$t('Settings.Privacy Settings.Watched Percentage Threshold Tooltip')"
        @change="updateWatchedPercentageThreshold"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtTooltip from '../../FtTooltip/FtTooltip.vue'

import { compactAllDatastores } from '../../../../datastores/handlers/index'
import { normalizeRemoveWatchedVideosThreshold } from '../../../helpers/playlist-preferences-sync'
import { showToast } from '../../../helpers/utils'
import store from '../../../store/index'

const internetConnectivityChecks = computed(() => store.getters.getInternetConnectivityChecks)
function updateInternetConnectivityChecks(value) {
  store.dispatch('updateInternetConnectivityChecks', value)
}

const { locale, t } = useI18n()

/** @type {import('vue').ComputedRef<boolean>} */
const enableWatchStats = computed(() => store.getters.getEnableWatchStats)

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

const retentionTitleId = useId()
const USING_ELECTRON = process.env.IS_ELECTRON
const IS_CAPACITOR = process.env.IS_CAPACITOR

/** @type {import('vue').ComputedRef<boolean>} */
const rememberHistory = computed(() => store.getters.getRememberHistory)

/**
 * @param {boolean} value
 */
function handleRememberHistory(value) {
  store.dispatch('updateRememberHistory', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberSearchHistory = computed(() => store.getters.getRememberSearchHistory)

/**
 * @param {boolean} value
 */
function updateRememberSearchHistory(value) {
  store.dispatch('updateRememberSearchHistory', value)
}

/** @type {import('vue').ComputedRef<string>} */
const historyRetentionDays = computed(() => store.getters.getHistoryRetentionDays)
const historyRetentionDaysInput = ref(historyRetentionDays.value)
watch(historyRetentionDays, value => {
  historyRetentionDaysInput.value = value
})

/** @type {import('vue').ComputedRef<string>} */
const searchHistoryRetentionDays = computed(() => store.getters.getSearchHistoryRetentionDays)
const searchHistoryRetentionDaysInput = ref(searchHistoryRetentionDays.value)
watch(searchHistoryRetentionDays, value => {
  searchHistoryRetentionDaysInput.value = value
})

const RETENTION_SETTINGS = {
  watch: { input: historyRetentionDaysInput, update: 'updateHistoryRetentionDays', remove: 'removeHistoryOlderThan' },
  search: { input: searchHistoryRetentionDaysInput, update: 'updateSearchHistoryRetentionDays', remove: 'removeSearchHistoryOlderThan' }
}

/**
 * @param {string} value
 * @returns {string | null} The whole number of days, an empty string to keep everything, or null if invalid
 */
function parseDays(value) {
  if (value === '') return ''
  const days = Number(value)
  return Number.isInteger(days) && days > 0 ? String(days) : null
}

/**
 * Saves a retention period and removes the entries it no longer keeps.
 * @param {keyof typeof RETENTION_SETTINGS} kind
 */
async function saveRetention(kind) {
  const { input, update, remove } = RETENTION_SETTINGS[kind]
  const days = parseDays(input.value)
  if (days === null) {
    showToast({
      message: t('Settings.Privacy Settings.Invalid History Retention Days'),
      icon: ['fas', 'circle-exclamation']
    })
    return
  }

  input.value = days
  await store.dispatch(update, days)
  if (days !== '') {
    await store.dispatch(remove, days)
    // Frees the removed entries' pages on disk instead of leaving them until a later cleanup.
    await compactAllDatastores().catch(() => {})
  }
  showToast({
    message: t('Settings.Privacy Settings.History Retention Saved'),
    icon: ['fas', 'check']
  })
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableSearchSuggestions = computed(() => store.getters.getEnableSearchSuggestions)

/**
 * @param {boolean} value
 */
function updateEnableSearchSuggestions(value) {
  store.dispatch('updateEnableSearchSuggestions', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberTabNavigationHistory = computed(() => store.getters.getRememberTabNavigationHistory)

/**
 * @param {boolean} value
 */
function updateRememberTabNavigationHistory(value) {
  store.dispatch('updateRememberTabNavigationHistory', value)
}

const EXTERNAL_LINK_HANDLING_VALUES = ['', 'openLinkAfterPrompt', 'doNothing']

const externalLinkHandlingNames = computed(() => [
  t('Settings.General Settings.External Link Handling.Open Link'),
  t('Settings.General Settings.External Link Handling.Ask Before Opening Link'),
  t('Settings.General Settings.External Link Handling.No Action')
])

/** @type {import('vue').ComputedRef<'' | 'openLinkAfterPrompt' | 'doNothing'>} */
const externalLinkHandling = computed(() => store.getters.getExternalLinkHandling)

/**
 * @param {'' | 'openLinkAfterPrompt' | 'doNothing'} value
 */
function updateExternalLinkHandling(value) {
  store.dispatch('updateExternalLinkHandling', value)
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

// Playlists that remove watched videos use the threshold even without history,
// unless they have their own
/** @type {import('vue').ComputedRef<boolean>} */
const playlistRemovesWatchedVideos = computed(() => store.getters.getAllPlaylists.some(playlist => (
  playlist.removeWatchedVideos === true && normalizeRemoveWatchedVideosThreshold(playlist.removeWatchedVideosThreshold) === null
)))

/** @type {import('vue').ComputedRef<number>} */
const watchedPercentageThreshold = computed(() => store.getters.getWatchedPercentageThreshold)

/**
 * @param {number} value
 */
function updateWatchedPercentageThreshold(value) {
  store.dispatch('updateWatchedPercentageThreshold', value)
}

</script>

<style scoped>
.privacyRetention {
  margin-block-start: 1.5em;
}

/* Day counts need little room. The gap leaves room for each field's icons. */
.privacyRetention > .ft-flex-box {
  justify-content: center;
  gap: 0 72px;
}

.privacyRetention :deep(.ft-input-component) {
  inline-size: 240px;
  min-inline-size: 0;
}

/* Alone in its row, a field is centered: the space before it balances its
   icons after it, minus the marker gutter. */
@container settings-content (width <= 680px) {
  .privacyRetention :deep(.ft-input-component) {
    margin-inline-start: max(0px, var(--input-indicator-space, 0px) - var(--settings-marker-gutter, 0px));
  }
}

</style>
