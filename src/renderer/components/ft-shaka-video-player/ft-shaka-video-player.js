import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import shaka from 'shaka-player'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { KeyboardShortcuts } from '../../../constants'
import { useTabContext } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'
import { AmbientModeButton } from './player-components/AmbientModeButton'
import { AudioTrackSelection } from './player-components/AudioTrackSelection'
import { CaptionSelection } from './player-components/CaptionSelection'
import { CaptionToggleButton } from './player-components/CaptionToggleButton'
import { ChapterOverlayButton } from './player-components/ChapterOverlayButton'
import { CopyVideoUrlButton, setCopyVideoUrlContext } from './player-components/CopyVideoUrlButton'
import { FullWindowButton } from './player-components/FullWindowButton'
import { LegacyQualitySelection } from './player-components/LegacyQualitySelection'
import { LoopButton } from './player-components/LoopButton'
import { QuickPlaybackRateBar, setQuickPlaybackRateBarContext } from './player-components/QuickPlaybackRateBar'
import { ScreenshotButton } from './player-components/ScreenshotButton'
import { SkipSilenceButton } from './player-components/SkipSilenceButton'
import { SleepTimer } from './player-components/SleepTimer'
import { SponsorBlockCancelButton } from './player-components/SponsorBlockCancelButton'
import { SponsorBlockClearButton } from './player-components/SponsorBlockClearButton'
import { SponsorBlockEndButton } from './player-components/SponsorBlockEndButton'
import { SponsorBlockHighlightButton } from './player-components/SponsorBlockHighlightButton'
import { SponsorBlockOpenMenuButton } from './player-components/SponsorBlockOpenMenuButton'
import { SponsorBlockStartButton } from './player-components/SponsorBlockStartButton'
import { StatsButton } from './player-components/StatsButton'
import { TheatreModeButton } from './player-components/TheatreModeButton'
import { AutoplayToggle } from './player-components/AutoplayToggle'
import { SkipButton } from './player-components/SkipButton'
import { FtPlaybackAdjustedTime } from './player-components/FtPlaybackAdjustedTime'
import {
  deduplicateAudioTracks,
  findMostSimilarAudioBandwidth,
  getPreferredCaption,
  getSponsorBlockSegments,
  logShakaError,
  repairInvidiousManifest,
  translateSponsorBlockCategory
} from '../../helpers/player/utils'
import {
  addKeyboardShortcutToActionTitle,
  formatDurationAsTimestamp,
  showToast,
  writeFileWithPicker,
  throttle,
  removeFromArrayIfExists,
  copyToClipboard,
} from '../../helpers/utils'
import { colors } from '../../helpers/colors'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../helpers/share'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { setupSabrScheme } from '../../helpers/player/SabrSchemePlugin'
import { getRememberedPlayerVolume, setRememberedPlayerVolume } from '../../helpers/player/volume-storage'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import { voteOnSponsorBlockSegment } from '../../helpers/sponsorblock'
import {
  DEFAULT_CAPTION_SETTINGS,
  getCaptionCssVariables,
  parseCaptionSettings,
} from '../../helpers/player/caption-settings'
import { useAmbientMode } from './opentubex/useAmbientMode'
import { useAutoPictureInPicture } from './opentubex/useAutoPictureInPicture'
import { useScrollMiniPlayer } from './opentubex/useScrollMiniPlayer'
import { useSilenceSkipping } from './opentubex/useSilenceSkipping'
import { useSleepTimer } from './opentubex/useSleepTimer'
import { useSponsorBlockSubmission } from './opentubex/useSponsorBlockSubmission'
import FtVideoAnnotations from '../FtVideoAnnotations/FtVideoAnnotations.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import WatchVideoChapters from '../WatchVideoChapters/WatchVideoChapters.vue'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

/** @typedef {import('../../helpers/sponsorblock').SponsorBlockCategory} SponsorBlockCategory */

const SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS = 5000
const SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS = 0.1
const SPONSORBLOCK_TERMINAL_OUTRO_TOLERANCE_SECONDS = 1
const SPONSORBLOCK_NOT_FOUND_REFETCH_RECENT_VIDEO_AGE_MS = 24 * 60 * 60 * 1000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS = 10000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS = 40000
const SPONSORBLOCK_CATEGORIES = Object.freeze([
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'hook',
  'music_offtopic',
  'filler',
  'poi_highlight',
])
const SPONSORBLOCK_INFO_ACTION_TYPES = Object.freeze(['skip', 'mute', 'full', 'poi'])
const SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS = 150
const FULL_WINDOW_ANIMATION_DURATION_MS = 400

// The UTF-8 characters "h", "t", "t", and "p".
const HTTP_IN_HEX = 0x68747470

const USE_OVERFLOW_MENU_WIDTH_THRESHOLD = 634
const TEMPORARY_PLAYBACK_RATE_MULTIPLIER = 2
const TEMPORARY_PLAYBACK_RATE_HOLD_DELAY_MS = 625
const TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE = 'keyboard'
const TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE = 'pointer'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const PLAY_MORPH_PATH = 'M8 6 11.5 8.1 11.5 15.9 8 18ZM11.5 8.1 18 12 18 12 11.5 15.9Z'

// Shaka's UI element registries (Controls/OverflowMenu/ContextMenu) are
// process-global and shared by every live player instance. Track how many
// players currently rely on the custom element factories so the shared registry
// is only reset once the last one unmounts (see cleanUpCustomPlayerControls).
let liveCustomControlPlayers = 0

const RequestType = shaka.net.NetworkingEngine.RequestType
const AdvancedRequestType = shaka.net.NetworkingEngine.AdvancedRequestType
const TrackLabelFormat = shaka.ui.Overlay.TrackLabelFormat
const { Severity: ErrorSeverity, Category: ErrorCategory, Code: ErrorCode } = shaka.util.Error

const NORMAL_PLAYBACK_RATE = 1

/*
  Mapping of Shaka localization keys for control labels to FreeTube shortcuts.
  See: https://github.com/shaka-project/shaka-player/blob/main/ui/locales/en.json
*/
const shakaControlKeysToShortcuts = {
  MUTE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  UNMUTE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  PLAY: () => KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PAUSE: () => KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PICTURE_IN_PICTURE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  ENTER_PICTURE_IN_PICTURE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  EXIT_PICTURE_IN_PICTURE: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  CAPTIONS: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS,
  FULL_SCREEN: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN,
  EXIT_FULL_SCREEN: () => KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN
}

/** @type {Map<string, string>} */
const LOCALE_MAPPINGS = new Map(process.env.SHAKA_LOCALE_MAPPINGS)

