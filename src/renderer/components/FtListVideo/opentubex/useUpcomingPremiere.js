import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { showToast } from '../../../helpers/utils'
import { liveReminder, supportsLiveReminders } from '../../../helpers/liveReminders'

const MAX_TIMEOUT_DELAY = 2_147_483_647

/**
 * Tracks when a card's scheduled premiere starts and toggles its live reminder.
 * `premiereNow` advances once the start time passes, so time-dependent actions
 * such as the reminder and marking the video as watched update on their own.
 *
 * Its watchers run immediately, so call it once the card's video ID is parsed.
 *
 * @param {{ id: import('vue').Ref<string>, title: import('vue').Ref<string>, premiereTimestamp: import('vue').ComputedRef<number | null>, toastThumbnail: import('vue').ComputedRef<string | null>, t: (key: string, values?: object) => string }} options
 */
export function useUpcomingPremiere({ id, title, premiereTimestamp, toastThumbnail, t }) {
  const premiereNow = ref(Date.now())
  const liveReminderActive = ref(false)
  const liveReminderLoading = ref(false)
  let premiereStartTimer = null
  let liveReminderLoadGeneration = 0
  let removeLiveReminderUpdatedListener = null

  const canToggleLiveReminder = computed(() => (
    supportsLiveReminders &&
    premiereTimestamp.value != null &&
    premiereTimestamp.value > premiereNow.value
  ))

  function clearPremiereStartTimer() {
    if (premiereStartTimer != null) {
      clearTimeout(premiereStartTimer)
      premiereStartTimer = null
    }
  }

  function schedulePremiereStartInvalidation() {
    clearPremiereStartTimer()

    const timestamp = premiereTimestamp.value
    const now = Date.now()
    premiereNow.value = now
    if (timestamp == null || timestamp <= now) {
      return
    }

    premiereStartTimer = setTimeout(() => {
      premiereStartTimer = null
      schedulePremiereStartInvalidation()
    }, Math.min(timestamp - now + 1, MAX_TIMEOUT_DELAY))
  }

  function getLiveReminderPayload() {
    return {
      videoId: id.value,
      startTimestamp: premiereTimestamp.value,
      notificationTitle: t('Video.Scheduled video starting'),
      notificationBody: t('Video.Live notification body', { videoTitle: title.value })
    }
  }

  async function syncLiveReminder() {
    const generation = ++liveReminderLoadGeneration
    const videoId = id.value
    const startTimestamp = premiereTimestamp.value

    if (!canToggleLiveReminder.value) {
      liveReminderActive.value = false
      return
    }

    try {
      const reminder = await liveReminder.get(videoId)
      if (
        generation !== liveReminderLoadGeneration ||
        videoId !== id.value ||
        startTimestamp !== premiereTimestamp.value
      ) {
        return
      }

      if (reminder && reminder.startTimestamp !== startTimestamp) {
        liveReminderActive.value = await liveReminder.schedule(getLiveReminderPayload())
      } else {
        liveReminderActive.value = reminder !== null
      }
    } catch (error) {
      console.error('Failed to load live stream reminder', error)
    }
  }

  async function toggleLiveReminder() {
    if (liveReminderLoading.value || !canToggleLiveReminder.value) return

    const videoId = id.value
    liveReminderLoading.value = true
    try {
      if (liveReminderActive.value) {
        await liveReminder.cancel(videoId)
        if (videoId !== id.value) return
        liveReminderActive.value = false
        showToast({
          message: t('Video.Notification cancelled'),
          image: toastThumbnail.value,
          icon: ['fas', 'calendar-days']
        })
      } else {
        const scheduled = await liveReminder.schedule(getLiveReminderPayload())
        if (videoId !== id.value) return
        liveReminderActive.value = scheduled
        showToast({
          message: scheduled
            ? t('Video.Notification enabled')
            : t('Video.Notification unavailable'),
          image: toastThumbnail.value,
          icon: ['fas', 'calendar-days']
        })
      }
    } catch (error) {
      console.error('Failed to update live stream reminder', error)
      if (videoId === id.value) {
        showToast({
          message: t('Video.Notification unavailable'),
          image: toastThumbnail.value,
          icon: ['fas', 'calendar-days']
        })
      }
    } finally {
      if (videoId === id.value) {
        liveReminderLoading.value = false
      }
    }
  }

  watch(premiereTimestamp, schedulePremiereStartInvalidation, { immediate: true })
  watch([id, premiereTimestamp], syncLiveReminder, { immediate: true })

  onMounted(() => {
    removeLiveReminderUpdatedListener = liveReminder.onUpdated((videoId, scheduled) => {
      if (videoId === id.value) {
        liveReminderActive.value = scheduled
      }
    })
  })

  onBeforeUnmount(() => {
    clearPremiereStartTimer()
    removeLiveReminderUpdatedListener?.()
  })

  return {
    premiereNow,
    canToggleLiveReminder,
    liveReminderActive,
    liveReminderLoading,
    toggleLiveReminder
  }
}
