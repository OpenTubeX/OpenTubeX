<template>
  <FtSettingsSection
    :title="$t('Settings.Subscription Settings.Subscription Settings')"
    :icon="['fas', 'subscriptions']"
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
          v-if="(IS_CAPACITOR && !IS_IOS) || IS_ELECTRON"
          :label="$t('Settings.Subscription Settings.Refresh Subscriptions While App Is Closed')"
          :default-value="enableClosedAppSubscriptionRefresh"
          setting-key="enableClosedAppSubscriptionRefresh"
          :tooltip="$t('Tooltips.Subscription Settings.Refresh Subscriptions While App Is Closed')"
          compact
          @change="updateEnableClosedAppSubscriptionRefresh"
        />
        <FtToggleSwitch
          v-if="SUPPORTS_LOCAL_API"
          :label="$t('Settings.Subscription Settings.Faster Subscription Refresh')"
          :default-value="fastSubscriptionRefresh"
          setting-key="fastSubscriptionRefresh"
          :tooltip="$t('Tooltips.Subscription Settings.Faster Subscription Refresh')"
          compact
          @change="updateFastSubscriptionRefresh"
        />
        <FtToggleSwitch
          v-if="((IS_CAPACITOR && !IS_IOS) || IS_ELECTRON) && store.getters.getNotificationMode !== 'off'"
          :label="$t('Settings.Subscription Settings.Notify About New Uploads')"
          :default-value="enableUploadNotifications"
          setting-key="enableUploadNotifications"
          :tooltip="$t('Tooltips.Subscription Settings.Notify About New Uploads')"
          compact
          @change="updateEnableUploadNotifications"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Fetch Feeds from RSS')"
          :default-value="useRssFeeds"
          setting-key="useRssFeeds"
          :tooltip="$t('Tooltips.Subscription Settings.Fetch Feeds from RSS')"
          compact
          @change="updateUseRssFeeds"
        />
        <FtToggleSwitch
          v-if="SUPPORTS_LOCAL_API"
          :label="$t('Settings.Subscription Settings.Show Collaborations From Other Channels')"
          :default-value="includeSubscriptionCollaborations"
          setting-key="includeSubscriptionCollaborations"
          :tooltip="$t('Tooltips.Subscription Settings.Show Collaborations From Other Channels')"
          compact
          @change="updateIncludeSubscriptionCollaborations"
        />
        <FtToggleSwitch
          :label="$t('Settings.Subscription Settings.Confirm Before Unsubscribing')"
          :default-value="unsubscriptionPopupStatus"
          setting-key="unsubscriptionPopupStatus"
          compact
          @change="updateUnsubscriptionPopupStatus"
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
      </div>
    </div>
    <div class="subscriptionChannelSettingsManager">
      <SubscriptionChannelSettings />
    </div>
    <div
      class="autoRefreshIntervals"
      role="group"
      :aria-labelledby="autoRefreshTitleId"
    >
      <h4
        :id="autoRefreshTitleId"
        class="groupTitle"
      >
        {{ $t('Settings.Subscription Settings.Auto Refresh Interval') }}
        <FtTooltip
          class="selectTooltip"
          position="top"
          :tooltip="$t('Tooltips.Subscription Settings.Auto Refresh Interval')"
        />
      </h4>
      <div class="settingsSelectGrid autoRefreshIntervalSelects">
        <FtSelect
          size-to-content
          :placeholder="$t('Global.Videos')"
          :value="subscriptionFeedAutoRefreshInterval"
          setting-key="subscriptionFeedAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          :icon="['fas', 'video']"
          @change="updateSubscriptionFeedAutoRefreshInterval"
        />
        <FtSelect
          size-to-content
          :placeholder="$t('Global.Shorts')"
          :value="subscriptionShortsAutoRefreshInterval"
          setting-key="subscriptionShortsAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          :icon="['fas', 'clapperboard']"
          @change="updateSubscriptionShortsAutoRefreshInterval"
        />
        <FtSelect
          size-to-content
          :placeholder="$t('Global.Live')"
          :value="subscriptionLiveAutoRefreshInterval"
          setting-key="subscriptionLiveAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          :icon="['fas', 'tower-broadcast']"
          @change="updateSubscriptionLiveAutoRefreshInterval"
        />
        <FtSelect
          size-to-content
          :placeholder="$t('Global.Posts')"
          :value="subscriptionPostsAutoRefreshInterval"
          setting-key="subscriptionPostsAutoRefreshInterval"
          :select-names="subscriptionFeedAutoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          :icon="['fas', 'message']"
          @change="updateSubscriptionPostsAutoRefreshInterval"
        />
      </div>
    </div>
    <FtFlexBox>
      <FtCheckboxList
        v-model="subscriptionFeedsRefreshedTogether"
        class="checkboxColumns"
        :title="$t('Settings.Subscription Settings.Refresh These Feeds Together')"
        :tooltip="$t('Tooltips.Subscription Settings.Refresh These Feeds Together')"
        :labels="feedNames"
        :values="FEED_VALUES"
        :disabled-values="hiddenFeeds"
        setting-key="subscriptionFeedsRefreshedTogether"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtTooltip from '../../FtTooltip/FtTooltip.vue'
