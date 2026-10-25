import { formatDateTime } from '../../../helpers/dateFormat'
import { liveReminder } from '../../../helpers/liveReminders'

const MAX_TIMEOUT_DELAY = 2_147_483_647

/**
 * OpenTubeX countdown for scheduled premieres and live streams.
 * Spread into the Watch view's `computed`.
 */
export const watchLiveReminderComputed = {
  hasScheduledPremiereStarted: function () {
    return this.premiereDate instanceof Date &&
      this.premiereDate.getTime() <= this.liveReminderNow
  },
  displayedUpcomingTimeLeft: function () {
    if (!(this.premiereDate instanceof Date)) return this.upcomingTimeLeft

    let timeLeft = (this.premiereDate.getTime() - this.relativeTimeNow) / 60000
    let timeUnit = 'minute'

    if (timeLeft > 120) {
      timeLeft /= 60
      timeUnit = 'hour'
    }

    if (timeUnit === 'hour' && timeLeft > 24) {
      timeLeft /= 24
      timeUnit = 'day'
    }

    timeLeft = Math.floor(timeLeft)
    if (timeLeft < 1) {
      return this.t('Video.Published.In less than a minute').toLowerCase()
    }

    return new Intl.RelativeTimeFormat(this.currentLocale).format(timeLeft, timeUnit)
  },
  canToggleLiveReminder: function () {
    return this.supportsLiveReminders &&
      this.premiereDate instanceof Date &&
      this.premiereDate.getTime() > this.liveReminderNow
  },
}

/**
 * OpenTubeX start time and notification reminder for scheduled premieres and
 * live streams. Spread into the Watch view's `methods`.
 */
export const watchLiveReminderMethods = {
  updateUpcomingTimestamp: function () {
    if (!(this.premiereDate instanceof Date)) return

    const dateOptions = {
      month: 'long',
      day: 'numeric',
    }
    if (new Date().getFullYear() < this.premiereDate.getFullYear()) {
      dateOptions.year = 'numeric'
    }

    this.upcomingTimestamp = formatDateTime(
      this.premiereDate,
      this.currentLocale,
      this.dateFormatPreference,
      dateOptions,
      { hour: 'numeric', minute: '2-digit' },
      this.timeFormatPreference
    )
  },

  clearLiveReminderStartTimer() {
    if (this.liveReminderStartTimer !== null) {
      clearTimeout(this.liveReminderStartTimer)
      this.liveReminderStartTimer = null
    }
  },
  scheduleLiveReminderStartInvalidation() {
    this.clearLiveReminderStartTimer()
    const now = Date.now()
    this.liveReminderNow = now
    if (!(this.premiereDate instanceof Date)) return

    const delay = this.premiereDate.getTime() - now
    if (delay <= 0) return

    this.liveReminderStartTimer = setTimeout(() => {
      this.liveReminderStartTimer = null
      this.scheduleLiveReminderStartInvalidation()
    }, Math.min(delay + 1, MAX_TIMEOUT_DELAY))
  },
  getLiveReminderPayload() {
    return {
      videoId: this.videoId,
      startTimestamp: this.premiereDate.getTime(),
      notificationTitle: this.t('Video.Scheduled video starting'),
      notificationBody: this.t('Video.Live notification body', { videoTitle: this.videoTitle })
    }
  },
  async syncLiveReminder(loadGeneration, videoId) {
    if (!this.canToggleLiveReminder) return

    const startTimestamp = this.premiereDate.getTime()
    const reminder = await liveReminder.get(videoId)
    if (
      !this.isCurrentVideoLoad(loadGeneration, videoId) ||
      !(this.premiereDate instanceof Date) ||
      this.premiereDate.getTime() !== startTimestamp
    ) {
      return
    }

    if (reminder && reminder.startTimestamp !== startTimestamp) {
      const scheduled = await liveReminder.schedule(this.getLiveReminderPayload())
      if (
        !this.isCurrentVideoLoad(loadGeneration, videoId) ||
        !(this.premiereDate instanceof Date) ||
        this.premiereDate.getTime() !== startTimestamp
      ) {
        return
      }
      this.liveReminderActive = scheduled
    } else {
      this.liveReminderActive = reminder !== null
    }
  },
  async toggleLiveReminder() {
    if (this.liveReminderLoading || !this.canToggleLiveReminder) return

    const videoId = this.videoId
    this.liveReminderLoading = true
    try {
      if (this.liveReminderActive) {
        await liveReminder.cancel(videoId)
        if (videoId !== this.videoId) return
        this.liveReminderActive = false
        this.showTabToast({
          message: this.t('Video.Notification cancelled'),
          icon: ['fas', 'calendar-days']
        })
      } else {
        const scheduled = await liveReminder.schedule(this.getLiveReminderPayload())
        if (videoId !== this.videoId) return
        this.liveReminderActive = scheduled
        this.showTabToast({
          message: scheduled
            ? this.t('Video.Notification enabled')
            : this.t('Video.Notification unavailable'),
          icon: ['fas', 'calendar-days']
        })
      }
    } catch (error) {
      console.error('Failed to update live stream reminder', error)
      if (videoId === this.videoId) {
        this.showTabToast({
          message: this.t('Video.Notification unavailable'),
          icon: ['fas', 'calendar-days']
        })
      }
    } finally {
      if (videoId === this.videoId) {
        this.liveReminderLoading = false
      }
    }
  },
}
