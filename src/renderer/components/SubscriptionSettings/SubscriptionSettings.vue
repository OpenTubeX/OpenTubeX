<template>
  <FtSettingsSection
    :title="$t('Settings.Subscription Settings.Subscription Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Fetch Feed on Startup')"
          :default-value="fetchSubscriptionsAutomatically"
          :tooltip="$t('Tooltips.Subscription Settings.Fetch Feed on Startup')"
          compact
          @change="updateFetchSubscriptionsAutomatically"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Videos Auto Refresh Interval')"
          :value="subscriptionFeedAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionFeedAutoRefreshInterval"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Shorts Auto Refresh Interval')"
          :value="subscriptionShortsAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionShortsAutoRefreshInterval"
        />
        <FtSelect
          :placeholder="$t('Settings.Subscription Settings.Live Auto Refresh Interval')"
          :value="subscriptionLiveAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="subscriptionFeedAutoRefreshIntervalValues"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="updateSubscriptionLiveAutoRefreshInterval"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Fetch Feeds from RSS')"
          :default-value="useRssFeeds"
          :tooltip="$t('Tooltips.Subscription Settings.Fetch Feeds from RSS')"
          compact
          @change="updateUseRssFeeds"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Confirm Before Unsubscribing')"
          :default-value="unsubscriptionPopupStatus"
          compact
          @change="updateUnsubscriptionPopupStatus"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Limit the number of videos displayed for each channel')"
          :default-value="onlyShowLatestFromChannel"
          compact
          @change="updateOnlyShowLatestFromChannel"
        />
        <div class="onlyShowLatestFromChannelNumber">
          <FtSlider
            :label="$t('Settings.Subscription Settings.To')"
            :default-value="onlyShowLatestFromChannelNumber"
            :disabled="!onlyShowLatestFromChannel"
            :min-value="1"
            :max-value="30"
            :step="1"
            @change="updateOnlyShowLatestFromChannelNumber"
          />
        </div>
      </div>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const subscriptionFeedAutoRefreshIntervalNames = [
  'Disabled',
  '30 min',
  '1 h',
  '2 h',
  '4 h',
  '6 h',
  '8 h'
]

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

/** @type {import('vue').ComputedRef<boolean>} */
const useRssFeeds = computed(() => store.getters.getUseRssFeeds)

/**
 * @param {boolean} value
 */
function updateUseRssFeeds(value) {
  store.dispatch('updateUseRssFeeds', value)
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