import FtCheckboxList from '../../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import SubscriptionChannelSettings from './SubscriptionChannelSettings.vue'

import store from '../../../store/index'
import { AUTO_REFRESH_INTERVAL_VALUES, getAutoRefreshIntervalNames } from '../../../helpers/autoRefreshIntervals'
import { getEnabledSubscriptionFeedSources } from '../../../helpers/newSubscriptionFeed'

const { t } = useI18n()
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const IS_ELECTRON = !!process.env.IS_ELECTRON
const SUPPORTS_LOCAL_API = !!process.env.SUPPORTS_LOCAL_API

const autoRefreshTitleId = useId()

/** @type {import('vue').ComputedRef<boolean>} */
const fetchSubscriptionsAutomatically = computed(() => store.getters.getFetchSubscriptionsAutomatically)

const subscriptionFeedAutoRefreshIntervalNames = computed(() => getAutoRefreshIntervalNames(t))

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

/** @type {import('vue').ComputedRef<boolean>} */
const enableUploadNotifications = computed(() => store.getters.getEnableUploadNotifications)

/**
 * @param {boolean} value
 */
function updateEnableUploadNotifications(value) {
  store.dispatch('updateEnableUploadNotifications', value)
}

const FEED_VALUES = ['videos', 'shorts', 'live', 'posts']
const feedNames = computed(() => [t('Global.Videos'), t('Global.Shorts'), t('Global.Live'), t('Global.Posts')])

/** Hidden feeds don't refresh, so they can't be refreshed together with others */
const hiddenFeeds = computed(() => {
  const shownFeeds = new Set(getEnabledSubscriptionFeedSources(store.getters).map(feed => feed.category))
  return FEED_VALUES.filter(feed => !shownFeeds.has(feed))
})

const subscriptionFeedsRefreshedTogether = computed({
  get: () => store.getters.getSubscriptionFeedsRefreshedTogether,
  set: (value) => store.dispatch('updateSubscriptionFeedsRefreshedTogether', value)
})

/** @type {import('vue').ComputedRef<boolean>} */
const fastSubscriptionRefresh = computed(() => store.getters.getFastSubscriptionRefresh)

/**
 * @param {boolean} value
 */
function updateFastSubscriptionRefresh(value) {
  store.dispatch('updateFastSubscriptionRefresh', value)
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
const includeSubscriptionCollaborations = computed(() => store.getters.getIncludeSubscriptionCollaborations)

/**
 * @param {boolean} value
 */
function updateIncludeSubscriptionCollaborations(value) {
  store.dispatch('updateIncludeSubscriptionCollaborations', value)
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