export default defineComponent({
  name: 'FtShakaVideoPlayer',
  components: {
    FtShareButton,
    FtVideoAnnotations,
    WatchVideoChapters
  },
  props: {
    format: {
      type: String,
      required: true
    },
    manifestSrc: {
      type: String,
      default: null
    },
    manifestMimeType: {
      type: String,
      required: true
    },
    sabrData: {
      type: Object,
      default: null
    },
    legacyFormats: {
      type: Array,
      default: () => ([])
    },
    startTime: {
      type: Number,
      default: null
    },
    captions: {
      type: Array,
      default: () => ([])
    },
    chapters: {
      type: Array,
      default: () => ([])
    },
    currentChapterIndex: {
      type: Number,
      default: 0
    },
    chaptersKind: {
      type: String,
      default: 'chapters'
    },
    chaptersSrc: {
      type: String,
      default: ''
    },
    storyboardSrc: {
      type: String,
      default: ''
    },
    annotations: {
      type: Array,
      default: () => []
    },
    videoId: {
      type: String,
      default: ''
    },
    playlistId: {
      type: String,
      default: ''
    },
    title: {
      type: String,
      default: ''
    },
    thumbnail: {
      type: String,
      default: ''
    },
    theatrePossible: {
      type: Boolean,
      default: false
    },
    useTheatreMode: {
      type: Boolean,
      default: false
    },
    autoplayPossible: {
      type: Boolean,
      default: false
    },
    autoplayEnabled: {
      type: Boolean,
      default: false
    },
    autoplayCountdown: {
      type: Object,
      default: null
    },
    watchingPlaylist: {
      type: Boolean,
      default: false
    },
    vrProjection: {
      type: String,
      default: null
    },
    startInFullscreen: {
      type: Boolean,
      default: false
    },
    startInFullwindow: {
      type: Boolean,
      default: false
    },
    startInPip: {
      type: Boolean,
      default: false
    },
    startWithChapters: {
      type: Boolean,
      default: false
    },
    startWithFullscreenComments: {
      type: Boolean,
      default: false
    },
    startWithFullscreenPlaylist: {
      type: Boolean,
      default: false
    },
    channelId: {
      type: String,
      default: ''
    },
    published: {
      type: Number,
      default: 0
    },
    isLive: {
      type: Boolean,
      default: false
    },
    videoGenreIsMusic: {
      type: Boolean,
      default: false
    },
    currentPlaybackRate: {
      type: Number,
      default: 1
    },
    currentVideoQuality: {
      type: String,
      default: '720'
    },
    delayLoadUntilUnix: {
      type: Number,
      default: 0
    },
    sponsorBlockAutoSkipDisabled: {
      type: Boolean,
      default: false
    },
    commentsAvailable: {
      type: Boolean,
      default: false
    },
    resumePlaybackAfterSabrReload: {
      type: Boolean,
      default: false
    },
    sabrReloadCaptionIndex: {
      type: Number,
      default: null
    },
    sabrReloadPlaybackRate: {
      type: Number,
      default: null
    },
  },
  emits: [
    'error',
    'loaded',
    'ended',
    'pause',
    'timeupdate',
    'terminal-outro-started',
    'toggle-autoplay',
    'autoplay-cancel',
    'autoplay-play-now',
    'toggle-theatre-mode',
    'playback-rate-updated',
    'playback-rate-user-set',
    'save-channel-playback-speed',
    'video-quality-updated',
    'video-quality-user-set',
    'skip-to-next',
    'skip-to-prev',
    'player-reload-requested',
    'resume-playback-after-sabr-reload-done',
    'fullscreen-comments-change',
    'fullscreen-playlist-change',
    'add-to-playlist',
    'chapters-overlay-change',
    'chapter-thumbnails-change',
    'sponsorblock-info-change',
  ],
  setup: function (props, { emit, expose }) {
    const { locale, t } = useI18n()
    const { tabId, isTabPresented } = useTabContext()
    const mediaTabId = tabId ?? 'web'

    const autoplayNextVideo = computed(() => props.autoplayCountdown?.video ?? null)
    const autoplayThumbnail = computed(() => {
      const videoId = autoplayNextVideo.value?.videoId
      if (!videoId) {
        return thumbnailPlaceholder
      }

      if (store.getters.getThumbnailPreference === 'hidden') {
        return thumbnailPlaceholder
      }

      const baseUrl = store.getters.getBackendPreference === 'invidious'
        ? store.getters.getCurrentInvidiousInstanceUrl
        : 'https://i.ytimg.com'
      let thumbnailName = 'mqdefault.jpg'

      switch (store.getters.getThumbnailPreference) {
        case 'start':
          thumbnailName = 'mq1.jpg'
          break
        case 'middle':
          thumbnailName = 'mq2.jpg'
          break
        case 'end':
          thumbnailName = 'mq3.jpg'
          break
      }

      return `${baseUrl}/vi/${videoId}/${thumbnailName}`
    })
    const autoplayDuration = computed(() => {
      const lengthSeconds = Number(autoplayNextVideo.value?.lengthSeconds)
      return Number.isFinite(lengthSeconds) && lengthSeconds > 0
        ? formatDurationAsTimestamp(lengthSeconds)
        : ''
    })

    function cancelAutoplayCountdown() {
      emit('autoplay-cancel')
    }

    function playAutoplayVideoNow() {
      emit('autoplay-play-now')
    }

    /** @type {shaka.Player|null} */
    let player = null

    /** @type {shaka.ui.Overlay|null} */
    let ui = null

    // Set when a UI reconfigure is requested while the player is not loaded, so
    // it can be flushed once loading finishes (see configureUI).
    let pendingUiReconfigure = false

    // Whether this instance registered its custom control factories into the
    // shared global registry, so teardown decrements the live-player count
    // exactly once (see cleanUpCustomPlayerControls).
    let registeredCustomControls = false

    const events = new EventTarget()

    /** @type {import('vue').Ref<HTMLDivElement | null>} */
    const container = ref(null)

    /** @type {import('vue').Ref<HTMLVideoElement | null>} */
    const video = ref(null)

    const sleepTimer = useSleepTimer({
      getVideoId: () => props.videoId,
      isPaused: () => video.value?.paused ?? true,
      onExpired: () => showToast(t('Video.Player.Sleep Timer.Timer ended')),
      pausePlayback: () => video.value?.pause(),
      tabId,
    })

    /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
    const vrCanvas = ref(null)

    /** @type {import('vue').Ref<HTMLElement | null>} */
    const chapterOverlay = ref(null)
    const showChaptersOverlay = ref(false)
    // Reactive mirror of the native fullscreen state, so the template can
    // decide where the chapters render (in-player panel vs the watch sidebar).
    const isFullscreen = ref(false)

    // While switching presentation mode (fullscreen/full window) the side
    // panel transitions would run on top of the container resize and produce
    // odd combined motion, so they are suppressed for the switch duration.
    const presentationModeChanging = ref(false)
    /** @type {number|null} */
    let presentationModeChangingTimeout = null

    function suppressPanelTransitions(duration) {
      presentationModeChanging.value = true

      if (presentationModeChangingTimeout !== null) {
        clearTimeout(presentationModeChangingTimeout)
      }

      presentationModeChangingTimeout = window.setTimeout(() => {
        presentationModeChangingTimeout = null
        presentationModeChanging.value = false
      }, duration)
    }
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenCommentsOverlay = ref(null)
    const showFullscreenComments = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenPlaylistOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenPlaylistTarget = ref(null)
    const showFullscreenPlaylist = ref(false)
    const chapterThumbnails = ref([])
    const currentChapterTitle = computed(() => {
      return props.chapters[props.currentChapterIndex]?.title ?? t('Chapters.Chapters')
    })
    const shareablePlaylistId = computed(() => {
      return props.playlistId && store.getters.getPlaylist(props.playlistId) == null
        ? props.playlistId
        : ''
    })
    const showFullscreenShareAction = computed(() => !store.getters.getHideSharingActions)
    const showFullscreenPlaylistAction = computed(() => !store.getters.getHidePlaylists)

    function getShareTimestamp() {
      const currentTime = Math.floor(video.value?.currentTime ?? 0)
      return Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
    }

    function addToPlaylist() {
      emit('add-to-playlist')
    }

    const hasLoaded = ref(false)
    const annotationCurrentTime = ref(0)

    const hasMultipleAudioTracks = ref(false)
    const isLive = ref(props.isLive)

    const preferredCaptionLocale = computed(() => {
      return store.getters.getPreferredCaptionLocale || locale.value
    })
    let lastSelectedCaptionTrack = null

    function getCaptionToEnable() {
      return getPreferredCaption(
        props.captions,
        preferredCaptionLocale.value,
        store.getters.getEnableCaptionTranslations
      )
    }

    function findMatchingTextTrack(textTracks, caption) {
      if (!caption) {
        return null
      }

      const originalTextId = caption.originalTextId ?? caption.id

      return textTracks.find(track => originalTextId != null && track.originalTextId === originalTextId) ??
        textTracks.find(track => track.language === caption.language && track.label === caption.label) ??
        null
    }

    function getTextTrackToEnable(textTracks) {
      return findMatchingTextTrack(textTracks, lastSelectedCaptionTrack) ??
        findMatchingTextTrack(textTracks, getCaptionToEnable()) ??
        textTracks[0]
    }

    const onlyUseOverFlowMenu = ref(false)
    const forceAspectRatio = ref(false)

    const activeLegacyFormat = shallowRef(null)

    const fullWindowEnabled = ref(false)
    const fullWindowPlaceholderHeight = ref(0)
    /** @type {Animation|null} */
    let fullWindowAnimation = null
    // The setFullWindow listener is only attached once the shaka UI is built. An
    // early isActiveTab tick can run applyPendingPresentationModes before then, so
    // gate the full-window request on the listener being ready to avoid consuming
    // (and dropping) the startup flag while nothing is listening for the event.
    let fullWindowListenerReady = false
    let startInFullwindow = props.startInFullwindow
    let startInFullscreen = props.startInFullscreen
    let startInPip = props.startInPip
    let restoreChapters = props.startWithChapters
    let restoreFullscreenComments = props.startWithFullscreenComments
    let restoreFullscreenPlaylist = props.startWithFullscreenPlaylist
    let exitFullscreenCleanup = null

    /** @type {number|null} */
    let restoreCaptionIndex = props.sabrReloadCaptionIndex

    if (restoreCaptionIndex === null && store.getters.getEnableSubtitlesByDefault && props.captions.length > 0) {
      const caption = getCaptionToEnable()
      restoreCaptionIndex = caption ? props.captions.indexOf(caption) : 0
    }

    const showStats = ref(false)
    const stats = reactive({
      resolution: {
        width: 0,
        height: 0,
        frameRate: 0
      },
      bitrate: '0',
      volume: '100',
      bandwidth: '0',
      buffered: '0',
      frames: {
        totalFrames: 0,
        droppedFrames: 0
      },
      codecs: {
        audioItag: '',
        audioCodec: '',
        videoItag: '',
        videoCodec: ''
      }
    })

    const playerDimensions = computed(() => ({
      width: playerWidth.value,
      height: playerHeight.value
    }))

    // #region settings

    const {
      initializeActiveTab,
      isActiveTab,
      resetAutoPictureInPictureOwnership,
      setupAutoPictureInPicture,
      teardownAutoPictureInPicture,
      updateAutoPip,
    } = useAutoPictureInPicture({
      getUi: () => ui,
      props,
      video,
      tabId,
      isTabPresented,
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoplayVideos = computed(() => {
      return store.getters.getAutoplayVideos && isActiveTab.value
    })

    watch(isActiveTab, (active) => {
      if (active) {
        nextTick(() => {
          applyPendingPresentationModes()
          remeasureControlPanelWidth()
        })
        // An already-scrolled tab that was inactive never got to reevaluate its
        // scroll position, so restore the mini-player state now that it is active.
        updateScrollMiniPlayer()
      } else {
        if (controlPanelLayoutFrame !== null) {
          cancelAnimationFrame(controlPanelLayoutFrame)
          controlPanelLayoutFrame = null
        }
        handleTemporaryPlaybackRateFocusLoss()
        if (scrollMiniPlayerActive.value) {
          deactivateScrollMiniPlayer()
        }
      }
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const displayVideoPlayButton = computed(() => {
      return store.getters.getDisplayVideoPlayButton
    })

    const ambientMode = computed(() => {
      return store.getters.getAmbientMode
    })

    const skipSilence = computed(() => {
      return store.getters.getSkipSilence
    })

    const showSkipSilenceButton = computed(() => {
      return store.getters.getShowSkipSilenceButton
    })

    const silenceSkippingEnabled = computed(() => {
      return skipSilence.value
    })

    const silenceSkipping = useSilenceSkipping({
      enabled: silenceSkippingEnabled,
      isLive,
      video,
    })

    const silenceSkippingIndicatorMessage = computed(() => {
      const rate = silenceSkipping.accelerationRate.value
      return rate === null ? '' : `${Number.parseFloat(rate.toFixed(2))}x`
    })

    const captionSettings = computed(() => parseCaptionSettings(store.getters.getDefaultCaptionSettings))
    const captionCssVariables = computed(() => getCaptionCssVariables(captionSettings.value))
    const showCaptionAppearanceSample = ref(false)
    const captionAppearanceSampleBottom = ref('var(--caption-hidden-bottom-gap)')
    let captionAppearanceSampleTimeout = null

    function previewCaptionAppearance() {
      const textContainer = container.value?.querySelector('.shaka-text-container')
      const displayedCaption = Array.from(
        textContainer?.querySelectorAll('[translate="no"]') ?? []
      ).some(element => element.textContent?.trim())

      if (displayedCaption) {
        showCaptionAppearanceSample.value = false
        clearTimeout(captionAppearanceSampleTimeout)
        return
      }

      if (textContainer) {
        captionAppearanceSampleBottom.value = getComputedStyle(textContainer).bottom
      }
      showCaptionAppearanceSample.value = true
      clearTimeout(captionAppearanceSampleTimeout)
      captionAppearanceSampleTimeout = setTimeout(() => {
        showCaptionAppearanceSample.value = false
      }, 1000)
    }

    /**
     * @param {'textColor' | 'backgroundColor' | 'backgroundOpacity' | 'fontScale' | 'verticalPosition' | 'anchor' | 'edgeStyle' | 'edgeColor'} setting
     * @param {string | number} value
     */
    function updateCaptionAppearance(setting, value) {
      store.dispatch('updateDefaultCaptionSettings', JSON.stringify({
        ...captionSettings.value,
        [setting]: value,
      }))
      previewCaptionAppearance()
    }

    function resetCaptionAppearance() {
      store.dispatch('updateDefaultCaptionSettings', JSON.stringify(DEFAULT_CAPTION_SETTINGS))
      previewCaptionAppearance()
    }

    onUnmounted(() => {
      clearTimeout(captionAppearanceSampleTimeout)
    })

    /** @param {boolean} value */
    function updateAmbientMode(value) {
      store.dispatch('updateAmbientMode', value)
    }

    /** @param {boolean} value */
    function updateSkipSilence(value) {
      store.dispatch('updateSkipSilence', value)
    }

    watch(displayVideoPlayButton, (newValue) => {
      ui.configure({
        bigButtons: newValue ? ['play_pause'] : []
      })
    })

    /** @type {import('vue').ComputedRef<number>} */
    const defaultSkipInterval = computed(() => {
      return store.getters.getDefaultSkipInterval
    })
    const seekIntervalMultiplyByPlaybackRate = computed(() => {
      return store.getters.getSeekIntervalMultiplyByPlaybackRate
    })
    const showPlaybackRateAdjustedTimestamp = computed(() => {
      return store.getters.getShowPlaybackRateAdjustedTimestamp
    })

    watch(defaultSkipInterval, (newValue) => {
      ui.configure({
        tapSeekDistance: newValue
      })
    })

    watch(showPlaybackRateAdjustedTimestamp, () => {
      events.dispatchEvent(new CustomEvent('timeDisplaySettingsChanged'))
    })

    /** @type {import('vue').ComputedRef<number | 'auto'>} */
    const defaultQuality = computed(() => {
      const value = store.getters.getDefaultQuality

      // TODO: Revert when auto is fixed (720 is the default setttings value)
      if (value === 'auto') { return 720 }
      // if (value === 'auto') { return value }

      return parseInt(value)
    })

    /** @type {import('vue').ComputedRef<number>} */
    const preferredVideoQuality = computed(() => {
      const value = Number.parseInt(props.currentVideoQuality)
      return Number.isNaN(value) ? defaultQuality.value : value
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const enterFullscreenOnDisplayRotate = computed(() => {
      return store.getters.getEnterFullscreenOnDisplayRotate
    })

    watch(enterFullscreenOnDisplayRotate, (newValue) => {
      ui.configure({
        enableFullscreenOnRotation: newValue
      })
    })

    /** @type {import('vue').ComputedRef<number>} */
    const defaultPlaybackRate = computed(() => {
      return store.getters.getDefaultPlayback
    })

    /** @type {import('vue').ComputedRef<number>} */
    const defaultVolume = computed(() => {
      return store.getters.getDefaultVolume
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const rememberVolume = computed(() => {
      return store.getters.getRememberVolume
    })

    let applyingInitialVolume = false

    watch(defaultPlaybackRate, (newValue) => {
      if (video.value) {
        video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo(newValue)
      }
    })

    const maxVideoPlaybackRate = computed(() => {
      return parseInt(store.getters.getMaxVideoPlaybackRate)
    })

    /** @type {import('vue').ComputedRef<string>} */
    const channelPlaybackSpeeds = computed(() => {
      return store.getters.getChannelPlaybackSpeeds
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const rememberPlaybackSpeedPerChannel = computed(() => {
      return store.getters.getRememberPlaybackSpeedPerChannel
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoUpdateChannelPlaybackSpeeds = computed(() => {
      return store.getters.getAutoUpdateChannelPlaybackSpeeds
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const useQuickPlaybackSpeedBar = computed(() => {
      return store.getters.getUseQuickPlaybackSpeedBar
    })

    /** @type {import('vue').ComputedRef<Array<{speed: number, name: string}>>} */
    const quickPlaybackSpeedBarOptions = computed(() => {
      try {
        const parsedOptions = JSON.parse(store.getters.getQuickPlaybackSpeedBarOptions || '[]')

        if (!Array.isArray(parsedOptions)) {
          return [{ speed: 1, name: '' }]
        }

        const options = parsedOptions
          .map((option) => ({
            speed: Number.parseFloat(option?.speed),
            name: typeof option?.name === 'string' ? option.name : '',
          }))
          .filter((option) => Number.isFinite(option.speed) && option.speed > 0)

        return options.length > 0 ? options : [{ speed: 1, name: '' }]
      } catch (error) {
        console.error('Failed to parse quick playback speed bar options:', error)
        return [{ speed: 1, name: '' }]
      }
    })

    /** @type {import('vue').ComputedRef<number | null>} */
    const savedChannelPlaybackRate = computed(() => {
      if (!rememberPlaybackSpeedPerChannel.value || props.channelId === '') {
        return null
      }

      try {
        const channelSpeeds = JSON.parse(channelPlaybackSpeeds.value || '{}')
        const value = channelSpeeds[props.channelId]

        if (typeof value === 'number' && Number.isFinite(value)) {
          return value
        }

        if (typeof value === 'string') {
          const parsedValue = Number.parseFloat(value)
          return Number.isFinite(parsedValue) ? parsedValue : null
        }
      } catch (error) {
        console.error('Failed to parse channel playback speeds for quick playback speed bar:', error)
      }

      return null
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const canManuallySaveChannelPlaybackRate = computed(() => {
      return rememberPlaybackSpeedPerChannel.value &&
        !autoUpdateChannelPlaybackSpeeds.value &&
        props.channelId !== ''
    })

    const videoPlaybackRateInterval = computed(() => {
      return parseFloat(store.getters.getVideoPlaybackRateInterval)
    })

    const playbackRates = computed(() => {
      const interval = videoPlaybackRateInterval.value
      const playbackRates = []
      let i = interval

      while (i <= maxVideoPlaybackRate.value) {
        playbackRates.unshift(i)
        i += interval
        i = parseFloat(i.toFixed(2))
      }

      return playbackRates
    })

    watch(playbackRates, (newValue) => {
      ui.configure({
        playbackRates: newValue
      })
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const enableScreenshot = computed(() => {
      return store.getters.getEnableScreenshot
    })

    /** @type {import('vue').ComputedRef<string>} */
    const screenshotMode = computed(() => {
      return store.getters.getScreenshotMode
    })

    /** @type {import('vue').ComputedRef<string>} */
    const screenshotFormat = computed(() => {
      return store.getters.getScreenshotFormat
    })

    /** @type {import('vue').ComputedRef<number>} */
    const screenshotQuality = computed(() => {
      return store.getters.getScreenshotQuality
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const videoVolumeMouseScroll = computed(() => {
      return store.getters.getVideoVolumeMouseScroll
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const videoPlaybackRateMouseScroll = computed(() => {
      return store.getters.getVideoPlaybackRateMouseScroll
    })

    const holdToDoublePlaybackSpeed = computed(() => {
      return store.getters.getHoldToDoublePlaybackSpeed
    })

    watch(holdToDoublePlaybackSpeed, (enabled) => {
      if (!enabled) {
        handleTemporaryPlaybackRateFocusLoss()
      }
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const videoSkipMouseScroll = computed(() => {
      return store.getters.getVideoSkipMouseScroll
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const useSponsorBlock = computed(() => {
      return store.getters.getUseSponsorBlock
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const sponsorBlockShowSkippedToast = computed(() => {
      return store.getters.getSponsorBlockShowSkippedToast
    })

    const sponsorBlockEnableSubmission = computed(() => {
      return store.getters.getSponsorBlockEnableSubmission
    })

    /** @type {import('vue').ComputedRef<number>} */
    const sponsorBlockSkippedToastDuration = computed(() => {
      return store.getters.getSponsorBlockSkippedToastDuration
    })

    const sponsorBlockSkippedToastDurationMs = computed(() => {
      return Math.max(2, Math.min(15, sponsorBlockSkippedToastDuration.value)) * 1000
    })

    const sponsorSkips = computed(() => {
      // save some work when sponsorblock is disabled
      if (!useSponsorBlock.value) {
        return {
          autoSkip: new Set(),
          seekBar: [],
          promptSkip: new Set(),
          categoryData: {}
        }
      }

      /** @type {SponsorBlockCategory[]} */
      /** @type {Set<SponsorBlockCategory>} */
      const autoSkip = new Set()

      /** @type {SponsorBlockCategory[]} */
      const seekBar = []

      /** @type {Set<SponsorBlockCategory>} */
      const promptSkip = new Set()

      /**
       * @type {{
       *   [key in SponsorBlockCategory]: {
       *     color: string,
       *     skip: 'autoSkip' | 'promptToSkip' | 'showInSeekBar' | 'doNothing'
       *   }
        }} */
      const categoryData = {}

      SPONSORBLOCK_CATEGORIES.forEach(x => {
        let sponsorVal = {}
        switch (x) {
          case 'sponsor':
            sponsorVal = store.getters.getSponsorBlockSponsor
            break
          case 'selfpromo':
            sponsorVal = store.getters.getSponsorBlockSelfPromo
            break
          case 'interaction':
            sponsorVal = store.getters.getSponsorBlockInteraction
            break
          case 'intro':
            sponsorVal = store.getters.getSponsorBlockIntro
            break
          case 'outro':
            sponsorVal = store.getters.getSponsorBlockOutro
            break
          case 'preview':
            sponsorVal = store.getters.getSponsorBlockRecap
            break
          case 'hook':
            sponsorVal = store.getters.getSponsorBlockHook
            break
          case 'music_offtopic':
            sponsorVal = store.getters.getSponsorBlockMusicOffTopic
            break
          case 'filler':
            sponsorVal = store.getters.getSponsorBlockFiller
            break
          case 'poi_highlight':
            sponsorVal = store.getters.getSponsorBlockHighlight
            break
        }

        const skip = x === 'poi_highlight' && sponsorVal.skip === 'autoSkip'
          ? 'promptToSkip'
          : sponsorVal.skip

        if (skip !== 'doNothing') {
          seekBar.push(x)
        }

        if (skip === 'autoSkip') {
          autoSkip.add(x)
        }

        if (skip === 'promptToSkip') {
          promptSkip.add(x)
        }

        categoryData[x] = {
          ...sponsorVal,
          skip
        }
      })
      return { autoSkip, seekBar, promptSkip, categoryData }
    })

    // #endregion settings

    // #region SponsorBlock

    /**
     * @type {{
     *   uuid: string
     *   category: SponsorBlockCategory
     *   actionType?: 'skip' | 'poi'
     *   startTime: number,
     *   endTime: number
     * }[]}
     */
    let sponsorBlockSegments = []
    const sponsorBlockInfoSegments = ref([])
    const sponsorBlockInfoOpen = ref(false)
    const sponsorBlockInfoLoading = ref(false)
    const sponsorBlockVotePending = ref(null)
    const sponsorBlockUserVotes = reactive({})
    let terminalSponsorBlockOutroStarted = false
    let sponsorBlockAverageVideoDuration = 0
    const hasSponsorBlockMusicOfftopicSegment = ref(false)
    const activeSponsorBlockHighlightSegment = ref(null)
    let sponsorBlockHighlightLabelVisible = true
    let sponsorBlockHighlightLabelRemainingMs = SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS
    let sponsorBlockHighlightLabelStartedAt = null
    let sponsorBlockHighlightLabelTimeout = null

    /**
     * Yes a map would be much more suitable for this (unlike objects they retain the order that items were inserted),
     * but Vue 2 doesn't support reactivity on Maps, so we have to use an array instead
     * @type {import('vue').Ref<{uuid: string, translatedCategory: string, color: string, timeoutId: ReturnType<typeof setTimeout>|0, hideAt: number|null, hideRemainingMs: number, unskipped: boolean, countdownPaused: boolean, isHighlight: boolean, unskipTime: number|null}[]>}
     */
    const skippedSponsorBlockSegments = ref([])
    const promptSponsorBlockSegments = ref([])
    const sponsorBlockToastNow = ref(Date.now())
    const sponsorBlockCurrentTime = ref(0)
    let sponsorBlockToastTimeInterval = null

    const {
      cancelCurrentSponsorBlockDraft,
      clearSponsorBlockDrafts,
      closeSponsorBlockSubmissionMenu,
      deleteSponsorBlockDraft,
      endSponsorBlockDraft,
      getSponsorBlockSubmissionVideoDuration,
      handleSponsorBlockPreviewSkip,
      isSponsorBlockDraftEditing,
      isSponsorBlockPointSegment,
      loadSponsorBlockDrafts,
      openSponsorBlockGuidelines,
      openSponsorBlockSubmissionMenu,
      previewSponsorBlockDraft,
      saveSponsorBlockDraft,
      setSponsorBlockDraftTime,
      sponsorBlockCompleteDraftSegments,
      sponsorBlockDraftEditValues,
      sponsorBlockDraftSegments,
      sponsorBlockDraftSegmentsByVideoId,
      sponsorBlockSubmissionCategories,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      sponsorBlockSubmissionVisibleButtons,
      startSponsorBlockDraft,
      submitSponsorBlockDrafts,
      toggleSponsorBlockDraftEditing,
      updateSponsorBlockDraftCategory,
      updateSponsorBlockDraftEditField,
      updateSponsorBlockSubmissionState,
    } = useSponsorBlockSubmission({
      canSeek,
      events,
      getPlayer: () => player,
      isLive,
      onSubmittedSegments: (submittedSegments) => {
        sponsorBlockSegments = sponsorBlockSegments.concat(submittedSegments).sort((a, b) => a.startTime - b.startTime)
        sponsorBlockInfoSegments.value = sponsorBlockInfoSegments.value
          .concat(submittedSegments.map(segment => ({ ...segment, locked: 0, votes: 0 })))
          .sort((a, b) => a.startTime - b.startTime)
        emitSponsorBlockInfoState()
        refreshSponsorBlockMarkers()
      },
      props,
      showOverlayControls,
      sponsorBlockCurrentTime,
      t,
      useSponsorBlock,
      video,
    })

    /**
     * Set of segment UUIDs that the user has explicitly unskipped.
     * These segments will not be auto-skipped again until the user leaves the segment.
     * @type {Set<string>}
     */
    let sponsorBlockDoNotSkipSegments = new Set()
    /**
     * Set of segment UUIDs whose prompt has been dismissed until playback leaves the segment.
     * @type {Set<string>}
     */
    let sponsorBlockDismissedPromptSegments = new Set()
    let sponsorBlockNotFoundRefetchTimeout = null

    function clearSponsorBlockNotFoundRefetchTimeout() {
      if (sponsorBlockNotFoundRefetchTimeout !== null) {
        clearTimeout(sponsorBlockNotFoundRefetchTimeout)
        sponsorBlockNotFoundRefetchTimeout = null
      }
    }

    function isRecentVideoForSponsorBlockRefetch() {
      if (!Number.isFinite(props.published) || props.published <= 0) {
        return false
      }

      const videoAgeMs = Date.now() - props.published
      return videoAgeMs >= 0 && videoAgeMs <= SPONSORBLOCK_NOT_FOUND_REFETCH_RECENT_VIDEO_AGE_MS
    }

    function scheduleSponsorBlockNotFoundRefetch() {
      clearSponsorBlockNotFoundRefetchTimeout()

      if (
        !useSponsorBlock.value ||
        !isRecentVideoForSponsorBlockRefetch() ||
        props.videoId === '' ||
        sponsorBlockInfoSegments.value.length > 0
      ) {
        return
      }

      const videoId = props.videoId
      const refetchDelayMs = SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS +
        Math.random() * (SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS - SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS)

      sponsorBlockNotFoundRefetchTimeout = setTimeout(() => {
        sponsorBlockNotFoundRefetchTimeout = null

        if (!ui || !player || props.videoId !== videoId || sponsorBlockInfoSegments.value.length > 0) {
          return
        }

        refetchSponsorBlockSegmentsWhenNotFound()
      }, refetchDelayMs)
    }

    async function refetchSponsorBlockSegmentsWhenNotFound() {
      let segments, averageDuration

      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(
          props.videoId,
          SPONSORBLOCK_CATEGORIES,
          SPONSORBLOCK_INFO_ACTION_TYPES
        ))
      } catch (e) {
        console.error(e)
        return
      }

      if (!ui || !player) {
        return
      }

      if (segments.length > 0) {
        sponsorBlockInfoSegments.value = segments
        sponsorBlockSegments = segments.filter(segment => {
          return ['skip', 'poi'].includes(segment.actionType) && sponsorSkips.value.seekBar.includes(segment.category)
        })
        sponsorBlockAverageVideoDuration = averageDuration
        hasSponsorBlockMusicOfftopicSegment.value = segments.some(segment => segment.category === 'music_offtopic')
        refreshSponsorBlockMarkers()
        if (canSeek()) {
          const currentTime = video.value?.currentTime ?? 0
          syncPromptSponsorBlockSegments(currentTime)
          updateSponsorBlockHighlightState(currentTime)
        }
      } else {
        scheduleSponsorBlockNotFoundRefetch()
      }
      emitSponsorBlockInfoState()
    }

    async function setupSponsorBlock() {
      let segments
      let averageDuration = 0
      let refetchWhenNotFound = false

      clearSponsorBlockNotFoundRefetchTimeout()

      // Reset the do-not-skip set for the new video
      sponsorBlockDoNotSkipSegments = new Set()
      sponsorBlockDismissedPromptSegments = new Set()
      sponsorBlockSegments = []
      sponsorBlockInfoSegments.value = []
      terminalSponsorBlockOutroStarted = false
      sponsorBlockAverageVideoDuration = 0
      hasSponsorBlockMusicOfftopicSegment.value = false
      activeSponsorBlockHighlightSegment.value = null
      updateSponsorBlockHighlightState(0)

      sponsorBlockInfoLoading.value = true
      emitSponsorBlockInfoState()
      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(
          props.videoId,
          SPONSORBLOCK_CATEGORIES,
          SPONSORBLOCK_INFO_ACTION_TYPES
        ))
        refetchWhenNotFound = segments.length === 0
      } catch (e) {
        console.error(e)
        segments = []
      } finally {
        sponsorBlockInfoLoading.value = false
        emitSponsorBlockInfoState()
      }

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui || !player) {
        return
      }

      clearSponsorBlockMarkers()

      if (segments.length > 0) {
        sponsorBlockInfoSegments.value = segments
        sponsorBlockSegments = segments.filter(segment => {
          return ['skip', 'poi'].includes(segment.actionType) && sponsorSkips.value.seekBar.includes(segment.category)
        })
        sponsorBlockAverageVideoDuration = averageDuration
        hasSponsorBlockMusicOfftopicSegment.value = segments.some(segment => segment.category === 'music_offtopic')
      } else if (refetchWhenNotFound) {
        scheduleSponsorBlockNotFoundRefetch()
      }

      emitSponsorBlockInfoState()

      refreshSponsorBlockMarkers()
      if (sponsorBlockSegments.length > 0 && canSeek()) {
        const currentTime = video.value?.currentTime ?? 0
        syncPromptSponsorBlockSegments(currentTime)
        updateSponsorBlockHighlightState(currentTime)
      }
    }

    async function refreshSponsorBlockInfo() {
      await setupSponsorBlock()
    }

    function emitSponsorBlockInfoState() {
      const detail = {
        open: sponsorBlockInfoOpen.value,
        loading: sponsorBlockInfoLoading.value,
        submissionEnabled: sponsorBlockEnableSubmission.value,
        pendingUuid: sponsorBlockVotePending.value,
        segments: sponsorBlockInfoSegments.value.map(segment => ({
          ...segment,
          color: getSponsorBlockInfoSegmentColor(segment.category),
          timeLabel: formatSponsorBlockInfoSegmentTime(segment),
          translatedCategory: translateSponsorBlockCategory(segment.category),
          userVote: sponsorBlockUserVotes[segment.uuid] ?? null,
        }))
      }

      emit('sponsorblock-info-change', detail)
      events.dispatchEvent(new CustomEvent('sponsorBlockInfoStateChanged', { detail }))
    }

    function toggleSponsorBlockInfo() {
      sponsorBlockInfoOpen.value = !sponsorBlockInfoOpen.value
      ui?.getControls().hideSettingsMenus()
      showOverlayControls()
      emitSponsorBlockInfoState()
    }

    function closeSponsorBlockInfo() {
      sponsorBlockInfoOpen.value = false
      emitSponsorBlockInfoState()
    }

    function getSponsorBlockInfoSegmentColor(category) {
      return getSponsorBlockToastColor(category)
    }

    function formatSponsorBlockInfoTimestamp(seconds) {
      const safeSeconds = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0
      const totalMilliseconds = Math.round(safeSeconds * 1000)
      const milliseconds = String(totalMilliseconds % 1000).padStart(3, '0')
      const totalSeconds = Math.floor(totalMilliseconds / 1000)
      const secondsPart = String(totalSeconds % 60).padStart(2, '0')
      const totalMinutes = Math.floor(totalSeconds / 60)
      const minutesPart = totalMinutes % 60
      const hours = Math.floor(totalMinutes / 60)

      return hours > 0
        ? `${hours}:${String(minutesPart).padStart(2, '0')}:${secondsPart}.${milliseconds}`
        : `${minutesPart}:${secondsPart}.${milliseconds}`
    }

    function formatSponsorBlockInfoSegmentTime(segment) {
      if (segment.actionType === 'full') {
        return t('Video.Player.SponsorBlock.FullVideo')
      }

      const start = formatSponsorBlockInfoTimestamp(segment.startTime)
      return isSponsorBlockPointSegment(segment)
        ? start
        : `${start} ${t('Video.Player.SponsorBlock.TimeDivider')} ${formatSponsorBlockInfoTimestamp(segment.endTime)}`
    }

    function getSponsorBlockVoteContribution(vote) {
      if (vote === 1) return 1
      if (vote === 0) return -1
      return 0
    }

    async function voteOnSponsorBlockInfoSegment(uuid, vote) {
      if (!sponsorBlockEnableSubmission.value || sponsorBlockVotePending.value !== null) {
        return
      }

      const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
      if (!segment) {
        return
      }

      const previousVote = sponsorBlockUserVotes[segment.uuid]
      const nextVote = previousVote === vote ? null : vote
      const type = nextVote === null ? 20 : nextVote
      sponsorBlockVotePending.value = segment.uuid
      emitSponsorBlockInfoState()

      try {
        await voteOnSponsorBlockSegment(props.videoId, segment.uuid, type)
        const currentVotes = Number.isFinite(segment.votes) ? segment.votes : 0
        segment.votes = currentVotes - getSponsorBlockVoteContribution(previousVote) +
          getSponsorBlockVoteContribution(nextVote)

        if (nextVote === null) {
          delete sponsorBlockUserVotes[segment.uuid]
        } else {
          sponsorBlockUserVotes[segment.uuid] = nextVote
        }
      } catch (error) {
        console.error(error)
        showToast(t('Video.Player.SponsorBlock.VoteFailed'))
      } finally {
        sponsorBlockVotePending.value = null
        emitSponsorBlockInfoState()
      }
    }

    function skipSponsorBlockInfoSegment(uuid) {
      const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
      if (!segment || !canSeek()) {
        return
      }

      const seekRange = player.seekRange()
      video.value.currentTime = Math.min(
        Math.max(getSponsorBlockSegmentSkipTarget(segment), seekRange.start),
        seekRange.end
      )
      showOverlayControls()
    }

    function startSponsorBlockToastTimer() {
      if (sponsorBlockToastTimeInterval !== null) {
        return
      }

      sponsorBlockToastTimeInterval = setInterval(() => {
        sponsorBlockToastNow.value = Date.now()
      }, 250)
    }

    function stopSponsorBlockToastTimer() {
      if (sponsorBlockToastTimeInterval !== null) {
        clearInterval(sponsorBlockToastTimeInterval)
        sponsorBlockToastTimeInterval = null
      }
    }

    /**
     * @param {string} uuid
     */
    function removeSponsorBlockToast(uuid) {
      const index = skippedSponsorBlockSegments.value.findIndex(segment => segment.uuid === uuid)
      if (index !== -1) {
        clearTimeout(skippedSponsorBlockSegments.value[index].timeoutId)
        skippedSponsorBlockSegments.value.splice(index, 1)
      }
    }

    /**
     * @param {string} uuid
     */
    function removePromptSponsorBlockToast(uuid) {
      const index = promptSponsorBlockSegments.value.findIndex(segment => segment.uuid === uuid)
      if (index !== -1) {
        promptSponsorBlockSegments.value.splice(index, 1)
      }
    }

    /**
     * @param {SponsorBlockCategory} category
     * @returns {string}
     */
    function getSponsorBlockToastColor(category) {
      const colorName = sponsorSkips.value.categoryData[category]?.color
      return colors.find(color => color.name === colorName)?.value ?? '#39be70'
    }

    /**
     * @param {{ uuid: string, translatedCategory: string, color: string, isHighlight?: boolean, unskipTime?: number }} toast
     */
    function upsertSkippedSponsorBlockToast({ uuid, translatedCategory, color, isHighlight = false, unskipTime }) {
      const hideAt = Date.now() + sponsorBlockSkippedToastDurationMs.value
      const existingSkip = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

      if (existingSkip) {
        clearTimeout(existingSkip.timeoutId)
        existingSkip.translatedCategory = translatedCategory
        existingSkip.color = color
        existingSkip.unskipped = false
        existingSkip.hideAt = hideAt
        existingSkip.hideRemainingMs = sponsorBlockSkippedToastDurationMs.value
        existingSkip.countdownPaused = false
        existingSkip.isHighlight = isHighlight
        existingSkip.unskipTime = unskipTime ?? null
        existingSkip.timeoutId = setTimeout(() => {
          removeSponsorBlockToast(uuid)
        }, sponsorBlockSkippedToastDurationMs.value)
        return
      }

      skippedSponsorBlockSegments.value.push({
        uuid,
        translatedCategory,
        color,
        unskipped: false,
        hideAt,
        hideRemainingMs: sponsorBlockSkippedToastDurationMs.value,
        countdownPaused: false,
        isHighlight,
        unskipTime: unskipTime ?? null,
        timeoutId: setTimeout(() => {
          removeSponsorBlockToast(uuid)
        }, sponsorBlockSkippedToastDurationMs.value)
      })
    }

    /**
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockToastTimeLabel(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)

      if (!toastEntry || !segment) {
        return '0s'
      }

      const remainingSeconds = toastEntry.unskipped
        ? Math.max(segment.endTime - sponsorBlockCurrentTime.value, 0)
        : (toastEntry.countdownPaused
            ? Math.max(toastEntry.hideRemainingMs, 0)
            : Math.max((toastEntry.hideAt ?? 0) - sponsorBlockToastNow.value, 0)) / 1000

      if (remainingSeconds < 60) {
        return `${Math.ceil(remainingSeconds)}s`
      }

      return formatDurationAsTimestamp(Math.ceil(remainingSeconds))
    }

    /**
     * @param {string} uuid
     * @returns {boolean}
     */
    function isSponsorBlockToastCountdownPaused(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      return Boolean(toastEntry?.countdownPaused && !toastEntry.unskipped)
    }

    /**
     * @param {boolean} unskipped
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockToastActionLabel(unskipped, uuid) {
      const actionLabel = unskipped
        ? t('Video.Player.SponsorBlock.SkipToastReskip')
        : t('Video.Player.SponsorBlock.SkipToastUnskip')

      const activeToast = getActiveSponsorBlockToast()
      if (getActivePromptSponsorBlockToast() || activeSponsorBlockHighlightSegment.value || activeToast?.uuid !== uuid) {
        return actionLabel
      }

      return addKeyboardShortcutToActionTitle(
        actionLabel,
        t('Keys.enter')
      )
    }

    /**
     * @param {string} translatedCategory
     * @returns {string}
     */
    function getSponsorBlockPromptLabel(translatedCategory) {
      return t('Video.Player.SponsorBlock.SkipPrompt', { segmentCategory: translatedCategory })
    }

    /**
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockPromptActionLabel(uuid) {
      if (getActivePromptSponsorBlockToast()?.uuid !== uuid) {
        return t('Video.Player.SponsorBlock.SkipPromptAction')
      }

      return addKeyboardShortcutToActionTitle(
        t('Video.Player.SponsorBlock.SkipPromptAction'),
        t('Keys.enter')
      )
    }

    /**
     * @param {{ category: SponsorBlockCategory, startTime: number, endTime: number }} segment
     * @returns {number}
     */
    function getSponsorBlockSegmentSkipTarget(segment) {
      return isSponsorBlockPointSegment(segment) ? segment.startTime : segment.endTime
    }

    /**
     * @param {{ category: SponsorBlockCategory, startTime: number, endTime: number }} segment
     * @param {number} currentTime
     * @returns {boolean}
     */
    function isSponsorBlockSegmentActiveForPrompt(segment, currentTime) {
      if (isSponsorBlockPointSegment(segment)) {
        return currentTime < segment.startTime
      }

      return currentTime >= segment.startTime && currentTime < segment.endTime
    }

    /**
     * @param {string} uuid
     * @returns {string}
     */
    function getSponsorBlockPromptTimeLabel(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment) {
        return '0s'
      }

      const remainingSeconds = Math.max(
        getSponsorBlockSegmentSkipTarget(segment) - sponsorBlockCurrentTime.value,
        0
      )

      if (remainingSeconds < 60) {
        return `${Math.ceil(remainingSeconds)}s`
      }

      return formatDurationAsTimestamp(Math.ceil(remainingSeconds))
    }

    /**
     * @returns {{uuid: string, translatedCategory: string, timeoutId: ReturnType<typeof setTimeout>|0, hideAt: number|null, unskipped: boolean}|null}
     */
    function getActiveSponsorBlockToast() {
      if (skippedSponsorBlockSegments.value.length === 0) {
        return null
      }

      return skippedSponsorBlockSegments.value[skippedSponsorBlockSegments.value.length - 1]
    }

    /**
     * @returns {{ uuid: string, translatedCategory: string, color: string }|null}
     */
    function getActivePromptSponsorBlockToast() {
      if (promptSponsorBlockSegments.value.length === 0) {
        return null
      }

      return promptSponsorBlockSegments.value[promptSponsorBlockSegments.value.length - 1]
    }

    /**
     * @param {{ uuid: string, translatedCategory: string, color: string }} toast
     */
    function upsertPromptSponsorBlockToast({ uuid, translatedCategory, color }) {
      const existingPrompt = promptSponsorBlockSegments.value.find(prompt => prompt.uuid === uuid)

      if (existingPrompt) {
        existingPrompt.translatedCategory = translatedCategory
        existingPrompt.color = color
        return
      }

      promptSponsorBlockSegments.value.push({
        uuid,
        translatedCategory,
        color
      })
    }

    /**
     * @param {string} uuid
     */
    function dismissPromptSponsorBlockSegment(uuid) {
      sponsorBlockDismissedPromptSegments.add(uuid)
      removePromptSponsorBlockToast(uuid)
    }

    /**
     * @param {string} uuid
     * @returns {boolean}
     */
    function skipPromptSponsorBlockSegment(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment || isSponsorBlockPointSegment(segment) || !canSeek()) {
        return false
      }

      sponsorBlockDismissedPromptSegments.delete(uuid)
      removePromptSponsorBlockToast(uuid)

      const seekRange = player.seekRange()
      const targetTime = Math.min(
        Math.max(getSponsorBlockSegmentSkipTarget(segment), seekRange.start),
        seekRange.end
      )
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime

      if (sponsorBlockShowSkippedToast.value) {
        upsertSkippedSponsorBlockToast({
          uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category)
        })
      }

      return true
    }

    function skipToSponsorBlockHighlight() {
      const segment = activeSponsorBlockHighlightSegment.value
      if (!segment || !canSeek()) {
        return false
      }

      const unskipTime = video.value.currentTime
      const seekRange = player.seekRange()
      const targetTime = Math.min(
        Math.max(segment.startTime, seekRange.start),
        seekRange.end
      )
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime
      updateSponsorBlockHighlightState(targetTime)

      if (sponsorBlockShowSkippedToast.value) {
        upsertSkippedSponsorBlockToast({
          uuid: segment.uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category),
          isHighlight: true,
          unskipTime
        })
      }

      showOverlayControls()
      return true
    }

    function toggleActiveSponsorBlockSkipState() {
      const promptToastEntry = getActivePromptSponsorBlockToast()
      if (promptToastEntry) {
        return skipPromptSponsorBlockSegment(promptToastEntry.uuid)
      }

      if (activeSponsorBlockHighlightSegment.value) {
        return skipToSponsorBlockHighlight()
      }

      const toastEntry = getActiveSponsorBlockToast()
      if (!toastEntry) {
        return false
      }

      if (toastEntry.unskipped) {
        redoSkipSponsorBlockSegment(toastEntry.uuid)
      } else {
        unskipSponsorBlockSegment(toastEntry.uuid)
      }

      return true
    }

    /**
     * @param {number} currentTime
     */
    function syncPromptSponsorBlockSegments(currentTime) {
      const { promptSkip } = sponsorSkips.value

      if (promptSkip.size === 0) {
        promptSponsorBlockSegments.value = []
        return
      }

      const activePromptUUIDs = new Set()

      for (const uuid of sponsorBlockDismissedPromptSegments) {
        const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
        if (!segment || !isSponsorBlockSegmentActiveForPrompt(segment, currentTime)) {
          sponsorBlockDismissedPromptSegments.delete(uuid)
        }
      }

      sponsorBlockSegments.forEach(segment => {
        if (isSponsorBlockPointSegment(segment) || !promptSkip.has(segment.category) || sponsorBlockDoNotSkipSegments.has(segment.uuid)) {
          return
        }

        if (!isSponsorBlockSegmentActiveForPrompt(segment, currentTime)) {
          return
        }

        activePromptUUIDs.add(segment.uuid)

        if (sponsorBlockDismissedPromptSegments.has(segment.uuid)) {
          return
        }

        upsertPromptSponsorBlockToast({
          uuid: segment.uuid,
          translatedCategory: translateSponsorBlockCategory(segment.category),
          color: getSponsorBlockToastColor(segment.category)
        })
      })

      promptSponsorBlockSegments.value
        .filter(segment => !activePromptUUIDs.has(segment.uuid))
        .forEach(segment => removePromptSponsorBlockToast(segment.uuid))
    }

    /**
     * @param {number} currentTime
     */
    function updateSponsorBlockHighlightState(currentTime = sponsorBlockCurrentTime.value) {
      const { promptSkip } = sponsorSkips.value
      const nextHighlightSegment = promptSkip.has('poi_highlight')
        ? sponsorBlockSegments.find(segment => {
          return isSponsorBlockPointSegment(segment) &&
            segment.category === 'poi_highlight' &&
            segment.startTime - currentTime > 0.5
        }) ?? null
        : null

      activeSponsorBlockHighlightSegment.value = nextHighlightSegment
      events.dispatchEvent(new CustomEvent('sponsorBlockHighlightStateChanged', {
        detail: {
          visible: nextHighlightSegment !== null,
          labelVisible: sponsorBlockHighlightLabelVisible
        }
      }))
    }

    function pauseSponsorBlockHighlightLabelCountdown() {
      if (sponsorBlockHighlightLabelStartedAt === null) {
        return
      }

      clearTimeout(sponsorBlockHighlightLabelTimeout)
      sponsorBlockHighlightLabelTimeout = null
      sponsorBlockHighlightLabelRemainingMs = Math.max(
        sponsorBlockHighlightLabelRemainingMs - (Date.now() - sponsorBlockHighlightLabelStartedAt),
        0
      )
      sponsorBlockHighlightLabelStartedAt = null
    }

    function startSponsorBlockHighlightLabelCountdown() {
      if (!sponsorBlockHighlightLabelVisible || sponsorBlockHighlightLabelStartedAt !== null) {
        return
      }

      sponsorBlockHighlightLabelStartedAt = Date.now()
      sponsorBlockHighlightLabelTimeout = setTimeout(() => {
        sponsorBlockHighlightLabelVisible = false
        sponsorBlockHighlightLabelRemainingMs = 0
        sponsorBlockHighlightLabelStartedAt = null
        sponsorBlockHighlightLabelTimeout = null
        updateSponsorBlockHighlightState()
      }, sponsorBlockHighlightLabelRemainingMs)
    }

    function resetSponsorBlockHighlightLabel() {
      clearTimeout(sponsorBlockHighlightLabelTimeout)
      sponsorBlockHighlightLabelVisible = true
      sponsorBlockHighlightLabelRemainingMs = SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS
      sponsorBlockHighlightLabelStartedAt = null
      sponsorBlockHighlightLabelTimeout = null
      updateSponsorBlockHighlightState()
    }

    /**
     * @param {string} uuid
     */
    function pauseSponsorBlockToastCountdown(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (!toastEntry || toastEntry.unskipped || toastEntry.countdownPaused) {
        return
      }

      clearTimeout(toastEntry.timeoutId)
      toastEntry.hideRemainingMs = Math.max((toastEntry.hideAt ?? 0) - Date.now(), 0)
      toastEntry.hideAt = null
      toastEntry.timeoutId = 0
      toastEntry.countdownPaused = true
    }

    /**
     * @param {string} uuid
     */
    function resumeSponsorBlockToastCountdown(uuid) {
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (!toastEntry || toastEntry.unskipped || !toastEntry.countdownPaused) {
        return
      }

      toastEntry.hideAt = Date.now() + toastEntry.hideRemainingMs
      toastEntry.timeoutId = setTimeout(() => {
        removeSponsorBlockToast(uuid)
      }, toastEntry.hideRemainingMs)
      toastEntry.countdownPaused = false
    }

    /**
     * @param {number} currentTime
     */
    function skipSponsorBlockSegments(currentTime) {
      const { autoSkip } = sponsorSkips.value

      if (autoSkip.size === 0) {
        return
      }

      // Check if we've left any unskipped segments - if so, re-enable auto-skip for them
      for (const uuid of sponsorBlockDoNotSkipSegments) {
        const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
        if (segment && !isSponsorBlockPointSegment(segment) &&
          (currentTime < segment.startTime - SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS || currentTime >= segment.endTime)) {
          sponsorBlockDoNotSkipSegments.delete(uuid)
          removeSponsorBlockToast(uuid)
        }
      }

      const video_ = video.value

      let newTime = 0
      const skippedSegments = []

      sponsorBlockSegments.forEach(segment => {
        if (isSponsorBlockPointSegment(segment) || sponsorBlockDoNotSkipSegments.has(segment.uuid)) {
          return
        }

        if (autoSkip.has(segment.category) && currentTime < segment.endTime &&
          (segment.startTime <= currentTime ||
            // if we already have a segment to skip, check if there are any that are less than 150ms later,
            // so that we can skip them all in one go (especially useful on slow connections)
            (newTime > 0 && (segment.startTime < newTime || segment.startTime - newTime <= 0.150) && segment.endTime > newTime))) {
          newTime = segment.endTime
          skippedSegments.push(segment)
        }
      })

      if (newTime === 0 || video_.ended) {
        return
      }

      const videoEnd = player.seekRange().end

      if (Math.abs(videoEnd - currentTime) < 1 || video_.ended) {
        return
      }

      if (newTime > videoEnd || Math.abs(videoEnd - newTime) < 1) {
        newTime = videoEnd
      }

      video_.currentTime = newTime
      sponsorBlockCurrentTime.value = newTime

      if (sponsorBlockShowSkippedToast.value) {
        skippedSegments.forEach(({ uuid, category }) => {
          removePromptSponsorBlockToast(uuid)
          sponsorBlockDismissedPromptSegments.delete(uuid)
          upsertSkippedSponsorBlockToast({
            uuid,
            translatedCategory: translateSponsorBlockCategory(category),
            color: getSponsorBlockToastColor(category)
          })
        })
      }
    }

    /**
     * Unskips a SponsorBlock segment by seeking back to its start time
     * and preventing it from being auto-skipped again until the user leaves the segment.
     * @param {string} uuid - The UUID of the segment to unskip
     */
    function unskipSponsorBlockSegment(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment) {
        return
      }

      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

      if (isSponsorBlockPointSegment(segment)) {
        if (toastEntry?.isHighlight && toastEntry.unskipTime !== null && canSeek()) {
          const seekRange = player.seekRange()
          const targetTime = Math.min(
            Math.max(toastEntry.unskipTime, seekRange.start),
            seekRange.end
          )
          video.value.currentTime = targetTime
          sponsorBlockCurrentTime.value = targetTime
          removeSponsorBlockToast(uuid)
          updateSponsorBlockHighlightState(targetTime)
        }
        return
      }

      sponsorBlockDoNotSkipSegments.add(uuid)
      sponsorBlockDismissedPromptSegments.delete(uuid)
      removePromptSponsorBlockToast(uuid)

      if (canSeek()) {
        const seekRange = player.seekRange()
        const targetTime = Math.max(segment.startTime, seekRange.start)
        video.value.currentTime = targetTime
        sponsorBlockCurrentTime.value = targetTime
      }

      // Update the toast entry to show it's been unskipped
      // Keep showing it for the duration of the segment (no timeout)
      if (toastEntry) {
        clearTimeout(toastEntry.timeoutId)
        toastEntry.unskipped = true
        toastEntry.hideAt = null
        toastEntry.hideRemainingMs = 0
        toastEntry.countdownPaused = false
        toastEntry.timeoutId = 0
      }
    }

    /**
     * Re-skips a SponsorBlock segment that was previously unskipped,
     * seeking to the end of the segment and restoring auto-skip behavior.
     * @param {string} uuid - The UUID of the segment to re-skip
     */
    function redoSkipSponsorBlockSegment(uuid) {
      const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
      if (!segment || isSponsorBlockPointSegment(segment)) {
        return
      }

      sponsorBlockDoNotSkipSegments.delete(uuid)
      sponsorBlockDismissedPromptSegments.delete(uuid)
      removePromptSponsorBlockToast(uuid)

      if (canSeek()) {
        const seekRange = player.seekRange()
        const targetTime = Math.min(segment.endTime, seekRange.end)
        video.value.currentTime = targetTime
        sponsorBlockCurrentTime.value = targetTime
      }

      // Update the toast entry to show it's been re-skipped and reset the timeout
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (toastEntry) {
        upsertSkippedSponsorBlockToast({
          uuid,
          translatedCategory: toastEntry.translatedCategory,
          color: toastEntry.color
        })
      }
    }

    // #endregion SponsorBlock

    // #region player config

    const seekingIsPossible = computed(() => {
      if (props.manifestMimeType !== 'application/x-mpegurl') {
        return true
      }

      const match = props.manifestSrc.match(/\/(?:manifest|playlist)_duration\/(\d+)\//)

      // Check how many seconds we are allowed to seek, 30 is too short, 3600 is an hour which is great
      return match != null && parseInt(match[1] || '0') > 30
    })

    /**
     * @param {'dash'|'audio'|'legacy'} format
     * @param {boolean} useAutoQuality
     * @returns {shaka.extern.PlayerConfiguration}
     */
    function getPlayerConfig(format, useAutoQuality = false) {
      return {
        // YouTube uses these values and they seem to work well in FreeTube too,
        // so we might as well use them
        streaming: {
          bufferingGoal: 180,
          rebufferingGoal: 0.02,
          bufferBehind: 300
        },
        manifest: {
          disableVideo: format === 'audio',

          // makes captions work for live streams and doesn't seem to have any negative affect on VOD videos
          segmentRelativeVttTiming: true,
          dash: {
            manifestPreprocessorTXml: manifestPreprocessorTXml
          },
        },
        abr: {
          enabled: useAutoQuality,

          // This only affects the "auto" quality, users can still manually select whatever quality they want.
          restrictToElementSize: true
        },

        // Prioritise variants that are predicted to play:
        // - `smooth`: without dropping frames
        // - `powerEfficient` the spec is quite vague but in Chromium it should prioritise hardware decoding when available
        // https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo
        preferredDecodingAttributes: format === 'dash' ? ['smooth', 'powerEfficient'] : [],

        // Shaka automatically shows a matching preferred text track on load.
        // Only give it a preference when captions should be enabled or restored.
        preferredText: restoreCaptionIndex === null
          ? []
          : [{
              language: getCaptionToEnable()?.language ?? preferredCaptionLocale.value,
              role: '',
              format: '',
              forced: false,
            }],

        // Electron doesn't like YouTube's vp9 VR video streams and throws:
        // "CHUNK_DEMUXER_ERROR_APPEND_FAILED: Projection element is incomplete; ProjectionPoseYaw required."
        // So use the AV1 and h264 codecs instead which it doesn't reject
        preferredVideoCodecs: typeof props.vrProjection === 'string' ? ['av01', 'avc1'] : []
      }
    }

    /**
     * @param {shaka.extern.xml.Node} mpdNode
     */
    function manifestPreprocessorTXml(mpdNode) {
      /** @type {shaka.extern.xml.Node[]} */
      const periods = mpdNode.children?.filter(child => typeof child !== 'string' && child.tagName === 'Period') ?? []

      sortAdapationSetsByCodec(periods)
      sortAudioAdaptationSetsByBitrate(periods)

      if (mpdNode.attributes.type === 'dynamic') {
        // fix live stream loading issues
        // YouTube uses a 12 second delay on the official website for normal streams
        // and a shorter one for low latency streams
        // If we don't add a little bit of a delay, we get presented with a loading symbol every 5 seconds,
        // while shaka-player processes the new manifest and segments
        const minimumUpdatePeriod = parseFloat(mpdNode.attributes.minimumUpdatePeriod.match(/^PT(\d+(?:\.\d+)?)S$/)[1])
        mpdNode.attributes.suggestedPresentationDelay = `PT${(minimumUpdatePeriod * 2).toFixed(3)}S`

        // fix live streams with subtitles having duplicate Representation ids
        // shaka-player throws DASH_DUPLICATE_REPRESENTATION_ID if we don't fix it

        for (const period of periods) {
          /** @type {shaka.extern.xml.Node[]} */
          const representations = []

          for (const periodChild of period.children) {
            if (typeof periodChild !== 'string' && periodChild.tagName === 'AdaptationSet') {
              for (const adaptationSetChild of periodChild.children) {
                if (typeof adaptationSetChild !== 'string' && adaptationSetChild.tagName === 'Representation') {
                  representations.push(adaptationSetChild)
                }
              }
            }
          }

          const knownIds = new Set()
          let counter = 0
          for (const representation of representations) {
            const id = representation.attributes.id

            if (knownIds.has(id)) {
              const newId = `${id}-ft-fix-${counter}`

              representation.attributes.id = newId
              knownIds.add(newId)
              counter++
            } else {
              knownIds.add(id)
            }
          }
        }
      } else if (!process.env.SUPPORTS_LOCAL_API) {
        repairInvidiousManifest(periods)
      }
    }

    /**
     * @param {shaka.extern.xml.Node[]} periods
     */
    function sortAdapationSetsByCodec(periods) {
      /** @param {shaka.extern.xml.Node} adaptationSet */
      const getCodecsPrefix = (adaptationSet) => {
        const codecs = adaptationSet.attributes.codecs ??
          adaptationSet.children
            .find(child => typeof child !== 'string' && child.tagName === 'Representation').attributes.codecs

        return codecs.split('.')[0]
      }

      const codecPriorities = [
        // audio
        'opus',
        'mp4a',
        'ec-3',
        'ac-3',

        // video
        'av01',
        'vp09',
        'vp9',
        'avc1'
      ]

      for (const period of periods) {
        period.children
          ?.sort((
            /** @type {shaka.extern.xml.Node | string} */ a,
            /** @type {shaka.extern.xml.Node | string} */ b
          ) => {
            if (typeof a === 'string' || a.tagName !== 'AdaptationSet' ||
              typeof b === 'string' || b.tagName !== 'AdaptationSet') {
              return 0
            }

            const typeA = a.attributes.contentType || a.attributes.mimeType.split('/')[0]
            const typeB = b.attributes.contentType || b.attributes.mimeType.split('/')[0]

            // always place image and text tracks AdaptionSets last in the manifest

            if (typeA !== 'video' && typeA !== 'audio') {
              return 1
            }
            if (typeB !== 'video' && typeB !== 'audio') {
              return -1
            }

            const codecsPrefixA = getCodecsPrefix(a)
            const codecsPrefixB = getCodecsPrefix(b)

            return codecPriorities.indexOf(codecsPrefixA) - codecPriorities.indexOf(codecsPrefixB)
          })
      }
    }

    /**
     * Sort audio AdaptationSets so that streams with higher bitrates come first.
     * Workaround that makes the player select high-quality audio.
     * @param {shaka.extern.xml.Node[]} periods
     */
    function sortAudioAdaptationSetsByBitrate(periods) {
      for (const period of periods) {
        period.children
          ?.filter(child => typeof child !== 'string' && child.tagName === 'AdaptationSet' &&
            (child.attributes.contentType === 'audio' || child.attributes.mimeType.startsWith('audio/')))
          .forEach(adaptationSet => {
            adaptationSet.children.sort((a, b) => {
              if (a.tagName === 'AudioChannelConfiguration' && b.tagName !== 'AudioChannelConfiguration') {
                // Push AudioChannelConfiguration to the front (where it seems to already be) so that it doesn't
                // block sorting Representations if it's in the middle instead
                return -1
              } else if (b.tagName === 'AudioChannelConfiguration' && a.tagName !== 'AudioChannelConfiguration') {
                return 1
              } else if (a.tagName === 'Representation' && b.tagName === 'Representation') {
                return b.attributes.bandwidth - a.attributes.bandwidth
              } else {
                return 0
              }
            })
          })
      }
    }

    // #endregion player config

    // #region UI config

    const useVrMode = computed(() => {
      return props.format === 'dash' && props.vrProjection === 'EQUIRECTANGULAR'
    })

    const showInvidiousShareOptions = computed(() => {
      return store.getters.getBackendPreference === 'invidious' || store.getters.getBackendFallback
    })

    const contextMenuElements = computed(() => {
      const elements = [
        'ft_loop',
        'ft_copy_youtube_video_url',
        'ft_copy_youtube_video_url_at_current_time'
      ]

      if (showInvidiousShareOptions.value) {
        elements.push(
          'ft_copy_invidious_video_url',
          'ft_copy_invidious_video_url_at_current_time'
        )
      }

      elements.push('ft_stats')

      return elements
    })

    const uiConfig = computed(() => {
      const controlPanelElements = [
        'ft_skip_previous',
        'play_pause',
        'ft_skip_next',
        'mute',
        'volume',
        'time_and_duration',
        'ft_playback_adjusted_time',
        ...(!onlyUseOverFlowMenu.value && props.chapters.length > 0
          ? ['ft_chapters']
          : []),
        'ft_sponsorblock_highlight',
        'spacer'
      ]

      /** @type {shaka.extern.UIConfiguration} */
      const uiConfig = {
        controlPanelElements: controlPanelElements,
        overflowMenuButtons: [],
        contextMenuElements: contextMenuElements.value,

        // only set this to label when we actually have labels, so that the warning doesn't show up
        // about it being set to labels, but that the audio tracks don't have labels
        trackLabelFormat: hasMultipleAudioTracks.value ? TrackLabelFormat.LABEL : TrackLabelFormat.LANGUAGE_ROLE,
        // Only set it to label if we added the captions ourselves,
        // some live streams come with subtitles in the DASH manifest, but without labels
        textTrackLabelFormat: props.captions.length > 0 ? TrackLabelFormat.LABEL : TrackLabelFormat.LANGUAGE,
        displayInVrMode: useVrMode.value
      }

      /** @type {string[]} */
      let elementList

      if (onlyUseOverFlowMenu.value) {
        uiConfig.overflowMenuButtons = [
          'ft_autoplay_toggle',
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          'playback_rate',
          'ft_skip_silence',
          'ft_sleep_timer',
          'captions',
          'ft_audio_tracks',
          ...(props.chapters.length > 0 ? ['ft_chapters'] : []),
          'ft_ambient_mode',
          'ft_loop',
          'ft_screenshot',
          'picture_in_picture',
          'ft_full_window',
          'recenter_vr',
          'toggle_stereoscopic',
        ]

        elementList = uiConfig.overflowMenuButtons

        uiConfig.controlPanelElements.push('ft_caption_toggle', 'overflow_menu', 'fullscreen')
      } else {
        uiConfig.controlPanelElements.push(
          ...(useQuickPlaybackSpeedBar.value && !isLive.value ? ['ft_quick_playback_rate_bar'] : []),
          'ft_sponsorblock_open_menu',
          'ft_sponsorblock_clear',
          'ft_sponsorblock_start',
          'ft_sponsorblock_cancel',
          'ft_sponsorblock_end',
          'ft_screenshot',
          'ft_autoplay_toggle',
          'ft_caption_toggle',
          'overflow_menu',
          'picture_in_picture',
          'ft_theatre_mode',
          'ft_full_window',
          'fullscreen'
        )

        uiConfig.overflowMenuButtons.push(
          'ft_audio_tracks',
          'captions',
          'playback_rate',
          'ft_skip_silence',
          'ft_sleep_timer',
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          'ft_ambient_mode',
          'ft_loop',
          'recenter_vr',
          'toggle_stereoscopic',
        )

        elementList = uiConfig.controlPanelElements
      }

      if (!enableScreenshot.value || props.format === 'audio') {
        removeFromArrayIfExists(elementList, 'ft_screenshot')
      }

      // Keep the control mounted for videos with chapters so it can become
      // available when their sidebar panel opens.
      if (!props.theatrePossible && props.chapters.length === 0) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_theatre_mode')
      }

      if (!props.autoplayPossible) {
        removeFromArrayIfExists(elementList, 'ft_autoplay_toggle')
      }

      if (props.format === 'audio') {
        removeFromArrayIfExists(elementList, 'picture_in_picture')
      }

      if (props.format === 'audio' || useVrMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_ambient_mode')
      }

      if (!showSkipSilenceButton.value || isLive.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_skip_silence')
      }

      if (isLive.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'loop')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_loop')
      }

      if (!useVrMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'recenter_vr')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'toggle_stereoscopic')
      }

      if (!props.watchingPlaylist) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_skip_previous')
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_skip_next')
      }

      return uiConfig
    })

    /**
     * For the first call we want to set initial values for options that may change later,
     * as well as setting the options that we won't change again.
     *
     * For all subsequent calls we only want to reconfigure the options that have changed.
     * e.g. due to the active format changing or the user changing settings
     * @param {boolean} firstTime
     */
    function configureUI(firstTime = false) {
      // Shaka rebuilds every control element on configure, and several of them
      // dereference the attached player immediately (e.g. the playback rate
      // selection reads player.getPlaybackRate()). While the player is detached
      // or mid-(re)load — the async mount gap, a format switch, or a SABR reload
      // (LOAD_INTERRUPTED) — that rebuild throws synchronously. Because these
      // reconfigures run inside Vue reactive effects, the exception reaches the
      // tab's error boundary and takes the whole tab down. Defer any non-initial
      // reconfigure until the player is loaded again, then flush it once.
      if (!firstTime && (!player || !hasLoaded.value)) {
        pendingUiReconfigure = true
        return
      }

      if (firstTime) {
        /** @type {shaka.extern.UIConfiguration} */
        const firstTimeConfig = {
          addSeekBar: seekingIsPossible.value,
          customContextMenu: true,
          contextMenuElements: contextMenuElements.value,
          enableTooltips: true,
          seekBarColors: {
            // shaka-player's chapter markers only show up part of the time for the DASH and audio formats
            // the issue is clearly on the FreeTube side as shaka-player's demo page works fine and they show up all the time for the legacy formats.
            // As I have spent way too much time debugging it and still cannot make sense of it, we'll stick with FreeTube's own chapter markers for now.
            chapters: 'transparent',
            played: 'var(--primary-color)'
          },
          showAudioCodec: false,
          showVideoCodec: false,
          volumeBarColors: {
            level: 'var(--primary-color)'
          },
          mediaSession: {
            // The WatchVideoInfo component handles that
            handleMetadata: false,
            // Need to override the default list so it doesn't override the next and previous video handlers in the WatchVideoPlaylist component.
            supportedActions: [
              'pause',
              'play',
              'seekbackward',
              'seekforward',
              'seekto'
            ]
          },

          // these have their own watchers
          bigButtons: displayVideoPlayButton.value ? ['play_pause'] : [],
          enableFullscreenOnRotation: enterFullscreenOnDisplayRotate.value,
          playbackRates: playbackRates.value,
          tapSeekDistance: defaultSkipInterval.value,

          // we have our own ones (shaka-player's ones are quite limited)
          enableKeyboardPlaybackControls: false,

          // TODO: enable this when electron gets document PiP support
          // https://github.com/electron/electron/issues/39633
          documentPictureInPicture: {
            enabled: false
          }
        }

        if (document.pictureInPictureEnabled) {
          firstTimeConfig.mediaSession.supportedActions.push('enterpictureinpicture')
        }

        // Combine the config objects so we only need to do one configure call
        // as shaka-player recreates the UI when you call configure
        Object.assign(firstTimeConfig, uiConfig.value)

        ui.configure(firstTimeConfig)
      } else {
        // Another player mounted after us may have overwritten our factories
        // in shaka's shared element registries, which this configure call
        // rebuilds every control element from.
        reRegisterOwnElements()
        ui.configure(uiConfig.value)
      }

      // Shaka recreates its media-session handlers on configure. Re-apply the
      // logical-tab owner handlers so an inactive player cannot take them over.
      registerMediaSessionHandlers()

      // Shaka recreates the controls on configure, but its quality badge is not populated
      // until the next player or submenu event.
      if (hasLoaded.value) {
        ui.getControls().dispatchEvent(new shaka.util.FakeEvent('submenuclose'))
      }

      syncPlayPauseControlIcons()
      syncMuteControlIcons(video.value.muted || video.value.volume === 0)
    }

    function closeChaptersOverlay() {
      showChaptersOverlay.value = false
      events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
        detail: false
      }))
    }

    /**
     * @param {number} startSeconds
     */
    function selectOverlayChapter(startSeconds) {
      setCurrentTime(startSeconds)
    }

    /**
     * @param {number} startSeconds
     */
    function copyChapterTimestamp(startSeconds) {
      const videoUrl = appendTimestamp(getYoutubeVideoShareUrl(props.videoId), Math.floor(startSeconds))

      copyToClipboard(videoUrl, {
        messageOnSuccess: t('Share.Timestamp Link Copied')
      })
    }

    /**
     * @param {WheelEvent} event
     */
    function handleControlsContainerWheel(event) {
      /** @type {DOMTokenList} */
      const classList = event.target.classList

      if (classList.contains('shaka-scrim-container') ||
        classList.contains('shaka-fast-forward-container') ||
        classList.contains('shaka-rewind-container') ||
        classList.contains('shaka-play-button-container') ||
        classList.contains('shaka-play-button') ||
        classList.contains('shaka-controls-container') ||
        classList.contains('shaka-spacer')) {
        //

        if (event.ctrlKey || event.metaKey) {
          if (videoPlaybackRateMouseScroll.value) {
            mouseScrollPlaybackRateHandler(event)
          }
        } else {
          if (videoVolumeMouseScroll.value) {
            mouseScrollVolumeHandler(event)
          } else if (videoSkipMouseScroll.value) {
            mouseScrollSkipHandler(event)
          }
        }
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handleControlsContainerClick(event) {
      if (event.ctrlKey || event.metaKey) {
        // stop shaka-player's click handler firing
        event.stopPropagation()

        player.cancelTrickPlay()

        showValueChange(`${getDefaultPlaybackRateForVideo()}x`)
      }
    }

    /**
     * Only start click-and-hold playback from the non-interactive player surface.
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    function isPlayerSurfaceTarget(target) {
      if (!(target instanceof HTMLElement)) {
        return target === video.value
      }

      return target === video.value || [
        'shaka-scrim-container',
        'shaka-fast-forward-container',
        'shaka-rewind-container',
        'shaka-play-button-container',
        'shaka-play-button',
        'shaka-controls-container',
      ].some(className => target.classList.contains(className))
    }

    /** @type {number | null} */
    let temporaryPlaybackRatePointerId = null
    let temporaryPlaybackRatePointerCancelled = false
    let suppressTemporaryPlaybackRateClick = false

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerDown(event) {
      if (
        event.pointerType !== 'mouse' ||
        event.button !== 0 ||
        !event.isPrimary ||
        event.ctrlKey ||
        event.metaKey ||
        !holdToDoublePlaybackSpeed.value ||
        temporaryPlaybackRatePointerId !== null ||
        !isPlayerSurfaceTarget(event.target)
      ) {
        return
      }

      temporaryPlaybackRatePointerId = event.pointerId
      temporaryPlaybackRatePointerCancelled = false
      startTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerUp(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      const wasActive = temporaryPlaybackRateSources.has(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)

      temporaryPlaybackRatePointerId = null
      suppressTemporaryPlaybackRateClick = wasActive || temporaryPlaybackRatePointerCancelled
      temporaryPlaybackRatePointerCancelled = false

      if (suppressTemporaryPlaybackRateClick) {
        setTimeout(() => {
          suppressTemporaryPlaybackRateClick = false
        })
      }
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerLeave(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      temporaryPlaybackRatePointerCancelled = true
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerCancel(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      temporaryPlaybackRatePointerId = null
      temporaryPlaybackRatePointerCancelled = false
    }

    /**
     * @param {MouseEvent} event
     */
    function handleTemporaryPlaybackRateClick(event) {
      if (!suppressTemporaryPlaybackRateClick) {
        return
      }

      suppressTemporaryPlaybackRateClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    /**
     * @param {HTMLElement} seekBarContainer
     */
    function getChapterPreview(seekBarContainer) {
      if (!container.value) return null

      let chapterPreview = container.value.querySelector('.ft-chapter-preview')

      if (!chapterPreview) {
        chapterPreview = document.createElement('div')
        chapterPreview.className = 'ft-chapter-preview'
        chapterPreview.dir = 'auto'
      }

      if (chapterPreview.parentElement !== seekBarContainer) {
        seekBarContainer.appendChild(chapterPreview)
      }

      return chapterPreview
    }

    /**
     * @param {MouseEvent} event
     */
    function handleSeekBarMouseMove(event) {
      if (!container.value || !player) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      if (props.chapters.length === 0) {
        const chapterPreview = container.value.querySelector('.ft-chapter-preview')
        if (chapterPreview) {
          chapterPreview.style.display = 'none'
        }

        return
      }

      const chapterPreview = getChapterPreview(seekBarContainer)
      if (!chapterPreview) return

      const rect = seekBarContainer.getBoundingClientRect()
      if (rect.width === 0) {
        chapterPreview.style.display = 'none'
        return
      }

      const offsetX = event.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, offsetX / rect.width))

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start
      const hoverTime = seekRange.start + (duration * percentage)

      const chapter = props.chapters.find((candidate, index) => {
        return hoverTime >= candidate.startSeconds &&
          (hoverTime < candidate.endSeconds || (index === props.chapters.length - 1 && hoverTime === candidate.endSeconds))
      })

      if (!chapter) {
        chapterPreview.style.display = 'none'
        return
      }

      if (chapterPreview.textContent !== chapter.title) {
        chapterPreview.textContent = chapter.title
      }

      chapterPreview.style.display = 'inline-block'

      const playerRect = container.value.getBoundingClientRect()
      const maxFromSeekBar = rect.width - 8
      const maxFromPlayer = playerRect.width - 16
      const maxW = Math.max(
        Math.min(
          maxFromSeekBar,
          maxFromPlayer,
          window.innerWidth - 24
        ),
        0
      )
      chapterPreview.style.maxWidth = `${maxW}px`

      const thumbContainer = seekBarContainer.querySelector('.shaka-player-ui-thumbnail-container')
      let bottomPx
      if (thumbContainer && window.getComputedStyle(thumbContainer).visibility === 'visible') {
        const thumbRect = thumbContainer.getBoundingClientRect()
        if (thumbRect.width > 0 && thumbRect.height > 0) {
          bottomPx = rect.bottom - thumbRect.top + 8
        }
      }
      if (bottomPx == null || !Number.isFinite(bottomPx)) {
        bottomPx = seekBarContainer.offsetHeight + 8
      }
      chapterPreview.style.bottom = `${bottomPx}px`

      const previewWidth = chapterPreview.offsetWidth
      const minX = previewWidth / 2
      const maxX = rect.width - (previewWidth / 2)
      const targetX = percentage * rect.width
      const clampedX = Math.max(minX, Math.min(maxX, targetX))

      chapterPreview.style.left = `${clampedX}px`
    }

    function handleSeekBarMouseLeave() {
      if (!container.value) return

      const chapterPreview = container.value.querySelector('.ft-chapter-preview')

      if (chapterPreview) {
        chapterPreview.style.display = 'none'
      }
    }

    /**
     * @param {number} hoverTime
     * @param {number} secondsPerPixel
     * @returns {string}
     */
    function getSponsorBlockSeekBarTooltipLabel(hoverTime, secondsPerPixel) {
      const segments = sponsorBlockSegments.concat(sponsorBlockCompleteDraftSegments.value)
      const pointTolerance = Math.max(secondsPerPixel, 0.5)
      const segment = segments.find((candidate) => {
        if (isSponsorBlockPointSegment(candidate)) {
          return Math.abs(hoverTime - candidate.startTime) <= pointTolerance
        }

        return hoverTime >= candidate.startTime && hoverTime <= candidate.endTime
      })

      return segment ? translateSponsorBlockCategory(segment.category) : ''
    }

    /**
     * @param {MouseEvent} event
     */
    function handleSponsorBlockSeekBarMouseMove(event) {
      if (!container.value || !player) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      const thumbnailTime = seekBarContainer?.querySelector('.shaka-player-ui-thumbnail-time')
      if (!seekBarContainer || !thumbnailTime) return

      const rect = seekBarContainer.getBoundingClientRect()
      if (rect.width === 0) return

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start
      if (!Number.isFinite(duration) || duration <= 0) return

      const offsetX = event.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, offsetX / rect.width))
      const hoverTime = seekRange.start + (duration * percentage)
      const sponsorBlockLabel = getSponsorBlockSeekBarTooltipLabel(hoverTime, duration / rect.width)
      if (sponsorBlockLabel === '') return

      const labelSuffix = ` · ${sponsorBlockLabel}`
      const currentText = thumbnailTime.textContent ?? ''
      if (!currentText.endsWith(labelSuffix)) {
        thumbnailTime.textContent = `${currentText}${labelSuffix}`
      }
    }

    function setupChapterPreview() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      seekBarContainer.removeEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.removeEventListener('mouseleave', handleSeekBarMouseLeave)
      seekBarContainer.addEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.addEventListener('mouseleave', handleSeekBarMouseLeave)
    }

    function setupSponsorBlockSeekBarTooltip() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      seekBarContainer.removeEventListener('mousemove', handleSponsorBlockSeekBarMouseMove)
      seekBarContainer.addEventListener('mousemove', handleSponsorBlockSeekBarMouseMove)
    }

    function addUICustomizations() {
      /** @type {HTMLDivElement} */
      const controlsContainer = ui.getControls().getControlsContainer()

      controlsContainer.removeEventListener('wheel', handleControlsContainerWheel)
      controlsContainer.removeEventListener('click', handleControlsContainerClick, true)
      controlsContainer.removeEventListener('pointerdown', handleTemporaryPlaybackRatePointerDown, true)
      controlsContainer.removeEventListener('pointerleave', handleTemporaryPlaybackRatePointerLeave)
      controlsContainer.removeEventListener('click', handleTemporaryPlaybackRateClick, true)

      controlsContainer.addEventListener('pointerdown', handleTemporaryPlaybackRatePointerDown, true)
      controlsContainer.addEventListener('pointerleave', handleTemporaryPlaybackRatePointerLeave)
      controlsContainer.addEventListener('click', handleTemporaryPlaybackRateClick, true)

      if (!useVrMode.value) {
        if (videoVolumeMouseScroll.value || videoSkipMouseScroll.value || videoPlaybackRateMouseScroll.value) {
          controlsContainer.addEventListener('wheel', handleControlsContainerWheel)
        }

        if (videoPlaybackRateMouseScroll.value) {
          controlsContainer.addEventListener('click', handleControlsContainerClick, true)
        }
      }

      // title overlay when the video is fullscreened
      // placing this inside the controls container so that we can fade it in and out at the same time as the controls
      const fullscreenTitleOverlay = document.createElement('h1')
      fullscreenTitleOverlay.textContent = props.title
      fullscreenTitleOverlay.className = 'playerFullscreenTitleOverlay'
      fullscreenTitleOverlay.dir = 'auto'
      controlsContainer.appendChild(fullscreenTitleOverlay)

      if (hasLoaded.value && props.chapters.length > 0) {
        createChapterMarkers()
      }

      setupChapterPreview()
      setupSponsorBlockSeekBarTooltip()

      const fullscreenButton = controlsContainer.querySelector('.shaka-fullscreen-button')
      if (fullscreenButton instanceof HTMLElement) {
        fullscreenButton.removeEventListener('click', handleFullscreenButtonClick, true)
        fullscreenButton.addEventListener('click', handleFullscreenButtonClick, true)
      }

      if (useSponsorBlock.value && (sponsorBlockSegments.length > 0 || sponsorBlockCompleteDraftSegments.value.length > 0)) {
        refreshSponsorBlockMarkers()
      }

      updateSponsorBlockSubmissionState()
      setupAdaptiveControlPanelLayout()
    }

    watch(uiConfig, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    // Reapply any reconfigure that was deferred while the player was unloaded,
    // now that it is loaded again and rebuilding the controls is safe.
    watch(hasLoaded, (loaded) => {
      if (loaded && pendingUiReconfigure && ui && player) {
        pendingUiReconfigure = false
        configureUI()
      }
    })

    watch(() => props.chapters.length, (chapterCount) => {
      if (chapterCount === 0) {
        closeChaptersOverlay()
      }
    })

    watch(sponsorBlockSubmissionVisibleButtons, () => {
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    watch(() => props.videoId, () => {
      closeChaptersOverlay()
      closeSponsorBlockInfo()
      resetSponsorBlockHighlightLabel()
      loadSponsorBlockDrafts()
      sponsorBlockSubmissionError.value = ''
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    watch(useSponsorBlock, enabled => {
      if (!enabled) {
        closeSponsorBlockInfo()
      }
    })

    watch(sponsorBlockEnableSubmission, () => emitSponsorBlockInfoState())

    watch(sponsorBlockDraftSegmentsByVideoId, () => {
      loadSponsorBlockDrafts()
    }, { deep: true })

    watch(sponsorBlockCompleteDraftSegments, () => {
      if (useSponsorBlock.value && ui) {
        refreshSponsorBlockMarkers()
      }
    }, { deep: true })

    watch(videoVolumeMouseScroll, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(videoPlaybackRateMouseScroll, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(videoSkipMouseScroll, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(() => props.autoplayEnabled, (newValue, oldValue) => {
      if (newValue !== oldValue) {
        events.dispatchEvent(new CustomEvent('setAutoplay', {
          detail: newValue
        }))
      }
    })

    watch(() => props.isLive, (newValue) => {
      isLive.value = newValue
    })

    watch(
      [
        useQuickPlaybackSpeedBar,
        rememberPlaybackSpeedPerChannel,
        autoUpdateChannelPlaybackSpeeds,
        savedChannelPlaybackRate,
        quickPlaybackSpeedBarOptions,
        () => props.channelId
      ],
      () => {
        events.dispatchEvent(new CustomEvent('quickPlaybackRateBarStateChanged'))
      }
    )

    /** @type {ResizeObserver|null} */
    let containerResizeObserver = null

    /** @type {ResizeObserver|null} */
    let controlPanelResizeObserver = null

    /** @type {MutationObserver|null} */
    let controlPanelMutationObserver = null

    /** @type {number|null} */
    let controlPanelLayoutFrame = null

    const controlPanelCompactClasses = [
      'ft-controls-hide-highlight-label',
      'ft-controls-compact-chapters',
      'ft-controls-stack-times'
    ]

    /**
     * @param {HTMLElement} controlPanel
     * @returns {boolean}
     */
    function controlPanelOverflows(controlPanel) {
      let contentWidth = 0
      let crossesPanelEdge = false
      const controlPanelBounds = controlPanel.getBoundingClientRect()
      // Full-window transitions scale the player container. Keep margins in
      // the same visual coordinate space as the bounding rectangles so a
      // measurement during the animation does not leave the compact layout
      // enabled after the transition.
      const inlineScale = controlPanel.clientWidth > 0
        ? controlPanelBounds.width / controlPanel.clientWidth
        : 1

      for (const child of controlPanel.children) {
        if (!(child instanceof HTMLElement)) {
          continue
        }

        const style = window.getComputedStyle(child)
        if (style.display === 'none' || style.position === 'absolute') {
          continue
        }

        const childBounds = child.getBoundingClientRect()
        crossesPanelEdge ||= childBounds.left < controlPanelBounds.left - 1 ||
          childBounds.right > controlPanelBounds.right + 1

        contentWidth += childBounds.width +
          ((Number.parseFloat(style.marginLeft) || 0) * inlineScale) +
          ((Number.parseFloat(style.marginRight) || 0) * inlineScale)
      }

      return crossesPanelEdge ||
        contentWidth > controlPanelBounds.width + inlineScale
    }

    /**
     * Apply space-saving modes in priority order, only when the next mode is needed.
     * @param {HTMLElement} controlPanel
     */
    function updateControlPanelLayout(controlPanel) {
      if (!controlPanel.isConnected) {
        return
      }

      controlPanel.classList.add('ft-controls-measuring')
      controlPanel.classList.remove(...controlPanelCompactClasses)

      for (const compactClass of controlPanelCompactClasses) {
        if (!controlPanelOverflows(controlPanel)) {
          break
        }

        controlPanel.classList.add(compactClass)
      }

      controlPanel.classList.remove('ft-controls-measuring')
    }

    /** @param {HTMLElement} controlPanel */
    function scheduleControlPanelLayout(controlPanel) {
      // Background tabs remain mounted but are hidden with display:none. Do not
      // let their zero-size control bars enter a resize/mutation feedback loop.
      // The active-tab watcher schedules a fresh measurement when presented.
      if (!isActiveTab.value) {
        return
      }

      if (controlPanelLayoutFrame !== null) {
        cancelAnimationFrame(controlPanelLayoutFrame)
      }

      controlPanelLayoutFrame = requestAnimationFrame(() => {
        controlPanelLayoutFrame = null
        updateControlPanelLayout(controlPanel)
      })
    }

    function setupAdaptiveControlPanelLayout() {
      controlPanelResizeObserver?.disconnect()
      controlPanelMutationObserver?.disconnect()

      const controlPanel = container.value?.querySelector('.shaka-controls-button-panel')
      if (!(controlPanel instanceof HTMLElement)) {
        return
      }

      const regularTime = controlPanel.querySelector(':scope > .shaka-current-time:not(.ft-playback-adjusted-time)')
      const adjustedTime = controlPanel.querySelector(':scope > .ft-playback-adjusted-time')

      if (regularTime instanceof HTMLElement && adjustedTime instanceof HTMLElement) {
        const timeDisplayGroup = document.createElement('div')
        timeDisplayGroup.classList.add('ft-time-display-group')
        regularTime.before(timeDisplayGroup)
        timeDisplayGroup.append(regularTime, adjustedTime)
      }

      controlPanelResizeObserver = new ResizeObserver(() => {
        scheduleControlPanelLayout(controlPanel)
      })
      controlPanelResizeObserver.observe(controlPanel)

      controlPanelMutationObserver = new MutationObserver(mutations => {
        if (mutations.some(mutation => mutation.target !== controlPanel)) {
          scheduleControlPanelLayout(controlPanel)
        }
      })
      controlPanelMutationObserver.observe(controlPanel, {
        attributeFilter: ['class'],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true
      })

      scheduleControlPanelLayout(controlPanel)
    }

    /** @type {ResizeObserverCallback} */
    function resized(entries) {
      const inlineSize = entries[0].contentBoxSize[0].inlineSize
      // Ignore measurements taken while the tab is hidden (an ancestor is
      // display:none, so the inline size collapses to 0). Treating that as
      // "narrow" would wrongly fold the whole control bar into the overflow
      // menu, and it would stay collapsed once the tab is presented again.
      if (inlineSize === 0) {
        return
      }
      onlyUseOverFlowMenu.value = inlineSize <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD
      rememberInlinePlayerLayoutHeight()
      repairScrollMiniPlaceholderHeight()
    }

    // Remeasure the control bar layout once the tab becomes presented. A player
    // that mounted in a background tab could not measure its real width, and the
    // ResizeObserver does not always fire for an ancestor display:none toggle.
    function remeasureControlPanelWidth() {
      if (!ui || ui.isMobile()) {
        return
      }
      const width = container.value?.getBoundingClientRect().width ?? 0
      if (width > 0) {
        onlyUseOverFlowMenu.value = width <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD

        const controlPanel = container.value?.querySelector('.shaka-controls-button-panel')
        if (controlPanel instanceof HTMLElement) {
          scheduleControlPanelLayout(controlPanel)
        }
      }
    }

    // #endregion UI config

    // #region player locales

    // shaka-player ships with some locales prebundled and already loaded
    const loadedLocales = new Set(process.env.SHAKA_LOCALES_PREBUNDLED)
    const originalShakaControlLocalizations = new Map()

    /**
     * @param {string} locale
     */
    async function setLocale(locale) {
      // For most of FreeTube's locales, there is an equivalent one in shaka-player,
      // however if there isn't one we should fall back to US English.
      // At the time of writing "et", "eu", "gl", "is" don't have any translations
      const shakaLocale = LOCALE_MAPPINGS.get(locale) ?? 'en'

      const localization = ui.getControls().getLocalization()

      const cachedLocales = store.state.player.cachedPlayerLocales

      if (!loadedLocales.has(shakaLocale)) {
        if (!Object.hasOwn(cachedLocales, shakaLocale)) {
          await store.dispatch('cachePlayerLocale', shakaLocale)
        }

        localization.insert(shakaLocale, new Map(Object.entries(cachedLocales[shakaLocale])))

        loadedLocales.add(shakaLocale)
      }

      localization.changeLocale([shakaLocale])

      // Add the keyboard shortcut to the label for the default Shaka controls
      if (!originalShakaControlLocalizations.has(shakaLocale)) {
        const controlLocalizations = new Map()
        Object.keys(shakaControlKeysToShortcuts).forEach((shakaControlKey) => {
          controlLocalizations.set(shakaControlKey, localization.resolve(shakaControlKey))
        })
        originalShakaControlLocalizations.set(shakaLocale, controlLocalizations)
      }

      const shakaControlKeysToShortcutLocalizations = new Map()
      Object.entries(shakaControlKeysToShortcuts).forEach(([shakaControlKey, getShortcut]) => {
        const originalLocalization = originalShakaControlLocalizations.get(shakaLocale).get(shakaControlKey)
        if (originalLocalization === '') {
          // e.g., A Shaka localization key in shakaControlKeysToShortcuts has fallen out of date and need to be updated
          console.error('Missing Shaka localization key "%s"', shakaControlKey)
          return
        }

        const localizationWithShortcut = addKeyboardShortcutToActionTitle(
          originalLocalization,
          getShortcut()
        )

        shakaControlKeysToShortcutLocalizations.set(shakaControlKey, localizationWithShortcut)
      })

      localization.insert(shakaLocale, shakaControlKeysToShortcutLocalizations)

      events.dispatchEvent(new CustomEvent('localeChanged'))
    }

    watch(locale, setLocale)
    watch(() => store.getters.getKeyboardShortcuts, () => setLocale(locale.value))

    // #endregion player locales

    function registerMediaSessionHandlers() {
      if (!('mediaSession' in navigator)) {
        return
      }

      tabMediaCoordinator.setActionHandlers(mediaTabId, 'player', {
        play: () => video.value?.play(),
        pause: () => video.value?.pause(),
        stop: () => {
          const videoElement = video.value
          if (!videoElement) return
          videoElement.pause()
          if (Number.isFinite(videoElement.duration)) {
            videoElement.currentTime = 0
          }
        },
        seekbackward: (details = {}) => {
          seekBySeconds(-(details.seekOffset ?? defaultSkipInterval.value), false, true)
        },
        seekforward: (details = {}) => {
          seekBySeconds(details.seekOffset ?? defaultSkipInterval.value, false, true)
        },
        seekto: (details = {}) => {
          const videoElement = video.value
          if (!videoElement || !Number.isFinite(details.seekTime)) return
          if (details.fastSeek === true && typeof videoElement.fastSeek === 'function') {
            videoElement.fastSeek(details.seekTime)
          } else {
            videoElement.currentTime = details.seekTime
          }
        },
        enterpictureinpicture: () => {
          if (props.format !== 'audio' && ui?.getControls?.().isPiPAllowed()) {
            ui.getControls().togglePiP()
          }
        }
      })
    }

    // #region video event handlers

    /**
     * @param {Element} button
     * @param {string} iconPath
     */
    function createPlayPauseMorphIcon(button, iconPath) {
      const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
      icon.classList.add('shaka-ui-icon', 'ft-play-pause-morph-icon')
      icon.setAttribute('viewBox', '0 0 24 24')
      icon.setAttribute('aria-hidden', 'true')

      const path = document.createElementNS(SVG_NAMESPACE, 'path')
      path.setAttribute('d', iconPath)
      icon.appendChild(path)
      button.appendChild(icon)
    }

    function syncPlayPauseControlIcons() {
      const video_ = video.value
      if (!video_) return

      const nextState = video_.ended && video_.duration ? 'replay' : video_.paused ? 'play' : 'pause'

      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-play-button').forEach((button) => {
          if (!button.querySelector('.ft-play-pause-morph-icon')) {
            createPlayPauseMorphIcon(button, PLAY_MORPH_PATH)
          }

          button.setAttribute('data-ft-play-pause-state', nextState)
        })
      })
    }

    /**
     * @param {boolean} muted
     */
    function syncMuteControlIcons(muted) {
      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-mute-button').forEach((button) => {
          button.querySelector(':scope > .shaka-ui-icon > path')?.setAttribute(
            'd',
            shaka.ui.Enums.MaterialDesignSVGIcons.MUTE
          )

          if (!button.querySelector('.ft-mute-toggle-slash')) {
            const slash = document.createElement('span')
            slash.classList.add('ft-mute-toggle-slash')
            slash.ariaHidden = 'true'
            button.appendChild(slash)
          }

          button.setAttribute('data-ft-muted', String(muted))
        })
      })
    }

    function handlePlay() {
      if (process.env.IS_ELECTRON && !isActiveTab.value) {
        video.value.pause()
        return
      }

      flushPendingMusicPlaybackRateToast()

      syncPlayPauseControlIcons()

      sleepTimer.resumeCountdown()
      startSponsorBlockHighlightLabelCountdown()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'playing')

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('playing', tabId)
      }

      updateAutoPip()
      updateScrollMiniPlayer()

      if (scrollMiniPlayerActive.value) {
        showScrollMiniPlayPause(true)
      }
    }

    function handlePause() {
      syncPlayPauseControlIcons()

      sleepTimer.pauseCountdown()
      pauseSponsorBlockHighlightLabelCountdown()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'paused')

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('paused', tabId)
      }

      updateAutoPip()
      updateScrollMiniPlayer()

      if (scrollMiniPlayerActive.value) {
        showScrollMiniPlayPause(false)
      }

      emit('pause')
    }

    function handleEnded() {
      syncPlayPauseControlIcons()

      sleepTimer.pauseCountdown()
      const sleepTimerEnded = sleepTimer.consumeEndOfVideo()

      pauseSponsorBlockHighlightLabelCountdown()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none', tabId)
      }

      updateAutoPip()

      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }

      emit('ended', sleepTimerEnded)
    }

    function applyPendingPresentationModes() {
      if (!isActiveTab.value || !ui) {
        return
      }

      if (startInFullwindow && fullWindowListenerReady) {
        startInFullwindow = false
        events.dispatchEvent(new CustomEvent('setFullWindow', { detail: true }))
      }

      if (startInFullscreen && hasLoaded.value && process.env.IS_ELECTRON) {
        startInFullscreen = false
        window.ftElectron.requestFullscreen(tabId)
      }

      if (
        startInPip &&
        props.format !== 'audio' &&
        ui.getControls().isPiPAllowed() &&
        process.env.IS_ELECTRON
      ) {
        startInPip = false
        window.ftElectron.requestPiP(tabId)
      }
    }

    function handleCanPlay() {
      // PiP can only be activated once the video's readyState and video track are populated.
      applyPendingPresentationModes()

      // Re-evaluate auto-PiP now that PiP is actually allowed (the video was possibly
      // in a hidden tab / scrolled out of view while still loading).
      updateAutoPip()
      updateScrollMiniVideoAspectRatio()
      updateScrollMiniPlayer()
    }

    function updateVolume() {
      const video_ = video.value
      const muted = video_.muted || video_.volume === 0

      syncMuteControlIcons(muted)

      if (showStats.value) {
        stats.volume = (video_.volume * 100).toFixed(1)
      }

      if (!rememberVolume.value || applyingInitialVolume) {
        return
      }

      const remembered = getRememberedPlayerVolume()

      // https://docs.videojs.com/html5#volume
      if (remembered !== null && !remembered.muted && video_.volume === 0) {
        // If video is muted by dragging volume slider, it doesn't change 'muted' to true
        // hence compare it with the last remembered unmuted state and restore default volume.
        setRememberedPlayerVolume(defaultVolume.value, true)
      } else {
        setRememberedPlayerVolume(video_.volume, video_.muted)
      }
    }

    /**
     * @param {HTMLVideoElement} videoElement
     */
    function applyInitialVolume(videoElement) {
      applyingInitialVolume = true

      if (rememberVolume.value) {
        const remembered = getRememberedPlayerVolume()

        if (remembered !== null) {
          videoElement.volume = remembered.volume
          videoElement.muted = remembered.muted
        } else {
          videoElement.volume = defaultVolume.value
          videoElement.muted = defaultVolume.value === 0
        }
      } else {
        videoElement.volume = defaultVolume.value
        videoElement.muted = defaultVolume.value === 0
      }

      applyingInitialVolume = false
    }

    function handleTimeupdate() {
      if (video.value) {
        const currentTime = video.value.currentTime
        sponsorBlockCurrentTime.value = currentTime
        annotationCurrentTime.value = currentTime

        emit('timeupdate', currentTime)
        emitTerminalSponsorBlockOutroStarted(currentTime)

        if (showStats.value && hasLoaded.value) {
          updateStats()
        }

        handleSponsorBlockPreviewSkip(currentTime)

        if (useSponsorBlock.value && sponsorBlockSegments.length > 0 && canSeek()) {
          syncPromptSponsorBlockSegments(currentTime)
          updateSponsorBlockHighlightState(currentTime)

          if (!props.sponsorBlockAutoSkipDisabled) {
            skipSponsorBlockSegments(currentTime)
          }
        }

        updateScrollMiniDragHandleContrast()
      }
    }

    /**
     * @param {number} currentTime
     */
    function emitTerminalSponsorBlockOutroStarted(currentTime) {
      if (terminalSponsorBlockOutroStarted || video.value?.paused || !useSponsorBlock.value) {
        return
      }

      const videoDuration = getSponsorBlockSubmissionVideoDuration()
      if (!Number.isFinite(videoDuration)) {
        return
      }

      const terminalOutro = sponsorBlockSegments.find(segment =>
        segment.category === 'outro' &&
        Math.abs(segment.endTime - videoDuration) <= SPONSORBLOCK_TERMINAL_OUTRO_TOLERANCE_SECONDS &&
        currentTime >= segment.startTime &&
        currentTime <= segment.endTime
      )

      if (terminalOutro) {
        terminalSponsorBlockOutroStarted = true
        emit('terminal-outro-started', currentTime)
      }
    }

    const videoElementWidth = ref(0)
    const videoElementHeight = ref(0)
    const {
      deactivateScrollMiniPlayer,
      handleFullscreenButtonClick,
      handleScrollMiniControlsPointerMove,
      handleScrollMiniDragPointerDown,
      handleScrollMiniPlayerEnter,
      handleScrollMiniPlayerLeave,
      handleScrollMiniPlayPauseMouseEnter,
      handleScrollMiniResizePointerDown,
      handleScrollMiniVolumeMouseEnter,
      handleScrollMiniVolumeMouseLeave,
      handleScrollMiniVolumePointerDown,
      handleScrollMiniWindowResize,
      handleScrollMiniWindowScroll,
      isNativeFullscreenActive,
      rememberInlinePlayerLayoutHeight,
      repairScrollMiniPlaceholderHeight,
      scrollMiniAnchor,
      scrollMiniDragHandleOnLightBg,
      scrollMiniIsPaused,
      scrollMiniPlaceholder,
      scrollMiniPlaceholderHeight,
      scrollMiniPlayerActive,
      scrollMiniPlayerStyle,
      scrollMiniPlayPauseVisible,
      scrollMiniResizeCorner,
      scrollMiniResizeHandleOnLightBg,
      scrollMiniScrollToTop,
      scrollMiniTogglePlayPause,
      scrollMiniVolume,
      scrollMiniVolumeExpanded,
      scrollMiniVolumeIcon,
      scrollMiniVolumePercent,
      scrollMiniVolumeTrack,
      setupScrollMiniIntersectionObserver,
      showScrollMiniPlayPause,
      suppressScrollMiniPlayPausePointerReveal,
      teardownScrollMiniPlayer,
      togglePlayerFullScreen,
      updateScrollMiniDragHandleContrast,
      updateScrollMiniPlayer,
      updateScrollMiniVideoAspectRatio,
      updateScrollMiniVolume,
    } = useScrollMiniPlayer({
      container,
      fullWindowEnabled,
      getUi: () => ui,
      isActiveTab,
      props,
      video,
    })

    const ambientModeVisible = computed(() => {
      return isActiveTab.value &&
        ambientMode.value &&
        props.format !== 'audio' &&
        props.vrProjection !== 'EQUIRECTANGULAR' &&
        !scrollMiniPlayerActive.value
    })

    const { ambientCanvas, ambientFullscreenCanvas, ambientLayoutCanvas } = useAmbientMode({
      enabled: ambientModeVisible,
      video,
    })

    /** @type {ResizeObserver} */
    const videoResizeObserver = new ResizeObserver(() => {
      if (video.value) {
        const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1
        const video_ = video.value

        videoElementWidth.value = video_.clientWidth * devicePixelRatio
        videoElementHeight.value = video_.clientHeight * devicePixelRatio
        updateScrollMiniVideoAspectRatio()
      }
    })

    /** @type {PictureInPictureWindow | null} */
    let pipWindow = null
    const pipWindowWidth = ref(null)
    const pipWindowHeight = ref(null)

    /**
     * @param {PictureInPictureEvent} event
     */
    function handleEnterPictureInPicture(event) {
      pipWindow = event.pictureInPictureWindow
      handlePictureInPictureResize()
      pipWindow.addEventListener('resize', handlePictureInPictureResize)

      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }
    }

    function handleLeavePictureInPicture() {
      if (pipWindow) {
        pipWindow.removeEventListener('resize', handlePictureInPictureResize)
      }

      pipWindow = null
      pipWindowWidth.value = null
      pipWindowHeight.value = null

      resetAutoPictureInPictureOwnership()

      updateScrollMiniPlayer()
    }

    function handlePictureInPictureResize() {
      const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1

      pipWindowWidth.value = pipWindow.width * devicePixelRatio
      pipWindowHeight.value = pipWindow.height * devicePixelRatio
    }

    function clearDisplayedCaptions() {
      const textContainer = container.value?.getElementsByClassName('shaka-text-container')[0]

      if (textContainer instanceof HTMLElement) {
        textContainer.replaceChildren()
      }
    }

    function wrapTextTrackSelection() {
      const selectTextTrack = player.selectTextTrack.bind(player)

      player.selectTextTrack = (track = null) => {
        const activeTextTrack = player.getTextTracks().find(textTrack => textTrack.active)

        if (track === null) {
          clearDisplayedCaptions()
        } else {
          lastSelectedCaptionTrack = track

          if (activeTextTrack && activeTextTrack.id !== track.id) {
            selectTextTrack(null)
            clearDisplayedCaptions()
          }
        }

        selectTextTrack(track)
      }
    }

    const playerWidth = computed(() => Math.round(pipWindowWidth.value ?? videoElementWidth.value))
    const playerHeight = computed(() => Math.round(pipWindowHeight.value ?? videoElementHeight.value))
    const compactAutoplayLayout = computed(() => playerHeight.value > 0 && playerHeight.value <= 440)
    const tinyAutoplayLayout = computed(() => playerWidth.value > 0 && playerWidth.value <= 360)

    // #endregion video event handlers

    // #region SABR

    /** @type {shaka.extern.Manifest | undefined} */
    let sabrManifest

    /** @type {import('../../helpers/player/SabrSchemePlugin').SabrStream | undefined} */
    let sabrStream
    /** @type {AbortController | undefined} */
    let sabrAbortController

    const sabrBackoffRemainingMs = ref(0)
    const sabrBackoffDurationMs = ref(0)
    /** @type {number|null} */
    let sabrBackoffIntervalId = null

    const preRollRemainingMs = ref(0)
    const preRollDurationMs = ref(0)
    /** @type {number|null} */
    let preRollIntervalId = null

    const countdownRemainingMs = computed(() => sabrBackoffRemainingMs.value || preRollRemainingMs.value)
    const countdownDurationMs = computed(() => sabrBackoffRemainingMs.value > 0 ? sabrBackoffDurationMs.value : preRollDurationMs.value)
    const showCountdownOverlay = computed(() => countdownRemainingMs.value > 0)
    const countdownTimeSeconds = computed(() => +(countdownRemainingMs.value / 1000).toFixed(1))
    const countdownTimeLabel = computed(() => `${countdownTimeSeconds.value}s`)
    const countdownAriaLabel = computed(() => {
      if (sabrBackoffRemainingMs.value > 0) {
        return t('Video.Watch.Remaining SABR backoff time: {remindingTimeSeconds}s', { remindingTimeSeconds: countdownTimeSeconds.value })
      }

      return t('Video.Watch.Remaining preroll-ad time: {remindingTimeSeconds}s', { remindingTimeSeconds: countdownTimeSeconds.value })
    })
    const COUNTDOWN_RING_RADIUS = 38
    const countdownRingCircumference = 2 * Math.PI * COUNTDOWN_RING_RADIUS
    const countdownRingDashoffset = computed(() => {
      if (countdownDurationMs.value <= 0) {
        return countdownRingCircumference
      }

      const progress = 1 - (countdownRemainingMs.value / countdownDurationMs.value)
      const clampedProgress = Math.min(1, Math.max(0, progress))
      return countdownRingCircumference * (1 - clampedProgress)
    })

    function requestTabPreviewRefresh(delayMs = SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS) {
      if (
        !process.env.IS_ELECTRON ||
        typeof window.ftElectron?.tabs?.requestPreviewRefresh !== 'function'
      ) {
        return
      }

      window.ftElectron.tabs.requestPreviewRefresh({ tabId, delayMs })
    }

    function clearSabrBackoffTimer({ refreshPreview = false } = {}) {
      if (sabrBackoffIntervalId !== null) {
        clearInterval(sabrBackoffIntervalId)
        sabrBackoffIntervalId = null
      }

      sabrBackoffRemainingMs.value = 0
      sabrBackoffDurationMs.value = 0

      if (refreshPreview) {
        requestTabPreviewRefresh()
      }
    }

    function clearPreRollTimer() {
      if (preRollIntervalId !== null) {
        clearInterval(preRollIntervalId)
        preRollIntervalId = null
      }

      preRollRemainingMs.value = 0
      preRollDurationMs.value = 0
    }

    function startSabrBackoffTimer(backoffMs) {
      if (backoffMs <= 0) {
        clearSabrBackoffTimer({ refreshPreview: true })
        return
      }

      const endsAt = Date.now() + backoffMs
      sabrBackoffDurationMs.value = backoffMs

      const updateRemainingMs = () => {
        const remainingMs = Math.max(0, endsAt - Date.now())
        sabrBackoffRemainingMs.value = remainingMs

        if (remainingMs === 0) {
          clearSabrBackoffTimer({ refreshPreview: true })
        }
      }

      if (sabrBackoffIntervalId !== null) {
        clearInterval(sabrBackoffIntervalId)
      }

      updateRemainingMs()
      requestTabPreviewRefresh()
      sabrBackoffIntervalId = setInterval(updateRemainingMs, 100)
    }

    function startPreRollTimer(delayMs) {
      if (delayMs <= 0) {
        clearPreRollTimer()
        return
      }

      const endsAt = Date.now() + delayMs
      preRollDurationMs.value = delayMs

      const updateRemainingMs = () => {
        const remainingMs = Math.max(0, endsAt - Date.now())
        preRollRemainingMs.value = remainingMs

        if (remainingMs === 0) {
          clearPreRollTimer()
        }
      }

      if (preRollIntervalId !== null) {
        clearInterval(preRollIntervalId)
      }

      updateRemainingMs()
      preRollIntervalId = setInterval(updateRemainingMs, 100)
    }

    if (process.env.SUPPORTS_LOCAL_API && props.sabrData) {
      sabrStream = /** @__NOINLINE__ */ setupSabrScheme(props.sabrData, () => player, () => sabrManifest, playerWidth, playerHeight)
      sabrAbortController = new AbortController()
      sabrStream.onBackoffRequested(({ backoffMs }) => {
        startSabrBackoffTimer(backoffMs)
      })
      sabrStream.onReloadOnce(() => {
        sabrAbortController.abort()
        clearSabrBackoffTimer()
        emit('player-reload-requested', getSabrReloadState())
      })
    }

    // #endregion SABR

    // #region request/response filters

    /** @type {shaka.extern.RequestFilter} */
    function requestFilter(type, request, _context) {
      if (type === RequestType.SEGMENT) {
        const url = new URL(request.uris[0])
        const isSabrRequest = props.sabrData && url.protocol === `${props.sabrData.scheme}:`

        // only when we aren't proxying through Invidious,
        // it doesn't like the range param and makes get requests to youtube anyway
        if (!isSabrRequest && url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
          request.method = 'POST'
          request.body = new Uint8Array([0x78, 0]) // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses)

          if (request.headers.Range) {
            request.uris[0] += `&range=${request.headers.Range.split('=')[1]}`
            delete request.headers.Range
          }

          request.uris[0] += '&alr=yes'
        }
      }
    }

    /** @type {shaka.extern.ResponseFilter} */
    async function responseFilter(type, response, context) {
      if (type === RequestType.SEGMENT) {
        const url = new URL(response.uri)

        if (props.sabrData && url.protocol === `${props.sabrData.scheme}:`) {
          return
        }

        if (response.data && response.data.byteLength > 4 &&
          new DataView(response.data).getUint32(0) === HTTP_IN_HEX) {
          // Interpret the response data as a URL string.
          const responseAsString = shaka.util.StringUtils.fromUTF8(response.data)

          const retryParameters = player.getConfiguration().streaming.retryParameters

          // Make another request for the redirect URL.
          const uris = [responseAsString]
          const redirectRequest = shaka.net.NetworkingEngine.makeRequest(uris, retryParameters)
          const requestOperation = player.getNetworkingEngine().request(type, redirectRequest, context)
          const redirectResponse = await requestOperation.promise

          // Modify the original response to contain the results of the redirect
          // response.
          response.data = redirectResponse.data
          response.headers = redirectResponse.headers
          response.uri = redirectResponse.uri
        } else {
          // Fix positioning for auto-generated subtitles
          if (url.hostname.endsWith('.youtube.com') && url.pathname === '/api/timedtext' &&
            url.searchParams.get('caps') === 'asr' && url.searchParams.get('kind') === 'asr' && url.searchParams.get('fmt') === 'vtt') {
            const stringBody = new TextDecoder().decode(response.data)
            // position:0% for LTR text and position:100% for RTL text
            const cleaned = stringBody.replaceAll(/ align:start position:(?:10)?0%$/gm, '')

            response.data = new TextEncoder().encode(cleaned).buffer
          }
        }
      } else if (type === RequestType.MANIFEST && context.type === AdvancedRequestType.MEDIA_PLAYLIST) {
        const url = new URL(response.uri)

        let modifiedText

        // Fixes proxied HLS manifests, as Invidious replaces the path parameters with query parameters,
        // so shaka-player isn't able to infer the mime type from the `/file/seg.ts` part like it does for non-proxied HLS manifests.
        // Shaka-player does attempt to detect it with HEAD request but the `Content-Type` header is `application/octet-stream`,
        // which still doesn't tell shaka-player how to handle the stream because that's the equivalent of saying "binary data".
        if (url.searchParams.has('local')) {
          const stringBody = new TextDecoder().decode(response.data)

          modifiedText = stringBody.replaceAll(/https?:\/\/.+$/gm, hlsProxiedUrlReplacer)
        }

        // The audio-only streams are actually raw AAC, so correct the file extension from `.ts` to `.aac`
        if (/\/itag\/23[34]\//.test(url.pathname) || url.searchParams.get('itag') === '233' || url.searchParams.get('itag') === '234') {
          if (!modifiedText) {
            modifiedText = new TextDecoder().decode(response.data)
          }

          modifiedText = modifiedText.replaceAll('/file/seg.ts', '/file/seg.aac')
        }

        if (modifiedText) {
          response.data = new TextEncoder().encode(modifiedText).buffer
        }
      }
    }

    /**
     * @param {string} match
     */
    function hlsProxiedUrlReplacer(match) {
      const url = new URL(match)

      let fileValue
      for (const [key, value] of url.searchParams) {
        if (key === 'file') {
          fileValue = value
          continue
        } else if (key === 'hls_chunk_host') {
          // Add the host parameter so some Invidious instances stop complaining about the missing host parameter
          // Replace .c.youtube.com with .googlevideo.com as the built-in Invidious video proxy only accepts host parameters with googlevideo.com
          url.pathname += `/host/${encodeURIComponent(value.replace('.c.youtube.com', '.googlevideo.com'))}`
        }

        url.pathname += `/${key}/${encodeURIComponent(value)}`
      }

      // This has to be right at the end so that shaka-player can read the file extension
      url.pathname += `/file/${encodeURIComponent(fileValue)}`

      url.search = ''
      return url.toString()
    }

    // #endregion request/response filters

    // #region set quality

    /**
     * @param {number | undefined} width
     * @param {number | undefined} height
     * @returns {string | null}
     */
    function getQualityFromDimensions(width, height) {
      if (typeof width !== 'number' || typeof height !== 'number') {
        return null
      }

      return `${height > width ? width : height}`
    }

    /**
     * @returns {string | null}
     */
    function getActiveVariantQuality() {
      const activeVariant = player.getVariantTracks().find(track => track.active)

      if (!activeVariant) {
        return null
      }

      return getQualityFromDimensions(activeVariant.width, activeVariant.height)
    }

    /**
     * @param {number} quality
     * @param {number | undefined} audioBandwidth
     * @param {string | undefined} label
     */
    function setDashQuality(quality, audioBandwidth, label) {
      let variants = player.getVariantTracks()

      if (label) {
        variants = variants.filter(variant => variant.label === label)
      } else if (hasMultipleAudioTracks.value) {
        // default audio track
        const filteredVariants = variants.filter(variant => variant.audioRoles.includes('main'))
        // Sometimes there is nothing marked as main, don't filter in this case
        if (filteredVariants.length > 0) {
          variants = filteredVariants
        }
      }

      const isPortrait = variants[0].height > variants[0].width

      let matches = variants.filter(variant => {
        const { width, height } = variant
        const [primary, secondary] = isPortrait ? [width, height] : [height, width]
        const aspectRatio = secondary / primary
        const resolution = aspectRatio > 16 / 9 ? Math.round(secondary * 9 / 16) : primary
        return quality === resolution
      })

      if (matches.length === 0) {
        matches = variants.filter(variant => {
          return quality > (isPortrait ? variant.width : variant.height)
        })
      }

      matches.sort((a, b) => isPortrait ? b.width - a.width : b.height - a.height)

      let chosenVariant

      if (typeof audioBandwidth === 'number') {
        const width = matches[0].width
        const height = matches[0].height

        matches = matches.filter(variant => variant.width === width && variant.height === height)

        chosenVariant = findMostSimilarAudioBandwidth(matches, audioBandwidth)
      } else {
        chosenVariant = matches[0]
      }

      player.selectVariantTrack(chosenVariant)
    }

    /**
     * @param {number|null} playbackPosition
     * @param {number|undefined} previousQuality
     * @param {number|null|undefined} playbackRate
     */
    async function setLegacyQuality(playbackPosition = null, previousQuality = undefined, playbackRate = undefined) {
      if (typeof previousQuality === 'undefined') {
        previousQuality = preferredVideoQuality.value
      }

      /** @type {object[]} */
      const legacyFormats = props.legacyFormats

      const isPortrait = legacyFormats[0].height > legacyFormats[0].width

      let matches = legacyFormats.filter(variant => {
        return previousQuality === isPortrait ? variant.width : variant.height
      })

      if (matches.length === 0) {
        matches = legacyFormats.filter(variant => {
          return previousQuality > isPortrait ? variant.width : variant.height
        })

        if (matches.length > 0) {
          matches.sort((a, b) => b.bitrate - a.bitrate)
        } else {
          matches = legacyFormats.sort((a, b) => a.bitrate - b.bitrate)
        }
      }

      hasMultipleAudioTracks.value = false

      events.dispatchEvent(new CustomEvent('setLegacyFormat', {
        detail: {
          format: matches[0],
          playbackPosition,
          playbackRate
        }
      }))
    }

    // #endregion set quality

    // #region stats

    function gatherInitialStatsValues() {
      /** @type {HTMLVideoElement} */
      const video_ = video.value

      stats.volume = (video_.volume * 100).toFixed(1)

      if (props.format === 'legacy') {
        updateLegacyQualityStats(activeLegacyFormat.value)
      }

      if (!hasLoaded.value) {
        player.addEventListener('loaded', () => {
          if (showStats.value) {
            if (props.format !== 'legacy') {
              updateQualityStats({
                newTrack: player.getVariantTracks().find(track => track.active)
              })
            }

            updateStats()
          }
        }, {
          once: true
        })

        return
      }

      if (props.format !== 'legacy') {
        updateQualityStats({
          newTrack: player.getVariantTracks().find(track => track.active)
        })
      }

      updateStats()
    }

    /**
     * @param {{
     *   type: ('adaptation'|'variantchanged'),
     *   newTrack: shaka.extern.Track,
     *   oldTrack: shaka.extern.Track
     * }} track
     */
    function updateQualityStats({ newTrack }) {
      if (!showStats.value || props.format === 'legacy') {
        return
      }

      stats.bitrate = (newTrack.bandwidth / 1000).toFixed(2)

      // Combined audio and video HLS streams
      if (newTrack.videoCodec?.includes(',')) {
        stats.codecs.audioItag = ''
        stats.codecs.videoItag = ''

        const [audioCodec, videoCodec] = newTrack.videoCodec.split(',')

        stats.codecs.audioCodec = audioCodec
        stats.codecs.videoCodec = videoCodec

        stats.resolution.frameRate = newTrack.frameRate
        stats.resolution.width = newTrack.width
        stats.resolution.height = newTrack.height
      } else {
        stats.codecs.audioItag = newTrack.originalAudioId.split('-', 1)[0]
        stats.codecs.audioCodec = newTrack.audioCodec

        if (props.format === 'dash') {
          stats.resolution.frameRate = newTrack.frameRate

          stats.codecs.videoItag = newTrack.originalVideoId.split('-', 1)[0]
          stats.codecs.videoCodec = newTrack.videoCodec

          stats.resolution.width = newTrack.width
          stats.resolution.height = newTrack.height
        }
      }
    }

    function updateLegacyQualityStats(newFormat) {
      if (!showStats.value || props.format !== 'legacy') {
        return
      }

      const { fps, bitrate, mimeType, itag, width, height } = newFormat

      const codecsMatch = mimeType.match(/codecs="(?<videoCodec>.+), ?(?<audioCodec>.+)"/)

      stats.codecs.audioItag = itag
      stats.codecs.audioCodec = codecsMatch.groups.audioCodec

      stats.codecs.videoItag = itag
      stats.codecs.videoCodec = codecsMatch.groups.videoCodec

      stats.resolution.frameRate = fps

      stats.bitrate = (bitrate / 1000).toFixed(2)

      stats.resolution.width = width
      stats.resolution.height = height
    }

    function updateStats() {
      const playerStats = player.getStats()

      if (props.format !== 'audio') {
        stats.frames = {
          droppedFrames: playerStats.droppedFrames,
          totalFrames: playerStats.decodedFrames
        }
      }

      if (props.format !== 'legacy') {
        // estimated bandwidth is NaN for legacy, as none of the requests go through shaka,
        // so it has no way to estimate the bandwidth
        stats.bandwidth = (playerStats.estimatedBandwidth / 1000).toFixed(2)
      }

      let bufferedSeconds = 0

      const buffered = player.getBufferedInfo().total

      for (const { start, end } of buffered) {
        bufferedSeconds += end - start
      }

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start

      stats.buffered = ((bufferedSeconds / duration) * 100).toFixed(2)
    }

    watch(showStats, (newValue) => {
      if (newValue) {
        // for abr changes/auto quality
        player.addEventListener('adaptation', updateQualityStats)

        // for manual changes e.g. in quality selector
        player.addEventListener('variantchanged', updateQualityStats)
      } else {
        // for abr changes/auto quality
        player.removeEventListener('adaptation', updateQualityStats)

        // for manual changes e.g. in quality selector
        player.removeEventListener('variantchanged', updateQualityStats)
      }
    })

    watch(activeLegacyFormat, updateLegacyQualityStats)

    // #endregion stats

    // #region screenshots

    async function takeScreenshot() {
      const video_ = video.value

      const width = video_.videoWidth
      const height = video_.videoHeight

      if (width <= 0) {
        return
      }

      // Need to set crossorigin="anonymous" for LegacyFormat on Invidious
      // https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(video_, 0, 0)

      // Navigator Clipboard API only supports PNG
      const format = screenshotMode.value === 'clipboard' ? 'png' : screenshotFormat.value
      const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`
      // imageQuality is ignored for pngs, so it is still okay to pass the quality value
      const imageQuality = screenshotQuality.value / 100

      const wasPlaying = !video_.paused
      if ((!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') && wasPlaying) {
        video_.pause()
      }

      try {
        /** @type {Blob} */
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, imageQuality))

        if (screenshotMode.value === 'clipboard') {
          await copyToClipboard(blob, { messageOnSuccess: t('Screenshot Clipboard Success'), messageOnError: t('Screenshot Clipboard Error') })
        } else if (screenshotMode.value === 'prompt_folder' || screenshotMode.value === 'default_folder') {
          let filename
          try {
            filename = await store.dispatch('parseScreenshotCustomFileName', {
              date: new Date(),
              playerTime: video_.currentTime,
              videoId: props.videoId
            })
          } catch (err) {
            console.error(`Parse failed: ${err.message}`)
            showToast(t('Screenshot Error', { error: err.message }))
            canvas.remove()
            return
          }

          const filenameWithExtension = `${filename}.${format}`

          if (!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') {
            const saved = await writeFileWithPicker(
              filenameWithExtension,
              blob,
              format.toUpperCase(),
              mimeType,
              `.${format}`,
              'player-screenshots',
              'pictures'
            )

            if (saved) {
              showToast(t('Screenshot Success'))
            }
          } else {
            const arrayBuffer = await blob.arrayBuffer()

            if (await window.ftElectron.writeToDefaultFolder(filenameWithExtension, arrayBuffer)) {
              showToast(t('Screenshot Success'))
            }
          }
        }
      } catch (error) {
        console.error(error)
        showToast(t('Screenshot Error', { error }))
      } finally {
        canvas.remove()

        if ((!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') && wasPlaying) {
          video_.play()
        }
      }
    }

    // #endregion screenshots

    // #region custom player controls

    const { ContextMenu: shakaContextMenu, Controls: shakaControls, OverflowMenu: shakaOverflowMenu } = shaka.ui

    /**
     * Shaka's element registries are process-global, so a player that mounts
     * later overwrites this player's factories with ones bound to its own
     * component instance. Remember our registrations so they can be re-applied
     * before our own `ui.configure()` calls, which rebuild every control
     * element from the registries.
     * @type {[typeof shakaControls | typeof shakaOverflowMenu | typeof shakaContextMenu, string, shaka.extern.IUIElement.Factory][]}
     */
    const ownElementRegistrations = []

    /**
     * @param {typeof shakaControls | typeof shakaOverflowMenu | typeof shakaContextMenu} registry
     * @param {string} name
     * @param {shaka.extern.IUIElement.Factory} factory
     */
    function registerOwnElement(registry, name, factory) {
      ownElementRegistrations.push([registry, name, factory])
      registry.registerElement(name, factory)
    }

    function reRegisterOwnElements() {
      for (const [registry, name, factory] of ownElementRegistrations) {
        registry.registerElement(name, factory)
      }
    }

    function registerAudioTrackSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class AudioTrackSelectionFactory {
        create(rootElement, controls) {
          return new AudioTrackSelection(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_audio_tracks', new AudioTrackSelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_audio_tracks', new AudioTrackSelectionFactory())
    }

    function registerCaptionSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class CaptionSelectionFactory {
        create(rootElement, controls) {
          return new CaptionSelection(
            events,
            () => captionSettings.value,
            updateCaptionAppearance,
            resetCaptionAppearance,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'captions', new CaptionSelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'captions', new CaptionSelectionFactory())
    }

    function toggleCaptions() {
      const textTracks = player.getTextTracks()

      if (textTracks.length === 0) {
        return false
      }

      if (textTracks.some(track => track.active)) {
        player.selectTextTrack(null)
      } else {
        player.selectTextTrack(getTextTrackToEnable(textTracks))
      }

      showOverlayControls()
      return true
    }

    function registerCaptionToggleButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class CaptionToggleButtonFactory {
        create(rootElement, controls) {
          return new CaptionToggleButton(toggleCaptions, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_caption_toggle', new CaptionToggleButtonFactory())
    }

    function registerChapterOverlayButton() {
      events.addEventListener('setChaptersOverlay', (/** @type {CustomEvent} */ event) => {
        const shouldOpen = event.detail && props.chapters.length > 0

        showChaptersOverlay.value = shouldOpen

        if (shouldOpen) {
          ui?.getControls().hideSettingsMenus()
          nextTick(() => chapterOverlay.value?.focus({ preventScroll: true }))
        }
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class ChapterOverlayButtonFactory {
        create(rootElement, controls) {
          return new ChapterOverlayButton(
            currentChapterTitle,
            showChaptersOverlay.value,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'ft_chapters', new ChapterOverlayButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_chapters', new ChapterOverlayButtonFactory())
    }

    function setFullscreenComments(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.commentsAvailable &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenComments.value = open
      events.dispatchEvent(new CustomEvent('setFullscreenComments', { detail: open }))
      emit('fullscreen-comments-change', {
        open,
        target: fullscreenCommentsOverlay.value
      })
    }

    function closeFullscreenComments() {
      setFullscreenComments(false)
    }

    function setFullscreenPlaylist(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.watchingPlaylist &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenPlaylist.value = open
      emit('fullscreen-playlist-change', {
        open,
        target: fullscreenPlaylistTarget.value
      })
    }

    function closeFullscreenPlaylist() {
      setFullscreenPlaylist(false)
    }

    function restoreDockedPanels() {
      if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
        return
      }

      if (restoreChapters) {
        restoreChapters = false
        events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
          detail: props.chapters.length > 0
        }))
      }

      if (restoreFullscreenComments) {
        restoreFullscreenComments = false
        setFullscreenComments(true)
      }

      if (restoreFullscreenPlaylist) {
        restoreFullscreenPlaylist = false
        setFullscreenPlaylist(true)
      }
    }

    watch(() => props.commentsAvailable, available => {
      if (!available && showFullscreenComments.value) {
        closeFullscreenComments()
      }
    })

    watch(() => props.watchingPlaylist, watching => {
      if (!watching && showFullscreenPlaylist.value) {
        closeFullscreenPlaylist()
      }
    })

    watch(fullWindowEnabled, enabled => {
      if (!enabled && !isNativeFullscreenActive()) {
        closeFullscreenComments()
        closeFullscreenPlaylist()
      }
    })

    // Outside of fullscreen the chapters are shown in the watch page sidebar,
    // so the parent needs the open state and the storyboard-derived thumbnails.
    watch(showChaptersOverlay, (open) => {
      emit('chapters-overlay-change', open)
    })

    watch(chapterThumbnails, (thumbnails) => {
      emit('chapter-thumbnails-change', thumbnails)
    })

    async function loadChapterThumbnails() {
      chapterThumbnails.value = []

      const activePlayer = player
      const videoId = props.videoId

      if (!activePlayer || activePlayer.getImageTracks().length === 0) {
        return
      }

      const imageDimensions = new Map()
      const thumbnails = await Promise.all(props.chapters.map(async chapter => {
        if (chapter.thumbnail?.url) {
          return null
        }

        try {
          const thumbnail = await activePlayer.getThumbnails(null, chapter.startSeconds)
          const uri = thumbnail?.uris[0]

          if (!thumbnail || !uri || thumbnail.codecs === 'mjpg' || uri.startsWith('offline:')) {
            return null
          }

          const result = {
            url: uri.split('#xywh=')[0],
            width: thumbnail.width,
            height: thumbnail.height,
            imageWidth: thumbnail.imageWidth,
            imageHeight: thumbnail.imageHeight,
            positionX: thumbnail.positionX,
            positionY: thumbnail.positionY,
            sprite: thumbnail.sprite ||
              thumbnail.imageWidth > thumbnail.width ||
              thumbnail.imageHeight > thumbnail.height
          }

          if (result.sprite && (!result.imageWidth || !result.imageHeight)) {
            if (!imageDimensions.has(result.url)) {
              imageDimensions.set(result.url, loadImageDimensions(result.url))
            }

            const dimensions = await imageDimensions.get(result.url)

            if (!dimensions) {
              return null
            }

            result.imageWidth = dimensions.width
            result.imageHeight = dimensions.height
          }

          return result
        } catch {
          return null
        }
      }))

      if (player === activePlayer && props.videoId === videoId) {
        chapterThumbnails.value = thumbnails
      }
    }

    /**
     * @param {string} url
     * @returns {Promise<{ width: number, height: number } | null>}
     */
    function loadImageDimensions(url) {
      return new Promise(resolve => {
        const image = new Image()

        image.addEventListener('load', () => {
          resolve({ width: image.naturalWidth, height: image.naturalHeight })
        }, { once: true })
        image.addEventListener('error', () => resolve(null), { once: true })
        image.src = url
      })
    }

    function registerAutoplayToggle() {
      events.addEventListener('toggleAutoplay', () => {
        emit('toggle-autoplay')
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class AutoplayToggleFactory {
        create(rootElement, controls) {
          return new AutoplayToggle(props.autoplayEnabled, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_autoplay_toggle', new AutoplayToggleFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_autoplay_toggle', new AutoplayToggleFactory())
    }

    function registerTheatreModeButton() {
      events.addEventListener('toggleTheatreMode', () => {
        emit('toggle-theatre-mode')
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class TheatreModeButtonFactory {
        create(rootElement, controls) {
          return new TheatreModeButton(props.useTheatreMode, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_theatre_mode', new TheatreModeButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_theatre_mode', new TheatreModeButtonFactory())
    }

    function registerFullWindowButton() {
      events.addEventListener('setFullWindow', async (/** @type {CustomEvent} */ event) => {
        fullWindowAnimation?.cancel()
        fullWindowAnimation = null
        suppressPanelTransitions(FULL_WINDOW_ANIMATION_DURATION_MS + 50)

        const playerContainer = container.value
        const shouldAnimate = playerContainer !== null && !isReducedMotionEnabled()
        const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null

        if (event.detail) {
          fullWindowPlaceholderHeight.value = playerContainer.getBoundingClientRect().height
        }

        fullWindowEnabled.value = event.detail

        if (fullWindowEnabled.value) {
          restoreDockedPanels()
        }

        if (fullWindowEnabled.value) {
          document.body.dataset.playerFullWindowOwner = mediaTabId
          document.body.classList.add('playerFullWindow')
        } else if (document.body.dataset.playerFullWindowOwner === mediaTabId) {
          delete document.body.dataset.playerFullWindowOwner
          document.body.classList.remove('playerFullWindow')
        }

        if (previousRect === null) {
          return
        }

        await nextTick()
        const nextRect = playerContainer.getBoundingClientRect()
        const animation = playerContainer.animate([
          {
            transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px) scale(${previousRect.width / nextRect.width}, ${previousRect.height / nextRect.height})`,
            transformOrigin: 'top left'
          },
          {
            transform: 'none',
            transformOrigin: 'top left'
          }
        ], {
          duration: FULL_WINDOW_ANIMATION_DURATION_MS,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
        })

        fullWindowAnimation = animation
        animation.addEventListener('finish', () => {
          if (fullWindowAnimation === animation) {
            fullWindowAnimation = null
          }
        })
      })

      fullWindowListenerReady = true
      applyPendingPresentationModes()

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class FullWindowButtonFactory {
        create(rootElement, controls) {
          return new FullWindowButton(fullWindowEnabled.value, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_full_window', new FullWindowButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_full_window', new FullWindowButtonFactory())
    }

    function registerLegacyQualitySelection() {
      events.addEventListener('setLegacyFormat', async (/** @type {CustomEvent} */ event) => {
        const {
          format,
          playbackPosition,
          playbackRate = pendingPlaybackRateRestore ?? getCurrentPlaybackRate(),
          restoreCaptionIndex: restoreCaptionIndex_ = null,
          userSelected = false
        } = event.detail

        queuePlaybackRateRestore(playbackRate)

        if (restoreCaptionIndex_ !== null) {
          restoreCaptionIndex = restoreCaptionIndex_
        }

        activeLegacyFormat.value = event.detail.format
        const quality = getQualityFromDimensions(format.width, format.height)

        if (quality !== null) {
          emit('video-quality-updated', quality)
        }

        if (userSelected && quality !== null) {
          emit('video-quality-user-set', quality)
        }

        try {
          await player.load(format.url, playbackPosition, format.mimeType)
        } catch (error) {
          handleError(error, 'setLegacyFormat', event.detail)
        }
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class LegacyQualitySelectionFactory {
        create(rootElement, controls) {
          return new LegacyQualitySelection(
            () => activeLegacyFormat.value,
            props.legacyFormats,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'ft_legacy_quality', new LegacyQualitySelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_legacy_quality', new LegacyQualitySelectionFactory())
    }

    function registerStatsButton() {
      events.addEventListener('setStatsVisibility', (/** @type {CustomEvent} */ event) => {
        showStats.value = event.detail

        if (showStats.value) {
          gatherInitialStatsValues()
        }
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class StatsButtonFactory {
        create(rootElement, controls) {
          return new StatsButton(showStats.value, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaContextMenu, 'ft_stats', new StatsButtonFactory())
    }

    function registerAmbientModeButton() {
      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class AmbientModeButtonFactory {
        create(rootElement, controls) {
          return new AmbientModeButton(
            ambientMode,
            updateAmbientMode,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_ambient_mode', new AmbientModeButtonFactory())
    }

    function registerSkipSilenceButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class SkipSilenceButtonFactory {
        create(rootElement, controls) {
          return new SkipSilenceButton(
            skipSilence,
            updateSkipSilence,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_skip_silence', new SkipSilenceButtonFactory())
    }

    function registerSleepTimer() {
      events.addEventListener('setSleepTimerDuration', (/** @type {CustomEvent} */ event) => {
        sleepTimer.startDuration(event.detail)
      })
      events.addEventListener('setSleepTimerEndOfVideo', () => {
        sleepTimer.startEndOfVideo()
      })
      events.addEventListener('cancelSleepTimer', () => {
        sleepTimer.cancel()
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class SleepTimerFactory {
        create(rootElement, controls) {
          return new SleepTimer(sleepTimer, !isLive.value, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_sleep_timer', new SleepTimerFactory())
    }

    /** @type {(() => void) | null} */
    let removeCopyVideoUrlContext = null

    /** @type {(() => void) | null} */
    let removeQuickPlaybackRateBarContext = null

    function registerContextMenuButtons() {
      /**
       * @returns {number}
       */
      function getCurrentTimestamp() {
        const currentTime = Math.floor(video.value?.currentTime ?? 0)
        return Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @param {boolean} includeTimestamp
       * @returns {string}
       */
      function getVideoUrl(backend, includeTimestamp) {
        const videoUrl = backend === 'invidious'
          ? getInvidiousVideoUrl(store.getters.getCurrentInvidiousInstanceUrl, props.videoId, shareablePlaylistId.value)
          : getYoutubeVideoShareUrl(props.videoId, shareablePlaylistId.value)

        if (!includeTimestamp) {
          return videoUrl
        }

        return appendTimestamp(videoUrl, getCurrentTimestamp())
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @param {boolean} includeTimestamp
       * @returns {string}
       */
      function getCopySuccessMessage(backend, includeTimestamp) {
        if (includeTimestamp) {
          return t('Share.Timestamp Link Copied')
        }

        return backend === 'invidious'
          ? t('Share.Invidious URL copied to clipboard')
          : t('Share.YouTube URL copied to clipboard')
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @param {boolean} includeTimestamp
       * @returns {string}
       */
      function getCopyLabel(backend, includeTimestamp) {
        const baseLabel = backend === 'invidious'
          ? t('Video.Copy Invidious Link')
          : t('Video.Copy YouTube Link')

        if (!includeTimestamp) {
          return baseLabel
        }

        return `${baseLabel} (${t('Share.Include Timestamp')})`
      }

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class CopyVideoUrlButtonFactory {
        /**
         * @param {'youtube' | 'invidious'} backend
         * @param {boolean} includeTimestamp
         */
        constructor(backend, includeTimestamp) {
          this.backend = backend
          this.includeTimestamp = includeTimestamp
        }

        create(rootElement, controls) {
          return new CopyVideoUrlButton(
            this.backend,
            this.includeTimestamp,
            rootElement,
            controls
          )
        }
      }

      // The button factory is registered on shaka's renderer-global element
      // registry, so it can't close over this instance's state. Expose this
      // instance's URL/label resolvers keyed by its own `Controls` object, which
      // the button resolves at click time (see CopyVideoUrlButton).
      const controls = ui?.getControls()
      if (controls) {
        removeCopyVideoUrlContext?.()
        removeCopyVideoUrlContext = setCopyVideoUrlContext(controls, {
          getVideoUrl,
          getLabel: getCopyLabel,
          getSuccessMessage: getCopySuccessMessage
        })
      }

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class LoopButtonFactory {
        create(rootElement, controls) {
          return new LoopButton(rootElement, controls)
        }
      }

      registerOwnElement(shakaContextMenu, 'ft_copy_youtube_video_url', new CopyVideoUrlButtonFactory('youtube', false))
      registerOwnElement(shakaContextMenu, 'ft_copy_youtube_video_url_at_current_time', new CopyVideoUrlButtonFactory('youtube', true))
      registerOwnElement(shakaContextMenu, 'ft_copy_invidious_video_url', new CopyVideoUrlButtonFactory('invidious', false))
      registerOwnElement(shakaContextMenu, 'ft_copy_invidious_video_url_at_current_time', new CopyVideoUrlButtonFactory('invidious', true))
      registerOwnElement(shakaContextMenu, 'ft_loop', new LoopButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_loop', new LoopButtonFactory())
    }

    function registerScreenshotButton() {
      events.addEventListener('takeScreenshot', () => {
        takeScreenshot()
      })

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class ScreenshotButtonFactory {
        create(rootElement, controls) {
          return new ScreenshotButton(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_screenshot', new ScreenshotButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_screenshot', new ScreenshotButtonFactory())
    }

    function registerSponsorBlockSubmissionButtons() {
      events.addEventListener('startSponsorBlockSegment', () => {
        startSponsorBlockDraft()
      })
      events.addEventListener('endSponsorBlockSegment', () => {
        endSponsorBlockDraft()
      })
      events.addEventListener('toggleSponsorBlockSubmissionMenu', () => {
        if (sponsorBlockSubmissionMenuOpen.value) {
          closeSponsorBlockSubmissionMenu()
        } else {
          openSponsorBlockSubmissionMenu()
        }
      })
      events.addEventListener('cancelSponsorBlockSegment', () => {
        cancelCurrentSponsorBlockDraft()
      })
      events.addEventListener('clearSponsorBlockSegments', () => {
        clearSponsorBlockDrafts()
      })

      class SponsorBlockStartButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockStartButton(events, rootElement, controls)
        }
      }

      class SponsorBlockEndButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockEndButton(events, rootElement, controls)
        }
      }

      class SponsorBlockOpenMenuButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockOpenMenuButton(events, rootElement, controls)
        }
      }

      class SponsorBlockCancelButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockCancelButton(events, rootElement, controls)
        }
      }

      class SponsorBlockClearButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockClearButton(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_sponsorblock_start', new SponsorBlockStartButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_end', new SponsorBlockEndButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_open_menu', new SponsorBlockOpenMenuButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_cancel', new SponsorBlockCancelButtonFactory())
      registerOwnElement(shakaControls, 'ft_sponsorblock_clear', new SponsorBlockClearButtonFactory())

      updateSponsorBlockSubmissionState()
    }

    function registerSponsorBlockHighlightButton() {
      events.addEventListener('skipToSponsorBlockHighlight', () => {
        skipToSponsorBlockHighlight()
      })

      class SponsorBlockHighlightButtonFactory {
        create(rootElement, controls) {
          return new SponsorBlockHighlightButton(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_sponsorblock_highlight', new SponsorBlockHighlightButtonFactory())
      updateSponsorBlockHighlightState()
    }

    function registerSkipButtons() {
      // skip to next video button
      events.addEventListener('nextVideo', () => {
        emit('skip-to-next')
      })

      class SkipNextButtonFactory {
        create(rootElement, controls) {
          return new SkipButton(events, rootElement, controls, 'next')
        }
      }

      registerOwnElement(shakaControls, 'ft_skip_next', new SkipNextButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_skip_next', new SkipNextButtonFactory())

      // skip to previous video button
      events.addEventListener('previousVideo', () => {
        emit('skip-to-prev')
      })

      class SkipPreviousButtonFactory {
        create(rootElement, controls) {
          return new SkipButton(events, rootElement, controls, 'previous')
        }
      }

      registerOwnElement(shakaControls, 'ft_skip_previous', new SkipPreviousButtonFactory())
      registerOwnElement(shakaOverflowMenu, 'ft_skip_previous', new SkipPreviousButtonFactory())
    }

    function registerPlaybackAdjustedTime() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class PlaybackAdjustedTimeFactory {
        create(rootElement, controls) {
          return new FtPlaybackAdjustedTime(
            () => showPlaybackRateAdjustedTimestamp.value,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'ft_playback_adjusted_time', new PlaybackAdjustedTimeFactory())
    }

    function registerQuickPlaybackRateBar() {
      events.addEventListener('quickPlaybackRateUserSet', (/** @type {CustomEvent} */ event) => {
        const playbackRate = normalizePlaybackRate(event.detail)

        if (playbackRate === null) {
          return
        }

        playbackRateUserSet = true
        queuePlaybackRateRestore(playbackRate)
        emit('playback-rate-updated', playbackRate)
        emit('playback-rate-user-set', playbackRate)
      })

      events.addEventListener('saveChannelPlaybackSpeed', () => {
        emit('save-channel-playback-speed')
      })

      const controls = ui?.getControls()
      if (controls) {
        removeQuickPlaybackRateBarContext?.()
        removeQuickPlaybackRateBarContext = setQuickPlaybackRateBarContext(controls, {
          getPlaybackRateOptions: () => quickPlaybackSpeedBarOptions.value,
          getSavedChannelPlaybackRate: () => savedChannelPlaybackRate.value,
          getCanSaveChannelPlaybackSpeed: () => canManuallySaveChannelPlaybackRate.value,
          events
        })
      }

      /** @implements {shaka.extern.IUIElement.Factory} */
      class QuickPlaybackRateBarFactory {
        create(rootElement, controls) {
          return new QuickPlaybackRateBar(rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'ft_quick_playback_rate_bar', new QuickPlaybackRateBarFactory())
    }

    /**
     * As shaka-player doesn't let you unregister custom control factories,
     * overwrite them with `null` instead so the referenced objects
     * (e.g. {@linkcode events}, {@linkcode fullWindowEnabled}) can get garbage collected
     */
    function cleanUpCustomPlayerControls() {
      removeCopyVideoUrlContext?.()
      removeCopyVideoUrlContext = null

      removeQuickPlaybackRateBarContext?.()
      removeQuickPlaybackRateBarContext = null

      if (!registeredCustomControls) {
        return
      }
      registeredCustomControls = false
      liveCustomControlPlayers--

      // Shaka's element registries are process-global and shared across every
      // live player. Resetting the custom factories (to shaka defaults / null)
      // while another player is still mounted would make that player's next
      // ui.configure() build its control panel against a null factory and throw
      // — Shaka's control-panel loop only guards `registry.has(name)`, not a
      // null value — which takes down the whole tab. Only reset once this was
      // the last player relying on the shared registry.
      if (liveCustomControlPlayers > 0) {
        return
      }

      class DefaultCaptionSelectionFactory {
        create(rootElement, controls) {
          return new shaka.ui.TextSelection(rootElement, controls)
        }
      }

      const defaultCaptionSelectionFactory = new DefaultCaptionSelectionFactory()
      shakaControls.registerElement('captions', defaultCaptionSelectionFactory)
      shakaOverflowMenu.registerElement('captions', defaultCaptionSelectionFactory)

      shakaControls.registerElement('ft_audio_tracks', null)
      shakaOverflowMenu.registerElement('ft_audio_tracks', null)

      shakaControls.registerElement('ft_caption_toggle', null)

      shakaControls.registerElement('ft_autoplay_toggle', null)
      shakaOverflowMenu.registerElement('ft_autoplay_toggle', null)

      shakaControls.registerElement('ft_theatre_mode', null)
      shakaOverflowMenu.registerElement('ft_theatre_mode', null)

      shakaControls.registerElement('ft_full_window', null)
      shakaOverflowMenu.registerElement('ft_full_window', null)

      shakaControls.registerElement('ft_legacy_quality', null)
      shakaOverflowMenu.registerElement('ft_legacy_quality', null)

      shakaContextMenu.registerElement('ft_copy_youtube_video_url', null)
      shakaContextMenu.registerElement('ft_copy_youtube_video_url_at_current_time', null)
      shakaContextMenu.registerElement('ft_copy_invidious_video_url', null)
      shakaContextMenu.registerElement('ft_copy_invidious_video_url_at_current_time', null)
      shakaContextMenu.registerElement('ft_loop', null)
      shakaContextMenu.registerElement('ft_stats', null)
      shakaOverflowMenu.registerElement('ft_ambient_mode', null)
      shakaOverflowMenu.registerElement('ft_skip_silence', null)
      shakaOverflowMenu.registerElement('ft_sleep_timer', null)
      shakaOverflowMenu.registerElement('ft_loop', null)

      shakaControls.registerElement('ft_screenshot', null)
      shakaOverflowMenu.registerElement('ft_screenshot', null)

      shakaControls.registerElement('ft_sponsorblock_start', null)
      shakaControls.registerElement('ft_sponsorblock_end', null)
      shakaControls.registerElement('ft_sponsorblock_open_menu', null)
      shakaControls.registerElement('ft_sponsorblock_cancel', null)
      shakaControls.registerElement('ft_sponsorblock_clear', null)
      shakaControls.registerElement('ft_sponsorblock_highlight', null)

      shakaControls.registerElement('ft_next_previous', null)
      shakaOverflowMenu.registerElement('ft_next_previous', null)

      shakaControls.registerElement('ft_skip_previous', null)
      shakaOverflowMenu.registerElement('ft_skip_previous', null)

      shakaControls.registerElement('ft_playback_adjusted_time', null)
      shakaControls.registerElement('ft_quick_playback_rate_bar', null)
    }

    // #endregion custom player controls

    // #region mouse and keyboard helpers

    /**
     * @param {number} step
     */
    function changeVolume(step) {
      const volumeBar = container.value.querySelector('.shaka-volume-bar')

      const oldValue = parseFloat(volumeBar.value)
      const newValue = oldValue + (step * 100)

      if (newValue < 0) {
        volumeBar.value = 0
      } else if (newValue > 100) {
        volumeBar.value = 100
      } else {
        volumeBar.value = newValue
      }

      volumeBar.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))

      let messageIcon
      if (newValue <= 0) {
        messageIcon = 'volume-mute'
      } else if (newValue > 0 && newValue < oldValue) {
        messageIcon = 'volume-low'
      } else if (newValue > 0 && newValue > oldValue) {
        messageIcon = 'volume-high'
      }
      showValueChange(`${Math.round(video.value.volume * 100)}%`, messageIcon)
    }

    /** @type {number | null} */
    let togglePlaybackRate = null

    /** @type {number | null} */
    let pendingPlaybackRateRestore = null

    let playbackRateUserSet = normalizePlaybackRate(props.sabrReloadPlaybackRate) !== null
    let musicPlaybackRateToastShown = false
    let pendingMusicPlaybackRateToast = false

    /** @type {Map<string, number>} */
    const temporaryPlaybackRateHoldTimeouts = new Map()
    const temporaryPlaybackRateSources = new Set()
    /** @type {number | null} */
    let playbackRateBeforeTemporaryPlayback = null
    let wasPausedBeforeTemporaryPlayback = false
    let temporaryPlaybackRateActive = false

    /**
     * @param {unknown} rate
     * @returns {number | null}
     */
    function normalizePlaybackRate(rate) {
      const parsedRate = typeof rate === 'number' ? rate : Number(rate)
      return Number.isFinite(parsedRate) && parsedRate > 0.07 ? parsedRate : null
    }

    const isMusicVideoDetected = computed(() => {
      return props.videoGenreIsMusic || hasSponsorBlockMusicOfftopicSegment.value
    })

    const shouldUseNormalPlaybackRateByDefault = computed(() => isLive.value || isMusicVideoDetected.value)

    /**
     * @param {number} fallbackPlaybackRate
     * @returns {number}
     */
    function getDefaultPlaybackRateForVideo(fallbackPlaybackRate = defaultPlaybackRate.value) {
      return shouldUseNormalPlaybackRateByDefault.value ? NORMAL_PLAYBACK_RATE : fallbackPlaybackRate
    }

    /**
     * @returns {number}
     */
    function getInitialPlaybackRate() {
      const sabrReloadPlaybackRate = normalizePlaybackRate(props.sabrReloadPlaybackRate)
      if (sabrReloadPlaybackRate !== null) {
        return sabrReloadPlaybackRate
      }

      if (shouldUseNormalPlaybackRateByDefault.value) {
        return NORMAL_PLAYBACK_RATE
      }

      return normalizePlaybackRate(props.currentPlaybackRate) ?? NORMAL_PLAYBACK_RATE
    }

    /**
     * @returns {number}
     */
    function getUnforcedPlaybackRate() {
      if (savedChannelPlaybackRate.value !== null) {
        return savedChannelPlaybackRate.value
      }

      const currentPlaybackRate = normalizePlaybackRate(props.currentPlaybackRate)
      if (currentPlaybackRate !== null && Math.abs(currentPlaybackRate - NORMAL_PLAYBACK_RATE) >= 0.01) {
        return currentPlaybackRate
      }

      return defaultPlaybackRate.value
    }

    /**
     * @param {number|null} unforcedPlaybackRate
     */
    function showMusicPlaybackRateToast(unforcedPlaybackRate) {
      if (
        musicPlaybackRateToastShown ||
        playbackRateUserSet ||
        !isMusicVideoDetected.value ||
        unforcedPlaybackRate === null ||
        Math.abs(unforcedPlaybackRate - NORMAL_PLAYBACK_RATE) < 0.01
      ) {
        return
      }

      // Defer the toast until the video is actually played in this tab, so it
      // doesn't pop up in whatever tab happened to be open when the video loaded.
      pendingMusicPlaybackRateToast = true
    }

    function flushPendingMusicPlaybackRateToast() {
      if (!pendingMusicPlaybackRateToast || musicPlaybackRateToastShown || playbackRateUserSet) {
        return
      }

      pendingMusicPlaybackRateToast = false
      showToast(t('Video.Player.MusicPlaybackRateOverride'))
      musicPlaybackRateToastShown = true
    }

    /**
     * @returns {number | null}
     */
    function getCurrentPlaybackRate() {
      if (temporaryPlaybackRateActive && playbackRateBeforeTemporaryPlayback !== null) {
        return playbackRateBeforeTemporaryPlayback
      }

      const playerRate = normalizePlaybackRate(player?.getPlaybackRate())
      if (playerRate !== null) {
        return silenceSkipping.getNormalPlaybackRate(playerRate)
      }

      const videoRate = normalizePlaybackRate(video.value?.playbackRate)
      if (videoRate !== null) {
        return silenceSkipping.getNormalPlaybackRate(videoRate)
      }

      return normalizePlaybackRate(props.currentPlaybackRate)
    }

    /**
     * @param {number|null|undefined} rate
     */
    function queuePlaybackRateRestore(rate = getCurrentPlaybackRate()) {
      pendingPlaybackRateRestore = normalizePlaybackRate(rate)
    }

    function restorePendingPlaybackRate() {
      const playbackRate = pendingPlaybackRateRestore ?? getInitialPlaybackRate()
      pendingPlaybackRateRestore = null

      if (playbackRate === null || !video.value || !player) {
        return
      }

      video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo()

      try {
        if (Math.abs(playbackRate - video.value.defaultPlaybackRate) < 0.01) {
          player.cancelTrickPlay()
        } else {
          player.trickPlay(playbackRate, false)
        }
      } catch (error) {
        console.error('Failed to restore playback rate:', error)
      }
    }

    /**
     * @param {string} source
     */
    function activateTemporaryPlaybackRate(source) {
      if (!player || !video.value || !hasLoaded.value) {
        return
      }

      temporaryPlaybackRateSources.add(source)

      if (temporaryPlaybackRateActive) {
        return
      }

      silenceSkipping.suspend()
      const playbackRate = getCurrentPlaybackRate()
      if (playbackRate === null) {
        temporaryPlaybackRateSources.delete(source)
        silenceSkipping.resume()
        return
      }

      playbackRateBeforeTemporaryPlayback = playbackRate
      wasPausedBeforeTemporaryPlayback = video.value.paused
      temporaryPlaybackRateActive = true

      try {
        const temporaryPlaybackRate = playbackRate * TEMPORARY_PLAYBACK_RATE_MULTIPLIER
        player.trickPlay(temporaryPlaybackRate, false)
        temporaryPlaybackRateIndicatorMessage.value = `${Number.parseFloat(temporaryPlaybackRate.toFixed(2))}x`
        showTemporaryPlaybackRateIndicator.value = true
        showOverlayControls()
        if (wasPausedBeforeTemporaryPlayback) {
          video.value.play()
        }
      } catch (error) {
        temporaryPlaybackRateSources.delete(source)
        playbackRateBeforeTemporaryPlayback = null
        wasPausedBeforeTemporaryPlayback = false
        temporaryPlaybackRateActive = false
        showTemporaryPlaybackRateIndicator.value = false
        silenceSkipping.resume()
        console.error('Failed to apply temporary playback rate:', error)
      }
    }

    /**
     * @param {string} source
     */
    function startTemporaryPlaybackRateHold(source) {
      if (
        !player ||
        !video.value ||
        !hasLoaded.value ||
        !holdToDoublePlaybackSpeed.value ||
        temporaryPlaybackRateHoldTimeouts.has(source) ||
        temporaryPlaybackRateSources.has(source)
      ) {
        return
      }

      const timeoutId = setTimeout(() => {
        temporaryPlaybackRateHoldTimeouts.delete(source)
        activateTemporaryPlaybackRate(source)
      }, TEMPORARY_PLAYBACK_RATE_HOLD_DELAY_MS)

      temporaryPlaybackRateHoldTimeouts.set(source, timeoutId)
    }

    function restoreTemporaryPlaybackRate() {
      if (!temporaryPlaybackRateActive) {
        return
      }

      const playbackRate = playbackRateBeforeTemporaryPlayback

      try {
        if (playbackRate !== null) {
          if (Math.abs(playbackRate - getDefaultPlaybackRateForVideo()) < 0.01) {
            player?.cancelTrickPlay()
          } else {
            player?.trickPlay(playbackRate, false)
          }
        }

        if (wasPausedBeforeTemporaryPlayback) {
          video.value?.pause()
        }
      } catch (error) {
        console.error('Failed to restore playback after temporary playback rate:', error)
      } finally {
        playbackRateBeforeTemporaryPlayback = null
        wasPausedBeforeTemporaryPlayback = false
        temporaryPlaybackRateActive = false
        showTemporaryPlaybackRateIndicator.value = false
        silenceSkipping.resume()
      }
    }

    /**
     * @param {string} source
     */
    function finishTemporaryPlaybackRateHold(source) {
      const timeoutId = temporaryPlaybackRateHoldTimeouts.get(source)
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        temporaryPlaybackRateHoldTimeouts.delete(source)
      }

      temporaryPlaybackRateSources.delete(source)
      if (temporaryPlaybackRateSources.size === 0) {
        restoreTemporaryPlaybackRate()
      }
    }

    function cancelTemporaryPlaybackRateHolds() {
      temporaryPlaybackRateHoldTimeouts.forEach(timeoutId => clearTimeout(timeoutId))
      temporaryPlaybackRateHoldTimeouts.clear()
      temporaryPlaybackRateSources.clear()
      restoreTemporaryPlaybackRate()
    }

    watch(
      () => props.currentPlaybackRate,
      (playbackRate) => {
        if (hasLoaded.value) {
          return
        }

        if (normalizePlaybackRate(playbackRate) === null) {
          return
        }

        queuePlaybackRateRestore(getInitialPlaybackRate())

        if (video.value) {
          video.value.playbackRate = getInitialPlaybackRate()
        }
      }
    )

    watch(shouldUseNormalPlaybackRateByDefault, (shouldUseNormalPlaybackRate) => {
      const unforcedPlaybackRate = getCurrentPlaybackRate()

      if (video.value) {
        video.value.defaultPlaybackRate = getDefaultPlaybackRateForVideo()
      }

      if (!shouldUseNormalPlaybackRate || playbackRateUserSet) {
        return
      }

      queuePlaybackRateRestore(NORMAL_PLAYBACK_RATE)
      showMusicPlaybackRateToast(unforcedPlaybackRate)

      if (!hasLoaded.value || !player || !video.value) {
        if (video.value) {
          video.value.playbackRate = NORMAL_PLAYBACK_RATE
        }
        return
      }

      try {
        player.cancelTrickPlay()
      } catch (error) {
        console.error('Failed to apply normal playback rate default:', error)
      }
    })

    /**
     * @param {number} rate
     */
    function applyPlaybackRate(rate) {
      const newPlaybackRateString = rate.toFixed(2)
      const newPlaybackRate = parseFloat(newPlaybackRateString)

      // The following error is thrown if you go below 0.07:
      // The provided playback rate (0.05) is not in the supported playback range.
      if (newPlaybackRate > 0.07 && newPlaybackRate <= maxVideoPlaybackRate.value) {
        playbackRateUserSet = true

        if (Math.abs(newPlaybackRate - getDefaultPlaybackRateForVideo()) < 0.01) {
          player.cancelTrickPlay()
        } else {
          player.trickPlay(newPlaybackRate, false)
        }

        showValueChange(`${newPlaybackRateString}x`)
      }
    }

    /**
     * @param {number} step
     */
    function changePlayBackRate(step) {
      applyPlaybackRate(getCurrentPlaybackRate() + step)
    }

    /**
     * @param {number} rate
     */
    function isNormalPlaybackRate(rate) {
      return Math.abs(rate - NORMAL_PLAYBACK_RATE) < 0.01
    }

    function toggleNormalPlaybackRate() {
      const currentRate = getCurrentPlaybackRate()

      if (!isNormalPlaybackRate(currentRate)) {
        togglePlaybackRate = currentRate
        applyPlaybackRate(NORMAL_PLAYBACK_RATE)
      } else if (togglePlaybackRate != null) {
        applyPlaybackRate(togglePlaybackRate)
      }
    }

    function canSeek() {
      if (!player || !hasLoaded.value) {
        return false
      }

      const seekRange = player.seekRange()

      // Seeking not possible e.g. with HLS
      if (seekRange.start === seekRange.end || !seekingIsPossible.value) {
        return false
      }

      return true
    }

    /**
     * @param {number} seconds The number of seconds to seek by, positive values seek forwards, negative ones seek backwards
     * @param {boolean} canSeekResult Allow functions that have already checked whether seeking is possible, to skip the extra check (e.g. frameByFrame)
     * @param {boolean} showPopUp Whether to show a pop-up with the seconds seeked
     */
    function seekBySeconds(seconds, canSeekResult = false, showPopUp = false) {
      if (!(canSeekResult || canSeek())) {
        return
      }

      const seekRange = player.seekRange()

      const video_ = video.value

      const currentTime = video_.currentTime
      const newTime = currentTime + seconds

      if (newTime < seekRange.start) {
        video_.currentTime = seekRange.start
      } else if (newTime > seekRange.end) {
        if (isLive.value) {
          player.goToLive()
        } else {
          video_.currentTime = seekRange.end
        }
      } else {
        video_.currentTime = newTime
      }
      if (showPopUp) {
        const popUpLayout = seconds > 0
          ? { icon: 'arrow-right', invertContentOrder: true }
          : { icon: 'arrow-left', invertContentOrder: false }
        // `+value` converts string back to float
        const formattedSeconds = +Math.abs(seconds).toFixed(2)
        showValueChange(`${formattedSeconds}s`, popUpLayout.icon, popUpLayout.invertContentOrder)
      }

      showOverlayControls()
    }

    // #endregion mouse and keyboard helpers

    // #region mouse scroll handlers

    const mouseScrollThrottleWaitMs = 200

    /**
     * @param {WheelEvent} event
     */
    function mouseScrollPlaybackRate(event) {
      if ((event.deltaY < 0 || event.deltaX > 0)) {
        changePlayBackRate(0.05)
      } else if ((event.deltaY > 0 || event.deltaX < 0)) {
        changePlayBackRate(-0.05)
      }
    }
    const mouseScrollPlaybackRateThrottle = throttle(mouseScrollPlaybackRate, mouseScrollThrottleWaitMs)
    /**
     * @param {WheelEvent} event
     */
    function mouseScrollPlaybackRateHandler(event) {
      event.preventDefault()

      // Touchpad scroll = small deltaX/deltaY
      if (Math.abs(event.deltaX) <= 5 && Math.abs(event.deltaY) <= 5) {
        mouseScrollPlaybackRateThrottle(event)
      } else {
        mouseScrollPlaybackRate(event)
      }
    }

    /**
     * @param {WheelEvent} event
     */
    function mouseScrollSkip(event) {
      const seekMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
      if ((event.deltaY < 0 || event.deltaX > 0)) {
        seekBySeconds(defaultSkipInterval.value * seekMultiplier, true)
      } else if ((event.deltaY > 0 || event.deltaX < 0)) {
        seekBySeconds(-defaultSkipInterval.value * seekMultiplier, true)
      }
    }
    const mouseScrollSkipThrottle = throttle(mouseScrollSkip, mouseScrollThrottleWaitMs)
    /**
     * @param {WheelEvent} event
     */
    function mouseScrollSkipHandler(event) {
      if (canSeek()) {
        event.preventDefault()

        // Touchpad scroll = small deltaX/deltaY
        if (Math.abs(event.deltaX) <= 5 && Math.abs(event.deltaY) <= 5) {
          mouseScrollSkipThrottle(event)
        } else {
          mouseScrollSkip(event)
        }
      }
    }

    /**
     * @param {WheelEvent} event
     */
    function mouseScrollVolume(event) {
      const video_ = video.value

      if (video_.muted && (event.deltaY < 0 || event.deltaX > 0)) {
        video_.muted = false
        video_.volume = 0
      }

      if (!video_.muted) {
        if ((event.deltaY < 0 || event.deltaX > 0)) {
          changeVolume(0.05)
        } else if ((event.deltaY > 0 || event.deltaX < 0)) {
          changeVolume(-0.05)
        }
      }
    }
    const mouseScrollVolumeThrottle = throttle(mouseScrollVolume, mouseScrollThrottleWaitMs)
    /**
     * @param {WheelEvent} event
     */
    function mouseScrollVolumeHandler(event) {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        event.stopPropagation()

        // Touchpad scroll = small deltaX/deltaY
        if (Math.abs(event.deltaX) <= 5 && Math.abs(event.deltaY) <= 5) {
          mouseScrollVolumeThrottle(event)
        } else {
          mouseScrollVolume(event)
        }
      }
    }

    // #endregion mouse scroll handlers

    // #region keyboard shortcuts

    /**
     * @param {number} step
     */
    function frameByFrame(step) {
      if (props.format === 'audio' || !canSeek()) {
        return
      }

      video.value.pause()

      /** @type {number} */
      let fps
      if (props.format === 'legacy') {
        fps = activeLegacyFormat.value.fps
      } else {
        fps = player.getVariantTracks().find(track => track.active).frameRate
      }

      const frameTime = 1 / fps
      const dist = frameTime * step
      seekBySeconds(dist, true)
    }

    // Blur player buttons to remove :focus-visible state, preventing tooltips from staying visible
    const buttonWithTooltipClasses = [
      'shaka-play-button',
      'shaka-fullscreen-button',
      'shaka-mute-button',
      'shaka-pip-button',
      'full-window-button',
      'theatre-button',
      'screenshot-button',
    ]
    function blurTooltipButtons() {
      const element = document.activeElement
      if (buttonWithTooltipClasses.some(className => element.classList.contains(className))) {
        element.blur()
      }
    }

    /**
     * @param {EventTarget | null} target
     */
    function isEditableTarget(target) {
      if (!(target instanceof HTMLElement)) {
        return false
      }

      if (target.closest('.scrollMiniPlayerControls')) {
        return false
      }

      return target.classList.contains('ft-input') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    function isSpaceKey(event) {
      return event.key === ' ' || event.key.toLowerCase() === 'spacebar'
    }

    /**
     * @param {KeyboardEvent} event
     */
    function keyboardShortcutKeyupHandler(event) {
      if (!isActiveTab.value || !isSpaceKey(event)) {
        return
      }

      const wasPending = temporaryPlaybackRateHoldTimeouts.has(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)
      const wasActive = temporaryPlaybackRateSources.has(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)

      if (!wasPending && !wasActive) {
        return
      }

      event.preventDefault()
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)

      if (wasPending && !wasActive && player && hasLoaded.value && video.value) {
        video.value.paused ? video.value.play() : video.value.pause()
        blurTooltipButtons()
      }
    }

    function handleTemporaryPlaybackRateFocusLoss() {
      cancelTemporaryPlaybackRateHolds()
      temporaryPlaybackRatePointerId = null
      temporaryPlaybackRatePointerCancelled = false
      suppressTemporaryPlaybackRateClick = false
    }

    function handleTemporaryPlaybackRateVisibilityChange() {
      if (document.hidden) {
        handleTemporaryPlaybackRateFocusLoss()
      }
    }

    /**
     * @param {KeyboardEvent} event
     */
    function keyboardShortcutHandler(event) {
      if (!player || !isActiveTab.value) {
        return
      }

      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
        return
      }

      const matches = shortcut => matchesKeyboardShortcut(event, shortcut)

      // exit fullscreen and/or fullwindow if keyboard shortcut modal is opened
      if (matches(KeyboardShortcuts.APP.GENERAL.SHOW_SHORTCUTS)) {
        event.preventDefault()

        if (ui.getControls().isFullScreenEnabled()) {
          ui.getControls().toggleFullScreen()
        }

        if (fullWindowEnabled.value) {
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: !fullWindowEnabled.value
          }))
        }

        return
      }

      // allow copying text
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        return
      }

      // allow focusing on search bar without affecting the playback
      const searchShortcuts = KeyboardShortcuts.APP.GENERAL
      if ([
        searchShortcuts.FOCUS_SEARCH,
        searchShortcuts.FOCUS_SEARCH_ALT,
        searchShortcuts.FOCUS_SEARCH_ALT_MAC,
        searchShortcuts.FOCUS_SEARCH_ALT_SLASH,
      ].some(matches)) {
        return
      }

      const video_ = video.value

      // Skip to next video in playlist or recommended
      if (matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SKIP_TO_NEXT)) {
        event.preventDefault()
        emit('skip-to-next')
        return
      }

      // Skip to previous video in playlist
      if (matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SKIP_TO_PREV)) {
        event.preventDefault()
        emit('skip-to-prev')
        return
      }

      switch (true) {
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN):
          // Toggle full screen
          event.preventDefault()
          togglePlayerFullScreen()
          blurTooltipButtons()
          break
        case event.key.toLowerCase() === 'escape':
          // Exit full window
          if (fullWindowEnabled.value) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('setFullWindow', {
              detail: false
            }))
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLWINDOW):
          // Toggle full window mode
          event.preventDefault()
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: !fullWindowEnabled.value
          }))
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.THEATRE_MODE):
          // Toggle theatre mode
          if (props.theatrePossible) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('toggleTheatreMode', {
              detail: !props.useTheatreMode
            }))
          }
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE): {
          event.preventDefault()
          const isMuted = !video_.muted
          video_.muted = isMuted

          const messageIcon = isMuted ? 'volume-mute' : 'volume-high'
          const message = isMuted ? '0%' : `${Math.round(video_.volume * 100)}%`
          showValueChange(message, messageIcon)
          blurTooltipButtons()
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_SKIP_SILENCE):
          event.preventDefault()
          updateSkipSilence(!skipSilence.value)
          break
      }

      if (event.defaultPrevented) {
        return
      }

      if (!hasLoaded.value) {
        return
      }

      if (event.key === 'Enter' && toggleActiveSponsorBlockSkipState()) {
        event.preventDefault()
        return
      }

      switch (true) {
        case isSpaceKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey:
          event.preventDefault()
          if (holdToDoublePlaybackSpeed.value) {
            startTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)
          } else {
            video_.paused ? video_.play() : video_.pause()
            blurTooltipButtons()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY):
          // Toggle Play/Pause
          event.preventDefault()
          video_.paused ? video_.play() : video_.pause()
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LARGE_REWIND): {
          // Rewind by 2x the time-skip interval (in seconds)
          event.preventDefault()
          const largeRewindMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(-defaultSkipInterval.value * largeRewindMultiplier * 2, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LARGE_FAST_FORWARD): {
          // Fast-Forward by 2x the time-skip interval (in seconds)
          event.preventDefault()
          const largeFastForwardMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(defaultSkipInterval.value * largeFastForwardMultiplier * 2, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED_ALT):
          // Decrease playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(-videoPlaybackRateInterval.value)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED_ALT):
          // Increase playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(videoPlaybackRateInterval.value)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_NORMAL_PLAYBACK_SPEED):
          // Toggle between 1x and the previous playback speed
          event.preventDefault()
          toggleNormalPlaybackRate()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS): {
          // Toggle caption/subtitles
          if (toggleCaptions()) {
            event.preventDefault()
          }
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VOLUME_UP):
          // Increase volume
          event.preventDefault()
          changeVolume(0.05)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VOLUME_DOWN):
          // Decrease Volume
          event.preventDefault()
          changeVolume(-0.05)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LAST_CHAPTER):
          if (props.chapters.length > 0 && props.currentChapterIndex > 0) {
            event.preventDefault()
            video_.currentTime = props.chapters[props.currentChapterIndex - 1].startSeconds
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.NEXT_CHAPTER):
          if (props.chapters.length > 0 && props.currentChapterIndex < props.chapters.length - 1) {
            event.preventDefault()
            video_.currentTime = props.chapters[props.currentChapterIndex + 1].startSeconds
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SMALL_REWIND): {
          event.preventDefault()
          // Rewind by the time-skip interval (in seconds)
          const smallRewindMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(-defaultSkipInterval.value * smallRewindMultiplier, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SMALL_FAST_FORWARD): {
          event.preventDefault()
          // Fast-Forward by the time-skip interval (in seconds)
          const smallFastForwardMultiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
          seekBySeconds(defaultSkipInterval.value * smallFastForwardMultiplier, false, true)
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE):
          // Toggle picture in picture
          if (props.format !== 'audio') {
            const controls = ui.getControls()
            if (controls.isPiPAllowed()) {
              event.preventDefault()
              controls.togglePiP()
            }
          }
          blurTooltipButtons()
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SKIP_N_TENTHS): {
          // Jump to percentage in the video
          if (canSeek()) {
            event.preventDefault()

            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()

            const length = seekRange.end - seekRange.start
            const percentage = parseInt(event.key) / 10

            video_.currentTime = seekRange.start + (length * percentage)
            showOverlayControls()
          }
          break
        }
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LAST_FRAME):
          if (video_.paused) {
            event.preventDefault()
            // Return to previous frame
            frameByFrame(-1)
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.NEXT_FRAME):
          if (video_.paused) {
            event.preventDefault()
            // Advance to next frame
            frameByFrame(1)
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.STATS):
          // Toggle stats display
          event.preventDefault()

          events.dispatchEvent(new CustomEvent('setStatsVisibility', {
            detail: !showStats.value
          }))
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.HOME):
          // Jump to beginning of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            video_.currentTime = seekRange.start
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.END):
          // Jump to end of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            video_.currentTime = seekRange.end
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.TAKE_SCREENSHOT):
          if (enableScreenshot.value && props.format !== 'audio') {
            event.preventDefault()
            // Take screenshot
            takeScreenshot()
          }
          blurTooltipButtons()
          break
      }
    }

    // #endregion keyboard shortcuts

    let ignoreErrors = false

    /**
     * @param {shaka.util.Error} error
     * @param {string} context
     * @param {object?} details
     */
    function handleError(error, context, details) {
      // These two errors are just wrappers around another error, so use the original error instead
      // As they can be nested (e.g. multiple googlevideo redirects because the Invidious server was far away from the user) we should pick the inner most one
      while (error.code === ErrorCode.REQUEST_FILTER_ERROR || error.code === ErrorCode.RESPONSE_FILTER_ERROR) {
        error = error.data[0]
      }

      // Allow shaka-player to retry on potentially recoverable network errors
      if (error.severity === ErrorSeverity.RECOVERABLE && error.category === ErrorCategory.NETWORK) {
        /** @type {keyof ErrorCategory} */
        const categoryText = Object.keys(ErrorCategory).find((/** @type {keyof ErrorCategory} */ key) => ErrorCategory[key] === error.category)

        /** @type {keyof ErrorCode} */
        const codeText = Object.keys(ErrorCode).find((/** @type {keyof ErrorCode} */ key) => ErrorCode[key] === error.code)

        console.warn(
          'Recoverable network error retrying...\n' +
          `Category: ${categoryText} (${error.category})\n` +
          `Code: ${codeText} (${error.code})\n` +
          'Data', error.data
        )
        return
      }

      // Recoverable network errors, including routine SABR request aborts, return
      // above. Any remaining abort or lifecycle interruption is still not evidence
      // that the current format failed: loads are also cancelled during
      // reload/unload/destroy. Ignore these codes instead of dropping to legacy.
      if (
        error.code === ErrorCode.OPERATION_ABORTED ||
        error.code === ErrorCode.LOAD_INTERRUPTED ||
        error.code === ErrorCode.OBJECT_DESTROYED ||
        error.code === ErrorCode.CONTENT_NOT_LOADED ||
        error.code === ErrorCode.PRELOAD_DESTROYED
      ) {
        console.warn(`Ignoring player abort/interruption (code ${error.code}) in ${context}`)
        return
      }

      logShakaError(error, context, props.videoId, details)

      // text related errors aren't serious (captions and seek bar thumbnails), so we should just log them
      // TODO: consider only emitting when the severity is crititcal?
      if (
        !ignoreErrors &&
        error.category !== shaka.util.Error.Category.TEXT &&
        !(error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && error.data[0].startsWith('https://www.youtube.com/api/timedtext'))
      ) {
        // don't react to multiple consecutive errors, otherwise we don't give the format fallback from the previous error a chance to work
        ignoreErrors = true

        emit('error', error)

        tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

        if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
          window.ftElectron.tabs.setPlaybackState('none', tabId)
        }
      }
    }

    // #region seek bar markers

    function clearSponsorBlockMarkers() {
      container.value.querySelectorAll('.sponsorBlockMarker').forEach(marker => marker.remove())
    }

    function getSponsorBlockMarkerDuration() {
      if (hasLoaded.value && player) {
        const { start, end } = player.seekRange()
        return end - start
      }

      return sponsorBlockAverageVideoDuration || getSponsorBlockSubmissionVideoDuration() || 0
    }

    function createSponsorBlockMarker(duration, startTime, endTime, title, className, isPointMarker = false) {
      const markerDiv = document.createElement('div')

      markerDiv.title = title
      markerDiv.className = className
      if (isPointMarker) {
        markerDiv.style.left = `calc(${(startTime / duration) * 100}% - 1px)`
      } else {
        markerDiv.style.width = `${((endTime - startTime) / duration) * 100}%`
        markerDiv.style.left = `${(startTime / duration) * 100}%`
      }

      return markerDiv
    }

    function refreshSponsorBlockMarkers() {
      clearSponsorBlockMarkers()

      const duration = getSponsorBlockMarkerDuration()
      if (!Number.isFinite(duration) || duration <= 0) {
        return
      }

      const markers = sponsorBlockSegments.map((segment) => {
        const isPointMarker = isSponsorBlockPointSegment(segment)
        const color = sponsorSkips.value.categoryData[segment.category]?.color ?? 'Green'

        return createSponsorBlockMarker(
          duration,
          segment.startTime,
          segment.endTime,
          translateSponsorBlockCategory(segment.category),
          `sponsorBlockMarker${isPointMarker ? ' sponsorBlockPointMarker' : ''} main${color}`,
          isPointMarker
        )
      })

      const draftMarkers = sponsorBlockCompleteDraftSegments.value.map((segment) => {
        const isPointMarker = isSponsorBlockPointSegment(segment)

        return createSponsorBlockMarker(
          duration,
          segment.startTime,
          segment.endTime,
          translateSponsorBlockCategory(segment.category),
          `sponsorBlockMarker sponsorBlockDraftMarker${isPointMarker ? ' sponsorBlockPointMarker' : ''}`,
          isPointMarker
        )
      })

      addMarkers(markers.concat(draftMarkers))
    }

    function createChapterMarkers() {
      const { start, end } = player.seekRange()
      const duration = end - start

      /**
       * @type {{
       *   title: string,
       *   timestamp: string,
       *   startSeconds: number,
       *   endSeconds: number,
       *   thumbnail?: string
       * }[]}
       */
      const chapters = props.chapters

      addMarkers(
        chapters.map(chapter => {
          const markerDiv = document.createElement('div')

          markerDiv.title = chapter.title
          markerDiv.className = 'chapterMarker'
          markerDiv.style.left = `calc(${(chapter.startSeconds / duration) * 100}% - 1px)`

          return markerDiv
        })
      )
    }

    /**
     * @param {HTMLDivElement[]} markers
     */
    function addMarkers(markers) {
      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')

      if (seekBarContainer.firstElementChild?.classList.contains('markerContainer')) {
        /** @type {HTMLDivElement} */
        const markerBar = seekBarContainer.firstElementChild

        markers.forEach(marker => markerBar.appendChild(marker))
      } else {
        const markerBar = document.createElement('div')
        markerBar.className = 'markerContainer'

        markers.forEach(marker => markerBar.appendChild(marker))

        seekBarContainer.insertBefore(markerBar, seekBarContainer.firstElementChild)
      }
    }

    // #endregion seek bar markers

    // #region offline message

    const isOffline = ref(!navigator.onLine)
    const isBuffering = ref(false)

    function onlineHandler() {
      isOffline.value = false
    }

    function offlineHandler() {
      isOffline.value = true
    }

    function fullscreenChangeHandler() {
      isFullscreen.value = isNativeFullscreenActive()
      suppressPanelTransitions(100)

      if (!isActiveTab.value) {
        return
      }

      if (isNativeFullscreenActive()) {
        if (scrollMiniPlayerActive.value) {
          deactivateScrollMiniPlayer()
        }
        restoreDockedPanels()
      } else if (!isNativeFullscreenActive()) {
        if (!fullWindowEnabled.value) {
          closeFullscreenComments()
          closeFullscreenPlaylist()
        }
        updateScrollMiniPlayer()
      }

      nextTick(showOverlayControls)
    }

    function exitFullscreenHandler() {
      if (!process.env.IS_ELECTRON || !ui) return

      try {
        const controls = ui.getControls()
        // Exit fullscreen if enabled
        if (controls && controls.isFullScreenEnabled && controls.isFullScreenEnabled()) {
          controls.toggleFullScreen()
        }

        // Exit fullwindow if enabled
        if (fullWindowEnabled.value && events) {
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: false
          }))
        }
      } catch (error) {
        // Silently ignore errors if component is not fully initialized
        console.error('Error exiting fullscreen on tab switch:', error)
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handlePlaybackRateMenuClick(event) {
      const target = event.target
      if (!isActiveTab.value || !(target instanceof Element) || !container.value?.contains(target)) {
        return
      }
      const playbackRatesContainer = target.closest('.shaka-playback-rates')

      if (playbackRatesContainer) {
        const button = target.closest('button')

        if (button && !button.classList.contains('shaka-back-to-overflow-button')) {
          playbackRateUserSet = true
          setTimeout(() => {
            if (!player) {
              return
            }

            emit('playback-rate-user-set', getCurrentPlaybackRate())
          }, 10)
        }
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handleQualityMenuClick(event) {
      const target = event.target
      if (!isActiveTab.value || !(target instanceof Element) || !container.value?.contains(target)) {
        return
      }
      const resolutionsContainer = target.closest('.shaka-resolutions')

      if (resolutionsContainer) {
        const button = target.closest('button')

        if (button && !button.classList.contains('shaka-back-to-overflow-button')) {
          setTimeout(() => {
            if (!player || player.getConfiguration().abr.enabled) {
              return
            }

            const quality = getActiveVariantQuality()

            if (quality !== null) {
              emit('video-quality-user-set', quality)
            }
          }, 50)
        }
      }
    }

    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)

    // Only display the offline message while buffering/the loading symbol is visible.
    // If we briefly lose the connection but it comes back before the buffer is empty,
    // the user won't notice anything so we don't need to display the message.
    const showOfflineMessage = computed(() => {
      return isOffline.value && isBuffering.value
    })

    // #endregion offline message

    // #region setup
    onMounted(async () => {
      const videoElement = video.value

      await initializeActiveTab()

      const localPlayer = new shaka.Player()

      ui = new shaka.ui.Overlay(
        localPlayer,
        container.value,
        videoElement,
        vrCanvas.value
      )

      // This has to be called after creating the UI, so that the player uses the UI's UITextDisplayer
      // otherwise it uses the browsers native captions which get displayed underneath the UI controls
      await localPlayer.attach(videoElement)

      const initialPlaybackRate = getInitialPlaybackRate()
      queuePlaybackRateRestore(initialPlaybackRate)
      videoElement.playbackRate = initialPlaybackRate
      videoElement.defaultPlaybackRate = getDefaultPlaybackRateForVideo()

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui) {
        return
      }

      const controls = ui.getControls()
      player = controls.getPlayer()
      wrapTextTrackSelection()

      player.addEventListener('buffering', event => {
        isBuffering.value = event.buffering
      })

      player.addEventListener('error', event => handleError(event.detail, 'shaka error handler'))

      player.configure(getPlayerConfig(props.format, false))

      if (process.env.SUPPORTS_LOCAL_API) {
        player.getNetworkingEngine().registerRequestFilter(requestFilter)
        player.getNetworkingEngine().registerResponseFilter(responseFilter)
      }

      await setLocale(locale.value)

      if (isMusicVideoDetected.value) {
        showMusicPlaybackRateToast(getUnforcedPlaybackRate())
      }

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui || !player) {
        return
      }

      videoResizeObserver.observe(videoElement)

      registerScreenshotButton()
      registerAudioTrackSelection()
      registerCaptionSelection()
      registerCaptionToggleButton()
      registerChapterOverlayButton()
      registerAutoplayToggle()
      registerAmbientModeButton()
      registerSkipSilenceButton()
      registerSleepTimer()

      registerTheatreModeButton()
      registerFullWindowButton()
      registerLegacyQualitySelection()
      registerContextMenuButtons()
      registerStatsButton()
      registerSponsorBlockSubmissionButtons()
      registerSponsorBlockHighlightButton()
      registerSkipButtons()
      registerPlaybackAdjustedTime()
      registerQuickPlaybackRateBar()

      registeredCustomControls = true
      liveCustomControlPlayers++

      if (ui.isMobile()) {
        onlyUseOverFlowMenu.value = true
      } else {
        const initialWidth = container.value.getBoundingClientRect().width
        // A zero width means the player mounted in a non-presented tab (an
        // ancestor is display:none), not that the player is actually narrow.
        // Default to the full control bar; the resize/presentation remeasure
        // decides the real layout once the tab is visible.
        onlyUseOverFlowMenu.value = initialWidth > 0 && initialWidth <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD

        containerResizeObserver = new ResizeObserver(resized)
        containerResizeObserver.observe(container.value)
      }

      controls.addEventListener('uiupdated', addUICustomizations)
      configureUI(true)

      applyInitialVolume(videoElement)

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keyup', keyboardShortcutKeyupHandler)
      document.addEventListener('pointerup', handleTemporaryPlaybackRatePointerUp, true)
      document.addEventListener('pointercancel', handleTemporaryPlaybackRatePointerCancel, true)
      document.addEventListener('visibilitychange', handleTemporaryPlaybackRateVisibilityChange)
      document.addEventListener('fullscreenchange', fullscreenChangeHandler)
      // Use event delegation on document with capture phase to catch events before shaka-no-propagation stops them from bubbling
      document.addEventListener('click', handlePlaybackRateMenuClick, true)
      document.addEventListener('click', handleQualityMenuClick, true)

      // Set up IPC listener for exit fullscreen when tab becomes inactive (Electron only)
      // Only set up after UI is fully initialized
      if (process.env.IS_ELECTRON && ui && window.ftElectron?.tabs?.onExitFullscreen) {
        try {
          exitFullscreenCleanup = window.ftElectron.tabs.onExitFullscreen(exitFullscreenHandler, tabId)
        } catch (error) {
          console.error('Failed to set up exit fullscreen listener:', error)
        }
      }

      setupAutoPictureInPicture()

      if (container.value && props.format !== 'audio' && typeof IntersectionObserver !== 'undefined') {
        setupScrollMiniIntersectionObserver()
      }

      window.addEventListener('scroll', handleScrollMiniWindowScroll, { passive: true })
      window.addEventListener('resize', handleScrollMiniWindowResize)
      window.addEventListener('blur', handleTemporaryPlaybackRateFocusLoss)

      player.addEventListener('loading', () => {
        hasLoaded.value = false
        chapterThumbnails.value = []
      })

      player.addEventListener('loaded', handleLoaded)
      player.addEventListener('variantchanged', () => {
        if (props.format === 'legacy' || player.getConfiguration().abr.enabled) {
          return
        }

        const quality = getActiveVariantQuality()

        if (quality !== null) {
          emit('video-quality-updated', quality)
        }
      })

      if (props.format !== 'legacy') {
        player.addEventListener('streaming', () => {
          if (props.format === 'dash') {
            const firstVariant = player.getVariantTracks()[0]

            // force the player aspect ratio to 16:9 to avoid overflowing the layout
            forceAspectRatio.value = firstVariant.width / firstVariant.height < 1.5
          }
        })
      } else {
        // force the player aspect ratio to 16:9 to avoid overflowing the layout, when the video is too tall

        const firstFormat = props.legacyFormats[0]
        forceAspectRatio.value = firstFormat.width / firstFormat.height < 1.5
      }

      if (useSponsorBlock.value) {
        setupSponsorBlock()
      }

      // shaka-player doesn't start with the cursor hidden, so hide it here for instances in which the
      // cursor is in the video player area when the video first loads
      container.value.classList.add('no-cursor')

      await performFirstLoad()
      // Whatever runs after `performFirstLoad` might be after switching to another page due to SABR backoff

      player?.addEventListener('ratechange', () => {
        const playbackRate = player.getPlaybackRate()
        if (!temporaryPlaybackRateActive && !silenceSkipping.handlePlaybackRateChange(playbackRate)) {
          emit('playback-rate-updated', playbackRate)
        }
      })
    })
    onUnmounted(() => {
      clearSabrBackoffTimer()
      clearPreRollTimer()
      clearTimeout(sponsorBlockHighlightLabelTimeout)
    })

    async function performFirstLoad() {
      if (process.env.SUPPORTS_LOCAL_API && sabrStream) {
        // Longer timeout for receiving larger responses
        player.configure({
          streaming: {
            retryParameters: {
              timeout: 30 * 1000 * 2,
            }
          }
        })
      } else {
        // Reset to default value
        player.configure({
          streaming: {
            retryParameters: {
              timeout: 30 * 1000,
            }
          }
        })
      }

      const initialLoadDelayMs = props.delayLoadUntilUnix - Date.now()
      if (initialLoadDelayMs > 0 && (props.format === 'legacy' || props.manifestMimeType !== MANIFEST_TYPE_SABR)) {
        startPreRollTimer(initialLoadDelayMs)
        await new Promise((resolve) => setTimeout(resolve, initialLoadDelayMs))
        clearPreRollTimer()
      }

      if (props.format === 'dash' || props.format === 'audio') {
        try {
          await player.load(props.manifestSrc, props.startTime, props.manifestMimeType)

          if (props.format === 'dash') {
            setDashQuality(preferredVideoQuality.value)
          } else {
            let variants = player.getVariantTracks()

            if (hasMultipleAudioTracks.value) {
              // default audio track
              variants = variants.filter(variant => variant.audioRoles.includes('main'))
            }

            const highestBandwidth = Math.max(...variants.map(variant => variant.audioBandwidth))
            variants = variants.filter(variant => variant.audioBandwidth === highestBandwidth)

            player.selectVariantTrack(variants[0])
          }
        } catch (error) {
          handleError(error, 'loading dash/audio manifest and setting default quality in mounted')
        }
      } else {
        await setLegacyQuality(props.startTime)
      }
    }

    /**
     * Adds the captions and thumbnail tracks, also restores the previously selected captions track,
     * if this was triggered by a format change and the user had the captions enabled.
     */
    async function handleLoaded() {
      togglePlaybackRate = null
      hasLoaded.value = true
      // Ideally we would set this in the `streaming` event handler, but for HLS this is only set to true after the loaded event fires.
      isLive.value = player.isLive()
      restorePendingPlaybackRate()
      emit('loaded')

      nextTick(() => {
        rememberInlinePlayerLayoutHeight()
      })

      // getAudioTracks() returns an empty array when no variant is active, so we can't do this in the `streaming` event
      hasMultipleAudioTracks.value = deduplicateAudioTracks(player.getAudioTracks()).size > 1

      if (process.env.SUPPORTS_LOCAL_API && props.format !== 'legacy' && props.manifestMimeType === MANIFEST_TYPE_SABR) {
        sabrManifest = player.getManifest()
      }

      // For SABR we include the thumbnails, chapters and subtitles in the manifest
      if (!process.env.SUPPORTS_LOCAL_API || props.format === 'legacy' || props.manifestMimeType !== MANIFEST_TYPE_SABR) {
        const promises = []

        for (const caption of props.captions) {
          if (props.format === 'legacy') {
            const url = new URL(caption.url)

            if (url.hostname.endsWith('.youtube.com') && url.pathname === '/api/timedtext' &&
              url.searchParams.get('caps') === 'asr' && url.searchParams.get('kind') === 'asr' && url.searchParams.get('fmt') === 'vtt') {
              promises.push((async () => {
                try {
                  const response = await fetch(caption.url)
                  let text = await response.text()

                  // position:0% for LTR text and position:100% for RTL text
                  text = text.replaceAll(/ align:start position:(?:10)?0%$/gm, '')

                  const url = `data:${caption.mimeType};charset=utf-8,${encodeURIComponent(text)}`

                  await player.addTextTrackAsync(
                    url,
                    caption.language,
                    'captions',
                    caption.mimeType,
                    undefined, // codec, only needed if the captions are inside a container (e.g. mp4)
                    caption.label
                  )
                } catch (error) {
                  if (error instanceof shaka.util.Error) {
                    handleError(error, 'addTextTrackAsync', caption)
                  } else {
                    console.error(error)
                  }
                }
              })())
            } else {
              promises.push(
                player.addTextTrackAsync(
                  caption.url,
                  caption.language,
                  'captions',
                  caption.mimeType,
                  undefined, // codec, only needed if the captions are inside a container (e.g. mp4)
                  caption.label
                )
                  .catch(error => handleError(error, 'addTextTrackAsync', caption))
              )
            }
          } else {
            promises.push(
              player.addTextTrackAsync(
                caption.url,
                caption.language,
                'captions',
                caption.mimeType,
                undefined, // codec, only needed if the captions are inside a container (e.g. mp4)
                caption.label
              )
                .catch(error => handleError(error, 'addTextTrackAsync', caption))
            )
          }
        }

        if (!isLive.value && props.storyboardSrc) {
          promises.push(
            // Only log the error, as the thumbnails are a nice to have
            // If an error occurs with them, it's not critical
            player.addThumbnailsTrack(props.storyboardSrc, 'text/vtt')
              .catch(error => logShakaError(error, 'addThumbnailsTrack', props.videoId, props.storyboardSrc))
          )
        }

        await Promise.all(promises)
      }

      loadChapterThumbnails()

      if (restoreCaptionIndex !== null) {
        const index = restoreCaptionIndex
        restoreCaptionIndex = null

        const textTrack = player.getTextTracks()[index]

        if (textTrack) {
          player.selectTextTrack(textTrack)
        }
      }

      if (props.chapters.length > 0) {
        createChapterMarkers()
      }

      applyPendingPresentationModes()

      if (props.resumePlaybackAfterSabrReload) {
        video.value?.play()
        emit('resume-playback-after-sabr-reload-done')
      }
    }

    watch(
      () => props.format,
      /**
       * Handles changing between formats. It tries its best to backup and restore the settings:
       * - playback position
       * - paused state
       * - playback rate
       * - audio track
       * - captions track
       * - video quality
       * @param {'dash'|'audio'|'legacy'} newFormat
       * @param {'dash'|'audio'|'legacy'} oldFormat
       */
      async (newFormat, oldFormat) => {
        ignoreErrors = true

        // format switch happened before the player loaded, probably because of an error
        // as there are no previous player settings to restore, we should treat it like this was the original format
        if (!hasLoaded.value) {
          try {
            await player.unload()
          } catch { }

          ignoreErrors = false

          player.configure(getPlayerConfig(newFormat, false))

          await performFirstLoad()
          return
        }

        const video_ = video.value

        const wasPaused = video_.paused
        const playbackRate = getCurrentPlaybackRate()

        const useAutoQuality = oldFormat === 'legacy' ? false : player.getConfiguration().abr.enabled

        if (!wasPaused) {
          video_.pause()
        }

        const playbackPosition = video_.currentTime

        const activeCaptionIndex = player.getTextTracks().findIndex(caption => caption.active)

        if (activeCaptionIndex >= 0) {
          restoreCaptionIndex = activeCaptionIndex

          // hide captions before switching as shaka/the browser doesn't clean up the displayed captions
          // when switching away from the legacy formats
          player.selectTextTrack(null)
        } else {
          restoreCaptionIndex = null
        }

        if (newFormat === 'audio' || newFormat === 'dash') {
          let label
          let audioBandwidth
          let dimension

          if (oldFormat === 'legacy' && newFormat === 'dash') {
            const legacyFormat = activeLegacyFormat.value

            if (!useAutoQuality) {
              dimension = legacyFormat.height > legacyFormat.width ? legacyFormat.width : legacyFormat.height
            }
          } else if (oldFormat !== 'legacy') {
            const track = player.getVariantTracks().find(track => track.active)

            if (typeof track.audioBandwidth === 'number') {
              audioBandwidth = track.audioBandwidth
            }

            if (track.label) {
              label = track.label
            }
          }

          if (oldFormat === 'audio' && newFormat === 'dash' && !useAutoQuality) {
            dimension = preferredVideoQuality.value
          }

          try {
            await player.unload()
          } catch { }

          ignoreErrors = false
          queuePlaybackRateRestore(playbackRate)

          player.configure(getPlayerConfig(newFormat, useAutoQuality))

          try {
            await player.load(props.manifestSrc, playbackPosition, props.manifestMimeType)

            if (useAutoQuality) {
              if (label) {
                const audioTracks = deduplicateAudioTracks(player.getAudioTracks()).values()

                for (const track of audioTracks) {
                  if (label === track.label) {
                    player.selectAudioTrack(track)
                    break
                  }
                }
              }
            } else {
              if (dimension) {
                setDashQuality(dimension, audioBandwidth, label)
              } else {
                let variants = player.getVariantTracks()

                if (label) {
                  variants = variants.filter(variant => variant.label === label)
                } else if (variants.length > 1) {
                  // default audio track
                  const filteredVariants = variants.filter(variant => variant.audioRoles.includes('main'))
                  // Sometimes there is nothing marked as main, don't filter in this case
                  if (filteredVariants.length > 0) {
                    variants = filteredVariants
                  }
                }

                let chosenVariant

                if (typeof audioBandwidth === 'number') {
                  chosenVariant = findMostSimilarAudioBandwidth(variants, audioBandwidth)
                } else {
                  chosenVariant = variants.reduce((previous, current) => {
                    return previous === null || current.bandwidth > previous.bandwidth ? current : previous
                  }, null)
                }

                player.selectVariantTrack(chosenVariant)
              }
            }
          } catch (error) {
            handleError(error, 'loading dash/audio manifest for format switch', `${oldFormat} -> ${newFormat}`)
          }
          activeLegacyFormat.value = null
        } else {
          let previousQuality

          if (oldFormat === 'dash') {
            const previousTrack = player.getVariantTracks().find(track => track.active)

            previousQuality = previousTrack.height > previousTrack.width ? previousTrack.width : previousTrack.height
          }

          try {
            await player.unload()
          } catch { }

          ignoreErrors = false

          await setLegacyQuality(playbackPosition, previousQuality, playbackRate)
        }

        if (wasPaused) {
          video_.pause()
        }
      }
    )

    // #endregion setup

    watch(() => skippedSponsorBlockSegments.value.length, (length) => {
      if (length > 0) {
        sponsorBlockToastNow.value = Date.now()
        startSponsorBlockToastTimer()
      } else {
        stopSponsorBlockToastTimer()
      }
    })

    // #region tear down

    onBeforeUnmount(() => {
      fullWindowAnimation?.cancel()
      hasLoaded.value = false
      closeFullscreenComments()
      closeFullscreenPlaylist()
      if (document.body.dataset.playerFullWindowOwner === mediaTabId) {
        delete document.body.dataset.playerFullWindowOwner
        document.body.classList.remove('playerFullWindow')
      }

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.removeEventListener('keyup', keyboardShortcutKeyupHandler)
      document.removeEventListener('pointerup', handleTemporaryPlaybackRatePointerUp, true)
      document.removeEventListener('pointercancel', handleTemporaryPlaybackRatePointerCancel, true)
      document.removeEventListener('visibilitychange', handleTemporaryPlaybackRateVisibilityChange)
      document.removeEventListener('fullscreenchange', fullscreenChangeHandler)
      document.removeEventListener('click', handlePlaybackRateMenuClick, true)
      document.removeEventListener('click', handleQualityMenuClick, true)
      window.removeEventListener('blur', handleTemporaryPlaybackRateFocusLoss)

      cancelTemporaryPlaybackRateHolds()

      // Clean up IPC listener for exit fullscreen
      if (exitFullscreenCleanup) {
        exitFullscreenCleanup()
        exitFullscreenCleanup = null
      }

      teardownAutoPictureInPicture()
      teardownScrollMiniPlayer()

      if (containerResizeObserver) {
        containerResizeObserver.disconnect()
        containerResizeObserver = null
      }

      if (controlPanelResizeObserver) {
        controlPanelResizeObserver.disconnect()
        controlPanelResizeObserver = null
      }

      if (controlPanelMutationObserver) {
        controlPanelMutationObserver.disconnect()
        controlPanelMutationObserver = null
      }

      if (controlPanelLayoutFrame !== null) {
        cancelAnimationFrame(controlPanelLayoutFrame)
        controlPanelLayoutFrame = null
      }

      if (videoResizeObserver) {
        videoResizeObserver.disconnect()
      }

      cleanUpCustomPlayerControls()

      tabMediaCoordinator.setActionHandlers(mediaTabId, 'player', {})
      tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

      // Clear tab playback state indicator when player is destroyed
      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none', tabId)
      }

      skippedSponsorBlockSegments.value.forEach(segment => clearTimeout(segment.timeoutId))
      promptSponsorBlockSegments.value = []
      stopSponsorBlockToastTimer()
      clearSponsorBlockNotFoundRefetchTimeout()

      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
    })

    // #endregion tear down

    // #region functions used by the watch page

    function isPaused() {
      return video.value.paused
    }

    function pause() {
      video.value.pause()
    }

    function play() {
      return video.value.play()
    }

    function getCurrentTime() {
      return video.value.currentTime
    }

    /**
     * @param {number} time
     */
    function setCurrentTime(time) {
      video.value.currentTime = time
    }

    function getSabrReloadState() {
      const captionIndex = player?.getTextTracks().findIndex(caption => caption.active) ?? -1

      return {
        wasPlaying: !video.value?.paused,
        captionIndex: captionIndex >= 0 ? captionIndex : null,
        playbackRate: getCurrentPlaybackRate()
      }
    }

    /**
     * Vue's lifecycle hooks are synchonous, so if we destroy the player in {@linkcode onBeforeUnmount},
     * it won't be finished in time, as the player destruction is asynchronous.
     * To workaround that we destroy the player first and wait for it to finish before we unmount this component.
     *
     * @returns {Promise<{
     *   startNextVideoInFullscreen: boolean,
     *   startNextVideoInFullwindow: boolean,
     *   startNextVideoInPip: boolean,
     *   startNextVideoWithChapters: boolean,
     *   startNextVideoWithFullscreenComments: boolean,
     *   startNextVideoWithFullscreenPlaylist: boolean
     * }>}
     */
    async function destroyPlayer() {
      ignoreErrors = true

      let uiState = {
        startNextVideoInFullscreen: false,
        startNextVideoInFullwindow: false,
        startNextVideoInPip: false,
        startNextVideoWithChapters: false,
        startNextVideoWithFullscreenComments: false,
        startNextVideoWithFullscreenPlaylist: false
      }

      if (ui) {
        if (ui.getControls()) {
          // save the state of player settings to reinitialize them upon next creation
          const controls = ui.getControls()
          uiState = {
            startNextVideoInFullscreen: controls.isFullScreenEnabled(),
            startNextVideoInFullwindow: fullWindowEnabled.value,
            startNextVideoInPip: controls.isPiPEnabled(),
            startNextVideoWithChapters: showChaptersOverlay.value,
            startNextVideoWithFullscreenComments: showFullscreenComments.value,
            startNextVideoWithFullscreenPlaylist: showFullscreenPlaylist.value
          }
        }

        // destroying the ui also destroys the player
        await ui.destroy()
        ui = null
        player = null
      } else if (player) {
        await player.destroy()
        player = null
      }

      if (process.env.SUPPORTS_LOCAL_API && sabrStream) {
        sabrStream.cleanup()
        sabrAbortController?.abort()
      }

      // shaka-player doesn't clear these itself, which prevents shaka.ui.Overlay from being garbage collected
      // Should really be fixed in shaka-player but it's easier just to do it ourselves
      if (container.value) {
        container.value.ui = null
      }

      if (video.value) {
        video.value.ui = null
      }

      return uiState
    }

    expose({
      hasLoaded,

      isPaused,
      play,
      pause,
      getCurrentTime,
      setCurrentTime,
      getSabrReloadState,
      closeFullscreenComments,
      closeFullscreenPlaylist,
      closeChaptersOverlay,
      toggleSponsorBlockInfo,
      closeSponsorBlockInfo,
      refreshSponsorBlockInfo,
      skipSponsorBlockInfoSegment,
      voteOnSponsorBlockInfoSegment,
      copyChapterTimestamp,
      destroyPlayer
    })

    // #endregion functions used by the watch page

    const showValueChangePopup = ref(false)
    const valueChangeMessage = ref('')
    const valueChangeIcon = ref(null)
    const invertValueChangeContentOrder = ref(false)
    const showTemporaryPlaybackRateIndicator = ref(false)
    const temporaryPlaybackRateIndicatorMessage = ref('')
    let valueChangeTimeout = null

    function showOverlayControls() {
      ui.getControls().showUI()
    }

    /**
     * Shows a popup with a message and an icon on top of the video player.
     * @param {string} message - The message to display.
     * @param {string} icon - The icon to display.
     * @param {boolean} invertContentOrder - Whether to invert the order of the icon and message.
     */
    function showValueChange(message, icon = null, invertContentOrder = false) {
      valueChangeMessage.value = message
      valueChangeIcon.value = icon
      showValueChangePopup.value = true
      invertValueChangeContentOrder.value = invertContentOrder

      if (valueChangeTimeout) {
        clearTimeout(valueChangeTimeout)
      }

      valueChangeTimeout = setTimeout(() => {
        showValueChangePopup.value = false
      }, 2000)

      showOverlayControls()
    }

    return {
      ambientCanvas,
      ambientFullscreenCanvas,
      ambientLayoutCanvas,
      ambientModeVisible,
      captionCssVariables,
      captionAppearanceSampleBottom,
      showCaptionAppearanceSample,
      container,
      video,
      vrCanvas,
      chapterOverlay,
      showChaptersOverlay,
      isFullscreen,
      presentationModeChanging,
      chapterThumbnails,
      closeChaptersOverlay,
      selectOverlayChapter,
      copyChapterTimestamp,
      fullscreenCommentsOverlay,
      showFullscreenComments,
      closeFullscreenComments,
      setFullscreenComments,
      fullscreenPlaylistOverlay,
      fullscreenPlaylistTarget,
      showFullscreenPlaylist,
      closeFullscreenPlaylist,
      setFullscreenPlaylist,
      showFullscreenShareAction,
      showFullscreenPlaylistAction,
      getShareTimestamp,
      addToPlaylist,

      fullWindowEnabled,
      fullWindowPlaceholderHeight,
      forceAspectRatio,

      showStats,
      stats,
      playerDimensions,
      annotationCurrentTime,

      autoplayVideos,
      sponsorBlockShowSkippedToast,
      sponsorBlockDraftEditValues,
      sponsorBlockDraftSegments,
      sponsorBlockSubmissionCategories,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      isSponsorBlockDraftEditing,
      isSponsorBlockPointSegment,

      promptSponsorBlockSegments,
      getSponsorBlockPromptLabel,
      getSponsorBlockPromptActionLabel,
      getSponsorBlockPromptTimeLabel,
      dismissPromptSponsorBlockSegment,
      skipPromptSponsorBlockSegment,
      skippedSponsorBlockSegments,
      getSponsorBlockToastTimeLabel,
      isSponsorBlockToastCountdownPaused,
      getSponsorBlockToastActionLabel,
      pauseSponsorBlockToastCountdown,
      resumeSponsorBlockToastCountdown,
      removeSponsorBlockToast,
      unskipSponsorBlockSegment,
      redoSkipSponsorBlockSegment,
      updateSponsorBlockDraftEditField,
      updateSponsorBlockDraftCategory,
      setSponsorBlockDraftTime,
      saveSponsorBlockDraft,
      toggleSponsorBlockDraftEditing,
      previewSponsorBlockDraft,
      deleteSponsorBlockDraft,
      submitSponsorBlockDrafts,
      closeSponsorBlockSubmissionMenu,
      openSponsorBlockGuidelines,
      translateSponsorBlockCategory,

      showOfflineMessage,
      autoplayNextVideo,
      autoplayThumbnail,
      autoplayDuration,
      compactAutoplayLayout,
      tinyAutoplayLayout,
      cancelAutoplayCountdown,
      playAutoplayVideoNow,
      showCountdownOverlay,
      countdownTimeLabel,
      countdownAriaLabel,
      countdownRingCircumference,
      countdownRingDashoffset,

      handlePlay,
      handlePause,
      syncPlayPauseControlIcons,
      handleCanPlay,
      handleEnded,
      updateVolume,
      handleTimeupdate,
      handleEnterPictureInPicture,
      handleLeavePictureInPicture,

      valueChangeMessage,
      valueChangeIcon,
      showValueChangePopup,
      invertValueChangeContentOrder,
      showTemporaryPlaybackRateIndicator,
      temporaryPlaybackRateIndicatorMessage,
      silenceSkippingActive: silenceSkipping.isAccelerating,
      silenceSkippingIndicatorMessage,

      scrollMiniPlayerActive,
      scrollMiniPlaceholderHeight,
      scrollMiniPlayerStyle,
      scrollMiniIsPaused,
      scrollMiniVolume,
      scrollMiniVolumePercent,
      scrollMiniVolumeIcon,
      scrollMiniPlayPauseVisible,
      scrollMiniVolumeExpanded,
      scrollMiniDragHandleOnLightBg,
      scrollMiniResizeHandleOnLightBg,
      scrollMiniResizeCorner,
      scrollMiniAnchor,
      scrollMiniPlaceholder,
      scrollMiniVolumeTrack,
      handleScrollMiniPlayerLeave,
      handleScrollMiniPlayerEnter,
      handleScrollMiniPlayPauseMouseEnter,
      handleScrollMiniControlsPointerMove,
      suppressScrollMiniPlayPausePointerReveal,
      scrollMiniTogglePlayPause,
      scrollMiniScrollToTop,
      updateScrollMiniVolume,
      handleScrollMiniVolumeMouseEnter,
      handleScrollMiniVolumeMouseLeave,
      handleScrollMiniVolumePointerDown,
      handleScrollMiniDragPointerDown,
      handleScrollMiniResizePointerDown,
    }
  }
})
