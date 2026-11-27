<template>
  <FtSettingsSection
    :title="t('Settings.Distraction Free Settings.Sections.Digital Wellbeing')"
    hide-title
  >
    <div class="settingsRows">
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Grayscale')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Grayscale')"
        :icon="['fas', 'eye']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Grayscale')"
          :value="store.getters.getGrayscaleMode"
          setting-key="grayscaleMode"
          :select-names="grayscaleModeNames"
          :select-values="GRAYSCALE_MODES"
          @change="store.dispatch('updateGrayscaleMode', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :tooltip="t('Tooltips.Distraction Free Settings.Apply Grayscale To')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Apply Grayscale To')"
        :icon="['fas', 'images']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Apply Grayscale To')"
          :value="store.getters.getGrayscaleScope"
          setting-key="grayscaleScope"
          :select-names="grayscaleScopeNames"
          :select-values="GRAYSCALE_SCOPES"
          :disabled="store.getters.getGrayscaleMode === 'off'"
          @change="store.dispatch('updateGrayscaleScope', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Daily Watch Time Limit')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Daily Watch Time Limit')"
        :icon="['fas', 'clock']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Daily Watch Time Limit')"
          :value="String(store.getters.getDailyWatchTimeLimit)"
          setting-key="dailyWatchTimeLimit"
          :select-names="DAILY_LIMIT_MINUTES.map(formatMinutesOption)"
          :select-values="DAILY_LIMIT_MINUTES.map(String)"
          @change="store.dispatch('updateDailyWatchTimeLimit', Number($event))"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Count Watch Time From')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Count Watch Time From')"
        :icon="['fas', 'devices']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Count Watch Time From')"
          :value="store.getters.getDailyWatchTimeLimitDevices"
          setting-key="dailyWatchTimeLimitDevices"
          :select-names="[t('Stats.All devices'), t('Settings.Sync Settings.This Device')]"
          :select-values="LIMIT_DEVICES"
          :disabled="store.getters.getDailyWatchTimeLimit === 0"
          @change="store.dispatch('updateDailyWatchTimeLimitDevices', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Daily Shorts Limit')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Daily Shorts Limit')"
        :icon="['fas', 'clapperboard']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Daily Shorts Limit')"
          :value="String(store.getters.getDailyShortsLimit)"
          setting-key="dailyShortsLimit"
          :select-names="SHORTS_LIMIT_MINUTES.map(formatMinutesOption)"
          :select-values="SHORTS_LIMIT_MINUTES.map(String)"
          @change="store.dispatch('updateDailyShortsLimit', Number($event))"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :tooltip="t('Tooltips.Distraction Free Settings.When a Limit Is Reached')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.When a Limit Is Reached')"
        :icon="['fas', 'pause']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.When a Limit Is Reached')"
          :value="store.getters.getDailyLimitAction"
          setting-key="dailyLimitAction"
          :select-names="dailyLimitActionNames"
          :select-values="DAILY_LIMIT_ACTIONS"
          :disabled="store.getters.getDailyWatchTimeLimit === 0 && store.getters.getDailyShortsLimit === 0"
          @change="store.dispatch('updateDailyLimitAction', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Take a Break Reminder')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Take a Break Reminder')"
        :icon="['fas', 'bell']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Take a Break Reminder')"
          :value="String(store.getters.getBreakReminderInterval)"
          setting-key="breakReminderInterval"
          :select-names="BREAK_INTERVAL_MINUTES.map(formatIntervalOption)"
          :select-values="BREAK_INTERVAL_MINUTES.map(String)"
          @change="store.dispatch('updateBreakReminderInterval', Number($event))"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Break Reminder Action')"
        :icon="['fas', 'pause']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Break Reminder Action')"
          :value="store.getters.getBreakReminderAction"
          setting-key="breakReminderAction"
          :select-names="dailyLimitActionNames"
          :select-values="DAILY_LIMIT_ACTIONS"
          :disabled="store.getters.getBreakReminderInterval === 0"
          @change="store.dispatch('updateBreakReminderAction', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Tooltips.Distraction Free Settings.Bedtime Reminder')"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime Reminder')"
        :icon="['fas', 'moon']"
      >
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime Reminder')"
          hide-label
          :default-value="bedtimeReminder"
          setting-key="bedtimeReminder"
          @change="store.dispatch('updateBedtimeReminder', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime Start')"
        :icon="['fas', 'clock']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime Start')"
          :value="store.getters.getBedtimeStart"
          setting-key="bedtimeStart"
          :select-names="bedtimeTimeNames"
          :select-values="BEDTIME_TIMES"
          @change="store.dispatch('updateBedtimeStart', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime End')"
        :icon="['fas', 'sun']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime End')"
          :value="store.getters.getBedtimeEnd"
          setting-key="bedtimeEnd"
          :select-names="bedtimeTimeNames"
          :select-values="BEDTIME_TIMES"
          @change="store.dispatch('updateBedtimeEnd', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Wait Until the Video Ends')"
        :icon="['fas', 'circle-play']"
      >
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Wait Until the Video Ends')"
          hide-label
          :disabled="!bedtimeReminder"
          :default-value="store.getters.getBedtimeWaitForVideoEnd"
          setting-key="bedtimeWaitForVideoEnd"
          @change="store.dispatch('updateBedtimeWaitForVideoEnd', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="uploadNotificationsAvailable"
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Silence Upload Notifications at Bedtime')"
        :icon="['fas', 'bell-slash']"
      >
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Silence Upload Notifications at Bedtime')"
          hide-label
          :default-value="store.getters.getBedtimeSilenceNotifications"
          setting-key="bedtimeSilenceNotifications"
          @change="store.dispatch('updateBedtimeSilenceNotifications', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Distraction Free Settings.Digital Wellbeing.Stop Autoplay at Bedtime and After the Daily Limit')"
        :icon="['fas', 'autoplay']"
      >
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Stop Autoplay at Bedtime and After the Daily Limit')"
          hide-label
          :default-value="store.getters.getStopAutoplayAtBedtimeAndLimit"
          setting-key="stopAutoplayAtBedtimeAndLimit"
          @change="store.dispatch('updateStopAutoplayAtBedtimeAndLimit', $event)"
        />
      </FtSettingsRow>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'

