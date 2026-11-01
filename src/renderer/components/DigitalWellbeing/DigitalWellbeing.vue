<template>
  <FtPrompt
    v-if="mounted && prompt"
    autosize
    :label="promptContent.title"
    :extra-labels="[promptContent.message]"
    :option-names="promptContent.options.map(option => option.label)"
    :option-values="promptContent.options.map(option => option.value)"
    :option-icons="promptContent.options.map(option => option.icon)"
    @click="handlePromptAnswer"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'
import { formatTime } from '../../helpers/dateFormat'
import { syncedWatchStatsAvailable, watchSecondsForDevice } from '../../helpers/sync-watch-stats'
import {
  BEDTIME_SNOOZE_MS,
  LIMIT_EXTENSION_SECONDS,
  LIMIT_WARNING_SECONDS,
  PLAYBACK_ACTIVE_MS,
  bedtimeNightKey,
  dailyLimitStatus,
  formatWholeMinutes,
  isWithinDailyWindow,
  localDateKey,
  minuteOfDay,
  parseTimeOfDay,
} from '../../helpers/digitalWellbeing'

const CLOCK_INTERVAL_MS = 15_000

const { locale, t } = useI18n()

const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, CLOCK_INTERVAL_MS)
onBeforeUnmount(() => clearInterval(clock))

// The prompt teleports into .app, which is still being inserted while this mounts.
const mounted = ref(false)
onMounted(() => { mounted.value = true })

const wellbeing = computed(() => store.getters.getWellbeing)
const prompt = computed(() => wellbeing.value.prompt)
const today = computed(() => localDateKey(now.value))
watch(today, date => store.dispatch('startWellbeingDay', date), { immediate: true })
watch(() => store.getters.getWatchStatsResetVersion, () => store.dispatch('clearWellbeingTime'))

const isPlaying = computed(() => now.value - wellbeing.value.lastPlaybackAt < PLAYBACK_ACTIVE_MS)

/** Today's watch time on all synced devices, including time the statistics did not record. */
const watchSeconds = computed(() => {
  const localDays = store.getters.getWatchSecondsByDate
  const days = syncedWatchStatsAvailable(store.getters)
    ? watchSecondsForDevice(localDays, store.getters.getSyncedWatchStats, store.getters.getSyncServerDeviceId,
        'all', store.getters.getSyncServerWatchStatsReset)
    : localDays
  return (days[wellbeing.value.day.date] ?? 0) + wellbeing.value.day.unrecordedSeconds
})
const shortsSeconds = computed(() => wellbeing.value.day.shortsSeconds)

const watchStatus = computed(() => dailyLimitStatus(watchSeconds.value, store.getters.getDailyWatchTimeLimit,
  wellbeing.value.day.extraSeconds.watch, wellbeing.value.day.ignored.watch))
const shortsStatus = computed(() => dailyLimitStatus(shortsSeconds.value, store.getters.getDailyShortsLimit,
  wellbeing.value.day.extraSeconds.shorts, wellbeing.value.day.ignored.shorts))

const bedtimeStart = computed(() => parseTimeOfDay(store.getters.getBedtimeStart))
const bedtimeEnd = computed(() => parseTimeOfDay(store.getters.getBedtimeEnd))
const bedtime = computed(() => store.getters.getBedtimeReminder &&
  isWithinDailyWindow(minuteOfDay(new Date(now.value)), bedtimeStart.value, bedtimeEnd.value))
const bedtimeNight = computed(() => bedtime.value ? bedtimeNightKey(new Date(now.value), bedtimeStart.value) : null)
const bedtimeDue = computed(() => bedtime.value &&
  wellbeing.value.bedtimeDismissedNight !== bedtimeNight.value &&
  now.value >= wellbeing.value.bedtimeSnoozedUntil)
const bedtimeWaiting = computed(() => bedtimeDue.value && store.getters.getBedtimeWaitForVideoEnd && isPlaying.value)

watchEffect(() => {
  store.commit('updateWellbeingStatus', {
    watch: watchStatus.value,
    shorts: shortsStatus.value,
    bedtime: bedtime.value,
    bedtimeWaiting: bedtimeWaiting.value,
  })
})

const grayscale = computed(() => {
  switch (store.getters.getGrayscaleMode) {
    case 'always': return true
    case 'bedtime': return bedtime.value
    case 'limit': return watchStatus.value === 'reached'
    default: return false
  }
})
watchEffect(() => document.documentElement.classList.toggle('grayscale', grayscale.value))
onBeforeUnmount(() => document.documentElement.classList.remove('grayscale'))

/**
 * @param {'watch' | 'shorts'} kind
 * @param {'off' | 'ok' | 'warning' | 'reached'} status
 * @param {'off' | 'ok' | 'warning' | 'reached' | undefined} previous
 */
