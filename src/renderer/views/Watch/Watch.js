import { parseLocalVideoSummary } from '../../helpers/video-summary.js'
import WatchVideoSummary from '../../components/WatchVideoSummary/WatchVideoSummary.vue'
import FtPhonePanel from '../../components/FtPhonePanel/FtPhonePanel.vue'
import PhoneCommentsButton from '../../components/PhoneCommentsButton/PhoneCommentsButton.vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { holdRootClass } from '../../helpers/rootClasses'
import { connectionEvents, initializeNetworkRecovery, getConnectionState } from '../../helpers/networkRecovery'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { probeHlsManifest } from '../../helpers/player/hlsManifest'
import { releaseAndroidRotationFullscreenHandoff } from '../../helpers/player/androidFullscreen'
import { sampleRecommendationPlayback } from '../../../recommendation-learning'
import { defineComponent, markRaw, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { mapActions } from 'vuex'
import shaka from 'shaka-player'
import { Utils, YTNodes } from 'youtubei.js'
import FtShakaVideoPlayer from '../../components/ft-shaka-video-player/ft-shaka-video-player.vue'
import WatchCast from '../../components/WatchCast/WatchCast.vue'
import { selectCastSource } from '../../helpers/player/castSource'
import WatchVideoDownloadPrompt from '../../components/WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'
import { retainIosMediaSources } from '../../helpers/player/dlnaCast'
import WatchVideoInfo from '../../components/WatchVideoInfo/WatchVideoInfo.vue'
import WatchVideoDescription from '../../components/WatchVideoDescription/WatchVideoDescription.vue'
import WatchVideoTranscript from '../../components/WatchVideoTranscript/WatchVideoTranscript.vue'
import WatchVideoChapters from '../../components/WatchVideoChapters/WatchVideoChapters.vue'
import WatchVideoSponsorBlock from '../../components/WatchVideoSponsorBlock/WatchVideoSponsorBlock.vue'
import CommentSection from '../../components/CommentSection/CommentSection.vue'
import WatchVideoLiveChat from '../../components/WatchVideoLiveChat/WatchVideoLiveChat.vue'
import WatchVideoPlaylist from '../../components/WatchVideoPlaylist/WatchVideoPlaylist.vue'
import WatchVideoQueue from '../../components/WatchVideoQueue/WatchVideoQueue.vue'
import WatchVideoRecommendations from '../../components/WatchVideoRecommendations/WatchVideoRecommendations.vue'
import FtAgeRestricted from '../../components/FtAgeRestricted/FtAgeRestricted.vue'
import FtRetryImage from '../../components/FtRetryImage.vue'
import FtSubscribeButton from '../../components/FtSubscribeButton/FtSubscribeButton.vue'
import FtShareButton from '../../components/FtShareButton/FtShareButton.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtAddToPlaylistDropdown from '../../components/FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import FtPaidPromotionBadge from '../../components/FtPaidPromotionBadge/FtPaidPromotionBadge.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import { calculateColorLuminance } from '../../helpers/colors'
import { applyAnimationSpeed } from '../../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { clampOverlayScrollTop, isOverlayScrollTopOutOfBounds } from '../../helpers/overlayScrollbars'
import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../helpers/history'
import { liveReminder, supportsLiveReminders } from '../../helpers/liveReminders'
import { isOnAiSlopList } from '../../helpers/aiSlopList'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import { navigationDownloadId } from '../../helpers/downloadPlayback'
import { parseLocalVideoGames } from '../../helpers/video-games'
import {
  showInvidiousFallbackToast,
  buildChaptersVttFile,
  buildVTTFileLocally,
  formatDurationAsTimestamp,
  formatNumber,
  getCachedOembedTitle,
  getOembedTitle,
  showApiErrorToast,
  showToast
} from '../../helpers/utils'
import {
  areLocalCommentsDisabled,
  generateAudioTrackField,
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
import {
  sortCaptions,
  MANIFEST_TYPE_DASH,
  MANIFEST_TYPE_HLS
} from '../../helpers/player/utils'
import { normalizeYouTubeCaptionLanguageCode } from '../../helpers/player/youtubeCaptionLanguages'
import {
  findCaptionByLocale,
  getCaptionTranslationSource,
  getPreferredCaption,
  isDubbedCaptionLanguage,
  isSameBaseLanguage
} from '../../../captionLanguages'
import { getYtDlpPlaybackSource, invalidateYtDlpPlaybackSource } from '../../helpers/player/ytDlpPlayback'
import { getMusicTrackArtist, MUSIC_MEDIA_TYPE } from '../../helpers/player/musicMediaType'
import { getYatteeStoryboard, getYatteeStreamExpiry, isYatteeServerPlayableOnAndroid } from '../../helpers/api/yattee'
import { createYatteeDashManifest } from '../../helpers/player/yatteePlayback'
import { usesInvidiousApi } from '../../../apiBackends'
import { getCompatibleAdaptiveFormats } from '../../helpers/player/compatibleAdaptiveFormats'
import { getLiveDvrWindowSeconds } from '../../helpers/player/liveManifest'
import { selectSponsorBlockFullVideoLabel } from '../../helpers/player/sponsorBlockFullVideo'
import { getShortsCompletionState, ShortsPlaybackCache } from '../../helpers/player/shorts'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { useI18n } from 'vue-i18n'
import { useTabAvatar, useTabContext, useTabTitle } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'
import { keepTabLoaded } from '../../tabs/TabResidency'
import { useTabToast } from '../../composables/useTabToast'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { areCommentsAvailable } from './watchComments'
import { watchDownloadedPlaybackComputed, watchDownloadedPlaybackMethods } from './opentubex/watchDownloadedPlayback'
import { watchLiveReminderComputed, watchLiveReminderMethods } from './opentubex/watchLiveReminder'
import { watchPanelMethods } from './opentubex/watchPanels'
import { watchPlaybackPreferencesMethods } from './opentubex/watchPlaybackPreferences'
import {
  SABR_ERROR_RECOVERY_MAX_TICK_SECONDS,
  SABR_ERROR_RECOVERY_SETTLE_SECONDS,
  watchPlaybackRecoveryMethods
} from './opentubex/watchPlaybackRecovery'
import { watchRestrictedPlaybackComputed, watchRestrictedPlaybackMethods } from './opentubex/watchRestrictedPlayback'
import { watchShortsComputed, watchShortsMethods } from './opentubex/watchShorts'
import { watchYtDlpPlaybackComputed, watchYtDlpPlaybackMethods } from './opentubex/watchYtDlpPlayback'
import { getVideoPopularity } from '../../helpers/player/videoPopularity'
import { createWatchTimeTracker } from '../../helpers/watchTimeTracker'

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
 *   }
 * }} SabrData
 */

const THEATRE_MODE_ANIMATION_DURATION = 400
const RESPONSIVE_THEATRE_MODE_MAX_WIDTH = 1350
let nextSabrSchemeId = 0
const UNAVAILABLE_VIDEO_THUMBNAILS = {
  light: 'https://www.youtube.com/img/desktop/unavailable/unavailable_video.png',
  dark: 'https://www.youtube.com/img/desktop/unavailable/unavailable_video_dark_theme.png'
}

