import { restoreOverlayScrollTop } from '../../../helpers/overlayScrollbars'

/**
 * OpenTubeX watch-page panels: the fullscreen panels the player hosts, the
 * sidebar transcript, chapters and SponsorBlock panels, and the phone layout's
 * bottom sheets. Spread into the Watch view's `methods`.
 */
export const watchPanelMethods = {
  openPhonePanel(panel) {
    this.mobilePanel = panel
    if (panel === 'chapters') this.showSidebarChapters = true
    if (panel === 'transcript') this.showTranscript = true
    if (panel === 'chat') this.liveChatOpen = true
  },
  handleFullscreenMetadataChange({ open, target, presentationActive = false }) {
    const wasOpen = this.fullscreenMetadataOpen
    this.fullscreenMetadataTarget = target
    this.fullscreenMetadataOpen = open && target !== null

    if (this.customShortsPlayerActive && presentationActive) {
      this.shortsMetadataOpen = this.fullscreenMetadataOpen
      this.clampShortsAuxPanelScroll()
    }

    if (this.fullscreenMetadataOpen) {
      this.$nextTick(() => {
        if (!wasOpen) restoreOverlayScrollTop(target, 0)
        // Portrait fullscreen presents one bottom sheet at a time.
        if (this.portraitLayout) return
        if (this.showTranscript && !this.fullscreenTranscriptOpen) {
          this.$refs.player?.setFullscreenTranscript(true)
        }
        if (this.showSidebarSponsorBlock && !this.fullscreenSponsorBlockOpen) {
          this.$refs.player?.setFullscreenSponsorBlock(true)
        }
      })
    }
  },
  toggleFullscreenMetadata() {
    this.$refs.player?.setFullscreenMetadata(!this.fullscreenMetadataOpen)
  },
  handleFullscreenTranscriptChange({ open, target }) {
    this.fullscreenTranscriptTarget = target
    this.fullscreenTranscriptOpen = open && target !== null
  },
  handleFullscreenSponsorBlockChange({ open, target }) {
    this.fullscreenSponsorBlockTarget = target
    this.fullscreenSponsorBlockOpen = open && target !== null
  },
  handleFullscreenCommentsChange({ open, target }) {
    this.fullscreenCommentsTarget = open ? target : null
    this.fullscreenCommentsOpen = open && target !== null
  },
  handleFullscreenLiveChatChange({ open, target }) {
    this.fullscreenLiveChatTarget = open ? target : null
    this.fullscreenLiveChatOpen = open && target !== null
    if (this.fullscreenLiveChatOpen) {
      this.liveChatOpen = true
    }
  },
  closeFullscreenLiveChat() {
    this.$refs.player?.closeFullscreenLiveChat()
  },
  closeLiveChat() {
    this.mobilePanel = null
    this.liveChatOpen = false
    this.closeFullscreenLiveChat()
  },
  toggleLiveChat() {
    if (this.phonePanelsEnabled) {
      this.openPhonePanel('chat')
      return
    }
    if (this.liveChatOpen) {
      this.closeLiveChat()
    } else {
      this.liveChatOpen = true
    }
  },
  closeFullscreenComments() {
    this.mobilePanel = null
    if (this.fullscreenCommentsOpen) {
      this.$refs.player?.closeFullscreenComments()
      return
    }
    this.shortsCommentsOpen = false
  },
  handleFullscreenQueueChange({ open, target }) {
    const queue = this.$refs.watchVideoQueue
    const sourceLayout = this.fullscreenQueueOpen ? 'fullscreen' : 'sidebar'
    const destinationLayout = open && target !== null ? 'fullscreen' : 'sidebar'
    this.queueScrollPositions[sourceLayout] = queue?.getScrollTop() ?? 0
    this.fullscreenQueueTarget = target
    this.fullscreenQueueOpen = open && target !== null
    this.$nextTick(() => queue?.restoreScrollTop(this.queueScrollPositions[destinationLayout]))
  },
  closeFullscreenQueue() {
    this.$refs.player?.closeFullscreenQueue()
  },
  handleFullscreenRecommendationsChange({ open, target }) {
    const recommendations = this.$refs.watchVideoRecommendations
    if (this.fullscreenRecommendationsOpen) this.recommendationsScrollTop = recommendations?.getScrollTop() ?? 0
    this.fullscreenRecommendationsTarget = target
    this.fullscreenRecommendationsOpen = open && target !== null
    if (this.fullscreenRecommendationsOpen) {
      this.$nextTick(() => recommendations?.restoreScrollTop(this.recommendationsScrollTop))
    }
  },
  closeFullscreenRecommendations() {
    this.$refs.player?.closeFullscreenRecommendations()
  },
  handleFullscreenPlaylistChange({ open, target }) {
    const playlist = this.$refs.watchVideoPlaylist
    const sourceLayout = this.fullscreenPlaylistOpen ? 'fullscreen' : 'sidebar'
    const destinationLayout = open && target !== null ? 'fullscreen' : 'sidebar'

    this.playlistScrollPositions[sourceLayout] = playlist?.getScrollTop() ?? 0
    this.fullscreenPlaylistTarget = target
    this.fullscreenPlaylistOpen = open && target !== null
    this.$nextTick(() => {
      const scrollTop = this.playlistScrollPositions[destinationLayout]
      if (scrollTop == null) {
        playlist?.centerCurrentVideo()
      } else {
        playlist?.restoreScrollTop(scrollTop)
      }
    })
  },
  handleChaptersOverlayChange(open) {
    if (this.phonePanelsEnabled) {
      this.mobilePanel = open ? 'chapters' : (this.mobilePanel === 'chapters' ? null : this.mobilePanel)
    }
    if (!open && this.showSidebarChapters) {
      this.sidebarPanelLeaving = true
    }
    this.showSidebarChapters = open
  },
  handleChapterThumbnailsChange(thumbnails) {
    this.videoChapterThumbnails = thumbnails
  },
  handleSponsorBlockInfoChange({
    open,
    loading,
    pendingUuid,
    segments,
    submissionEnabled,
    contributionStats,
    contributionStatsError,
    contributionStatsLoaded,
    contributionStatsLoading,
  }) {
    if (!open && this.showSidebarSponsorBlock) {
      this.sidebarPanelLeaving = true
    }
    if (!open && this.mobilePanel === 'sponsorBlock') this.mobilePanel = null
    this.showSidebarSponsorBlock = open
    this.sponsorBlockInfoLoading = loading
    this.sponsorBlockInfoPendingUuid = pendingUuid
    this.sponsorBlockInfoSegments = segments
    this.sponsorBlockInfoSubmissionEnabled = submissionEnabled
    this.sponsorBlockContributionStats = contributionStats
    this.sponsorBlockContributionStatsError = contributionStatsError
    this.sponsorBlockContributionStatsLoaded = contributionStatsLoaded
    this.sponsorBlockContributionStatsLoading = contributionStatsLoading

    if (!open && this.customShortsPlayerActive) {
      this.clampShortsAuxPanelScroll()
    }

    if (open && this.fullscreenMetadataOpen && !this.fullscreenSponsorBlockOpen) {
      this.$nextTick(() => this.$refs.player?.setFullscreenSponsorBlock(true))
    } else if (!open && this.fullscreenSponsorBlockOpen) {
      this.$refs.player?.closeFullscreenSponsorBlock()
    }
  },
  closeSidebarSponsorBlock() {
    if (this.mobilePanel === 'sponsorBlock') this.mobilePanel = null
    this.$refs.player?.closeSponsorBlockInfo()
  },
  toggleSponsorBlockInfo() {
    if (this.shortsPhonePanelsEnabled) {
      if (this.mobilePanel === 'sponsorBlock') this.closeShortsPhonePanel()
      else this.openShortsPhonePanel('sponsorBlock')
      return
    }
    if (this.customShortsPlayerActive && !this.showSidebarSponsorBlock) {
      this.resetShortsAuxPanelScroll()
      this.shortsMetadataOpen = false
      if (this.showTranscript) {
        this.closeTranscript()
      }
      this.closeShortsComments()
    }
    this.$refs.player?.toggleSponsorBlockInfo()
  },
  toggleTranscript() {
    if (this.shortsPhonePanelsEnabled) {
      if (this.mobilePanel === 'transcript') this.closeShortsPhonePanel()
      else this.openShortsPhonePanel('transcript')
      return
    }
    if (this.phonePanelsEnabled) {
      this.openPhonePanel('transcript')
      return
    }
    if (!this.transcriptAvailable) {
      return
    }

    if (this.customShortsPlayerActive && !this.showTranscript) {
      this.resetShortsAuxPanelScroll()
      this.shortsMetadataOpen = false
      if (this.showSidebarSponsorBlock) {
        this.closeSidebarSponsorBlock()
      }
      this.closeShortsComments()
    }
    if (this.showTranscript) {
      this.sidebarPanelLeaving = true
    }
    this.showTranscript = !this.showTranscript
    if (this.showTranscript && this.fullscreenMetadataOpen) {
      this.$nextTick(() => this.$refs.player?.setFullscreenTranscript(true))
    } else if (!this.showTranscript) {
      this.$refs.player?.dismissFullscreenTranscript()
      this.clampShortsAuxPanelScroll()
    }
  },
  closeTranscript() {
    this.mobilePanel = null
    if (this.showTranscript) {
      this.sidebarPanelLeaving = true
    }
    this.showTranscript = false
    this.$refs.player?.dismissFullscreenTranscript()
    this.clampShortsAuxPanelScroll()
  },
  handleSidebarPanelBeforeLeave() {
    this.sidebarPanelLeaving = true
  },
  handleSidebarPanelAfterLeave() {
    this.sidebarPanelLeaving = false
  },
  closeFullscreenPlaylist() {
    if (this.mobilePanel === 'playlist') this.mobilePanel = null
    this.$refs.player?.closeFullscreenPlaylist()
  },
  refreshSponsorBlockInfo() {
    this.$refs.player?.refreshSponsorBlockInfo()
  },
  voteOnSponsorBlockInfoSegment(uuid, vote) {
    this.$refs.player?.voteOnSponsorBlockInfoSegment(uuid, vote)
  },
  changeSponsorBlockInfoSegmentCategory(uuid, category) {
    this.$refs.player?.changeSponsorBlockInfoSegmentCategory(uuid, category)
  },
  copyAndDownvoteSponsorBlockInfoSegment(uuid) {
    this.$refs.player?.copyAndDownvoteSponsorBlockInfoSegment(uuid)
  },
  skipSponsorBlockInfoSegment(uuid) {
    this.$refs.player?.skipSponsorBlockInfoSegment(uuid)
  },
  closeSidebarChapters() {
    this.mobilePanel = null
    if (this.showSidebarChapters) {
      this.sidebarPanelLeaving = true
    }
    this.showSidebarChapters = false
  },
  copyChapterTimestamp(startSeconds) {
    this.$refs.player?.copyChapterTimestamp(startSeconds)
  },
}
