<template>
  <FtSettingsSection
    :title="t('Settings.Distraction Free Settings.Sections.Digital Wellbeing')"
    hide-title
  >
    <div class="wellbeingColumns">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Grayscale')"
        :value="store.getters.getGrayscaleMode"
        setting-key="grayscaleMode"
        :select-names="grayscaleModeNames"
        :select-values="GRAYSCALE_MODES"
        :tooltip="t('Tooltips.Distraction Free Settings.Grayscale')"
        :icon="['fas', 'eye']"
        @change="store.dispatch('updateGrayscaleMode', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Apply Grayscale To')"
        :value="store.getters.getGrayscaleScope"
        setting-key="grayscaleScope"
        :select-names="grayscaleScopeNames"
        :select-values="GRAYSCALE_SCOPES"
        :disabled="store.getters.getGrayscaleMode === 'off'"
        :tooltip="t('Tooltips.Distraction Free Settings.Apply Grayscale To')"
        :icon="['fas', 'images']"
        @change="store.dispatch('updateGrayscaleScope', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Daily Watch Time Limit')"
        :value="String(store.getters.getDailyWatchTimeLimit)"
        setting-key="dailyWatchTimeLimit"
        :select-names="DAILY_LIMIT_MINUTES.map(formatMinutesOption)"
        :select-values="DAILY_LIMIT_MINUTES.map(String)"
        :tooltip="t('Tooltips.Distraction Free Settings.Daily Watch Time Limit')"
        :icon="['fas', 'clock']"
        @change="store.dispatch('updateDailyWatchTimeLimit', Number($event))"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Count Watch Time From')"
        :value="store.getters.getDailyWatchTimeLimitDevices"
        setting-key="dailyWatchTimeLimitDevices"
        :select-names="[t('Stats.All devices'), t('Settings.Sync Settings.This Device')]"
        :select-values="LIMIT_DEVICES"
        :disabled="store.getters.getDailyWatchTimeLimit === 0"
        :tooltip="t('Tooltips.Distraction Free Settings.Count Watch Time From')"
        :icon="['fas', 'devices']"
        @change="store.dispatch('updateDailyWatchTimeLimitDevices', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Daily Shorts Limit')"
        :value="String(store.getters.getDailyShortsLimit)"
        setting-key="dailyShortsLimit"
        :select-names="SHORTS_LIMIT_MINUTES.map(formatMinutesOption)"
        :select-values="SHORTS_LIMIT_MINUTES.map(String)"
        :tooltip="t('Tooltips.Distraction Free Settings.Daily Shorts Limit')"
        :icon="['fas', 'clock']"
        @change="store.dispatch('updateDailyShortsLimit', Number($event))"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.When a Limit Is Reached')"
        :value="store.getters.getDailyLimitAction"
        setting-key="dailyLimitAction"
        :select-names="dailyLimitActionNames"
        :select-values="DAILY_LIMIT_ACTIONS"
        :disabled="store.getters.getDailyWatchTimeLimit === 0 && store.getters.getDailyShortsLimit === 0"
        :tooltip="t('Tooltips.Distraction Free Settings.When a Limit Is Reached')"
        :icon="['fas', 'pause']"
        @change="store.dispatch('updateDailyLimitAction', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Take a Break Reminder')"
        :value="String(store.getters.getBreakReminderInterval)"
        setting-key="breakReminderInterval"
        :select-names="BREAK_INTERVAL_MINUTES.map(formatIntervalOption)"
        :select-values="BREAK_INTERVAL_MINUTES.map(String)"
        :tooltip="t('Tooltips.Distraction Free Settings.Take a Break Reminder')"
        :icon="['fas', 'clock']"
        @change="store.dispatch('updateBreakReminderInterval', Number($event))"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Break Reminder Action')"
        :value="store.getters.getBreakReminderAction"
        setting-key="breakReminderAction"
        :select-names="dailyLimitActionNames"
        :select-values="DAILY_LIMIT_ACTIONS"
        :disabled="store.getters.getBreakReminderInterval === 0"
        :icon="['fas', 'pause']"
        @change="store.dispatch('updateBreakReminderAction', $event)"
      />
    </div>
    <div class="wellbeingColumns">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime Reminder')"
          :compact="true"
          :default-value="bedtimeReminder"
          setting-key="bedtimeReminder"
          :tooltip="t('Tooltips.Distraction Free Settings.Bedtime Reminder')"
          @change="store.dispatch('updateBedtimeReminder', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Wait Until the Video Ends')"
          :compact="true"
          :disabled="!bedtimeReminder"
          :default-value="store.getters.getBedtimeWaitForVideoEnd"
          setting-key="bedtimeWaitForVideoEnd"
          @change="store.dispatch('updateBedtimeWaitForVideoEnd', $event)"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          v-if="uploadNotificationsAvailable"
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Silence Upload Notifications at Bedtime')"
          :compact="true"
          :default-value="store.getters.getBedtimeSilenceNotifications"
          setting-key="bedtimeSilenceNotifications"
          @change="store.dispatch('updateBedtimeSilenceNotifications', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Distraction Free Settings.Digital Wellbeing.Stop Autoplay at Bedtime and After the Daily Limit')"
          :compact="true"
          :default-value="store.getters.getStopAutoplayAtBedtimeAndLimit"
          setting-key="stopAutoplayAtBedtimeAndLimit"
          @change="store.dispatch('updateStopAutoplayAtBedtimeAndLimit', $event)"
        />
      </div>
    </div>
    <div class="wellbeingColumns">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime Start')"
        :value="store.getters.getBedtimeStart"
        setting-key="bedtimeStart"
        :select-names="bedtimeTimeNames"
        :select-values="BEDTIME_TIMES"
        :icon="['fas', 'moon']"
        @change="store.dispatch('updateBedtimeStart', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Distraction Free Settings.Digital Wellbeing.Bedtime End')"
        :value="store.getters.getBedtimeEnd"
        setting-key="bedtimeEnd"
        :select-names="bedtimeTimeNames"
        :select-values="BEDTIME_TIMES"
        :icon="['fas', 'moon']"
        @change="store.dispatch('updateBedtimeEnd', $event)"
      />
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

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