export default defineComponent({
  name: 'Watch',
  components: {
    FtRetryImage,
    FtPhonePanel,
    PhoneCommentsButton,
    'ft-shaka-video-player': FtShakaVideoPlayer,
    WatchCast,
    WatchVideoDownloadPrompt,
    'watch-video-info': WatchVideoInfo,
    'watch-video-description': WatchVideoDescription,
    WatchVideoSummary,
    'watch-video-transcript': WatchVideoTranscript,
    'watch-video-chapters': WatchVideoChapters,
    'watch-video-sponsor-block': WatchVideoSponsorBlock,
    CommentSection,
    'watch-video-live-chat': WatchVideoLiveChat,
    'watch-video-playlist': WatchVideoPlaylist,
    'watch-video-queue': WatchVideoQueue,
    'watch-video-recommendations': WatchVideoRecommendations,
    'ft-age-restricted': FtAgeRestricted,
    FtSubscribeButton,
    FtShareButton,
    FtIconButton,
    FtAddToPlaylistDropdown,
    FtPaidPromotionBadge,
    FtButton,
    'ft-loader': FtLoader,
  },
  provide() {
    return {
      phonePanelPlayer: () => this.$refs.player?.$refs.container,
      phonePanelInlinePlayer: () => this.$refs.player?.scrollMiniPlayerActive
        ? this.$refs.player.$refs.scrollMiniPlaceholder
        : this.$refs.player?.$refs.container,
      expandPhonePanel: () => {
        const player = this.$refs.player
        if (!player || player.isPaused()) return null
        const videoId = this.videoId
        player.pause()
        return () => {
          if (this.$refs.player === player && this.videoId === videoId && this.isTabPresented) {
            player.play()?.catch(() => {})
          }
        }
      }
    }
  },
  setup: function () {
    const { t, locale } = useI18n()
    const tabRoute = useRoute()
    const tabRouter = useRouter()
    const { tabId, isTabPresented, lifecycle: tabLifecycle } = useTabContext()
    const setTabTitle = useTabTitle()
    const setTabAvatar = useTabAvatar()
    const showTabToast = useTabToast()
    const relativeTimeNow = useRelativeTimeClock()
    const liveChat = shallowRef(null)

    return {
      t,
      isElectron: process.env.IS_ELECTRON,
      isCapacitor: process.env.IS_CAPACITOR,
      supportsChromecast: process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS),
      phoneLayout: usePhoneLayout(),
      portraitLayout: usePhoneLayout('(orientation: portrait)'),
      currentLocale: locale,
      tabId,
      isTabPresented,
      tabLifecycle,
      tabRoute,
      tabRouter,
      setTabTitle,
      setTabAvatar,
      showTabToast,
      relativeTimeNow,
      liveChat
    }
  },
  data: function () {
    return {
      mobilePanel: null,
      startNextVideoInFullscreen: false,
      startNextVideoInFullwindow: false,
      startNextVideoInPip: false,
      nextVideoAutoPictureInPictureState: null,
      startNextVideoWithChapters: false,
      startNextVideoWithFullscreenMetadata: false,
      startNextVideoWithFullscreenComments: false,
      startNextVideoWithFullscreenLiveChat: false,
      startNextVideoWithFullscreenPlaylist: false,
      startNextVideoWithFullscreenQueue: false,
      startNextVideoWithFullscreenRecommendations: false,
      isLoading: true,
      firstLoad: true,
      // Whether this tab has been presented while showing the current video. A
      // watch tab loading a video in the background briefly attempts to autoplay
      // and is force-paused, which would otherwise persist a ~1 second resume
      // point for a video the user never actually watched. We only save watch
      // progress once the tab is presented, and re-evaluate this per video
      // because the instance is reused across same-tab navigation.
      hasBeenPresented: false,
      useTheatreMode: false,
      theatreModeToggledManually: false,
      // Same-tab navigation keeps the current layout while its skeleton loads.
      // A newly mounted watch tab falls back to the configured default instead.
      loadingTheatreMode: null,
      applyDefaultTheatreModeAfterLoad: false,
      theatreLayoutAvailable: window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH,
      videoPlayerLoaded: false,
      /** @type {boolean|null} */
      isFamilyFriendly: null,
      commentsDisabled: false,
      commentsLoaded: false,
      commentPreviews: [],
      liveChatLoaded: false,
      transcriptLoaded: false,
      isLive: false,
      /** @type {boolean | null} */
      isLiveDvrEnabled: null,
      isPremiere: false,
      liveChatIsReplay: false,
      liveChatOpen: true,
      isLiveContent: false,
      isUpcoming: false,
      isPostLiveDvr: false,
      /** @type {{ videoId: string, context: import('googlevideo/protos').ReloadPlaybackContext } | null} */
      pendingSabrReloadContext: null,
      isUnlisted: false,
      isShort: false,
      useCustomShortsPlayerForCurrentVideo: false,
      videoAspectRatio: null,
      shortsLinkedVideo: null,
      shortsSwipePointer: null,
      shortsSwipePresentationTarget: null,
      shortsSwipeOffset: 0,
      shortsSwipeHeight: 0,
      shortsSwipeDirection: 0,
      shortsSwipePreview: '',
      shortsSwipeSettling: false,
      shortsSwipeAnimations: markRaw([]),
      shortsSwipeSuppressClick: false,
      shortsNavigationLockedUntil: 0,
      shortsLastWindowScrollY: window.scrollY,
      shortsScrollResetPending: false,
      shortsTransitionPreview: '',
      shortsTransitionDirection: 0,
      shortsViewportHeight: window.innerHeight,
      shortsPlaybackCompleted: false,
      shortsCompletionBlockedBySeek: false,
      shortsPlaybackAfterSeekSeconds: 0,
      shortsPlaybackCache: markRaw(new ShortsPlaybackCache()),
      shortsPreloadGeneration: 0,
      shortsPlayerCacheGeneration: 0,
      videoLoadGeneration: 0,
      playerLoadGeneration: 0,
      preparingVideoLoadGeneration: null,
      hasAiGeneratedContent: false,
      contentDisclosures: null,
      hasPaidPromotion: false,
      paidPromotionDurationMs: 10000,
      upcomingTimestamp: null,
      upcomingTimeLeft: null,
      supportsLiveReminders,
      liveReminderActive: false,
      liveReminderLoading: false,
      liveReminderNow: Date.now(),
      liveReminderStartTimer: null,
      removeLiveReminderUpdatedListener: null,
      removeVideoMetadataCacheClearedListener: null,
      /** @type {'dash' | 'audio' | 'legacy'} */
      activeFormat: 'legacy',
      /** @type {'dash' | 'legacy' | null} */
      localFilePlayback: false,
      downloadedPlaybackWithoutMetadata: false,
      downloadedMetadataLoading: false,
      isOffline: getConnectionState() === 'offline',
      thumbnail: '',
      videoId: '',
      videoTitle: '',
      hasResolvedVideoTitle: false,
      videoDescription: '',
      videoSummary: [],
      videoDescriptionHtml: '',
      videoMetadataHistory: null,
      videoCategory: '',
      videoTags: [],
      /** @type {import('../../helpers/video-games').LocalVideoGame[]} */
      videoGames: [],
      license: '',
      videoViewCount: null,
      videoLikeCount: null,
      videoDislikeCount: null,
      videoLengthSeconds: 0,
      videoChapters: [],
      videoPopularity: [],
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
      /**
       * Which engine provided the streams that are currently loaded.
       * @type {'built-in' | 'yt-dlp'}
       */
      activePlaybackEngine: 'built-in',
      /** @type {string | null} the yt-dlp version that extracted the current streams */
      activePlaybackEngineVersion: null,
      /**
       * The online streams stay cached while a downloaded file is selected so
       * changing playback sources does not have to reload the watch page.
       * @type {{
       *   manifestSrc: string | null,
       *   manifestMimeType: MANIFEST_TYPE_DASH | MANIFEST_TYPE_HLS | MANIFEST_TYPE_SABR,
       *   sabrData: SabrData | null,
       *   legacyFormats: object[],
       *   streamingDataExpiryDate: Date | null,
       *   activeFormat: 'dash' | 'audio' | 'legacy',
       *   activePlaybackEngine: 'built-in' | 'yt-dlp',
       *   activePlaybackEngineVersion: string | null,
       *   hasBeenLoaded: boolean
       * } | null}
       */
      onlinePlaybackSource: null,
      playbackSourceKey: 0,
      localPlaybackDownloadId: null,
      localPlaybackFilePath: null,
      sabrPlaybackLoaded: false,
      /** @type {{
       *   manifestSrc: string | null,
       *   manifestMimeType: MANIFEST_TYPE_DASH | MANIFEST_TYPE_HLS | MANIFEST_TYPE_SABR,
       *   sabrData: SabrData | null,
       *   legacyFormats: object[],
       *   streamingDataExpiryDate: Date | null
       * } | null}
       */
      builtInPlaybackSource: null,
      playbackEngineFallbackAttemptedForCurrentVideo: false,
      /** @type {'built-in' | 'yt-dlp' | null} */
      playbackEngineFallbackTarget: null,
      playbackEngineSwitchGeneration: 0,
      // yt-dlp is a separate process that takes a while to extract the streams. The
      // metadata is already there at that point, so the rest of the page is shown
      // immediately and only the player waits behind a thumbnail placeholder.
      ytDlpStreamsPending: false,
      vrStreamsPending: false,
      ytDlpDefaultClientsFallbackToastShown: false,
      legacyFormats: [],
      chromecastActive: false,
      chromecastBusy: false,
      dlnaCastActive: false,
      chromecastStatus: null,
      captions: [],
      captionTranslations: [],
      currentTime: 0,
      liveChatSeekRequest: null,
      showTranscript: false,
      showSidebarChapters: false,
      showSidebarSponsorBlock: false,
      sidebarPanelLeaving: false,
      sponsorBlockInfoLoading: false,
      sponsorBlockInfoPendingUuid: null,
      sponsorBlockInfoSegments: [],
      sponsorBlockInfoSubmissionEnabled: false,
      sponsorBlockContributionStats: null,
      sponsorBlockContributionStatsError: false,
      sponsorBlockContributionStatsLoaded: false,
      sponsorBlockContributionStatsLoading: false,
      videoChapterThumbnails: [],
      fullscreenMetadataOpen: false,
      shortsMetadataOpen: false,
      shortsCommentsOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenMetadataTarget: null,
      fullscreenTranscriptOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenTranscriptTarget: null,
      fullscreenSponsorBlockOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenSponsorBlockTarget: null,
      fullscreenCommentsOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenCommentsTarget: null,
      fullscreenLiveChatOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenLiveChatTarget: null,
      showDownloadPrompt: false,
      fullscreenQueueOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenQueueTarget: null,
      queueScrollPositions: { sidebar: 0, fullscreen: 0 },
      fullscreenRecommendationsOpen: false,
      /** @type {HTMLElement|null} */
      fullscreenRecommendationsTarget: null,
      recommendationsScrollTop: 0,
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
      upcomingPlaylistVideos: [],
      watchingPlaylist: false,
      playlistSkipAvailability: { canPlayNext: true, canPlayPrevious: true },
      playlistId: '',
      playlistType: '',
      playlistItemId: null,
      /** @type {number|null} */
      timestamp: null,
      // This should never be saved into history
      /** @type {number|null} */
      oneTimeTimestamp: null,
      playNextTimeout: null,
      queuedPlaybackVideoId: null,
      playNextCountDownIntervalId: null,
      autoplayCountdown: null,
      waitingForPlaylistContinuation: false,
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
      /** @type {'age' | 'members' | null} */
      restrictedPlaybackError: null,
      /** @type {'private' | 'drm' | null} */
      nonRetryablePlaybackError: null,
      skipUnavailablePlaylistVideo: false,
      videoGenreIsMusic: false,
      /** @type {(typeof MUSIC_MEDIA_TYPE)[keyof typeof MUSIC_MEDIA_TYPE]} */
      musicMediaType: MUSIC_MEDIA_TYPE.UNKNOWN,
      /** @type {Date|null} */
      streamingDataExpiryDate: null,
      currentPlaybackRate: null,
      currentVideoQuality: null,
      /** @type {boolean|null} */
      currentSubtitlesState: null,
      /** @type {number|null} */
      currentVolume: null,

      // Local, non-persistent toggle for temporarily disabling SponsorBlock auto-skipping
      sponsorBlockAutoSkipTemporarilyDisabled: false,

      // When true, the new player after a SABR reload should start playback (was playing before reload)
      resumePlaybackAfterSabrReload: false,
      // When true, the new player after a SABR reload must ignore the normal autoplay setting.
      suppressAutoplayAfterSabrReload: false,
      playerTeardownInProgress: false,
      sabrReloadState: null,
      preserveTitleOnNextReload: false,
      ipBlockDetectedInCurrentChain: false,
      ipBlockRecoveryAttemptedForCurrentVideo: false,
      androidHttpErrorRecoveryAttemptedForCurrentVideo: false,
      streamErrorReloadAttemptedForCurrentVideo: false,
      sabrErrorRecoveryAttempts: 0,
      sabrErrorRecoveriesForCurrentVideo: 0,
      /** @type {number|null} */
      sabrErrorRecoveryLastSeconds: null,
      sabrErrorRecoveryPlayedSeconds: 0,
      recommendationPlaybackSample: null,
      recommendationWatchSession: null,
      recommendationLoadRetryAt: 0,
      historyLastTouchedAt: 0,
      /** @type {Set<string>} videos whose watched mark is still being written */
      watchedMarkPendingVideoIds: new Set(),
    }
  },
  computed: {
    castingActive() {
      return this.chromecastActive || this.dlnaCastActive
    },
    phonePanelsEnabled() {
      return this.phoneLayout && !this.customShortsPlayerActive && !this.fullscreenMetadataOpen &&
        !this.fullscreenCommentsOpen && !this.fullscreenTranscriptOpen && !this.fullscreenLiveChatOpen
    },
    isMusicVideo: function () {
      // Lists pass on YouTube's music badge, which also covers music videos outside the Music category
      return this.videoGenreIsMusic || this.tabRoute.query.musicVideo === 'true'
    },
    musicPlayerArtist: function () {
      return this.musicMediaType === MUSIC_MEDIA_TYPE.AUDIO_TRACK
        ? getMusicTrackArtist(this.channelName)
        : this.channelName
    },
    dateFormatPreference: function () {
      return this.$store.getters.getDateFormat
    },
    timeFormatPreference: function () {
      return this.$store.getters.getTimeFormat
    },
    ...watchDownloadedPlaybackComputed,
    ...watchLiveReminderComputed,
    sponsorBlockFullVideoCategory: function () {
      return selectSponsorBlockFullVideoLabel(this.sponsorBlockInfoSegments)?.category ?? null
    },
    // Descriptions are omitted from saved playlist entries.
    addToPlaylistVideoData: function () {
      return {
        videoId: this.videoId,
        title: this.videoTitle,
        author: this.channelName,
        authorId: this.channelId,
        lengthSeconds: this.videoLengthSeconds,
        published: this.videoPublished,
        ...(this.videoViewCount != null ? { viewCount: this.videoViewCount } : {}),
        premiereDate: this.premiereDate
      }
    },
    historyEntry: function () {
      return this.$store.getters.getHistoryCacheById[this.videoId]
    },
    historyEntryExists: function () {
      return typeof this.historyEntry !== 'undefined'
    },
    quickBookmarkPlaylist: function () {
      return this.$store.getters.getQuickBookmarkPlaylist
    },
    quickBookmarkIcon: function () {
      return this.$store.getters.getQuickBookmarkIcon
    },
    isQuickBookmarkEnabled: function () {
      return this.quickBookmarkPlaylist != null
    },
    isCurrentVideoQuickBookmarked: function () {
      return this.$store.getters.getQuickBookmarkVideoIds.has(this.videoId)
    },
    quickBookmarkIconText: function () {
      if (!this.isQuickBookmarkEnabled) { return '' }

      const translationProperties = {
        playlistName: this.quickBookmarkPlaylist.playlistName
      }
      return this.isCurrentVideoQuickBookmarked
        ? this.$t('User Playlists.Remove from Favorites', translationProperties)
        : this.$t('User Playlists.Add to Favorites', translationProperties)
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
    enableVideoMetadataCache: function () {
      return process.env.IS_ELECTRON && this.$store.getters.getEnableVideoMetadataCache
    },
    watchStatsResetVersion: function () {
      return this.$store.getters.getWatchStatsResetVersion
    },
    watchedProgressSavingEnabled: function () {
      return this.$store.getters.getWatchedProgressSavingMode !== 'never'
    },
    watchedPercentageThreshold: function () {
      return this.$store.getters.getWatchedPercentageThreshold
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
    apiServerUrl: function () {
      return this.$store.getters.getApiServerUrl
    },
    proxyVideos: function () {
      return this.$store.getters.getProxyVideos
    },
    ...watchRestrictedPlaybackComputed,
    defaultAutoplayInterruptionIntervalHours: function () {
      return this.$store.getters.getDefaultAutoplayInterruptionIntervalHours
    },
    defaultInterval: function () {
      return this.$store.getters.getDefaultInterval
    },
    defaultViewingMode: function () {
      const mode = this.$store.getters.getDefaultViewingMode
      return process.env.IS_CAPACITOR && ['external_player', 'fullscreen', 'fullscreen_always_on', 'fullwindow', 'fullwindow_always_on', 'pip'].includes(mode)
        ? 'default'
        : mode
    },
    autoOpenChapters: function () {
      return !process.env.IS_CAPACITOR && this.$store.getters.getAutoOpenChapters
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
    transcriptAvailable: function () {
      return this.captions.length > 0 && (!this.isOffline || this.transcriptLoaded)
    },
    ambientModeActive: function () {
      return this.$store.getters.getAmbientMode &&
        this.activeFormat !== 'audio' &&
        this.vrProjection !== 'EQUIRECTANGULAR'
    },
    ...watchShortsComputed,
    hideUploader: function () {
      return this.$store.getters.getHideUploader
    },
    disableChannelLinks: function () {
      return this.$store.getters.getDisableChannelLinks
    },
    hideUnsubscribeButton: function () {
      return this.$store.getters.getHideUnsubscribeButton
    },
    hideSharingActions: function () {
      return this.$store.getters.getHideSharingActions
    },
    showPlaylists: function () {
      return !this.$store.getters.getHidePlaylists
    },
    isInAnyPlaylist: function () {
      return this.$store.getters.getPlaylistVideoCounts.has(this.videoId)
    },
    defaultVideoFormat: function () {
      return this.$store.getters.getDefaultVideoFormat
    },
    ...watchYtDlpPlaybackComputed,
    /** @returns {'sabr' | 'dash' | 'hls' | 'none'} */
    playbackStreamType: function () {
      if (this.manifestSrc === null || this.activeFormat === 'legacy') {
        return 'none'
      }

      switch (this.manifestMimeType) {
        case MANIFEST_TYPE_SABR:
          return 'sabr'
        case MANIFEST_TYPE_HLS:
          return 'hls'
        default:
          return 'dash'
      }
    },
    dashFormatAvailable: function () {
      return this.manifestSrc !== null
    },
    legacyFormatAvailable: function () {
      return !this.isLive && !this.isPostLiveDvr && this.legacyFormats.length > 0
    },
    audioFormatAvailable: function () {
      if (this.manifestSrc === null) {
        return false
      }

      // The WEB HLS manifests only contain combined audio and video files, so we can't do audio only.
      // The IOS HLS manifests have audio-only streams
      return !((this.isLive || this.isPostLiveDvr) &&
        this.manifestMimeType === MANIFEST_TYPE_HLS &&
        !this.manifestSrc.includes('/demuxed/1'))
    },
    autoplayEnabled: function () {
      if (this.isStandaloneShort) { return false }
      if (this.nextQueuedVideo) { return true }
      return this.watchingPlaylist ? this.autoplayNextPlaylistVideo : this.autoplayNextRecommendedVideo
    },
    nextQueuedVideo: function () {
      return this.$store.getters.getNextQueuedVideo
    },
    thumbnailPreference: function () {
      return this.$store.getters.getThumbnailPreference
    },
    /** Thumbnail to show in toasts about this video, omitted when thumbnails are hidden */
    toastThumbnail: function () {
      return this.thumbnailPreference === 'hidden' ? null : this.thumbnail
    },
    autoplayNextRecommendedVideoByDefault: function () {
      return this.$store.getters.getPlayNextVideo
    },
    autoplayNextPlaylistVideoByDefault: function () {
      return this.$store.getters.getAutoplayPlaylists
    },
    downloadAvailable() {
      return !this.isOffline && !this.isUpcoming && supportsYtDlp && this.$store.getters.getEnableDownloads
    },
    fullscreenRecommendationsAvailable() {
      if (this.isLoading || this.hideRecommendedVideos || (this.isFamilyFriendly === false && this.showFamilyFriendlyOnly)) return false
      if (this.isOffline) return this.offlineDownloadSuggestions.length > 0
      return this.recommendedVideos.some(video => !isVideoHiddenByPreferences(video, {
        hiddenChannelNames: this.$store.getters.getActiveChannelsHiddenNames,
        aiSlopChannels: this.$store.getters.getAiSlopBlockedChannels,
        forbiddenTitles: this.$store.getters.getActiveForbiddenTitles,
        hideChannelsBasedOnText: false,
      }))
    },
    hideRecommendedVideos: function () {
      return this.$store.getters.getHideRecommendedVideos
    },
    hideEndScreenRecommendations: function () {
      return this.$store.getters.getHideEndScreenRecommendations
    },
    hideEndScreenAnnotations: function () {
      return this.$store.getters.getHideEndScreenAnnotations
    },
    hidePaidPromotion: function () {
      return this.$store.getters.getHidePaidPromotion
    },
    showPaidPromotion: function () {
      return this.hasPaidPromotion && !this.hidePaidPromotion
    },
    hideLiveChat: function () {
      return this.$store.getters.getHideLiveChat
    },
    hideLiveChatReplay: function () {
      return this.$store.getters.getHideLiveChatReplay
    },
    liveChatAvailable: function () {
      if (this.isOffline && !this.liveChatLoaded) return false
      return this.liveChatIsReplay
        ? !this.hideLiveChatReplay
        : !this.hideLiveChat && (this.isLive || this.isUpcoming)
    },
    showLiveChat: function () {
      return this.liveChatAvailable && this.liveChatOpen
    },
    // The player reports its position about four times a second, but a chat replay
    // buffers 20 seconds ahead and releases messages at one-second intervals.
    // Rounding keeps the chat from re-rendering its message list on every tick.
    liveChatCurrentTime: function () {
      return Math.floor(this.currentTime)
    },
    hideComments: function () {
      return this.$store.getters.getHideComments
    },
    commentsAvailable: function () {
      return areCommentsAvailable(this)
    },
    aiVideoSummaryMode: function () {
      return this.$store.getters.getAiVideoSummaryMode
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
      return this.showTranscript || (!this.hideRecommendedVideos && (!this.isOffline || this.displayedRecommendations.length > 0)) ||
        this.showLiveChat || this.watchingPlaylist || !!this.nextQueuedVideo ||
        this.showSidebarChapters || this.showSidebarSponsorBlock
    },
    theatreTogglePossible: function () {
      return this.theatreLayoutAvailable && this.theatrePossible
    },
    canSkipToNextVideo: function () {
      // The watch queue takes precedence over the playlist and works without one,
      // see `handleSkipToNext`
      return !!this.nextQueuedVideo || (this.watchingPlaylist && this.playlistSkipAvailability.canPlayNext)
    },
    canSkipToPreviousVideo: function () {
      // Only a playlist has a previous video, see `handleSkipToPrev`
      return this.watchingPlaylist && this.playlistSkipAvailability.canPlayPrevious
    },
    autoplayPossible: function () {
      return !this.isStandaloneShort && (
        !!this.nextQueuedVideo ||
        (!this.watchingPlaylist && !this.hideRecommendedVideos && !!this.nextRecommendedVideo) ||
        (this.watchingPlaylist && !this.$refs.watchVideoPlaylist?.shouldStopDueToPlaylistEnd)
      )
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
      return this.$store.getters.getActiveChannelsHidden
    },
    forbiddenTitles() {
      return this.$store.getters.getActiveForbiddenTitles
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
    endScreenRecommendations: function () {
      if (this.hideRecommendedVideos || this.hideEndScreenRecommendations) return []
      return this.recommendedVideos.filter(video =>
        video.videoId && video.videoId !== this.videoId &&
        !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
      ).slice(0, 6)
    },
    nextRecommendedVideo: function () {
      if (this.isOffline) return undefined
      return this.recommendedVideos.find((video) =>
        !this.isHiddenVideo(this.forbiddenTitles, this.channelsHidden, video)
      )
    },
    musicMode() {
      return this.$store.getters.getTabMusicMode(this.tabId ?? 'web')
    },
    startTimeSeconds: function () {
      if (this.isLoading || this.isLive) {
        return null
      }

      const shortPosition = !this.musicMode && this.customShortsPlayerActive && this.tabRoute.query.shortSource
        ? this.shortsPlaybackCache.getPosition(this.videoId)
        : 0
      if (shortPosition > 0 && shortPosition < this.videoLengthSeconds) {
        return shortPosition
      }

      if (this.oneTimeTimestamp !== null && this.oneTimeTimestamp < this.videoLengthSeconds) {
        return this.oneTimeTimestamp
      } else if (this.timestamp !== null && this.timestamp < this.videoLengthSeconds) {
        return this.timestamp
      } else if (this.musicMode) {
        return 0
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

    /**
     * The metadata is rendered as soon as the backend responds, but the player can
     * only be created once the streams it is supposed to play are known.
     */
    playerReady() {
      if (this.isLoading || this.ytDlpStreamsPending || (this.vrStreamsPending && !this.isYtDlpPlaybackRequested())) {
        return false
      }

      return this.activeFormat === 'legacy'
        ? this.legacyFormats.length > 0
        : this.manifestSrc !== null
    },

    canSaveWatchProgress() {
      if (this.isUpcoming || this.isLive) { return false }

      // `this.$refs.player?.hasLoaded` cannot be used in computed property.
      // While the streams are still being extracted there is no player to read a
      // position from, so the manual save action must not be offered yet either.
      return this.playerReady
    },
    useSponsorBlock: function () {
      return (!this.isOffline || this.sponsorBlockInfoSegments.length > 0) && this.$store.getters.getUseSponsorBlock
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
    castingActive(active) {
      // Unloading this tab under memory pressure would stop the cast.
      keepTabLoaded(this.tabId, 'casting', active)
    },
    // Ambient light extends past the layout, so the app clips its overflow.
    ambientModeActive: {
      handler(active) {
        if (active && !this.releaseAmbientModeClass) this.releaseAmbientModeClass = holdRootClass('appAmbientMode')
        else if (!active && this.releaseAmbientModeClass) {
          this.releaseAmbientModeClass()
          this.releaseAmbientModeClass = null
        }
      },
      immediate: true
    },
    downloadAvailable(available) {
      if (!available) this.showDownloadPrompt = false
    },
    videoId() {
      this.showDownloadPrompt = false
      this.resetShortsSwipe()
    },
    '$store.getters.getThumbnailDataSaver'() {
      const short = this.currentSubscriptionShort
      if (short?.thumbnailUrl && short.lowResolutionThumbnailUrl) {
        this.updateShortThumbnail()
      }
    },
    '$store.getters.getWatchQueueLength'(length) {
      if (length === 0 && this.mobilePanel === 'queue') this.mobilePanel = null
    },
    errorMessage(error) {
      if (error) {
        console.error(`Showing error for ${this.videoId}: ${error}`)
        if (process.env.IS_ELECTRON) {
          window.ftElectron?.tabs?.setPlaybackState('failed', this.tabId)
        }
      }
    },
    aiVideoSummaryMode() {
      if (this.videoSummary.length > 0) this.clampShortsAuxPanelScroll()
    },
    videoSummary(summary, previousSummary) {
      if (previousSummary.length > 0 && this.aiVideoSummaryMode !== 'hide') this.clampShortsAuxPanelScroll()
    },
    currentLocale: 'updateUpcomingTimestamp',
    dateFormatPreference: 'updateUpcomingTimestamp',
    timeFormatPreference: 'updateUpcomingTimestamp',
    theatrePossible(possible, wasPossible) {
      // With theatre as the default, the first panel opened on a page without
      // sidebar content appears below the video instead of beside it, unless
      // the user has chosen a layout.
      if (possible && !wasPossible && !this.isLoading && this.theatreLayoutAvailable &&
        !this.theatreModeToggledManually && this.defaultViewingMode === 'theatre') {
        this.useTheatreMode = true
      }
    },
    isLoading(loading) {
      if (!loading) {
        // Upcoming videos without a trailer never mount a player to report a
        // playback state. Their settled page must still release startup tabs.
        if (process.env.IS_ELECTRON && this.isUpcoming && this.playabilityStatus !== 'OK') {
          window.ftElectron?.tabs?.setPlaybackState('paused', this.tabId)
        }
        this.updateVideoMetadataCache()

        if (!this.transcriptAvailable && this.showTranscript) {
          this.closeTranscript()
        }

        this.loadingTheatreMode = null
        this.shortsTransitionPreview = ''
        this.shortsTransitionDirection = 0

        if (this.shortsMetadataOpen) {
          this.clampShortsAuxPanelScroll()
        }

        if (this.applyDefaultTheatreModeAfterLoad) {
          this.applyDefaultTheatreModeAfterLoad = false
          this.useTheatreMode = this.theatreTogglePossible
        }
      }
    },
    isTabPresented: {
      immediate: true,
      handler() {
        if (this.isCurrentlyPresented()) {
          this.hasBeenPresented = true
        } else {
          this.mobilePanel = null
        }
      }
    },
    async 'tabRoute.fullPath'(fullPath, previousFullPath) {
      if (
        !('timestamp' in this.tabRoute.query) &&
        this.watchRouteWithoutTimestamp(fullPath) ===
          this.watchRouteWithoutTimestamp(previousFullPath)
      ) {
        return
      }

      if (
        this.playbackSourceRouteBase(fullPath) ===
        this.playbackSourceRouteBase(previousFullPath)
      ) {
        const downloadId = Number(this.tabRoute.query.downloadId)
        if (Number.isInteger(downloadId)) {
          const filePath = this.tabRoute.query.downloadFilePath ?? null
          if ((downloadId !== this.localPlaybackDownloadId || filePath !== this.localPlaybackFilePath) &&
            !this.applyDownloadedPlaybackSource(downloadId)) {
            await this.reloadView()
          }
        } else if (this.localFilePlayback && !this.restoreOnlinePlaybackSource()) {
          await this.reloadView()
        }
        return
      }
      await this.reloadView()
    },
    userPlaylistsReady() {
      this.onMountedDependOnLocalStateLoading()
    },
    enableWatchStats(enabled) {
      if (!enabled) {
        this.watchTimeTracker.clear()
      }
    },
    enableVideoMetadataCache(enabled) {
      if (enabled && !this.isLoading) {
        this.updateVideoMetadataCache()
      } else if (!enabled) {
        this.videoMetadataHistory = null
      }
    },
    rememberHistory(enabled) {
      if (!enabled) {
        this.watchTimeTracker.clear()
      }
    },
    watchStatsResetVersion() {
      this.watchTimeTracker.clear()
    },
    canSkipToNextVideo() {
      this.syncMediaSessionSkipHandlers()
    },
    canSkipToPreviousVideo() {
      this.syncMediaSessionSkipHandlers()
    },
    upcomingYtDlpPreloadVideoIds: {
      immediate: true,
      handler(videoIds) {
        this.preloadUpcomingYtDlpPlaybackSources(videoIds)
      }
    },
    shortsPreloadKey: {
      immediate: true,
      handler() {
        this.preloadShortsPlaybackWindow().catch(error => {
          console.warn('Could not preload nearby Shorts', error)
        })
      }
    },
  },
  created: function () {
    this.watchTimeTracker = createWatchTimeTracker(
      () => this.rememberHistory && this.enableWatchStats && !this.isPlaybackPaused() && !this.chromecastStatus?.buffering,
      (date, seconds) => this.$store.dispatch('recordWatchTime', { date, seconds })
    )
    retainIosMediaSources(() => this.legacyFormats.map(format => format.url))
    this.theatreModeAnimations = []
    this.videoId = this.tabRoute.params.id
    this.isShort = this.tabRoute.query.short === 'true'
    this.useCustomShortsPlayerForCurrentVideo = this.$store.getters.getUseCustomShortsPlayer
    this.videoAspectRatio = this.isShort ? 9 / 16 : null
    this.activeFormat = this.defaultVideoFormat
    // So that the value for this session remains unchanged even if setting changed
    this.autoplayNextRecommendedVideo = this.autoplayNextRecommendedVideoByDefault
    this.autoplayNextPlaylistVideo = this.autoplayNextPlaylistVideoByDefault

    this.checkIfTimestamp()
    this.initializePlaybackRate()
    this.initializeVideoQuality()
  },
  mounted: function () {
    connectionEvents.addEventListener('change', this.handleDownloadConnectionChange)
    this.isOffline = getConnectionState() === 'offline'
    document.addEventListener('keydown', this.handleShortsNavigationKeydown, true)
    window.addEventListener('resize', this.updateShortsViewportHeight)
    window.addEventListener('resize', this.updateTheatreLayoutAvailability)
    window.addEventListener('scroll', this.handleShortsWindowScroll, { passive: true })
    this.removeTabLifecycle = this.tabLifecycle?.register(this.tabId, {
      activate: this.activateWatchRuntime,
      deactivate: this.deactivateWatchRuntime,
      beforeNavigate: this.cleanupWatchRuntime,
      beforeReload: this.cleanupWatchRuntime,
      beforeDispose: this.cleanupWatchRuntime
    })
    this.syncMediaSessionSkipHandlers()
    this.removeLiveReminderUpdatedListener = liveReminder.onUpdated((videoId, scheduled) => {
      if (videoId === this.videoId) {
        this.liveReminderActive = scheduled
      }
    })
    this.removeVideoMetadataCacheClearedListener = window.ftElectron?.videoMetadataCache?.onCleared?.(() => {
      this.videoMetadataHistory = null
    }) ?? null
    this.onMountedDependOnLocalStateLoading()
  },
  updated: function () {
    requestAnimationFrame(() => this.clampShortsErrorScroll())
    const rail = this.$refs.shortsActionRail
    if (!rail?.scrollTop) return
    const contentEnd = rail.querySelector(':scope > .shortsSoundThumbnail, :scope > .shortsSkeletonSound') ??
      [...rail.querySelectorAll(':scope > .shortsAction')].at(-1) ?? null
    if (isOverlayScrollTopOutOfBounds(rail, contentEnd)) clampOverlayScrollTop(rail, contentEnd)
  },
  beforeUnmount: function () {
    keepTabLoaded(this.tabId, 'casting', false)
    this.releaseAmbientModeClass?.()
    this.releaseAmbientModeClass = null
    connectionEvents.removeEventListener('change', this.handleDownloadConnectionChange)
    document.removeEventListener('keydown', this.handleShortsNavigationKeydown, true)
    window.removeEventListener('resize', this.updateShortsViewportHeight)
    window.removeEventListener('resize', this.updateTheatreLayoutAvailability)
    window.removeEventListener('scroll', this.handleShortsWindowScroll)
    this.theatreModeAnimations.forEach(animation => animation.cancel())
    this.clearLiveReminderStartTimer()
    this.removeLiveReminderUpdatedListener?.()
    this.removeLiveReminderUpdatedListener = null
    this.removeVideoMetadataCacheClearedListener?.()
    this.removeVideoMetadataCacheClearedListener = null
    if ('mediaSession' in navigator) {
      tabMediaCoordinator.setActionHandlers(this.tabId ?? 'web', 'playlist', {})
    }
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
  unmounted: function () {
    // The player hands Android rotation fullscreen over during unmount.
    releaseAndroidRotationFullscreenHandoff(this.$el)
  },
  methods: {
    handleUpcomingPlaylistVideosChange(videos) {
      this.upcomingPlaylistVideos = Array.isArray(videos) ? videos : []
      if (this.waitingForPlaylistContinuation && (this.upcomingPlaylistVideos.length > 0 ||
        this.$refs.watchVideoPlaylist?.isFetchingPlaylistContinuation === false)) {
        this.waitingForPlaylistContinuation = false
        this.handleVideoEnded()
      }
    },
    async updateVideoMetadataCache() {
      if (
        !this.enableVideoMetadataCache ||
        this.isLoading ||
        !this.hasResolvedVideoTitle ||
        (this.localFilePlayback && !this.channelId) ||
        typeof window.ftElectron?.videoMetadataCache?.update !== 'function'
      ) {
        return
      }

      const loadGeneration = this.videoLoadGeneration
      const videoId = this.videoId

      try {
        const history = await window.ftElectron.videoMetadataCache.update({
          videoId,
          title: this.videoTitle,
          description: this.videoDescription ?? '',
          thumbnailUrl: this.thumbnail ?? '',
          observedAt: Date.now()
        })

        if (
          this.isCurrentVideoLoad(loadGeneration, videoId) &&
          this.enableVideoMetadataCache
        ) {
          this.videoMetadataHistory = history
        }
      } catch (error) {
        console.error('Failed to update the video metadata cache', error)
      }
    },

    ...watchLiveReminderMethods,
    updateTheatreLayoutAvailability() {
      this.theatreLayoutAvailable = window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH
    },
    ...watchPanelMethods,
    openVideoDownloadPrompt() {
      if (this.downloadAvailable) this.showDownloadPrompt = true
    },
    async toggleCurrentVideoQuickBookmarked() {
      if (!this.isQuickBookmarkEnabled) { return }

      const playlistName = this.quickBookmarkPlaylist.playlistName

      if (this.isCurrentVideoQuickBookmarked) {
        const removed = await this.$store.dispatch('removeVideo', {
          _id: this.quickBookmarkPlaylist._id,
          videoId: this.videoId
        })
        showToast({
          message: removed
            ? this.$t('Video.Video has been removed from {playlistName}', { playlistName })
            : this.$t('Video.There was a problem removing the video from {playlistName}', { playlistName }),
          image: this.toastThumbnail,
          icon: ['fas', 'trash'],
        })
        return
      }

      const saved = await this.$store.dispatch('addVideo', {
        _id: this.quickBookmarkPlaylist._id,
        videoData: { ...this.addToPlaylistVideoData }
      })
      showToast({
        message: saved
          ? this.$t('Video.Video has been saved to {playlistName}', { playlistName })
          : this.$t('Video.There was a problem saving the video to {playlistName}', { playlistName }),
        image: this.toastThumbnail,
        icon: ['fas', 'bookmark'],
      })
    },
    async toggleTheatreMode() {
      this.theatreModeToggledManually = true
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
        const animation = applyAnimationSpeed(element.animate([
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
        }))

        animation.addEventListener('finish', () => {
          this.theatreModeAnimations = this.theatreModeAnimations.filter(item => item !== animation)
        })
        return animation
      })
    },

    activateWatchRuntime() {
      if (this.isTabPresented === false) {
        return
      }

      if (this.subscriptionShortsFeedActive) {
        this.shortsScrollResetPending = false
        this.shortsLastWindowScrollY = window.scrollY
        requestAnimationFrame(() => {
          if (this.isCurrentlyPresented()) {
            this.shortsLastWindowScrollY = window.scrollY
          }
        })
      }

      document.removeEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.removeEventListener('click', this.resetAutoplayInterruptionTimeout)
      document.addEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.addEventListener('click', this.resetAutoplayInterruptionTimeout)
      this.resetAutoplayInterruptionTimeout()
    },

    deactivateWatchRuntime() {
      this.resetShortsSwipe()
      document.removeEventListener('keydown', this.resetAutoplayInterruptionTimeout)
      document.removeEventListener('click', this.resetAutoplayInterruptionTimeout)
      clearTimeout(this.autoplayInterruptionTimeout)
      this.autoplayInterruptionTimeout = null
      this.abortAutoplayCountdown(true)
    },

    async cleanupWatchRuntime() {
      // Closing a tab unmounts Watch while progress persistence is pending.
      const player = this.$refs.player
      this.shortsPreloadGeneration++
      this.shortsPlaybackCache.retain([], [])
      this.$store.commit('setCurrentWatchTimestamp', { tabId: this.tabId, value: null })
      await this.handleRouteChange()
      window.removeEventListener('beforeunload', this.handleWatchProgressAutoSave)
      window.removeEventListener('beforeunload', this.flushWatchTime)
      this.deactivateWatchRuntime()

      if (player) {
        await this.destroyPlayer(player)
      }
    },

    async reloadView({ preserveTitle = false } = {}) {
      const loadGeneration = ++this.videoLoadGeneration
      this.preparingVideoLoadGeneration = loadGeneration
      const requestedVideoId = this.tabRoute.params.id
      const reloadPlaybackContext = this.pendingSabrReloadContext?.videoId === requestedVideoId
        ? this.pendingSabrReloadContext.context
        : undefined
      this.pendingSabrReloadContext = null
      if (requestedVideoId !== this.videoId) {
        this.$store.commit('setCurrentWatchTimestamp', { tabId: this.tabId, value: null })
      }
      if (this.queuedPlaybackVideoId !== requestedVideoId) this.queuedPlaybackVideoId = null
      this.loadingTheatreMode = this.useTheatreMode
      preserveTitle ||= this.preserveTitleOnNextReload
      this.preserveTitleOnNextReload = false
      const videoInfoPrefetch = this.prefetchLocalVideoInfo(loadGeneration, requestedVideoId, reloadPlaybackContext)

      try {
        this.saveShortsPlaybackPosition()
        await this.handleRouteChange()
        if (!this.isCurrentVideoLoad(loadGeneration, requestedVideoId)) { return }

        if (this.$refs.player) {
          const retainShort = this.customShortsPlayerActive &&
            this.tabRoute.query.short === 'true' &&
            requestedVideoId !== this.videoId &&
            this.$refs.player.hasLoaded
          if (retainShort) {
            this.$refs.player.suspendForShortsNavigation()
          } else {
            await this.destroyPlayer()
            if (!this.isCurrentVideoLoad(loadGeneration, requestedVideoId)) { return }
            if (this.customShortsPlayerActive) {
              this.shortsPlayerCacheGeneration++
            }
          }
        }

        // react to route changes...
        const previousVideoId = this.videoId
        this.videoId = this.tabRoute.params.id
        const videoIdChanged = this.videoId !== previousVideoId
        if (videoIdChanged) {
          this.useCustomShortsPlayerForCurrentVideo = this.$store.getters.getUseCustomShortsPlayer
          this.ipBlockRecoveryAttemptedForCurrentVideo = false
          this.androidHttpErrorRecoveryAttemptedForCurrentVideo = false
          this.streamErrorReloadAttemptedForCurrentVideo = false
          this.playbackEngineFallbackAttemptedForCurrentVideo = false
          this.playbackEngineFallbackTarget = null
          this.ytDlpDefaultClientsFallbackToastShown = false
          this.sabrErrorRecoveryAttempts = 0
          this.sabrErrorRecoveriesForCurrentVideo = 0
          this.sabrErrorRecoveryLastSeconds = null
          this.sabrErrorRecoveryPlayedSeconds = 0
        }
        this.ipBlockDetectedInCurrentChain = false
        const preserveShortsPanels = videoIdChanged &&
          this.customShortsPlayerActive &&
          this.tabRoute.query.short === 'true'
        // Replace the player only after its UI state has been saved. Metadata-only
        // requests advance videoLoadGeneration without replacing local playback.
        this.playerLoadGeneration = loadGeneration
        this.resetVideoState({
          preserveTitle,
          placeholderTitle: videoIdChanged ? this.getPendingVideoTitle() : '',
          preserveShortsPanels,
        })
      } finally {
        if (this.preparingVideoLoadGeneration === loadGeneration) {
          this.preparingVideoLoadGeneration = null
        }
      }

      this.firstLoad = true
      this.videoPlayerLoaded = false
      // Re-evaluate per video: this instance is reused across same-tab
      // navigation, so a tab that was presented for the previous video must not
      // keep that state while it loads the next one in the background.
      this.hasBeenPresented = this.isCurrentlyPresented()
      this.activeFormat = this.defaultVideoFormat

      this.checkIfTimestamp()
      this.checkIfPlaylist()
      this.setViewingModeOnRouteChange()

      switch (this.backendPreference) {
        case 'local':
          await this.getVideoInformationLocal(loadGeneration, false, videoInfoPrefetch, reloadPlaybackContext)
          break
        case 'invidious':
        case 'yattee':
          this.getVideoInformationInvidious(loadGeneration)
          break
      }
    },

    getPendingVideoTitle: function () {
      const tab = this.$store.getters.getTabById(this.tabId)
      const entry = tab?.history[tab.historyIndex]
      const title = tab?.contentTitle
      return entry?.titlePending !== true &&
        typeof title === 'string' &&
        title.length > 0 &&
        title !== this.tabRoute.fullPath
        ? title
        : this.tabRoute.fullPath
    },

    resetVideoState: function ({
      preserveTitle = false,
      placeholderTitle = '',
      preserveShortsPanels = false,
    } = {}) {
      const previousVideoTitle = this.videoTitle

      this.mobilePanel = null

      // A preserved title belongs to the previous successful request. Keep it
      // visible during a reload, but require the current request to resolve its
      // own metadata before it can be cached.
      this.hasResolvedVideoTitle = false
      if (!preserveShortsPanels) {
        this.shortsCommentsOpen = false
      }
      this.playlistScrollPositions.sidebar = null
      this.playlistScrollPositions.fullscreen = null
      this.isLoading = true
      this.isFamilyFriendly = null
      this.commentsDisabled = false
      this.isLive = false
      this.isLiveDvrEnabled = null
      this.isPremiere = false
      this.commentsLoaded = false
      this.commentPreviews = []
      this.liveChatLoaded = false
      this.transcriptLoaded = false
      this.sponsorBlockInfoSegments = []
      this.liveChat = null
      this.liveChatIsReplay = false
      this.liveChatOpen = true
      this.isLiveContent = false
      this.isUpcoming = false
      this.isPostLiveDvr = false
      this.isUnlisted = false
      this.isShort = this.tabRoute.query.short === 'true'
      this.videoAspectRatio = this.isShort ? 9 / 16 : null
      this.shortsLinkedVideo = null
      this.shortsPlaybackCompleted = false
      this.shortsCompletionBlockedBySeek = false
      this.shortsPlaybackAfterSeekSeconds = 0
      this.hasAiGeneratedContent = false
      this.contentDisclosures = null
      this.hasPaidPromotion = false
      this.paidPromotionDurationMs = 10000
      this.upcomingTimestamp = null
      this.upcomingTimeLeft = null
      this.clearLiveReminderStartTimer()
      this.liveReminderNow = Date.now()
      this.liveReminderActive = false
      this.liveReminderLoading = false
      this.thumbnail = ''
      this.videoTitle = preserveTitle ? previousVideoTitle : placeholderTitle
      this.videoSummary = []
      this.videoDescription = ''
      this.videoDescriptionHtml = ''
      this.videoMetadataHistory = null
      this.videoCategory = ''
      this.videoTags = []
      this.videoGames = []
      this.license = ''
      this.videoViewCount = null
      this.videoLikeCount = null
      this.videoDislikeCount = null
      this.videoLengthSeconds = 0
      this.videoChapters = []
      this.videoPopularity = []
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
      this.activePlaybackEngine = 'built-in'
      this.activePlaybackEngineVersion = null
      this.onlinePlaybackSource = null
      this.localPlaybackDownloadId = null
      this.localPlaybackFilePath = null
      this.sabrPlaybackLoaded = false
      this.builtInPlaybackSource = null
      this.ytDlpStreamsPending = false
      this.vrStreamsPending = false
      this.legacyFormats = []
      this.localFilePlayback = false
      this.downloadedPlaybackWithoutMetadata = false
      this.downloadedMetadataLoading = false
      this.captions = []
      this.captionTranslations = []
      this.currentTime = 0
      if (!preserveShortsPanels) {
        this.showTranscript = false
        this.shortsMetadataOpen = false
      }
      this.showSidebarChapters = false
      this.videoChapterThumbnails = []
      this.vrProjection = null
      this.recommendedVideos = []
      this.playabilityStatus = ''
      this.adEndTimeUnixMs = 0
      this.errorMessage = null
      this.customErrorIcon = null
      this.restrictedPlaybackError = null
      this.nonRetryablePlaybackError = null
      this.skipUnavailablePlaylistVideo = false
      this.videoGenreIsMusic = false
      this.musicMediaType = MUSIC_MEDIA_TYPE.UNKNOWN
      this.streamingDataExpiryDate = null
      this.ipBlockDetectedInCurrentChain = false
      // Cleared until the new player reports its ready state; otherwise the
      // manual save actions could persist the previous video's values.
      this.currentSubtitlesState = null
      this.currentVolume = null
      if (!preserveTitle) {
        this.resumePlaybackAfterSabrReload = false
        this.suppressAutoplayAfterSabrReload = false
        this.sabrReloadState = null
        this.updateTitle()
      }
    },

    ...watchDownloadedPlaybackMethods,

    watchRouteWithoutTimestamp: function (fullPath) {
      const url = new URL(fullPath, 'https://opentubex.invalid')
      url.searchParams.delete('timestamp')
      return `${url.pathname}${url.search}${url.hash}`
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

      const loadGeneration = ++this.videoLoadGeneration
      if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(this.backendPreference)) {
        this.getVideoInformationInvidious(loadGeneration)
      } else {
        this.getVideoInformationLocal(loadGeneration)
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
          if (this.theatreTogglePossible) {
            this.useTheatreMode = true
          } else {
            // Live chat and other sidebar panels are only known after video
            // metadata loads. Re-evaluate once instead of permanently rejecting
            // the configured default based on the empty loading state.
            this.applyDefaultTheatreModeAfterLoad = true
          }
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
        player.setCurrentTime(timestamp, true)
      }
    },

    ...watchShortsMethods,

    playTranscriptSegment: function (timestamp) {
      const player = this.$refs.player

      if (!this.isLoading && player?.hasLoaded) {
        player.setCurrentTime(timestamp, true)

        if (player.isPaused()) {
          player.play()
        }
      }
    },

    isCurrentVideoLoad: function (loadGeneration, videoId) {
      return loadGeneration === this.videoLoadGeneration &&
        videoId === this.tabRoute.params.id
    },

    ...watchRestrictedPlaybackMethods,

    /**
     * Requests the next video while the previous one saves its progress and
     * destroys its player. Shorts may use their own extraction, so they wait.
     * @param {number} loadGeneration
     * @param {string} videoId
     * @param {import('googlevideo/protos').ReloadPlaybackContext} [reloadPlaybackContext]
     */
    prefetchLocalVideoInfo: function (loadGeneration, videoId, reloadPlaybackContext = undefined) {
      if (this.backendPreference !== 'local' || this.tabRoute.query.short === 'true') return null

      const prefetch = initializeNetworkRecovery().ready.then(() => (
        this.isCurrentVideoLoad(loadGeneration, videoId) && getConnectionState() !== 'offline'
          ? getLocalVideoInfo(videoId, {
              reloadPlaybackContext,
              // As in getVideoInformationLocal, but the previous video's engine
              // fallback is only reset once its player is gone. Until then, a
              // different video uses the engine setting without that fallback.
              shouldGeneratePoToken: () => this.isCurrentVideoLoad(loadGeneration, videoId) &&
                (!process.env.IS_CAPACITOR || !(videoId === this.videoId
                  ? this.isYtDlpPlaybackRequested()
                  : supportsYtDlp && this.videoPlaybackEngine === 'yt-dlp'))
            })
          : null
      ))
      // A superseded load never awaits its prefetch.
      prefetch.catch(() => {})
      return prefetch
    },

    getVideoInformationLocal: async function (loadGeneration = ++this.videoLoadGeneration, metadataOnly = false, videoInfoPrefetch = null, reloadPlaybackContext = undefined) {
      if (this.firstLoad && !metadataOnly) {
        this.isLoading = true
      }

      const videoId = this.tabRoute.params.id
      await initializeNetworkRecovery().ready
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
      if (getConnectionState() === 'offline') {
        if (metadataOnly || this.finishDownloadedPlaybackWithoutMetadata()) return
        // Keep the metadata request queued for reconnect instead of abandoning
        // the watch page with its loading skeleton still visible.
      }

      let backendFailed = false
      try {
        const shortsExtractionKey = this.customShortsPlayerActive && !metadataOnly
          ? this.getShortsExtractionKey(videoId, 'local')
          : null
        const videoInfo = this.customShortsPlayerActive && !metadataOnly
          ? await this.getShortsVideoInformation(videoId, 'local', reloadPlaybackContext)
          // A failed prefetch is retried here, like one that never started.
          : (await videoInfoPrefetch?.catch(() => null)) ?? await getLocalVideoInfo(videoId, {
              reloadPlaybackContext,
              // Metadata extraction can outlive a playback engine switch. Decide
              // when the token is needed, after the preceding network requests.
              shouldGeneratePoToken: () => this.isCurrentVideoLoad(loadGeneration, videoId) &&
                (!process.env.IS_CAPACITOR || !this.isYtDlpPlaybackRequested())
            })
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        const {
          info: result,
          poToken,
          clientInfo,
          adEndTimeUnixMs,
          paidPromotionDurationMs,
          paidPromotionPromise,
          isPremiere,
          isLiveDvrEnabled,
          watchPageIpBlocked,
          musicMediaType,
          contentDisclosures,
          androidLiveHlsManifestUrl,
          androidLiveDashManifestUrl,
        } = videoInfo

        this.musicMediaType = musicMediaType
        this.contentDisclosures = contentDisclosures ?? null

        if (watchPageIpBlocked) {
          this.ipBlockDetectedInCurrentChain = true

          if (process.env.IS_ELECTRON && this.videoPlaybackEngine === 'built-in' &&
            this.$store.getters.getPlaybackEngineFallback) {
            this.playbackEngineFallbackAttemptedForCurrentVideo = true
            this.playbackEngineFallbackTarget = 'yt-dlp'
            this.showTabToast({
              message: this.t('Change Format.Built-in Fallback Template', { error: this.t('Video.IP block') }),
              icon: ['fas', 'exchange-alt'],
            })
          }
        }

        const playabilityStatus = result.playability_status
        this.playabilityStatus = playabilityStatus.status

        if (!metadataOnly && playabilityStatus.status === 'LOGIN_REQUIRED' && playabilityStatus.error_screen?.reason?.text === 'Private video') {
          // Private videos cannot be played in FreeTube, as they require to be logged as the owner of the video
          // so there is no point continuing or trying any other backends as it will always fail
          this.setNonRetryablePlaybackError('private')
          this.thumbnail = this.getUnavailableVideoThumbnail()
          this.isLoading = false
          this.updateTitle()
          return
        }

        this.adEndTimeUnixMs = adEndTimeUnixMs
        this.hasPaidPromotion = paidPromotionDurationMs !== null
        this.paidPromotionDurationMs = paidPromotionDurationMs ?? 10000
        paidPromotionPromise?.then(durationMs => {
          if (durationMs === null || backendFailed || !this.isCurrentVideoLoad(loadGeneration, videoId)) return
          this.hasPaidPromotion = true
          this.paidPromotionDurationMs = durationMs
        })

        this.isFamilyFriendly = result.basic_info.is_family_safe
        this.commentsDisabled = areLocalCommentsDisabled(result)
        const avoidTranslation = this.$store.getters.getAvoidTranslation !== 'disabled'

        this.recommendedVideos = result.watch_next_feed
          ?.filter((item) => {
            return item.type === 'CompactVideo' || item.type === 'CompactMovie' ||
              (item.type === 'LockupView' && (item.content_type === 'VIDEO' || item.content_type === 'STATION'))
          })
          .map(parseLocalWatchNextVideo).filter(_ => _)
          // place watched recommended videos last
          .sort(this.sortWatchedVideosLast) ?? []

        this.videoAnnotations = parseLocalEndscreen(result.endscreen)
        if (avoidTranslation) {
          this.videoAnnotations = this.videoAnnotations.map((annotation) => {
            if (!annotation.videoId) {
              return annotation
            }

            const cachedTitle = getCachedOembedTitle(annotation.videoId)
            if (cachedTitle !== null) {
              return { ...annotation, title: cachedTitle }
            }

            getOembedTitle(annotation.videoId).then((title) => {
              if (!title || this.$store.getters.getAvoidTranslation === 'disabled' ||
                  !this.isCurrentVideoLoad(loadGeneration, videoId)) {
                return
              }

              this.videoAnnotations = this.videoAnnotations.map((currentAnnotation) =>
                currentAnnotation.id === annotation.id
                  ? { ...currentAnnotation, title }
                  : currentAnnotation
              )
            })

            return annotation
          })
        }

        if (this.showFamilyFriendlyOnly && this.isFamilyFriendly === false) {
          this.isLoading = false
          this.handleVideoEnded()
          return
        }

        this.videoSummary = parseLocalVideoSummary(result)

        // YouTube can omit the main watch panels while retaining metadata in the description panel.
        /** @type {import('youtubei.js').YTNodes.StructuredDescriptionContent | undefined} */
        const structuredDescription = result.page[1]?.engagement_panels
          ?.find(panel => panel.panel_identifier === 'engagement-panel-structured-description')?.content
        const titleHeader = structuredDescription?.items?.find(item => item.is(YTNodes.VideoTitleHeaderView))
        const descriptionHeader = structuredDescription?.items?.find(item => item.is(YTNodes.VideoDescriptionHeader))
        const descriptionChannel = structuredDescription?.items?.find(item => item.is(YTNodes.VideoDescriptionInfocardsSection))
        const descriptionBody = structuredDescription?.items?.find(item => item.is(YTNodes.ExpandableVideoDescriptionBody))
        const localizedDescription = result.secondary_info?.description?.text?.trim()
          ? result.secondary_info.description
          : descriptionBody?.attributed_description_body_text

        if (avoidTranslation) {
          this.videoTitle = result.basic_info.title?.trim() ?? ''
        } else {
          // extract localised title first and fall back to the not localised one
          this.videoTitle = result.primary_info?.title?.text?.trim() || titleHeader?.video_title.text?.trim() || descriptionHeader?.title.text?.trim() || result.basic_info.title?.trim() || ''
        }
        this.hasResolvedVideoTitle = this.videoTitle.length > 0
        if (!this.hasResolvedVideoTitle) {
          // Reuse the cache and in-flight request used by original-language list titles.
          getOembedTitle(videoId).then(title => {
            if (!title || this.hasResolvedVideoTitle || !this.isCurrentVideoLoad(loadGeneration, videoId)) return
            this.videoTitle = title
            this.hasResolvedVideoTitle = true
            this.updateTitle()
          })
        }
        const localizedViews = result.primary_info?.view_count?.text || descriptionHeader?.views.text
        const viewCount = Number.isFinite(result.basic_info.view_count)
          ? result.basic_info.view_count
          : localizedViews?.toLowerCase() === 'no views'
            ? 0
            : parseLocalSubscriberCount(localizedViews ?? '')
        this.videoViewCount = Number.isFinite(viewCount) ? viewCount : null
        this.license = result.secondary_info?.metadata?.rows.find(element => element.title?.text === 'License')?.contents[0]?.text
        this.videoGames = parseLocalVideoGames(result)

        this.channelCollaborators = parseLocalVideoCollaborators(result)
        const primaryCollaborator = this.channelCollaborators[0]
        const ownerAuthor = result.secondary_info?.owner?.author
        // YouTube.js uses N/A for an owner whose identifying fields were omitted.
        const ownerChannelId = ownerAuthor?.id !== 'N/A' ? ownerAuthor?.id : undefined
        const ownerChannelName = ownerAuthor?.name !== 'N/A' ? ownerAuthor?.name : undefined

        this.channelId = result.basic_info.channel_id ?? ownerChannelId ?? primaryCollaborator?.id ?? descriptionHeader?.channel_navigation_endpoint?.payload?.browseId ?? ''
        this.channelName = result.basic_info.author ?? ownerChannelName ?? primaryCollaborator?.name ?? descriptionHeader?.channel.text ?? ''
        this.channelThumbnail = primaryCollaborator?.thumbnail ?? ownerAuthor?.best_thumbnail?.url ?? descriptionHeader?.channel_thumbnail[0]?.url ?? descriptionChannel?.channel_avatar[0]?.url ?? ''
        this.$store.commit('setVideoAvatar', {
          videoId: this.videoId,
          avatar: this.channelThumbnail
        })
        this.setTabAvatar(this.channelThumbnail)

        this.videoCategory = result.basic_info.category ?? ''
        this.videoTags = result.basic_info.keywords ?? []
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
          published = Date.parse(result.primary_info?.published?.text || descriptionHeader?.publish_date.text)
        }
        this.videoPublished = Number.isFinite(published) ? published : 0

        if (avoidTranslation) {
          this.videoDescription = result.basic_info.short_description
        } else if (localizedDescription?.runs) {
          try {
            this.videoDescription = parseLocalTextRuns(localizedDescription.runs)
          } catch (error) {
            console.error('Failed to extract the localised description, falling back to the standard one.', error, JSON.stringify(localizedDescription.runs))
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
          // Watch HTML and the WEB session use English for numeric metadata.
          const descriptionLikes = descriptionHeader?.factoids.find(item => item.is(YTNodes.Factoid) && item.label.text === 'Likes')
          const likeCount = Number.isFinite(result.basic_info.like_count)
            ? result.basic_info.like_count
            : parseLocalSubscriberCount(descriptionLikes?.accessibility_text ?? descriptionLikes?.value.text ?? '')
          this.videoLikeCount = isNaN(likeCount) ? 0 : likeCount

          // YouTube doesn't return dislikes anymore
          this.videoDislikeCount = null

          if (this.useReturnYouTubeDislikes) {
            this.fetchVideoDislikes()
          }
        }

        this.isLive = !!result.basic_info.is_live
        this.isLiveDvrEnabled = isLiveDvrEnabled ?? null
        this.isUpcoming = !!result.basic_info.is_upcoming
        this.isLiveContent = !!result.basic_info.is_live_content
        this.isPremiere = isPremiere === true
        this.isPostLiveDvr = !!result.basic_info.is_post_live_dvr
        this.isUnlisted = !!result.basic_info.is_unlisted
        this.hasAiGeneratedContent = (result.primary_info?.badges?.some(badge => badge.label === 'AI') ?? false) ||
          (this.contentDisclosures?.some(item => /\b(ai|artificial intelligence|altered|synthetic)\b/i.test(item.label)) ?? false)

        if (this.isLive && !this.isLiveContent) {
          this.videoPublished = result.basic_info.start_timestamp.getTime()
        }

        const subscriberCountText = result.secondary_info?.owner?.subscriber_count?.text?.trim() || descriptionChannel?.section_subtitle.text
        const subCount = parseLocalSubscriberCount(subscriberCountText ?? '')

        if (!isNaN(subCount)) {
          this.channelSubscriptionCountText = formatNumber(subCount, subCount >= 10000 ? { notation: 'compact' } : undefined)
        } else {
          this.channelSubscriptionCountText = ''
        }

        let chapters = []
        let chaptersKind = 'chapters'
        this.videoPopularity = this.isLive ? [] : getVideoPopularity(result)
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
              const chapterDescription = avoidTranslation
                ? result.basic_info.short_description
                : localizedDescription?.text || result.basic_info.short_description
              chapters = this.extractChaptersFromDescription(chapterDescription ?? '')
            }
          }

          if (chapters.length > 0) {
            this.finalizeChapters(chapters, result.basic_info.duration)
          } else {
            // Community chapters are optional: keep playback and the page skeleton
            // independent of SponsorBlock's response time.
            this.getSponsorBlockCommunityChapters(result.basic_info.duration).then(chapters => {
              if (backendFailed || !this.isCurrentVideoLoad(loadGeneration, videoId) || this.hideChapters) return
              this.videoChapters = chapters
            })
          }
        }

        this.videoChapters = chapters
        this.videoChaptersKind = chaptersKind

        // The apostrophe is intentionally that one (char code 8217), because that is the one YouTube uses
        const BOT_MESSAGE = 'Sign in to confirm you’re not a bot'

        const isDrmProtected = result.streaming_data?.adaptive_formats.some(format => format.drm_families || format.drm_track_type)

        if (!metadataOnly && (playabilityStatus.status === 'UNPLAYABLE' || playabilityStatus.status === 'LOGIN_REQUIRED' || isDrmProtected)) {
          if (playabilityStatus.error_screen?.offer_id === 'sponsors_only_video') {
            this.setRestrictedPlaybackError('members')
          } else if (playabilityStatus.reason === 'Sign in to confirm your age' || (result.has_trailer && result.getTrailerInfo() === null)) {
            this.setRestrictedPlaybackError('age')
          } else if (isDrmProtected) {
            // DRM protected videos (e.g. movies) cannot be played in FreeTube,
            // as they require the proprietary and closed source Wideview CDM which is understandably not included in standard Electron builds
            this.setNonRetryablePlaybackError('drm')
            this.isLoading = false
            this.updateTitle()
            return
          }

          if (this.restrictedPlaybackError === null) {
            let errorText

            if (playabilityStatus.reason === BOT_MESSAGE || playabilityStatus.reason === 'Please sign in') {
              errorText = this.t('Video.IP block')
              this.ipBlockDetectedInCurrentChain = true
            } else {
              errorText = `[${playabilityStatus.status}] ${playabilityStatus.reason}`

              const subreason = playabilityStatus.error_screen?.subreason?.text
              if (subreason) {
                errorText += `: ${subreason}`
              }
            }

            const tryingYtDlpForIpBlock =
              this.isYtDlpPlaybackRequested() &&
              this.ipBlockDetectedInCurrentChain

            if (tryingYtDlpForIpBlock) {
              console.warn('Built-in metadata is IP blocked; continuing so yt-dlp can provide the playback source')
            } else if (this.backendFallback) {
              throw new Error(errorText)
            } else {
              const didReload = await this.runIpBlockRecoveryScriptAndReload()
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
              if (didReload) {
                return
              }

              this.errorMessage = errorText
              this.isLoading = false
              this.updateTitle()
              return
            }
          }
        }

        // Streams that have ended keep their chat around as a replay, which is played back
        // in sync with the video instead of in real time.
        if (result.livechat && (this.isLive || this.isUpcoming || result.livechat.is_replay)) {
          this.liveChat = result.getLiveChat()
          this.liveChatIsReplay = this.liveChat.is_replay
        } else {
          this.liveChat = null
          this.liveChatIsReplay = false
        }

        if (!metadataOnly && (this.isLive || this.isPostLiveDvr) && !this.isUpcoming) {
          let useRemoteManifest = true

          if (this.isPostLiveDvr) {
            // I wasn't able to get SABR working with Post-Live-DVR yet, so for the moment we'll use YouTube's provided DASH manifest instead.
            // It only contains the last 4 hours of the stream, instead of starting from the beginning but that is better than nothing.
            if (
              result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
            ) {
              try {
                const manifestSrc = await this.createLocalDashManifest(result, true)
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
                this.manifestSrc = manifestSrc
                this.manifestMimeType = MANIFEST_TYPE_DASH
                useRemoteManifest = false
              } catch (error) {
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
                console.error(`Failed to generate DASH manifest for this Post Live DVR video ${this.videoId}, falling back to using YouTube's provided one...`, error)
              }
            }
          }

          if (useRemoteManifest) {
            // Ongoing streams and premieres use HLS at the live edge. Remote
            // DASH can advertise a rewind range whose segments are unavailable.
            const hlsManifestUrl = result.streaming_data?.hls_manifest_url ?? androidLiveHlsManifestUrl
            const dashManifestUrl = this.isPostLiveDvr
              ? result.streaming_data?.dash_manifest_url ??
                ((getLiveDvrWindowSeconds(hlsManifestUrl) ?? 0) <= 30 ? androidLiveDashManifestUrl : null)
              : null
            if (dashManifestUrl) {
              this.manifestSrc = dashManifestUrl
              this.manifestMimeType = MANIFEST_TYPE_DASH
            } else {
              // A blocked live player response can contain all watch-page metadata
              // without either manifest URL. Keep the missing source as `null`, as
              // expected by the player availability checks, while yt-dlp extracts
              // its independent HLS manifest.
              this.manifestSrc = hlsManifestUrl
              this.manifestMimeType = MANIFEST_TYPE_HLS
            }
          }

          this.streamingDataExpiryDate = result.streaming_data?.expires ?? null

          if (this.activeFormat === 'legacy') {
            this.activeFormat = 'dash'
          }
        } else if (this.isUpcoming) {
          const upcomingTimestamp = result.basic_info.start_timestamp

          if (upcomingTimestamp) {
            const now = new Date()
            this.premiereDate = upcomingTimestamp
            this.updateUpcomingTimestamp()

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

            this.scheduleLiveReminderStartInvalidation()
            this.syncLiveReminder(loadGeneration, videoId).catch(error => {
              console.error('Failed to load live stream reminder', error)
            })
          } else {
            this.upcomingTimestamp = null
            this.upcomingTimeLeft = null
            this.premiereDate = undefined
            this.scheduleLiveReminderStartInvalidation()
          }
        }

        if ((!this.isUpcoming && !this.isLive && !this.isPostLiveDvr) || (this.isUpcoming && this.playabilityStatus === 'OK')) {
          this.videoLengthSeconds = result.basic_info.duration
          if (result.streaming_data) {
            if (!metadataOnly) this.streamingDataExpiryDate = result.streaming_data.expires

            if (!metadataOnly && result.streaming_data.formats.length > 0) {
              this.legacyFormats = result.streaming_data.formats.map(mapLocalLegacyFormat)
            }

            if (result.captions) {
              const captionTranslationLanguages = result.captions.translation_languages ?? []
              // Only set when the video has multiple audio tracks, e.g. AI dubs
              const originalLanguage = result.streaming_data.adaptive_formats.find(format => format.has_audio && format.is_original)?.language
              const captionLanguages = result.captions.caption_tracks?.map(caption => caption.language_code) ?? []
              const captionTracks = result.captions?.caption_tracks?.map((caption) => {
                const url = new URL(caption.base_url)
                url.searchParams.set('fmt', 'vtt')

                return {
                  id: caption.vss_id,
                  url: url.toString(),
                  label: caption.name.text,
                  language: caption.language_code,
                  mimeType: 'text/vtt',
                  isDubbed: caption.kind === 'asr' &&
                    isDubbedCaptionLanguage(caption.language_code, originalLanguage, captionLanguages),
                  isOriginalLanguage: !!originalLanguage && isSameBaseLanguage(caption.language_code, originalLanguage)
                }
              }) ?? []

              this.$store.commit('setYouTubeCaptionLanguageCodes', captionTranslationLanguages)
              this.captionTranslations = captionTranslationLanguages.map(language =>
                this.getTranslatedCaption(result.captions, language, originalLanguage)
              ).filter(Boolean)

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

                const originalCaptionTracks = captionTracks.filter(captionTrack => !captionTrack.isDubbed)
                const hasPreferredCaption = findCaptionByLocale(originalCaptionTracks, this.preferredCaptionLocale) ||
                  originalCaptionTracks.some(captionTrack => languagesSet.has(captionTrack.language))

                // The last auto-translation picked in the player wins over original tracks, as those can be incomplete
                const rememberedTranslation = this.getRememberedTranslatedCaption(result.captions, originalLanguage)

                if (rememberedTranslation) {
                  captionTracks.push(rememberedTranslation)
                } else if (!hasPreferredCaption) {
                  const translatedCaptionTrack = this.getTranslatedLocaleCaption(result.captions, languagesSet, originalLanguage)

                  if (translatedCaptionTrack) {
                    captionTracks.push(translatedCaptionTrack)
                  }
                }
              }

              this.captions = sortCaptions(captionTracks, this.preferredCaptionLocale)
            }
          } else if (!metadataOnly &&
            this.restrictedPlaybackError === null &&
            !this.isYtDlpPlaybackRequested()
          ) {
            // video might be region locked or something else. This leads to no formats being available
            this.showTabToast({
              message: this.t('This video is unavailable because of missing formats. This can happen due to country unavailability.'),
              time: 7000,
              icon: ['fas', 'circle-exclamation'],
            })
            this.handleVideoEnded()
            return
          } else if (!metadataOnly && this.restrictedPlaybackError === null) {
            console.warn('Built-in metadata has no streams; continuing so yt-dlp can provide the playback source')
          }

          let storyboard

          if (result.storyboards?.type === 'PlayerStoryboardSpec') {
            /** @type {import('youtubei.js/dist/src/parser/classes/PlayerStoryboardSpec').StoryboardData[]} */
            let source = result.storyboards.boards
            if (window.innerWidth < 500) {
              source = source.filter((board) => board.thumbnail_height <= 90)
            }

            storyboard = source.at(-1)
            if (storyboard) {
              this.videoStoryboardSrc = this.createLocalStoryboardUrls(storyboard)
            }
          }

          let vrHlsManifestUrl = null
          if (!metadataOnly && this.restrictedPlaybackError === null && result.streaming_data) {
            this.vrProjection = [
              ...(result.streaming_data.adaptive_formats ?? []),
              ...(result.streaming_data.formats ?? [])
            ]
              .find(format => {
                return format.has_video &&
                  typeof format.projection_type === 'string' &&
                  format.projection_type !== 'RECTANGULAR'
              })
              ?.projection_type ?? null

            if (this.vrProjection === 'MESH' && !this.isYtDlpPlaybackRequested()) {
              this.vrStreamsPending = true
              this.isLoading = false
              this.updateTitle()
              const switchGeneration = this.playbackEngineSwitchGeneration
              let url = result.streaming_data.hls_manifest_url
              let playable = url && await probeHlsManifest(url)
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
              if (!playable && switchGeneration === this.playbackEngineSwitchGeneration && !this.isYtDlpPlaybackRequested()) {
                url = await videoInfo.getVrHlsManifest?.()
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
                playable = url && await probeHlsManifest(url)
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
              }
              if (playable && switchGeneration === this.playbackEngineSwitchGeneration && !this.isYtDlpPlaybackRequested()) {
                vrHlsManifestUrl = url
                this.vrProjection = 'EQUIRECTANGULAR'
              }
            }

            if (this.vrProjection === 'MESH' && supportsYtDlp && this.videoPlaybackEngine === 'built-in' &&
              this.$store.getters.getPlaybackEngineFallback) {
              this.playbackEngineFallbackTarget = 'yt-dlp'
            }
          }

          if (vrHlsManifestUrl !== null) {
            this.manifestSrc = vrHlsManifestUrl
            this.manifestMimeType = MANIFEST_TYPE_HLS
            this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(vrHlsManifestUrl)
            this.activeFormat = 'dash'
          } else if (!metadataOnly && this.restrictedPlaybackError === null && result.streaming_data?.adaptive_formats.length > 0) {
            if (
              poToken &&
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

              this.manifestSrc = this.createLocalSabrManifest(result, poToken, clientInfo, storyboards)
              this.manifestMimeType = MANIFEST_TYPE_SABR
            } else if (
              result.streaming_data.adaptive_formats[0]?.url ||
              result.streaming_data.adaptive_formats[0]?.signature_cipher ||
              result.streaming_data.adaptive_formats[0]?.cipher
            ) {
              const manifestSrc = await this.createLocalDashManifest(result)
              if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
              this.manifestSrc = manifestSrc
              this.manifestMimeType = MANIFEST_TYPE_DASH
            } else {
              // Neither a SABR streaming URL nor playable adaptive format URLs,
              // so the only thing left is the 360p legacy stream. This is a
              // silent quality drop, so make it identifiable in the logs.
              console.error(`No SABR or adaptive stream URLs for ${this.videoId}, falling back to the legacy formats...`)
              this.manifestSrc = null
              this.enableLegacyFormat()
            }
          } else if (!metadataOnly && this.restrictedPlaybackError === null) {
            console.error(`No adaptive formats for ${this.videoId}, falling back to the legacy formats...`)
            this.manifestSrc = null
            this.enableLegacyFormat()
          }
        }

        if (!metadataOnly && !this.isUpcoming && this.restrictedPlaybackError === null) {
          if (!this.applyDownloadedPlaybackSource()) {
            this.alignActiveFormatWithAvailableSources()

            // Deliberately not awaited, so that the metadata (title, description,
            // comments, recommendations, ...) is shown while yt-dlp is still extracting.
            this.applyYtDlpPlaybackSource(loadGeneration, videoId)
          }
        }

        this.updateShortsPlayerState(
          result.basic_info.duration,
          result.streaming_data?.adaptive_formats
        )
        if (!metadataOnly && this.customShortsPlayerActive && !watchPageIpBlocked && playabilityStatus.status === 'OK') {
          const currentKey = this.getShortsExtractionKey(videoId, 'local')
          if (shortsExtractionKey === currentKey) {
            this.shortsPlaybackCache.set(currentKey, videoInfo)
          }
        }
        this.updateShortThumbnail()
        if (this.isShort) {
          this.loadLocalShortLinkedVideo(this.videoId)
        }
        this.isLoading = false
        this.downloadedPlaybackWithoutMetadata = false
        this.updateTitle()
      } catch (err) {
        backendFailed = true
        if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

        let handledError = err
        if (err.isIpBlock) {
          this.ipBlockDetectedInCurrentChain = true
          handledError = new Error(this.t('Video.IP block'), { cause: err })
        }

        const canFallback = this.backendPreference === 'local' && this.backendFallback &&
          !handledError.toString().includes('private') && !handledError.toString().includes('unavailable')
        if (metadataOnly) {
          if (canFallback) return this.getVideoInformationInvidious(loadGeneration, true)
          console.error('Could not restore downloaded video metadata', handledError)
          return
        }

        console.error(handledError)
        if (canFallback) {
          const errorMessage = this.t('Local API Error (Click to copy)')
          showApiErrorToast(errorMessage, handledError, this.showTabToast)
          this.showTabToast({ message: this.t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          this.getVideoInformationInvidious(loadGeneration)
        } else {
          const didReload = await this.runIpBlockRecoveryScriptAndReload()
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
          if (didReload) {
            return
          }

          if (this.finishDownloadedPlaybackWithoutMetadata()) return

          this.isLoading = false

          if (!this.thumbnail) {
            this.thumbnail = this.getUnavailableVideoThumbnail()
          }
          this.errorMessage = handledError.message || handledError.toString()
        }
      } finally {
        if (this.isCurrentVideoLoad(loadGeneration, videoId)) {
          this.vrStreamsPending = false
        }
      }
    },

    getVideoInformationInvidious: async function (loadGeneration = ++this.videoLoadGeneration, metadataOnly = false) {
      if (this.firstLoad && !metadataOnly) {
        this.isLoading = true
      }

      const videoId = this.tabRoute.params.id
      await initializeNetworkRecovery().ready
      if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
      if (getConnectionState() === 'offline') {
        if (metadataOnly || this.finishDownloadedPlaybackWithoutMetadata()) return
        // The shared network queue resumes this request when connectivity returns.
      }

      // Also used as the fallback of the local API, which always falls back to Invidious
      const isYattee = this.backendPreference === 'yattee'
      const apiBackend = isYattee ? 'yattee' : 'invidious'
      const shortsExtractionKey = this.customShortsPlayerActive && !metadataOnly
        ? this.getShortsExtractionKey(videoId, apiBackend)
        : null
      let backendFailed = false
      return (this.customShortsPlayerActive && !metadataOnly
        ? this.getShortsVideoInformation(videoId, apiBackend)
        : invidiousGetVideoInformation(videoId))
        .then(async result => {
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }

          if (result.error) {
            throw new Error(result.error)
          }

          this.videoTitle = result.title
          this.hasResolvedVideoTitle = this.videoTitle.length > 0
          this.videoViewCount = result.viewCount
          this.hasPaidPromotion = result.paid

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
          this.videoTags = result.keywords ?? []
          this.videoGenreIsMusic = this.videoCategory === 'Music'
          this.musicMediaType = result.musicMediaType

          this.channelId = result.authorId
          this.channelName = result.author
          this.channelCollaborators = []
          const channelThumb = result.authorThumbnails.at(-1)
          this.channelThumbnail = channelThumb ? youtubeImageUrlToInvidious(channelThumb.url) : ''
          this.$store.commit('setVideoAvatar', {
            videoId: this.videoId,
            avatar: this.channelThumbnail
          })
          this.setTabAvatar(this.channelThumbnail)
          this.updateSubscriptionDetails({
            channelThumbnailUrl: channelThumb?.url,
            channelName: result.author,
            channelId: result.authorId
          })

          this.initializePlaybackRate()
          this.initializeVideoQuality()

          this.videoPublished = result.published * 1000
          this.videoDescription = result.description ?? ''
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
          this.isLiveDvrEnabled = null
          this.isPremiere = this.isLive && result.premiereTimestamp > 0
          this.isFamilyFriendly = result.isFamilyFriendly
          this.isPostLiveDvr = !!result.isPostLiveDvr
          this.contentDisclosures = null
          this.hasAiGeneratedContent = false
          this.isUnlisted = !result.isListed

          this.captions = sortCaptions(result.captions.map(caption => {
            return {
              // Yattee servers return absolute URLs
              url: isYattee ? caption.url : this.currentInvidiousInstanceUrl + caption.url,
              label: caption.label,
              language: caption.language_code,
              mimeType: 'text/vtt'
            }
          }), this.preferredCaptionLocale)

          if (isYattee) {
            // Yattee servers don't proxy images, so they come from YouTube like with the local API
            const storyboard = this.isLive || this.isPostLiveDvr ? null : getYatteeStoryboard(result.storyboards)
            this.videoStoryboardSrc = storyboard
              ? `data:text/vtt;charset=utf-8,${encodeURIComponent(buildVTTFileLocally(storyboard, result.lengthSeconds))}`
              : null
          } else if (!this.isLive && !this.isPostLiveDvr) {
            this.videoStoryboardSrc = `${this.currentInvidiousInstanceUrl}/api/v1/storyboards/${this.videoId}?height=90`
          }

          const thumbnailOrigin = isYattee ? 'https://i.ytimg.com' : this.currentInvidiousInstanceUrl
          switch (this.thumbnailPreference) {
            case 'start':
              this.thumbnail = `${thumbnailOrigin}/vi/${this.videoId}/maxres1.jpg`
              break
            case 'middle':
              this.thumbnail = `${thumbnailOrigin}/vi/${this.videoId}/maxres2.jpg`
              break
            case 'end':
              this.thumbnail = `${thumbnailOrigin}/vi/${this.videoId}/maxres3.jpg`
              break
            default:
              this.thumbnail = isYattee
                ? [...result.videoThumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ??
                  `https://i.ytimg.com/vi/${this.videoId}/hqdefault.jpg`
                : new URL(result.videoThumbnails[0].url, this.currentInvidiousInstanceUrl).toString()
              break
          }

          let chapters = []
          if (!this.hideChapters) {
            chapters = this.extractChaptersFromDescription(result.description)

            if (chapters.length > 0) {
              this.finalizeChapters(chapters, result.lengthSeconds)
            } else {
              this.getSponsorBlockCommunityChapters(result.lengthSeconds).then(chapters => {
                if (backendFailed || !this.isCurrentVideoLoad(loadGeneration, videoId) || this.hideChapters) return
                this.videoChapters = chapters
              })
            }
          }
          this.videoChapters = chapters
          this.videoChaptersKind = 'chapters'

          if (isYattee && !metadataOnly && process.env.IS_CAPACITOR && !process.env.IS_IOS && !isYatteeServerPlayableOnAndroid(this.apiServerUrl)) {
            throw new Error(this.t('Yattee Server.Errors.HTTPS required'))
          }

          if (!metadataOnly && (this.isLive || this.isPostLiveDvr)) {
            // The live DASH manifest is currently unusable as it returns 403s after 1 minute of playback
            // so we have to use the HLS one for now.
            // Leaving the code here commented out in case we can use it again in the future
            // const url = `${this.currentInvidiousInstanceUrl}/api/manifest/dash/id/${this.videoId}`

            // // Proxying doesn't work for live or post live DVR DASH, so use HLS instead
            // // https://github.com/iv-org/invidious/pull/4589
            // if (this.proxyVideos) {

            let hlsManifestUrl = result.hlsUrl

            if (isYattee) {
              if (!hlsManifestUrl) {
                throw this.createYatteeMissingStreamsError()
              }
              this.streamingDataExpiryDate = getYatteeStreamExpiry(hlsManifestUrl)
            } else {
              this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)
            }

            if (this.proxyVideos && !isYattee) {
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

            if (!metadataOnly) {
              if (isYattee) {
                if (result.adaptiveFormats.length === 0 && result.formatStreams.length === 0) {
                  throw this.createYatteeMissingStreamsError()
                }
                this.streamingDataExpiryDate = getYatteeStreamExpiry((result.adaptiveFormats[0] ?? result.formatStreams[0]).url)
              } else {
                this.streamingDataExpiryDate = this.extractExpiryDateFromStreamingUrl(result.adaptiveFormats[0].url)
              }

              this.legacyFormats = result.formatStreams.map(mapInvidiousLegacyFormat)

              // The streams of Yattee servers are already relayed when proxying is enabled
              if (!isYattee && (!process.env.SUPPORTS_LOCAL_API || this.proxyVideos)) {
                this.legacyFormats.forEach(format => {
                  format.url = getProxyUrl(format.url)
                })
              }
            }

            this.vrProjection = [...result.adaptiveFormats, ...result.formatStreams]
              .find(stream => {
                return typeof stream.projectionType === 'string' &&
                  stream.projectionType !== 'RECTANGULAR'
              })
              ?.projectionType ?? null

            if (!metadataOnly) {
              let vrHlsManifestUrl = null
              if (this.vrProjection === 'MESH' && result.hlsUrl && !this.isYtDlpPlaybackRequested()) {
                const switchGeneration = this.playbackEngineSwitchGeneration
                let url = result.hlsUrl
                // Invidious only: Yattee relays its own signed URLs
                if (this.proxyVideos && !isYattee) {
                  const proxyUrl = new URL(url)
                  proxyUrl.searchParams.set('local', 'true')
                  url = proxyUrl.toString()
                }
                const playable = await probeHlsManifest(url)
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) return
                if (playable && switchGeneration === this.playbackEngineSwitchGeneration && !this.isYtDlpPlaybackRequested()) {
                  vrHlsManifestUrl = url
                  this.vrProjection = 'EQUIRECTANGULAR'
                }
              }
              if (this.vrProjection === 'MESH' && supportsYtDlp && this.videoPlaybackEngine === 'built-in' &&
                this.$store.getters.getPlaybackEngineFallback) {
                this.playbackEngineFallbackTarget = 'yt-dlp'
              }

              if (vrHlsManifestUrl) {
                this.manifestSrc = vrHlsManifestUrl
                this.manifestMimeType = MANIFEST_TYPE_HLS
                this.activeFormat = 'dash'
              } else {
                const manifestSrc = await this.createInvidiousDashManifest(result)
                if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
                this.manifestSrc = manifestSrc
                this.manifestMimeType = MANIFEST_TYPE_DASH
              }
            }
          }

          if (!metadataOnly && !this.isUpcoming) {
            if (!this.applyDownloadedPlaybackSource()) {
              this.alignActiveFormatWithAvailableSources()

              // Deliberately not awaited, so that the metadata (title, description,
              // comments, recommendations, ...) is shown while yt-dlp is still extracting.
              this.applyYtDlpPlaybackSource(loadGeneration, videoId)
            }
          }

          this.updateShortsPlayerState(result.lengthSeconds, result.adaptiveFormats)
          if (!metadataOnly && this.customShortsPlayerActive) {
            const currentKey = this.getShortsExtractionKey(videoId, 'invidious')
            if (shortsExtractionKey === currentKey) {
              this.shortsPlaybackCache.set(currentKey, result)
            }
          }
          this.updateShortThumbnail()
          this.updateTitle()

          this.isLoading = false
          this.downloadedPlaybackWithoutMetadata = false
        })
        .catch(async err => {
          backendFailed = true
          if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
          const canFallback = process.env.SUPPORTS_LOCAL_API && usesInvidiousApi(this.backendPreference) && this.backendFallback
          if (canFallback) showInvidiousFallbackToast(this.backendPreference)
          if (metadataOnly) {
            if (canFallback) return this.getVideoInformationLocal(loadGeneration, true)
            console.error('Could not restore downloaded video metadata', err)
            return
          }

          console.error(err)
          if (canFallback) {
            const errorMessage = isYattee ? this.t('Yattee Server.API Error (Click to copy)') : this.t('Invidious API Error (Click to copy)')
            showApiErrorToast(errorMessage, err, this.showTabToast)
            this.getVideoInformationLocal(loadGeneration)
          } else {
            const restrictedPlaybackError = this.getRestrictedPlaybackErrorType(err.message || err.toString())
            if (restrictedPlaybackError !== null) {
              this.isLoading = false
              this.thumbnail ||= this.getUnavailableVideoThumbnail()
              this.setRestrictedPlaybackError(restrictedPlaybackError)
              return
            }

            if (/\bprivate video\b|\bvideo is private\b/i.test(err.message || err.toString())) {
              if (this.finishDownloadedPlaybackWithoutMetadata()) return
              this.isLoading = false
              this.thumbnail ||= this.getUnavailableVideoThumbnail()
              this.setNonRetryablePlaybackError('private')
              return
            }

            const didReload = await this.runIpBlockRecoveryScriptAndReload()
            if (!this.isCurrentVideoLoad(loadGeneration, videoId)) { return }
            if (didReload) {
              return
            }

            if (this.finishDownloadedPlaybackWithoutMetadata()) return

            this.isLoading = false

            if (!this.thumbnail) {
              this.thumbnail = this.getUnavailableVideoThumbnail()
            }
            this.errorMessage = err.message || err.toString()
          }
        })
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
      this.trackRecommendationWatch(currentSeconds)
      this.watchTimeTracker.track()
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

    handleTimeUpdate: function (currentSeconds, fromChromecast = false) {
      if (this.videoId !== this.tabRoute.params.id) return
      if (this.chromecastActive && !fromChromecast) return
      // Once the refreshed stream has actually played a stretch of content it
      // has proven itself, so refill the budget: a later, unrelated SABR
      // failure gets its own refetch instead of dropping straight to legacy
      // 360p. Only natural playback ticks count towards that, so seeking around
      // a stream that never plays can't keep the budget topped up.
      if (this.sabrErrorRecoveryLastSeconds !== null) {
        const elapsed = currentSeconds - this.sabrErrorRecoveryLastSeconds
        this.sabrErrorRecoveryLastSeconds = currentSeconds

        if (elapsed > 0 && elapsed <= SABR_ERROR_RECOVERY_MAX_TICK_SECONDS) {
          this.sabrErrorRecoveryPlayedSeconds += elapsed

          if (this.sabrErrorRecoveryPlayedSeconds >= SABR_ERROR_RECOVERY_SETTLE_SECONDS) {
            console.warn(`SABR stream for ${this.videoId} settled after playing ${SABR_ERROR_RECOVERY_SETTLE_SECONDS}s since its last reload`)
            this.sabrErrorRecoveryAttempts = 0
            this.sabrErrorRecoveryLastSeconds = null
            this.sabrErrorRecoveryPlayedSeconds = 0
          }
        }
      }

      const elapsedSeconds = currentSeconds - this.currentTime
      const shortsCompletion = getShortsCompletionState({
        blockedBySeek: this.shortsCompletionBlockedBySeek,
        playbackAfterSeekSeconds: this.shortsPlaybackAfterSeekSeconds,
        elapsedSeconds,
        currentSeconds,
        durationSeconds: this.videoLengthSeconds
      })
      this.shortsCompletionBlockedBySeek = shortsCompletion.blockedBySeek
      this.shortsPlaybackAfterSeekSeconds = shortsCompletion.playbackAfterSeekSeconds

      // A looping media element does not fire `ended`. Persist the completed
      // state just before a Short wraps to zero, but never from a seek-driven
      // time update.
      const shortReachedEnd = shortsCompletion.reachedEnd

      this.updateCurrentTime(currentSeconds)

      if (
        this.rememberHistory &&
        this.customShortsPlayerActive &&
        !this.shortsPlaybackCompleted &&
        !this.isUpcoming &&
        !this.isLive &&
        this.videoLengthSeconds > 0 &&
        // pause() queues a timeupdate before a subsequent seek's seeking event.
        // That update already sees the new time, but is not played content.
        this.$refs.player?.hasLoaded &&
        !this.$refs.player.isPaused() &&
        shortReachedEnd
      ) {
        this.shortsPlaybackCompleted = true
        const watchProgress = this.watchedProgressSavingEnabled
          ? this.videoLengthSeconds
          : (this.historyEntry?.watchProgress ?? 0)

        this.addToHistory(watchProgress, true)
      }

      this.updateCurrentChapter(currentSeconds)
      this.$store.commit('setCurrentWatchTimestamp', {
        tabId: this.tabId,
        value: currentSeconds
      })
    },

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
      return this.updateHistory(videoData)
    },

    keepHistoryEntryAlive(currentSeconds) {
      const now = Date.now()
      if (
        !this.rememberHistory ||
        !this.historyRetentionEnabled ||
        !this.videoPlayerLoaded ||
        this.isUpcoming ||
        this.isLive ||
        this.isPlaybackPaused() ||
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
        isHistoryEntryWatched(this.historyEntry) ||
        // The cache only reflects the watched state once the datastore write
        // completes; this runs on every time update, so do not queue the same
        // write again while the first one is still in flight.
        this.watchedMarkPendingVideoIds.has(this.videoId)
      ) {
        return
      }

      if (!isFinished && this.isPlaybackPaused()) {
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

        const videoId = this.videoId
        this.watchedMarkPendingVideoIds.add(videoId)
        this.addToHistory(watchProgress, true).finally(() => {
          this.watchedMarkPendingVideoIds.delete(videoId)
        })
      }
    },

    handleWatchProgressManualSave() {
      // Should be called by manual action, settings should be checked in UI
      this._saveWatchProgress()
      showToast({ message: this.t('Video.Watched Progress Saved'), icon: ['fas', 'save'] })
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
      this.recommendationPlaybackSample = null
      // A reload remembers whether the outgoing player was playing, but the
      // user can still pause it before the replacement starts loading. Do not
      // let that stale snapshot restart the replacement player. Ignore pauses
      // emitted while the outgoing player is being torn down.
      if (
        !this.isLoading &&
        !this.playerTeardownInProgress &&
        this.resumePlaybackAfterSabrReload
      ) {
        this.resumePlaybackAfterSabrReload = false
        this.suppressAutoplayAfterSabrReload = true
      }
      this.flushWatchTime()
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
    },
    isPlaybackPaused() {
      return this.chromecastStatus?.paused ?? this.$refs.player?.isPaused() ?? true
    },
    handleChromecastState(state) {
      this.chromecastStatus = state
      this.handleTimeUpdate(state.currentTime, true)
    },
    handleChromecastChange(active) {
      this.chromecastActive = active
      if (!active) this.chromecastStatus = null
    },
    async getChromecastSource() {
      const source = selectCastSource(this.legacyFormats, this.manifestSrc, this.manifestMimeType)
      if (!supportsYtDlp || this.manifestMimeType !== MANIFEST_TYPE_SABR) return source
      try {
        const extracted = await getYtDlpPlaybackSource(this.videoId, this.ytDlpPlaybackCacheKey, undefined,
          this.alwaysUseYtDlpPlaybackCookies, false, false)
        return (extracted && selectCastSource(extracted.legacyFormats, extracted.manifestSrc, extracted.manifestMimeType)) ?? source
      } catch (error) {
        if (source) return source
        throw error
      }
    },
    handleVideoPlay() {
      if (this.chromecastActive) {
        this.$refs.player?.pause()
        return
      }
      this.waitingForPlaylistContinuation = false
      this.$refs.watchVideoPlaylist?.resetUnavailableSkipChain()
    },
    handlePlayerSeeking() {
      this.waitingForPlaylistContinuation = false
      this.liveChatSeekRequest = { seconds: this.$refs.player.getCurrentTime() }

      if (!this.customShortsPlayerActive) {
        return
      }

      this.shortsCompletionBlockedBySeek = true
      this.shortsPlaybackAfterSeekSeconds = 0
    },
    trackRecommendationWatch(time) {
      if (!this.rememberHistory || !this.$store.getters.getEnableHomeRecommendations || this.isLoading || !this.$refs.player?.hasLoaded) {
        this.recommendationPlaybackSample = null
        this.recommendationWatchSession = null
        return
      }
      const epoch = this.$store.getters.getRecommendationEpoch
      if (!epoch) {
        if (Date.now() >= this.recommendationLoadRetryAt) {
          this.recommendationLoadRetryAt = Date.now() + 30_000
          this.$store.dispatch('loadRecommendations').catch(error => console.error('Could not load recommendation learning', error))
        }
        return
      }
      this.recommendationLoadRetryAt = 0
      if (this.recommendationWatchSession?.videoId !== this.videoId || this.recommendationWatchSession.epoch !== epoch) {
        this.recommendationWatchSession = { videoId: this.videoId, epoch, sessionId: crypto.randomUUID(), seconds: 0, savedSeconds: 0 }
        this.recommendationPlaybackSample = null
      }
      const { current, seconds } = sampleRecommendationPlayback(this.recommendationPlaybackSample, {
        videoId: this.videoId,
        time,
        now: Date.now(),
        playing: !this.isPlaybackPaused(),
        rate: this.currentPlaybackRate ?? 1,
      })
      this.recommendationPlaybackSample = current
      this.recommendationWatchSession.seconds += seconds
      if (this.recommendationWatchSession.seconds - this.recommendationWatchSession.savedSeconds >= 30) this.flushRecommendationWatch()
    },
    async flushRecommendationWatch() {
      const session = this.recommendationWatchSession
      if (!session || session.videoId !== this.videoId || session.seconds <= session.savedSeconds) return
      session.savedSeconds = session.seconds
      try {
        await this.$store.dispatch('recordRecommendationEvent', {
          ...session,
          type: 'watch',
          video: {
            videoId: this.videoId,
            title: this.videoTitle,
            author: this.channelName,
            authorId: this.channelId,
            description: this.videoDescription,
            lengthSeconds: this.videoLengthSeconds,
            isShort: this.isShort,
          },
        })
      } catch (error) {
        console.error('Could not save recommendation learning', error)
      }
    },
    async flushWatchTime() {
      await Promise.all([this.flushRecommendationWatch(), this.watchTimeTracker.flush()])
    },
    /**
     * Whether this tab is currently the presented one. Without a logical-tab
     * context (the web build) there is nothing to hide behind, so treat the view
     * as presented.
     *
     * @returns {boolean}
     */
    isCurrentlyPresented() {
      return this.isTabPresented == null || this.isTabPresented === true
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
      if (!player?.hasPlaybackPosition && !this.chromecastStatus) { return }

      const currentTime = this.shortsPlaybackCompleted && this.watchedProgressSavingEnabled
        ? this.videoLengthSeconds
        : (this.chromecastStatus?.currentTime ?? player.getCurrentTime())
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

    handleVideoLoaded: async function (mediaMetadata) {
      if (this.isLoading || this.preparingVideoLoadGeneration !== null) { return }

      // Only used one time = remove after use
      this.oneTimeTimestamp = null
      this.sabrReloadState = null
      this.queuedPlaybackVideoId = null

      if (
        !this.localFilePlayback &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        this.activeFormat !== 'legacy'
      ) {
        this.sabrPlaybackLoaded = true
        if (this.onlinePlaybackSource !== null) {
          this.onlinePlaybackSource.hasBeenLoaded = true
        }
      }

      if (
        Number.isFinite(mediaMetadata?.duration) &&
        mediaMetadata.duration > 0 &&
        (this.tabRoute.query.downloadId || !Number.isFinite(this.videoLengthSeconds) || this.videoLengthSeconds <= 0)
      ) {
        this.videoLengthSeconds = mediaMetadata.duration
      }

      // will trigger again if you switch formats or change legacy quality
      // Check isUpcoming to avoid marking upcoming videos as watched if the user has only watched the trailer
      if (!this.videoPlayerLoaded && !this.isUpcoming) {
        this.videoPlayerLoaded = true

        if (this.rememberHistory) {
          if (this.timestamp !== null) {
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

        if ((process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && this.timestamp !== null) {
          await this.consumeTimestamp()
        }
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
        // If the page is accessed through navigation via router history, 'playlistId' is still specified
        // but the video could have been removed from the playlist in the meantime
        if (!this.selectedUserPlaylist.videos.some((video) => video.videoId === this.videoId)) {
          this.playlistId = ''
          this.playlistType = ''
          this.playlistItemId = null
          this.watchingPlaylist = false
          return
        }

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
      const oneTimeTimestamp = parseFloat(this.tabRoute.query.oneTimeTimestamp)
      this.oneTimeTimestamp = isNaN(oneTimeTimestamp) || oneTimeTimestamp < 0 ? null : oneTimeTimestamp

      const timestamp = parseInt(this.tabRoute.query.timestamp)
      this.timestamp = isNaN(timestamp) || timestamp < 0 ? null : timestamp
    },

    consumeTimestamp: async function () {
      const query = { ...this.tabRoute.query }
      if (!('timestamp' in query)) return

      delete query.timestamp
      await this.tabRouter.replace({
        path: this.tabRoute.path,
        query,
        hash: this.tabRoute.hash,
        state: {
          skipTabRouteLoading: true,
          tabTitle: this.videoTitle,
        },
      })
      this.timestamp = null
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

      if (!this.dashFormatAvailable) {
        showToast({
          message: this.t('Change Format.Dash formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'dash'
    },

    enableLegacyFormat: function () {
      if (this.activeFormat === 'legacy') {
        return
      }

      if (!this.legacyFormatAvailable) {
        showToast({
          message: this.t('Change Format.Legacy formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'legacy'
    },

    enableAudioFormat: function () {
      if (this.activeFormat === 'audio') {
        return
      }

      if (!this.audioFormatAvailable) {
        showToast({
          message: this.t('Change Format.Audio formats are not available for this video'),
          icon: ['fas', 'circle-exclamation'],
        })
        return
      }

      this.activeFormat = 'audio'
    },

    handlePlayerEnded: function (sleepTimerEnded = false) {
      if (!this.isCurrentlyPresented()) {
        return
      }
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
      if (!this.isCurrentlyPresented()) {
        return
      }
      this.handleWatchProgressAutoSaveWhenProgressEnabled()
      // Standalone YouTube-style Shorts stop for the replay control instead of
      // advancing. Playlist Shorts still follow the playlist autoplay setting.
      if (this.customShortsPlayerActive && this.isStandaloneShort) {
        return
      }
      if (this.playNextQueuedVideo()) {
        return
      }
      if (this.isStandaloneShort) {
        return
      }
      if (!this.autoplayEnabled) {
        return
      }

      if (this.blockVideoAutoplay) {
        showToast({
          message: this.t('Autoplay Interruption Timer',
            this.defaultAutoplayInterruptionIntervalHours,
            {
              autoplayInterruptionIntervalHours: this.defaultAutoplayInterruptionIntervalHours
            }),
          time: 3_600_000,
          icon: ['fas', 'clock'],
        })
        this.resetAutoplayInterruptionTimeout()
        return
      }

      if (this.watchingPlaylist && this.$refs.watchVideoPlaylist?.isWaitingForNextVideo) {
        this.waitingForPlaylistContinuation = true
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

    /**
     * @param {{ videoId: string, isMusic?: boolean }} video
     */
    watchRouteForVideo: function (video) {
      const downloadId = navigationDownloadId(this.$store.getters, video.videoId)
      const query = {
        ...(video.isMusic === true ? { musicVideo: 'true' } : {}),
        ...(downloadId ? { downloadId } : {})
      }
      return {
        path: `/watch/${video.videoId}`,
        ...(Object.keys(query).length > 0 ? { query } : {})
      }
    },

    playNextVideoNow: function (forcePlayback = true) {
      const player = this.$refs.player
      const nextVideo = this.autoplayCountdown?.video ?? this.nextRecommendedVideo

      this.abortAutoplayCountdown(true)

      if (!forcePlayback && !player?.isPaused()) {
        return
      }

      if (this.watchingPlaylist) {
        this.$refs.watchVideoPlaylist?.playNextVideo()
      } else if (!this.isOffline && nextVideo?.videoId) {
        this.tabRouter.push(this.watchRouteForVideo(nextVideo))
        showToast({ message: this.t('Playing Next Video'), icon: ['fas', 'step-forward'] })
      }
    },

    // Skip to the next video if in a playlist
    // else next recommended video if autoplay enabled
    handleSkipToNext: function () {
      if (this.playNextQueuedVideo()) {
        return
      }
      if (this.watchingPlaylist) {
        this.$refs.watchVideoPlaylist?.playNextVideo()
      } else if (!this.hideRecommendedVideos && this.nextRecommendedVideo) {
        this.tabRouter.push(this.watchRouteForVideo(this.nextRecommendedVideo))
        showToast({ message: this.t('Playing Next Video'), icon: ['fas', 'step-forward'] })
      }
    },

    playNextQueuedVideo: function () {
      const nextVideo = this.nextQueuedVideo
      if (!nextVideo?.videoId) {
        return false
      }

      this.$store.commit('removeVideoFromWatchQueue', nextVideo.queueItemId)
      const route = nextVideo.route ?? this.watchRouteForVideo(nextVideo)
      const nextFullPath = this.tabRouter.resolve(route).fullPath
      if (
        this.watchRouteWithoutTimestamp(nextFullPath) ===
        this.watchRouteWithoutTimestamp(this.tabRoute.fullPath)
      ) {
        this.$refs.player?.setCurrentTime(0)
        this.$refs.player?.play()
      } else {
        this.queuedPlaybackVideoId = nextVideo.videoId
        this.tabRouter.push(route)
      }
      showToast({ message: this.t('Playing Next Video'), icon: ['fas', 'step-forward'] })
      return true
    },

    /**
     * @param {{ canPlayNext: boolean, canPlayPrevious: boolean }} availability
     */
    handlePlaylistSkipAvailabilityChange: function (availability) {
      this.playlistSkipAvailability = availability
    },

    // Keeps the operating system's media controls in sync with the player's skip
    // buttons, so that both offer the same skips and take the same route to them
    syncMediaSessionSkipHandlers: function () {
      tabMediaCoordinator.setActionHandlers(this.tabId ?? 'web', 'playlist', {
        previoustrack: this.canSkipToPreviousVideo ? this.handleSkipToPrev : null,
        nexttrack: this.canSkipToNextVideo ? this.handleSkipToNext : null
      })
    },

    // Skip to the previous video in a playlist
    handleSkipToPrev: function () {
      this.$refs.watchVideoPlaylist?.playPreviousVideo()
    },

    abortAutoplayCountdown: function (hideToast = false) {
      this.waitingForPlaylistContinuation = false
      clearTimeout(this.playNextTimeout)
      clearInterval(this.playNextCountDownIntervalId)
      this.playNextTimeout = null
      this.playNextCountDownIntervalId = null
      this.autoplayCountdown = null

      if (!hideToast) {
        showToast({ message: this.t('Canceled next video autoplay'), icon: ['fas', 'times-circle'] })
      }
    },

    handleRouteChange: async function () {
      await this.$refs.chromecast?.stopCasting(false)
      this.abortAutoplayCountdown(true)
      this.handleWatchProgressAutoSave()
      await this.flushWatchTime()
    },

    /**
     * @param {import('shaka-player/dist/shaka-player.ui').default.util.Error} error
     */
    handlePlayerError: async function (error) {
      // the error is logged to the console inside the player so we don't have to do it here

      // The player is only rendered while loading is false. An error received
      // after loading starts belongs to the outgoing player during its unmount
      // tick and must not change the new player's format or trigger a reload.
      if (this.isLoading) {
        return
      }

      const { Code } = shaka.util.Error

      if (error.code === Code.HTTP_ERROR) {
        if (!navigator.onLine) {
          // WebKit and native transports use different error messages. Keep
          // the current stream: Shaka retries it on the window online event.
          return
        }

        if (this.isAndroidTransientHttpRecoveryEnabled() && await this.retryAndroidTransientHttpError()) {
          return
        }
      }

      // A terminal player error can still come from a transiently bad yt-dlp
      // URL or extraction. Refresh those streams once before changing format or
      // restoring the cached built-in source (which may use SABR).
      if (this.activePlaybackEngine === 'yt-dlp') {
        if (error.code !== Code.TIMEOUT) {
          invalidateYtDlpPlaybackSource(this.videoId)
        }
        const status = error.code === Code.BAD_HTTP_STATUS ? error.data[1] : error.code
        const playbackUrl = error.code === Code.TIMEOUT ? error.data?.[0] : undefined
        if (await this.reloadYtDlpPlayerAfterStreamErrorOnce(`[PLAYER_ERROR: ${status}]`, playbackUrl)) {
          return
        }
      }

      if (error.code === Code.BAD_HTTP_STATUS) {
        switch (error.data[1]) {
          case 429:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            if (await this.tryPlaybackEngineFallback(error)) {
              return
            }

            this.errorMessage = '[BAD_HTTP_STATUS: 429] Ratelimited'
            return
          case 403:
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            // Streaming URLs are bound to the IP they were issued to, so they also
            // start returning 403 when our own IP changes (reconnect, prefix rotation,
            // VPN switch). An expired watch session likewise needs a fresh fetch.
            // Reload once before escalating — to the IP block recovery script, or to
            // the session-expired error — so the genuine failure paths are unchanged
            // apart from the extra reload before them.
            {
              const sessionExpired = new Date() > this.streamingDataExpiryDate
              const specificError = sessionExpired
                ? '[BAD_HTTP_STATUS: 403] YouTube watch session expired. Please reopen this video.'
                : this.isMusicVideo
                  ? '[BAD_HTTP_STATUS: 403] Potential causes: IP block, streaming URL deciphering failed or music video geo-block'
                  : '[BAD_HTTP_STATUS: 403] Potential causes: IP block or streaming URL deciphering failed'

              if (await this.reloadAfterStreamErrorOnce(specificError)) {
                return
              }

              if (await this.tryPlaybackEngineFallback(error)) {
                return
              }

              if (sessionExpired) {
                this.errorMessage = specificError
                this.customErrorIcon = ['fas', 'clock']
                return
              }

              this.errorMessage = specificError
              this.ipBlockDetectedInCurrentChain = true
              await this.runIpBlockRecoveryScriptAndReload()
              return
            }
        }
      } else if (error.code === Code.VIDEO_ERROR) {
        if (this.activeFormat === 'legacy') {
          if (new Date() > this.streamingDataExpiryDate) {
            this.handleWatchProgressAutoSaveWhenProgressEnabled()

            const specificError = '[VIDEO_ERROR] YouTube watch session expired. Please reopen this video.'

            if (await this.reloadAfterStreamErrorOnce(specificError)) {
              return
            }

            if (await this.tryPlaybackEngineFallback(error)) {
              return
            }

            this.errorMessage = specificError
            this.customErrorIcon = ['fas', 'clock']
            return
          }
        }
      }

      if (
        await this.reloadSabrStream(
          this.$refs.player?.getSabrReloadState(),
          'Refreshing SABR stream after playback error'
        )
      ) { return }

      // yt-dlp legacy formats come from the same extraction as its DASH
      // formats. Prefer the independent built-in source after the one-shot
      // yt-dlp refresh above, and keep legacy as the last resort when no
      // built-in source is available.
      if (
        this.activePlaybackEngine === 'yt-dlp' &&
        await this.tryPlaybackEngineFallback(error)
      ) {
        return
      }

      const stopPlaybackRecovery = async () => {
        if (await this.tryPlaybackEngineFallback(error)) {
          return
        }

        this.handleWatchProgressAutoSaveWhenProgressEnabled()
        const status = error.code === Code.BAD_HTTP_STATUS ? error.data[1] : error.code
        this.errorMessage = `[PLAYER_ERROR: ${status}] Unable to recover the video stream. Please reload this video.`
      }

      if (
        this.activeFormat === 'dash' &&
        this.manifestMimeType === MANIFEST_TYPE_SABR &&
        !this.isLive &&
        !this.isPostLiveDvr &&
        this.legacyFormats.length === 0
      ) {
        // Audio is an explicit playback mode, not a degraded video fallback.
        // Keep the bounded refresh behavior above, then stop with the actual
        // error instead of briefly replacing the video player with audio.
        await stopPlaybackRecovery()
        return
      }

      if (this.isLive || this.isPostLiveDvr) {
        if (this.activeFormat === 'dash') {
          await stopPlaybackRecovery()
        } else {
          console.error('Unable to play audio formats. Reverting to DASH formats...')
          this.enableDashFormat()
        }
      } else {
        // Audio remains available when explicitly selected, but a broken video
        // stream must never silently turn into audio-only playback.

        switch (this.activeFormat) {
          case 'dash':
            if (this.legacyFormats.length > 0) {
              console.error('Unable to play DASH formats. Reverting to legacy formats...')
              this.enableLegacyFormat()
            } else {
              await stopPlaybackRecovery()
            }
            break
          case 'legacy':
            await stopPlaybackRecovery()
            break
          case 'audio':
            console.error('Unable to play audio formats. Reverting to DASH formats...')
            this.enableDashFormat()
            break
        }
      }
    },

    ...watchYtDlpPlaybackMethods,

    /**
     * @param {import('youtubei.js').YT.VideoInfo} videoInfo
     * @param {boolean} includeThumbnails
     */
    createLocalDashManifest: async function (videoInfo, includeThumbnails = false) {
      const formats = new Set(getCompatibleAdaptiveFormats(videoInfo.streaming_data.adaptive_formats))
      const xmlData = await videoInfo.toDash({
        format_filter: format => format.has_video && !format.has_audio && !formats.has(format),
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
     */
    createLocalSabrManifest: function (videoInfo, poToken, clientInfo, storyboards) {
      const url = new URL(videoInfo.streaming_data.server_abr_streaming_url)
      url.searchParams.set('cpn', videoInfo.cpn)
      // Shaka's scheme registry is renderer-global. Each retained tab therefore
      // needs its own scheme so one SABR player cannot replace or unregister
      // another player's request handler.
      const scheme = `sabr${nextSabrSchemeId++}`
      const formats = getCompatibleAdaptiveFormats(videoInfo.streaming_data.adaptive_formats)
      const formatDurationsMs = formats
        .map(format => format.approx_duration_ms)
        .filter(Number.isFinite)
      const fallbackDurationSeconds = Number.isFinite(videoInfo.basic_info.duration)
        ? videoInfo.basic_info.duration
        : 0

      this.sabrData = {
        scheme,
        url: url.toString(),
        poToken,
        ustreamerConfig: videoInfo.player_config.media_common_config.media_ustreamer_request_config.video_playback_ustreamer_config,
        clientInfo
      }

      /** @type {import('../../helpers/player/SabrManifestParser').SabrManifest} */
      const sabrManifest = {
        scheme,
        // Different formats have different durations and
        // use of slightly longer duration in PresentationTimeline causes player to stuck at the end
        duration: formatDurationsMs.length > 0
          ? Math.min(...formatDurationsMs) / 1000
          : fallbackDurationSeconds,
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

    createYatteeMissingStreamsError: function () {
      // Only blame relaying when the server was asked to relay the streams
      return new Error(this.$store.getters.getYatteeProxyVideos
        ? this.t('Yattee Server.Errors.Streams not relayed')
        : this.t('Yattee Server.Errors.Streams unavailable'))
    },

    createInvidiousDashManifest: async function (result) {
      if (this.backendPreference === 'yattee') {
        const manifest = await createYatteeDashManifest(result.adaptiveFormats, result.lengthSeconds, this.apiServerUrl)
        // Without adaptive streams, the muxed streams can still play
        if (manifest === null && this.legacyFormats.length === 0) {
          throw new Error(this.t('Yattee Server.Errors.Streams unavailable'))
        }
        return manifest
      }

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
            generateAudioTrackField(format, languageNames)
          }
        }

        const manifest = await generateInvidiousDashManifestLocally(formats)

        url = `data:application/dash+xml;charset=UTF-8,${encodeURIComponent(manifest)}`
      } else if (this.proxyVideos) {
        url += '?local=true'
      }

      return url
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
     * @param {string | null | undefined} originalLanguage
     * @returns {null|{ url: string, label: string, language: string, mimeType: string, isAutotranslated: boolean }}
     */
    getTranslatedLocaleCaption: function (captions, userLanguages, originalLanguage) {
      // check if we can translate to the users language
      let translationLanguage = captions.translation_languages.find(language => userLanguages.has(language.language_code))

      // Otherwise use the preferred caption locale and hope that YouTube can handle it.
      if (!translationLanguage) {
        const languageCode = userLanguages.values().next().value
        translationLanguage = {
          language_code: languageCode,
          language_name: {
            text: this.$store.getters.getPreferredCaptionLocale
              ? new Intl.DisplayNames([this.currentLocale, 'en'], { type: 'language' }).of(languageCode) ?? languageCode
              : this.t('Locale Name')
          }
        }
      }

      return this.getTranslatedCaption(captions, translationLanguage, originalLanguage)
    },

    /**
     * Translates the video's captions into the language last picked from the player's auto-translate menu,
     * unless they are already in that language.
     * @param {import('youtubei.js').YTNodes.PlayerCaptionsTracklist} captions
     * @param {string | null | undefined} originalLanguage
     * @returns {null|{ url: string, label: string, language: string, mimeType: string, isAutotranslated: boolean, isPreferredTranslation: boolean }}
     */
    getRememberedTranslatedCaption: function (captions, originalLanguage) {
      const languageCode = this.$store.getters.getAutoTranslatedCaptionLocale
      const translationLanguage = languageCode && captions.translation_languages?.find(language => language.language_code === languageCode)
      const trackToTranslate = translationLanguage && getCaptionTranslationSource(captions.caption_tracks, originalLanguage)

      if (!trackToTranslate || normalizeYouTubeCaptionLanguageCode(trackToTranslate.language_code) === normalizeYouTubeCaptionLanguageCode(languageCode)) {
        return null
      }

      const caption = this.getTranslatedCaption(captions, translationLanguage, originalLanguage)
      return caption && { ...caption, isPreferredTranslation: true }
    },

    /**
     * @param {import('youtubei.js').YTNodes.PlayerCaptionsTracklist} captions
     * @param {{ language_code: string, language_name: { text: string } }} translationLanguage
     * @param {string | null | undefined} originalLanguage
     * @returns {null|{ url: string, label: string, language: string, mimeType: string, isAutotranslated: boolean }}
     */
    getTranslatedCaption: function (captions, translationLanguage, originalLanguage) {
      const translationName = translationLanguage.language_name.text
      const translationCode = translationLanguage.language_code

      const trackToTranslate = getCaptionTranslationSource(captions.caption_tracks, originalLanguage)

      if (!trackToTranslate) {
        return null
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
        translationName,
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
      if (!this.isLoading && this.chromecastActive && this.chromecastStatus) {
        return this.chromecastStatus.currentTime
      }
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
      this.setTabTitle(
        this.videoTitle || this.getPendingVideoTitle(),
        { resolveHistoryEntry: this.hasResolvedVideoTitle }
      )
    },

    isHiddenVideo: function (forbiddenTitles, channelsHidden, video) {
      return channelsHidden.some(ch => ch.name === video.authorId || ch.name === video.collaborators?.[0]?.id) ||
        channelsHidden.some(ch => ch.name === video.author) ||
        isOnAiSlopList(this.$store.getters.getAiSlopBlockedChannels, video) ||
        forbiddenTitles.some((text) => video.title?.toLowerCase().includes(text)) ||
        forbiddenTitles.some((text) => video.author?.toLowerCase().includes(text))
    },

    toggleAutoplay: function() {
      this.waitingForPlaylistContinuation = false
      if (this.isShort) {
        return
      }
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

    ...watchPlaybackPreferencesMethods,

    destroyPlayer: async function(player = this.$refs.player) {
      this.playerTeardownInProgress = true
      try {
        const uiState = await player.destroyPlayer()
        this.startNextVideoInFullscreen = uiState.startNextVideoInFullscreen
        this.startNextVideoInFullwindow = uiState.startNextVideoInFullwindow
        this.startNextVideoInPip = uiState.startNextVideoInPip
        this.nextVideoAutoPictureInPictureState = uiState.autoPictureInPictureState
        this.startNextVideoWithChapters = uiState.startNextVideoWithChapters
        this.startNextVideoWithFullscreenMetadata = uiState.startNextVideoWithFullscreenMetadata
        this.startNextVideoWithFullscreenComments = uiState.startNextVideoWithFullscreenComments
        this.startNextVideoWithFullscreenLiveChat = uiState.startNextVideoWithFullscreenLiveChat
        this.startNextVideoWithFullscreenPlaylist = uiState.startNextVideoWithFullscreenPlaylist
        this.startNextVideoWithFullscreenQueue = uiState.startNextVideoWithFullscreenQueue
        this.startNextVideoWithFullscreenRecommendations = uiState.startNextVideoWithFullscreenRecommendations
      } finally {
        this.playerTeardownInProgress = false
      }
    },

    ...watchPlaybackRecoveryMethods,

    ...mapActions([
      'updateHistory',
      'updateWatchProgress',
      'updateLastViewedPlaylist',
      'updatePlaylistLastPlayedAt',
      'updateSubscriptionDetails',
    ])
  }
})