import store from '../../../store/index'

import { formatTime } from '../../../helpers/dateFormat'
import { supportsUploadNotifications as uploadNotificationsSupported } from '../../../helpers/uploadNotifications'
import {

  BREAK_INTERVAL_MINUTES,
  DAILY_LIMIT_MINUTES,
  SHORTS_LIMIT_MINUTES,
  formatWholeMinutes,
} from '../../../helpers/digitalWellbeing'

const uploadNotificationsAvailable = computed(() => uploadNotificationsSupported && store.getters.getNotificationMode !== 'off')

const { locale, t } = useI18n()

const GRAYSCALE_MODES = ['off', 'always', 'bedtime', 'limit']
const GRAYSCALE_SCOPES = ['app', 'content', 'notDownloaded']
const DAILY_LIMIT_ACTIONS = ['remind', 'pause']
const LIMIT_DEVICES = ['all', 'local']
const BEDTIME_TIMES = Array.from({ length: 48 }, (_, index) =>
  `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`)

const grayscaleModeNames = computed(() => [
  t('Settings.Distraction Free Settings.Digital Wellbeing.Off'),
  t('Settings.Distraction Free Settings.Digital Wellbeing.Always'),
  t('Settings.Distraction Free Settings.Digital Wellbeing.During Bedtime'),
  t('Settings.Distraction Free Settings.Digital Wellbeing.After the Daily Limit'),
])
const grayscaleScopeNames = computed(() => [
  t('Settings.Distraction Free Settings.Digital Wellbeing.Whole App'),
  t('Settings.Distraction Free Settings.Digital Wellbeing.Videos and Images'),
  t('Settings.Distraction Free Settings.Digital Wellbeing.Videos and Images Not Downloaded'),
])
const dailyLimitActionNames = computed(() => [
  t('Settings.Distraction Free Settings.Digital Wellbeing.Remind Me'),
  t('Settings.Distraction Free Settings.Digital Wellbeing.Pause Playback'),
])
const bedtimeTimeNames = computed(() => BEDTIME_TIMES.map(time => {
  const [hours, minutes] = time.split(':').map(Number)
  return formatTime(new Date(2000, 0, 1, hours, minutes), locale.value, store.getters.getTimeFormat, { timeStyle: 'short' })
}))
const bedtimeReminder = computed(() => store.getters.getBedtimeReminder)

/** @param {number} minutes */
function formatMinutesOption(minutes) {
  return minutes === 0
    ? t('Settings.Distraction Free Settings.Digital Wellbeing.Off')
    : formatWholeMinutes(t, minutes)
}

/** @param {number} minutes */
function formatIntervalOption(minutes) {
  return minutes === 0
    ? t('Settings.Distraction Free Settings.Digital Wellbeing.Off')
    : t('Settings.Distraction Free Settings.Digital Wellbeing.Every', { duration: formatWholeMinutes(t, minutes) })
}
</script>
