<template>
  <FtSettingsSection
    :title="$t('Settings.Subscription Settings.Subscription Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Fetch Feed on Startup')"
          :default-value="fetchSubscriptionsAutomatically"
          setting-key="fetchSubscriptionsAutomatically"
          :tooltip="$t('Tooltips.Subscription Settings.Fetch Feed on Startup')"
          compact
          @change="updateFetchSubscriptionsAutomatically"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="$t('Settings.Subscription Settings.Refresh Subscriptions While App Is Closed')"
          :default-value="enableClosedAppSubscriptionRefresh"
          setting-key="enableClosedAppSubscriptionRefresh"
          :tooltip="$t('Tooltips.Subscription Settings.Refresh Subscriptions While App Is Closed')"
          compact
          @change="updateEnableClosedAppSubscriptionRefresh"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Videos Auto Refresh Interval')"
          :value="subscriptionFeedAutoRefreshInterval"
          setting-key="subscriptionFeedAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionFeedAutoRefreshInterval"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Shorts Auto Refresh Interval')"
          :value="subscriptionShortsAutoRefreshInterval"
          setting-key="subscriptionShortsAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionShortsAutoRefreshInterval"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Live Auto Refresh Interval')"
          :value="subscriptionLiveAutoRefreshInterval"
          setting-key="subscriptionLiveAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionLiveAutoRefreshInterval"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Posts Auto Refresh Interval')"
          :value="subscriptionPostsAutoRefreshInterval"
          setting-key="subscriptionPostsAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionPostsAutoRefreshInterval"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Limit the number of videos displayed for each channel')"
          :default-value="onlyShowLatestFromChannel"
          setting-key="onlyShowLatestFromChannel"
          compact
          @change="updateOnlyShowLatestFromChannel"
        />
        <div class="onlyShowLatestFromChannelNumber">
          <FtSlider
            :label="$t('Settings.Subscription Settings.To')"
            :default-value="onlyShowLatestFromChannelNumber"
            setting-key="onlyShowLatestFromChannelNumber"
            :disabled="!onlyShowLatestFromChannel"
            :min-value="1"
            :max-value="useRssFeeds ? 15 : 30"
            :step="1"
            @change="updateOnlyShowLatestFromChannelNumber"
          />
        </div>
        <div class="subscriptionChannelSettingsManager">
          <SubscriptionChannelSettings />
        </div>
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Fetch Feeds from RSS')"
          :default-value="useRssFeeds"
          setting-key="useRssFeeds"
          :tooltip="$t('Tooltips.Subscription Settings.Fetch Feeds from RSS')"
          compact
          @change="updateUseRssFeeds"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Show New Content Feed')"
          :default-value="showNewSubscriptionFeed"
          setting-key="showNewSubscriptionFeed"
          :tooltip="$t('Tooltips.Subscription Settings.Show New Content Feed')"
          compact
          @change="updateShowNewSubscriptionFeed"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Show Scheduled Live Streams / Premieres First')"
          :default-value="showScheduledLiveStreamsFirst"
          setting-key="showScheduledLiveStreamsFirst"
          :tooltip="$t('Tooltips.Subscription Settings.Show Scheduled Live Streams / Premieres First')"
          compact
          @change="updateShowScheduledLiveStreamsFirst"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Show New Content Indicators')"
          :default-value="showNewSubscriptionFeedIndicators"
          setting-key="showNewSubscriptionFeedIndicators"
          :tooltip="$t('Tooltips.Subscription Settings.Show New Content Indicators')"
          compact
          @change="updateShowNewSubscriptionFeedIndicators"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Confirm Before Unsubscribing')"
          :default-value="unsubscriptionPopupStatus"
          setting-key="unsubscriptionPopupStatus"
          compact
          @change="updateUnsubscriptionPopupStatus"
        />
      </div>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import SubscriptionChannelSettings from '../SubscriptionChannelSettings/SubscriptionChannelSettings.vue'

import store from '../../store/index'

const { t } = useI18n()
const IS_CAPACITOR = !!process.env.IS_CAPACITOR

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const subscriptionFeedAutoRefreshIntervalNames = computed(() => [
  t('Settings.General Settings.Avoid translation.Disabled'),
  '30 min',
  '1 h',
  '2 h',
  '4 h',
  '6 h',
  '8 h'
])

const subscriptionFeedAutoRefreshIntervalValues = [
  '0',
  '1800000',
  '3600000',
  '7200000',
  '14400000',
  '21600000',
  '28800000'
]

