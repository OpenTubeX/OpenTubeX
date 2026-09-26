import { isHistoryEntryWatched } from '../../helpers/history'
import {
  buildWatchHistoryEntry,
  planWatchProgressSave,
  planShortCompletion,
  planWatchedCompletion,
  persistWatchTime,
  sampleWatchTime,
  shouldKeepHistoryEntryAlive,
} from './watchHistoryPersistence'

export const watchHistoryMethods = {
  addToHistory: function (watchProgress, isWatched = isHistoryEntryWatched(this.historyEntry)) {
    const now = Date.now()
    this.historyLastTouchedAt = now
    this.updateHistory(buildWatchHistoryEntry({
      historyEntry: this.historyEntry,
      localFilePlayback: this.localFilePlayback,
      videoId: this.videoId,
      videoTitle: this.videoTitle,
      channelName: this.channelName,
      channelId: this.channelId,
      videoPublished: this.videoPublished,
      videoDescription: this.videoDescription,
      videoViewCount: this.videoViewCount,
      videoLengthSeconds: this.videoLengthSeconds,
      isLive: this.isLive,
      isUpcoming: this.isUpcoming,
    }, watchProgress, isWatched, now))
  },

  keepHistoryEntryAlive(currentSeconds) {
    const now = Date.now()
    if (!shouldKeepHistoryEntryAlive({
      rememberHistory: this.rememberHistory,
      historyRetentionEnabled: this.historyRetentionEnabled,
      videoPlayerLoaded: this.videoPlayerLoaded,
      isUpcoming: this.isUpcoming,
      isLive: this.isLive,
      playerPaused: this.$refs.player?.isPaused(),
      historyLastTouchedAt: this.historyLastTouchedAt,
    }, now)) return

    const watchProgress = this.watchedProgressSavingEnabled
      ? currentSeconds
      : (this.historyEntry?.watchProgress ?? 0)

    this.addToHistory(watchProgress)
  },

  markAsWatchedIfFinished(currentSeconds, isFinished = false) {
    const watchProgress = planWatchedCompletion({
      rememberHistory: this.rememberHistory,
      isUpcoming: this.isUpcoming,
      isLive: this.isLive,
      historyEntry: this.historyEntry,
      playerPaused: this.$refs.player?.isPaused(),
      videoLengthSeconds: this.videoLengthSeconds,
      watchedPercentageThreshold: this.watchedPercentageThreshold,
      watchedProgressSavingEnabled: this.watchedProgressSavingEnabled,
    }, currentSeconds, isFinished)
    if (watchProgress !== null) this.addToHistory(watchProgress, true)
  },

  markShortAsWatchedIfCompleted(reachedEnd) {
    const watchProgress = planShortCompletion({
      rememberHistory: this.rememberHistory,
      customShortsPlayerActive: this.customShortsPlayerActive,
      shortsPlaybackCompleted: this.shortsPlaybackCompleted,
      isUpcoming: this.isUpcoming,
      isLive: this.isLive,
      videoLengthSeconds: this.videoLengthSeconds,
      playerLoaded: this.$refs.player?.hasLoaded,
      playerPaused: this.$refs.player?.isPaused(),
      reachedEnd,
      watchedProgressSavingEnabled: this.watchedProgressSavingEnabled,
      historyEntry: this.historyEntry,
    })
    if (watchProgress === null) return
    this.shortsPlaybackCompleted = true
    this.addToHistory(watchProgress, true)
  },

  _saveWatchProgress() {
    if (!this.canSaveWatchProgress) return
    // A background tab's brief autoplay attempt must not create a resume point.
    const presented = this.isCurrentlyPresented()
    if (!presented || !this.hasBeenPresented || this.playerTeardownInProgress) return
    const player = this.$refs.player
    const plan = planWatchProgressSave({
      canSaveWatchProgress: this.canSaveWatchProgress,
      presented,
      hasBeenPresented: this.hasBeenPresented,
      playerTeardownInProgress: this.playerTeardownInProgress,
      hasPlaybackPosition: player?.hasPlaybackPosition,
      shortsPlaybackCompleted: this.shortsPlaybackCompleted,
      watchedProgressSavingEnabled: this.watchedProgressSavingEnabled,
      videoLengthSeconds: this.videoLengthSeconds,
      currentTime: () => player.getCurrentTime(),
      historyEntryExists: this.historyEntryExists,
      videoId: this.videoId,
    })
    if (plan?.type === 'history') this.addToHistory(plan.watchProgress)
    if (plan?.type === 'progress') this.updateWatchProgress({ videoId: plan.videoId, watchProgress: plan.watchProgress })
  },

  clearPendingWatchTime() {
    this.watchTimeLastTick = null
    this.pendingWatchTimeByDate = {}
  },

  trackWatchTime() {
    if (!this.rememberHistory || !this.enableWatchStats || this.$refs.player?.isPaused()) {
      this.watchTimeLastTick = null
      return
    }

    const now = Date.now()
    const watchedAt = new Date(now)
    const date = [
      watchedAt.getFullYear(),
      String(watchedAt.getMonth() + 1).padStart(2, '0'),
      String(watchedAt.getDate()).padStart(2, '0'),
    ].join('-')
    const next = sampleWatchTime({
      lastTick: this.watchTimeLastTick,
      pendingByDate: this.pendingWatchTimeByDate,
    }, now, date)
    this.watchTimeLastTick = next.lastTick
    this.pendingWatchTimeByDate = next.pendingByDate
    if (next.shouldFlush) this.flushWatchTime()
  },

  async flushWatchTime() {
    const learning = this.flushRecommendationWatch()
    this.watchTimeLastTick = null
    const pending = this.pendingWatchTimeByDate
    this.pendingWatchTimeByDate = {}
    await Promise.all([
      learning,
      persistWatchTime(pending, record => this.$store.dispatch('recordWatchTime', record)),
    ])
  },
}
