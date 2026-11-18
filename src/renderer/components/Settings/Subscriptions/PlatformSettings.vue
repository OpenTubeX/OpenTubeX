<template>
  <FtSettingsSection
    :title="t('Settings.Subscription Settings.Platforms.Other Platforms')"
    :icon="['fas', 'globe']"
  >
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Subscription Settings.Platforms.Notify When Live')"
        :default-value="liveNotifications"
        setting-key="twitchLiveNotifications"
        :tooltip="t('Tooltips.Subscription Settings.Twitch Notify When Live')"
        :compact="true"
        @change="updateLiveNotifications"
      />
    </FtFlexBox>
    <FtFlexBox>
      <div class="autoRefreshInterval">
        <FtSelect
          :placeholder="t('Settings.Subscription Settings.Platforms.Auto Refresh Interval')"
          :value="autoRefreshInterval"
          setting-key="platformFeedAutoRefreshInterval"
          :select-names="autoRefreshIntervalNames"
          :select-values="AUTO_REFRESH_INTERVAL_VALUES"
          :tooltip="t('Tooltips.Subscription Settings.Platforms Auto Refresh Interval')"
          :icon="['fas', 'clock']"
          @change="value => store.dispatch('updatePlatformFeedAutoRefreshInterval', value)"
        />
      </div>
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { AUTO_REFRESH_INTERVAL_VALUES, getAutoRefreshIntervalNames } from '../../../helpers/autoRefreshIntervals'
import { getFollowedChannels, requestCapacitorNotificationPermission } from '../../../helpers/platformFeed'

const { t } = useI18n()

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

<style scoped src="./PlatformSettings.css" />
