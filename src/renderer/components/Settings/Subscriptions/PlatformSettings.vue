<template>
  <FtSettingsSection
    :title="t('Settings.Subscription Settings.Platforms.Other Platforms')"
    :title-id="titleId"
    :icon="['fas', 'globe']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        v-if="supportsYtDlp"
        :description="t('Tooltips.Subscription Settings.Enable Twitch Page')"
        :title="t('Settings.Subscription Settings.Platforms.Enable Twitch Page')"
        :icon="['fas', 'twitch']"
      >
        <FtToggleSwitch
          :label="t('Settings.Subscription Settings.Platforms.Enable Twitch Page')"
          hide-label
          :default-value="enableTwitchPage"
          setting-key="enableTwitchPage"
          @change="value => store.dispatch('updateEnableTwitchPage', value)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Subscription Settings.Twitch Notify When Live')"
        :title="t('Settings.Subscription Settings.Platforms.Notify When Live')"
        :icon="['fas', 'bell']"
      >
        <FtToggleSwitch
          :label="t('Settings.Subscription Settings.Platforms.Notify When Live')"
          hide-label
          :default-value="liveNotifications"
          setting-key="twitchLiveNotifications"
          @change="updateLiveNotifications"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Subscription Settings.Platforms Auto Refresh Interval')"
        :title="t('Settings.Subscription Settings.Auto Refresh Interval')"
        :icon="['fas', 'clock']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Subscription Settings.Auto Refresh Interval')"
          :describe-by-id="titleId"
          :value="autoRefreshInterval"
          setting-key="platformFeedAutoRefreshInterval"
          :select-names="autoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          @change="value => store.dispatch('updatePlatformFeedAutoRefreshInterval', value)"
        />
      </FtSettingsRow>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { AUTO_REFRESH_INTERVAL_VALUES, getAutoRefreshIntervalNames } from '../../../helpers/autoRefreshIntervals'
import { getFollowedChannels, requestCapacitorNotificationPermission } from '../../../helpers/platformFeed'
import { supportsYtDlp } from '../../../helpers/ytDlpCapabilities'

const { t } = useI18n()

// The refresh select repeats another section's label, so it names its section.
const titleId = useId()

const enableTwitchPage = computed(() => store.getters.getEnableTwitchPage)
const liveNotifications = computed(() => store.getters.getTwitchLiveNotifications)

/**
 * Like following a Twitch channel with notifications on, turning them on for
 * followed channels asks for the permission to show them.
 * @param {boolean} value
 */
function updateLiveNotifications(value) {
  store.dispatch('updateTwitchLiveNotifications', value)
  if (process.env.IS_CAPACITOR && value && getFollowedChannels().some(channel => channel.platform === 'twitch')) {
    requestCapacitorNotificationPermission()
  }
}
const autoRefreshInterval = computed(() => store.getters.getPlatformFeedAutoRefreshInterval)
const autoRefreshIntervalNames = computed(() => getAutoRefreshIntervalNames(t))
</script>