<style scoped>
/* Every block shares two equal columns, so the selects, switches, and
   bedtime selects below them start at the same edges. The selects fill
   their column and keep room for all of their icons, so their fields end
   at the same edge too. */
.wellbeingColumns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 32px;
  max-inline-size: calc(52rem + 40px);
}

.wellbeingColumns > .select.contentSized {
  --select-indicator-space: calc(8px + 32px + 22px + 22px);

  box-sizing: border-box;
  inline-size: auto;
  margin-inline: 0;

  /* The column sets the width, so a narrow one shrinks the field instead
     of pushing it under its icons. */
  grid-template-columns: minmax(0, 1fr) var(--select-indicator-space);
}

.wellbeingColumns > .switchColumn {
  align-items: start;
}

/* A label that wraps splits into even lines. */
.wellbeingColumns :deep(.switch-label-text) {
  text-wrap: balance;
}

/* Stacked, the fields keep as much room before them as their icons take
   after them, so they are centered. */
@container settings-content (width <= 680px) {
  .wellbeingColumns {
    grid-template-columns: minmax(0, 1fr);
    max-inline-size: calc(26rem + 40px + 2 * 84px);
  }

  /* The room before gives way first when the column runs out of space. */
  .wellbeingColumns > .select.contentSized {
    margin-inline-start: clamp(
      0px,
      100% - 200px - var(--select-indicator-space) - var(--settings-marker-gutter, 0px),
      var(--select-indicator-space) - var(--settings-marker-gutter, 0px)
    );
  }
}
</style>