/**
 * @param {boolean} value
 */
function updateFetchSubscriptionsAutomatically(value) {
  store.dispatch('updateFetchSubscriptionsAutomatically', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableClosedAppSubscriptionRefresh = computed(() => store.getters.getEnableClosedAppSubscriptionRefresh)

/**
 * @param {boolean} value
 */
function updateEnableClosedAppSubscriptionRefresh(value) {
  store.dispatch('updateEnableClosedAppSubscriptionRefresh', value)
}

/** @type {import('vue').ComputedRef<string>} */
const subscriptionFeedAutoRefreshInterval = computed(() => store.getters.getSubscriptionFeedAutoRefreshInterval)

/**
 * @param {string} value
 */
function updateSubscriptionFeedAutoRefreshInterval(value) {
  store.dispatch('updateSubscriptionFeedAutoRefreshInterval', value)
}

/** @type {import('vue').ComputedRef<string>} */
const subscriptionShortsAutoRefreshInterval = computed(() => store.getters.getSubscriptionShortsAutoRefreshInterval)

/**
 * @param {string} value
 */
function updateSubscriptionShortsAutoRefreshInterval(value) {
  store.dispatch('updateSubscriptionShortsAutoRefreshInterval', value)
}

/** @type {import('vue').ComputedRef<string>} */
const subscriptionLiveAutoRefreshInterval = computed(() => store.getters.getSubscriptionLiveAutoRefreshInterval)

/**
 * @param {string} value
 */
function updateSubscriptionLiveAutoRefreshInterval(value) {
  store.dispatch('updateSubscriptionLiveAutoRefreshInterval', value)
}

/** @type {import('vue').ComputedRef<string>} */
const subscriptionPostsAutoRefreshInterval = computed(() => store.getters.getSubscriptionPostsAutoRefreshInterval)

/**
 * @param {string} value
 */
function updateSubscriptionPostsAutoRefreshInterval(value) {
  store.dispatch('updateSubscriptionPostsAutoRefreshInterval', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useRssFeeds = computed(() => store.getters.getUseRssFeeds)

/**
 * @param {boolean} value
 */
function updateUseRssFeeds(value) {
  store.dispatch('updateUseRssFeeds', value)
  const max = value ? 15 : 30
  if (onlyShowLatestFromChannelNumber.value > max) {
    updateOnlyShowLatestFromChannelNumber(max)
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const showNewSubscriptionFeedIndicators = computed(() => store.getters.getShowNewSubscriptionFeedIndicators)

/** @type {import('vue').ComputedRef<boolean>} */
const showNewSubscriptionFeed = computed(() => store.getters.getShowNewSubscriptionFeed)

/** @type {import('vue').ComputedRef<boolean>} */
const showScheduledLiveStreamsFirst = computed(() => store.getters.getShowScheduledLiveStreamsFirst)

/**
 * @param {boolean} value
 */
function updateShowNewSubscriptionFeed(value) {
  store.dispatch('updateShowNewSubscriptionFeed', value)
}

/**
 * @param {boolean} value
 */
function updateShowScheduledLiveStreamsFirst(value) {
  store.dispatch('updateShowScheduledLiveStreamsFirst', value)
}

/**
 * @param {boolean} value
 */
function updateShowNewSubscriptionFeedIndicators(value) {
  store.dispatch('updateShowNewSubscriptionFeedIndicators', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const unsubscriptionPopupStatus = computed(() => store.getters.getUnsubscriptionPopupStatus)

/**
 * @param {boolean} value
 */
function updateUnsubscriptionPopupStatus(value) {
  store.dispatch('updateUnsubscriptionPopupStatus', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const onlyShowLatestFromChannel = computed(() => store.getters.getOnlyShowLatestFromChannel)

/**
 * @param {boolean} value
 */
function updateOnlyShowLatestFromChannel(value) {
  store.dispatch('updateOnlyShowLatestFromChannel', value)
}

/** @type {import('vue').ComputedRef<number>} */
const onlyShowLatestFromChannelNumber = computed(() => store.getters.getOnlyShowLatestFromChannelNumber)

/**
 * @param {number} value
 */
function updateOnlyShowLatestFromChannelNumber(value) {
  store.dispatch('updateOnlyShowLatestFromChannelNumber', value)
}
</script>

<style scoped src="./SubscriptionSettings.css" />
