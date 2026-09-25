import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../helpers/history'

export const watchHistoryMethods = {
  addToHistory: function (watchProgress, isWatched = isHistoryEntryWatched(this.historyEntry)) {
    const now = Date.now()
    // Local playback can start before channel metadata is available.
    const metadata = this.localFilePlayback && !this.channelId && this.historyEntry
      ? this.historyEntry
      : {
          title: this.videoTitle,
          author: this.channelName,
          authorId: this.channelId,
          published: this.videoPublished > 0 ? this.videoPublished : this.historyEntry?.published,
          description: this.videoDescription,
          viewCount: this.videoViewCount,
        }
    const videoData = {
      ...this.historyEntry,
      ...metadata,
      videoId: this.videoId,
      lengthSeconds: this.videoLengthSeconds,
      watchProgress: watchProgress,
      isWatched,
      timeWatched: now,
      isLive: this.isLive,
      isUpcoming: this.isUpcoming,
      type: 'video',
    }

    this.historyLastTouchedAt = now
    this.updateHistory(videoData)
  },

  keepHistoryEntryAlive(currentSeconds) {
    const now = Date.now()
    if (
      !this.rememberHistory ||
        !this.historyRetentionEnabled ||
        !this.videoPlayerLoaded ||
        this.isUpcoming ||
        this.isLive ||
        this.$refs.player?.isPaused() ||
        now - this.historyLastTouchedAt < 60_000
    ) {
      return
    }

    const watchProgress = this.watchedProgressSavingEnabled
      ? currentSeconds
      : (this.historyEntry?.watchProgress ?? 0)

    this.addToHistory(watchProgress)
  },

  markAsWatchedIfFinished(currentSeconds, isFinished = false) {
    if (
      !this.rememberHistory ||
        this.isUpcoming ||
        this.isLive ||
        isHistoryEntryWatched(this.historyEntry)
    ) {
      return
    }

    if (!isFinished && this.$refs.player?.isPaused()) {
      return
    }

    if (isFinished || hasReachedWatchedThreshold(
      currentSeconds,
      this.videoLengthSeconds,
      this.watchedPercentageThreshold
    )) {
      const watchProgress = this.watchedProgressSavingEnabled
        ? currentSeconds
        : (this.historyEntry?.watchProgress ?? 0)

      this.addToHistory(watchProgress, true)
    }
  },

  _saveWatchProgress() {
    if (!this.canSaveWatchProgress) { return }
    // A background tab force-pauses its brief autoplay attempt, which would
    // otherwise save a spurious ~1 second resume point. Only persist progress
    // for tabs the user has actually presented.
    if (!this.isCurrentlyPresented() || !this.hasBeenPresented) { return }
    if (this.playerTeardownInProgress) { return }
    const player = this.$refs.player
    // A seek establishes a position before its media segment finishes loading.
    // Save that position, but never the initial zero before playback or a seek.
    if (!player?.hasPlaybackPosition) { return }

    const currentTime = this.shortsPlaybackCompleted && this.watchedProgressSavingEnabled
      ? this.videoLengthSeconds
      : player.getCurrentTime()
    if (!this.historyEntryExists) {
      this.addToHistory(currentTime)
      return
    }
    const payload = {
      videoId: this.videoId,
      watchProgress: currentTime
    }
    this.updateWatchProgress(payload)
  },
}