function handleLimitStatus(kind, status, previous) {
  if (status === previous) return
  if (status === 'warning') {
    const warningDuration = formatWholeMinutes(t, LIMIT_WARNING_SECONDS / 60)
    showToast({
      message: kind === 'watch'
        ? t('Digital Wellbeing.Watch time limit almost reached', { duration: warningDuration })
        : t('Digital Wellbeing.Shorts limit almost reached', { duration: warningDuration }),
      icon: ['fas', 'clock'],
    })
  } else if (status === 'reached' && previous !== undefined) {
    // Starting the app over a limit only blocks the next playback.
    if (store.getters.getDailyLimitAction === 'remind') {
      showToast({ message: limitTitle(kind), icon: ['fas', 'clock'] })
    } else if (isPlaying.value) {
      store.commit('requestWellbeingPause', { shortsOnly: kind === 'shorts' })
      store.commit('showWellbeingPrompt', kind)
    }
  }
}
watch(watchStatus, (status, previous) => handleLimitStatus('watch', status, previous), { immediate: true })
watch(shortsStatus, (status, previous) => handleLimitStatus('shorts', status, previous), { immediate: true })

const breakDue = computed(() => {
  const interval = store.getters.getBreakReminderInterval
  return interval > 0 && wellbeing.value.sessionSeconds >= interval * 60
})
watch(() => breakDue.value && prompt.value === null, due => {
  if (!due) return
  store.commit('requestWellbeingPause')
  store.commit('showWellbeingPrompt', 'break')
  store.commit('resetWellbeingSession')
})

// Immediate, so starting the app during bedtime reminds right away.
watch(() => bedtimeDue.value && !bedtimeWaiting.value && prompt.value === null, show => {
  if (!show) return
  store.commit('requestWellbeingPause')
  store.commit('showWellbeingPrompt', 'bedtime')
}, { immediate: true })

/** @param {'watch' | 'shorts'} kind */
function limitTitle(kind) {
  return kind === 'watch'
    ? t('Digital Wellbeing.Daily watch time limit reached')
    : t('Digital Wellbeing.Daily Shorts limit reached')
}

/** @param {number} seconds */
function formatSeconds(seconds) {
  return formatWholeMinutes(t, Math.max(1, Math.round(seconds / 60)))
}

function formatTimeOfDay(minutes) {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
  return formatTime(date, locale.value, store.getters.getTimeFormat, { timeStyle: 'short' })
}

const promptContent = computed(() => {
  const ok = { label: t('Ok'), value: 'ok', icon: ['fas', 'check'] }
  switch (prompt.value) {
    case 'watch':
    case 'shorts':
      return {
        title: limitTitle(prompt.value),
        message: prompt.value === 'watch'
          ? t('Digital Wellbeing.Watched today', { duration: formatSeconds(watchSeconds.value) })
          : t('Digital Wellbeing.Shorts watched today', { duration: formatSeconds(shortsSeconds.value) }),
        options: [
          ok,
          { label: t('Digital Wellbeing.15 More Minutes'), value: 'extend', icon: ['fas', 'plus'] },
          { label: t('Digital Wellbeing.Ignore for Today'), value: 'ignore', icon: ['fas', 'eye-slash'] },
        ],
      }
    case 'break':
      return {
        title: t('Digital Wellbeing.Time to take a break'),
        message: t('Digital Wellbeing.Watching for', {
          duration: formatWholeMinutes(t, store.getters.getBreakReminderInterval),
        }),
        options: [ok],
      }
    case 'bedtime':
      return {
        title: t('Digital Wellbeing.Time for bed'),
        message: t('Digital Wellbeing.Bedtime started at', { time: formatTimeOfDay(bedtimeStart.value ?? 0) }),
        options: [
          { label: t('Dismiss'), value: 'ok', icon: ['fas', 'check'] },
          { label: t('Digital Wellbeing.Remind Me in 10 Minutes'), value: 'snooze', icon: ['fas', 'clock'] },
        ],
      }
    default:
      return { title: '', message: '', options: [] }
  }
})

/** @param {string | null} value */
function handlePromptAnswer(value) {
  const kind = prompt.value
  store.commit('showWellbeingPrompt', null)

  if (kind === 'watch' || kind === 'shorts') {
    if (value === 'extend') {
      const used = kind === 'watch' ? watchSeconds.value : shortsSeconds.value
      const limit = (kind === 'watch' ? store.getters.getDailyWatchTimeLimit : store.getters.getDailyShortsLimit) * 60
      store.dispatch('extendWellbeingLimit', { kind, extraSeconds: Math.max(0, used - limit) + LIMIT_EXTENSION_SECONDS })
    } else if (value === 'ignore') {
      store.dispatch('extendWellbeingLimit', { kind, ignore: true })
    }
  } else if (kind === 'bedtime') {
    if (value === 'snooze') {
      store.commit('snoozeWellbeingBedtime', Date.now() + BEDTIME_SNOOZE_MS)
    } else if (bedtimeNight.value) {
      store.dispatch('dismissBedtime', bedtimeNight.value)
    }
  }
}
</script>
