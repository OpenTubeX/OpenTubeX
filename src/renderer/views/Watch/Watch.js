import { defineComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { mapActions } from 'vuex'
import shaka from 'shaka-player'
import { Utils, YTNodes } from 'youtubei.js'
import FtShakaVideoPlayer from '../../components/ft-shaka-video-player/ft-shaka-video-player.vue'
import WatchVideoInfo from '../../components/WatchVideoInfo/WatchVideoInfo.vue'
import WatchVideoDescription from '../../components/WatchVideoDescription/WatchVideoDescription.vue'
import WatchVideoTranscript from '../../components/WatchVideoTranscript/WatchVideoTranscript.vue'
import WatchVideoChapters from '../../components/WatchVideoChapters/WatchVideoChapters.vue'
import WatchVideoSponsorBlock from '../../components/WatchVideoSponsorBlock/WatchVideoSponsorBlock.vue'
import CommentSection from '../../components/CommentSection/CommentSection.vue'
import WatchVideoLiveChat from '../../components/WatchVideoLiveChat/WatchVideoLiveChat.vue'
import WatchVideoPlaylist from '../../components/WatchVideoPlaylist/WatchVideoPlaylist.vue'
import WatchVideoRecommendations from '../../components/WatchVideoRecommendations/WatchVideoRecommendations.vue'
import FtAgeRestricted from '../../components/FtAgeRestricted/FtAgeRestricted.vue'
import { calculateColorLuminance } from '../../helpers/colors'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../helpers/history'
import {
  buildChaptersVttFile,
  buildVTTFileLocally,
  copyToClipboard,
  extractNumberFromString,
  formatDurationAsTimestamp,
  formatNumber,
  getCachedOembedTitle,
  getOembedTitle,
  showToast,
  showToastOnAllTabs
} from '../../helpers/utils'
import {
  getLocalVideoInfo,
  mapLocalLegacyFormat,
  parseLocalSubscriberCount,
  parseLocalEndscreen,
  parseLocalVideoCollaborators,
  parseLocalTextRuns,
  parseLocalWatchNextVideo
} from '../../helpers/api/local'
import {
  convertInvidiousToLocalFormat,
  generateInvidiousDashManifestLocally,
  getProxyUrl,
  invidiousGetVideoInformation,
  mapInvidiousLegacyFormat,
  youtubeImageUrlToInvidious
} from '../../helpers/api/invidious'
import { sponsorBlockSkipSegments } from '../../helpers/sponsorblock'
import { getVideoDislikes } from '../../helpers/returnyoutubedislike'
import { findCaptionByLocale, getPreferredCaption, sortCaptions } from '../../helpers/player/utils'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { useI18n } from 'vue-i18n'
import { useTabContext, useTabTitle } from '../../tabs/TabContext'
import { useTabToast } from '../../composables/useTabToast'

/**
 * @typedef {{
 *   scheme: string,
 *   url: string,
 *   poToken: string,
 *   ustreamerConfig: string,
 *   clientInfo: {
 *     clientName: number,
 *     clientVersion: string,
 *     osName: string,
 *     osVersion: string
 *   },
 *   reload: (reloadPlaybackContext: import('googlevideo/protos').ReloadPlaybackContext) => Promise<{url: string, ustreamerConfig: string}>
 * }} SabrData
 */

const MANIFEST_TYPE_DASH = 'application/dash+xml'
const MANIFEST_TYPE_HLS = 'application/x-mpegurl'
const THEATRE_MODE_ANIMATION_DURATION = 400
let nextSabrSchemeId = 0
const UNAVAILABLE_VIDEO_THUMBNAILS = {
  light: 'https://www.youtube.com/img/desktop/unavailable/unavailable_video.png',
  dark: 'https://www.youtube.com/img/desktop/unavailable/unavailable_video_dark_theme.png'
}

export default defineComponent({
  name: 'Watch',
  components: {
    'ft-shaka-video-player': FtShakaVideoPlayer,
    'watch-video-info': WatchVideoInfo,
    'watch-video-description': WatchVideoDescription,
    'watch-video-transcript': WatchVideoTranscript,
    'watch-video-chapters': WatchVideoChapters,
    'watch-video-sponsor-block': WatchVideoSponsorBlock,
    CommentSection,
    'watch-video-live-chat': WatchVideoLiveChat,
    'watch-video-playlist': WatchVideoPlaylist,
    'watch-video-recommendations': WatchVideoRecommendations,
    'ft-age-restricted': FtAgeRestricted
  },
  setup: function () {
    const { t, locale } = useI18n()
    const tabRoute = useRoute()
    const tabRouter = useRouter()
    const { tabId, isTabPresented, lifecycle: tabLifecycle } = useTabContext()
    const setTabTitle = useTabTitle()
    const showTabToast = useTabToast()

    return {
      t,
      currentLocale: locale,
      tabId,
      isTabPresented,
      tabLifecycle,
      tabRoute,
      tabRouter,
      setTabTitle,
      showTabToast
    }
  },
  data: function () {
    return {
      startNextVideoInFullscreen: false,
      startNextVideoInFullwindow: false,
      startNextVideoInPip: false,
      startNextVideoWithChapters: false,
      startNextVideoWithFullscreenComments: false,
      startNextVideoWithFullscreenPlaylist: false,
      isLoading: true,
      firstLoad: true,
      useTheatreMode: false,
      videoPlayerLoaded: false,
      isFamilyFriendly: false,
      isLive: false,
      liveChat: null,
      isLiveContent: false,
      isUpcoming: false,
      isPostLiveDvr: false,
      isUnlisted: false,
      hasAiGeneratedContent: false,
      upcomingTimestamp: null,
      upcomingTimeLeft: null,
      /** @type {'dash' | 'audio' | 'legacy'} */
      activeFormat: 'legacy',
      thumbnail: '',
      videoId: '',
      videoTitle: '',
      videoDescription: '',
      videoDescriptionHtml: '',
      videoCategory: '',
      license: '',
      videoViewCount: 0,
      videoLikeCount: 0,
      videoDislikeCount: 0,
      videoLengthSeconds: 0,
      videoChapters: [],
      videoCurrentChapterIndex: 0,
      /** @type {'chapters' | 'keyMoments'} */
      videoChaptersKind: 'chapters',
      channelName: '',
      channelThumbnail: '',
      channelId: '',
      channelCollaborators: [],
      channelSubscriptionCountText: '',
      videoPublished: 0,
      premiereDate: undefined,
      videoStoryboardSrc: '',
      videoAnnotations: [],
      /** @type {string|null} */
      manifestSrc: null,
      /** @type {(MANIFEST_TYPE_DASH|MANIFEST_TYPE_HLS|MANIFEST_TYPE_SABR)} */
      manifestMimeType: MANIFEST_TYPE_DASH,
      /** @type {SabrData | null} */
      sabrData: null,
      legacyFormats: [],
      captions: [],
      currentTime: 0,
      showTranscript: false,
      showSidebarChapters: false,
      showSidebarSponsorBlock: false,
      sponsorBlockInfoLoading: false,
      sponsorBlockInfoPendingUuid: null,
      sponsorBlockInfoSegments: [],
      sponsorBlockInfoSubmissionEnabled: false,
      videoChapterThumbnails: [],
      fullscreenCommentsOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenCommentsTarget: null,
      fullscreenPlaylistOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenPlaylistTarget: null,
      playlistScrollPositions: {
        sidebar: null,
        fullscreen: null,
      },
      /** @type {'EQUIRECTANGULAR' | 'EQUIRECTANGULAR_THREED_TOP_BOTTOM' | 'MESH'| null} */
      vrProjection: null,
      autoplayNextRecommendedVideo: false,
      autoplayNextPlaylistVideo: false,
      recommendedVideos: [],
      watchingPlaylist: false,
      playlistId: '',
      playlistType: '',
      playlistItemId: null,
      /** @type {number|null} */
      timestamp: null,
      // This should never be saved into history
      /** @type {number|null} */
      oneTimeTimestamp: null,
      playNextTimeout: null,
      playNextCountDownIntervalId: null,
      autoplayCountdown: null,
      blockVideoAutoplay: false,
      autoplayInterruptionTimeout: null,
      playabilityStatus: '',
      totalAdTimeSeconds: 0,
      adEndTimeUnixMs: 0,

      onMountedRun: false,

      // error handling/messages
      /** @type {string|null} */
      errorMessage: null,
      /** @type {string[]|null} */
      customErrorIcon: null,
      videoGenreIsMusic: false,
      /** @type {Date|null} */
      streamingDataExpiryDate: null,
      currentPlaybackRate: null,
      currentVideoQuality: null,

      // Local, non-persistent toggle for temporarily disabling SponsorBlock auto-skipping
      sponsorBlockAutoSkipTemporarilyDisabled: false,

      // When true, the new player after a SABR reload should start playback (was playing before reload)
      resumePlaybackAfterSabrReload: false,
      /** @type {number|null} */
      sabrReloadCaptionIndex: null,
      /** @type {number|null} */
      sabrReloadPlaybackRate: null,
      preserveTitleOnNextReload: false,
      ipBlockDetectedInCurrentChain: false,
      ipBlockRecoveryAttemptedForCurrentVideo: false,
      sabrErrorRecoveryAttemptedForCurrentVideo: false,
      /** @type {number|null} */
      watchTimeLastTick: null,
      /** @type {Record<string, number>} */
      pendingWatchTimeByDate: {},
      historyLastTouchedAt: 0,
    }
  },
  computed: {
    historyEntry: function () {
      return this.$store.getters.getHistoryCacheById[this.videoId]
    },
    historyEntryExists: function () {
      return typeof this.historyEntry !== 'undefined'
    },
    rememberHistory: function () {
      return this.$store.getters.getRememberHistory
    },
    historyRetentionEnabled: function () {
      const days = Number(this.$store.getters.getHistoryRetentionDays)
      return Number.isInteger(days) && days > 0
    },
    enableWatchStats: function () {
      return this.$store.getters.getEnableWatchStats
    },
    watchStatsResetVersion: function () {
      return this.$store.getters.getWatchStatsResetVersion
    },
    watchedProgressSavingEnabled: function () {
      return this.$store.getters.getWatchedProgressSavingMode !== 'never'
    },
    autosaveWatchedProgress: function () {
      return this.$store.getters.getWatchedProgressSavingMode === 'auto'
    },
    saveVideoHistoryWithLastViewedPlaylist: function () {
      return this.$store.getters.getSaveVideoHistoryWithLastViewedPlaylist
    },
    backendPreference: function () {
      return this.$store.getters.getBackendPreference
    },
    backendFallback: function () {
      return this.$store.getters.getBackendFallback
    },
    videoIpBlockScriptPath: function () {
      return this.$store.getters.getVideoIpBlockScriptPath
    },
    currentInvidiousInstanceUrl: function () {
      return this.$store.getters.getCurrentInvidiousInstanceUrl
    },
    proxyVideos: function () {
      return this.$store.getters.getProxyVideos
    },
    defaultAutoplayInterruptionIntervalHours: function () {
      return this.$store.getters.getDefaultAutoplayInterruptionIntervalHours
    },
    defaultInterval: function () {
      return this.$store.getters.getDefaultInterval
    },
    defaultViewingMode: function () {
      return this.$store.getters.getDefaultViewingMode
    },
    preferredCaptionLocale: function () {
      return this.$store.getters.getPreferredCaptionLocale || this.currentLocale
    },
    preferredTranscriptCaptionIndex: function () {
      const caption = getPreferredCaption(
        this.captions,
        this.preferredCaptionLocale,
        this.$store.getters.getEnableCaptionTranslations
      )

      return caption ? this.captions.indexOf(caption) : 0
    },
    ambientModeActive: function () {
      return this.$store.getters.getAmbientMode &&
        this.activeFormat !== 'audio' &&
        this.vrProjection !== 'EQUIRECTANGULAR'
    },
    defaultVideoFormat: function () {
      return this.$store.getters.getDefaultVideoFormat
    },
    autoplayEnabled: function () {
      return this.watchingPlaylist ? this.autoplayNextPlaylistVideo : this.autoplayNextRecommendedVideo
    },
    thumbnailPreference: function () {
      return this.$store.getters.getThumbnailPreference
    },
    autoplayNextRecommendedVideoByDefault: function () {
      return this.$store.getters.getPlayNextVideo
    },
    autoplayNextPlaylistVideoByDefault: function () {
      return this.$store.getters.getAutoplayPlaylists
    },
    hideRecommendedVideos: function () {
      return this.$store.getters.getHideRecommendedVideos
    },
    hideLiveChat: function () {
      return this.$store.getters.getHideLiveChat
    },
    hideComments: function () {
      return this.$store.getters.getHideComments
    },
    hideVideoDescription: function () {
      return this.$store.getters.getHideVideoDescription
    },
    showFamilyFriendlyOnly: function () {
      return this.$store.getters.getShowFamilyFriendlyOnly
    },
    hideChannelSubscriptions: function () {
      return this.$store.getters.getHideChannelSubscriptions
    },
    hideVideoLikesAndDislikes: function () {
      return this.$store.getters.getHideVideoLikesAndDislikes
    },
    theatrePossible: function () {
      return this.showTranscript || !this.hideRecommendedVideos ||
        (!this.hideLiveChat && this.isLive) || this.watchingPlaylist ||
        this.showSidebarChapters || this.showSidebarSponsorBlock
    },
    autoplayPossible: function () {
      return (!this.watchingPlaylist && !this.hideRecommendedVideos && !!this.nextRecommendedVideo) ||
      (this.watchingPlaylist && !this.$refs.watchVideoPlaylist?.shouldStopDueToPlaylistEnd)
    },
    hideChapters: function () {
      return this.$store.getters.getHideChapters
    },
    sponsorBlockChannelWhitelist: function () {
      const whitelist = this.$store.getters.getSponsorBlockChannelWhitelist
      return Array.isArray(whitelist) ? whitelist : []
    },
    isSponsorBlockChannelWhitelisted: function () {
      return Boolean(this.channelId) && this.sponsorBlockChannelWhitelist.includes(this.channelId)
    },
    sponsorBlockAutoSkipDisabled: function () {
      return this.sponsorBlockAutoSkipTemporarilyDisabled || this.isSponsorBlockChannelWhitelisted
    },
    channelsHidden() {
      return JSON.parse(this.$store.getters.getChannelsHidden).map((ch) => {
        // Legacy support
        if (typeof ch === 'string') {
          return { name: ch, preferredName: '', icon: '' }
        }
        return ch
      })
    },
    forbiddenTitles() {
      return JSON.parse(this.$store.getters.getForbiddenTitles.toLowerCase())
    },
    isUserPlaylistRequested: function () {
      return this.tabRoute.query.playlistType === 'user'
    },
    userPlaylistsReady: function () {
      return this.$store.getters.getPlaylistsReady
    },
    selectedUserPlaylist: function () {
      if (this.playlistId == null || this.playlistId === '') { return null }
      if (!this.isUserPlaylistRequested) { return null }

      return this.$store.getters.getPlaylist(this.playlistId)
    },
    nextRecommendedVideo: function () {
      return this.recommendedVideos.find((video) =>
        !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
      )
    },
    startTimeSeconds: function () {
      if (this.isLoading || this.isLive) {
        return null
      }

      if (this.oneTimeTimestamp !== null && this.oneTimeTimestamp < this.videoLengthSeconds) {
        return this.oneTimeTimestamp
      } else if (this.timestamp !== null && this.timestamp < this.videoLengthSeconds) {
        return this.timestamp
      } else if (this.watchedProgressSavingEnabled && this.historyEntryExists) {
        // For UX consistency, no progress reading if writing disabled

        /** @type {number} */
        const watchProgress = this.historyEntry.watchProgress

        if (watchProgress > 0 && watchProgress < this.videoLengthSeconds - 2) {
          return watchProgress
        }
      }

      return null
    },

    canSaveWatchProgress() {
      if (this.isUpcoming || this.isLive) { return false }

      // `this.$refs.player?.hasLoaded` cannot be used in computed property
      return !this.isLoading
    },
    useSponsorBlock: function () {
      return this.$store.getters.getUseSponsorBlock
    },
    useReturnYouTubeDislikes: function () {
      return this.$store.getters.getUseReturnYouTubeDislikes
    },

    chaptersSrc() {
      if (this.videoChapters.length > 0) {
        const vttText = buildChaptersVttFile(this.videoChapters)

        return `data:text/vtt,${encodeURIComponent(vttText)}`
      } else {
        return ''
      }
    }
  },
  watch: {
    async 'tabRoute.fullPath'() {
      await this.reloadView()
    },
    userPlaylistsReady() {
      this.onMountedDependOnLocalStateLoading()
    },
    enableWatchStats(enabled) {
      if (!enabled) {
        this.clearPendingWatchTime()
      }
    },
    rememberHistory(enabled) {
      if (!enabled) {
        this.clearPendingWatchTime()
      }
    },
    watchStatsResetVersion() {
      this.clearPendingWatchTime()
    },
  },
  created: function () {
    this.theatreModeAnimations = []
    this.videoId = this.tabRoute.params.id
    this.activeFormat = this.defaultVideoFormat
    // So that the value for this session remains unchanged even if setting changed
    this.autoplayNextRecommendedVideo = this.autoplayNextRecommendedVideoByDefault
    this.autoplayNextPlaylistVideo = this.autoplayNextPlaylistVideoByDefault

    this.checkIfTimestamp()
    this.initializePlaybackRate()
    this.initializeVideoQuality()
  },
  mounted: function () {
    this.removeTabLifecycle = this.tabLifecycle?.register(this.tabId, {
      activate: this.activateWatchRuntime,
      deactivate: this.deactivateWatchRuntime,
      beforeNavigate: this.cleanupWatchRuntime,
      beforeReload: this.cleanupWatchRuntime,
      beforeDispose: this.cleanupWatchRuntime
    })
    this.onMountedDependOnLocalStateLoading()
  },
  beforeUnmount: function () {
    this.theatreModeAnimations.forEach(animation => animation.cancel())
    this.deactivateWatchRuntime()
    // When a logical-tab lifecycle is registered, its beforeDispose hook drives
    // cleanupWatchRuntime before this component unmounts. Without one (e.g. the
    // web build), beforeDispose never fires, so run the same teardown here so the
    // beforeunload handlers, watch progress, and player are still disposed.
    const lifecycleHandledDisposal = this.removeTabLifecycle != null
    this.removeTabLifecycle?.()
    this.removeTabLifecycle = null
    if (!lifecycleHandledDisposal) {
      this.cleanupWatchRuntime()
    }
  },
  methods: {
    handleFullscreenCommentsChange({ open, target }) {
      this.fullscreenCommentsTarget = target
      this.fullscreenCommentsOpen = open && target !== null
    },
    closeFullscreenComments() {
      this.$refs.player?.closeFullscreenComments()
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
          playlist?.setScrollTop(scrollTop)
        }
      })
    },
    addCurrentVideoToPlaylist() {
      const videoData = {
        videoId: this.videoId,
        title: this.videoTitle,
        author: this.channelName,
        authorId: this.channelId,
        description: this.videoDescription,
        viewCount: this.videoViewCount,
        lengthSeconds: this.videoLengthSeconds,
        published: this.videoPublished,
        premiereDate: this.premiereDate
      }

      this.$store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [videoData] })
    },
    handleChaptersOverlayChange(open) {
      const shouldUseDefaultTheatreMode = open && !this.theatrePossible &&
        this.defaultViewingMode === 'theatre'

      this.showSidebarChapters = open

      if (shouldUseDefaultTheatreMode) {
        this.useTheatreMode = true
      }
    },
    handleChapterThumbnailsChange(thumbnails) {
      this.videoChapterThumbnails = thumbnails
    },
    handleSponsorBlockInfoChange({ open, loading, pendingUuid, segments, submissionEnabled }) {
      this.showSidebarSponsorBlock = open
      this.sponsorBlockInfoLoading = loading
      this.sponsorBlockInfoPendingUuid = pendingUuid
      this.sponsorBlockInfoSegments = segments
      this.sponsorBlockInfoSubmissionEnabled = submissionEnabled
    },
    closeSidebarSponsorBlock() {
      this.$refs.player?.closeSponsorBlockInfo()
    },
    toggleSponsorBlockInfo() {
      this.$refs.player?.toggleSponsorBlockInfo()
    },
    refreshSponsorBlockInfo() {
      this.$refs.player?.refreshSponsorBlockInfo()
    },
    voteOnSponsorBlockInfoSegment(uuid, vote) {
      this.$refs.player?.voteOnSponsorBlockInfoSegment(uuid, vote)
    },
    skipSponsorBlockInfoSegment(uuid) {
      this.$refs.player?.skipSponsorBlockInfoSegment(uuid)
    },
    closeSidebarChapters() {
      this.$refs.player?.closeChaptersOverlay()
    },
    copyChapterTimestamp(startSeconds) {
      this.$refs.player?.copyChapterTimestamp(startSeconds)
    },
    async toggleTheatreMode() {
      const layout = this.$refs.videoLayout
      const elements = [
        layout.querySelector('.videoPlayer'),
        layout.querySelector('.infoArea'),
        layout.querySelector('.sidebarArea'),
        layout.querySelector('.commentsArea')
      ].filter(element => element !== null)

      this.theatreModeAnimations.forEach(animation => animation.cancel())
      this.theatreModeAnimations = []

      if (isReducedMotionEnabled()) {
        this.useTheatreMode = !this.useTheatreMode
        return
      }

      const previousRects = elements.map(element => element.getBoundingClientRect())
      this.useTheatreMode = !this.useTheatreMode
      await this.$nextTick()

      this.theatreModeAnimations = elements.map((element, index) => {
        const previousRect = previousRects[index]
        const nextRect = element.getBoundingClientRect()
        const translateX = previousRect.left - nextRect.left
        const translateY = previousRect.top - nextRect.top
        const isVideoPlayer = element.classList.contains('videoPlayer')
        const scaleX = isVideoPlayer ? previousRect.width / nextRect.width : 1
        const scaleY = isVideoPlayer ? previousRect.height / nextRect.height : 1
        const animation = element.animate([
          {
            transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left'
          },
          {
            transform: 'none',
            transformOrigin: 'top left'
          }
        ], {
          duration: THEATRE_MODE_ANIMATION_DURATION,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
        })

        animation.addEventListener('finish', () => {
          this.theatreModeAnimations = this.theatreModeAnimations.filter(item => item !== animation)
        })
        return animation
      })
    },

    activateWatchRuntime() {
      if (process.env.IS_ELECTRON && !this.isTabPresented) {
        return
      }

      document.removeEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.removeEventListener('click', this.resetAutoplayInterruptionTimeout)
      document.addEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.addEventListener('click', this.resetAutoplayInterruptionTimeout)
      this.resetAutoplayInterruptionTimeout()
    },

    deactivateWatchRuntime() {
      document.removeEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.removeEventListener('click', this.resetAutoplayInterruptionTimeout)
      this.abortAutoplayCountdown(true)
    },

    async cleanupWatchRuntime() {
      this.$store.commit('setCurrentWatchTimestamp', { tabId: this.tabId, value: null })
      await this.handleRouteChange()
      window.removeEventListener('beforeunload', this.handleWatchProgressAutoSave)
      window.removeEventListener('beforeunload', this.flushWatchTime)
      this.deactivateWatchRuntime()

      if (this.$refs.player) {
        await this.destroyPlayer()
      }
    },

    async reloadView({ preserveTitle = false } = {}) {
      preserveTitle ||= this.preserveTitleOnNextReload
      this.preserveTitleOnNextReload = false

      await this.handleRouteChange()

      if (this.$refs.player) {
        await this.destroyPlayer()
      }

      // react to route changes...
      const previousVideoId = this.videoId
      this.videoId = this.tabRoute.params.id
      const videoIdChanged = this.videoId !== previousVideoId
      if (videoIdChanged) {
        this.ipBlockRecoveryAttemptedForCurrentVideo = false
        this.sabrErrorRecoveryAttemptedForCurrentVideo = false
      }
      this.ipBlockDetectedInCurrentChain = false
      this.resetVideoState({
        preserveTitle,
        placeholderTitle: videoIdChanged ? this.getRoutePlaceholderTitle() : ''
      })

      this.firstLoad = true
      this.videoPlayerLoaded = false
      this.activeFormat = this.defaultVideoFormat

      this.checkIfTimestamp()
      this.checkIfPlaylist()
      this.setViewingModeOnRouteChange()

      switch (this.backendPreference) {
        case 'local':
          await this.getVideoInformationLocal()
          break
        case 'invidious':
          this.getVideoInformationInvidious()
          break
      }
    },

    getRoutePlaceholderTitle: function () {
      return this.tabRoute.fullPath
    },

    resetVideoState: function ({ preserveTitle = false, placeholderTitle = '' } = {}) {
      const previousVideoTitle = this.videoTitle

      this.isLoading = true
      this.isFamilyFriendly = false
      this.isLive = false
      this.liveChat = null
      this.isLiveContent = false
      this.isUpcoming = false
      this.isPostLiveDvr = false
      this.isUnlisted = false
      this.hasAiGeneratedContent = false
      this.upcomingTimestamp = null
      this.upcomingTimeLeft = null
      this.thumbnail = ''
      this.videoTitle = preserveTitle ? previousVideoTitle : placeholderTitle
      this.videoDescription = ''
      this.videoDescriptionHtml = ''
      this.videoCategory = ''
      this.license = ''
      this.videoViewCount = 0
      this.videoLikeCount = 0
      this.videoDislikeCount = 0
      this.videoLengthSeconds = 0
      this.videoChapters = []
      this.videoCurrentChapterIndex = 0
      this.videoChaptersKind = 'chapters'
      this.channelName = ''
      this.channelThumbnail = ''
      this.channelId = ''
      this.channelCollaborators = []
      this.channelSubscriptionCountText = ''
      this.videoPublished = 0
      this.premiereDate = undefined
      this.videoStoryboardSrc = ''
      this.videoAnnotations = []
      this.manifestSrc = null
      this.manifestMimeType = MANIFEST_TYPE_DASH
      this.sabrData = null
      this.legacyFormats = []
      this.captions = []
      this.currentTime = 0
      this.showTranscript = false
      this.showSidebarChapters = false
      this.videoChapterThumbnails = []
      this.vrProjection = null
      this.recommendedVideos = []
      this.playabilityStatus = ''
      this.adEndTimeUnixMs = 0
      this.errorMessage = null
      this.customErrorIcon = null
      this.videoGenreIsMusic = false
      this.streamingDataExpiryDate = null
      this.ipBlockDetectedInCurrentChain = false
      if (!preserveTitle) {
        this.sabrReloadCaptionIndex = null
        this.sabrReloadPlaybackRate = null
        this.updateTitle()
      }
    },

    onMountedDependOnLocalStateLoading() {
      // Prevent running twice
      if (this.onMountedRun) { return }
      // Stuff that require user playlists to be ready
      if (this.isUserPlaylistRequested && !this.userPlaylistsReady) { return }

      this.onMountedRun = true

      this.checkIfPlaylist()

      // this has to be below checkIfPlaylist() as theatrePossible needs to know if there is a playlist or not
      this.setViewingModeOnFirstLoad()

      if (!process.env.SUPPORTS_LOCAL_API || this.backendPreference === 'invidious') {
        this.getVideoInformationInvidious()
      } else {
        this.getVideoInformationLocal()
      }

      window.addEventListener('beforeunload', this.handleWatchProgressAutoSave)
      window.addEventListener('beforeunload', this.flushWatchTime)
      if (!process.env.IS_ELECTRON) {
        this.activateWatchRuntime()
      }
    },

    setViewingModeOnFirstLoad: function () {
      switch (this.defaultViewingMode) {
        case 'theatre':
          this.useTheatreMode = this.theatrePossible
          break
        case 'fullscreen':
        case 'fullscreen_always_on':
          this.startNextVideoInFullscreen = true
          break
        case 'fullwindow':
        case 'fullwindow_always_on':
          this.startNextVideoInFullwindow = true
          break
        case 'pip':
          this.startNextVideoInPip = true
      }
    },

    setViewingModeOnRouteChange: function () {
      switch (this.defaultViewingMode) {
        case 'fullscreen_always_on':
          this.startNextVideoInFullscreen = true
          break
        case 'fullwindow_always_on':
          this.startNextVideoInFullwindow = true
          break
      }
    },

    changeTimestamp: function (timestamp) {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        player.setCurrentTime(timestamp)
      }
    },

    playTranscriptSegment: function (timestamp) {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        player.setCurrentTime(timestamp)

        if (player.isPaused()) {
          player.play()
        }
      }
    },

    getVideoInformationLocal: async function () {
      if (this.firstLoad) {
        this.isLoading = true
      }

      try {
        const videoInfo = await getLocalVideoInfo(this.videoId)
        const { info: result, poToken, clientInfo, adEndTimeUnixMs, reloadSabrData } = videoInfo

        const playabilityStatus = result.playability_status
        this.playabilityStatus = playabilityStatus.status

        if (playabilityStatus.status === 'LOGIN_REQUIRED' && playabilityStatus.error_screen?.reason?.text === 'Private video') {
          // Private videos cannot be played in FreeTube, as they require to be logged as the owner of the video
          // so there is no point continuing or trying any other backends as it will always fail
          this.errorMessage = this.t('Video.Private')
          this.thumbnail = this.getUnavailableVideoThumbnail()
          this.isLoading = false
          this.updateTitle()
          return
        }

        this.adEndTimeUnixMs = adEndTimeUnixMs

        this.isFamilyFriendly = result.basic_info.is_family_safe

        this.recommendedVideos = result.watch_next_feed
          ?.filter((item) => {
            return item.type === 'CompactVideo' || item.type === 'CompactMovie' ||
              (item.type === 'LockupView' && item.content_type === 'VIDEO')
          })
          .map(parseLocalWatchNextVideo).filter(_ => _)
          // place watched recommended videos last
          .sort(this.sortWatchedVideosLast) ?? []

        this.videoAnnotations = parseLocalEndscreen(result.endscreen)

        if (this.showFamilyFriendlyOnly && !this.isFamilyFriendly) {
          this.isLoading = false
          this.handleVideoEnded()
          return
        }

        const avoidTranslation = this.$store.getters.getAvoidTranslation !== 'disabled'

        if (avoidTranslation) {
          this.videoTitle = result.basic_info.title?.trim() ?? ''
        } else {
          // extract localised title first and fall back to the not localised one
          this.videoTitle = result.primary_info?.title?.text?.trim() ?? result.basic_info.title?.trim() ?? ''
        }
        this.videoViewCount = result.basic_info.view_count ?? (result.primary_info.view_count ? extractNumberFromString(result.primary_info.view_count.text) : null)
        this.license = result.secondary_info.metadata.rows.find(element => element.title?.text === 'License')?.contents[0]?.text

        this.channelCollaborators = parseLocalVideoCollaborators(result)
        const primaryCollaborator = this.channelCollaborators[0]

        this.channelId = result.basic_info.channel_id ?? result.secondary_info.owner?.author.id ?? primaryCollaborator?.id ?? ''
        this.channelName = result.basic_info.author ?? result.secondary_info.owner?.author.name ?? primaryCollaborator?.name ?? ''
        this.channelThumbnail = primaryCollaborator?.thumbnail ?? result.secondary_info.owner?.author?.best_thumbnail?.url ?? ''
        this.$store.commit('setVideoAvatar', {
          videoId: this.videoId,
          avatar: this.channelThumbnail
        })

        this.videoCategory = result.basic_info.category ?? ''
        this.videoGenreIsMusic = this.videoCategory === 'Music'

        this.updateSubscriptionDetails({
          channelThumbnailUrl: this.channelThumbnail.length === 0 ? null : this.channelThumbnail,
          channelName: this.channelName,
          channelId: this.channelId
        })

        this.initializePlaybackRate()
        this.initializeVideoQuality()

        let published
        if (result.page[0]?.microformat?.publish_date) {
          // `result.page[0].microformat.publish_date` example value: `2023-08-12T08:59:59-07:00`
          published = Date.parse(result.page[0].microformat.publish_date)
        } else {
          // text date Jan 1, 2000, not as accurate but better than nothing
          published = Date.parse(result.primary_info?.published)
        }
        this.videoPublished = Number.isFinite(published) ? published : 0

        if (avoidTranslation) {
          this.videoDescription = result.basic_info.short_description
        } else if (result.secondary_info?.description.runs) {
          try {
            this.videoDescription = parseLocalTextRuns(result.secondary_info.description.runs)
          } catch (error) {
            console.error('Failed to extract the localised description, falling back to the standard one.', error, JSON.stringify(result.secondary_info.description.runs))
            this.videoDescription = result.basic_info.short_description
          }
        } else {
          this.videoDescription = result.basic_info.short_description
        }

        switch (this.thumbnailPreference) {
          case 'start':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres1.jpg`
            break
          case 'middle':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres2.jpg`
            break
          case 'end':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres3.jpg`
            break
          default:
            this.thumbnail = result.basic_info.thumbnail?.[0].url ?? `https://i.ytimg.com/vi/${this.videoId}/maxresdefault.jpg`
            break
        }

        if (this.hideVideoLikesAndDislikes) {
          this.videoLikeCount = null
          this.videoDislikeCount = null
        } else {
          this.videoLikeCount = isNaN(result.basic_info.like_count) ? 0 : result.basic_info.like_count

          // YouTube doesn't return dislikes anymore
          this.videoDislikeCount = 0

          if (this.useReturnYouTubeDislikes) {
            this.fetchVideoDislikes()
          }
        }

        this.isLive = !!result.basic_info.is_live
        this.isUpcoming = !!result.basic_info.is_upcoming
        this.isLiveContent = !!result.basic_info.is_live_content
        this.isPostLiveDvr = !!result.basic_info.is_post_live_dvr
        this.isUnlisted = !!result.basic_info.is_unlisted
        this.hasAiGeneratedContent = result.primary_info?.badges.some(badge => badge.label === 'AI') ?? false

        if (this.isLive && !this.isLiveContent) {
          this.videoPublished = result.basic_info.start_timestamp.getTime()
        }

        const subCount = !result.secondary_info.owner.subscriber_count.isEmpty() ? parseLocalSubscriberCount(result.secondary_info.owner.subscriber_count.text) : NaN

        if (!isNaN(subCount)) {
          this.channelSubscriptionCountText = formatNumber(subCount, subCount >= 10000 ? { notation: 'compact' } : undefined)
        } else {
          this.channelSubscriptionCountText = ''
        }

        let chapters = []
        let chaptersKind = 'chapters'
        if (!this.hideChapters) {
          const rawChapters = result.player_overlays?.decorated_player_bar?.player_bar?.markers_map
            ?.find(marker => marker.marker_key === 'DESCRIPTION_CHAPTERS')?.value.chapters

          if (rawChapters && !avoidTranslation) {
            for (const chapter of rawChapters) {
              const start = chapter.time_range_start_millis / 1000

              chapters.push({
                title: chapter.title.text,
                timestamp: formatDurationAsTimestamp(start),
                startSeconds: start,
                endSeconds: 0,
                thumbnail: chapter.thumbnail[0]
              })
            }
          } else {
            /** @type {import('youtubei.js').YTNodes.MacroMarkersList | null | undefined} */
            const macroMarkersList = result.page[1]?.engagement_panels
              ?.find(pannel => pannel.panel_identifier === 'engagement-panel-macro-markers-auto-chapters')?.content

            if (macroMarkersList && !avoidTranslation) {
              for (const item of macroMarkersList.contents) {
                if (item instanceof YTNodes.MacroMarkersListItem) {
                  chapters.push({
                    title: item.title.text,
                    timestamp: item.time_description.text,
                    startSeconds: Utils.timeToSeconds(item.time_description.text),
                    endSeconds: 0,
                    thumbnail: item.thumbnail[0]
                  })
                }
              }
              chaptersKind = 'keyMoments'
            } else {
              chapters = this.extractChaptersFromDescription(result.basic_info.short_description ?? result.secondary_info.description.text)
            }
          }

          if (chapters.length > 0) {
            this.finalizeChapters(chapters, result.basic_info.duration)
          } else {
            chapters = await this.getSponsorBlockCommunityChapters(result.basic_info.duration)
          }
        }

        this.videoChapters = chapters
        this.videoChaptersKind = chaptersKind

        // The apostrophe is intentionally that one (char code 8217), because that is the one YouTube uses
        const BOT_MESSAGE = 'Sign in to confirm you’re not a bot'

        const isDrmProtected = result.streaming_data?.adaptive_formats.some(format => format.drm_families || format.drm_track_type)

        if (playabilityStatus.status === 'UNPLAYABLE' || playabilityStatus.status === 'LOGIN_REQUIRED' || isDrmProtected) {
          if (playabilityStatus.error_screen?.offer_id === 'sponsors_only_video') {
            // Members-only videos can only be watched while logged into a Google account that is a paid channel member
            // so there is no point trying any other backends as it will always fail
            this.errorMessage = this.t('Video.MembersOnly')
            this.customErrorIcon = ['fas', 'money-check-dollar']
            this.isLoading = false
            this.updateTitle()
            return
          } else if (playabilityStatus.reason === 'Sign in to confirm your age' || (result.has_trailer && result.getTrailerInfo() === null)) {
            // Age-restricted videos can only be watched while logged into a Google account that is age-verified
            // so there is no point trying any other backends as it will always fail
            this.errorMessage = this.t('Video.AgeRestricted')
            this.isLoading = false
            this.updateTitle()
            return
          } else if (isDrmProtected) {
            // DRM protected videos (e.g. movies) cannot be played in FreeTube,
            // as they require the proprietary and closed source Wideview CDM which is understandably not included in standard Electron builds
            this.errorMessage = this.t('Video.DRMProtected')
            this.isLoading = false
            this.updateTitle()
            return
          }

          let errorText

          if (playabilityStatus.reason === BOT_MESSAGE || playabilityStatus.reason === 'Please sign in') {
            errorText = this.t('Video.IP block')
            this.ipBlockDetectedInCurrentChain = true
          } else {
            errorText = `[${playabilityStatus.status}] ${playabilityStatus.reason}`

            if (playabilityStatus.error_screen?.subreason) {
              errorText += `: ${playabilityStatus.error_screen.subreason.text}`
            }
          }

          if (this.backendFallback) {
            throw new Error(errorText)
          } else {
            const didReload = await this.runIpBlockRecoveryScriptAndReload()
            if (didReload) {
              return
            }

            this.errorMessage = errorText
            this.isLoading = false
            this.updateTitle()
            return
          }
        }

        if (!this.hideLiveChat && (this.isLive || this.isUpcoming) && result.livechat) {
          this.liveChat = result.getLiveChat()
        } else {
          this.liveChat = null
        }

        if ((this.isLive || this.isPostLiveDvr) && !this.isUpcoming) {
          let useRemoteManifest = true

          if (
            this.isLive &&
            result.basic_info.is_live_dvr_enabled &&
            result.streaming_data?.adaptive_formats.length > 0 &&
            result.streaming_data.server_abr_streaming_url &&
            result.player_config.media_common_config.media_ustreamer_request_config
          ) {
            this.manifestSrc = this.createLocalSabrManifest(result, poToken, clientInfo, [], reloadSabrData)
            this.manifestMimeType = MANIFEST_TYPE_SABR
            useRemoteManifest = false
          } else if (this.isPostLiveDvr) {
            // I wasn't able to get SABR working with Post-Live-DVR yet, so for the moment we'll use YouTube's provided DASH manifest instead.
            // It only contains the last 4 hours of the stream, instead of starting from the beginning but that is better than nothing.
            if (
              result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
            ) {
              try {
                this.manifestSrc = await this.createLocalDashManifest(result, true)
                this.manifestMimeType = MANIFEST_TYPE_DASH
                useRemoteManifest = false
              } catch (error) {
                console.error(`Failed to generate DASH manifest for this Post Live DVR video ${this.videoId}, falling back to using YouTube's provided one...`, error)
              }
            }
          }

          if (useRemoteManifest) {
            if (result.streaming_data.dash_manifest_url) {
              this.manifestSrc = result.streaming_data.dash_manifest_url
              this.manifestMimeType = MANIFEST_TYPE_DASH
            } else {
              this.manifestSrc = result.streaming_data.hls_manifest_url
              this.manifestMimeType = MANIFEST_TYPE_HLS
            }
          }

          this.streamingDataExpiryDate = result.streaming_data.expires

          if (this.activeFormat === 'legacy') {
            this.activeFormat = 'dash'
          }
        } else if (this.isUpcoming) {
          const upcomingTimestamp = result.basic_info.start_timestamp

          if (upcomingTimestamp) {
            const timestampOptions = {
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            }
            const now = new Date()
            if (now.getFullYear() < upcomingTimestamp.getFullYear()) {
              Object.defineProperty(timestampOptions, 'year', {
                value: 'numeric'
              })
            }
            this.upcomingTimestamp = Intl.DateTimeFormat(this.currentLocale, timestampOptions).format(upcomingTimestamp)

            let upcomingTimeLeft = upcomingTimestamp - now

            // Convert from ms to second to minute
            upcomingTimeLeft = (upcomingTimeLeft / 1000) / 60
            let timeUnit = 'minute'

            // Youtube switches to showing time left in minutes at 120 minutes remaining
            if (upcomingTimeLeft > 120) {
              upcomingTimeLeft /= 60
              timeUnit = 'hour'
            }

            if (timeUnit === 'hour' && upcomingTimeLeft > 24) {
              upcomingTimeLeft /= 24
              timeUnit = 'day'
            }

            // Value after decimal not to be displayed
            // e.g. > 2 days = display as `2 days`
            upcomingTimeLeft = Math.floor(upcomingTimeLeft)

            // Displays when less than a minute remains
            // Looks better than `Premieres in x seconds`
            if (upcomingTimeLeft < 1) {
              this.upcomingTimeLeft = this.t('Video.Published.In less than a minute').toLowerCase()
            } else {
              // TODO a I18n entry for time format might be needed here
              this.upcomingTimeLeft = new Intl.RelativeTimeFormat(this.currentLocale).format(upcomingTimeLeft, timeUnit)
            }

            this.premiereDate = upcomingTimestamp
          } else {
            this.upcomingTimestamp = null
            this.upcomingTimeLeft = null
            this.premiereDate = undefined
          }
        }

        if ((!this.isUpcoming && !this.isLive && !this.isPostLiveDvr) || (this.isUpcoming && this.playabilityStatus === 'OK')) {
          this.videoLengthSeconds = result.basic_info.duration
          if (result.streaming_data) {
            this.streamingDataExpiryDate = result.streaming_data.expires

            if (result.streaming_data.formats.length > 0) {
              this.legacyFormats = result.streaming_data.formats.map(mapLocalLegacyFormat)
            }

            if (result.captions) {
              const captionTracks = result.captions?.caption_tracks?.map((caption) => {
                const url = new URL(caption.base_url)
                url.searchParams.set('fmt', 'vtt')

                return {
                  id: caption.vss_id,
                  url: url.toString(),
                  label: caption.name.text,
                  language: caption.language_code,
                  mimeType: 'text/vtt'
                }
              }) ?? []

              if (captionTracks.length > 0) {
                const languagesSet = new Set([this.preferredCaptionLocale, this.preferredCaptionLocale.split('-')[0]])

                // special cases
                switch (this.preferredCaptionLocale) {
                  case 'nn':
                  case 'nb-NO':
                    // according to https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
                    // "no" is the macro language for "nb" and "nn"
                    languagesSet.add('no')
                    break
                  case 'he':
                    // according to https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
                    // "iw" is the old/original code for Hewbrew, these days it's "he"
                    languagesSet.add('iw')
                    break
                }

                const hasPreferredCaption = findCaptionByLocale(captionTracks, this.preferredCaptionLocale) ||
                  captionTracks.some(captionTrack => languagesSet.has(captionTrack.language))

                if (!hasPreferredCaption) {
                  const translatedCaptionTrack = this.getTranslatedLocaleCaption(result.captions, languagesSet)

                  if (translatedCaptionTrack) {
                    captionTracks.push(translatedCaptionTrack)
                  }
                }
              }

              this.captions = sortCaptions(captionTracks, this.preferredCaptionLocale)
            }
          } else {
            // video might be region locked or something else. This leads to no formats being available
            this.showTabToast(
              this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.'),
              7000
            )
            this.handleVideoEnded()
            return
          }

          let storyboard

          if (result.storyboards?.type === 'PlayerStoryboardSpec') {
            /** @type {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData[]} */
            let source = result.storyboards.boards
            if (window.innerWidth < 500) {
              source = source.filter((board) => board.thumbnail_height <= 90)
            }

            storyboard = source.at(-1)
            this.videoStoryboardSrc = this.createLocalStoryboardUrls(storyboard)
          }

          if (result.streaming_data?.adaptive_formats.length > 0) {
            this.vrProjection = result.streaming_data.adaptive_formats
              .find(format => {
                return format.has_video &&
                  typeof format.projection_type === 'string' &&
                  format.projection_type !== 'RECTANGULAR'
              })
              ?.projection_type ?? null

            if (
              videoInfo.info.streaming_data?.server_abr_streaming_url &&
              videoInfo.info.player_config.media_common_config.media_ustreamer_request_config
            ) {
              const storyboards = storyboard
                ? [{
                    templateUrl: storyboard.template_url,
                    mimeType: 'image/webp',
                    columns: storyboard.columns,
                    rows: storyboard.rows,
                    thumbnailCount: storyboard.thumbnail_count,
                    thumbnailWidth: storyboard.thumbnail_width,
                    thumbnailHeight: storyboard.thumbnail_height,
                    storyboardCount: storyboard.storyboard_count,
                    interval: storyboard.interval > 0 ? storyboard.interval / 1000 : 0
                  }]
                : []

              this.manifestSrc = this.createLocalSabrManifest(result, poToken, clientInfo, storyboards, reloadSabrData)
              this.manifestMimeType = MANIFEST_TYPE_SABR
            } else if (
              result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
            ) {
              this.manifestSrc = await this.createLocalDashManifest(result)
              this.manifestMimeType = MANIFEST_TYPE_DASH
            } else {
              this.manifestSrc = null
              this.enableLegacyFormat()
            }
          } else {
            this.manifestSrc = null
            this.enableLegacyFormat()
          }
        }

        this.isLoading = false
        this.updateTitle()
      } catch (err) {
        console.error(err)
        if (this.backendPreference === 'local' && this.backendFallback && !err.toString().includes('private') && !err.toString().includes('unavailable')) {
          const errorMessage = this.t('Local API Error (Click to copy)')
          this.showTabToast(`${errorMessage}: ${err}`, 10000, () => {
            copyToClipboard(err)
          })
          this.showTabToast(this.t('Falling back to Invidious API'))
          this.getVideoInformationInvidious()
        } else {
          const didReload = await this.runIpBlockRecoveryScriptAndReload()
          if (didReload) {
            return
          }

          this.isLoading = false

          if (!this.thumbnail) {
            this.thumbnail = this.getUnavailableVideoThumbnail()
          }
          this.errorMessage = err.message || err.toString()
        }
      }
    },

    getVideoInformationInvidious: function () {
      if (this.firstLoad) {
        this.isLoading = true
      }

      invidiousGetVideoInformation(this.videoId)
        .then(async result => {
          if (result.error) {
            throw new Error(result.error)
          }

          this.videoTitle = result.title
          this.videoViewCount = result.viewCount

          const subCount = parseLocalSubscriberCount(result.subCountText)
          if (!isNaN(subCount)) {
            this.channelSubscriptionCountText = formatNumber(subCount, subCount >= 10000 ? { notation: 'compact' } : undefined)
          } else {
            this.channelSubscriptionCountText = ''
          }

          if (this.hideVideoLikesAndDislikes) {
            this.videoLikeCount = null
            this.videoDislikeCount = null
          } else {
            this.videoLikeCount = result.likeCount
            this.videoDislikeCount = result.dislikeCount

            if (this.useReturnYouTubeDislikes) {
              this.fetchVideoDislikes()
            }
          }

          this.videoCategory = result.genre ?? ''
          this.videoGenreIsMusic = this.videoCategory === 'Music'

          this.channelId = result.authorId
          this.channelName = result.author
          this.channelCollaborators = []
          const channelThumb = result.authorThumbnails[1]
          this.channelThumbnail = channelThumb ? youtubeImageUrlToInvidious(channelThumb.url, this.currentInvidiousInstanceUrl) : ''
          this.$store.commit('setVideoAvatar', {
            videoId: this.videoId,
            avatar: this.channelThumbnail
          })
          this.updateSubscriptionDetails({
            channelThumbnailUrl: channelThumb?.url,
            channelName: result.author,
            channelId: result.authorId
          })

          this.initializePlaybackRate()
          this.initializeVideoQuality()

          this.videoPublished = result.published * 1000
          this.videoDescriptionHtml = result.descriptionHtml
          const recommendedVideos = result.recommendedVideos

          // The recommended videos currently use yyyy-mm-ddThh:mm:ss for the published timestamp
          // whereas the rest of the API uses unix timestamps, correct that here
          recommendedVideos.forEach((video) => {
            if (typeof video.published === 'string') {
              video.published = Date.parse(video.published)
            }
          })

          // place watched recommended videos last
          this.recommendedVideos = recommendedVideos.sort(this.sortWatchedVideosLast)

          this.isLive = result.liveNow
          this.isFamilyFriendly = result.isFamilyFriendly
          this.isPostLiveDvr = !!result.isPostLiveDvr
          this.isUnlisted = !result.isListed

          this.captions = sortCaptions(result.captions.map(caption => {
            return {
              url: this.currentInvidiousInstanceUrl + caption.url,
              label: caption.label,
              language: caption.language_code,
              mimeType: 'text/vtt'
            }
          }), this.preferredCaptionLocale)

          if (!this.isLive && !this.isPostLiveDvr) {
            this.videoStoryboardSrc = `${this.currentInvidiousInstanceUrl}/api/v1/storyboards/${this.videoId}?height=90`
          }

          switch (this.thumbnailPreference) {
            case 'start':
              this.thumbnail = `${this.currentInvidiousInstanceUrl}/vi/${this.videoId}/maxres1.jpg`
              break
            case 'middle':
              this.thumbnail = `${this.currentInvidiousInstanceUrl}/vi/${this.videoId}/maxres2.jpg`
              break
            case 'end':
              this.thumbnail = `${this.currentInvidiousInstanceUrl}/vi/${this.videoId}/maxres3.jpg`
              break
            default:
              this.thumbnail = result.videoThumbnails[0].url
              break
          }

          let chapters = []
          if (!this.hideChapters) {
            chapters = this.extractChaptersFromDescription(result.description)

            if (chapters.length > 0) {
              this.finalizeChapters(chapters, result.lengthSeconds)
            } else {
              chapters = await this.getSponsorBlockCommunityChapters(result.lengthSeconds)
            }
          }
          this.videoChapters = chapters
          this.videoChaptersKind = 'chapters'

          if (this.isLive || this.isPostLiveDvr) {
            // The live DASH manifest is currently unusable as it returns 403s after 1 minute of playback
            // so we have to use the HLS one for now.
            // Leaving the code here commented out in case we can use it again in the future
            // const url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

            // // Proxying doesn't work for live or post live DVR DASH, so use HLS instead
            // // https://github.com/iv-org/invidious/pull/4589
            // if (this.proxyVideos) {

            this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)

            let hlsManifestUrl = result.hlsUrl

            if (this.proxyVideos) {
              const url = new URL(hlsManifestUrl)
              url.searchParams.set('local', 'true')
              hlsManifestUrl = url.toString()
            }

            this.manifestSrc = hlsManifestUrl
            this.manifestMimeType = MANIFEST_TYPE_HLS

            // The HLS manifests only contain combined audio+video streams, so we can't do audio only
            if (this.activeFormat === 'audio') {
              this.activeFormat = 'dash'
            }
            // } else {
            //   this.manifestSrc = url
            //   this.manifestMimeType = MANIFEST_TYPE_DASH
            // }

            this.legacyFormats = []

            if (this.activeFormat === 'legacy') {
              this.activeFormat = 'dash'
            }
          } else {
            this.videoLengthSeconds = result.lengthSeconds

            this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)

            this.legacyFormats = result.formatStreams.map(mapInvidiousLegacyFormat)

            if (!process.env.SUPPORTS_LOCAL_API || this.proxyVideos) {
              this.legacyFormats.forEach(format => {
                format.url = getProxyUrl(format.url)
              })
            }

            this.vrProjection = result.adaptiveFormats
              .find(stream => {
                return typeof stream.projectionType === 'string' &&
                  stream.projectionType !== 'RECTANGULAR'
              })
              ?.projectionType ?? null

            this.manifestSrc = await this.createInvidiousDashManifest(result)
            this.manifestMimeType = MANIFEST_TYPE_DASH
          }

          this.updateTitle()

          this.isLoading = false
        })
        .catch(async err => {
          console.error(err)
          if (process.env.SUPPORTS_LOCAL_API && this.backendPreference === 'invidious' && this.backendFallback) {
            const errorMessage = this.t('Invidious API Error (Click to copy)')
            this.showTabToast(`${errorMessage}: ${err}`, 10000, () => {
              copyToClipboard(err)
            })
            this.showTabToast(this.t('Falling back to Local API'))
            this.getVideoInformationLocal()
          } else {
            const didReload = await this.runIpBlockRecoveryScriptAndReload()
            if (didReload) {
              return
            }

            this.isLoading = false

            if (!this.thumbnail) {
              this.thumbnail = this.getUnavailableVideoThumbnail()
            }
            this.errorMessage = err.message || err.toString()
          }
        })
    },

    async runIpBlockRecoveryScriptAndReload() {
      if (
        !this.ipBlockDetectedInCurrentChain ||
        this.ipBlockRecoveryAttemptedForCurrentVideo ||
        !process.env.IS_ELECTRON
      ) {
        return false
      }

      const scriptPath = this.videoIpBlockScriptPath.trim()
      if (
        scriptPath.length === 0 ||
        typeof window.ftElectron?.startIpBlockRecoveryScript !== 'function' ||
        typeof window.ftElectron?.executeIpBlockRecoveryScript !== 'function'
      ) {
        return false
      }

      this.ipBlockRecoveryAttemptedForCurrentVideo = true
      const longToastDurationMs = 10000
      const startedRecovery = await window.ftElectron.startIpBlockRecoveryScript(scriptPath)
      if (startedRecovery) {
        // IP block recovery affects the whole app (network level), so surface it
        // globally once, from the tab that atomically started the shared run.
        showToastOnAllTabs(this.t('Settings.Proxy Settings.Running IP block recovery script'), longToastDurationMs)
      }

      try {
        const result = await window.ftElectron.executeIpBlockRecoveryScript(scriptPath)
        if (startedRecovery && result?.exitCode !== 0) {
          const exitCode = result?.exitCode == null ? 'unknown' : `${result.exitCode}`
          showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script failed', { exitCode }), longToastDurationMs)
        } else if (startedRecovery) {
          showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script finished'), longToastDurationMs)
        }
      } catch (error) {
        console.error('IP block recovery script failed:', error)
        if (startedRecovery) {
          showToastOnAllTabs(this.t('Settings.Proxy Settings.IP block recovery script failed', { exitCode: 'unknown' }), longToastDurationMs)
        }
      }

      // The reload only affects this tab's video, so keep it scoped.
      this.showTabToast(this.t('Settings.Proxy Settings.Reloading video after IP block recovery'), longToastDurationMs)
      await this.reloadView()
      return true
    },

    extractExpiryDateFromStreamingUrl: function (url) {
      const expireString = new URL(url).searchParams.get('expire')

      return new Date(parseInt(expireString) * 1000)
    },

    getUnavailableVideoThumbnail: function () {
      const backgroundColor = window.getComputedStyle(document.body).backgroundColor
      const isLightTheme = calculateColorLuminance(backgroundColor) === '#000000'

      return isLightTheme
        ? UNAVAILABLE_VIDEO_THUMBNAILS.light
        : UNAVAILABLE_VIDEO_THUMBNAILS.dark
    },

    /**
     * @param {string?} description
     */
    extractChaptersFromDescription: function (description) {
      if (description == null) { return [] }

      /** @type {{title: string, timestamp: string, startSeconds: number, endSeconds: number}[]} */
      const chapters = []

      // HH:MM:SS Text
      // MM:SS Text
      // HH:MM:SS: Text
      // MM:SS: Text
      // HH:MM:SS - Text // separator is one of '-', '–', '•', '—'
      // MM:SS - Text
      // HH:MM:SS - HH:MM:SS - Text // end timestamp is ignored, separator is one of '-', '–', '—'
      // HH:MM - HH:MM - Text // end timestamp is ignored
      const chapterMatches = description.matchAll(/^(?<timestamp>((?<hours>\d+):)?(?<minutes>\d+):(?<seconds>\d+))(?!:\d)(\s*[–—-]\s*(?:\d+:){1,2}\d+)?(?:\s*:\s*|\s+([–—•-]\s*)?)(?<title>.+)$/gm)

      for (const { groups } of chapterMatches) {
        let start = 60 * Number(groups.minutes) + Number(groups.seconds)

        if (groups.hours) {
          start += 3600 * Number(groups.hours)
        }

        // replace previous chapter with current one if they have an identical start time
        if (chapters.length > 0 && chapters[chapters.length - 1].startSeconds === start) {
          chapters.pop()
        }

        chapters.push({
          title: groups.title.trim(),
          timestamp: groups.timestamp,
          startSeconds: start,
          endSeconds: 0
        })
      }

      return chapters
    },

    addChaptersEndSeconds: function (chapters, videoLengthSeconds) {
      for (let i = 0; i < chapters.length - 1; i++) {
        chapters[i].endSeconds = chapters[i + 1].startSeconds
      }
      chapters.at(-1).endSeconds = videoLengthSeconds
    },

    finalizeChapters: function (chapters, videoLengthSeconds) {
      this.addChaptersEndSeconds(chapters, videoLengthSeconds)

      // prevent vue from adding reactivity which isn't needed
      // as the chapter objects are read-only after this anyway
      // the chapters are checked for every timeupdate event that the player emits
      // this should lessen the performance and memory impact of the chapters
      chapters.forEach(Object.freeze)
    },

    /**
     * @param {number} videoLengthSeconds
     * @returns {Promise<{title: string, timestamp: string, startSeconds: number, endSeconds: number}[]>}
     */
    async getSponsorBlockCommunityChapters(videoLengthSeconds) {
      if (!this.useSponsorBlock || this.isLive || this.isPostLiveDvr || !Number.isFinite(videoLengthSeconds) || videoLengthSeconds <= 0) {
        return []
      }

      try {
        const sponsorBlockChapters = await sponsorBlockSkipSegments(this.videoId, ['chapter'], ['chapter'])

        if (sponsorBlockChapters.length === 0) {
          return []
        }

        const chapters = sponsorBlockChapters
          .filter(({ description, segment }) => {
            return description.trim() !== '' &&
              Array.isArray(segment) &&
              segment.length === 2 &&
              Number.isFinite(segment[0]) &&
              Number.isFinite(segment[1]) &&
              segment[0] >= 0 &&
              segment[1] > segment[0]
          })
          .map(({ description, segment: [startSeconds, endSeconds] }) => {
            return {
              title: description.trim(),
              timestamp: formatDurationAsTimestamp(Math.round(startSeconds)),
              startSeconds,
              endSeconds
            }
          })
          .sort((chapterA, chapterB) => chapterA.startSeconds - chapterB.startSeconds)

        /** @type {{title: string, timestamp: string, startSeconds: number, endSeconds: number}[]} */
        const deduplicatedChapters = []

        for (const chapter of chapters) {
          if (chapter.startSeconds >= videoLengthSeconds) {
            continue
          }

          if (deduplicatedChapters.length > 0 && deduplicatedChapters.at(-1).startSeconds === chapter.startSeconds) {
            deduplicatedChapters.pop()
          }

          deduplicatedChapters.push(chapter)
        }

        if (deduplicatedChapters.length === 0) {
          return []
        }

        for (let i = 0; i < deduplicatedChapters.length - 1; i++) {
          deduplicatedChapters[i].endSeconds = deduplicatedChapters[i + 1].startSeconds
        }

        const lastChapter = deduplicatedChapters.at(-1)
        lastChapter.endSeconds = Math.min(videoLengthSeconds, Math.max(lastChapter.endSeconds, lastChapter.startSeconds))

        deduplicatedChapters.forEach(Object.freeze)

        return deduplicatedChapters
      } catch (error) {
        console.error('failed to fetch SponsorBlock community chapters', this.videoId, error)
        return []
      }
    },

    /**
     * @param {number} currentSeconds
     */
    updateCurrentChapter: function (currentSeconds) {
      this.trackWatchTime()
      this.markAsWatchedIfFinished(currentSeconds)
      this.keepHistoryEntryAlive(currentSeconds)

      const chapters = this.videoChapters

      if (this.hideChapters || chapters.length === 0) {
        return
      }

      const currentChapterStart = chapters[this.videoCurrentChapterIndex].startSeconds

      if (currentSeconds !== currentChapterStart) {
        let i = currentSeconds < currentChapterStart ? 0 : this.videoCurrentChapterIndex

        for (; i < chapters.length; i++) {
          if (currentSeconds < chapters[i].endSeconds) {
            this.videoCurrentChapterIndex = i
            break
          }
        }
      }
    },

    updateCurrentTime: function (currentSeconds) {
      this.currentTime = currentSeconds
    },

    handleTimeUpdate: function (currentSeconds) {
      this.updateCurrentTime(currentSeconds)
      this.updateCurrentChapter(currentSeconds)
      this.$store.commit('setCurrentWatchTimestamp', {
        tabId: this.tabId,
        value: currentSeconds
      })
    },

    addToHistory: function (watchProgress, isWatched = isHistoryEntryWatched(this.historyEntry)) {
      const now = Date.now()
      const videoData = {
        ...this.historyEntry,
        videoId: this.videoId,
        title: this.videoTitle,
        author: this.channelName,
        authorId: this.channelId,
        published: this.videoPublished,
        description: this.videoDescription,
        viewCount: this.videoViewCount,
        lengthSeconds: this.videoLengthSeconds,
        watchProgress: watchProgress,
        isWatched,
        timeWatched: now,
        isLive: false,
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
      if (!this.rememberHistory || this.isUpcoming || this.isLive || this.historyEntry?.isWatched === true) {
        return
      }

      if (!isFinished && this.$refs.player?.isPaused()) {
        return
      }

      if (isFinished || hasReachedWatchedThreshold(currentSeconds, this.videoLengthSeconds)) {
        const watchProgress = this.watchedProgressSavingEnabled
          ? currentSeconds
          : (this.historyEntry?.watchProgress ?? 0)

        this.addToHistory(watchProgress, true)
      }
    },

    handleWatchProgressManualSave() {
      // Should be called by manual action, settings should be checked in UI
      this._saveWatchProgress()
      showToast(this.t('Video.Watched Progress Saved'))
    },
    handleChannelPlaybackSpeedManualSave() {
      // Should be called by manual action, settings should be checked in UI
      const rememberPerChannel = this.$store.getters.getRememberPlaybackSpeedPerChannel
      if (!rememberPerChannel || !this.channelId) {
        return
      }

      this.saveChannelPlaybackSpeed(this.currentPlaybackRate)
      showToast(this.t('Video.Channel Playback Speed Saved'))
    },
    handleChannelVideoQualityManualSave() {
      // Should be called by manual action, settings should be checked in UI
      const rememberPerChannel = this.$store.getters.getRememberVideoQualityPerChannel
      if (!rememberPerChannel || !this.channelId) {
        return
      }

      if (this.saveChannelVideoQuality(this.currentVideoQuality)) {
        showToast(this.t('Video.Channel Video Quality Saved'))
      }
    },
    handleWatchProgressAutoSave() {
      if (!this.rememberHistory || !this.autosaveWatchedProgress) { return }
      this._saveWatchProgress()
    },
    handleWatchProgressAutoSaveWhenProgressEnabled() {
      if (!this.rememberHistory || !this.watchedProgressSavingEnabled) { return }
      this._saveWatchProgress()
    },
    handleVideoPause() {
      this.watchTimeLastTick = null
      this.flushWatchTime()
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
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
      if (this.watchTimeLastTick !== null) {
        const elapsed = now - this.watchTimeLastTick

        // Ignore suspended or heavily delayed timers instead of counting idle time.
        if (elapsed > 0 && elapsed <= 5000) {
          const watchedAt = new Date(now)
          const date = [
            watchedAt.getFullYear(),
            String(watchedAt.getMonth() + 1).padStart(2, '0'),
            String(watchedAt.getDate()).padStart(2, '0'),
          ].join('-')

          this.pendingWatchTimeByDate[date] = (this.pendingWatchTimeByDate[date] ?? 0) + elapsed
        }
      }

      this.watchTimeLastTick = now

      const pendingMilliseconds = Object.values(this.pendingWatchTimeByDate)
        .reduce((total, milliseconds) => total + milliseconds, 0)

      if (pendingMilliseconds >= 10000) {
        this.flushWatchTime()
      }
    },
    async flushWatchTime() {
      this.watchTimeLastTick = null
      const pending = this.pendingWatchTimeByDate
      this.pendingWatchTimeByDate = {}

      await Promise.all(Object.entries(pending).map(([date, milliseconds]) => {
        return this.$store.dispatch('recordWatchTime', {
          date,
          seconds: milliseconds / 1000,
        })
      }))
    },
    _saveWatchProgress() {
      if (!this.canSaveWatchProgress) { return }
      if (!this.$refs.player?.hasLoaded) { return }

      const currentTime = this.getWatchedProgress()
      const payload = {
        videoId: this.videoId,
        watchProgress: currentTime
      }
      this.updateWatchProgress(payload)
    },

    fetchVideoDislikes: function () {
      const videoIdAtRequestTime = this.videoId
      getVideoDislikes(videoIdAtRequestTime).then(dislikes => {
        // Avoid overwriting the dislike count for a different video,
        // e.g. if the user navigated away before the request resolved.
        if (this.videoId !== videoIdAtRequestTime) { return }

        this.videoDislikeCount = isNaN(dislikes) ? 0 : dislikes
      }).catch(err => {
        console.error('Failed to fetch dislikes from Return YouTube Dislike:', err)
      })
    },

    handlePlaylistPersisting: function () {
      // Only save playlist ID if enabled, and it's not special video types
      if (!(this.rememberHistory && this.saveVideoHistoryWithLastViewedPlaylist)) { return }
      if (this.isUpcoming || this.isLive) { return }

      this.updateLastViewedPlaylist({
        videoId: this.videoId,
        // Whether there is a playlist ID or not, save it
        lastViewedPlaylistId: this.playlistId,
        lastViewedPlaylistType: this.playlistType,
        lastViewedPlaylistItemId: this.playlistItemId,
      })
    },

    /**
     * @param {{ videoId: string }} a
     * @param {{ videoId: string }} b
     */
    sortWatchedVideosLast: function (a, b) {
      const aWasWatched = this.isRecommendedVideoWatched(a.videoId)
      const bWasWatched = this.isRecommendedVideoWatched(b.videoId)

      if (aWasWatched && !bWasWatched) {
        return 1
      } else if (!aWasWatched && bWasWatched) {
        return -1
      } else {
        return 0
      }
    },

    isRecommendedVideoWatched: function (videoId) {
      return isHistoryEntryWatched(this.$store.getters.getHistoryCacheById[videoId])
    },

    handleVideoLoaded: function () {
      // Only used one time = remove after use
      this.oneTimeTimestamp = null
      this.sabrReloadCaptionIndex = null
      this.sabrReloadPlaybackRate = null

      // will trigger again if you switch formats or change legacy quality
      // Check isUpcoming to avoid marking upcoming videos as watched if the user has only watched the trailer
      if (!this.videoPlayerLoaded && !this.isUpcoming) {
        this.videoPlayerLoaded = true
        this.playlistScrollPositions.sidebar = null
        this.playlistScrollPositions.fullscreen = null
        this.$refs.watchVideoPlaylist?.centerCurrentVideo()

        if (this.rememberHistory) {
          if (this.timestamp) {
            this.addToHistory(this.timestamp)
          } else if (this.historyEntryExists) {
            this.addToHistory(this.historyEntry.watchProgress)
          } else {
            this.addToHistory(0)
          }

          // Must be called AFTER history entry inserted
          // Otherwise the value is not saved for first time watched videos
          this.handlePlaylistPersisting()
        }

        this.updateLocalPlaylistLastPlayedAtSometimes()
      }
    },

    checkIfPlaylist: function () {
      if (this.tabRoute.query == null) {
        this.watchingPlaylist = false
        return
      }

      this.playlistId = this.tabRoute.query.playlistId
      this.playlistItemId = this.tabRoute.query.playlistItemId

      if (this.playlistId == null || this.playlistId.length === 0) {
        this.playlistType = ''
        this.playlistItemId = null
        this.watchingPlaylist = false
        return
      }

      // `playlistId` present
      if (this.selectedUserPlaylist != null) {
        // If playlist ID matches a user playlist, it must be user playlist
        this.playlistType = 'user'
        this.watchingPlaylist = true
        return
      }

      // Still possible to be a user playlist from history
      // (but user playlist could be already removed)
      this.playlistType = this.tabRoute.query.playlistType
      if (this.playlistType !== 'user') {
        // Remote playlist
        this.playlistItemId = null
        this.watchingPlaylist = true
        return
      }

      // At this point `playlistType === 'user'`
      // But the playlist might be already removed
      if (this.selectedUserPlaylist == null) {
        // Clear playlist data so that watch history will be properly updated
        this.playlistId = ''
        this.playlistType = ''
        this.playlistItemId = null
      }
      this.watchingPlaylist = this.selectedUserPlaylist != null
    },

    checkIfTimestamp: function () {
      const oneTimeTimestamp = parseInt(this.tabRoute.query.oneTimeTimestamp)
      this.oneTimeTimestamp = isNaN(oneTimeTimestamp) || oneTimeTimestamp < 0 ? null : oneTimeTimestamp

      const timestamp = parseInt(this.tabRoute.query.timestamp)
      this.timestamp = isNaN(timestamp) || timestamp < 0 ? null : timestamp
    },

    handleFormatChange: function (format) {
      switch (format) {
        case 'dash':
          this.enableDashFormat()
          break
        case 'legacy':
          this.enableLegacyFormat()
          break
        case 'audio':
          this.enableAudioFormat()
          break
      }
    },

    enableDashFormat: function () {
      if (this.activeFormat === 'dash') {
        return
      }

      if (this.manifestSrc === null) {
        showToast(this.t('Change Format.Dash formats are not available for this video'))
        return
      }

      this.activeFormat = 'dash'
    },

    enableLegacyFormat: function () {
      if (this.activeFormat === 'legacy') {
        return
      }

      if (this.isLive || this.isPostLiveDvr || this.legacyFormats.length === 0) {
        showToast(this.t('Change Format.Legacy formats are not available for this video'))
        return
      }

      this.activeFormat = 'legacy'
    },

    enableAudioFormat: function () {
      if (this.activeFormat === 'audio') {
        return
      }

      if (this.manifestSrc === null ||
        ((this.isLive || this.isPostLiveDvr) &&
        // The WEB HLS manifests only contain combined audio and video files, so we can't do audio only
        // The IOS HLS manifests have audio-only streams
          this.manifestMimeType === MANIFEST_TYPE_HLS && !this.manifestSrc.includes('/demuxed/1'))) {
        showToast(this.t('Change Format.Audio formats are not available for this video'))
        return
      }

      this.activeFormat = 'audio'
    },

    handlePlayerEnded: function (sleepTimerEnded = false) {
      this.markAsWatchedIfFinished(this.videoLengthSeconds, true)

      if (sleepTimerEnded) {
        this.handleWatchProgressAutoSaveWhenProgressEnabled()
        return
      }

      this.handleVideoEnded()
    },

    handleTerminalOutroStarted: function (currentSeconds) {
      this.markAsWatchedIfFinished(currentSeconds, true)
    },

    handleVideoEnded: function () {
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
      if (process.env.IS_ELECTRON && !this.isTabPresented) {
        return
      }
      if (!this.autoplayEnabled) {
        return
      }

      if (this.blockVideoAutoplay) {
        showToast(this.t('Autoplay Interruption Timer',
          this.defaultAutoplayInterruptionIntervalHours,
          {
            autoplayInterruptionIntervalHours: this.defaultAutoplayInterruptionIntervalHours
          }),
        3_600_000
        )
        this.resetAutoplayInterruptionTimeout()
        return
      }

      if (this.watchingPlaylist && this.$refs.watchVideoPlaylist?.shouldStopDueToPlaylistEnd) {
        // Let `watchVideoPlaylist` handle end of playlist, no countdown needed
        this.$refs.watchVideoPlaylist.playNextVideo()
        return
      }

      const nextVideo = this.watchingPlaylist
        ? this.$refs.watchVideoPlaylist?.nextVideo
        : this.nextRecommendedVideo

      if (!nextVideo?.videoId) {
        return
      }

      const nextVideoInterval = this.defaultInterval
      this.playNextTimeout = setTimeout(() => {
        this.playNextVideoNow(false)
      }, nextVideoInterval * 1000)

      if (nextVideoInterval > 0) {
        const autoplayVideo = { ...nextVideo }

        if (this.$store.getters.getAvoidTranslation === 'entire_app') {
          const cachedTitle = getCachedOembedTitle(nextVideo.videoId)
          if (cachedTitle !== null) {
            autoplayVideo.title = cachedTitle
          } else {
            getOembedTitle(nextVideo.videoId).then((title) => {
              if (title && this.autoplayCountdown?.video?.videoId === nextVideo.videoId) {
                this.autoplayCountdown = {
                  ...this.autoplayCountdown,
                  video: {
                    ...this.autoplayCountdown.video,
                    title
                  }
                }
              }
            })
          }
        }

        const countdownEndsAt = Date.now() + (nextVideoInterval * 1000)
        this.autoplayCountdown = {
          remainingSeconds: nextVideoInterval,
          video: autoplayVideo
        }
        this.playNextCountDownIntervalId = setInterval(() => {
          const remainingSeconds = Math.max(1, Math.ceil((countdownEndsAt - Date.now()) / 1000))
          this.autoplayCountdown = {
            ...this.autoplayCountdown,
            remainingSeconds
          }
        }, 250)
      }
    },

    playNextVideoNow: function (forcePlayback = true) {
      const player = this.$refs.player
      const nextVideoId = this.autoplayCountdown?.video?.videoId ?? this.nextRecommendedVideo?.videoId

      this.abortAutoplayCountdown(true)

      if (!forcePlayback && !player?.isPaused()) {
        return
      }

      if (this.watchingPlaylist) {
        this.$refs.watchVideoPlaylist?.playNextVideo()
      } else if (nextVideoId) {
        this.tabRouter.push({
          path: `/watch/${nextVideoId}`
        })
        showToast(this.t('Playing Next Video'))
      }
    },

    // Skip to the next video if in a playlist
    // else next recommended video if autoplay enabled
    handleSkipToNext: function () {
      if (this.watchingPlaylist) {
        this.$refs.watchVideoPlaylist?.playNextVideo()
      } else if (!this.hideRecommendedVideos && this.nextRecommendedVideo) {
        this.tabRouter.push({
          path: `/watch/${this.nextRecommendedVideo.videoId}`
        })
        showToast(this.t('Playing Next Video'))
      }
    },

    // Skip to the previous video in a playlist
    handleSkipToPrev: function () {
      this.$refs.watchVideoPlaylist?.playPreviousVideo()
    },

    abortAutoplayCountdown: function (hideToast = false) {
      clearTimeout(this.playNextTimeout)
      clearInterval(this.playNextCountDownIntervalId)
      this.playNextTimeout = null
      this.playNextCountDownIntervalId = null
      this.autoplayCountdown = null

      if (!hideToast) {
        showToast(this.t('Canceled next video autoplay'))
      }
    },

    handleRouteChange: async function () {
      this.abortAutoplayCountdown(true)
      this.handleWatchProgressAutoSave()
      await this.flushWatchTime()
    },

    /**
     * @param {import('shaka-player/dist/shaka-player.ui').default.util.Error} error
     */
    handlePlayerError: async function (error) {
      // the error is logged to the console inside the player so we don't have to do it here

      const { Code } = shaka.util.Error

      if (error.code === Code.HTTP_ERROR) {
        if (error.data[1]?.message === 'Failed to fetch' && !navigator.onLine) {
          // Internet connection was lost, do nothing on our side as
          // shaka-player will keep trying until the internet connection returns and resume playback automatically when it does
          return
        }
      } else if (error.code === Code.BAD_HTTP_STATUS) {
        switch (error.data[1]) {
          case 429:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            this.errorMessage = '[BAD_HTTP_STATUS: 429] Ratelimited'
            return
          case 403:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            if (new Date() > this.streamingDataExpiryDate) {
              this.errorMessage = '[BAD_HTTP_STATUS: 403] YouTube watch session expired. Please reopen this video.'
              this.customErrorIcon = ['fas', 'clock']
              return
            }

            if (this.videoGenreIsMusic) {
              this.errorMessage = '[BAD_HTTP_STATUS: 403] Potential causes: IP block, streaming URL deciphering failed or music video geo-block'
            } else {
              this.errorMessage = '[BAD_HTTP_STATUS: 403] Potential causes: IP block or streaming URL deciphering failed'
            }

            this.ipBlockDetectedInCurrentChain = true
            await this.runIpBlockRecoveryScriptAndReload()
            return
        }
      } else if (error.code === Code.VIDEO_ERROR) {
        if (this.activeFormat === 'legacy') {
          if (new Date() > this.streamingDataExpiryDate) {
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            this.errorMessage = '[VIDEO_ERROR] YouTube watch session expired. Please reopen this video.'
            this.customErrorIcon = ['fas', 'clock']
            return
          }
        }
      }

      if (
        this.activeFormat === 'dash' &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        !this.sabrErrorRecoveryAttemptedForCurrentVideo
      ) {
        // A SABR playback session may no longer be reusable after a critical
        // error. Refetch it once in-place before giving up HD and falling back
        // to the legacy 360p stream.
        this.sabrErrorRecoveryAttemptedForCurrentVideo = true
        await this.onPlayerReloadRequested(
          this.$refs.player?.getSabrReloadState(),
          'Refreshing SABR stream after playback error'
        )
        return
      }

      if (this.isLive || this.isPostLiveDvr) {
        // live streams don't have legacy formats, so only switch between dash and audio

        if (this.activeFormat === 'dash') {
          console.error('Unable to play DASH formats. Reverting to audio formats...')
          this.enableAudioFormat()
        } else {
          console.error('Unable to play audio formats. Reverting to DASH formats...')
          this.enableDashFormat()
        }
      } else {
        // loop through formats DASH -> legacy -> audio -> DASH

        switch (this.activeFormat) {
          case 'dash':
            console.error('Unable to play DASH formats. Reverting to legacy formats...')
            this.enableLegacyFormat()
            break
          case 'legacy':
            console.error('Unable to play legacy formats. Reverting to audio formats...')
            this.enableAudioFormat()
            break
          case 'audio':
            console.error('Unable to play audio formats. Reverting to DASH formats...')
            this.enableDashFormat()
            break
        }
      }
    },

    /**
     * @param {import('youtubei.js').YT.VideoInfo} videoInfo
     * @param {boolean} includeThumbnails
     */
    createLocalDashManifest: async function (videoInfo, includeThumbnails = false) {
      const xmlData = await videoInfo.toDash({
        manifest_options: {
          include_thumbnails: includeThumbnails,
        },
      })

      return `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(xmlData)}`
    },

    /**
     * @param {import('youtubei.js').IParsedResponse} videoInfo
     * @param {string} poToken
     * @param {SabrData['clientInfo']} clientInfo
     * @param {import('../../helpers/player/SabrManifestParser').SabrManifest['storyboards']} storyboards
     * @param {SabrData['reload']} reload
     */
    createLocalSabrManifest: function (videoInfo, poToken, clientInfo, storyboards, reload) {
      const url = new URL(videoInfo.streaming_data.server_abr_streaming_url)
      url.searchParams.set('alr', 'yes')
      url.searchParams.set('cpn', videoInfo.cpn)
      // Shaka's scheme registry is renderer-global. Each retained tab therefore
      // needs its own scheme so one SABR player cannot replace or unregister
      // another player's request handler.
      const scheme = `sabr${nextSabrSchemeId++}`

      this.sabrData = {
        scheme,
        url: url.toString(),
        poToken,
        ustreamerConfig: videoInfo.player_config.media_common_config.media_ustreamer_request_config.video_playback_ustreamer_config,
        clientInfo,
        reload
      }

      const formats = videoInfo.streaming_data.adaptive_formats
      const formatDurations = formats
        .map(format => format.approx_duration_ms / 1000)
        .filter(duration => Number.isFinite(duration) && duration > 0)
      const duration = formatDurations.length > 0
        ? Math.min(...formatDurations)
        : videoInfo.basic_info.duration
      const isLive = !!videoInfo.basic_info.is_live

      let presentationStartTime
      let presentationDelay
      let segmentDuration
      let segmentAvailabilityDuration

      if (isLive) {
        const startTimestamp = videoInfo.basic_info.start_timestamp?.getTime() / 1000
        presentationStartTime = Number.isFinite(duration) && duration > 0
          ? Date.now() / 1000 - duration
          : Number.isFinite(startTimestamp) ? startTimestamp : Date.now() / 1000

        const targetDurations = formats
          .map(format => Number(format.target_duration_dec))
          .filter(targetDuration => Number.isFinite(targetDuration) && targetDuration > 0)
        segmentDuration = targetDurations.length > 0 ? Math.max(...targetDurations) : 1
        // Keep one complete segment buffered ahead of the playhead. Some live
        // SABR responses only contain the segment ending at maxSeekableTime;
        // starting exactly there leaves the player stalled at the buffer edge.
        presentationDelay = segmentDuration * 3

        const dvrDurations = formats
          .map(format => Number(format.max_dvr_duration_sec))
          .filter(dvrDuration => Number.isFinite(dvrDuration) && dvrDuration > 0)
        segmentAvailabilityDuration = dvrDurations.length > 0 ? Math.min(...dvrDurations) : undefined
      }

      /** @type {import('../../helpers/player/SabrManifestParser').SabrManifest} */
      const sabrManifest = {
        scheme,
        // Different formats have different durations and
        // use of slightly longer duration in PresentationTimeline causes player to stuck at the end
        duration,
        isLive,
        presentationStartTime,
        presentationDelay,
        segmentDuration,
        segmentAvailabilityDuration,
        formats: formats.map((format) => ({
          itag: format.itag,
          lastModified: format.last_modified_ms,
          mimeType: format.mime_type,
          xtags: format.xtags,
          bitrate: format.bitrate,
          initRange: format.init_range,
          indexRange: format.index_range,
          width: format.width,
          height: format.height,
          frameRate: format.fps,
          quality: format.quality,
          language: format.language,
          audioSampleRate: format.audio_sample_rate,
          audioChannels: format.audio_channels,
          isDrc: format.is_drc,
          isVoiceBoost: format.is_vb,
          isOriginal: format.is_original,
          isDubbed: format.is_dubbed,
          isAutoDubbed: format.is_auto_dubbed,
          isDescriptive: format.is_descriptive,
          isSecondary: format.is_secondary,
          spatialAudio: !!format.spatial_audio_type,
          label: format.audio_track?.display_name,
          colorTransferCharacteristics: format.color_info?.transfer_characteristics,
          colorPrimaries: format.color_info?.primaries
        })),
        captions: this.captions,
        chapters: this.videoChapters,
        storyboards
      }

      return `data:${MANIFEST_TYPE_SABR},${encodeURIComponent(JSON.stringify(sabrManifest))}`
    },

    createInvidiousDashManifest: async function (result) {
      let url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

      // If we are in Electron,
      // we can use YouTube.js' DASH manifest generator to generate the manifest.
      // Using YouTube.js' gives us support for multiple audio tracks (currently not supported by Invidious)
      if (process.env.SUPPORTS_LOCAL_API) {
        const adaptiveFormats = await this.getAdaptiveFormatsInvidious(result)

        /** @type {import('youtubei.js').Misc.Format[]} */
        const formats = []

        /** @type {import('youtubei.js').Misc.Format[]} */
        const audioFormats = []

        let hasMultipleAudioTracks = false

        for (const format of adaptiveFormats) {
          const localFormat = convertInvidiousToLocalFormat(format)

          if (localFormat.has_audio) {
            audioFormats.push(localFormat)

            if (localFormat.is_dubbed || localFormat.is_descriptive || localFormat.is_secondary || localFormat.is_auto_dubbed) {
              hasMultipleAudioTracks = true
            }
          }

          formats.push(localFormat)
        }

        if (hasMultipleAudioTracks) {
          // match YouTube's local API response with English
          const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })
          for (const format of audioFormats) {
            this.generateAudioTrackFieldInvidious(format, languageNames)
          }
        }

        const manifest = await generateInvidiousDashManifestLocally(formats)

        url = `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(manifest)}`
      } else if (this.proxyVideos) {
        url += '?local=true'
      }

      return url
    },

    /**
     * @param {import('youtubei.js').Misc.Format} format
     * @param {Intl.DisplayNames} languageNames
     */
    generateAudioTrackFieldInvidious: function (format, languageNames) {
      let type

      // use the same id numbers as YouTube (except -1, when we aren't sure what it is)
      let idNumber

      if (format.is_descriptive) {
        type = ' descriptive'
        idNumber = 2
      } else if (format.is_dubbed) {
        type = ''
        idNumber = 3
      } else if (format.is_original) {
        type = ' original'
        idNumber = 4
      } else if (format.is_secondary) {
        type = ' secondary'
        idNumber = 6
      } else if (format.is_auto_dubbed) {
        type = ''
        idNumber = 10
      } else {
        type = ' alternative'
        idNumber = -1
      }

      const languageName = languageNames.of(format.language)

      format.audio_track = {
        audio_is_default: !!format.is_original,
        id: `${format.language}.${idNumber}`,
        display_name: `${languageName}${type}`
      }
    },

    getAdaptiveFormatsInvidious: async function (existingInfoResult = null) {
      let result
      if (existingInfoResult) {
        result = existingInfoResult
      } else {
        result = await invidiousGetVideoInformation(this.videoId)
      }

      result.adaptiveFormats.forEach((format) => {
        format.bitrate = parseInt(format.bitrate)

        // audio streams don't have a size property
        if (typeof format.size === 'string') {
          const [stringWidth, stringHeight] = format.size.split('x')

          format.width = parseInt(stringWidth)
          format.height = parseInt(stringHeight)
        }
      })

      return result.adaptiveFormats
    },

    /**
     * @param {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData} storyboardInfo
     * @returns {string}
     */
    createLocalStoryboardUrls: function (storyboardInfo) {
      const results = buildVTTFileLocally(storyboardInfo, this.videoLengthSeconds)

      return `data:text/vtt;charset=utf-8,${encodeURIComponent(results)}`
    },

    /**
     * @param {import('youtubei.js').YTNodes.PlayerCaptionsTracklist} captions
     * @param {Set<string>} userLanguages
     * @returns {null|{ url: string, label: string, language: string, mimeType: string, isAutotranslated: boolean }}
     */
    getTranslatedLocaleCaption: function (captions, userLanguages) {
      // check if we can translate to the users language
      const translationLanguage = captions.translation_languages.find(language => userLanguages.has(language.language_code))

      let translationName, translationCode
      // Otherwise use the preferred caption locale and hope that YouTube can handle it.
      if (!translationLanguage) {
        translationCode = userLanguages.values().next().value
        translationName = this.$store.getters.getPreferredCaptionLocale
          ? new Intl.DisplayNames([this.currentLocale, 'en'], { type: 'language' }).of(translationCode) ?? translationCode
          : this.t('Locale Name')
      } else {
        translationName = translationLanguage.language_name.text
        translationCode = translationLanguage.language_code
      }

      let trackToTranslate

      const autoGeneratedCaptionTrack = captions.caption_tracks.find(track => track.kind === 'asr')
      if (autoGeneratedCaptionTrack) {
        // Check if there is a user uploaded caption track in the language of the video, as that is more trustworthy than auto-generated captions
        const userUploadedCaptionTrack = captions.caption_tracks.find(track => track.kind !== 'asr' && track.language_code === autoGeneratedCaptionTrack.language_code)

        // Fallback to the auto-generated track if there is no user uploaded one that matches the video language
        trackToTranslate = userUploadedCaptionTrack ?? autoGeneratedCaptionTrack
      } else {
        // if there is no auto-generated track choose the first translatable track
        trackToTranslate = captions.caption_tracks.find(track => track.is_translatable) ?? captions.caption_tracks[0]
      }

      const url = new URL(trackToTranslate.base_url)
      // Requesting fmt=vtt with the tlang parameter set returns HTTP 429 errors, but requesting srt instead seems to work
      url.searchParams.set('fmt', 'srt')
      url.searchParams.set('tlang', translationCode)

      const label = this.t('Video.Player.TranslatedCaptionTemplate', {
        language: translationName,
        originalLanguage: trackToTranslate.name.text
      })

      return {
        id: `${trackToTranslate.vss_id}.${translationCode}`,
        url: url.toString(),
        label,
        language: translationCode,
        mimeType: 'text/srt',
        isAutotranslated: true
      }
    },

    pausePlayer: function () {
      const player = this.$refs.player

      if (player && !player.isPaused()) {
        player.pause()
      }
    },

    getWatchedProgress: function () {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        return player.getCurrentTime()
      }

      return 0
    },

    getTimestamp: function () {
      return Math.floor(this.getWatchedProgress())
    },

    getPlaylistState: function () {
      return this.$refs.watchVideoPlaylist?.getState() ??
        { index: -1, reverse: false, shuffle: false, loop: false }
    },

    updateTitle: function () {
      this.setTabTitle(this.videoTitle || this.getRoutePlaceholderTitle())
    },

    isHiddenVideo: function (forbiddenTitles, channelsHidden, video) {
      return channelsHidden.some(ch => ch.name === video.authorId) ||
        channelsHidden.some(ch => ch.name === video.author) ||
        forbiddenTitles.some((text) => video.title?.toLowerCase().includes(text)) ||
        forbiddenTitles.some((text) => video.author?.toLowerCase().includes(text))
    },

    toggleAutoplay: function() {
      if (this.autoplayEnabled && this.playNextTimeout) {
        this.abortAutoplayCountdown()
      }

      if (this.watchingPlaylist) {
        this.autoplayNextPlaylistVideo = !this.autoplayEnabled
      } else {
        this.autoplayNextRecommendedVideo = !this.autoplayEnabled
      }
    },

    handleSponsorBlockAutoSkipToggle: function(enabled) {
      this.sponsorBlockAutoSkipTemporarilyDisabled = !enabled
    },

    handleSponsorBlockChannelWhitelistToggle: function(whitelisted) {
      if (!this.channelId) {
        return
      }

      const whitelist = new Set(this.sponsorBlockChannelWhitelist)
      if (whitelisted) {
        whitelist.add(this.channelId)
      } else {
        whitelist.delete(this.channelId)
      }

      this.$store.dispatch('updateSponsorBlockChannelWhitelist', [...whitelist])
    },

    updateLocalPlaylistLastPlayedAtSometimes() {
      if (this.selectedUserPlaylist == null) { return }

      const playlist = this.selectedUserPlaylist
      this.updatePlaylistLastPlayedAt({ _id: playlist._id })
    },

    resetAutoplayInterruptionTimeout() {
      clearTimeout(this.autoplayInterruptionTimeout)
      this.autoplayInterruptionTimeout = setTimeout(() => { this.blockVideoAutoplay = true }, this.defaultAutoplayInterruptionIntervalHours * 3_600_000)
      this.blockVideoAutoplay = false
    },

    updatePlaybackRate(newRate) {
      this.currentPlaybackRate = newRate
    },

    /**
     * @param {string} newQuality
     */
    updateVideoQuality(newQuality) {
      this.currentVideoQuality = this.normalizeVideoQuality(newQuality)
    },

    handlePlaybackRateUserSet(newRate) {
      const rememberPerChannel = this.$store.getters.getRememberPlaybackSpeedPerChannel
      const autoUpdate = this.$store.getters.getAutoUpdateChannelPlaybackSpeeds
      if (!rememberPerChannel || !autoUpdate || !this.channelId) {
        return
      }

      this.saveChannelPlaybackSpeed(newRate)
    },

    /**
     * @param {string} newQuality
     */
    handleVideoQualityUserSet(newQuality) {
      const rememberPerChannel = this.$store.getters.getRememberVideoQualityPerChannel
      const autoUpdate = this.$store.getters.getAutoUpdateChannelVideoQualities
      if (!rememberPerChannel || !autoUpdate || !this.channelId) {
        return
      }

      this.saveChannelVideoQuality(newQuality)
    },

    /**
     * @param {string | number | null | undefined} quality
     * @returns {string}
     */
    normalizeVideoQuality(quality) {
      const normalizedQuality = quality == null ? '' : String(quality)

      // TODO: Revert when auto is fixed
      if (normalizedQuality === 'auto') {
        return '720'
      }

      return normalizedQuality
    },

    getDefaultVideoQuality() {
      return this.normalizeVideoQuality(this.$store.getters.getDefaultQuality)
    },

    saveChannelPlaybackSpeed(rate) {
      if (!this.channelId) {
        return
      }

      try {
        const channelSpeeds = JSON.parse(this.$store.getters.getChannelPlaybackSpeeds || '{}')
        channelSpeeds[this.channelId] = rate
        this.$store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(channelSpeeds))
      } catch (e) {
        console.error('Failed to save channel playback speed:', e)
      }
    },

    /**
     * @param {string | number | null | undefined} quality
     * @returns {boolean} whether a channel-specific quality was stored
     */
    saveChannelVideoQuality(quality) {
      if (!this.channelId) {
        return false
      }

      try {
        const channelQualities = JSON.parse(this.$store.getters.getChannelVideoQualities || '{}')
        const normalizedQuality = this.normalizeVideoQuality(quality)
        const defaultQuality = this.getDefaultVideoQuality()

        if (normalizedQuality.length === 0 || normalizedQuality === defaultQuality) {
          delete channelQualities[this.channelId]
          this.$store.dispatch('updateChannelVideoQualities', JSON.stringify(channelQualities))
          return false
        }

        channelQualities[this.channelId] = normalizedQuality
        this.$store.dispatch('updateChannelVideoQualities', JSON.stringify(channelQualities))
        return true
      } catch (e) {
        console.error('Failed to save channel video quality:', e)
        return false
      }
    },

    initializePlaybackRate() {
      if (this.sabrReloadPlaybackRate !== null) {
        this.currentPlaybackRate = this.sabrReloadPlaybackRate
        return
      }

      if (this.videoGenreIsMusic) {
        this.currentPlaybackRate = 1
        return
      }

      const rememberPerChannel = this.$store.getters.getRememberPlaybackSpeedPerChannel
      if (rememberPerChannel && this.channelId) {
        try {
          const channelSpeeds = JSON.parse(this.$store.getters.getChannelPlaybackSpeeds || '{}')
          if (channelSpeeds[this.channelId] !== undefined) {
            this.currentPlaybackRate = channelSpeeds[this.channelId]
            return
          }
        } catch (e) {
          console.error('Failed to parse channel playback speeds:', e)
        }
      }
      this.currentPlaybackRate = this.$store.getters.getDefaultPlayback
    },

    initializeVideoQuality() {
      const rememberPerChannel = this.$store.getters.getRememberVideoQualityPerChannel
      if (rememberPerChannel && this.channelId) {
        try {
          const channelQualities = JSON.parse(this.$store.getters.getChannelVideoQualities || '{}')
          if (channelQualities[this.channelId] !== undefined) {
            this.currentVideoQuality = this.normalizeVideoQuality(channelQualities[this.channelId])
            return
          }
        } catch (e) {
          console.error('Failed to parse channel video qualities:', e)
        }
      }

      this.currentVideoQuality = this.getDefaultVideoQuality()
    },

    destroyPlayer: async function() {
      const uiState = await this.$refs.player.destroyPlayer()
      this.startNextVideoInFullscreen = uiState.startNextVideoInFullscreen
      this.startNextVideoInFullwindow = uiState.startNextVideoInFullwindow
      this.startNextVideoInPip = uiState.startNextVideoInPip
      this.startNextVideoWithChapters = uiState.startNextVideoWithChapters
      this.startNextVideoWithFullscreenComments = uiState.startNextVideoWithFullscreenComments
      this.startNextVideoWithFullscreenPlaylist = uiState.startNextVideoWithFullscreenPlaylist
    },

    async onPlayerReloadRequested(payload, toastMessage = 'Reloading player according to SABR request') {
      this.resumePlaybackAfterSabrReload = payload?.wasPlaying === true
      this.sabrReloadCaptionIndex = Number.isInteger(payload?.captionIndex) ? payload.captionIndex : null
      const playbackRate = Number(payload?.playbackRate)
      this.sabrReloadPlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0.07
        ? playbackRate
        : this.currentPlaybackRate
      this.preserveTitleOnNextReload = true
      this.showTabToast(toastMessage)

      const timestamp = this.getTimestamp()
      if (timestamp > 0) {
        // Reload at the middle should restart at current timestamp
        const reloadLocation = {
          path: this.tabRoute.path,
          query: { ...this.tabRoute.query, oneTimeTimestamp: timestamp },
        }

        if (this.tabRouter.resolve(reloadLocation).fullPath !== this.tabRoute.fullPath) {
          // The route watcher owns this reload. Calling reloadView here as well
          // races two metadata requests and two player teardowns.
          await this.tabRouter.replace(reloadLocation)
          return
        }
      }
      await this.reloadView({ preserveTitle: true })
    },

    onResumePlaybackAfterSabrReloadDone() {
      this.resumePlaybackAfterSabrReload = false
    },

    ...mapActions([
      'updateHistory',
      'updateWatchProgress',
      'updateLastViewedPlaylist',
      'updatePlaylistLastPlayedAt',
      'updateSubscriptionDetails',
    ])
  }
})
