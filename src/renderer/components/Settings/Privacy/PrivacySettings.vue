<template>
  <FtSettingsSection
    :title="$t('Settings.Privacy Settings.Privacy Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Internet Connectivity Checks')"
          :tooltip="$t('Settings.Privacy Settings.Internet Connectivity Checks Tooltip')"
          compact
          :default-value="internetConnectivityChecks"
          setting-key="internetConnectivityChecks"
          @change="updateInternetConnectivityChecks"
        />
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember History')"
          compact
          :default-value="rememberHistory"
          setting-key="rememberHistory"
          @change="handleRememberHistory"
        />
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Remember Search History')"
          compact
          :default-value="rememberSearchHistory"
          setting-key="rememberSearchHistory"
          @change="updateRememberSearchHistory"
        />
        <FtToggleSwitch
          :label="$t('Settings.Privacy Settings.Save Watched Videos With Last Viewed Playlist')"
          compact
          :disabled="!rememberHistory"
          :default-value="saveVideoHistoryWithLastViewedPlaylist"
          setting-key="saveVideoHistoryWithLastViewedPlaylist"
          @change="updateSaveVideoHistoryWithLastViewedPlaylist"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.General Settings.Enable Search Suggestions')"
          :default-value="enableSearchSuggestions"
          setting-key="enableSearchSuggestions"
          compact
          @change="updateEnableSearchSuggestions"
        />
        <FtToggleSwitch
          v-if="USING_ELECTRON || IS_CAPACITOR"
          :label="$t('Settings.General Settings.Remember Tab Navigation History')"
          :default-value="rememberTabNavigationHistory"
          setting-key="rememberTabNavigationHistory"
          :tooltip="$t('Tooltips.General Settings.Remember Tab Navigation History')"
          compact
          @change="updateRememberTabNavigationHistory"
        />
      </div>
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
    <div class="privacyExternalLinkHandling">
      <FtSelect
        class="privacyExternalLinkSelect"
        :placeholder="$t('Settings.General Settings.External Link Handling.External Link Handling')"
        :value="externalLinkHandling"
        :select-names="externalLinkHandlingNames"
        :select-values="EXTERNAL_LINK_HANDLING_VALUES"
        :icon="['fas', 'external-link-alt']"
        :tooltip="$t('Tooltips.General Settings.External Link Handling')"
        @change="updateExternalLinkHandling"
      />
    </div>
    <FtFlexBox>
      <FtSelect
        class="privacyWatchedProgressSelect"
        :placeholder="$t('Settings.Privacy Settings.Save Watched Progress')"
        :value="watchedProgressSavingMode"
        setting-key="watchedProgressSavingMode"
        :select-names="watchedProgressSavingModeNames"
        :select-values="WATCHED_PROGRESS_SAVING_MODE_VALUES"
        :icon="['fas', 'bars-progress']"
        :tooltip="$t('Settings.Privacy Settings.Watched Progress Saving Mode.Tooltip')"
        :disabled="!rememberHistory"
        size-to-content
        @change="updateWatchedProgressSavingMode"
      />
    </FtFlexBox>
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
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtTooltip from '../../FtTooltip/FtTooltip.vue'

import { compactAllDatastores } from '../../../../datastores/handlers/index'
import { showToast } from '../../../helpers/utils'
import store from '../../../store/index'

const internetConnectivityChecks = computed(() => store.getters.getInternetConnectivityChecks)
function updateInternetConnectivityChecks(value) {
  store.dispatch('updateInternetConnectivityChecks', value)
}

const { t } = useI18n()

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

// Playlists that remove watched videos use the threshold even without history
/** @type {import('vue').ComputedRef<boolean>} */
const playlistRemovesWatchedVideos = computed(() => store.getters.getAllPlaylists.some(playlist => playlist.removeWatchedVideos === true))

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

.privacyWatchedProgressSelect.select.outlined :deep(.selectOutline) {
  position: relative;
  inset-block: auto;
  margin-block-start: -7px;
}

.privacyWatchedProgressSelect.select.outlined :deep(.selectLegend) {
  max-inline-size: none;
  margin-inline-end: 40px;
}

@media (any-pointer: coarse), (width <= 680px) {
  .privacyWatchedProgressSelect.select.outlined :deep(.selectOutline) {
    margin-block-start: -9px;
  }
}

.privacyExternalLinkHandling {
  display: flex;
  justify-content: center;
}

.privacyExternalLinkSelect.containsTooltip {
  --privacy-select-indicator-space: 40px;

  box-sizing: border-box;
  inline-size: min(100%, 330px);
  margin-inline-end: 0;
}

.privacyExternalLinkSelect:has(
  :deep(.syncedSettingIndicator),
  :deep(.changedSettingIndicator)
) {
  --privacy-select-indicator-space: 70px;
}

.privacyExternalLinkSelect :deep(.select-text),
.privacyExternalLinkSelect :deep(.nativeSelect),
.privacyExternalLinkSelect :deep(.select-bar) {
  inline-size: calc(100% - var(--privacy-select-indicator-space));
}

.privacyExternalLinkSelect :deep(.iconSelect) {
  inset-inline-end: calc(var(--privacy-select-indicator-space) + 10px);
}

.privacyExternalLinkSelect :deep(.selectIndicators) {
  inset-inline: auto 8px;
}

.privacyExternalLinkSelect :deep(.changedSettingIndicatorPlaceholder) {
  display: none;
}

</style>
