import { setupPhoneOptionsMenu } from '../../helpers/player/phoneOptionsMenu'
import { setupSubmenuScrolling } from '../../helpers/player/submenuScrolling'
import { chooseAndroidDirectory } from '../../helpers/androidStorage'
import { isAppHidden, getAndroidAppActive, waitForAndroidAppState } from '../../helpers/appVisibility.js'
import { playbackScreenWake } from '../../helpers/playbackScreenWake'
import { createRepeatStatsTracker } from '../../helpers/player/repeatStats'
import { computed, defineComponent, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, reactive, ref, shallowRef, useId, watch } from 'vue'
import FtPaidPromotionBadge from '../FtPaidPromotionBadge/FtPaidPromotionBadge.vue'
import FtRetryImage from '../FtRetryImage.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import SponsorBlockSegmentEditor from '../WatchVideoSponsorBlock/SponsorBlockSegmentEditor.vue'
import shaka from 'shaka-player'
import { getCodecPrefixes, getVideoCodecPreferences, preferredVideoDecodingAttributes } from '../../helpers/player/videoCodecPreference'
import { AutoQualityAbrManager, supportsSmoothCodecSwitching } from '../../helpers/player/AutoQualityAbrManager'
import { voidWebmProjection } from '../../helpers/player/webmProjection'
import { registerPlugin } from '@capacitor/core'
import { bindAndroidMediaErrors } from '../../helpers/player/androidMediaErrors'
import { androidRotationFullscreenHandoffs, bindAndroidFullscreen } from '../../helpers/player/androidFullscreen'
import { bindIosFullscreen } from '../../helpers/player/iosFullscreen'
import { bindIosNativeCaptions } from '../../helpers/player/iosNativeCaptions'
import { bindNativeCaptionTiming } from '../../helpers/player/nativeCaptionTiming'
import { createIOSMediaTransport } from '../../helpers/player/iosMediaTransport'
import { useI18n } from 'vue-i18n'
import { createPopularityPath, isMostReplayed } from '../../helpers/player/videoPopularity'

import store from '../../store/index'
import { usesInvidiousInstance } from '../../../apiBackends'
import { getAvailableFullscreenActions } from '../../helpers/fullscreenActions'
import { DEFAULT_CONTROL_BAR_BUTTONS, getRemovedControlBarButtons } from '../../helpers/controlBarButtons'
import { getSubtitleRequestUrl } from '../../helpers/player/subtitleCookies'
import { enableTwitchTsVideoGap } from '../../helpers/player/twitchTsVideoGap'
import LightsOffOverlay from './LightsOffOverlay.vue'
import { BooleanSettingButton } from './player-components/BooleanSettingButton'
import { KeyboardShortcuts, PlayerIcons, ZOOM_IN_ICON_VIEWBOX } from '../../../constants'
import { useTabContext, useTabLifecycle } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'
import { AmbientModeButton } from './player-components/AmbientModeButton'
import {
  AbRepeatControl,
  setAbRepeatContext,
} from './player-components/AbRepeatControl'
import { AudioTrackSelection } from './player-components/AudioTrackSelection'
import { CaptionSelection } from './player-components/CaptionSelection'
import { CaptionToggleButton, CLOSED_CAPTIONS_OUTLINED } from './player-components/CaptionToggleButton'
import { ChapterOverlayButton } from './player-components/ChapterOverlayButton'
import { CopyVideoUrlButton, setCopyVideoUrlContext } from './player-components/CopyVideoUrlButton'
import { FullWindowButton } from './player-components/FullWindowButton'
import { AndroidPictureInPictureButton } from './player-components/AndroidPictureInPictureButton'
import { LegacyQualitySelection } from './player-components/LegacyQualitySelection'
import { QualitySelection } from './player-components/QualitySelection'
import { LoopButton, setLoopButtonContext } from './player-components/LoopButton'
import { MusicVisualizerButton } from './player-components/MusicVisualizerButton'
import { QuickPlaybackRateBar, setQuickPlaybackRateBarContext } from './player-components/QuickPlaybackRateBar'
import './player-components/SeekPreviewBar'
import { ScreenshotButton } from './player-components/ScreenshotButton'
import { SkipSilenceButton } from './player-components/SkipSilenceButton'
import { LevelSelection } from './player-components/LevelSelection'
import { VoiceOverTranslationButton } from './player-components/VoiceOverTranslationButton'
import { supportsVoiceOverTranslation } from '../../helpers/voiceOverTranslation'
import { SleepTimer } from './player-components/SleepTimer'
import { SeekHistoryMenu } from './player-components/SeekHistoryMenu'
import { ShortsVideoInfoButton } from './player-components/ShortsVideoInfoButton'
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
  getSponsorBlockSegments,
  logShakaError,
  repairInvidiousManifest,
  translateSponsorBlockCategory
} from '../../helpers/player/utils'
import { getPreferredCaption } from '../../../captionLanguages'
import { createLocalCaption, LOCAL_CAPTION_FILE_TYPES, normalizeLocalCaptionText } from '../../helpers/player/localCaptions'
import {
  addKeyboardShortcutToActionTitle,
  formatDurationAsTimestamp,
  getCachedOembedTitle,
  getOembedTitle,
  getVideoThumbnailUrl,
  pickFileWithPicker,
  showToast,
  writeFileWithPicker,
  throttle,
  removeFromArrayIfExists,
  copyToClipboard,
} from '../../helpers/utils'
import { isHexColor } from '../../helpers/colors'
import { applyAnimationSpeed, getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import {
  addOverlayScrollbars,
  clampOverlayScrollTop,
  removeOverlayScrollbars,
  updateOverlayScrollbars,
} from '../../helpers/overlayScrollbars'
import { getFullscreenAspectRatio, setFullscreenOrientation, setLandscapeOrientation, shouldRotateFullscreenToLandscape } from '../../helpers/capacitorUi'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import {
  enterAndroidPictureInPicture,
  observeAndroidDisplayRotation,
  observeAndroidDeviceRotation,
  prepareAndroidFullscreenRotation,
  getAndroidDisplayOrientation,
  setAndroidNavigationBarVisible,
  setAndroidStatusBarVisible,
  shouldShowAndroidStatusBar,
} from '../../helpers/androidUi'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../helpers/share'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { preferOriginalHlsAudio } from '../../helpers/player/hlsAudioTracks'
import { ignoreLoneHlsVideoDefaults } from '../../helpers/player/hlsVideoRenditions'
import { getDefaultAudioVariants } from '../../helpers/player/defaultAudioTrack'
import { MUSIC_MEDIA_TYPE } from '../../helpers/player/musicMediaType'
import { resolveSegmentPrefetchLimit } from '../../helpers/player/segmentPrefetch'
import { getBufferingConfig } from '../../helpers/player/buffering'
import { AUTO_QUALITY_FALLBACK, streamsSupportAutoQuality } from '../../helpers/player/autoQuality'
import { getMeteredAutoQualityMaxPixels, limitQualityOnMeteredNetwork } from '../../helpers/player/meteredNetworkQuality'
import { setupSabrScheme } from '../../helpers/player/SabrSchemePlugin'
import { prepareGoogleVideoRequest } from '../../helpers/player/playbackRequestPolicy'
import {
  avoidUnreachableGoogleVideoHost,
  GOOGLEVIDEO_CONNECTION_TIMEOUT_MS,
  markGoogleVideoHostUnreachable
} from '../../helpers/player/googleVideoFallback'
import { getRememberedPlayerVolume, setRememberedPlayerVolume } from '../../helpers/player/volume-storage'
import { parseChannelPreferences, removeChannelPreference } from '../../helpers/channel-preferences'
import { findLegacyFormatForQuality } from '../../helpers/player/legacyFormats'
import { waitForYtDlpFormatAvailability } from '../../helpers/player/ytDlpFormatAvailability'
import { getDashQualityFromDimensions } from '../../helpers/player/videoQuality'
import { DEFAULT_VIDEO_ZOOM, formatVideoZoom, VIDEO_ZOOM_LEVELS } from '../../helpers/player/videoZoom'
import { DEFAULT_VOLUME_BOOST, sanitizeVolumeBoost, VOLUME_BOOST_LEVELS } from '../../helpers/player/volumeBoost'
import { shouldStartPaidPromotionTimer } from '../../helpers/player/paidPromotion'
import { updateSponsorBlockSeekBarState } from '../../helpers/player/sponsorBlockSeekBar'
import { formatAbRepeatTimestamp } from '../../helpers/player/abRepeat'
import {
  SEEK_HISTORY_MIN_JUMP_SECONDS,
  getSeekHistory,
  recordSeekHistoryJump,
  setSeekHistory,
  stepSeekHistoryBack,
  stepSeekHistoryForward,
} from '../../helpers/player/seekHistory'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import {
  DEFAULT_CAPTION_SETTINGS,
  getCaptionCssVariables,
  getCaptionPlayerVariables,
  parseCaptionSettings,
} from '../../helpers/player/caption-settings'
import { AB_REPEAT_VALUE_CHANGE_ICON, useAbRepeat } from './opentubex/useAbRepeat'
import { useAdaptiveControlPanelLayout } from './opentubex/useAdaptiveControlPanelLayout'
import { useAmbientMode } from './opentubex/useAmbientMode'
import { createDockedPanelMemory, DOCKED_PANEL_CLOSE_ORDER, DOCKED_PANEL_RESTORE_ORDER } from './opentubex/dockedPanels'
import { NORMAL_PLAYBACK_RATE, getPlaybackRatePresets, normalizePlaybackRate, usePlaybackRate } from './opentubex/usePlaybackRate'
import { useAutoPictureInPicture } from './opentubex/useAutoPictureInPicture'
import { FULLSCREEN_DOCK_HEADER_SELECTOR, useFullscreenDocks } from './opentubex/useFullscreenDocks'
import { createMobilePlayerAdjustments } from '../../helpers/mobilePlayerAdjustments'
import {
  isCapacitorMobilePlayer,
  useMobileFullscreenGestures,
} from './opentubex/useMobileFullscreenGestures'
import { useMusicVisualizer } from './opentubex/useMusicVisualizer'
import { useScrollMiniPlayer } from './opentubex/useScrollMiniPlayer'
import { useSecondaryCaptions } from './opentubex/useSecondaryCaptions'
import { useSilenceSkipping } from './opentubex/useSilenceSkipping'
import { useSleepTimer } from './opentubex/useSleepTimer'
import {
  SPONSORBLOCK_CATEGORIES,
  SPONSORBLOCK_INFO_ACTION_TYPES,
  SPONSORBLOCK_INFO_CATEGORIES,
  SPONSORBLOCK_PLAYBACK_ACTION_TYPES,
  SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS,
  useSponsorBlockPlayback,
} from './opentubex/useSponsorBlockPlayback'
import { usePlayerAudioOutput } from './opentubex/usePlayerAudioOutput'
import { useVideoZoom } from './opentubex/useVideoZoom'
import { useVoiceOverTranslation } from './opentubex/useVoiceOverTranslation'
import FtVideoAnnotations from '../FtVideoAnnotations/FtVideoAnnotations.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtAddToPlaylistDropdown from '../FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import WatchVideoChapters from '../WatchVideoChapters/WatchVideoChapters.vue'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'
import { useRootClass } from '../../helpers/rootClasses'

/** @typedef {import('../../helpers/sponsorblock').SponsorBlockCategory} SponsorBlockCategory */
/** @typedef {string | { path: string, viewBox: string }} ValueChangeIcon */

/** Seeks closer together than this, such as repeated arrow key presses, form one jump. */
const SEEK_HISTORY_JUMP_WINDOW_MS = 1000
const SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS = 150
const FULL_WINDOW_ANIMATION_DURATION_MS = 400

// The UTF-8 characters "h", "t", "t", and "p".
const HTTP_IN_HEX = 0x68747470

const USE_OVERFLOW_MENU_WIDTH_THRESHOLD = 634
const TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE = 'keyboard'
const TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE = 'pointer'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const PLAY_MORPH_PATH = 'M8 6 11.5 8.1 11.5 15.9 8 18ZM11.5 8.1 18 12 18 12 11.5 15.9Z'

// Shaka's UI element registries (Controls/OverflowMenu/ContextMenu) are
// Restore a surviving player's factories when a tab releases its controls.
// The process-global registries must not retain factories from disposed players.
const liveCustomControlPlayers = new Set()
let configuringCustomPlayerControls = false

/**
 * Shaka's own controls that the player replaces, restored once no player needs
 * the replacements, as Shaka's default layout includes them.
 * @type {Map<string, shaka.extern.IUIElement.Factory>}
 */
const defaultShakaElementFactories = new Map([
  ['captions', { create: (rootElement, controls) => new shaka.ui.TextSelection(rootElement, controls) }],
  ['quality', { create: (rootElement, controls) => new shaka.ui.ResolutionSelection(rootElement, controls) }],
])

const RequestType = shaka.net.NetworkingEngine.RequestType
const AdvancedRequestType = shaka.net.NetworkingEngine.AdvancedRequestType

if (process.env.IS_IOS) {
  shaka.net.NetworkingEngine.registerScheme('https',
    createIOSMediaTransport(shaka, registerPlugin('SabrHttp')),
    shaka.net.NetworkingEngine.PluginPriority.APPLICATION, true)
  shaka.net.NetworkingEngine.registerScheme('capacitor', shaka.net.HttpFetchPlugin.parse,
    shaka.net.NetworkingEngine.PluginPriority.APPLICATION, true)
}
const TrackLabelFormat = shaka.ui.Overlay.TrackLabelFormat
const CaptionPositionArea = shaka.config.PositionArea
const { Severity: ErrorSeverity, Category: ErrorCategory, Code: ErrorCode } = shaka.util.Error

const CAPTION_POSITION_AREAS = Object.freeze({
  'top-left': CaptionPositionArea.TOP_LEFT,
  'top-center': CaptionPositionArea.TOP_CENTER,
  'top-right': CaptionPositionArea.TOP_RIGHT,
  'bottom-left': CaptionPositionArea.BOTTOM_LEFT,
  'bottom-center': CaptionPositionArea.BOTTOM_CENTER,
  'bottom-right': CaptionPositionArea.BOTTOM_RIGHT,
})

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
    LightsOffOverlay,
    FtPaidPromotionBadge,
    FtRetryImage,
    FtSelect,
    FtMobileSheet,
    SponsorBlockSegmentEditor,
    FtShareButton,
    FtIconButton,
    FtAddToPlaylistDropdown,
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
    twitchSubOnlyVod: {
      type: Boolean,
      default: false
    },
    /**
     * Which engine provided the streams, as yt-dlp's manifests need a few
     * accommodations that must not change the behaviour for the built-in one.
     * @type {import('vue').PropType<'built-in' | 'yt-dlp'>}
     */
    playbackEngine: {
      type: String,
      default: 'built-in'
    },
    sabrData: {
      type: Object,
      default: null
    },
    legacyFormats: {
      type: Array,
      default: () => ([])
    },
    playbackSourceKey: {
      type: Number,
      default: 0
    },
    offline: {
      type: Boolean,
      default: false
    },
    localFilePlayback: {
      type: Boolean,
      default: false
    },
    startTime: {
      type: Number,
      default: null
    },
    captions: {
      type: Array,
      default: () => ([])
    },
    captionTranslations: {
      type: Array,
      default: () => ([])
    },
    chapters: {
      type: Array,
      default: () => ([])
    },
    popularityMarkers: {
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
    endScreenRecommendations: {
      type: Array,
      default: () => []
    },
    hideAnnotations: {
      type: Boolean,
      default: false
    },
    videoId: {
      type: String,
      default: ''
    },
    externalUrl: {
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
    channelName: {
      type: String,
      default: ''
    },
    channelThumbnail: {
      type: String,
      default: ''
    },
    artist: {
      type: String,
      default: ''
    },
    musicMediaType: {
      type: String,
      default: MUSIC_MEDIA_TYPE.UNKNOWN,
      validator: value => Object.values(MUSIC_MEDIA_TYPE).includes(value)
    },
    thumbnail: {
      type: String,
      default: ''
    },
    shortsPlayer: {
      type: Boolean,
      default: false
    },
    shortsPhonePanels: {
      type: Boolean,
      default: false
    },
    shortsMetadataOpen: {
      type: Boolean,
      default: false
    },
    shortsAspectRatio: {
      type: Number,
      default: null
    },
    videoAspectRatio: {
      type: Number,
      default: null
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
    autoplayRequested: {
      type: Boolean,
      default: false
    },
    autoplayCountdown: {
      type: Object,
      default: null
    },
    autoOpenChapters: {
      type: Boolean,
      default: false
    },
    sidebarChaptersOpen: {
      type: Boolean,
      default: false
    },
    watchingPlaylist: {
      type: Boolean,
      default: false
    },
    canSkipNext: {
      type: Boolean,
      default: false
    },
    canSkipPrevious: {
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
    autoPictureInPictureState: {
      type: Object,
      default: null
    },
    /** @type {import('vue').PropType<import('./opentubex/dockedPanels').DockedPanel[]>} */
    startWithDockedPanels: {
      type: Array,
      default: () => []
    },
    queueAvailable: { type: Boolean, default: false },
    recommendationsAvailable: { type: Boolean, default: false },
    downloadAvailable: { type: Boolean, default: false },
    channelId: {
      type: String,
      default: ''
    },
    playlistVideoData: {
      type: Object,
      default: null
    },
    published: {
      type: Number,
      default: 0
    },
    isLive: {
      type: Boolean,
      default: false
    },
    isLiveDvrEnabled: {
      type: Boolean,
      default: null
    },
    isUpcoming: {
      type: Boolean,
      default: false
    },
    transcriptOpen: {
      type: Boolean,
      default: false
    },
    sponsorBlockInfoOpen: {
      type: Boolean,
      default: false
    },
    videoIsMusic: {
      type: Boolean,
      default: false
    },
    currentPlaybackRate: {
      type: Number,
      default: 1
    },
    currentVideoQuality: {
      type: String,
      default: null
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
    liveChatAvailable: {
      type: Boolean,
      default: false
    },
    quickBookmarkEnabled: {
      type: Boolean,
      default: false
    },
    quickBookmarked: {
      type: Boolean,
      default: false
    },
    quickBookmarkTitle: {
      type: String,
      default: ''
    },
    quickBookmarkIcon: {
      type: [Array, Object],
      default: () => ['fas', 'bookmark']
    },
    paidPromotion: {
      type: Boolean,
      default: false
    },
    paidPromotionDurationMs: {
      type: Number,
      default: 10000
    },
    resumePlaybackAfterSabrReload: {
      type: Boolean,
      default: false
    },
    suppressAutoplayAfterSabrReload: {
      type: Boolean,
      default: false
    },
    sabrReloadState: {
      type: Object,
      default: null
    },
    streamRecoveryNotice: {
      type: String,
      default: null
    },
    pauseForStreamRecovery: {
      type: Boolean,
      default: false
    },
  },
  emits: [
    'error',
    'loaded',
    'ended',
    'play',
    'playing',
    'pause',
    'waiting',
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
    'legacy-format-selected',
    'subtitles-state-updated',
    'subtitles-state-user-set',
    'volume-updated',
    'volume-user-set',
    'skip-to-next',
    'skip-to-prev',
    'player-reload-requested',
    'resume-playback-after-sabr-reload-done',
    'stream-recovery-notice-dismiss',
    'dock-panel-change',
    'open-download',
    'toggle-transcript',
    'toggle-quick-bookmark',
    'chapters-overlay-change',
    'chapter-thumbnails-change',
    'sponsorblock-info-change',
    'toggle-shorts-metadata',
    'open-phone-panel',
    'seeking',
    'seeked',
  ],
  setup: function (props, { emit, expose }) {
    const { locale, t } = useI18n()
    const hardwareKeyboardAttached = inject('hardwareKeyboardAttached', ref(!process.env.IS_CAPACITOR))
    // Panels over the video stop clicks so the player ignores them, which also
    // hides them from the document link handler. Run that handler there instead.
    const handleDocumentClick = inject('handleDocumentClick')
    const { tabId, isTabPresented } = useTabContext()
    const shortsNavigationSuspended = ref(false)
    let suspendedShortsError = null
    let suspendedShortsSabrReload = null
    const playerIsPresented = computed(() => !shortsNavigationSuspended.value && (isTabPresented?.value ?? true))
    const mediaTabId = tabId ?? 'web'
    // A tab can hold a retained mini player next to another player.
    const mediaSessionSource = `player-${useId()}`
    const lightsOff = computed(() => store.getters.getTabLightsOff(mediaTabId))
    const musicMode = computed(() => store.getters.getTabMusicMode(mediaTabId))
    const showMusicModeToggle = computed(() => store.getters.getShowMusicModeToggle)
    const showLightsOffToggle = computed(() => store.getters.getShowLightsOffToggle)
    // Mono audio needs Web Audio processing, which the player does not use on iOS.
    const showMonoAudioToggle = computed(() => !process.env.IS_IOS && store.getters.getShowMonoAudioToggle)
    const lightsOffVisible = computed(() => showLightsOffToggle.value && lightsOff.value &&
      (isTabPresented?.value ?? true))
    // Shorts request autoplay, so do not render their paused-only controls
    // while the media element is still preparing its first `play` event.
    const shortsPaused = ref(false)
    const playbackEnded = ref(false)
    /** @type {number | null} */
    let endSeekTarget = null
    const autoplayCanceled = ref(false)
    const shortsMuted = ref(false)
    const shortsCaptionsAvailable = ref(false)
    const shortsCaptionsEnabled = ref(false)
    const showEndedScreen = computed(() => playbackEnded.value &&
      (!props.autoplayEnabled || autoplayCanceled.value) &&
      !props.autoplayCountdown && !props.shortsPlayer && !audioPlayerMode.value)
    const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
    const originalEndedTitles = ref({})
    const preferOriginalRecommendationTitles = computed(() => store.getters.getAvoidTranslation === 'entire_app')
    watch(
      [showEndedScreen, () => props.endScreenRecommendations, preferOriginalRecommendationTitles],
      ([visible, recommendations, preferOriginal], _previous, onCleanup) => {
        originalEndedTitles.value = {}
        if (!visible || !preferOriginal) return

        let active = true
        onCleanup(() => { active = false })
        for (const { videoId } of recommendations) {
          const cachedTitle = getCachedOembedTitle(videoId)
          if (cachedTitle !== null) {
            originalEndedTitles.value[videoId] = cachedTitle
          } else {
            getOembedTitle(videoId).then(title => {
              if (active && title) originalEndedTitles.value[videoId] = title
            })
          }
        }
      }
    )
    const endedRecommendations = computed(() => props.endScreenRecommendations.map(video => ({
      ...video,
      title: preferOriginalRecommendationTitles.value
        ? originalEndedTitles.value[video.videoId] ?? video.title
        : video.title,
      thumbnail: getRecommendationThumbnail(video.videoId)
    })))
    const showPoster = ref(true)
    const showPaidPromotion = ref(false)
    let paidPromotionTimer = null

    function resetPaidPromotion() {
      clearTimeout(paidPromotionTimer)
      paidPromotionTimer = null
      showPaidPromotion.value = props.paidPromotion && !props.shortsPlayer
    }

    function startPaidPromotionTimer() {
      if (!showPaidPromotion.value || paidPromotionTimer !== null) {
        return
      }

      paidPromotionTimer = setTimeout(() => {
        showPaidPromotion.value = false
        paidPromotionTimer = null
      }, props.paidPromotionDurationMs)
    }

    const autoplayNextVideo = computed(() => props.autoplayCountdown?.video ?? null)
    const autoplayThumbnail = computed(() => getRecommendationThumbnail(autoplayNextVideo.value?.videoId))

    function getRecommendationThumbnail(videoId) {
      if (!videoId) {
        return thumbnailPlaceholder
      }

      return getVideoThumbnailUrl(
        videoId,
        store.getters.getBackendPreference,
        store.getters.getCurrentInvidiousInstanceUrl,
        store.getters.getThumbnailPreference
      ) ?? thumbnailPlaceholder
    }
    const autoplayDuration = computed(() => {
      const lengthSeconds = Number(autoplayNextVideo.value?.lengthSeconds)
      return Number.isFinite(lengthSeconds) && lengthSeconds > 0
        ? formatDurationAsTimestamp(lengthSeconds)
        : ''
    })

    function cancelAutoplayCountdown() {
      autoplayCanceled.value = true
      emit('autoplay-cancel')
    }

    function playAutoplayVideoNow() {
      emit('autoplay-play-now')
    }

    /** @type {shaka.Player|null} */
    let player = null

    /** The video streams that automatic quality chooses from, see AutoQualityAbrManager */
    let autoQualityVideoIds = new Set()

    /** @type {shaka.ui.Overlay|null} */
    let ui = null
    const seekBarTooltipLabels = new WeakMap()
    const hidePopularityGraph = computed(() => store.getters.getHidePopularityGraph)
    let iosFullscreenCleanup = null
    let androidFullscreenCleanup = null
    let androidFullscreenEntering = false
    let iosCaptionsCleanup = null
    let nativeCaptionTiming = null
    /** @type {shaka.extern.TextDisplayer | null} */
    let captionTextDisplayer = null
    let screenWakeBinding = null

    // Set when a UI reconfigure is requested while the player is not loaded, so
    // it can be flushed once loading finishes (see configureUI).
    let pendingUiReconfigure = false
    // Serialized uiConfig last passed to ui.configure. Every configure rebuilds
    // all controls, so unchanged configurations are not applied again.
    let appliedUiConfigKey = ''

    // Whether this instance registered its custom control factories into the
    // shared global registry, so teardown removes this player's registrations
    // exactly once (see cleanUpCustomPlayerControls).
    let registeredCustomControls = false

    const events = new EventTarget()

    /** @type {import('vue').Ref<HTMLDivElement | null>} */
    const container = ref(null)
    const mobileMiniBarOverlay = ref(null)

    /** @type {import('vue').Ref<HTMLVideoElement | null>} */
    const video = ref(null)

    const sleepTimer = useSleepTimer({
      getVideoId: () => props.videoId || props.externalUrl,
      getCurrentTime: () => video.value?.currentTime ?? 0,
      getPlaybackRate: () => video.value?.playbackRate ?? 1,
      isPaused: () => video.value?.paused ?? true,
      isSeeking: () => video.value?.seeking ?? false,
      onExpired: () => showToast({ message: t('Video.Player.Sleep Timer.Timer ended'), icon: ['fas', 'clock'] }),
      pausePlayback: () => video.value?.pause(),
      seekTo: seconds => { if (video.value) setCurrentTime(seconds) },
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
    const pictureInPictureActive = ref(false)
    const mobileAdjustmentsVisible = ref(!isAppHidden())
    const androidFullscreenHostActive = ref(false)
    let androidFullscreenHost = null
    const playerPaused = ref(true)
    const pausedInterfaceRevealed = ref(false)
    const shakaControlsShown = ref(false)
    const isSubMenuOpened = ref(false)
    const actionDockFocused = ref(false)
    /** @type {import('vue').Ref<HTMLElement|null>} */
    const fullscreenActionsElement = ref(null)
    /** @type {import('vue').Ref<HTMLElement|null>} */
    const fullscreenActionsContent = ref(null)
    const fullscreenActionsBlockSize = ref(50)
    /** @type {import('vue').Ref<HTMLElement|null>} */
    const sponsorBlockNoticesElement = ref(null)
    const sponsorBlockNoticeSize = ref({ inline: 0, block: 0 })
    watch(sponsorBlockNoticesElement, (element, _previous, onCleanup) => {
      if (!element) {
        sponsorBlockNoticeSize.value = { inline: 0, block: 0 }
        return
      }
      const observer = new ResizeObserver(entries => {
        const size = entries[0].borderBoxSize[0]
        sponsorBlockNoticeSize.value = { inline: size.inlineSize, block: size.blockSize }
      })
      observer.observe(element)
      onCleanup(() => observer.disconnect())
    })
    watch(fullscreenActionsElement, (element, _previous, onCleanup) => {
      if (!element) return
      const observer = new ResizeObserver(entries => {
        fullscreenActionsBlockSize.value = entries[0].borderBoxSize[0].blockSize
      })
      observer.observe(element)
      onCleanup(() => observer.disconnect())
    })
    watch(fullscreenActionsContent, (content, _previous, onCleanup) => {
      const scroller = fullscreenActionsElement.value
      if (!content || !scroller) return
      const observer = new ResizeObserver(() => clampOverlayScrollTop(scroller, content))
      observer.observe(content)
      observer.observe(scroller)
      onCleanup(() => observer.disconnect())
    }, { flush: 'post' })
    /** @type {number|null} */
    let pausedInterfaceRevealTimeout = null

    const showPlayerControlsWhenPaused = computed(() => store.getters.getShowPlayerControlsWhenPaused)
    const useFrostedGlassPlayerUi = computed(() => store.getters.getUseFrostedGlassPlayerUi)
    const showVideoTitleWhenPaused = computed(() => store.getters.getShowVideoTitleWhenPaused)
    const showFullscreenActionsWhenPaused = computed(() => store.getters.getShowFullscreenActionsWhenPaused)
    const playingInterfaceHideDelay = computed(() => store.getters.getPlayingInterfaceHideDelay)
    const pausedInterfaceHideDelay = computed(() => store.getters.getPausedInterfaceHideDelay)
    const playerControlsShown = computed(() => (
      shakaControlsShown.value &&
      (
        !playerPaused.value ||
        showPlayerControlsWhenPaused.value ||
        pausedInterfaceRevealed.value ||
        (!isFullscreen.value && !fullWindowEnabled.value)
      )
    ))
    const actionDockVisible = computed(() => (
      visibleFullscreenActions.value.length > 0 &&
      !isSubMenuOpened.value &&
      (
        actionDockFocused.value || (
          (shakaControlsShown.value || props.shortsPlayer) &&
          (!playerPaused.value || showFullscreenActionsWhenPaused.value || pausedInterfaceRevealed.value)
        )
      )
    ))
    function clearPausedInterfaceReveal() {
      if (pausedInterfaceRevealTimeout !== null) {
        clearTimeout(pausedInterfaceRevealTimeout)
        pausedInterfaceRevealTimeout = null
      }

      pausedInterfaceRevealed.value = false
    }

    function revealPausedInterface() {
      if (!playerPaused.value || (!isFullscreen.value && !fullWindowEnabled.value)) {
        return
      }

      pausedInterfaceRevealed.value = true

      if (pausedInterfaceRevealTimeout !== null) {
        clearTimeout(pausedInterfaceRevealTimeout)
      }

      pausedInterfaceRevealTimeout = window.setTimeout(() => {
        pausedInterfaceRevealTimeout = null
        pausedInterfaceRevealed.value = false
      }, pausedInterfaceHideDelay.value * 1000)
    }

    onUnmounted(clearPausedInterfaceReveal)

    // While switching presentation mode (fullscreen/full window) the side
    // panel transitions would run on top of the container resize and produce
    // odd combined motion, so they are suppressed for the switch duration.
    const presentationModeChanging = ref(false)
    /** @type {number|null} */
    let presentationModeChangingTimeout = null
    /** @type {HTMLElement|null} */
    let fullscreenTitleOverlay = null

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
    const fullscreenMetadataOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenMetadataTarget = ref(null)
    const showFullscreenMetadata = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenTranscriptOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenTranscriptTarget = ref(null)
    const showFullscreenTranscript = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenSponsorBlockOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenSponsorBlockTarget = ref(null)
    const showFullscreenSponsorBlock = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenCommentsOverlay = ref(null)
    const showFullscreenComments = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenLiveChatOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenLiveChatTarget = ref(null)
    const showFullscreenLiveChat = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenPlaylistOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenPlaylistTarget = ref(null)
    const showFullscreenPlaylist = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenQueueOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenQueueTarget = ref(null)
    const showFullscreenQueue = ref(false)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenRecommendationsOverlay = ref(null)
    /** @type {import('vue').Ref<HTMLElement | null>} */
    const fullscreenRecommendationsTarget = ref(null)
    const showFullscreenRecommendations = ref(false)
    const fullscreenDockOpen = computed(() => {
      return showFullscreenMetadata.value || showFullscreenTranscript.value ||
        showFullscreenSponsorBlock.value || showFullscreenComments.value ||
        showFullscreenLiveChat.value || showFullscreenPlaylist.value ||
        showFullscreenQueue.value || showFullscreenRecommendations.value ||
        (showChaptersOverlay.value && props.chapters.length > 0)
    })
    const {
      expandCollapsedFullscreenDock,
      fullscreenDockCanReorder,
      fullscreenDockCanResize,
      fullscreenDockLayoutOpen,
      fullscreenDockOrder,
      fullscreenDockReordering,
      fullscreenDockResizing,
      fullscreenDockStyle,
      handleFullscreenDockHeaderDoubleClick,
      handleFullscreenDockReorderPointerDown,
      handleFullscreenDockResizeKeydown,
      handleFullscreenDockResizePointerDown,
      resetFullscreenDockHeights,
    } = useFullscreenDocks({
      container,
      video,
      fullscreenDockOpen,
      isFullscreenDockOpen,
      isFullscreen,
      isFullWindow: () => fullWindowEnabled.value,
      isPortraitLayout: () => portraitFullscreenDocks.value,
      presentationModeChanging,
    })
    const chapterThumbnails = ref([])
    const currentChapterTitle = computed(() => {
      return props.chapters[props.currentChapterIndex]?.title ?? t('Chapters.Chapters')
    })
    const chaptersAvailable = computed(() => props.chapters.length > 0)
    // Chapter thumbnails download storyboard sheets, so they are only loaded
    // once a chapter list has been opened for the current video.
    let chapterThumbnailsWanted = false
    const shareablePlaylistId = computed(() => {
      return props.playlistId && store.getters.getPlaylist(props.playlistId) == null
        ? props.playlistId
        : ''
    })
    const showFullscreenShareAction = computed(() => !store.getters.getHideSharingActions)
    const showFullscreenPlaylistAction = computed(() => !store.getters.getHidePlaylists)
    const visibleFullscreenActions = computed(() => getAvailableFullscreenActions(store.getters.getFullscreenActions, {
      queue: props.queueAvailable,
      download: props.downloadAvailable,
      recommendations: props.recommendationsAvailable,
      playlist: props.watchingPlaylist,
      liveChat: props.liveChatAvailable,
      comments: props.commentsAvailable,
      sponsorBlock: useSponsorBlock.value && !props.isUpcoming,
      transcript: props.captions.length > 0 && !isLive.value && !props.isUpcoming,
      share: showFullscreenShareAction.value,
      addToPlaylist: showFullscreenPlaylistAction.value && props.playlistVideoData != null,
      quickBookmark: props.quickBookmarkEnabled,
    }))
    const isInAnyPlaylist = computed(() => store.getters.getPlaylistVideoCounts.has(props.videoId))

    function isFullscreenDockOpen(dock) {
      switch (dock) {
        case 'metadata': return showFullscreenMetadata.value
        case 'transcript': return showFullscreenTranscript.value
        case 'sponsorBlock': return showFullscreenSponsorBlock.value
        case 'comments': return showFullscreenComments.value
        case 'liveChat': return showFullscreenLiveChat.value
        case 'queue': return showFullscreenQueue.value
        case 'recommendations': return showFullscreenRecommendations.value
        case 'playlist': return showFullscreenPlaylist.value
        case 'chapters': return showChaptersOverlay.value && props.chapters.length > 0
        default: return false
      }
    }

    function getShareTimestamp() {
      const currentTime = Math.floor(video.value?.currentTime ?? 0)
      return Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
    }

    function openDownload() {
      if (props.downloadAvailable) emit('open-download')
    }

    function toggleQuickBookmark() {
      emit('toggle-quick-bookmark')
    }

    const hasLoaded = ref(false)
    const hasPlaybackPosition = ref(false)
    /** @type {number|null} */
    let pendingMetadataSeek = null
    let seekBarMouseDown = false
    let resumeAutoplayAfterSeek = false
    let initialAutoplayCanceled = false
    const videoLayoutReady = ref(false)
    const annotationCurrentTime = ref(0)
    const annotationVideoAspectRatio = ref(null)

    const hasMultipleAudioTracks = ref(false)
    const isLive = ref(props.isLive)

    const useVoiceOverTranslationSetting = computed(() => {
      return store.getters.getUseVoiceOverTranslation
    })
    const voiceOverTranslationLanguage = computed(() => {
      const language = store.getters.getVoiceOverTranslationLanguage
      return ['ru', 'en', 'kk'].includes(language) ? language : 'en'
    })
    const voiceOverTranslationVolume = computed(() => {
      const volume = Number(store.getters.getVoiceOverTranslationVolume) / 100
      return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
    })
    const voiceOverTranslationOriginalVolume = computed(() => {
      const volume = Number(store.getters.getVoiceOverTranslationOriginalVolume) / 100
      return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.1
    })
    const voiceOverTranslationAvailable = computed(() => {
      return !props.offline && supportsVoiceOverTranslation &&
        useVoiceOverTranslationSetting.value &&
        props.videoId !== '' &&
        !isLive.value
    })
    const voiceOverTranslationAutoPrepare = computed(() => {
      return voiceOverTranslationAvailable.value &&
        store.getters.getVoiceOverTranslationPrepareInBackground
    })
    const playerAudioOutput = usePlayerAudioOutput(video)
    const voiceOverTranslation = useVoiceOverTranslation({
      video,
      videoId: computed(() => props.videoId),
      responseLanguage: voiceOverTranslationLanguage,
      autoPrepare: voiceOverTranslationAutoPrepare,
      originalVolume: voiceOverTranslationOriginalVolume,
      voiceVolume: voiceOverTranslationVolume,
      setOutputGain: value => playerAudioOutput.setGain('voiceOver', value),
      onError: error => {
        const message = error instanceof RangeError
          ? t('Video.Player.Voice-over Translation.Duration Error')
          : t('Video.Player.Voice-over Translation.Error')
        console.error('Voice-over translation failed', error)
        showToast({ message, icon: ['fas', 'circle-exclamation'] })
      }
    })

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

    const captionSources = new WeakMap()

    /**
     * Subtitle files the user loaded for this video, added again whenever the player reloads it.
     * @type {import('vue').ShallowRef<{ url: string, label: string, language: string, mimeType: string }[]>}
     */
    const localCaptions = shallowRef(props.sabrReloadState?.localCaptions ?? [])

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
    const portraitLayout = usePhoneLayout('(orientation: portrait)')
    const portraitFullscreenDocks = computed(() => portraitLayout.value && (isFullscreen.value || fullWindowEnabled.value))
    const fullscreenDockTitles = computed(() => ({
      metadata: t('Video.Metadata'),
      transcript: t('Video.Transcript.Title'),
      sponsorBlock: t('Settings.SponsorBlock Settings.SponsorBlock Settings'),
      liveChat: t('Video.Live Chat'),
      comments: t('Comments.Comments'),
      queue: t('Video.Queue'),
      playlist: t('Playlist.Playlist'),
      recommendations: t('Settings.Fullscreen Actions.Recommended Videos'),
      chapters: t('Chapters.Chapters'),
    }))
    const activePortraitDock = ref(null)
    const fullscreenDockTitle = computed(() => activePortraitDock.value
      ? fullscreenDockTitles.value[activePortraitDock.value]
      : '')
    const fullscreenDockClosers = {
      metadata: closeFullscreenMetadata,
      transcript: closeFullscreenTranscript,
      sponsorBlock: closeFullscreenSponsorBlock,
      liveChat: closeFullscreenLiveChat,
      comments: closeFullscreenComments,
      queue: closeFullscreenQueue,
      playlist: closeFullscreenPlaylist,
      recommendations: closeFullscreenRecommendations,
      chapters: closeChaptersOverlay,
    }
    function closePortraitFullscreenDock() {
      if (activePortraitDock.value) fullscreenDockClosers[activePortraitDock.value]()
    }
    watch(() => [portraitFullscreenDocks.value, ...fullscreenDockOrder.filter(isFullscreenDockOpen)], ([portrait, ...open], previous = []) => {
      if (!portrait) return
      const newlyOpened = open.find(dock => !previous.slice(1).includes(dock))
      activePortraitDock.value = newlyOpened ?? (open.includes(activePortraitDock.value) ? activePortraitDock.value : open[0]) ?? null
      for (const dock of open) {
        if (dock !== activePortraitDock.value) fullscreenDockClosers[dock]()
      }
    })
    watch(activePortraitDock, async dock => {
      if (!dock) return
      await nextTick()
      if (portraitFullscreenDocks.value && activePortraitDock.value === dock) {
        const overlay = dock === 'chapters'
          ? chapterOverlay.value
          : container.value?.querySelector('.fullscreenDockSheet > .open')
        overlay?.focus({ preventScroll: true })
      }
    })
    const annotationVideoFit = computed(() => {
      return props.shortsPlayer && !isFullscreen.value && !fullWindowEnabled.value
        ? 'cover'
        : 'contain'
    })
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
    const dockedPanelMemory = createDockedPanelMemory(props.startWithDockedPanels)
    let exitFullscreenCleanup = null
    let syncingChapterOverlayButton = false

    /**
     * The subtitles state that was saved for this video's channel, if there is one.
     * @returns {boolean | null}
     */
    function getSavedChannelSubtitlesState() {
      if (!store.getters.getEnableChannelSettings || props.channelId === '') {
        return null
      }

      const value = parseChannelPreferences(
        store.getters.getChannelSubtitlesStates,
        'channelSubtitlesStates'
      )[props.channelId]

      return typeof value === 'boolean' ? value : null
    }

    /** @type {number|null} */
    let restoreCaptionIndex = props.sabrReloadState?.captionIndex ?? null

    // The channel's subtitles state is more specific than the global default, so it wins
    const enableSubtitlesInitially = getSavedChannelSubtitlesState() ?? store.getters.getEnableSubtitlesByDefault

    // Caption tracks are added in parallel, so Shaka's track order can differ from props.captions.
    // Remember the caption itself to find its track once they are loaded.
    let initialCaption = null

    if (restoreCaptionIndex === null && enableSubtitlesInitially && props.captions.length > 0) {
      initialCaption = getCaptionToEnable()
      restoreCaptionIndex = initialCaption ? props.captions.indexOf(initialCaption) : 0
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

    const isCrossTabMiniPlayerPresented = ref(false)

    const {
      getAutoPictureInPictureState,
      initializeActiveTab,
      isActiveTab,
      notifyPictureInPictureState,
      restorePictureInPicture,
      setupAutoPictureInPicture,
      teardownAutoPictureInPicture,
      updateAutoPip,
    } = useAutoPictureInPicture({
      getUi: () => ui,
      props,
      video,
      tabId,
      isTabPresented: playerIsPresented,
      isCrossTabMiniPlayerPresented,
      isPictureInPictureRestorePending: () => startInPip,
      initialState: props.autoPictureInPictureState,
    })

    // Capture the replacement player's initial state. The parent clears its
    // pending SABR state after this player loads, but that must not add autoplay
    // to the same media element afterward.
    // A replacement player created by stream-failure recovery waits paused
    // until the user has read the recovery notice.
    const suppressInitialAutoplay = props.suppressAutoplayAfterSabrReload || props.pauseForStreamRecovery
    // Queue requests can arrive for a replacement player or an in-place source
    // switch. Keep autoplay armed until playback starts, even if Watch has
    // already consumed the loaded request.
    const autoplayRequested = ref(props.autoplayRequested)
    watch(() => props.autoplayRequested, requested => {
      if (requested) autoplayRequested.value = true
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoplayVideos = computed(() => {
      return (autoplayRequested.value || (!suppressInitialAutoplay && store.getters.getAutoplayVideos)) && isActiveTab.value
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const loopShorts = computed(() => {
      return store.getters.getLoopShorts
    })

    watch(isActiveTab, (active) => {
      if (active) {
        nextTick(() => {
          applyPendingPresentationModes()
          remeasureControlPanelWidth()
          syncAndroidStatusBarVisibility()
        })
      } else {
        cancelControlPanelLayout()
        handleTemporaryPlaybackRateFocusLoss()
        syncAndroidStatusBarVisibility()
      }
    })

    // Keep the theatre mode button's icon/label in sync when theatre mode is
    // toggled programmatically (e.g. a side panel opening forces the default
    // theatre mode), not just when the user clicks the button itself.
    watch(() => props.useTheatreMode, (value) => {
      events.dispatchEvent(new CustomEvent('syncTheatreMode', { detail: value }))
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const displayVideoPlayButton = computed(() => {
      return store.getters.getDisplayVideoPlayButton
    })

    const ambientMode = computed(() => {
      return store.getters.getAmbientMode
    })

    const musicAudioTrack = computed(() => {
      return props.musicMediaType === MUSIC_MEDIA_TYPE.AUDIO_TRACK
    })

    const audioPlayerMode = computed(() => {
      return props.format === 'audio' || musicAudioTrack.value
    })

    const musicVisualizer = computed(() => {
      return store.getters.getMusicVisualizer
    })

    const musicVisualizerEnabled = computed(() => {
      return audioPlayerMode.value && musicVisualizer.value
    })

    function hideBrokenMusicImage(event) {
      if (event.currentTarget instanceof HTMLImageElement) {
        event.currentTarget.hidden = true
      }
    }

    function showMusicImage(event) {
      if (event.currentTarget instanceof HTMLImageElement) {
        event.currentTarget.hidden = false
      }
    }

    const skipSilence = computed(() => {
      // WebKit media-source audio produces zero analysis samples on iOS.
      return !process.env.IS_IOS && store.getters.getTabSkipSilence(mediaTabId)
    })

    const showSkipSilenceButton = computed(() => {
      return !process.env.IS_IOS && store.getters.getShowSkipSilenceButton
    })

    const silenceSkipping = useSilenceSkipping({
      setCurrentTime,
      enabled: skipSilence,
      isLive,
      video,
    })

    /** @type {shaka.extern.RequestFilter} */
    function silenceSkippingRequestFilter(type, _request, context) {
      if (type === RequestType.SEGMENT) {
        silenceSkipping.handleSegmentRequest(context)
      }
    }

    /** @type {shaka.extern.ResponseFilter} */
    function silenceSkippingResponseFilter(type, response, context) {
      if (type === RequestType.SEGMENT) {
        silenceSkipping.handleSegmentResponse(response, context)
      }
    }

    /** @type {shaka.extern.ResponseFilter} */
    function webmProjectionResponseFilter(type, response) {
      if (type === RequestType.SEGMENT && response.data) voidWebmProjection(response.data)
    }

    /** @type {shaka.extern.ResponseFilter} */
    function twitchSubOnlyVodResponseFilter(type, response, context) {
      if (type !== RequestType.MANIFEST || context?.type !== AdvancedRequestType.MEDIA_PLAYLIST) return
      const manifest = new TextDecoder().decode(response.data)
      const patched = manifest.replaceAll('-unmuted', '-muted')
      if (patched !== manifest) response.data = new TextEncoder().encode(patched).buffer
    }

    const captionSettings = computed(() => parseCaptionSettings(store.getters.getDefaultCaptionSettings))
    const captionCssVariables = computed(() => getCaptionCssVariables(captionSettings.value))
    const captionPositionArea = computed(() => CAPTION_POSITION_AREAS[captionSettings.value.anchor])
    // Timing belongs to the current video, rather than the saved appearance settings.
    let captionTimingOffset = props.sabrReloadState?.captionTimingOffset ?? 0

    const {
      getSecondaryCaption,
      isShownAsMainCaption,
      restoreSecondaryCaption,
      secondaryCaptionsAtTop,
      secondaryCaptionsBox,
      secondaryCaptionText,
      selectSecondaryCaption,
      updateSecondaryCaptionText,
    } = useSecondaryCaptions({
      captionSettings,
      container,
      getCaptionTimingOffset: () => captionTimingOffset,
      getPlayer: () => player,
      props,
      video,
    })

    function updateCaptionTiming(offset) {
      if (!Number.isFinite(offset)) return
      captionTimingOffset = offset
      applyCaptionTiming()
      updateSecondaryCaptionText()
      events.dispatchEvent(new Event('captionTimingChanged'))
    }

    function usesNativeCaptionTracks() {
      return player?.getLoadMode() === shaka.Player.LoadMode.SRC_EQUALS
    }

    function applyCaptionTiming() {
      player?.configure('textDisplayer.subtitleDelay', usesNativeCaptionTracks() ? 0 : captionTimingOffset)
      nativeCaptionTiming?.update()
    }

    watch([() => props.videoId, () => props.externalUrl], () => updateCaptionTiming(0))
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

    watch(captionPositionArea, positionArea => {
      player?.configure('textDisplayer.positionArea', positionArea)
    })

    onUnmounted(() => {
      clearTimeout(captionAppearanceSampleTimeout)
    })

    /** @param {boolean} value */
    function updateAmbientMode(value) {
      store.dispatch('updateAmbientMode', value)
    }

    /** @param {boolean} value */
    function updateMusicVisualizer(value) {
      store.dispatch('updateMusicVisualizer', value)
    }

    /** @param {boolean} value */
    function updateSkipSilence(value) {
      return store.dispatch('updateTabSkipSilence', {
        tabId: mediaTabId,
        value
      })
    }

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
      configurePlayerControls(() => ui.configure({
        tapSeekDistance: newValue
      }))
    })

    watch(showPlaybackRateAdjustedTimestamp, () => {
      events.dispatchEvent(new CustomEvent('timeDisplaySettingsChanged'))
    })

    /**
     * The numeric quality to start with. Auto is handled separately by
     * `preferAutoQuality`, so that the quality selection code paths, which all
     * work with resolutions, keep a usable value to fall back to.
     * @type {import('vue').ComputedRef<number>}
     */
    const defaultQuality = computed(() => {
      const value = store.getters.getDefaultQuality

      return parseInt(limitQualityOnMeteredNetwork(
        value === 'auto' ? AUTO_QUALITY_FALLBACK : value,
        store.getters.getMeteredNetworkQualityLimit
      ))
    })

    /** @type {import('vue').ComputedRef<number>} */
    const preferredVideoQuality = computed(() => {
      const value = Number.parseInt(props.currentVideoQuality)
      return Number.isNaN(value) ? defaultQuality.value : value
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const preferAutoQuality = computed(() => {
      if (!autoQualitySupported.value) {
        return false
      }

      if (props.currentVideoQuality === 'auto') {
        return true
      }

      // Only fall back to the setting when no quality was passed in,
      // e.g. before the watch page has resolved a channel specific one
      return Number.isNaN(Number.parseInt(props.currentVideoQuality)) &&
        store.getters.getDefaultQuality === 'auto'
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const enterFullscreenOnDisplayRotate = computed(() => {
      return store.getters.getEnterFullscreenOnDisplayRotate
    })

    const rotateFullscreenToLandscape = computed(() => {
      return store.getters.getRotateFullscreenToLandscape
    })

    const fullscreenRotationIgnoresSystemLock = computed(() => store.getters.getFullscreenRotationIgnoresSystemLock)

    const fullscreenAspectRatio = computed(() => {
      if (props.format === 'audio') return null
      return getFullscreenAspectRatio(props.videoAspectRatio, props.shortsPlayer)
    })

    const enableMobileFullscreenSwipe = computed(() => {
      return store.getters.getEnableMobileFullscreenSwipe
    })

    const fullscreenOnRotationEnabled = computed(() => {
      // iOS can emit an orientation change while moving to Home. Shaka exits
      // PiP before entering fullscreen, so only allow rotation while inline.
      return (!process.env.IS_CAPACITOR || process.env.IS_IOS) && enterFullscreenOnDisplayRotate.value &&
        (!process.env.IS_IOS || (mobileAdjustmentsVisible.value && !pictureInPictureActive.value))
    })

    watch(fullscreenOnRotationEnabled, (newValue) => {
      configurePlayerControls(() => ui.configure({ enableFullscreenOnRotation: newValue }))
    }, { flush: 'sync' })

    watch([rotateFullscreenToLandscape, fullscreenAspectRatio], () => {
      if (!isNativeFullscreenActive()) return
      requestFullscreenOrientation(true)
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

    /** @type {import('vue').ComputedRef<boolean>} */
    const enableChannelSettings = computed(() => {
      return store.getters.getEnableChannelSettings
    })

    /**
     * The volume that was saved for this video's channel, if there is one.
     * @type {import('vue').ComputedRef<number | null>}
     */
    const savedChannelVolume = computed(() => {
      if (!enableChannelSettings.value || props.channelId === '') {
        return null
      }

      const value = parseChannelPreferences(store.getters.getChannelVolumes, 'channelVolumes')[props.channelId]

      return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : null
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
      if (!enableChannelSettings.value || props.channelId === '') {
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
      return enableChannelSettings.value && !autoUpdateChannelPlaybackSpeeds.value && props.channelId !== ''
    })

    const videoPlaybackRateInterval = computed(() => {
      return parseFloat(store.getters.getVideoPlaybackRateInterval)
    })

    watch([videoPlaybackRateInterval, maxVideoPlaybackRate], ([interval, maximum]) => {
      configurePlayerControls(() => ui.configure({
        playbackRateSliderMax: maximum,
        playbackRateSliderMin: interval,
        playbackRateSliderStep: interval,
        playbackRates: getPlaybackRatePresets(interval, maximum),
      }))
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const enableScreenshot = computed(() => {
      return store.getters.getEnableScreenshot
    })

    const usePlayerMenuGrid = computed(() => {
      return store.getters.getUsePlayerMenuGrid
    })

    /** @type {import('vue').ComputedRef<string>} */
    const screenshotMode = computed(() => {
      const mode = store.getters.getScreenshotMode
      return !process.env.IS_ELECTRON && !process.env.IS_CAPACITOR && mode === 'default_folder' ? 'prompt_folder' : mode
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
      return !process.env.IS_CAPACITOR && store.getters.getVideoVolumeMouseScroll
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
      return (!props.offline || sponsorBlockInfoSegments.value.length > 0) && !props.externalUrl && store.getters.getUseSponsorBlock
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const sponsorBlockShowSkippedToast = computed(() => {
      return store.getters.getSponsorBlockShowSkippedToast
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
     *   actionType?: 'skip' | 'mute' | 'full' | 'poi'
     *   startTime: number,
     *   endTime: number
     * }[]}
     */
    let sponsorBlockSegments = []
    let sponsorBlockLoadedVideoId = null
    let sponsorBlockRequestGeneration = 0
    let sponsorBlockAverageVideoDuration = 0

    /**
     * Yes a map would be much more suitable for this (unlike objects they retain the order that items were inserted),
     * but Vue 2 doesn't support reactivity on Maps, so we have to use an array instead
     * @type {import('vue').Ref<{uuid: string, translatedCategory: string, colors: string[], timeoutId: ReturnType<typeof setTimeout>|0, hideAt: number|null, hideRemainingMs: number, unskipped: boolean, countdownPaused: boolean, isHighlight: boolean, isMute: boolean, unskipTime: number|null}[]>}
     */
    const skippedSponsorBlockSegments = ref([])
    const {
      sponsorBlockSubmission,
      cancelSponsorBlockSkipSchedule,
      changeSponsorBlockInfoSegmentCategory,
      clampSponsorBlockToastEditorScroll,
      clearSponsorBlockMuteSegments,
      clearSponsorBlockNotFoundRefetchTimeout,
      closeSponsorBlockInfo,
      copyAndDownvoteSponsorBlockInfoSegment,
      dismissPromptSponsorBlockSegment,
      emitSponsorBlockInfoState,
      emitTerminalSponsorBlockOutroStarted,
      formatSponsorBlockToastCategories,
      getSponsorBlockHighlightState,
      getSponsorBlockPromptActionLabel,
      getSponsorBlockPromptLabel,
      getSponsorBlockPromptTimeLabel,
      getSponsorBlockSeekBarTooltipLabel,
      getSponsorBlockToastActionLabel,
      getSponsorBlockToastColors,
      getSponsorBlockToastLabel,
      getSponsorBlockToastTimeLabel,
      hasSponsorBlockMusicOfftopicSegment,
      isSponsorBlockToastCountdownPaused,
      pauseSponsorBlockHighlightLabelCountdown,
      pauseSponsorBlockToastCountdown,
      promptSponsorBlockSegments,
      redoSkipSponsorBlockSegment,
      refreshSponsorBlockContributionStats,
      refreshSponsorBlockInfo,
      removePromptSponsorBlockToast,
      removeSponsorBlockToast,
      resetSponsorBlockHighlightLabel,
      resetSponsorBlockPlaybackState,
      resumeSponsorBlockToastCountdown,
      scheduleSponsorBlockNotFoundRefetch,
      scheduleSponsorBlockSkip,
      skipPromptSponsorBlockSegment,
      skipSponsorBlockInfoSegment,
      skipToSponsorBlockHighlight,
      sponsorBlockContributionStatsLoaded,
      sponsorBlockContributionStatsLoading,
      sponsorBlockCurrentTime,
      sponsorBlockDismissedPromptSegments,
      sponsorBlockDoNotSkipSegments,
      sponsorBlockEnableSubmission,
      sponsorBlockInfoLoading,
      sponsorBlockInfoOpen,
      sponsorBlockInfoSegments,
      sponsorBlockMuteController,
      sponsorBlockToastEditingSegment,
      sponsorBlockToastEditingUuid,
      sponsorBlockVotePending,
      startSponsorBlockHighlightLabelCountdown,
      stopSponsorBlockToastTimer,
      syncPromptSponsorBlockSegments,
      syncSponsorBlockMuteSegments,
      syncSponsorBlockPlaybackState,
      toggleActiveSponsorBlockSkipState,
      toggleSponsorBlockInfo,
      toggleSponsorBlockToastEditing,
      unskipSponsorBlockSegment,
      updateSponsorBlockHighlightState,
      upsertSkippedSponsorBlockToast,
      voteOnSponsorBlockInfoSegment,
    } = useSponsorBlockPlayback({
      canSeek,
      cancelFullscreenSponsorBlockRestore: () => {
        dockedPanelMemory.set('sponsorBlock', false)
      },
      container,
      emit,
      events,
      getPlayer: () => player,
      getRequestGeneration: () => sponsorBlockRequestGeneration,
      getSegments: () => sponsorBlockSegments,
      getUi: () => ui,
      hardwareKeyboardAttached,
      isLive,
      locale,
      props,
      refreshSponsorBlockMarkers,
      resetAccumulatedSeek: () => {
        accumulatedSeekSeconds = 0
      },
      setAverageVideoDuration: (duration) => {
        sponsorBlockAverageVideoDuration = duration
      },
      setCurrentTime,
      setSegments: (segments) => {
        sponsorBlockSegments = segments
      },
      setupSponsorBlock,
      showOverlayControls,
      skipSponsorBlockSegments,
      skippedSponsorBlockSegments,
      sponsorBlockShowSkippedToast,
      sponsorSkips,
      t,
      useSponsorBlock,
      video,
    })
    const {
      cancelCurrentSponsorBlockDraft,
      clearSponsorBlockDrafts,
      closeSponsorBlockSubmissionMenu,
      deleteSponsorBlockDraft,
      endSponsorBlockDraft,
      getSponsorBlockSubmissionVideoDuration,
      handleSponsorBlockPreviewSkip,
      isSponsorBlockDraftEditing,
      isSponsorBlockFullVideoSegment,
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
      sponsorBlockSubmissionCategoryNames,
      getSponsorBlockActionTypeSelectNames,
      getSponsorBlockActionTypeSelectValues,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      sponsorBlockSubmissionVisibleButtons,
      startSponsorBlockDraft,
      submitSponsorBlockDrafts,
      toggleSponsorBlockDraftEditing,
      updateSponsorBlockDraftActionType,
      updateSponsorBlockDraftCategory,
      updateSponsorBlockDraftEditField,
      updateSponsorBlockSubmissionState,
    } = sponsorBlockSubmission
    const currentChapterEndSeconds = computed(() => {
      if (isLive.value) return null
      const currentTime = sponsorBlockCurrentTime.value
      const chapter = props.chapters.find(({ startSeconds, endSeconds }) =>
        startSeconds <= currentTime && currentTime < endSeconds)
      return Number.isFinite(chapter?.endSeconds) ? chapter.endSeconds : null
    })

    async function setupSponsorBlock() {
      const videoId = props.videoId
      const generation = ++sponsorBlockRequestGeneration
      const isCurrentRequest = () => generation === sponsorBlockRequestGeneration && videoId === props.videoId
      sponsorBlockLoadedVideoId = null
      let segments
      let averageDuration = 0
      let refetchWhenNotFound = false

      sponsorBlockSegments = []
      sponsorBlockAverageVideoDuration = 0
      resetSponsorBlockPlaybackState()

      sponsorBlockInfoLoading.value = true
      emitSponsorBlockInfoState()
      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(
          videoId,
          SPONSORBLOCK_INFO_CATEGORIES,
          SPONSORBLOCK_INFO_ACTION_TYPES
        ))
        if (!isCurrentRequest()) return
        sponsorBlockLoadedVideoId = videoId
        refetchWhenNotFound = segments.length === 0
      } catch (e) {
        if (!isCurrentRequest()) return
        console.error(e)
        segments = []
      } finally {
        if (isCurrentRequest()) {
          sponsorBlockInfoLoading.value = false
          emitSponsorBlockInfoState()
        }
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
          return SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType) && sponsorSkips.value.seekBar.includes(segment.category)
        })
        sponsorBlockAverageVideoDuration = averageDuration
        hasSponsorBlockMusicOfftopicSegment.value = segments.some(segment => segment.category === 'music_offtopic')
      } else if (refetchWhenNotFound) {
        scheduleSponsorBlockNotFoundRefetch()
      }

      emitSponsorBlockInfoState()

      refreshSponsorBlockMarkers()
      syncSponsorBlockPlaybackState()
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
      for (const [uuid, range] of sponsorBlockDoNotSkipSegments) {
        const segment = sponsorBlockSegments.find(seg => seg.uuid === uuid)
        if (segment && !isSponsorBlockPointSegment(segment) &&
          (currentTime < range.startTime - SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS || currentTime >= range.endTime)) {
          sponsorBlockDoNotSkipSegments.delete(uuid)
          removeSponsorBlockToast(uuid)
        }
      }

      const video_ = video.value

      let newTime = 0
      const skippedSegments = []

      const autoSkipSegments = sponsorBlockSegments.filter(segment =>
        segment.actionType === 'skip' &&
        !isSponsorBlockPointSegment(segment) &&
        !sponsorBlockDoNotSkipSegments.has(segment.uuid) &&
        autoSkip.has(segment.category)
      )

      autoSkipSegments.forEach(segment => {
        if (currentTime < segment.endTime &&
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

      // segments contained in the skipped range are jumped over too, so they belong to the same toast
      autoSkipSegments.forEach(segment => {
        if (!skippedSegments.includes(segment) && segment.startTime < newTime && segment.endTime > currentTime) {
          skippedSegments.push(segment)
        }
      })

      const videoEnd = player.seekRange().end

      if (Math.abs(videoEnd - currentTime) < 1 || video_.ended) {
        return
      }

      if (newTime > videoEnd || Math.abs(videoEnd - newTime) < 1) {
        newTime = videoEnd
      }

      accumulatedSeekSeconds = 0
      video_.currentTime = newTime
      sponsorBlockCurrentTime.value = newTime

      if (sponsorBlockShowSkippedToast.value) {
        skippedSegments.forEach(({ uuid }) => {
          removePromptSponsorBlockToast(uuid)
          sponsorBlockDismissedPromptSegments.add(uuid)
        })

        // overlapping or adjacent segments are skipped in one jump, so show a single toast for all of them
        upsertSkippedSponsorBlockToast({
          uuid: skippedSegments[0].uuid,
          groupUuids: skippedSegments.map(({ uuid }) => uuid),
          translatedCategory: formatSponsorBlockToastCategories(skippedSegments),
          colors: getSponsorBlockToastColors(skippedSegments)
        })
      }
    }

    // #endregion SponsorBlock

    // #region player config

    const seekingIsPossible = computed(() => {
      if (props.isLive && (props.playbackEngine === 'built-in' || props.isLiveDvrEnabled === false)) {
        return false
      }

      if (props.manifestMimeType !== 'application/x-mpegurl' || !props.isLive) {
        return true
      }

      const match = props.manifestSrc.match(/\/(?:manifest|playlist)_duration\/(\d+)\//)

      if (match != null) {
        // Check how many seconds we are allowed to seek, 30 is too short, 3600 is an hour which is great
        return parseInt(match[1] || '0') > 30
      }

      // yt-dlp's manifest URLs don't state the seekable duration, but they do state
      // whether the stream has a DVR window, which is what makes it rewindable
      return props.playbackEngine === 'yt-dlp' && props.manifestSrc.includes('/playlist_type/DVR/')
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const isSabrPlayback = computed(() => {
      return !!process.env.SUPPORTS_LOCAL_API &&
        props.format !== 'legacy' &&
        props.manifestMimeType === MANIFEST_TYPE_SABR
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoQualitySupported = computed(() => {
      return streamsSupportAutoQuality(props.format, isSabrPlayback.value)
    })

    /**
     * How many segments per stream shaka-player downloads in parallel ahead of the playhead.
     * @type {import('vue').ComputedRef<number>}
     */
    const segmentPrefetchLimit = computed(() => {
      return resolveSegmentPrefetchLimit(store.getters.getSegmentPrefetchLimit, isSabrPlayback.value)
    })

    watch(segmentPrefetchLimit, (newValue) => {
      player?.configure('streaming.segmentPrefetchLimit', newValue)
    })

    /** @type {import('vue').ComputedRef<ReturnType<typeof getBufferingConfig>>} */
    const bufferingConfig = computed(() => getBufferingConfig({
      bufferAhead: store.getters.getBufferAhead,
      bufferBehind: store.getters.getBufferBehind,
      bufferBeforePlaying: store.getters.getBufferBeforePlaying,
    }))

    watch(bufferingConfig, (newValue) => {
      player?.configure({ streaming: newValue })
    })

    /**
     * @param {'dash'|'audio'|'legacy'} format
     * @param {boolean} useAutoQuality
     * @returns {shaka.extern.PlayerConfiguration}
     */
    function getPlayerConfig(format, useAutoQuality = false) {
      // Prefer hardware decoding, then predicted smoothness. Equal weights can
      // otherwise let a software-decoded codec win on bandwidth.
      const decodingAttributes = format === 'dash' ? preferredVideoDecodingAttributes : []
      const preferredCodecs = getCodecPrefixes(store.getters.getPreferredVideoCodec)

      return {
        streaming: {
          ...bufferingConfig.value,
          segmentPrefetchLimit: segmentPrefetchLimit.value,
          // Keep every codec selectable, automatic quality chooses them itself
          dontChooseCodecs: supportsSmoothCodecSwitching(),
          // Otherwise shaka-player downloads whole src= files (e.g. downloaded MP3s) through its
          // networking engine to read their ID3 tags, which fails for downloadmedia:// URLs
          processSrcEqualMetadata: false
        },
        manifest: {
          disableVideo: format === 'audio',

          // makes captions work for live streams and doesn't seem to have any negative affect on VOD videos
          segmentRelativeVttTiming: true,
          dash: {
            manifestPreprocessorTXml: manifestPreprocessorTXml
          },
          // shaka-player 5.2 stopped defaulting to sequence mode. Without it, HLS segments that
          // restart their timestamps after a discontinuity get appended at the wrong position
          hls: {
            sequenceMode: true
          },
        },
        abrFactory: () => new AutoQualityAbrManager(preferredCodecs, decodingAttributes, (videoIds) => {
          autoQualityVideoIds = videoIds
        }),
        // Used when Shaka still chooses the codecs, see supportsSmoothCodecSwitching
        preferredDecodingAttributes: decodingAttributes,
        abr: {
          enabled: useAutoQuality,

          // These only affect the "auto" quality, users can still manually select whatever quality they want.
          restrictToElementSize: true,
          restrictions: {
            maxPixels: getMeteredAutoQualityMaxPixels(store.getters.getMeteredNetworkQualityLimit)
          }
        },

        // Prefer the main audio before codec/channel preferences. If there is
        // no main role, Shaka falls back to the manifest's primary track.
        preferredAudio: [{ role: 'main' }],

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

        // Caption appearance is user-controlled, so discard source WebVTT positioning (for
        // example YouTube's occasional position:63% cues) before Shaka creates the cue DOM.
        textDisplayer: {
          positionArea: captionPositionArea.value,
          subtitleDelay: usesNativeCaptionTracks() ? 0 : captionTimingOffset,
        },

        preferredVideo: getVideoCodecPreferences(store.getters.getPreferredVideoCodec)
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

    // Like skip silence and voice-over translation, this needs Web Audio
    // processing, which the player does not use on iOS.
    const volumeBoostPossible = computed(() => !process.env.IS_IOS && store.getters.getShowVolumeBoostToggle)
    const volumeBoost = computed(() => {
      return volumeBoostPossible.value ? sanitizeVolumeBoost(store.getters.getTabVolumeBoost(mediaTabId)) : DEFAULT_VOLUME_BOOST
    })

    /**
     * @param {number} value
     */
    function updateVolumeBoost(value) {
      store.commit('setTabVolumeBoost', { tabId: mediaTabId, value: sanitizeVolumeBoost(value) })
    }

    watch(volumeBoost, value => playerAudioOutput.setGain('boost', value))

    // Downmixing to mono shares volume boost's Web Audio graph, so it is not available on iOS either.
    const monoAudio = computed(() => !process.env.IS_IOS && store.getters.getMonoAudio)
    watch(monoAudio, value => playerAudioOutput.setMono(value))

    const {
      cancelVideoZoomPan,
      changeVideoZoom,
      endVideoZoomPan,
      endVideoZoomPinchPointer,
      handleVideoZoomFullscreenChange,
      handleVideoZoomModifierKey,
      handleVideoZoomPointerEnter,
      handleVideoZoomPointerLeave,
      moveVideoZoomPan,
      moveVideoZoomPinch,
      startVideoZoomGesture,
      suppressVideoZoomClick,
      updateVideoZoom,
      videoFillZoomProximity,
      videoFillZoomSnapReady,
      videoZoom,
      videoZoomGestureZoom,
      videoZoomPanReady,
      videoZoomPanning,
      videoZoomPinching,
      videoZoomPossible,
      videoZoomStyle,
    } = useVideoZoom({
      container,
      isNativeFullscreenActive: () => isNativeFullscreenActive(),
      mediaTabId,
      onPinchStart: () => cancelMobileFullscreenGesture(),
      props,
      showValueChange,
      useVrMode,
      video,
    })

    // #region pointer gestures

    // Teleporting the player releases Chromium's pointer capture. Keep the
    // active stream on window so a fast swipe can finish outside the player.
    const playerPointerIds = new Set()
    let vrClickPointerId = null
    let vrClickStart = { x: 0, y: 0 }
    let vrClickDragged = false
    function trackPlayerPointer(event) {
      playerPointerIds.add(event.pointerId)
      window.addEventListener('pointermove', handlePlayerPointerMove, true)
      window.addEventListener('pointerup', handlePlayerPointerEnd, true)
      window.addEventListener('pointercancel', handlePlayerPointerEnd, true)
    }
    function handlePlayerPointerMove(event) {
      if (event.pointerId === vrClickPointerId &&
        Math.hypot(event.clientX - vrClickStart.x, event.clientY - vrClickStart.y) > 8) {
        vrClickDragged = true
      }
      if (playerPointerIds.has(event.pointerId)) handleVideoZoomPointerMove(event)
    }
    function handlePlayerPointerEnd(event) {
      if (!playerPointerIds.has(event.pointerId)) return
      playerPointerIds.delete(event.pointerId)
      if (event.type === 'pointercancel' && event.pointerId === vrClickPointerId) {
        vrClickPointerId = null
        vrClickDragged = false
      }
      if (!playerPointerIds.size) clearPlayerPointers()
      if (event.type === 'pointercancel') handleVideoZoomPointerCancel(event)
      else handleVideoZoomPointerUp(event)
    }
    function clearPlayerPointers() {
      playerPointerIds.clear()
      window.removeEventListener('pointermove', handlePlayerPointerMove, true)
      window.removeEventListener('pointerup', handlePlayerPointerEnd, true)
      window.removeEventListener('pointercancel', handlePlayerPointerEnd, true)
    }
    onBeforeUnmount(clearPlayerPointers)

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerDown(event) {
      trackPlayerPointer(event)
      if (useVrMode.value && event.button === 0 && event.isPrimary && isPlayerSurfaceTarget(event.target)) {
        vrClickPointerId = event.pointerId
        vrClickStart = { x: event.clientX, y: event.clientY }
        vrClickDragged = false
      }
      if (event.pointerType === 'touch' && !event.isPrimary && temporaryPlaybackRatePointerId !== null) {
        temporaryPlaybackRatePointerCancelled = true
        finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      }
      startMobileFullscreenGesture(event)
      startVideoZoomGesture(event)
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerMove(event) {
      if (event.pointerType === 'touch' && event.pointerId === temporaryPlaybackRatePointerId &&
        Math.hypot(event.clientX - temporaryPlaybackRatePointerStart.x, event.clientY - temporaryPlaybackRatePointerStart.y) > 12) {
        temporaryPlaybackRatePointerCancelled = true
        finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      }
      if (moveVideoZoomPinch(event)) return
      if (moveMobileFullscreenGesture(event)) return
      moveVideoZoomPan(event)
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerUp(event) {
      if (endVideoZoomPinchPointer(event)) return
      if (finishMobileFullscreenGesture(event)) return

      if (!endVideoZoomPan(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
    }

    /** @param {PointerEvent} event */
    function handleVideoZoomPointerCancel(event) {
      if (endVideoZoomPinchPointer(event, true)) return
      cancelMobileFullscreenGesture(event)
      cancelVideoZoomPan(event)
    }

    /** @param {MouseEvent} event */
    function handleVideoZoomClickCapture(event) {
      if (handleMobilePlayerSurfaceClick(event)) {
        return
      }

      suppressVideoZoomClick(event)
    }

    // #endregion pointer gestures

    // #region A-B repeat

    const disableAbRepeat = computed(() => store.getters.getDisableAbRepeat)
    const {
      abRepeatAvailable,
      abRepeatEnabled,
      abRepeatEnd,
      abRepeatStart,
      abRepeatValidation,
      abRepeatValidationMessage,
      checkAbRepeatBoundary,
      clearAbRepeat,
      clearAbRepeatBoundarySchedule,
      handleAbRepeatSeeking,
      hasValidAbRepeatRange,
      refreshAbRepeatMarkers,
      resetAbRepeat,
      scheduleAbRepeatBoundary,
      setCurrentAbRepeatBoundary,
      toggleAbRepeat,
      updateAbRepeatDuration,
    } = useAbRepeat({
      addMarkers,
      container,
      disableAbRepeat,
      getPlayer: () => player,
      isLive,
      onRepeat: () => repeatStatsTracker?.repeat(),
      resetSeekAccumulation: () => { accumulatedSeekSeconds = 0 },
      showValueChange,
      t,
      video,
    })
    const repeatStats = reactive({ active: false, repeats: 0, seconds: 0 })
    const hideRepeatStats = computed(() => store.getters.getHideRepeatStats)
    const repeatStatsTime = computed(() => formatDurationAsTimestamp(repeatStats.seconds))
    const repeatStatsRange = computed(() => abRepeatEnabled.value
      ? `${formatAbRepeatTimestamp(abRepeatStart.value)} – ${formatAbRepeatTimestamp(abRepeatEnd.value)}`
      : '')
    let repeatStatsTracker = null
    let repeatStatsLoopObserver = null

    function syncRepeatStatsMode() {
      const mode = isLive.value
        ? null
        : abRepeatEnabled.value && abRepeatAvailable.value
          ? `ab:${abRepeatStart.value}:${abRepeatEnd.value}`
          : video.value?.loop ? 'video' : null
      repeatStatsTracker?.setMode(mode)
    }

    watch([abRepeatStart, abRepeatEnd, abRepeatEnabled, isLive], syncRepeatStatsMode)
    onMounted(() => {
      if (typeof props.sabrReloadState?.loopEnabled === 'boolean') {
        video.value.loop = props.sabrReloadState.loopEnabled
      }
      const restoredAbRepeat = props.sabrReloadState?.abRepeat
      abRepeatStart.value = Number.isFinite(restoredAbRepeat?.start) ? restoredAbRepeat.start : null
      abRepeatEnd.value = Number.isFinite(restoredAbRepeat?.end) ? restoredAbRepeat.end : null
      abRepeatEnabled.value = restoredAbRepeat?.enabled === true
      repeatStatsTracker = createRepeatStatsTracker(video.value, stats => Object.assign(repeatStats, stats))
      repeatStatsTracker.restore(props.sabrReloadState?.repeatStats)
      repeatStatsLoopObserver = new MutationObserver(syncRepeatStatsMode)
      repeatStatsLoopObserver.observe(video.value, { attributes: true, attributeFilter: ['loop'] })
      syncRepeatStatsMode()
    })
    onBeforeUnmount(() => {
      repeatStatsTracker?.destroy()
      repeatStatsLoopObserver?.disconnect()
    })

    function handleAbRepeatDurationChange() {
      updateAbRepeatDuration()
      updateVideoElementGeometry()
      syncMediaSessionPosition()
    }

    // #endregion A-B repeat

    // #region seek history

    const seekHistoryEnabled = computed(() => store.getters.getEnableSeekHistory)
    const seekHistoryAvailable = computed(() => seekHistoryEnabled.value && seekingIsPossible.value && !isLive.value && !props.shortsPlayer)
    const seekHistoryKey = computed(() => props.videoId || props.externalUrl)
    // Players showing the same video share its history.
    const seekHistory = computed(() => getSeekHistory(seekHistoryKey.value))
    const seekHistoryChapters = computed(() => props.chapters)

    /**
     * The jump in progress, so that dragging the seek bar or pressing an arrow
     * key repeatedly leaves the starting position only once.
     * @type {{ from: number, recorded: boolean, lastAt: number } | null}
     */
    let seekHistoryJump = null

    watch([seekHistoryKey, seekHistoryEnabled], () => {
      seekHistoryJump = null
    })

    /** @param {import('../../helpers/player/seekHistory').SeekHistory} history */
    function updateSeekHistory(history) {
      if (seekHistoryKey.value) setSeekHistory(seekHistoryKey.value, history)
    }

    /** @param {number} target */
    function noteSeekHistoryJump(target) {
      const videoElement = video.value
      if (!seekHistoryAvailable.value || !videoElement || !Number.isFinite(target)) return

      const now = performance.now()
      // Holding a seek bar still while dragging continues the same jump.
      if (seekHistoryJump === null ||
        (now - seekHistoryJump.lastAt > SEEK_HISTORY_JUMP_WINDOW_MS && !ui?.getControls().isSeeking() && !mobileMiniBarSeeking.value)) {
        seekHistoryJump = { from: videoElement.currentTime, recorded: false, lastAt: now }
      }
      seekHistoryJump.lastAt = now

      if (!seekHistoryJump.recorded && Math.abs(target - seekHistoryJump.from) >= SEEK_HISTORY_MIN_JUMP_SECONDS) {
        seekHistoryJump.recorded = true
        updateSeekHistory(recordSeekHistoryJump(seekHistory.value, seekHistoryJump.from))
      }
    }

    /** @param {'back' | 'forward'} direction */
    function stepSeekHistory(direction) {
      const back = direction === 'back'
      const icon = back ? 'undo' : 'redo'
      const step = back
        ? stepSeekHistoryBack(seekHistory.value, video.value.currentTime)
        : stepSeekHistoryForward(seekHistory.value, video.value.currentTime)

      if (!step) {
        showValueChange(
          back ? t('Video.Player.Seek History.Nothing to undo') : t('Video.Player.Seek History.Nothing to redo'),
          icon,
          !back
        )
        return
      }

      updateSeekHistory(step.history)
      seekHistoryJump = null
      setCurrentTime(step.target)
      showValueChange(formatDurationAsTimestamp(step.target), icon, !back)
    }

    /** @param {CustomEvent<number>} event */
    function selectSeekHistoryEntry(event) {
      if (!canSeek()) return
      // Returning to an entry is a jump of its own, so it can be undone.
      seekHistoryJump = null
      setCurrentTime(event.detail, true)
    }

    // #endregion seek history

    const showInvidiousShareOptions = computed(() => {
      return usesInvidiousInstance(store.getters.getBackendPreference, store.getters.getBackendFallback)
    })

    const contextMenuElements = computed(() => {
      const elements = [
        'ft_loop',
        'ft_copy_youtube_video_url'
      ]

      if (props.externalUrl) return [...elements, 'ft_stats']

      elements.push('ft_copy_youtube_video_url_at_current_time')

      if (showInvidiousShareOptions.value) {
        elements.push(
          'ft_copy_invidious_video_url',
          'ft_copy_invidious_video_url_at_current_time'
        )
      }

      elements.push('ft_stats')

      return elements
    })

    function getBigButtons(showPlayButton, mobile) {
      if (!mobile) return showPlayButton ? ['play_pause'] : []
      return [
        ...(props.canSkipPrevious ? ['ft_skip_previous'] : []),
        'play_pause',
        ...(props.canSkipNext ? ['ft_skip_next'] : [])
      ]
    }

    const uiConfig = computed(() => {
      // DVR playback supports speed changes after seeking behind the live edge.
      // The seeking check confirms a DVR window for HLS, but assumes DASH is seekable.
      const liveDvrIsConfirmed = props.isLive && seekingIsPossible.value &&
        (props.isLiveDvrEnabled === true || props.manifestMimeType === 'application/x-mpegurl')
      const showPlaybackRateControls = (!isLive.value && !props.isLive) || liveDvrIsConfirmed
      const mobile = isCapacitorMobilePlayer()
      const controlPanelElements = [
        ...(!mobile ? ['ft_skip_previous', 'play_pause', 'ft_skip_next', 'mute', 'volume'] : []),
        'time_and_duration',
        'ft_playback_adjusted_time',
        // Chapters often arrive after the controls are built, so the button
        // hides itself while there are none instead of forcing a rebuild.
        ...((!onlyUseOverFlowMenu.value || mobile) && !props.shortsPlayer ? ['ft_chapters'] : []),
        'ft_sponsorblock_highlight',
        'spacer'
      ]

      /** @type {shaka.extern.UIConfiguration} */
      const uiConfig = {
        addSeekBar: seekingIsPossible.value,
        controlPanelElements: controlPanelElements,
        bigButtons: getBigButtons(displayVideoPlayButton.value, mobile),
        // Mobile audio artwork uses the same tap-to-toggle controls as video.
        showUIAlwaysOnAudioOnly: !mobile,
        topControlPanelElements: [],
        overflowMenuButtons: [],
        contextMenuElements: contextMenuElements.value,
        customContextMenu: !mobile,
        // Shorts have interactive controls over nearly the entire video
        // surface. Do not let Shaka interpret rapid control clicks as a
        // request to enter fullscreen.
        doubleClickForFullscreen: !props.shortsPlayer && !mobile,

        // only set this to label when we actually have labels, so that the warning doesn't show up
        // about it being set to labels, but that the audio tracks don't have labels
        trackLabelFormat: hasMultipleAudioTracks.value ? TrackLabelFormat.LABEL : TrackLabelFormat.LANGUAGE_ROLE,
        // Only set it to label if we added the captions ourselves,
        // some live streams come with subtitles in the DASH manifest, but without labels
        textTrackLabelFormat: props.captions.length > 0 || localCaptions.value.length > 0
          ? TrackLabelFormat.LABEL
          : TrackLabelFormat.LANGUAGE,
        displayInVrMode: useVrMode.value
      }

      /** @type {string[]} */
      let elementList
      const pictureInPictureElement = process.env.IS_CAPACITOR && !process.env.IS_IOS
        ? 'ft_android_picture_in_picture'
        : 'picture_in_picture'
      const controlBarElements = {
        autoplay: 'ft_autoplay_toggle',
        captions: 'ft_caption_toggle',
        menu: 'overflow_menu',
        pictureInPicture: pictureInPictureElement,
        theatreMode: 'ft_theatre_mode',
        fullWindow: 'ft_full_window',
        fullscreen: 'fullscreen',
      }
      // Shorts keep their own top controls, which rely on the default buttons.
      const controlBarButtons = props.shortsPlayer ? DEFAULT_CONTROL_BAR_BUTTONS : store.getters.getControlBarButtons

      // Shorts always use their custom top controls and hide Shaka's standard
      // control panel. Keep every applicable action in the overflow menu even
      // when full-window mode makes the player wide enough for the desktop
      // control layout.
      if (onlyUseOverFlowMenu.value || props.shortsPlayer) {
        // Keep related settings together before the one-click actions so the
        // grid's reading and tab order remain predictable.
        uiConfig.overflowMenuButtons = [
          ...(props.shortsPlayer ? ['ft_shorts_video_info'] : []),
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          ...(showPlaybackRateControls ? ['playback_rate'] : []),
          'captions',
          'ft_audio_tracks',
          'ft_sleep_timer',
          'ft_seek_history',
          ...(!props.shortsPlayer ? ['ft_autoplay_toggle'] : []),
          'ft_chapters',
          'ft_skip_silence',
          'ft_voice_over_translation',
          'ft_music_visualizer',
          'ft_music_mode',
          'ft_ambient_mode',
          'ft_lights_off',
          'ft_video_zoom',
          'ft_volume_boost',
          'ft_mono_audio',
          'ft_loop',
          'ft_ab_repeat',
          'ft_screenshot',
          pictureInPictureElement,
          ...(!process.env.IS_CAPACITOR ? ['ft_full_window'] : []),
          'recenter_vr',
          'toggle_stereoscopic',
        ]

        elementList = uiConfig.overflowMenuButtons

        // The overflow menu above already holds the other buttons.
        const compactButtons = ['captions', 'menu', 'fullscreen', ...(mobile && !props.shortsPlayer ? ['pictureInPicture'] : [])]
        uiConfig.controlPanelElements.push(
          ...((props.shortsPlayer || mobile) && useQuickPlaybackSpeedBar.value && showPlaybackRateControls
            ? ['ft_quick_playback_rate_bar']
            : []),
          ...controlBarButtons.filter(id => compactButtons.includes(id)).map(id => controlBarElements[id])
        )
      } else {
        uiConfig.controlPanelElements.push(
          ...(useQuickPlaybackSpeedBar.value && showPlaybackRateControls ? ['ft_quick_playback_rate_bar'] : []),
          'ft_sponsorblock_open_menu',
          'ft_sponsorblock_clear',
          'ft_sponsorblock_start',
          'ft_sponsorblock_cancel',
          'ft_sponsorblock_end',
          'ft_screenshot',
          ...controlBarButtons.map(id => controlBarElements[id])
        )

        // Buttons removed from the control bar stay available in the overflow menu.
        // The captions menu replaces the caption toggle; fullscreen has no menu entry.
        const removedButtons = new Set(getRemovedControlBarButtons(controlBarButtons))

        // Keep related settings together before the one-click actions.
        uiConfig.overflowMenuButtons.push(
          'ft_audio_tracks',
          'captions',
          ...(showPlaybackRateControls ? ['playback_rate'] : []),
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          'ft_sleep_timer',
          ...(removedButtons.has('autoplay') ? ['ft_autoplay_toggle'] : []),
          'ft_seek_history',
          'ft_skip_silence',
          'ft_voice_over_translation',
          'ft_music_visualizer',
          'ft_music_mode',
          'ft_ambient_mode',
          'ft_lights_off',
          'ft_video_zoom',
          'ft_volume_boost',
          'ft_mono_audio',
          'ft_loop',
          'ft_ab_repeat',
          ...['pictureInPicture', 'theatreMode', 'fullWindow']
            .filter(id => removedButtons.has(id))
            .map(id => controlBarElements[id]),
          'recenter_vr',
          'toggle_stereoscopic',
        )

        elementList = uiConfig.controlPanelElements
      }

      if (!enableScreenshot.value || props.format === 'audio') {
        removeFromArrayIfExists(elementList, 'ft_screenshot')
      }

      if (props.externalUrl) {
        for (const element of [
          'ft_sponsorblock_highlight',
          'ft_sponsorblock_open_menu',
          'ft_sponsorblock_clear',
          'ft_sponsorblock_start',
          'ft_sponsorblock_cancel',
          'ft_sponsorblock_end'
        ]) {
          removeFromArrayIfExists(uiConfig.controlPanelElements, element)
        }
      }

      // Keep the control mounted when a panel can make theatre mode available.
      if (!props.liveChatAvailable && !props.theatrePossible && props.chapters.length === 0 && (props.externalUrl || !useSponsorBlock.value)) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_theatre_mode')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_theatre_mode')
      }

      if (!props.autoplayPossible) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_autoplay_toggle')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_autoplay_toggle')
      }

      if (props.format === 'audio') {
        removeFromArrayIfExists(uiConfig.controlPanelElements, pictureInPictureElement)
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, pictureInPictureElement)
      }

      if (props.format === 'audio' || useVrMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_ambient_mode')
      }

      if (!audioPlayerMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_music_visualizer')
      }

      if (!videoZoomPossible.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_video_zoom')
      }

      if (!volumeBoostPossible.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_volume_boost')
      }

      if (!showMonoAudioToggle.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_mono_audio')
      }

      if (!showLightsOffToggle.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_lights_off')
      }

      if (!showMusicModeToggle.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_music_mode')
      }

      if (!showSkipSilenceButton.value || isLive.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_skip_silence')
      }

      if (!voiceOverTranslationAvailable.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_voice_over_translation')
      }

      if (isLive.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'loop')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_loop')
      }

      if (isLive.value || disableAbRepeat.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_ab_repeat')
      }

      if (!seekHistoryAvailable.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'ft_seek_history')
      }

      if (!useVrMode.value) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'recenter_vr')
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'toggle_stereoscopic')
      }

      // Only offer skipping where there actually is a video to skip to. The watch
      // view knows where those come from, a playlist or the watch queue.
      if (!props.canSkipPrevious) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_skip_previous')
      }

      if (!props.canSkipNext) {
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
      configurePlayerControls(() => applyUIConfiguration(firstTime))
    }

    /** @param {() => void} configure */
    function configurePlayerControls(configure) {
      if (!ui || !player) return
      // Custom controls call Vue render(), which can flush another player's
      // watchers during Shaka's rebuild. Keep registry restoration and the
      // entire rebuild together so every control belongs to the right player.
      if (configuringCustomPlayerControls) {
        nextTick(() => {
          configurePlayerControls(configure)
        })
        return
      }
      configuringCustomPlayerControls = true
      try {
        reRegisterOwnElements()
        configure()
      } finally {
        configuringCustomPlayerControls = false
      }
    }

    function applyUIConfiguration(firstTime) {
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

      // This rebuild applies any reconfigure deferred while unloaded.
      pendingUiReconfigure = false
      appliedUiConfigKey = JSON.stringify(uiConfig.value)

      const reopenPhoneOptions = !firstTime && !!container.value?.querySelector('.phonePlayerOptions[open]')

      if (firstTime) {
        /** @type {shaka.extern.UIConfiguration} */
        const firstTimeConfig = {
          customContextMenu: true,
          contextMenuElements: contextMenuElements.value,
          enableTooltips: true,
          seekBarColors: {
            // shaka-player's chapter markers only show up part of the time for the DASH and audio formats
            // the issue is clearly on the FreeTube side as shaka-player's demo page works fine and they show up all the time for the legacy formats.
            // As I have spent way too much time debugging it and still cannot make sense of it, we'll stick with FreeTube's own chapter markers for now.
            chapters: 'transparent',
            played: 'var(--seekbar-played-color, var(--primary-color))'
          },
          showAudioCodec: false,
          // Paused media needs a visible way to resume on both desktop and touch devices.
          showUIOnPaused: true,
          // YouTube offers the same resolutions in several codecs, which shaka-player lists
          // separately, so show the codec for both playback engines.
          showVideoCodec: true,
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
          enableFullscreenOnRotation: fullscreenOnRotationEnabled.value,
          fullScreenElement: androidFullscreenHost ?? container.value,
          // Android rotation is owned by the native orientation preference.
          // A second WebView lock races it and ignores portrait-only fullscreen.
          forceLandscapeOnFullscreen: !(process.env.IS_CAPACITOR && !process.env.IS_IOS),
          playbackRateSliderMax: maxVideoPlaybackRate.value,
          playbackRateSliderMin: videoPlaybackRateInterval.value,
          playbackRateSliderStep: videoPlaybackRateInterval.value,
          playbackRates: getPlaybackRatePresets(videoPlaybackRateInterval.value, maxVideoPlaybackRate.value),
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
        ui.configure(uiConfig.value)
      }

      if (reopenPhoneOptions) {
        requestAnimationFrame(() => {
          const controlsContainer = ui?.getControls().getControlsContainer()
          const menu = controlsContainer?.querySelector('.shaka-overflow-menu')
          if (menu?.classList.contains('shaka-hidden')) {
            ui.getControls().showUI()
            controlsContainer.querySelector('.shaka-overflow-menu-button')?.click()
          }
        })
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
      syncPipToggleState(document.pictureInPictureElement === video.value)
    }

    function closeChaptersOverlay() {
      showChaptersOverlay.value = false
      events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
        detail: false
      }))
    }

    function syncChapterOverlayButton() {
      syncingChapterOverlayButton = true
      events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
        detail: isNativeFullscreenActive() || fullWindowEnabled.value
          ? showChaptersOverlay.value
          : props.sidebarChaptersOpen
      }))
      syncingChapterOverlayButton = false
    }

    /**
     * @param {number} startSeconds
     */
    function selectOverlayChapter(startSeconds) {
      setCurrentTime(startSeconds, true)
    }

    /**
     * @param {number} startSeconds
     */
    function copyChapterTimestamp(startSeconds) {
      const videoUrl = appendTimestamp(props.externalUrl || getYoutubeVideoShareUrl(props.videoId), Math.floor(startSeconds))

      copyToClipboard(videoUrl, {
        messageOnSuccess: t('Share.Timestamp Link Copied')
      })
    }

    /**
     * @param {WheelEvent} event
     */
    function handleControlsContainerWheel(event) {
      const target = event.target
      if (!(target instanceof Element)) return

      if (target.classList.contains('shaka-controls-container') || target.closest(
        '.shaka-scrim-container, .shaka-fast-forward-container, .shaka-rewind-container, .shaka-play-button-container, .shaka-play-button, .shaka-spacer'
      )) {
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

        setPlaybackRate(getDefaultPlaybackRateForVideo())

        showValueChange(`${getDefaultPlaybackRateForVideo()}x`, 'gauge')
      }
    }

    let fullscreenTitleClickPending = false

    /**
     * Remember that a potential double-click began on the title because opening
     * its metadata dock can move the title before the second click lands.
     * @param {MouseEvent} event
     */
    function rememberFullscreenTitleClick(event) {
      if (event.detail === 1) {
        fullscreenTitleClickPending = true
      }
    }

    /**
     * Keep a double-click that began on the fullscreen title from reaching
     * Shaka's fullscreen toggle after the metadata layout moves its target.
     * @param {MouseEvent} event
     */
    function handleControlsContainerDoubleClick(event) {
      if (!fullscreenTitleClickPending) {
        return
      }

      fullscreenTitleClickPending = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    /**
     * Shaka handles fullscreen double-clicks on the controls container itself.
     * Stop gestures that began on an actual control before that handler can
     * observe them; bubble-phase `.stop` handlers run too late for this case.
     * @param {MouseEvent} event
     */
    function handlePlayerControlDoubleClick(event) {
      if (!(event.target instanceof Element)) {
        return
      }

      if (event.target.closest(`${FULLSCREEN_DOCK_HEADER_SELECTOR}, .fullscreenDockResizeHandle`)) {
        return
      }

      const interactiveTarget = event.target.closest(
        '.playerFullscreenTitleOverlay, .fullscreenActions, .fullscreenMetadataOverlay, ' +
        '.fullscreenTranscriptOverlay, .fullscreenSponsorBlockOverlay, .fullscreenLiveChatOverlay, ' +
        '.fullscreenCommentsOverlay, .fullscreenPlaylistOverlay, .fullscreenQueueOverlay, .fullscreenRecommendationsOverlay, .chapterOverlay, .shortsTopControls, ' +
        '.shaka-controls-button-panel, .shaka-settings-menu, .shaka-context-menu'
      )
      if (!interactiveTarget && isCapacitorMobilePlayer()) {
        // Keep side double-tap seeking, but replace center double-tap
        // fullscreen with the vertical phone gesture.
        if (getMobileTapDirection(event.clientX) !== 0) {
          return
        }
      } else if (!interactiveTarget) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
    }

    /**
     * Clear a previous title click when a new click gesture starts elsewhere.
     * @param {MouseEvent} event
     */
    function handleFullscreenTitleMouseDown(event) {
      if (event.detail === 1 && event.target !== fullscreenTitleOverlay) {
        fullscreenTitleClickPending = false
      }
    }

    /**
     * Only start click-and-hold playback from the non-interactive player surface.
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    function isPlayerSurfaceTarget(target) {
      if (target === video.value) return true
      if (!(target instanceof Element)) return false

      // Play and replay buttons own their clicks, including Android end screens.
      if (target.closest('.shaka-play-button')) return false

      // Seek feedback remains hit-testable while transparent, including its
      // text and SVG paths. Those descendants belong to the player surface.
      return target.closest('.shaka-fast-forward-container, .shaka-rewind-container') !== null || [
        'shaka-scrim-container',
        'shaka-play-button-container',
        'shaka-controls-container',
      ].some(className => target.classList.contains(className))
    }

    const mobileSideSwipesEnabled = computed(() => process.env.IS_CAPACITOR && (
      ['brightness', 'volume', 'speed'].includes(store.getters.getMobileLeftSwipeAction) ||
      ['brightness', 'volume', 'speed'].includes(store.getters.getMobileRightSwipeAction)
    ))
    const mobileAdjustments = createMobilePlayerAdjustments({
      getPlaybackRateOptions: () => ({ maximum: maxVideoPlaybackRate.value, step: videoPlaybackRateInterval.value }),
      async read(action) {
        if (action === 'speed') {
          cancelTemporaryPlaybackRateHolds()
          return getCurrentPlaybackRate()
        }
        if (action === 'brightness') {
          const { ScreenBrightness } = await import('@capacitor-community/screen-brightness')
          return (await ScreenBrightness.getBrightness()).brightness
        }
        const { Volume } = await import('@capawesome/capacitor-volume')
        return (await Volume.getVolume()).volume
      },
      async write(action, value) {
        if (action === 'speed') {
          applyPlaybackRate(value, false)
        } else if (action === 'brightness') {
          const { ScreenBrightness } = await import('@capacitor-community/screen-brightness')
          await ScreenBrightness.setBrightness({ brightness: value })
        } else {
          const { Volume } = await import('@capawesome/capacitor-volume')
          await Volume.setVolume({ volume: value })
        }
      },
      onChange(action, value) {
        // applyPlaybackRate already shows the multiplier OSD.
        if (action === 'speed') return
        const label = action === 'brightness'
          ? t('Settings.Player Settings.Swipe Gestures.Brightness')
          : t('Settings.Player Settings.Swipe Gestures.Volume')
        showValueChange(`${label}: ${Math.round(value * 100)}%`, action === 'brightness' ? 'sun' : 'volume-high', false, 0, false)
      },
      onError(error) {
        console.error('Mobile player adjustment failed', error)
        showToast(t('Settings.Player Settings.Swipe Gestures.Unavailable'))
      },
    })

    const {
      cancelMobileFullscreenGesture,
      consumeMobileTitleClickSuppression,
      dismissMobileMiniPlayer,
      finishMobileFullscreenGesture,
      getMobileTapDirection,
      handleMobilePlayerSurfaceClick,
      handleMobilePlayerTouchEnd,
      handleMobilePlayerTouchMove,
      mobileFullscreenSwipeSettling,
      mobileFullscreenSwipeStyle,
      mobileFullscreenSwiping,
      mobileMiniPlayerDismissSettling,
      mobileSeekPreview,
      moveMobileFullscreenGesture,
      startMobileFullscreenGesture,
    } = useMobileFullscreenGestures({
      getContainer: () => container.value,
      getControls: () => ui?.getControls(),
      getSeekState: () => {
        if (!video.value || !canSeek()) return null
        const { start, end } = player.seekRange()
        const time = video.value.currentTime
        return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(time) && end > start
          ? { time, start, end }
          : null
      },
      seekToTime: time => {
        if (!video.value || !canSeek()) return
        // WebView can mark VOD ended within its last frame, even before duration.
        const target = !player.isDynamic() && time === video.value.duration
          ? Math.max(0, time - 0.1)
          : time
        seekBySeconds(target - video.value.currentTime, true, false, false)
      },
      isFullscreenActive: () => isNativeFullscreenActive() || androidRotationFullscreen,
      isFullscreenMetadataShown: () => showFullscreenMetadata.value,
      isFullscreenSwipeEnabled: () => enableMobileFullscreenSwipe.value,
      isSeekSwipeEnabled: () => store.getters.getEnableMobileFullscreenSeek,
      isPlaybackEnded: () => video.value?.ended === true,
      isPlayerSurfaceTarget,
      isScrollMiniPlayerActive: () => scrollMiniPlayerActive.value,
      isShortsPlayer: () => props.shortsPlayer,
      seekOnDoubleTap: seconds => {
        if (!canSeek()) return 0
        const multiplier = seekIntervalMultiplyByPlaybackRate.value ? getCurrentPlaybackRate() : 1
        const distance = seconds * multiplier
        const startTime = video.value.currentTime
        seekBySeconds(distance, true, false, false)
        return video.value.currentTime - startTime
      },
      getSwipeAction: side => process.env.IS_CAPACITOR
        ? store.getters[side === 'left' ? 'getMobileLeftSwipeAction' : 'getMobileRightSwipeAction']
        : 'disabled',
      adjustments: mobileAdjustments,
      miniPlayerDrag: {
        canDismiss: () => mobileMiniBarCanDismiss.value && !mobileMiniBarControlsDisabled.value,
        dismiss: () => dismissCrossTabMiniPlayer(),
        dismissDuration: () => isReducedMotionEnabled() ? 0 : 140 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed),
        begin: restoring => beginScrollMiniPlayerDrag(restoring),
        move: (x, y) => moveScrollMiniPlayerDrag(x, y),
        finish: commit => finishScrollMiniPlayerDrag(commit),
        restore: () => restoreScrollMiniPlayerFromTap(),
        cancel: () => cancelScrollMiniPlayerDrag(),
      },
      setFullscreenMetadata,
      setShowUiOnPaused,
      showOverlayControls,
      togglePlayerFullScreen: () => {
        finishAndroidFullscreenExit(true)
        if (androidRotationFullscreen) {
          exitAndroidRotationFullscreen()
          return
        }
        return ui?.getControls().toggleFullScreen()
      },
    })

    watch([mobileSeekPreview, () => store.getters.getShowMobileSeekPreview], ([preview, showPreview]) => {
      ui?.getControls().dispatchEvent(new shaka.util.FakeEvent('seekpreviewchange', {
        time: preview?.time ?? null,
        showPreview,
      }))
    })

    function resetMobileAdjustments(preserveGesture = false) {
      if (!preserveGesture) cancelMobileFullscreenGesture()
      mobileAdjustments.reset()
    }

    /** @type {number | null} */
    let temporaryPlaybackRatePointerId = null
    let temporaryPlaybackRatePointerStart = { x: 0, y: 0 }
    let temporaryPlaybackRatePointerCancelled = false
    let suppressTemporaryPlaybackRateClick = false

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerDown(event) {
      if (
        !['mouse', 'touch'].includes(event.pointerType) ||
        event.button !== 0 ||
        !event.isPrimary ||
        event.ctrlKey ||
        event.metaKey ||
        useVrMode.value ||
        !holdToDoublePlaybackSpeed.value ||
        temporaryPlaybackRatePointerId !== null ||
        !isPlayerSurfaceTarget(event.target)
      ) {
        return
      }

      temporaryPlaybackRatePointerId = event.pointerId
      temporaryPlaybackRatePointerStart = { x: event.clientX, y: event.clientY }
      temporaryPlaybackRatePointerCancelled = false
      suppressTemporaryPlaybackRateClick = false
      startTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
    }

    /**
     * @param {PointerEvent} event
     */
    function handleTemporaryPlaybackRatePointerUp(event) {
      if (event.pointerId !== temporaryPlaybackRatePointerId) {
        return
      }

      const wasActive = isTemporaryPlaybackRateSourceActive(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)
      finishTemporaryPlaybackRateHold(TEMPORARY_PLAYBACK_RATE_POINTER_SOURCE)

      temporaryPlaybackRatePointerId = null
      suppressTemporaryPlaybackRateClick = wasActive || temporaryPlaybackRatePointerCancelled
      temporaryPlaybackRatePointerCancelled = false

      if (suppressTemporaryPlaybackRateClick) {
        setTimeout(() => {
          suppressTemporaryPlaybackRateClick = false
        }, event.pointerType === 'touch' ? 350 : 0)
      }
    }

    /** @param {TouchEvent} event */
    function handlePlayerTouchEnd(event) {
      // Fullscreen gestures send a synthetic container touchend to restart
      // Shaka's idle timer. Only suppress the real post-hold touch event.
      if (suppressTemporaryPlaybackRateClick && event.isTrusted) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      handleMobilePlayerTouchEnd(event)
    }

    /** @param {MouseEvent} event */
    function handlePlayerContextMenu(event) {
      if (isCapacitorMobilePlayer() && isPlayerSurfaceTarget(event.target)) {
        event.preventDefault()
        event.stopImmediatePropagation()
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

    /** @param {MouseEvent} event */
    function handleVrSurfaceClick(event) {
      if (!useVrMode.value || !isPlayerSurfaceTarget(event.target)) return

      const dragged = vrClickDragged
      vrClickPointerId = null
      vrClickDragged = false
      if (dragged) return

      // Shaka skips its usual surface play/pause handler while VR is active.
      if (video.value.paused) {
        video.value.play()
      } else {
        video.value.pause()
      }
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
      // The listener is bound to the seek bar container itself, so there is no
      // need to look it up again on every one of these very frequent events.
      const seekBarContainer = event.currentTarget
      if (!seekBarContainer || !player) return

      const rect = seekBarContainer.getBoundingClientRect()
      const { start, end } = player.seekRange()
      const offsetX = event.clientX - rect.left
      showChapterPreview(seekBarContainer, start + (end - start) * Math.max(0, Math.min(1, offsetX / rect.width)), offsetX)
    }

    /**
     * @param {HTMLElement} seekBarContainer
     * @param {number} hoverTime
     * @param {number} offsetX the preview's center within the seek bar container
     */
    function showChapterPreview(seekBarContainer, hoverTime, offsetX) {
      if (!container.value || !player) return

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

      const chapter = props.chapters.find((candidate, index) => {
        return hoverTime >= candidate.startSeconds &&
          (candidate.endSeconds === null
            ? (index === props.chapters.length - 1 || hoverTime < props.chapters[index + 1].startSeconds)
            : hoverTime < candidate.endSeconds ||
              (index === props.chapters.length - 1 && hoverTime === candidate.endSeconds))
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
      const clampedX = Math.max(minX, Math.min(maxX, offsetX))

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
     * @param {MouseEvent} event
     */
    function handleSeekBarTooltipMouseMove(event) {
      if (!container.value || !player) return

      const seekBarContainer = event.currentTarget
      if (!seekBarContainer) return

      const rect = seekBarContainer.getBoundingClientRect()
      if (rect.width === 0) return

      const seekRange = player.seekRange()
      const duration = seekRange.end - seekRange.start
      if (!Number.isFinite(duration) || duration <= 0) return

      const offsetX = event.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, offsetX / rect.width))
      const hoverTime = seekRange.start + (duration * percentage)
      updateSeekBarTooltip(seekBarContainer, hoverTime, duration / rect.width)
    }

    function handleSeekBarValueChange(event) {
      const seekBarContainer = container.value?.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer || !player) return
      const width = seekBarContainer.getBoundingClientRect().width
      const { start, end } = player.seekRange()
      if (width > 0) updateSeekBarTooltip(seekBarContainer, event.time, (end - start) / width)
      // Precise seeking keeps its time off the pointer's spot on the seek bar.
      if (event.chapterX != null) showChapterPreview(seekBarContainer, event.time, event.chapterX)
    }

    /**
     * Shaka previews keyboard seeks on a timer it starts on keydown, replacing the tooltip text.
     * Run after it, so the labels stay.
     * @param {KeyboardEvent} event
     */
    function handleSeekBarKeyDown(event) {
      const seekBarContainer = event.currentTarget.closest('.shaka-seek-bar-container')
      setTimeout(() => {
        const previous = seekBarTooltipLabels.get(seekBarContainer?.querySelector('.shaka-player-ui-thumbnail-time'))
        if (!player || !previous) return
        updateSeekBarTooltip(seekBarContainer, Number(event.target.value), previous.secondsPerPixel)
      })
    }

    function updateSeekBarTooltip(seekBarContainer, hoverTime, secondsPerPixel) {
      const thumbnailTime = seekBarContainer.querySelector('.shaka-player-ui-thumbnail-time')
      if (!thumbnailTime) return
      const sponsorBlockLabel = getSponsorBlockSeekBarTooltipLabel(hoverTime, secondsPerPixel)
      const popularityLabel = !hidePopularityGraph.value && !isLive.value && isMostReplayed(props.popularityMarkers, hoverTime)
        ? t('Video.Player.Most Replayed')
        : ''
      const tooltipLabel = [popularityLabel, sponsorBlockLabel].filter(Boolean).join(' · ')
      const currentText = thumbnailTime.textContent ?? ''
      const previous = seekBarTooltipLabels.get(thumbnailTime)
      // Reuse the base only while our last write remains intact. Shaka may have
      // replaced it with a new timestamp and chapter title between updates.
      const baseText = previous?.text === currentText ? previous.baseText : currentText
      const text = tooltipLabel ? `${baseText} · ${tooltipLabel}` : baseText
      if (text !== currentText) thumbnailTime.textContent = text
      seekBarTooltipLabels.set(thumbnailTime, { baseText, text, hoverTime, secondsPerPixel })
    }

    function handleSeekBarInput(event) {
      accumulatedSeekSeconds = 0
      if (event.type === 'pointerdown' || event.type === 'keydown') return
      if (!event.target.matches('.shaka-seek-bar') || event.target.disabled) return
      if (event.type === 'blur' && !seekBarMouseDown && !resumeAutoplayAfterSeek) return
      // Shaka's range control writes currentTime directly. A newer timeline
      // action must supersede a chapter seek queued before metadata was ready.
      if (event.type === 'mousedown') seekBarMouseDown = true
      if (event.type === 'mousedown' || event.type === 'touchstart') {
        seekHistoryJump = null
        // Shaka pauses while scrubbing, which cancels native autoplay before
        // the first frame. Remember that intent until the interaction ends.
        resumeAutoplayAfterSeek = video.value.autoplay && !videoLayoutReady.value && !initialAutoplayCanceled
      }
      rememberSeekPosition(Number(event.target.value), true)
      if (event.type === 'touchend' || event.type === 'touchcancel' || event.type === 'blur') {
        seekBarMouseDown = false
        restoreSeekAutoplay()
      }
    }

    function handleSeekBarMouseChange(event) {
      if (!seekBarMouseDown) return
      if (event.type === 'mouseup') seekBarMouseDown = false
      rememberSeekPosition(ui.getControls().getDisplayTime(), true)
      if (event.type === 'mouseup') restoreSeekAutoplay()
    }

    function restoreSeekAutoplay() {
      const shouldResume = resumeAutoplayAfterSeek
      resumeAutoplayAfterSeek = false
      const mediaElement = video.value
      if (shouldResume && !initialAutoplayCanceled && mediaElement?.autoplay && mediaElement.paused) {
        mediaElement.play().catch(() => {})
      }
    }

    function handleSeekBarWindowBlur() {
      if (!seekBarMouseDown) return
      // End Shaka's drag even when the mouse release happens outside the window.
      container.value?.querySelector('.shaka-seek-bar')?.blur()
    }

    function setupChapterPreview() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      for (const event of ['pointerdown', 'keydown', 'input']) {
        seekBarContainer.removeEventListener(event, handleSeekBarInput, true)
        seekBarContainer.addEventListener(event, handleSeekBarInput, true)
      }
      const seekBar = seekBarContainer.querySelector('.shaka-seek-bar')
      if (seekBar) {
        // Run after Shaka updates its value; it stops propagation for these events.
        for (const event of ['mousedown', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'blur']) {
          seekBar.removeEventListener(event, handleSeekBarInput)
          seekBar.addEventListener(event, handleSeekBarInput)
        }
        seekBar.removeEventListener('mouseup', handleSeekBarMouseChange)
        seekBar.addEventListener('mouseup', handleSeekBarMouseChange)
      }
      for (const event of ['mousemove', 'mouseup']) {
        document.removeEventListener(event, handleSeekBarMouseChange)
        document.addEventListener(event, handleSeekBarMouseChange)
      }
      seekBarContainer.removeEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.removeEventListener('mouseleave', handleSeekBarMouseLeave)
      seekBarContainer.addEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.addEventListener('mouseleave', handleSeekBarMouseLeave)
    }

    function setupSeekBarTooltip() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      seekBarContainer.removeEventListener('mousemove', handleSeekBarTooltipMouseMove)
      seekBarContainer.addEventListener('mousemove', handleSeekBarTooltipMouseMove)
      const seekBar = seekBarContainer.querySelector('.shaka-seek-bar')
      seekBar?.removeEventListener('keydown', handleSeekBarKeyDown)
      seekBar?.addEventListener('keydown', handleSeekBarKeyDown)
      const controls = ui.getControls()
      controls.removeEventListener('seekbarvaluechange', handleSeekBarValueChange)
      controls.addEventListener('seekbarvaluechange', handleSeekBarValueChange)
    }

    function refreshPopularityGraph() {
      const seekBarContainer = container.value?.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return
      seekBarContainer.querySelector('.ft-popularity-graph')?.remove()
      seekBarContainer.classList.remove('ft-has-popularity')
      const thumbnailTime = seekBarContainer.querySelector('.shaka-player-ui-thumbnail-time')
      const preview = seekBarTooltipLabels.get(thumbnailTime)
      if (preview) updateSeekBarTooltip(seekBarContainer, preview.hoverTime, preview.secondsPerPixel)
      if (hidePopularityGraph.value || !hasLoaded.value || isLive.value || !player) return

      const path = createPopularityPath(props.popularityMarkers, player.seekRange())
      if (!path) return
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.classList.add('ft-popularity-graph')
      svg.setAttribute('viewBox', '0 0 1000 40')
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.setAttribute('role', 'img')
      const peak = props.popularityMarkers.reduce((peak, marker) => marker.intensity > peak.intensity ? marker : peak)
      svg.setAttribute('aria-label', `${t('Video.Player.Most Replayed')}: ${formatDurationAsTimestamp(peak.startSeconds)}`)
      const area = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      area.setAttribute('d', path)
      svg.appendChild(area)
      seekBarContainer.appendChild(svg)
      seekBarContainer.classList.add('ft-has-popularity')
    }

    watch([() => props.popularityMarkers, hasLoaded, isLive, hidePopularityGraph, () => t('Video.Player.Most Replayed')], refreshPopularityGraph, { flush: 'post' })

    function addUICustomizations() {
      /** @type {HTMLDivElement} */
      const controlsContainer = ui.getControls().getControlsContainer()
      observeFullscreenControlsVisibility(controlsContainer)
      syncPlaybackRateToggleState()

      const controls = ui.getControls()
      controls.removeEventListener('submenuopen', handleSubMenuOpen)
      controls.removeEventListener('submenuclose', handleSubMenuClose)
      controls.addEventListener('submenuopen', handleSubMenuOpen)
      controls.addEventListener('submenuclose', handleSubMenuClose)

      controlsContainer.removeEventListener('wheel', handleControlsContainerWheel)
      controlsContainer.removeEventListener('click', handleControlsContainerClick, true)
      controlsContainer.removeEventListener('pointerdown', handleTemporaryPlaybackRatePointerDown, true)
      controlsContainer.removeEventListener('pointerleave', handleTemporaryPlaybackRatePointerLeave)
      controlsContainer.removeEventListener('click', handleTemporaryPlaybackRateClick, true)
      controlsContainer.removeEventListener('click', handleVrSurfaceClick, true)
      controlsContainer.removeEventListener('mousedown', handleFullscreenTitleMouseDown, true)
      controlsContainer.removeEventListener('dblclick', handleControlsContainerDoubleClick, true)

      controlsContainer.addEventListener('pointerdown', handleTemporaryPlaybackRatePointerDown, true)
      controlsContainer.addEventListener('pointerleave', handleTemporaryPlaybackRatePointerLeave)
      controlsContainer.addEventListener('click', handleTemporaryPlaybackRateClick, true)
      controlsContainer.addEventListener('click', handleVrSurfaceClick, true)
      controlsContainer.addEventListener('mousedown', handleFullscreenTitleMouseDown, true)
      controlsContainer.addEventListener('dblclick', handleControlsContainerDoubleClick, true)

      if (!useVrMode.value) {
        if (videoVolumeMouseScroll.value || videoSkipMouseScroll.value || videoPlaybackRateMouseScroll.value) {
          controlsContainer.addEventListener('wheel', handleControlsContainerWheel)
        }

        if (videoPlaybackRateMouseScroll.value) {
          controlsContainer.addEventListener('click', handleControlsContainerClick, true)
        }
      }

      // title overlay when the video fills the screen or window
      // placing this inside the controls container so that we can fade it in and out at the same time as the controls
      fullscreenTitleOverlay = document.createElement('h1')
      fullscreenTitleOverlay.textContent = props.title
      fullscreenTitleOverlay.className = 'playerFullscreenTitleOverlay shaka-no-propagation'
      fullscreenTitleOverlay.dir = 'auto'
      if (props.externalUrl) {
        fullscreenTitleOverlay.classList.add('passiveTitle')
      } else {
        fullscreenTitleOverlay.role = 'button'
        fullscreenTitleOverlay.tabIndex = 0
        fullscreenTitleOverlay.ariaLabel = `${t('Video.Metadata', 'Video information')}: ${props.title}`
        fullscreenTitleOverlay.ariaExpanded = String(showFullscreenMetadata.value)

        const toggleFullscreenMetadata = (event) => {
          event.stopPropagation()
          if (event instanceof MouseEvent) {
            if (consumeMobileTitleClickSuppression()) {
              event.preventDefault()
              return
            }
            rememberFullscreenTitleClick(event)
          }
          if (props.shortsPhonePanels) requestShortsPhonePanel('metadata')
          else setFullscreenMetadata(!showFullscreenMetadata.value)
        }
        fullscreenTitleOverlay.addEventListener('click', toggleFullscreenMetadata)
        fullscreenTitleOverlay.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return
          }
          event.preventDefault()
          toggleFullscreenMetadata(event)
        })
      }
      controlsContainer.appendChild(fullscreenTitleOverlay)

      if (hasLoaded.value && props.chapters.length > 0) {
        createChapterMarkers()
      }
      refreshAbRepeatMarkers()

      setupChapterPreview()
      setupSeekBarTooltip()
      refreshPopularityGraph()

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
      setupOverflowMenuLayout(controlsContainer)
    }

    /**
     * The overflow menu and its submenus are rebuilt from scratch whenever the
     * UI is configured, so they need their scrollbars and their height tracking
     * back every time.
     *
     * @param {HTMLElement} controlsContainer
     */
    function setupOverflowMenuLayout(controlsContainer) {
      cleanupPhoneOptionsMenu?.()
      cleanupPhoneOptionsMenu = null
      cleanupSubmenuScrolling?.()
      cleanupSubmenuScrolling = null
      overflowMenuResizeObserver?.disconnect()
      overflowMenuResizeObserver = null
      overflowMenuMutationObserver?.disconnect()
      overflowMenuMutationObserver = null
      if (overflowMenuTitleFrame !== null) {
        cancelAnimationFrame(overflowMenuTitleFrame)
        overflowMenuTitleFrame = null
      }
      overflowMenuIdleHeight = 0

      if (overflowMenuElement) {
        removeOverlayScrollbars(overflowMenuElement)
      }

      const menu = controlsContainer.querySelector('.shaka-overflow-menu')
      overflowMenuElement = menu instanceof HTMLElement ? menu : null
      if (!overflowMenuElement) {
        return
      }

      menu.classList.toggle('ft-menu-grid', usePlayerMenuGrid.value)

      for (const label of menu.querySelectorAll('[data-ft-overflow-title]')) {
        label.removeAttribute('title')
        delete label.dataset.ftOverflowTitle
      }

      // Caption appearance and timing have controls rather than options, so
      // they keep their own layouts.
      const submenus = menu.querySelectorAll(':scope > .shaka-sub-menu:not(.ft-caption-appearance-menu, .ft-caption-timing-menu)')
      for (const submenu of submenus) {
        const isListMenu = submenu.classList.contains('ft-caption-list-menu')
        submenu.classList.toggle('ft-menu-grid', usePlayerMenuGrid.value && !isListMenu)
        submenu.querySelector('.ft-caption-list-options')
          ?.classList.toggle('ft-menu-grid', usePlayerMenuGrid.value)
      }

      addOverlayScrollbars(menu)
      cleanupSubmenuScrolling = setupSubmenuScrolling(menu, ui.getControls())
      cleanupPhoneOptionsMenu = setupPhoneOptionsMenu(menu, ui.getControls(), t)

      if (!usePlayerMenuGrid.value) {
        menu.style.minBlockSize = ''
        return
      }

      overflowMenuMutationObserver = new MutationObserver(() => {
        scheduleOverflowMenuLabelTitles(menu)
      })
      overflowMenuMutationObserver.observe(menu, {
        attributeFilter: ['class'],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })

      // Opening a submenu replaces the tiles, which would otherwise resize the
      // popup around them. Remember how tall the menu is while its own tiles are
      // shown, so that a shorter submenu only leaves empty space below itself.
      overflowMenuResizeObserver = new ResizeObserver(() => {
        scheduleOverflowMenuLabelTitles(menu)

        if (menu.querySelector(':scope > .shaka-sub-menu:not(.shaka-hidden)')) {
          return
        }

        overflowMenuIdleHeight = menu.getBoundingClientRect().height
      })
      overflowMenuResizeObserver.observe(menu)

      const controls = ui.getControls()
      controls.removeEventListener('submenuopen', keepOverflowMenuHeight)
      controls.removeEventListener('submenuclose', releaseOverflowMenuHeight)
      controls.addEventListener('submenuopen', keepOverflowMenuHeight)
      controls.addEventListener('submenuclose', releaseOverflowMenuHeight)
      scheduleOverflowMenuLabelTitles(menu)
    }

    /**
     * Schedule title measurements after Shaka has finished updating the menu.
     *
     * @param {HTMLElement} menu
     */
    function scheduleOverflowMenuLabelTitles(menu) {
      if (!isActiveTab.value || menu.classList.contains('shaka-hidden') || overflowMenuTitleFrame !== null) {
        return
      }

      overflowMenuTitleFrame = requestAnimationFrame(() => {
        overflowMenuTitleFrame = null
        updateOverflowMenuLabelTitles(menu)
      })
    }

    /**
     * Add a native tooltip only when a visible player-menu label is clipped.
     *
     * @param {HTMLElement} menu
     */
    function updateOverflowMenuLabelTitles(menu) {
      if (!menu.isConnected || !isActiveTab.value || menu.classList.contains('shaka-hidden')) {
        return
      }
      for (const label of menu.querySelectorAll('.ft-menu-grid button span')) {
        const isVisible = label.clientWidth > 0 && label.clientHeight > 0
        const isClipped = isVisible && (
          label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight
        )

        if (isClipped && (!label.hasAttribute('title') || 'ftOverflowTitle' in label.dataset)) {
          label.title = label.textContent.trim()
          label.dataset.ftOverflowTitle = ''
        } else if (!isClipped && 'ftOverflowTitle' in label.dataset) {
          label.removeAttribute('title')
          delete label.dataset.ftOverflowTitle
        }
      }
    }

    function keepOverflowMenuHeight() {
      const menu = container.value?.querySelector('.shaka-overflow-menu')
      if (menu instanceof HTMLElement && overflowMenuIdleHeight > 0) {
        menu.style.minBlockSize = `${overflowMenuIdleHeight}px`
      }
      if (menu instanceof HTMLElement) {
        scheduleOverflowMenuLabelTitles(menu)
      }
    }

    function releaseOverflowMenuHeight() {
      const menu = container.value?.querySelector('.shaka-overflow-menu')
      if (menu instanceof HTMLElement) {
        menu.style.minBlockSize = ''
        scheduleOverflowMenuLabelTitles(menu)
      }
    }

    watch(uiConfig, (newValue) => {
      if (ui && JSON.stringify(newValue) !== appliedUiConfigKey) {
        configureUI()
      }
    })

    // The menu is only rebuilt when the UI configuration changes, so switching
    // the layout has to reach the existing one.
    watch(usePlayerMenuGrid, () => {
      if (ui) {
        setupOverflowMenuLayout(ui.getControls().getControlsContainer())
      }
    })

    watch(() => store.getters.getAppFont, async () => {
      if (!ui) return
      // Resolve the new font before waiting for its glyphs to finish loading.
      container.value?.getBoundingClientRect()
      await document.fonts.ready
      const controlPanel = container.value?.querySelector('.shaka-controls-button-panel')
      if (controlPanel instanceof HTMLElement) {
        scheduleControlPanelLayout(controlPanel)
      }
      if (overflowMenuElement) {
        scheduleOverflowMenuLabelTitles(overflowMenuElement)
      }
    }, { flush: 'post' })

    // Reapply any reconfigure that was deferred while the player was unloaded,
    // now that it is loaded again and rebuilding the controls is safe.
    watch(hasLoaded, (loaded) => {
      if (loaded && pendingUiReconfigure && ui && player) {
        pendingUiReconfigure = false
        configureUI()
      }
    })

    watch(() => props.chapters, (chapters) => {
      if (chapters.length === 0) {
        closeChaptersOverlay()
      }
      if (hasLoaded.value) {
        // Chapters no longer rebuild the controls, so redraw their markers here.
        refreshChapterMarkers()
        loadChapterThumbnails()
      }
    })

    watch(() => showChaptersOverlay.value || props.sidebarChaptersOpen, (open) => {
      if (!open || chapterThumbnailsWanted) return
      chapterThumbnailsWanted = true
      if (hasLoaded.value) {
        loadChapterThumbnails()
      }
    })

    watch(sponsorBlockSubmissionVisibleButtons, () => {
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    let mediaSessionStopped = false

    watch(() => props.videoId, () => {
      sponsorBlockRequestGeneration++
      sponsorBlockLoadedVideoId = null
      sponsorBlockInfoLoading.value = false
      resetAbRepeat()
      repeatStatsTracker?.reset()
      syncRepeatStatsMode()
      mediaSessionStopped = false
      voiceOverTranslation.reset()
      showPoster.value = true
      playbackEnded.value = false
      endSeekTarget = null
      sponsorBlockMuteController.reset()
      clearSponsorBlockMuteSegments()
      if (props.shortsPlayer) {
        shortsPaused.value = false
        shortsCaptionsAvailable.value = false
        shortsCaptionsEnabled.value = false
      }
      closeChaptersOverlay()
      if (!props.shortsPlayer) {
        closeSponsorBlockInfo()
      }
      resetSponsorBlockHighlightLabel()
      loadSponsorBlockDrafts()
      sponsorBlockSubmissionError.value = ''
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    watch(disableAbRepeat, (disabled) => {
      if (disabled) {
        resetAbRepeat()
      }
    })

    watch(
      [() => props.videoId, () => props.paidPromotion, () => props.shortsPlayer],
      ([videoId, paidPromotion, shortsPlayer], previous = []) => {
        resetPaidPromotion()
        if (shouldStartPaidPromotionTimer({
          videoId,
          previousVideoId: previous[0],
          paidPromotion,
          shortsPlayer,
          paused: video.value?.paused,
        })) {
          startPaidPromotionTimer()
        }
      },
      { immediate: true }
    )

    watch(useSponsorBlock, enabled => {
      if (!enabled) {
        closeSponsorBlockInfo()
        sponsorBlockMuteController.reset()
        clearSponsorBlockMuteSegments(props.offline)
        cancelSponsorBlockSkipSchedule()
      } else if (sponsorBlockLoadedVideoId === props.videoId) {
        syncSponsorBlockPlaybackState()
      } else if (!sponsorBlockInfoLoading.value) {
        setupSponsorBlock()
      }
    })

    watch(() => props.sponsorBlockAutoSkipDisabled, disabled => {
      syncSponsorBlockMuteSegments(video.value?.currentTime ?? 0, !disabled)
      scheduleSponsorBlockSkip()
    })

    watch(sponsorSkips, scheduleSponsorBlockSkip)

    watch(sponsorBlockEnableSubmission, (enabled) => {
      if (!enabled) sponsorBlockToastEditingUuid.value = null
      if (
        enabled &&
        sponsorBlockInfoOpen.value &&
        !sponsorBlockContributionStatsLoaded.value &&
        !sponsorBlockContributionStatsLoading.value
      ) {
        refreshSponsorBlockContributionStats()
      }
      emitSponsorBlockInfoState()
    })

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

    watch(voiceOverTranslationLanguage, () => voiceOverTranslation.reset())
    watch([voiceOverTranslationAvailable, voiceOverTranslationAutoPrepare], ([available, autoPrepare]) => {
      if (!available) {
        voiceOverTranslation.reset()
      } else if (autoPrepare && video.value?.readyState >= HTMLMediaElement.HAVE_METADATA) {
        voiceOverTranslation.prepare()
      }
    })

    watch(
      [
        useQuickPlaybackSpeedBar,
        enableChannelSettings,
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
    let overflowMenuResizeObserver = null

    /** @type {MutationObserver|null} */
    let overflowMenuMutationObserver = null

    /** @type {number|null} */
    let overflowMenuTitleFrame = null

    /** How tall the overflow menu is while its own tiles are shown. */
    let overflowMenuIdleHeight = 0

    /** @type {HTMLElement|null} */
    let overflowMenuElement = null
    let cleanupPhoneOptionsMenu = null
    let cleanupSubmenuScrolling = null

    /** @type {MutationObserver|null} */
    let fullscreenControlsVisibilityObserver = null
    let androidStatusBarVisible = true

    function handleSubMenuOpen() {
      isSubMenuOpened.value = true
    }

    function handleSubMenuClose() {
      isSubMenuOpened.value = false
    }

    function syncAndroidStatusBarVisibility() {
      const controlsContainer = ui?.getControls().getControlsContainer()
      if (
        isCapacitorMobilePlayer() &&
        video.value?.ended &&
        controlsContainer?.hasAttribute('shown') === false
      ) {
        controlsContainer.setAttribute('shown', 'true')
      }
      shakaControlsShown.value = controlsContainer?.hasAttribute('shown') === true
      const visible = shouldShowAndroidStatusBar({
        active: isActiveTab.value,
        fullscreen: isNativeFullscreenActive() || androidRotationFullscreen,
        controlsShown: !process.env.IS_IOS && controlsContainer?.hasAttribute('shown') === true,
      })
      if (visible === androidStatusBarVisible) return

      androidStatusBarVisible = visible
      setAndroidStatusBarVisible(visible).catch(error => {
        androidStatusBarVisible = !visible
        console.error('Failed to update Android status bar visibility:', error)
      })
    }

    function restoreAndroidStatusBarVisibility() {
      if (!isActiveTab.value || !ui) return
      // Android can reveal the bar while the notification shade owns focus.
      // Reapply the current preference even when the controls never changed.
      androidStatusBarVisible = null
      syncAndroidStatusBarVisibility()
    }

    function observeFullscreenControlsVisibility(controlsContainer) {
      fullscreenControlsVisibilityObserver?.disconnect()
      fullscreenControlsVisibilityObserver = new MutationObserver(syncAndroidStatusBarVisibility)
      fullscreenControlsVisibilityObserver.observe(controlsContainer, {
        attributeFilter: ['shown'],
        attributes: true,
      })
      syncAndroidStatusBarVisibility()
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
      // Mini-player controls are separate from Shaka's hidden inline controls.
      // Changing their layout here rebuilds every Shaka control at both ends of
      // the animation, even though the inline layout often has not changed.
      if (!scrollMiniPlayerActive.value && !scrollMiniPlayerAnimating.value && !scrollMiniPlayerDragStyle.value) {
        onlyUseOverFlowMenu.value = inlineSize <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD
      }
      rememberInlinePlayerLayoutHeight()
      repairScrollMiniPlaceholderHeight()
    }

    // Remeasure the control bar layout once the tab becomes presented. A player
    // that mounted in a background tab could not measure its real width, and the
    // ResizeObserver does not always fire for an ancestor display:none toggle.
    function remeasureControlPanelWidth() {
      if (!ui || scrollMiniPlayerActive.value || scrollMiniPlayerAnimating.value || scrollMiniPlayerDragStyle.value) {
        return
      }
      const width = container.value?.getBoundingClientRect().width ?? 0
      if (width > 0) {
        if (!ui.isMobile()) onlyUseOverFlowMenu.value = width <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD

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
    const replayLabel = ref('')
    const mobileMiniBarSeekLabel = ref('')

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
      replayLabel.value = localization.resolve('REPLAY')
      mobileMiniBarSeekLabel.value = localization.resolve('SEEK')

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
      tabMediaCoordinator.setActionHandlers(mediaTabId, mediaSessionSource, {
        play: () => video.value?.play(),
        pause,
        stop: () => {
          const videoElement = video.value
          if (!videoElement) return
          const wasPaused = videoElement.paused
          mediaSessionStopped = true
          initialAutoplayCanceled = true
          if (wasPaused) videoElement.autoplay = false
          videoElement.pause()
          if (seekingIsPossible.value && Number.isFinite(videoElement.duration)) {
            setCurrentTime(0)
          }
          if (wasPaused) {
            tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')
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
          if (!videoElement || !canSeek() || !Number.isFinite(details.seekTime)) return
          accumulatedSeekSeconds = 0
          rememberSeekPosition(details.seekTime, true)
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

      // Shaka can reach its seek-range end before the media element is ended.
      const nextState = (playbackEnded.value || video_.ended || player?.isEnded()) && video_.duration ? 'replay' : video_.paused ? 'play' : 'pause'

      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-play-button').forEach((button) => {
          if (!button.querySelector('.ft-play-pause-morph-icon')) {
            createPlayPauseMorphIcon(button, PLAY_MORPH_PATH)
          }

          if (nextState === 'replay') {
            button.querySelector(
              ':scope > .shaka-ui-icon:not(.ft-play-pause-morph-icon) > path'
            )?.setAttribute('d', shaka.ui.Enums.MaterialDesignSVGIcons.REPLAY)
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

    /**
     * shaka-player's picture in picture button only tells its state through its
     * label, so the overflow menu can't highlight it while it is active.
     *
     * @param {boolean} active
     */
    function syncPipToggleState(active) {
      window.requestAnimationFrame(() => {
        container.value?.querySelectorAll('.shaka-pip-button').forEach((button) => {
          button.ariaPressed = active ? 'true' : 'false'
        })
      })
    }

    /**
     * shaka-player's playback rate entry only tells its rate through its label,
     * so the overflow menu highlights it whenever playback isn't at normal speed.
     */
    function syncPlaybackRateToggleState() {
      const rate = getCurrentPlaybackRate()
      const active = rate !== null && Math.abs(rate - NORMAL_PLAYBACK_RATE) >= 0.01
      container.value?.querySelectorAll('.shaka-playbackrate-button').forEach((button) => {
        button.classList.toggle('ft-active', active)
      })
    }

    function handleRateChange() {
      syncMediaSessionPosition()
      syncPlaybackRateToggleState()
    }

    function handlePlay() {
      if (shortsNavigationSuspended.value) {
        video.value.pause()
        return
      }
      if (playbackEnded.value || isEndSeekPosition()) {
        setCurrentTime(player.seekRange().start)
      }
      if (!video.value.paused) initialAutoplayCanceled = false
      if (!isTemporaryPlaybackRateActive()) setShowUiOnPaused(true)
      playerPaused.value = false
      clearPausedInterfaceReveal()
      shortsPaused.value = false
      playbackEnded.value = false
      const isCurrentPictureInPictureVideo = document.pictureInPictureElement === video.value
      if (
        !isActiveTab.value &&
        !isCurrentPictureInPictureVideo &&
        !scrollMiniPlayerDetached.value
      ) {
        video.value.pause()
        return
      }

      mediaSessionStopped = false

      flushPendingMusicPlaybackRateToast()

      syncPlayPauseControlIcons()

      sleepTimer.resumeCountdown()
      startSponsorBlockHighlightLabelCountdown()
      scheduleSponsorBlockSkip()
      scheduleAbRepeatBoundary()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'playing')

      updateAutoPip()
      updateScrollMiniPlayer()

      if (scrollMiniPlayerActive.value) {
        showScrollMiniPlayPause(true)
      }

      emit('play')
    }

    function handlePlaying() {
      if (shortsNavigationSuspended.value) return
      autoplayRequested.value = false
      hasPlaybackPosition.value = true
      // A decoded video frame replaces the retained startup/format-switch poster.
      showPoster.value = false
      startPaidPromotionTimer()

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('playing', tabId)
      }
      emit('playing')
    }

    function handleWaiting() {
      if (shortsNavigationSuspended.value) return
      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('waiting', tabId)
      }
      emit('waiting')
    }

    function handlePause() {
      if (shortsNavigationSuspended.value) return
      if (video.value?.paused && !ui?.getControls().isSeeking() && !resumeAutoplayAfterSeek) {
        initialAutoplayCanceled = true
      }
      if (!consumeTemporaryPlaybackRatePause()) setShowUiOnPaused(true)
      playerPaused.value = true
      clearPausedInterfaceReveal()
      shortsPaused.value = true
      syncPlayPauseControlIcons()

      sleepTimer.pauseCountdown()
      pauseSponsorBlockHighlightLabelCountdown()
      cancelSponsorBlockSkipSchedule()
      clearAbRepeatBoundarySchedule()

      tabMediaCoordinator.setPlaybackState(
        mediaTabId,
        mediaSessionStopped || video.value?.ended ? 'none' : 'paused'
      )

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
      if (shortsNavigationSuspended.value) return
      endSeekTarget = null
      clearSabrBackoffTimer({ refreshPreview: true })
      const sleepTimerEnded = sleepTimer.consumeEndOfVideo()
      if (!sleepTimerEnded && abRepeatEnabled.value && hasValidAbRepeatRange()) {
        // Seeking to the media end can queue ended after seeked has returned
        // playback to A, which must not count or seek again.
        checkAbRepeatBoundary()
        video.value.play()
        return
      }

      setShowUiOnPaused(true)
      shortsPaused.value = true
      autoplayCanceled.value = false
      playbackEnded.value = true
      syncPlayPauseControlIcons()

      if (isCapacitorMobilePlayer()) {
        showOverlayControls()
      }

      sleepTimer.pauseCountdown()

      pauseSponsorBlockHighlightLabelCountdown()
      cancelSponsorBlockSkipSchedule()
      promptSponsorBlockSegments.value = []
      clearAbRepeatBoundarySchedule()

      tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none', tabId)
      }

      updateAutoPip()

      updateScrollMiniPlayer()
      if (scrollMiniPlayerActive.value) {
        showScrollMiniPlayPause(false)
      }

      emit('ended', sleepTimerEnded)
    }

    function isEndSeekPosition() {
      if (endSeekTarget === null || !video.value) return false
      const currentTime = video.value.currentTime
      const backoff = player.getConfiguration().streaming.durationBackoff
      const backedOffTarget = Math.max(player.seekRange().start, endSeekTarget - backoff)
      // Accept Shaka's duration clamp, but discard a superseding timeline or
      // Media Session seek. The seek bar stops 1 ms before duration; allow
      // timestamp rounding as well, only for an explicitly requested end seek.
      return Math.abs(currentTime - endSeekTarget) < 0.002 ||
        Math.abs(currentTime - backedOffTarget) < 0.001
    }

    // Start positions are applied before the first frame and keep the poster.
    let mediaFrameLoaded = false
    let seekRevealsFrame = false

    /** @param {boolean} loaded */
    function handleMediaFrameLoaded(loaded) {
      mediaFrameLoaded = loaded
    }

    function handleSeeking() {
      if (shortsNavigationSuspended.value) return
      seekRevealsFrame = mediaFrameLoaded
      hasPlaybackPosition.value = true
      if (!isEndSeekPosition()) endSeekTarget = null
      playbackEnded.value = false
      sleepTimer.checkChapterBoundary()
      cancelSponsorBlockSkipSchedule()
      handleAbRepeatSeeking()
      syncPlayPauseControlIcons()
      emit('seeking', video.value?.currentTime ?? 0)
    }

    function handleSeeked() {
      if (shortsNavigationSuspended.value) return
      // A paused seek decodes the new frame without a playing event.
      if (seekRevealsFrame && video.value?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.value.videoWidth > 0) {
        showPoster.value = false
      }
      updateMobileMiniBarProgress()
      if (isEndSeekPosition()) playbackEnded.value = true
      // A paused seek can reach the end without dispatching an ended event.
      // Show replay without starting autoplay from a paused video.
      if (!props.shortsPlayer && video.value?.paused && !video.value.loop && !isLive.value &&
          !(abRepeatEnabled.value && hasValidAbRepeatRange()) &&
          (playbackEnded.value || video.value.ended || player?.isEnded())) {
        playbackEnded.value = true
        autoplayCanceled.value = true
      }
      if (playbackEnded.value || video.value?.ended) {
        syncPlayPauseControlIcons()
      }
      sponsorBlockCurrentTime.value = video.value?.currentTime ?? 0
      updateSecondaryCaptionText()
      sleepTimer.handleSeeked()
      checkAbRepeatBoundary(false)
      emit('seeked', video.value?.currentTime ?? 0)
    }

    function applyPendingPresentationModes() {
      if (!isActiveTab.value || !ui) {
        return
      }

      if (startInFullwindow && fullWindowListenerReady) {
        startInFullwindow = false
        events.dispatchEvent(new CustomEvent('setFullWindow', { detail: true }))
      }

      if (startInFullscreen && hasLoaded.value && process.env.IS_CAPACITOR) {
        if (androidFullscreenHostActive.value) startInFullscreen = false
      } else if (startInFullscreen && hasLoaded.value && process.env.IS_ELECTRON) {
        startInFullscreen = false
        window.ftElectron.requestFullscreen(tabId)
      }

      if (
        startInPip &&
        props.format !== 'audio' &&
        video.value?.readyState >= HTMLMediaElement.HAVE_METADATA &&
        ui.getControls().isPiPAllowed() &&
        process.env.IS_ELECTRON
      ) {
        startInPip = false
        restorePictureInPicture(props.autoPictureInPictureState?.autoPipActive === true)
      }
    }

    function handleCanPlay() {
      // Metadata initialization can restore Shaka's original start time after
      // an earlier seek. Apply that seek before playback becomes ready.
      if (pendingMetadataSeek !== null) {
        // Restoring an existing seek must preserve its accumulated OSD feedback.
        if (seekingIsPossible.value) {
          rememberSeekPosition(pendingMetadataSeek)
          video.value.currentTime = pendingMetadataSeek
        }
        pendingMetadataSeek = null
      }

      // PiP can only be activated once the video's readyState and video track are populated.
      applyPendingPresentationModes()

      // Re-evaluate auto-PiP now that PiP is actually allowed (the video was possibly
      // in a hidden tab / scrolled out of view while still loading).
      updateAutoPip()
      handleVideoResize()
      videoLayoutReady.value = true
    }

    function handleVideoResize() {
      updateAnnotationVideoAspectRatio()
      updateScrollMiniVideoAspectRatio()
      updateScrollMiniPlayer()

      if (isActiveTab.value && isNativeFullscreenActive()) {
        requestFullscreenOrientation(true)
      }
    }

    let volumeUserSetTimer = null

    // Dragging the volume slider fires a continuous stream of events,
    // so wait for the user to settle on a volume before persisting it
    function emitVolumeUserSet(volume) {
      clearTimeout(volumeUserSetTimer)
      volumeUserSetTimer = setTimeout(() => {
        volumeUserSetTimer = null
        emit('volume-user-set', volume)
      }, 500)
    }

    function cancelPendingVolumeUserSet() {
      clearTimeout(volumeUserSetTimer)
      volumeUserSetTimer = null
    }

    function updateVolume() {
      const video_ = video.value
      const muted = video_.muted || video_.volume === 0
      shortsMuted.value = muted
      scrollMiniVolume.value = muted ? 0 : video_.volume

      syncMuteControlIcons(muted)

      if (showStats.value) {
        stats.volume = (video_.volume * 100).toFixed(1)
      }

      const sponsorBlockVolumeChange = sponsorBlockMuteController.handleVolumeChange()
      skippedSponsorBlockSegments.value
        .filter(segment => segment.isMute)
        .forEach(segment => {
          segment.unskipped = !video_.muted
        })
      if (applyingInitialVolume || sponsorBlockVolumeChange) {
        return
      }

      if (isCapacitorMobilePlayer()) return

      const volume = video_.muted ? 0 : video_.volume
      emit('volume-updated', volume)
      emitVolumeUserSet(volume)

      if (!rememberVolume.value) {
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

      if (isCapacitorMobilePlayer()) {
        videoElement.volume = 1
        videoElement.muted = false
        applyingInitialVolume = false
        emit('volume-updated', 1)
        return
      }

      // The channel's volume is more specific than the globally remembered one, so it wins
      if (savedChannelVolume.value !== null) {
        videoElement.volume = savedChannelVolume.value
        videoElement.muted = savedChannelVolume.value === 0
      } else if (rememberVolume.value) {
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
      emit('volume-updated', videoElement.muted ? 0 : videoElement.volume)
    }

    function handleTimeupdate() {
      if (shortsNavigationSuspended.value) return
      if (video.value) {
        if (sleepTimer.checkChapterBoundary()) return
        checkAbRepeatBoundary()
        const currentTime = video.value.currentTime
        updateMobileMiniBarProgress()
        sponsorBlockCurrentTime.value = currentTime
        annotationCurrentTime.value = currentTime
        updateHiddenShortsSeekBar(currentTime)
        updateSecondaryCaptionText()

        emit('timeupdate', currentTime)
        emitTerminalSponsorBlockOutroStarted(currentTime)
        syncMediaSessionPosition()

        if (showStats.value && hasLoaded.value) {
          updateStats()
        }

        handleSponsorBlockPreviewSkip(currentTime)

        if (useSponsorBlock.value && sponsorBlockSegments.length > 0 && canSeek()) {
          syncPromptSponsorBlockSegments(currentTime)
          updateSponsorBlockHighlightState(currentTime)
          syncSponsorBlockMuteSegments(currentTime, !props.sponsorBlockAutoSkipDisabled)

          if (!props.sponsorBlockAutoSkipDisabled) {
            skipSponsorBlockSegments(currentTime)
            scheduleSponsorBlockSkip()
          }
        } else {
          sponsorBlockMuteController.setSourceActive('segments', false)
        }

        updateScrollMiniDragHandleContrast()
      }
    }

    function syncMediaSessionPosition() {
      const videoElement = video.value
      if (
        !videoElement ||
        !Number.isFinite(videoElement.duration) ||
        videoElement.duration <= 0 ||
        !Number.isFinite(videoElement.currentTime)
      ) {
        return
      }

      tabMediaCoordinator.setPositionState(
        mediaTabId,
        {
          duration: videoElement.duration,
          position: Math.min(videoElement.duration, Math.max(0, videoElement.currentTime)),
          playbackRate: videoElement.playbackRate,
        },
        mediaSessionStopped || videoElement.ended ? 'none' : videoElement.paused ? 'paused' : 'playing'
      )
    }

    /**
     * Shaka stops refreshing its seek bar while its controls are hidden, but
     * Shorts keep the seek bar visible. Keep that visible progress in sync
     * without interfering while Shaka is showing or operating the controls.
     * @param {number} currentTime
     */
    function updateHiddenShortsSeekBar(currentTime) {
      const controls = ui?.getControls()
      if (!props.shortsPlayer || !hasLoaded.value || !player || !controls ||
          controls.getControlsContainer().hasAttribute('shown') || controls.isSeeking()) {
        return
      }

      const seekBarContainer = container.value?.querySelector('.shaka-seek-bar-container')
      const seekBar = seekBarContainer?.querySelector('.shaka-seek-bar')
      if (!(seekBarContainer instanceof HTMLElement) || !(seekBar instanceof HTMLInputElement)) {
        return
      }

      const seekRange = player.seekRange()
      const seekRangeSize = seekRange.end - seekRange.start
      if (seekRangeSize <= 0) {
        return
      }

      const clampedCurrentTime = Math.min(Math.max(currentTime, seekRange.start), seekRange.end)
      const buffered = video.value.buffered
      const bufferedEnd = buffered.length > 0
        ? Math.min(buffered.end(buffered.length - 1), seekRange.end)
        : clampedCurrentTime
      const playedPercent = (clampedCurrentTime - seekRange.start) / seekRangeSize * 100
      const bufferedPercent = Math.max(
        playedPercent,
        (bufferedEnd - seekRange.start) / seekRangeSize * 100
      )
      const colors = ui.getConfiguration().seekBarColors
      const gradient = [
        'to right',
        `${colors.played} 0%`,
        `${colors.played} ${playedPercent}%`,
        `${colors.buffered} ${playedPercent}%`,
        `${colors.buffered} ${bufferedPercent}%`,
        `${colors.base} ${bufferedPercent}%`,
        `${colors.base} 100%`,
      ]

      seekBar.min = seekRange.start.toString()
      seekBar.max = seekRange.end.toString()
      seekBar.value = clampedCurrentTime.toString()
      seekBarContainer.style.background = `linear-gradient(${gradient.join(', ')})`
      updateSponsorBlockSeekBarState(seekBarContainer)
    }

    const videoElementWidth = ref(0)
    const videoElementHeight = ref(0)
    /** Height of the video element in CSS pixels, used to scale the captions with the player. */
    const videoElementLayoutHeight = ref(0)

    const captionPlayerVariables = computed(() => {
      return getCaptionPlayerVariables(videoElementLayoutHeight.value)
    })

    function updateAnnotationVideoAspectRatio() {
      const video_ = video.value

      annotationVideoAspectRatio.value = video_?.videoWidth > 0 && video_.videoHeight > 0
        ? video_.videoWidth / video_.videoHeight
        : null
    }
    const {
      scrollMiniPlayerDragStyle,
      mobileMiniBar,
      compactMobileMiniPlayer,
      mobileMiniBarExpanded,
      mobileMiniBarCollapsed,
      mobileMiniBarCanDismiss,
      mobileMiniBarOverlayStyle,
      mobileMiniBarProgress,
      mobileMiniBarHasSeekRange,
      updateMobileMiniBarProgress,
      beginScrollMiniPlayerDrag,
      moveScrollMiniPlayerDrag,
      finishScrollMiniPlayerDrag,
      restoreScrollMiniPlayerFromTap,
      cancelScrollMiniPlayerDrag,
      deactivateScrollMiniPlayer,
      dismissCrossTabMiniPlayer,
      handleFullscreenButtonClick: handleScrollMiniFullscreenButtonClick,
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
      rememberDockOrigin,
      rememberInlinePlayerLayoutHeight,
      repairScrollMiniPlaceholderHeight,
      scrollMiniAnchor,
      scrollMiniDragHandleOnLightBg,
      scrollMiniIsPaused,
      scrollMiniPlaceholder,
      scrollMiniPlaceholderHeight,
      scrollMiniPlayerActive,
      scrollMiniPlayerAnimating,
      scrollMiniPlayerDetached,
      scrollMiniPlayerDismissed,
      scrollMiniPlayerStyle,
      scrollMiniPlayerStashed,
      scrollMiniPlayerStashedSide,
      scrollMiniPlayPauseVisible,
      scrollMiniResizeCorner,
      scrollMiniResizeHandleOnLightBg,
      scrollMiniScrollToTop,
      restoreInlinePlayer,
      scrollMiniTogglePlayPause,
      revealScrollMiniPlayerControls,
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
      mobileMiniBarOverlay,
      fullWindowEnabled,
      inlineSixteenByNine: computed(() => audioPlayerMode.value || forceAspectRatio.value || (!props.shortsPlayer && !videoLayoutReady.value)),
      getUi: () => ui,
      getSeekRange: () => hasLoaded.value ? player?.seekRange() : null,
      isActiveTab,
      isPlayerSuspended: shortsNavigationSuspended,
      pictureInPictureActive,
      props,
      tabId,
      video,
    })

    const {
      cancelControlPanelLayout,
      destroyAdaptiveControlPanelLayout,
      scheduleControlPanelLayout,
      setupAdaptiveControlPanelLayout,
    } = useAdaptiveControlPanelLayout({
      container,
      events,
      isActiveTab,
      scrollMiniPlayerActive,
      scrollMiniPlayerAnimating,
      scrollMiniPlayerDragStyle,
    })

    // The page reserves room below its content for the bar (mirrors the template's classes).
    const mobileMiniBarShown = computed(() => mobileMiniBar.value && (scrollMiniPlayerActive.value || scrollMiniPlayerAnimating.value))
    useRootClass('appMiniBar', mobileMiniBarShown)
    useRootClass('appMiniBarCompact', () => mobileMiniBarShown.value && compactMobileMiniPlayer.value && !scrollMiniPlayerDismissed.value)
    useRootClass('appMiniBarCollapsed', () => mobileMiniBarShown.value && mobileMiniBarCollapsed.value)

    const mobileMiniBarControlsDisabled = computed(() => Boolean(scrollMiniPlayerDragStyle.value || scrollMiniPlayerAnimating.value || mobileMiniPlayerDismissSettling.value))
    const mobileMiniBarSeekDisabled = computed(() => mobileMiniBarControlsDisabled.value || !hasLoaded.value || !seekingIsPossible.value || !mobileMiniBarHasSeekRange.value)
    const mobileMiniBarSeeking = ref(false)
    watch([mobileMiniBarSeekDisabled, scrollMiniPlayerActive], ([disabled, active]) => {
      if (disabled || !active) mobileMiniBarSeeking.value = false
    })
    const mobileMiniBarSeekValueText = computed(() => {
      const range = player?.seekRange()
      return formatDurationAsTimestamp(range
        ? range.start + (range.end - range.start) * mobileMiniBarProgress.value
        : 0)
    })

    /** @param {Event} event */
    function handleMobileMiniBarSeekInput(event) {
      if (mobileMiniBarSeekDisabled.value || !(event.target instanceof HTMLInputElement)) return
      const fraction = Math.min(1, Math.max(0, event.target.valueAsNumber / 100))
      if (!Number.isFinite(fraction)) return
      const range = player.seekRange()
      seekBySeconds(range.start + (range.end - range.start) * fraction - video.value.currentTime, false, false, false)
      updateMobileMiniBarProgress()
    }

    /** @param {PointerEvent} event */
    function startMobileMiniBarSeek(event) {
      if (mobileMiniBarSeekDisabled.value || !event.isPrimary || event.button !== 0) return
      mobileMiniBarSeeking.value = true
      seekHistoryJump = null
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    // The window may have resized while docked. Measure the settled inline
    // player once, after the return animation, rather than its scaled bounds.
    watch([scrollMiniPlayerActive, scrollMiniPlayerAnimating, scrollMiniPlayerDragStyle], ([active, animating, dragging]) => {
      if (!active && !animating && !dragging) nextTick(remeasureControlPanelWidth)
    })

    let androidRotationFullscreen = false
    let androidRotationOrientationLocked = false
    let androidRotationLockAttempt = 0

    function exitAndroidRotationFullscreen() {
      androidRotationLockAttempt++
      if (!androidRotationFullscreen) return
      androidRotationFullscreen = false
      if (androidRotationOrientationLocked) {
        androidRotationOrientationLocked = false
        setLandscapeOrientation(false).catch(() => {})
      }
      if (fullWindowEnabled.value) events.dispatchEvent(new CustomEvent('setFullWindow', { detail: false }))
      if (androidFullscreenHost?.matches(':popover-open')) androidFullscreenHost.hidePopover()
      androidFullscreenHost?.removeAttribute('popover')
      setAndroidNavigationBarVisible(true).catch(() => {})
      syncAndroidStatusBarVisibility()
    }

    function handleAndroidRotationPopoverToggle(event) {
      if (event.newState === 'closed') exitAndroidRotationFullscreen()
    }

    function handleAndroidRotation(landscape) {
      if (!isActiveTab.value || !ui || !fullWindowListenerReady) return
      if (pictureInPictureActive.value || androidFullscreenEntering) return
      if (!landscape) {
        if (androidRotationFullscreen) exitAndroidRotationFullscreen()
        else if (isNativeFullscreenActive()) {
          document.exitFullscreen().catch(() => {})
        }
        return
      }
      // Resume can deliver portrait before the visibility event reaches the renderer.
      if (!mobileAdjustmentsVisible.value) return
      // Use display rotation by default; physical rotation is an explicit opt-in.
      if (!enterFullscreenOnDisplayRotate.value || scrollMiniPlayerActive.value || props.format === 'audio' || props.shortsPlayer) return
      if (!video.value?.readyState || pictureInPictureActive.value) return
      if (androidRotationFullscreen || isNativeFullscreenActive() || !androidFullscreenHost) return
      androidFullscreenHost.setAttribute('popover', 'manual')
      androidFullscreenHost.showPopover()
      androidRotationFullscreen = true
      events.dispatchEvent(new CustomEvent('setFullWindow', { detail: true }))
      if (!fullWindowEnabled.value) {
        exitAndroidRotationFullscreen()
        return
      }
      if (fullscreenRotationIgnoresSystemLock.value) {
        androidRotationOrientationLocked = true
        const attempt = ++androidRotationLockAttempt
        setLandscapeOrientation(true).catch(() => {
          if (attempt === androidRotationLockAttempt) exitAndroidRotationFullscreen()
        })
      }
      setAndroidNavigationBarVisible(false).catch(() => {})
      syncAndroidStatusBarVisibility()
    }

    // Keep rotation fullscreen while Watch loads the next video. Until another
    // player adopts it, portrait or closing Watch still ends it.
    function handOffAndroidRotationFullscreen() {
      const host = androidFullscreenHost
      if (!androidRotationFullscreen || !host?.isConnected) return
      androidRotationFullscreen = false
      const handoff = {
        orientationLocked: androidRotationOrientationLocked,
        released: false,
        release() {
          if (handoff.released) return
          handoff.released = true
          handoff.stopRotation()
          if (handoff.orientationLocked) setLandscapeOrientation(false).catch(() => {})
          if (host.matches(':popover-open')) host.hidePopover()
          host.removeAttribute('popover')
          setAndroidNavigationBarVisible(true).catch(() => {})
        },
      }
      androidRotationFullscreenHandoffs.set(host, handoff)
      handoff.stopRotation = (fullscreenRotationIgnoresSystemLock.value ? observeAndroidDeviceRotation : observeAndroidDisplayRotation)(landscape => {
        if (!landscape) handoff.release()
      })
    }

    function adoptAndroidRotationFullscreen() {
      const handoff = androidRotationFullscreenHandoffs.get(androidFullscreenHost)
      if (!handoff) return
      androidRotationFullscreenHandoffs.delete(androidFullscreenHost)
      // Portrait already ended this fullscreen while the video loaded.
      if (handoff.released) {
        startInFullwindow = false
        return
      }
      if (!props.startInFullwindow || props.shortsPlayer || !isActiveTab.value) {
        handoff.release()
        return
      }
      handoff.stopRotation()
      androidRotationFullscreen = true
      androidRotationOrientationLocked = handoff.orientationLocked
      syncAndroidStatusBarVisibility()
    }

    let stopAndroidRotation = () => {}
    watch([enterFullscreenOnDisplayRotate, isActiveTab, fullscreenRotationIgnoresSystemLock], ([enabled, active, ignoreLock]) => {
      stopAndroidRotation()
      exitAndroidRotationFullscreen()
      stopAndroidRotation = enabled && active && process.env.IS_CAPACITOR && !process.env.IS_IOS
        ? (ignoreLock ? observeAndroidDeviceRotation : observeAndroidDisplayRotation)(handleAndroidRotation)
        : () => {}
    }, { immediate: true })
    onBeforeUnmount(() => {
      handOffAndroidRotationFullscreen()
      stopAndroidRotation()
      exitAndroidRotationFullscreen()
      androidFullscreenHost?.removeEventListener('toggle', handleAndroidRotationPopoverToggle)
    })

    function handleFullscreenButtonClick(event) {
      finishAndroidFullscreenExit(true)
      if (androidRotationFullscreen) {
        event.preventDefault()
        event.stopImmediatePropagation()
        exitAndroidRotationFullscreen()
        return
      }
      handleScrollMiniFullscreenButtonClick(event)
    }

    const mobileFullscreenBrightnessActive = computed(() => process.env.IS_CAPACITOR &&
      isActiveTab.value && !scrollMiniPlayerActive.value && mobileAdjustmentsVisible.value &&
      isFullscreen.value && store.getters.getMobileFullscreenBrightness)
    watch(mobileFullscreenBrightnessActive, enabled => mobileAdjustments.setFullscreenBrightness(Boolean(enabled)))
    watch([isActiveTab, scrollMiniPlayerActive, mobileAdjustmentsVisible, () => props.videoId], ([active, , visible, videoId], [, , previousVisible, previousVideoId]) => {
      // Revealing retained Watch during an upward drag presents this player
      // again. That transition must not cancel the gesture that caused it.
      // A committed close also survives visibility changes for the same video.
      resetMobileAdjustments(Boolean(videoId === previousVideoId && (
        (scrollMiniPlayerDragStyle.value && active && visible) ||
        (mobileMiniPlayerDismissSettling.value && visible !== previousVisible)
      )))
      if (mobileFullscreenBrightnessActive.value) mobileAdjustments.setFullscreenBrightness(true)
    })
    watch(() => [store.getters.getMobileLeftSwipeAction, store.getters.getMobileRightSwipeAction, store.getters.getEnableMobileFullscreenSeek], () => {
      cancelMobileFullscreenGesture()
      mobileAdjustments.cancel()
    })
    function handleMobileAdjustmentsVisibility() {
      mobileAdjustmentsVisible.value = !isAppHidden()
      if (process.env.IS_IOS && !mobileAdjustmentsVisible.value && !store.getters.getContinuePlaybackWhenScreenIsLocked) {
        video.value?.pause()
      }
    }
    onMounted(() => document.addEventListener('visibilitychange', handleMobileAdjustmentsVisibility))
    onBeforeUnmount(() => {
      document.removeEventListener('visibilitychange', handleMobileAdjustmentsVisibility)
      resetMobileAdjustments()
    })

    watch(scrollMiniPlayerDetached, (detached) => {
      isCrossTabMiniPlayerPresented.value = detached
      tabMediaCoordinator.setMiniPlayer(mediaTabId, detached)
    }, { immediate: true })

    watch([isActiveTab, isCrossTabMiniPlayerPresented, scrollMiniPlayerDismissed, audioPlayerMode], () => {
      screenWakeBinding?.update()
    })

    // Logical tabs restore their saved scroll position after becoming active.
    // Refresh once that restoration is complete so an already-active mini player
    // is placed directly at its saved bounds instead of replaying its entrance.
    useTabLifecycle({
      activate: () => updateScrollMiniPlayer({ animateActivation: false }),
      deactivate: rememberDockOrigin
    })

    const ambientModeVisible = computed(() => {
      return isActiveTab.value &&
        ambientMode.value &&
        props.format !== 'audio' &&
        props.vrProjection !== 'EQUIRECTANGULAR' &&
        !scrollMiniPlayerActive.value &&
        !scrollMiniPlayerAnimating.value &&
        !scrollMiniPlayerDragStyle.value
    })

    const musicVisualizerActive = computed(() => {
      return musicVisualizerEnabled.value &&
        isActiveTab.value &&
        !scrollMiniPlayerActive.value &&
        !scrollMiniPlayerAnimating.value &&
        !scrollMiniPlayerDragStyle.value &&
        !playerPaused.value
    })

    const { musicVisualizerCanvas } = useMusicVisualizer({
      active: musicVisualizerActive,
      video,
      sourceKey: () => `${props.videoId}:${props.playbackSourceKey}`,
    })

    const fullscreenAmbientBarsVisible = computed(() => {
      const contentAspectRatio = annotationVideoAspectRatio.value
      const elementWidth = videoElementWidth.value
      const elementHeight = videoElementHeight.value

      if (!isFullscreen.value || contentAspectRatio === null ||
        elementWidth === 0 || elementHeight === 0) {
        return false
      }

      const fittedWidth = Math.min(elementWidth, elementHeight * contentAspectRatio)
      const fittedHeight = Math.min(elementHeight, elementWidth / contentAspectRatio)
      const minimumBarSize = 1

      return elementWidth - fittedWidth > minimumBarSize ||
        elementHeight - fittedHeight > minimumBarSize
    })

    const { ambientCanvas, ambientFullscreenCanvas, ambientLayoutCanvas } = useAmbientMode({
      enabled: ambientModeVisible,
      video,
    })

    function updateVideoElementGeometry() {
      if (video.value) {
        const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1
        const video_ = video.value

        videoElementWidth.value = video_.clientWidth * devicePixelRatio
        videoElementHeight.value = video_.clientHeight * devicePixelRatio
        videoElementLayoutHeight.value = video_.clientHeight
        updateAnnotationVideoAspectRatio()
        updateScrollMiniVideoAspectRatio()
      }
    }

    /** @type {ResizeObserver} */
    const videoResizeObserver = new ResizeObserver(updateVideoElementGeometry)

    /** @type {PictureInPictureWindow | null} */
    let pipWindow = null
    const pipWindowWidth = ref(null)
    const pipWindowHeight = ref(null)

    /**
     * @param {PictureInPictureEvent} event
     */
    function handleEnterPictureInPicture(event) {
      pictureInPictureActive.value = true
      pipWindow = event.pictureInPictureWindow
      tabMediaCoordinator.setPictureInPicture(mediaTabId, true)
      handlePictureInPictureResize()
      pipWindow.addEventListener('resize', handlePictureInPictureResize)

      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }

      notifyPictureInPictureState(true)
      syncPipToggleState(true)
    }

    function handleLeavePictureInPicture() {
      pictureInPictureActive.value = false
      tabMediaCoordinator.setPictureInPicture(mediaTabId, false)

      if (pipWindow) {
        pipWindow.removeEventListener('resize', handlePictureInPictureResize)
      }

      pipWindow = null
      pipWindowWidth.value = null
      pipWindowHeight.value = null

      notifyPictureInPictureState(false)
      syncPipToggleState(false)

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

      // Shaka's own UI only passes the track, so anything without `isUserAction`
      // is a selection the user made themselves. Only picking a track in the menu
      // changes the remembered auto-translation, toggling captions on doesn't.
      player.selectTextTrack = (track = null, isUserAction = true, isTrackChoice = isUserAction) => {
        const activeTextTrack = player.getTextTracks().find(textTrack => textTrack.active)

        if (isUserAction) {
          // A caption chosen while the tracks are still being added must not be replaced by the restored one
          restoreCaptionIndex = null

          // For videos played from a URL, Shaka applies the preferred captions only after the first frame
          // has loaded, if no captions are on by then. Drop the preference so it can't undo the user's choice.
          if (player.getConfiguration().preferredText.length > 0) {
            player.configure('preferredText', [])
          }

          emit('subtitles-state-user-set', track !== null)
        }

        if (track === null) {
          clearDisplayedCaptions()
        } else {
          lastSelectedCaptionTrack = track

          if (isTrackChoice) {
            rememberAutoTranslatedCaption(track)
          }

          if (activeTextTrack && activeTextTrack.id !== track.id) {
            selectTextTrack(null)
            clearDisplayedCaptions()
          }
        }

        selectTextTrack(track)
        emit('subtitles-state-updated', track !== null)
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
    /** @type {AbortController | undefined} */
    let foregroundLoadAbortController

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
      if (props.localFilePlayback || props.manifestMimeType !== MANIFEST_TYPE_SABR || ignoreErrors || video.value?.ended || backoffMs <= 0) {
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

    function ensureSabrStream() {
      if (!process.env.SUPPORTS_LOCAL_API || sabrStream || !props.sabrData) return

      sabrStream = /** @__NOINLINE__ */ setupSabrScheme(props.sabrData, () => player, () => sabrManifest, playerWidth, playerHeight)
      sabrAbortController = new AbortController()
      sabrStream.onBackoffRequested(({ backoffMs }) => {
        startSabrBackoffTimer(backoffMs)
      })
      sabrStream.onReloadOnce((reloadPlaybackContext) => {
        sabrAbortController.abort()
        clearSabrBackoffTimer()
        if (shortsNavigationSuspended.value) {
          // The parent handles reloads for the presented Short only.
          suspendedShortsSabrReload = { reloadPlaybackContext }
          return
        }
        emit('player-reload-requested', { ...getSabrReloadState(), reloadPlaybackContext })
      })
    }

    ensureSabrStream()

    // #endregion SABR

    // #region request/response filters

    /** @type {shaka.extern.RequestFilter} */
    function requestFilter(type, request, _context) {
      if (type === RequestType.SEGMENT) {
        request.uris = request.uris.map(avoidUnreachableGoogleVideoHost)
        const url = new URL(request.uris[0])
        if (url.hostname.endsWith('.googlevideo.com')) {
          // Give up on an unresponsive node as quickly as the other googlevideo requests do.
          // The parameters are shared with the player configuration, so replace them.
          request.retryParameters = { ...request.retryParameters, connectionTimeout: GOOGLEVIDEO_CONNECTION_TIMEOUT_MS }
        }
        const isSabrRequest = props.sabrData && url.protocol === `${props.sabrData.scheme}:`

        prepareGoogleVideoRequest(request, isSabrRequest)
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
      } else if (type === RequestType.MANIFEST && context.type === AdvancedRequestType.MASTER_PLAYLIST) {
        const manifest = new TextDecoder().decode(response.data)
        response.data = new TextEncoder().encode(ignoreLoneHlsVideoDefaults(preferOriginalHlsAudio(manifest))).buffer
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
      const activeVariant = player?.getVariantTracks().find(track => track.active)

      if (!activeVariant) {
        return null
      }

      const quality = getDashQualityFromDimensions(activeVariant.width, activeVariant.height)
      return quality === null ? null : `${quality}`
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
        variants = getDefaultAudioVariants(variants)
      }

      // In the codecs that automatic quality would play, so the preferred codec
      // can limit the resolution
      const autoVariants = variants.filter(variant => autoQualityVideoIds.has(variant.videoId))
      if (autoVariants.length > 0) {
        variants = autoVariants
      }

      if (variants.length === 0) return
      const isPortrait = variants[0].height > variants[0].width

      let matches = variants.filter(variant => {
        return quality === getDashQualityFromDimensions(variant.width, variant.height)
      })

      if (matches.length === 0) {
        matches = variants.filter(variant => {
          return quality > (isPortrait ? variant.width : variant.height)
        })
      }

      if (matches.length === 0) {
        const dimension = isPortrait ? 'width' : 'height'
        const lowest = Math.min(...variants.map(variant => variant[dimension]).filter(Number.isFinite))
        matches = variants.filter(variant => variant[dimension] === lowest)
        if (matches.length === 0) matches = [variants[0]]
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

      if (props.legacyFormats.length === 0) { return }

      const format = findLegacyFormatForQuality(props.legacyFormats, previousQuality)

      hasMultipleAudioTracks.value = false

      events.dispatchEvent(new CustomEvent('setLegacyFormat', {
        detail: {
          format,
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
      stats.codecs.audioCodec = codecsMatch?.groups?.audioCodec ?? ''

      stats.codecs.videoItag = itag
      stats.codecs.videoCodec = codecsMatch?.groups?.videoCodec ?? ''

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
      try {
        canvas.getContext('2d').drawImage(video_, 0, 0)
      } catch (error) {
        showToast({ message: t('Screenshot Error', { error: error.message }), icon: ['fas', 'circle-exclamation'] })
        return
      }

      // Navigator Clipboard API only supports PNG
      const format = screenshotMode.value === 'clipboard' ? 'png' : screenshotFormat.value
      const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`
      // imageQuality is ignored for pngs, so it is still okay to pass the quality value
      const imageQuality = screenshotQuality.value / 100

      const wasPlaying = !video_.paused
      const needsFilePicker = screenshotMode.value === 'prompt_folder' ||
        (process.env.IS_CAPACITOR && screenshotMode.value === 'default_folder' && !store.getters.getScreenshotFolderPath)
      const pauseForScreenshot = needsFilePicker || (!process.env.IS_ELECTRON && !process.env.IS_CAPACITOR)
      if (pauseForScreenshot && wasPlaying) {
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
            showToast({ message: t('Screenshot Error', { error: err.message }), icon: ['fas', 'circle-exclamation'] })
            canvas.remove()
            return
          }

          const filenameWithExtension = `${filename}.${format}`

          if (!process.env.IS_ELECTRON || screenshotMode.value === 'prompt_folder') {
            let directory
            if (process.env.IS_CAPACITOR && screenshotMode.value === 'default_folder') {
              directory = store.getters.getScreenshotFolderPath
              if (!directory) {
                directory = await chooseAndroidDirectory()
                if (!directory) return
                await store.dispatch('updateScreenshotFolderPath', directory)
              }
            }
            const saved = await writeFileWithPicker(
              filenameWithExtension,
              blob,
              format.toUpperCase(),
              mimeType,
              `.${format}`,
              'player-screenshots',
              'pictures',
              directory
            )

            if (saved) {
              showToast({ message: t('Screenshot Success'), icon: ['fas', 'file-image'] })
            }
          } else {
            const arrayBuffer = await blob.arrayBuffer()

            if (await window.ftElectron.writeToDefaultFolder(filenameWithExtension, arrayBuffer)) {
              showToast({ message: t('Screenshot Success'), icon: ['fas', 'file-image'] })
            }
          }
        }
      } catch (error) {
        console.error(error)
        showToast({ message: t('Screenshot Error', { error }), icon: ['fas', 'circle-exclamation'] })
      } finally {
        canvas.remove()

        if (pauseForScreenshot && wasPlaying) {
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
    /** @type {[string, shaka.extern.IUIElement.Factory][]} */
    const ownBigElementRegistrations = []

    /**
     * @param {typeof shakaControls | typeof shakaOverflowMenu | typeof shakaContextMenu} registry
     * @param {string} name
     * @param {shaka.extern.IUIElement.Factory} factory
     */
    function registerOwnElement(registry, name, factory) {
      ownElementRegistrations.push([registry, name, factory])
      registry.registerElement(name, factory)
    }

    function registerOwnBigElement(name, factory) {
      ownBigElementRegistrations.push([name, factory])
      shakaControls.registerBigElement(name, factory)
    }

    function reRegisterOwnElements() {
      for (const [registry, name, factory] of ownElementRegistrations) {
        registry.registerElement(name, factory)
      }
      for (const [name, factory] of ownBigElementRegistrations) {
        shakaControls.registerBigElement(name, factory)
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

    function registerQualitySelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class QualitySelectionFactory {
        create(rootElement, controls) {
          return new QualitySelection(events, rootElement, controls)
        }
      }

      registerOwnElement(shakaControls, 'quality', new QualitySelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'quality', new QualitySelectionFactory())
    }

    function registerCaptionSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class CaptionSelectionFactory {
        create(rootElement, controls) {
          // Shaka's factory registry is process-global, so this factory can be
          // invoked briefly while another player instance is being created.
          // Always use the player belonging to these controls instead of the
          // component's player, which may already have been destroyed.
          return new CaptionSelection(
            events,
            () => captionSettings.value,
            updateCaptionAppearance,
            resetCaptionAppearance,
            () => controls.getPlayer().isLive() ? [] : props.captionTranslations,
            caption => Boolean(findMatchingTextTrack(controls.getPlayer().getTextTracks(), caption)?.active),
            caption => selectCaptionTranslation(caption, controls.getPlayer()),
            {
              getOptions: () => {
                if (controls.getPlayer().isLive()) return []
                // The main track can't be shown a second time
                const activeTrack = controls.getPlayer().getTextTracks().find(track => track.active)
                return props.captions.filter(caption => !isShownAsMainCaption(caption, activeTrack))
              },
              isAvailable: () => {
                if (controls.getPlayer().isLive() || props.captions.length === 0) return false
                const activeTrack = controls.getPlayer().getTextTracks().find(track => track.active)
                // A translated main track leaves even a video's only original track free to show as the second one,
                // and a remembered secondary track always needs a way to turn it off
                return getSecondaryCaption() !== null || (activeTrack
                  ? props.captions.some(caption => !isShownAsMainCaption(caption, activeTrack))
                  : props.captions.length > 1)
              },
              isSelected: caption => caption === getSecondaryCaption(),
              select: caption => selectSecondaryCaption(caption),
            },
            {
              // Shaka can only add text tracks to a loaded video that isn't live
              isAvailable: () => {
                const captionPlayer = controls.getPlayer()
                const loadMode = captionPlayer.getLoadMode()
                return (loadMode === shaka.Player.LoadMode.MEDIA_SOURCE || loadMode === shaka.Player.LoadMode.SRC_EQUALS) &&
                  !captionPlayer.isLive()
              },
              load: () => loadLocalCaption(controls.getPlayer()),
            },
            { getOffset: () => captionTimingOffset, setOffset: updateCaptionTiming },
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaControls, 'captions', new CaptionSelectionFactory())
      registerOwnElement(shakaOverflowMenu, 'captions', new CaptionSelectionFactory())
    }

    /**
     * Lets the user pick an SRT or WebVTT file and shows it as a new caption track.
     * @param {shaka.Player} captionPlayer
     * @returns {Promise<boolean>}
     */
    async function loadLocalCaption(captionPlayer) {
      try {
        const file = await pickFileWithPicker(t('Video.Player.Subtitle File.Subtitle Files'), LOCAL_CAPTION_FILE_TYPES, 'local-captions')
        if (file === null || captionPlayer !== player) {
          return false
        }

        const text = normalizeLocalCaptionText(file.name, await file.text())
        const caption = createLocalCaption(file.name, text, captionPlayer.getTextTracks().map(track => track.label))
        // Check the file now, Shaka would only parse it once the track is shown
        const cues = caption && shaka.text.TextEngine.findParser(caption.mimeType)().parseMedia(
          new TextEncoder().encode(text),
          { periodStart: 0, segmentStart: 0, segmentEnd: Infinity, vttOffset: 0 },
          caption.url,
          []
        )
        if (!cues?.length) {
          throw new Error(`${file.name} contains no SRT or WebVTT subtitles`)
        }

        const track = await addCaptionTrack(caption, captionPlayer)
        if (captionPlayer !== player) {
          return false
        }

        localCaptions.value = [...localCaptions.value, caption]
        captionPlayer.selectTextTrack(track)
        return true
      } catch (error) {
        console.error('Failed to load the subtitle file', error)
        showToast({ message: t('Video.Player.Subtitle File.Error'), icon: ['fas', 'circle-exclamation'] })
        return false
      }
    }

    let captionTranslationSelectionGeneration = 0

    /**
     * Native WebVTT tracks bypass Shaka's networking engine, so authenticate
     * external captions before handing them to the player as well.
     * @param {{ url: string, label: string, language: string, mimeType: string }} caption
     * @param {shaka.Player} [captionPlayer]
     * @returns {Promise<shaka.extern.Track>}
     */
    async function addCaptionTrack(caption, captionPlayer = player) {
      const url = await getSubtitleRequestUrl(caption.url, store.getters)
      const track = await captionPlayer.addTextTrackAsync(
        url,
        caption.language,
        'captions',
        caption.mimeType,
        undefined,
        caption.label
      )
      if (!captionSources.has(captionPlayer)) captionSources.set(captionPlayer, new Map())
      captionSources.get(captionPlayer).set(track.id, caption)
      return track
    }

    /**
     * @param {{ url: string, label: string, language: string, mimeType: string }} caption
     * @param {shaka.Player} captionPlayer
     * @returns {Promise<boolean>}
     */
    async function selectCaptionTranslation(caption, captionPlayer) {
      if (captionPlayer.isLive()) {
        return false
      }

      const selectionGeneration = ++captionTranslationSelectionGeneration
      let track = findMatchingTextTrack(captionPlayer.getTextTracks(), caption)

      if (!track) {
        try {
          track = await addCaptionTrack(caption, captionPlayer)
        } catch (error) {
          handleError(error, 'addTextTrackAsync', caption)
          return false
        }
      }

      if (
        selectionGeneration !== captionTranslationSelectionGeneration ||
        captionPlayer !== player
      ) {
        return false
      }

      captionPlayer.selectTextTrack(track)
      return true
    }

    /**
     * Picking an auto-translation makes later videos open with captions translated into the same language,
     * picking any other track forgets it again.
     * @param {shaka.extern.Track} track
     */
    function rememberAutoTranslatedCaption(track) {
      // Tracks from a SABR manifest are not added by us, so they are only found through the caption list
      const caption = captionSources.get(player)?.get(track.id) ??
        props.captions.find(caption => findMatchingTextTrack([track], caption))
      const language = caption?.isAutotranslated ? caption.language : ''

      if (language !== store.getters.getAutoTranslatedCaptionLocale) {
        store.dispatch('updateAutoTranslatedCaptionLocale', language)
      }
    }

    function handleTextTrackChanged() {
      syncShortsCaptionsEnabled()
      restoreSecondaryCaption()
      updateSecondaryCaptionText()
    }

    function toggleCaptions() {
      const textTracks = player.getTextTracks()

      if (textTracks.length === 0) {
        return false
      }

      if (textTracks.some(track => track.active)) {
        player.selectTextTrack(null)
      } else {
        player.selectTextTrack(getTextTrackToEnable(textTracks), true, false)
      }

      showOverlayControls()
      return true
    }

    function toggleShortsPlayback() {
      if (video.value.paused) {
        video.value.play()
      } else {
        video.value.pause()
      }
    }

    function toggleShortsMuted() {
      video.value.muted = !video.value.muted
    }

    function syncShortsCaptionsEnabled() {
      const textTracks = player?.getTextTracks() ?? []
      shortsCaptionsAvailable.value = textTracks.length > 0
      shortsCaptionsEnabled.value = textTracks.some(track => track.active)
    }

    function toggleShortsCaptions() {
      if (toggleCaptions()) {
        syncShortsCaptionsEnabled()
      }
    }

    function openShortsOverflowMenu(event) {
      const buttonRect = event.currentTarget.getBoundingClientRect()
      const controlsContainer = ui?.getControls().getControlsContainer()
      const containerRect = controlsContainer?.getBoundingClientRect() ??
        container.value.getBoundingClientRect()
      container.value.style.setProperty(
        '--shorts-menu-top',
        `${buttonRect.bottom - containerRect.top + 8}px`
      )
      container.value.style.setProperty(
        '--shorts-menu-right',
        `${containerRect.right - buttonRect.right}px`
      )
      container.value?.querySelector('.shaka-overflow-menu-button')?.click()
    }

    function resetShortsOverflowMenu() {
      const controls = ui?.getControls()
      controls?.dispatchEvent(new shaka.util.FakeEvent('submenuclose'))
      controls?.getControlsContainer()
        .querySelectorAll('.shaka-overflow-menu, .shaka-settings-menu')
        .forEach(menu => menu.classList.add('shaka-hidden'))
      container.value?.style.removeProperty('--shorts-menu-top')
      container.value?.style.removeProperty('--shorts-menu-right')
    }

    function positionShortsContextMenu() {
      if (!props.shortsPlayer || !container.value) {
        return
      }

      const playerContainer = container.value
      const contextMenu = playerContainer.querySelector('.shaka-context-menu')
      contextMenu?.style.removeProperty('--shorts-context-menu-x')
      contextMenu?.style.removeProperty('--shorts-context-menu-y')

      requestAnimationFrame(() => {
        if (!contextMenu || contextMenu.classList.contains('shaka-hidden')) {
          return
        }

        const gap = 8
        const containerRect = playerContainer.getBoundingClientRect()
        const menuRect = contextMenu.getBoundingClientRect()
        const minLeft = containerRect.left + gap
        const maxRight = containerRect.right - gap
        const minTop = containerRect.top + gap
        const maxBottom = containerRect.bottom - gap
        const translateX = menuRect.left < minLeft
          ? minLeft - menuRect.left
          : Math.min(0, maxRight - menuRect.right)
        const translateY = menuRect.top < minTop
          ? minTop - menuRect.top
          : Math.min(0, maxBottom - menuRect.bottom)

        contextMenu.style.setProperty('--shorts-context-menu-x', `${translateX}px`)
        contextMenu.style.setProperty('--shorts-context-menu-y', `${translateY}px`)
      })
    }

    function handlePlayerMouseLeave(event) {
      handleScrollMiniPlayerLeave(event)
      container.value?.style.removeProperty('--shorts-quick-playback-rate-bar-opacity')

      // Dragging the seek bar keeps the controls up until the drag ends.
      if (props.shortsPlayer && !video.value.paused && !ui?.getControls().isSeeking()) {
        ui?.getControls().getControlsContainer().removeAttribute('shown')
      }
    }

    /**
     * Fade the Shorts quick playback controls in as the pointer approaches
     * without adding an invisible element that intercepts clicks.
     * @param {MouseEvent} event
     */
    function updateShortsQuickPlaybackRateBarProximity(event) {
      const playerContainer = container.value
      if (!playerContainer) {
        return
      }

      if (!props.shortsPlayer) {
        playerContainer.style.removeProperty('--shorts-quick-playback-rate-bar-opacity')
        return
      }

      const target = event.target instanceof Element ? event.target : null
      const playbackRateBar = playerContainer.querySelector('.ft-quick-playback-rate-bar')
      const seekBarTarget = target?.closest('.shaka-seek-bar-container')
      const focusedElement = document.activeElement
      if (
        seekBarTarget &&
        focusedElement instanceof HTMLElement &&
        playbackRateBar?.contains(focusedElement)
      ) {
        focusedElement.blur()
      }

      if (!playbackRateBar || seekBarTarget) {
        playerContainer.style.setProperty('--shorts-quick-playback-rate-bar-opacity', '0')
        return
      }

      const proximity = 36
      const bounds = playbackRateBar.getBoundingClientRect()
      const distanceX = Math.max(bounds.left - event.clientX, 0, event.clientX - bounds.right)
      const distanceY = Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom)
      const distance = Math.hypot(distanceX, distanceY)
      const opacity = Math.max(0, 1 - (distance / proximity))

      playerContainer.style.setProperty(
        '--shorts-quick-playback-rate-bar-opacity',
        opacity.toFixed(3)
      )
    }

    /**
     * In fullscreen Shaka's controls surface fills the viewport, so mouse
     * movement over the empty space would keep the controls visible. Prevent
     * those events from reaching Shaka and treat the explicit video-space
     * column like the inline player's hover area.
     * @param {MouseEvent} event
     */
    function handlePlayerMouseMove(event) {
      // Android sends a synthetic mouse move when a long press opens the
      // context menu, before the speed hold activates. Touch gestures own UI visibility.
      if (isCapacitorMobilePlayer() && event.sourceCapabilities?.firesTouchEvents && isPlayerSurfaceTarget(event.target)) {
        event.stopImmediatePropagation()
        return
      }
      // Touch browsers synthesize mouse movement after tapping a notice.
      // The notice keeps its own interactions without revealing player UI.
      if (event.target instanceof Element && event.target.closest('.skippedSegmentsWrapper')) return
      updateShortsQuickPlaybackRateBarProximity(event)

      const videoElement = video.value
      revealPausedInterface()

      if (!props.shortsPlayer || !isFullscreen.value || videoElement.paused) {
        return
      }

      const videoSpace = container.value?.querySelector('.shortsFullscreenVideoSpace')
      if (!videoSpace) {
        return
      }

      const bounds = videoSpace.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) {
        container.value.classList.remove('no-cursor')
        event.stopPropagation()
        ui?.getControls().getControlsContainer().removeAttribute('shown')
      }
    }

    function handlePlayerFocusIn(event) {
      handleScrollMiniPlayerEnter(event)
      revealPausedInterface()
    }

    function toggleShortsFullscreen() {
      togglePlayerFullScreen()
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
        if (syncingChapterOverlayButton) {
          return
        }

        const shouldOpen = event.detail && props.chapters.length > 0
        if (shouldOpen && props.shortsPhonePanels) {
          requestShortsPhonePanel('chapters')
          return
        }

        if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
          if (shouldOpen) ui?.getControls().hideSettingsMenus()
          emit('chapters-overlay-change', shouldOpen)
          return
        }

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
            chaptersAvailable,
            isNativeFullscreenActive() || fullWindowEnabled.value
              ? showChaptersOverlay.value
              : props.sidebarChaptersOpen,
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
      emit('dock-panel-change', {
        panel: 'comments',
        open,
        target: fullscreenCommentsOverlay.value
      })
    }

    function requestShortsPhonePanel(panel) {
      if (isNativeFullscreenActive()) ui?.getControls().toggleFullScreen()
      if (fullWindowEnabled.value) events.dispatchEvent(new CustomEvent('setFullWindow', { detail: false }))
      emit('open-phone-panel', panel)
    }

    function setFullscreenLiveChat(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.liveChatAvailable &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenLiveChat.value = open
      emit('dock-panel-change', {
        panel: 'liveChat',
        open,
        target: fullscreenLiveChatTarget.value
      })
    }

    function closeFullscreenLiveChat() {
      setFullscreenLiveChat(false)
    }

    function closeFullscreenComments() {
      setFullscreenComments(false)
    }

    function setFullscreenMetadata(shouldOpen) {
      const presentationActive = isNativeFullscreenActive() || fullWindowEnabled.value
      const open = Boolean(
        shouldOpen && !props.externalUrl && presentationActive
      )
      showFullscreenMetadata.value = open
      if (fullscreenTitleOverlay) {
        fullscreenTitleOverlay.ariaExpanded = String(open)
      }
      emit('dock-panel-change', {
        panel: 'metadata',
        open,
        target: fullscreenMetadataTarget.value,
        presentationActive
      })
    }

    function closeFullscreenMetadata() {
      setFullscreenMetadata(false)
    }

    function setFullscreenTranscript(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.captions.length > 0 &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenTranscript.value = open
      emit('dock-panel-change', {
        panel: 'transcript',
        open,
        target: fullscreenTranscriptTarget.value
      })
    }

    function closeFullscreenTranscript() {
      setFullscreenTranscript(false)
    }

    function dismissFullscreenTranscript() {
      dockedPanelMemory.set('transcript', false)
      closeFullscreenTranscript()
    }

    function toggleFullscreenTranscript() {
      if (props.shortsPhonePanels) {
        requestShortsPhonePanel('transcript')
        return
      }
      const shouldOpen = !showFullscreenTranscript.value

      if (shouldOpen !== props.transcriptOpen) {
        emit('toggle-transcript')
      }
      setFullscreenTranscript(shouldOpen)
    }

    function setFullscreenSponsorBlock(shouldOpen) {
      const open = Boolean(
        shouldOpen && (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenSponsorBlock.value = open
      emit('dock-panel-change', {
        panel: 'sponsorBlock',
        open,
        target: fullscreenSponsorBlockTarget.value
      })
    }

    function closeFullscreenSponsorBlock() {
      setFullscreenSponsorBlock(false)
    }

    function toggleFullscreenSponsorBlock() {
      if (props.shortsPhonePanels) {
        requestShortsPhonePanel('sponsorBlock')
        return
      }
      const shouldOpen = !showFullscreenSponsorBlock.value

      if (shouldOpen !== sponsorBlockInfoOpen.value) {
        toggleSponsorBlockInfo()
      }
      setFullscreenSponsorBlock(shouldOpen)
    }

    function setFullscreenPlaylist(shouldOpen) {
      const open = Boolean(
        shouldOpen && props.watchingPlaylist &&
        (isNativeFullscreenActive() || fullWindowEnabled.value)
      )
      showFullscreenPlaylist.value = open
      emit('dock-panel-change', {
        panel: 'playlist',
        open,
        target: fullscreenPlaylistTarget.value
      })
    }

    function closeFullscreenPlaylist() {
      setFullscreenPlaylist(false)
    }

    function setFullscreenQueue(shouldOpen) {
      const open = Boolean(shouldOpen && props.queueAvailable &&
        (isNativeFullscreenActive() || fullWindowEnabled.value))
      showFullscreenQueue.value = open
      emit('dock-panel-change', { panel: 'queue', open, target: fullscreenQueueTarget.value })
    }

    function closeFullscreenQueue() {
      setFullscreenQueue(false)
    }

    function setFullscreenRecommendations(shouldOpen) {
      const open = Boolean(shouldOpen && props.recommendationsAvailable &&
        (isNativeFullscreenActive() || fullWindowEnabled.value))
      showFullscreenRecommendations.value = open
      emit('dock-panel-change', { panel: 'recommendations', open, target: fullscreenRecommendationsTarget.value })
    }

    function closeFullscreenRecommendations() {
      setFullscreenRecommendations(false)
    }

    /** @type {Record<import('./opentubex/dockedPanels').DockedPanel, { shown: import('vue').Ref<boolean>, set: (open: boolean) => void }>} */
    const dockedPanels = {
      chapters: {
        shown: showChaptersOverlay,
        set: open => events.dispatchEvent(new CustomEvent('setChaptersOverlay', {
          detail: open && props.chapters.length > 0
        }))
      },
      comments: { shown: showFullscreenComments, set: setFullscreenComments },
      liveChat: { shown: showFullscreenLiveChat, set: setFullscreenLiveChat },
      metadata: { shown: showFullscreenMetadata, set: setFullscreenMetadata },
      transcript: { shown: showFullscreenTranscript, set: setFullscreenTranscript },
      sponsorBlock: { shown: showFullscreenSponsorBlock, set: setFullscreenSponsorBlock },
      queue: { shown: showFullscreenQueue, set: setFullscreenQueue },
      recommendations: { shown: showFullscreenRecommendations, set: setFullscreenRecommendations },
      playlist: { shown: showFullscreenPlaylist, set: setFullscreenPlaylist },
    }

    function rememberAndCloseDockedPanels() {
      for (const panel of DOCKED_PANEL_CLOSE_ORDER) {
        dockedPanelMemory.set(panel, dockedPanels[panel].shown.value)
      }
      for (const panel of DOCKED_PANEL_CLOSE_ORDER) {
        dockedPanels[panel].set(false)
      }
    }

    function restoreDockedPanels() {
      if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
        return
      }

      for (const panel of DOCKED_PANEL_RESTORE_ORDER) {
        if (dockedPanelMemory.take(panel)) dockedPanels[panel].set(true)
      }
    }

    watch(() => props.commentsAvailable, available => {
      if (!available && showFullscreenComments.value) {
        closeFullscreenComments()
      }
    })

    watch(() => props.liveChatAvailable, available => {
      if (!available && showFullscreenLiveChat.value) closeFullscreenLiveChat()
    })

    watch(() => props.captions.length, captionCount => {
      if (captionCount === 0 && showFullscreenTranscript.value) {
        dismissFullscreenTranscript()
      }
    })

    watch(() => props.queueAvailable, available => {
      if (!available) {
        dockedPanelMemory.set('queue', false)
        if (showFullscreenQueue.value) closeFullscreenQueue()
      }
    })

    watch(() => props.recommendationsAvailable, available => {
      if (!available && showFullscreenRecommendations.value) closeFullscreenRecommendations()
    })

    watch(() => props.watchingPlaylist, watching => {
      if (!watching && showFullscreenPlaylist.value) {
        closeFullscreenPlaylist()
      }
    })

    watch(() => props.shortsMetadataOpen, open => {
      if (!props.shortsPlayer || props.shortsPhonePanels) {
        return
      }

      if (isNativeFullscreenActive() || fullWindowEnabled.value) {
        if (open) expandCollapsedFullscreenDock('metadata')
        setFullscreenMetadata(open)
      } else {
        dockedPanelMemory.set('metadata', open)
      }
    }, { immediate: true })

    watch(() => props.sidebarChaptersOpen, () => {
      if (!isNativeFullscreenActive() && !fullWindowEnabled.value) {
        syncChapterOverlayButton()
      }
    })

    watch(() => props.title, title => {
      if (fullscreenTitleOverlay) {
        fullscreenTitleOverlay.textContent = title
        fullscreenTitleOverlay.ariaLabel = `${t('Video.Metadata', 'Video information')}: ${title}`
      }
    })

    watch(fullWindowEnabled, enabled => {
      if (!enabled && androidRotationFullscreen) exitAndroidRotationFullscreen()
      if (!enabled && !isNativeFullscreenActive()) {
        rememberAndCloseDockedPanels()
      }
    })

    watch(chapterThumbnails, (thumbnails) => {
      emit('chapter-thumbnails-change', thumbnails)
    })

    let chapterThumbnailLoadGeneration = 0
    async function loadChapterThumbnails() {
      const loadGeneration = ++chapterThumbnailLoadGeneration
      chapterThumbnails.value = []

      if (!chapterThumbnailsWanted) {
        return
      }

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

      if (loadGeneration === chapterThumbnailLoadGeneration && player === activePlayer && props.videoId === videoId) {
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
        // Moving the player while its overflow menu is open can leave both the
        // menu DOM and its submenu state stuck. Reset both synchronously; the
        // public hide method uses a timer and can otherwise lose a race with
        // the layout transition and the next overflow-button click.
        resetShortsOverflowMenu()

        fullWindowAnimation?.cancel()
        fullWindowAnimation = null

        const playerContainer = container.value
        const shouldAnimate = playerContainer !== null && !isReducedMotionEnabled()
        const animationDuration = shouldAnimate
          ? FULL_WINDOW_ANIMATION_DURATION_MS / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)
          : FULL_WINDOW_ANIMATION_DURATION_MS
        suppressPanelTransitions(animationDuration + 50)
        const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null

        if (event.detail) {
          fullWindowPlaceholderHeight.value = playerContainer.getBoundingClientRect().height
        }

        fullWindowEnabled.value = event.detail
        syncChapterOverlayButton()

        if (fullWindowEnabled.value) {
          restoreDockedPanels()
        }

        if (fullWindowEnabled.value) {
          document.body.dataset.playerFullWindowOwner = mediaTabId
          document.body.classList.add('playerFullWindow')
          document.documentElement.classList.add('appPlayerFullWindow')
        } else if (document.body.dataset.playerFullWindowOwner === mediaTabId) {
          delete document.body.dataset.playerFullWindowOwner
          document.body.classList.remove('playerFullWindow')
          document.documentElement.classList.remove('appPlayerFullWindow')
          // Nested fullscreen or Picture-in-Picture can leave the page instance
          // with the zero-overflow range it measured while this class was active.
          updateOverlayScrollbars(document.body)
        }

        if (process.env.IS_IOS) document.dispatchEvent(new Event('fullscreenchange'))

        if (previousRect === null) {
          return
        }

        await nextTick()
        const nextRect = playerContainer.getBoundingClientRect()
        const animation = applyAnimationSpeed(playerContainer.animate([
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
        }))

        fullWindowAnimation = animation
        animation.addEventListener('finish', () => {
          if (fullWindowAnimation === animation) {
            fullWindowAnimation = null
          }
        })
      })

      // The handoff keeps watching for portrait until this player can handle rotation.
      adoptAndroidRotationFullscreen()
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

    function registerAndroidPictureInPictureButton() {
      if (!process.env.IS_CAPACITOR || process.env.IS_IOS) return

      events.addEventListener('enterAndroidPictureInPicture', () => {
        enterAndroidPictureInPicture(video.value).catch(error => {
          console.error('Failed to enter Android Picture-in-Picture:', error)
        })
      })

      class AndroidPictureInPictureButtonFactory {
        create(rootElement, controls) {
          return new AndroidPictureInPictureButton(events, rootElement, controls)
        }
      }

      const factory = new AndroidPictureInPictureButtonFactory()
      registerOwnElement(shakaControls, 'ft_android_picture_in_picture', factory)
      registerOwnElement(shakaOverflowMenu, 'ft_android_picture_in_picture', factory)
    }

    function registerShortsVideoInfoButton() {
      events.addEventListener('toggleShortsMetadata', () => {
        emit('toggle-shorts-metadata')
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class ShortsVideoInfoButtonFactory {
        create(rootElement, controls) {
          return new ShortsVideoInfoButton(events, rootElement, controls)
        }
      }

      registerOwnElement(
        shakaOverflowMenu,
        'ft_shorts_video_info',
        new ShortsVideoInfoButtonFactory()
      )
    }

    function registerLegacyQualitySelection() {
      let selectionGeneration = 0
      /**
       * Loading a new source pauses the media element, and its autoplay
       * attribute then starts it again. Keep the state from before the first
       * pending user selection, as a newer one finds the element paused.
       * @type {{ wasPaused: boolean, autoplay: boolean, trackPlayback: () => void } | null}
       */
      let selectionPlaybackState = null

      events.addEventListener('setLegacyFormat', async (/** @type {CustomEvent} */ event) => {
        const currentSelectionGeneration = ++selectionGeneration
        const {
          format,
          playbackPosition,
          playbackRate = getPlaybackRateToRestore(),
          restoreCaptionIndex: restoreCaptionIndex_ = null,
          userSelected = false
        } = event.detail
        const mediaElement = video.value

        if (userSelected && selectionPlaybackState === null) {
          // A video still waiting for autoplay counts as playing.
          const awaitingAutoplay = mediaElement.autoplay && mediaElement.played.length === 0 &&
            !initialAutoplayCanceled && mediaElement.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA
          const state = {
            wasPaused: mediaElement.paused && !awaitingAutoplay,
            autoplay: mediaElement.autoplay,
            // Playing or pausing while the selection is pending replaces that state. Loading the
            // new source pauses the element without a pause event, so this only sees other changes.
            trackPlayback: () => { state.wasPaused = mediaElement.paused }
          }
          mediaElement.addEventListener('play', state.trackPlayback)
          mediaElement.addEventListener('pause', state.trackPlayback)
          selectionPlaybackState = state
        }

        queuePlaybackRateRestore(playbackRate)

        if (restoreCaptionIndex_ !== null) {
          restoreCaptionIndex = restoreCaptionIndex_
        }

        activeLegacyFormat.value = event.detail.format
        emit('legacy-format-selected', format)
        const quality = getQualityFromDimensions(format.width, format.height)

        // Only remember the quality when the user picked it themselves. The legacy formats top out
        // at 360p, so remembering an automatically chosen one would downgrade the preferred quality
        // when switching back to the DASH formats.
        if (userSelected && quality !== null) {
          emit('video-quality-updated', quality)
          emit('video-quality-user-set', quality)
        }

        let loaded = false
        try {
          const isAvailable = await waitForYtDlpFormatAvailability(format)

          if (currentSelectionGeneration !== selectionGeneration) {
            return
          }

          if (!isAvailable) {
            throw new Error('yt-dlp format availability delay is too long')
          }

          if (selectionPlaybackState?.wasPaused) {
            mediaElement.autoplay = false
          }

          // The media element loads progressive streams without the request filter
          await loadPlaybackSource(avoidUnreachableGoogleVideoHost(format.url), playbackPosition, format.mimeType)
          loaded = true
        } catch (error) {
          handleError(error, 'setLegacyFormat', event.detail)
        }

        if (currentSelectionGeneration !== selectionGeneration || selectionPlaybackState === null) {
          return
        }

        const { wasPaused, autoplay, trackPlayback } = selectionPlaybackState
        selectionPlaybackState = null
        mediaElement.removeEventListener('play', trackPlayback)
        mediaElement.removeEventListener('pause', trackPlayback)

        if (loaded) {
          // Pausing also keeps the restored autoplay attribute from starting the new source.
          if (wasPaused) {
            mediaElement.pause()
          } else {
            mediaElement.play().catch(() => {})
          }
        }

        mediaElement.autoplay = autoplay
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

    function registerMusicVisualizerButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class MusicVisualizerButtonFactory {
        create(rootElement, controls) {
          return new MusicVisualizerButton(
            musicVisualizer,
            updateMusicVisualizer,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(
        shakaOverflowMenu,
        'ft_music_visualizer',
        new MusicVisualizerButtonFactory()
      )
    }

    function registerVideoZoomSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class VideoZoomSelectionFactory {
        create(rootElement, controls) {
          return new LevelSelection(
            {
              value: videoZoom,
              updateValue: updateVideoZoom,
              levels: VIDEO_ZOOM_LEVELS,
              defaultLevel: DEFAULT_VIDEO_ZOOM,
              formatLevel: zoom => zoom === DEFAULT_VIDEO_ZOOM ? t('Video.Player.Zoom.Off') : formatVideoZoom(zoom),
              getLabel: () => t('Video.Player.Zoom.Zoom'),
              icon: { path: PlayerIcons.ZOOM_IN_ROUNDED, viewBox: ZOOM_IN_ICON_VIEWBOX },
              className: 'video-zoom',
            },
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_video_zoom', new VideoZoomSelectionFactory())
    }

    function registerVolumeBoostSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class VolumeBoostSelectionFactory {
        create(rootElement, controls) {
          return new LevelSelection(
            {
              value: volumeBoost,
              updateValue: updateVolumeBoost,
              levels: VOLUME_BOOST_LEVELS,
              defaultLevel: DEFAULT_VOLUME_BOOST,
              formatLevel: boost => boost === DEFAULT_VOLUME_BOOST
                ? t('Video.Player.Volume Boost.Off')
                : `${Math.round(boost * 100)}%`,
              getLabel: () => t('Video.Player.Volume Boost.Volume Boost'),
              mappedIcon: 'volume-high',
              className: 'volume-boost',
            },
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_volume_boost', new VolumeBoostSelectionFactory())
    }

    function registerMonoAudioButton() {
      registerOwnElement(shakaOverflowMenu, 'ft_mono_audio', {
        create(rootElement, controls) {
          return new BooleanSettingButton({
            value: monoAudio,
            updateValue: value => store.dispatch('updateMonoAudio', value),
            events,
            className: 'mono-audio-button',
            mappedIcon: 'speaker',
            getLabel: () => t('Settings.Player Settings.Mono Audio'),
          }, rootElement, controls)
        }
      })
    }

    function registerLightsOffButton() {
      registerOwnElement(shakaOverflowMenu, 'ft_lights_off', {
        create(rootElement, controls) {
          return new BooleanSettingButton({
            value: lightsOff,
            updateValue: value => store.commit('setTabLightsOff', { tabId: mediaTabId, value }),
            events,
            className: 'lights-off-button',
            mappedIcon: 'moon',
            getLabel: () => t('Settings.Player Settings.Lights Off'),
          }, rootElement, controls)
        }
      })
    }

    function registerMusicModeButton() {
      registerOwnElement(shakaOverflowMenu, 'ft_music_mode', {
        create(rootElement, controls) {
          return new BooleanSettingButton({
            value: musicMode,
            updateValue: value => store.commit('setTabMusicMode', { tabId: mediaTabId, value }),
            events,
            className: 'music-mode-button',
            mappedIcon: 'headphones',
            getLabel: () => t('Video.Player.Music Mode'),
          }, rootElement, controls)
        }
      })
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

    function registerVoiceOverTranslationButton() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class VoiceOverTranslationButtonFactory {
        create(rootElement, controls) {
          return new VoiceOverTranslationButton(
            voiceOverTranslation.state,
            voiceOverTranslation.enabled,
            voiceOverTranslation.toggle,
            events,
            rootElement,
            controls
          )
        }
      }

      registerOwnElement(
        shakaOverflowMenu,
        'ft_voice_over_translation',
        new VoiceOverTranslationButtonFactory()
      )
    }

    function registerSleepTimer() {
      events.addEventListener('setSleepTimerDuration', (/** @type {CustomEvent} */ event) => {
        sleepTimer.startDuration(event.detail)
      })
      events.addEventListener('setSleepTimerEndOfVideo', () => {
        sleepTimer.startEndOfVideo()
      })
      events.addEventListener('setSleepTimerEndOfChapter', (/** @type {CustomEvent} */ event) => {
        sleepTimer.startEndOfChapter(event.detail)
      })
      events.addEventListener('cancelSleepTimer', () => {
        sleepTimer.cancel()
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class SleepTimerFactory {
        create(rootElement, controls) {
          return new SleepTimer(sleepTimer, !isLive.value, currentChapterEndSeconds, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_sleep_timer', new SleepTimerFactory())
    }

    function registerSeekHistoryMenu() {
      events.addEventListener('seekHistorySelect', selectSeekHistoryEntry)

      /** @implements {shaka.extern.IUIElement.Factory} */
      class SeekHistoryMenuFactory {
        create(rootElement, controls) {
          return new SeekHistoryMenu(seekHistory, seekHistoryChapters, events, rootElement, controls)
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_seek_history', new SeekHistoryMenuFactory())
    }

    /** @type {(() => void) | null} */
    let removeAbRepeatContext = null
    /** @type {(() => void) | null} */
    let removeLoopButtonContext = null

    function registerAbRepeatControl() {
      const controls = ui?.getControls()
      if (controls) {
        removeAbRepeatContext?.()
        removeAbRepeatContext = setAbRepeatContext(controls, {
          start: abRepeatStart,
          end: abRepeatEnd,
          enabled: abRepeatEnabled,
          validation: abRepeatValidation,
          validationMessage: abRepeatValidationMessage,
          setCurrentBoundary: setCurrentAbRepeatBoundary,
          toggle: toggleAbRepeat,
          clear: clearAbRepeat,
          getShortcut: action => ({
            start: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_START,
            end: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_END,
            clear: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.CLEAR_AB_REPEAT,
          })[action],
        })
        removeLoopButtonContext?.()
        removeLoopButtonContext = setLoopButtonContext(controls, {
          isEnabled: () => Boolean(video.value?.loop || abRepeatEnabled.value),
          isVisible: location => location !== 'overflow' || !abRepeatAvailable.value,
          subscribe: callback => watch([abRepeatAvailable, abRepeatEnabled], callback),
          toggle: () => {
            if (abRepeatAvailable.value) {
              toggleAbRepeat()
            } else if (video.value) {
              video.value.loop = !video.value.loop
            }
          },
        })
      }

      class AbRepeatControlFactory {
        create(rootElement, controls) {
          return new AbRepeatControl(rootElement, controls)
        }
      }

      registerOwnElement(shakaOverflowMenu, 'ft_ab_repeat', new AbRepeatControlFactory())
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
        if (props.externalUrl) return props.externalUrl
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
       * @returns {string | null}
       */
      function getCopySuccessMessage(backend, includeTimestamp) {
        if (props.externalUrl) return null
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
        if (props.externalUrl) return t('Share.Copy Link')
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
          return new SponsorBlockHighlightButton(events, rootElement, controls, getSponsorBlockHighlightState())
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
      registerOwnBigElement('ft_skip_next', new SkipNextButtonFactory())
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
      registerOwnBigElement('ft_skip_previous', new SkipPreviousButtonFactory())
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

        setPlaybackRate(playbackRate)
      })

      events.addEventListener('removeChannelPlaybackSpeed', () => {
        removeChannelPreference(store, props.channelId, 'playbackSpeed')
      })

      events.addEventListener('saveChannelPlaybackSpeed', () => {
        emit('save-channel-playback-speed')
      })

      const controls = ui?.getControls()
      if (controls) {
        removeQuickPlaybackRateBarContext?.()
        removeQuickPlaybackRateBarContext = setQuickPlaybackRateBarContext(controls, {
          getPlaybackRateOptions: () => quickPlaybackSpeedBarOptions.value,
          getDisplayedPlaybackRate: getCurrentPlaybackRate,
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
      removeAbRepeatContext?.()
      removeAbRepeatContext = null

      removeLoopButtonContext?.()
      removeLoopButtonContext = null

      removeCopyVideoUrlContext?.()
      removeCopyVideoUrlContext = null

      removeQuickPlaybackRateBarContext?.()
      removeQuickPlaybackRateBarContext = null

      if (!registeredCustomControls) {
        return
      }
      registeredCustomControls = false
      liveCustomControlPlayers.delete(reRegisterOwnElements)

      // Clear exactly what this instance registered, including optional controls.
      for (const [registry, name] of ownElementRegistrations) {
        registry.registerElement(name, defaultShakaElementFactories.get(name) ?? null)
      }
      for (const [name] of ownBigElementRegistrations) {
        shakaControls.registerBigElement(name, null)
      }
      ownElementRegistrations.length = 0
      ownBigElementRegistrations.length = 0

      // Reapply a survivor's factories synchronously so its next ui.configure()
      // never uses a disposed player's closures or a null factory.
      liveCustomControlPlayers.values().next().value?.()
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

    const {
      showTemporaryPlaybackRateIndicator,
      temporaryPlaybackRateIndicatorMessage,
      isMusicVideoDetected,
      getDefaultPlaybackRateForVideo,
      getInitialPlaybackRate,
      getUnforcedPlaybackRate,
      showMusicPlaybackRateToast,
      flushPendingMusicPlaybackRateToast,
      getCurrentPlaybackRate,
      getPlaybackRateToRestore,
      isPlaybackRateRestoreQueued,
      queuePlaybackRateRestore,
      restorePendingPlaybackRate,
      startTemporaryPlaybackRateHold,
      finishTemporaryPlaybackRateHold,
      cancelTemporaryPlaybackRateHolds,
      isTemporaryPlaybackRateActive,
      isTemporaryPlaybackRateSourceActive,
      isTemporaryPlaybackRateHoldPending,
      consumeTemporaryPlaybackRatePause,
      applyMusicModePlaybackRate,
      setVideoPlaybackRate,
      setPlaybackRate,
      handlePlayerMenuPlaybackRateSelected,
      applyPlaybackRate,
      changePlayBackRate,
      getSteppedPlaybackRate,
      toggleNormalPlaybackRate,
    } = usePlaybackRate({
      video,
      getPlayer: () => player,
      hasLoaded,
      isLive,
      musicMode,
      hasSponsorBlockMusicOfftopicSegment,
      shortsNavigationSuspended,
      props,
      defaultPlaybackRate,
      maxVideoPlaybackRate,
      videoPlaybackRateInterval,
      savedChannelPlaybackRate,
      holdToDoublePlaybackSpeed,
      onPlaybackRateUpdated: rate => emit('playback-rate-updated', rate),
      onPlaybackRateUserSet: rate => emit('playback-rate-user-set', rate),
      updatePendingPlaybackRateMenu,
      showValueChange,
      showToast,
      t,
    })

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
     * @param {boolean} revealControls Whether seeking should reveal the player controls
     */
    function seekBySeconds(seconds, canSeekResult = false, showPopUp = false, revealControls = true) {
      if (!(canSeekResult || canSeek())) {
        return
      }
      endSeekTarget = null

      const seekRange = player.seekRange()

      const video_ = video.value

      const currentTime = video_.currentTime
      const newTime = currentTime + seconds

      if (newTime < seekRange.start) {
        rememberSeekPosition(seekRange.start, true)
        video_.currentTime = seekRange.start
      } else if (newTime > seekRange.end) {
        if (isLive.value) {
          player.goToLive()
        } else {
          rememberSeekPosition(seekRange.end, true)
          video_.currentTime = seekRange.end
        }
      } else {
        rememberSeekPosition(newTime, true)
        video_.currentTime = newTime
      }
      if (showPopUp) {
        const totalSeconds = accumulatedSeekSeconds + seconds
        const popUpLayout = totalSeconds > 0
          ? { icon: 'arrow-right', invertContentOrder: true }
          : { icon: 'arrow-left', invertContentOrder: false }
        // `+value` converts string back to float
        const formattedSeconds = +Math.abs(totalSeconds).toFixed(2)
        showValueChange(`${formattedSeconds}s`, popUpLayout.icon, popUpLayout.invertContentOrder, totalSeconds)
      } else {
        accumulatedSeekSeconds = 0
      }

      if (revealControls) showOverlayControls()
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

      // The seekbar keeps focus after scrubbing and must still allow player shortcuts.
      if (target.classList.contains('shaka-seek-bar') || target.closest('.scrollMiniPlayerControls')) {
        return false
      }

      return target.classList.contains('ft-input') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.getAttribute('role') === 'combobox' ||
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

      const wasPending = isTemporaryPlaybackRateHoldPending(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)
      const wasActive = isTemporaryPlaybackRateSourceActive(TEMPORARY_PLAYBACK_RATE_KEYBOARD_SOURCE)

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
      if (isAppHidden()) {
        handleTemporaryPlaybackRateFocusLoss()
      }
    }

    /**
     * @param {KeyboardEvent} event
     */
    async function keyboardShortcutHandler(event) {
      // destroyPlayer() releases ui before the player finishes destroying.
      if (!ui || !player || !isActiveTab.value) {
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
          if (ui?.getControls().anyContextMenusAreOpen()) {
            event.preventDefault()
            ui.getControls().hideContextMenus()
            break
          }
          // Exit full window
          if (fullWindowEnabled.value) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('setFullWindow', {
              detail: false
            }))
          }
          break
        case !process.env.IS_CAPACITOR && matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLWINDOW):
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
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED_ALT):
          // Decrease playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(-videoPlaybackRateInterval.value, true)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED_ALT):
          // Increase playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(videoPlaybackRateInterval.value, true)
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_NORMAL_PLAYBACK_SPEED):
          // Toggle between 1x and the previous playback speed
          event.preventDefault()
          toggleNormalPlaybackRate()
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
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_SKIP_SILENCE): {
          if (process.env.IS_IOS) break
          event.preventDefault()
          const enabled = !skipSilence.value
          updateSkipSilence(enabled)

          // Only confirm the state that was actually applied to this tab.
          if (skipSilence.value !== enabled) {
            break
          }

          const localization = ui.getControls().getLocalization()
          const message = localization.resolve(enabled ? 'ON' : 'OFF')
          showValueChange(message, ['step-forward', 'volume-xmark'], true)
          blurTooltipButtons()
          break
        }
      }

      if (event.defaultPrevented) {
        return
      }

      if (!hasLoaded.value) {
        return
      }

      if (!store.getters.isAnyPromptOpen && !store.getters.getSettingsWindowOpen &&
        !sponsorBlockSubmissionPending.value) {
        const shortcuts = KeyboardShortcuts.VIDEO_PLAYER.SPONSORBLOCK
        const submissionActions = [
          [shortcuts.START_SPONSORBLOCK_SEGMENT, 'start', 'startSponsorBlockSegment'],
          [shortcuts.END_SPONSORBLOCK_SEGMENT, 'end', 'endSponsorBlockSegment'],
          [shortcuts.OPEN_SPONSORBLOCK_SUBMISSION_MENU, 'menu', 'toggleSponsorBlockSubmissionMenu'],
          [shortcuts.CANCEL_SPONSORBLOCK_SEGMENT, 'cancel', 'cancelSponsorBlockSegment'],
          [shortcuts.CLEAR_SPONSORBLOCK_SEGMENTS, 'clear', 'clearSponsorBlockSegments'],
        ]
        const action = submissionActions.find(([shortcut, button]) =>
          matches(shortcut) && sponsorBlockSubmissionVisibleButtons.value.includes(button))
        if (action) {
          event.preventDefault()
          if (!event.repeat) {
            events.dispatchEvent(new CustomEvent(action[2]))
          }
          return
        }
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
        case !disableAbRepeat.value && matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_START):
          event.preventDefault()
          setCurrentAbRepeatBoundary('start')
          break
        case !disableAbRepeat.value && matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_END):
          event.preventDefault()
          setCurrentAbRepeatBoundary('end')
          break
        case !disableAbRepeat.value && matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.CLEAR_AB_REPEAT):
          event.preventDefault()
          clearAbRepeat()
          showValueChange(t('Video.Player.A-B Repeat.Cleared'), AB_REPEAT_VALUE_CHANGE_ICON)
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
          if (canSeek() && props.chapters.length > 0 && props.currentChapterIndex > 0) {
            event.preventDefault()
            setCurrentTime(props.chapters[props.currentChapterIndex - 1].startSeconds, true)
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.NEXT_CHAPTER):
          if (canSeek() && props.chapters.length > 0 && props.currentChapterIndex < props.chapters.length - 1) {
            event.preventDefault()
            setCurrentTime(props.chapters[props.currentChapterIndex + 1].startSeconds, true)
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

            setCurrentTime(seekRange.start + (length * percentage), true)
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
            setCurrentTime(seekRange.start, true)
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.END):
          // Jump to end of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            const wasPaused = video_.paused
            setCurrentTime(seekRange.end, true)
            if (wasPaused && !isLive.value && !video_.loop &&
                !(abRepeatEnabled.value && hasValidAbRepeatRange())) {
              // Paused seeks need not fire ended, and Shaka can back off from
              // the duration. End still means replay, without counting a seek
              // as naturally completed playback.
              endSeekTarget = seekRange.end
              playbackEnded.value = !video_.seeking
              syncPlayPauseControlIcons()
            }
            showOverlayControls()
          }
          break
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.UNDO_SEEK):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.REDO_SEEK):
          if (seekHistoryAvailable.value && canSeek()) {
            event.preventDefault()
            stepSeekHistory(matches(KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.UNDO_SEEK) ? 'back' : 'forward')
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
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VIDEO_ZOOM_IN):
        case matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VIDEO_ZOOM_OUT):
          if (videoZoomPossible.value) {
            event.preventDefault()
            changeVideoZoom(matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VIDEO_ZOOM_IN) ? 1 : -1)
          }
          blurTooltipButtons()
          break
        case props.quickBookmarkEnabled && !store.getters.isAnyPromptOpen &&
          matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.TOGGLE_QUICK_BOOKMARK):
          event.preventDefault()
          if (!event.repeat) toggleQuickBookmark()
          break
        case props.playlistVideoData != null && !store.getters.isAnyPromptOpen &&
          matches(KeyboardShortcuts.VIDEO_PLAYER.GENERAL.OPEN_ADD_TO_PLAYLIST):
          event.preventDefault()
          if (!event.repeat) {
            store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [{ ...props.playlistVideoData }] })
          }
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
      // A previous critical error is already being handled, or the player is
      // unloading/destroying. Shaka can still dispatch errors from its queued
      // segment requests during that window; neither log nor emit them again.
      if (ignoreErrors) {
        return
      }

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

      // Shaka retries the retained stream on reconnect. Do not mark an offline
      // transport failure as a terminal error or suppress its future errors.
      if (error.code === ErrorCode.HTTP_ERROR && !navigator.onLine) return

      logShakaError(error, context, props.videoId, details)

      // Caption loading can also fail with MANIFEST errors (e.g. 4033).
      // Log caption and thumbnail failures without triggering video recovery.
      if (
        !ignoreErrors &&
        context !== 'addTextTrackAsync' &&
        error.category !== shaka.util.Error.Category.TEXT &&
        !(error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && error.data[0].startsWith('https://www.youtube.com/api/timedtext'))
      ) {
        // Retained Shorts can finish requests after navigation. Recover only
        // when that player is presented again; caption failures stay optional.
        if (shortsNavigationSuspended.value) {
          suspendedShortsError = { error, context, details }
          return
        }

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

    function createSponsorBlockMarker(
      duration,
      startTime,
      endTime,
      title,
      className,
      isPointMarker = false,
      customColor = null
    ) {
      const markerDiv = document.createElement('div')

      markerDiv.title = title
      markerDiv.className = className
      markerDiv.style.setProperty('--marker-start', (startTime / duration * 100).toString())
      // A point switches state as a whole; keep its gradient divisor nonzero.
      markerDiv.style.setProperty('--marker-width', Math.max((endTime - startTime) / duration * 100, 0.001).toString())
      if (customColor !== null) {
        markerDiv.style.setProperty('--primary-color', customColor)
      }
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
        const customColor = isHexColor(color) ? color : null

        return createSponsorBlockMarker(
          duration,
          segment.startTime,
          segment.endTime,
          translateSponsorBlockCategory(segment.category),
          `sponsorBlockMarker${isPointMarker ? ' sponsorBlockPointMarker' : ''}${customColor === null ? ` main${color}` : ''}`,
          isPointMarker,
          customColor
        )
      })

      const draftMarkers = sponsorBlockCompleteDraftSegments.value
        .filter(segment => !isSponsorBlockFullVideoSegment(segment))
        .map((segment) => {
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

    function refreshChapterMarkers() {
      if (!player || !container.value?.querySelector('.shaka-seek-bar-container')) return
      container.value.querySelectorAll('.chapterMarker').forEach(marker => marker.remove())
      if (props.chapters.length > 0) {
        createChapterMarkers()
      }
    }

    /**
     * @param {HTMLElement[]} markers
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

    let androidFullscreenRotationRequested = false
    function requestFullscreenOrientation(fullscreen) {
      // Keep this until exit finishes: unlocking after a preference/metadata
      // change can still have a rotation in flight when fullscreen closes.
      androidFullscreenRotationRequested ||= shouldRotateFullscreenToLandscape(fullscreen, video.value, rotateFullscreenToLandscape.value, fullscreenAspectRatio.value)
      setFullscreenOrientation(fullscreen, video.value, rotateFullscreenToLandscape.value, fullscreenAspectRatio.value).catch(() => {})
    }
    function updateFullscreenOrientation(fullscreen) {
      if (!isActiveTab.value || isNativeFullscreenActive() !== fullscreen) return
      if (fullscreen && androidFullscreenEntering) return
      requestFullscreenOrientation(fullscreen)
    }
    /** @type {(preserveOrientation?: boolean) => void} */
    let finishAndroidFullscreenExit = () => {}
    onBeforeUnmount(() => finishAndroidFullscreenExit())
    watch(isActiveTab, active => {
      if (!active) {
        finishAndroidFullscreenExit()
        androidFullscreenRotationRequested = false
      }
    })

    function retainAndroidFullscreenDuringRotation() {
      if (!androidFullscreenHost || !androidFullscreenRotationRequested) return
      const portraitBeforeUnlock = window.innerHeight >= window.innerWidth

      // The device may have turned while fullscreen locked its display, even
      // when entry and exit viewports match. Retain the surface until an unlocked
      // orientation arrives, or the delayed native check confirms no rotation.
      const host = androidFullscreenHost
      host.setAttribute('popover', 'manual')
      host.showPopover()
      androidFullscreenHostActive.value = true
      suppressPanelTransitions(5000)
      let restoredFrame = null
      const finish = (preserveOrientation = false) => {
        clearTimeout(timeout)
        cancelAnimationFrame(restoredFrame)
        window.removeEventListener('resize', resized)
        finishAndroidFullscreenExit = () => {}
        if (!preserveOrientation) androidFullscreenRotationRequested = false
        if (host.matches(':popover-open')) host.hidePopover()
        host.removeAttribute('popover')
        androidFullscreenHostActive.value = document.fullscreenElement === host
        suppressPanelTransitions(100)
      }
      const resized = () => {
        if ((window.innerHeight >= window.innerWidth) === portraitBeforeUnlock || restoredFrame !== null) return
        // Paint the restored viewport before replacing its fullscreen surface.
        restoredFrame = requestAnimationFrame(() => {
          restoredFrame = requestAnimationFrame(() => finish())
        })
      }
      // Auto-rotate or a different display can keep the device in landscape.
      // Only check for that case after allowing the rotation to settle. Never
      // replace the expected orientation with an immediate, potentially stale
      // read after unlock. If native rotation has arrived but the WebView has
      // not resized yet, keep protecting it until resize or the safety deadline.
      let timeout = window.setTimeout(() => {
        timeout = window.setTimeout(finish, 4500)
        getAndroidDisplayOrientation().then(orientation => {
          if (finishAndroidFullscreenExit !== finish) return
          if (orientation.startsWith('portrait') === portraitBeforeUnlock) finish()
        }).catch(() => {
          if (finishAndroidFullscreenExit === finish) finish()
        })
      }, 500)
      finishAndroidFullscreenExit = finish
      window.addEventListener('resize', resized)
    }

    function fullscreenChangeHandler() {
      if (shortsNavigationSuspended.value) return
      const fullscreen = isNativeFullscreenActive()
      const wasFullscreen = isFullscreen.value
      finishAndroidFullscreenExit(true)
      androidFullscreenHostActive.value = !!androidFullscreenHost && document.fullscreenElement === androidFullscreenHost
      handleVideoZoomFullscreenChange(fullscreen)
      isFullscreen.value = fullscreen
      if (props.shortsPlayer) {
        resetShortsOverflowMenu()
      }
      suppressPanelTransitions(process.env.IS_CAPACITOR ? 500 : 100)
      syncChapterOverlayButton()

      // Switching tabs can exit native fullscreen after this player becomes inactive.
      // The dock still needs to return to its inline location in that case.
      if (wasFullscreen && !fullscreen && !fullWindowEnabled.value) {
        rememberAndCloseDockedPanels()
      }

      if (!isActiveTab.value) {
        return
      }

      updateFullscreenOrientation(fullscreen)
      if (wasFullscreen && !fullscreen && process.env.IS_CAPACITOR && !process.env.IS_IOS) {
        retainAndroidFullscreenDuringRotation()
      }
      syncAndroidStatusBarVisibility()

      if (fullscreen) {
        if (scrollMiniPlayerActive.value) {
          deactivateScrollMiniPlayer()
        }
        restoreDockedPanels()
      } else {
        updateScrollMiniPlayer()
      }

      nextTick(showOverlayControls)
    }

    async function exitPresentationModes() {
      if (!ui) return

      try {
        const controls = ui.getControls()
        // Exit fullscreen if enabled
        if (controls && controls.isFullScreenEnabled && controls.isFullScreenEnabled()) {
          const documentFullscreen = document.fullscreenElement !== null
          await controls.toggleFullScreen()
          // The exit promise can resolve before fullscreenchange closes the docks.
          if (documentFullscreen && isFullscreen.value) {
            await new Promise(resolve => {
              document.addEventListener('fullscreenchange', resolve, { once: true })
            })
          }
        }

        // Exit fullwindow if enabled
        if (fullWindowEnabled.value && events) {
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: false
          }))
        }
        // The full-window listener creates its exit animation after rendering.
        // Cancel it before navigation relocates the container into the mini-player.
        await nextTick()
        fullWindowAnimation?.cancel()
        fullWindowAnimation = null
      } catch (error) {
        // Silently ignore errors if component is not fully initialized
        console.error('Error exiting player presentation modes:', error)
      }
    }

    /**
     * Keep Shaka's menu selection in sync while its playback controller is unavailable.
     */
    function updatePendingPlaybackRateMenu() {
      if (hasLoaded.value || !container.value) return
      const rate = getCurrentPlaybackRate()
      for (const menu of container.value.querySelectorAll('.shaka-playback-rates')) {
        for (const button of menu.querySelectorAll('.shaka-playback-rate-preset-btn')) {
          const selected = Math.abs(Number.parseFloat(button.dataset.rate) - rate) < 0.01
          button.ariaChecked = String(selected)
          button.classList.toggle('shaka-chosen-item', selected)
        }
        const slider = menu.querySelector('.shaka-playback-rate-slider')
        if (slider) slider.value = String(rate)
        const value = menu.querySelector('.shaka-playback-rate-value')
        if (value) value.textContent = `${rate.toFixed(2)}x`
      }
      for (const button of container.value.querySelectorAll('.shaka-playbackrate-button')) {
        button.setAttribute('shaka-status', `${rate}x`)
        for (const label of button.querySelectorAll('.shaka-current-selection-span, .shaka-overflow-playback-rate-mark')) {
          label.textContent = `${rate}x`
        }
      }
      syncPlaybackRateToggleState()
    }

    /**
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    function isPlayerMenuTarget(target) {
      return isActiveTab.value && target instanceof Element && !!container.value?.contains(target)
    }

    /**
     * @param {MouseEvent} event
     */
    function handlePlaybackRateMenuClick(event) {
      const target = event.target
      if (!isPlayerMenuTarget(target)) {
        return
      }

      const button = target.closest('.shaka-playback-rates :is(.shaka-playback-rate-preset-btn, .shaka-playback-rate-step-btn)')
      if (!button) {
        return
      }

      if (!isPlaybackRateRestoreQueued()) {
        handlePlayerMenuPlaybackRateSelected()
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (button.classList.contains('shaka-playback-rate-preset-btn')) {
        const rate = normalizePlaybackRate(Number.parseFloat(button.dataset.rate))
        if (rate !== null) {
          setPlaybackRate(rate)
          ui.getControls().hideSettingsMenus()
        }
      } else if (!button.disabled) {
        const interval = videoPlaybackRateInterval.value
        const delta = button === button.parentElement.querySelector('.shaka-playback-rate-step-btn') ? -interval : interval
        setPlaybackRate(getSteppedPlaybackRate(getCurrentPlaybackRate() ?? NORMAL_PLAYBACK_RATE, delta))
      }
    }

    /**
     * @param {Event} event
     */
    function handlePlaybackRateSliderInput(event) {
      const target = event.target
      if (!isPlayerMenuTarget(target) || !target.matches('.shaka-playback-rates .shaka-playback-rate-slider')) {
        return
      }

      if (!isPlaybackRateRestoreQueued()) {
        if (event.type === 'change') {
          handlePlayerMenuPlaybackRateSelected()
        }
        return
      }

      // Shaka's rate controller may not exist yet, so handle the value ourselves.
      event.stopPropagation()
      const rate = normalizePlaybackRate(Number.parseFloat(target.value))
      if (rate !== null) {
        setPlaybackRate(rate)
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
      // The codec switcher only changes which resolutions are listed
      if (target.closest('.shaka-resolutions :is(.explicit-resolution, .shaka-enable-abr-button)')) {
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

    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)

    // Local files can buffer while seeking without needing a network connection.
    // Only display the offline message for streams while buffering/the loading symbol is visible.
    // If we briefly lose the connection but it comes back before the buffer is empty,
    // the user won't notice anything so we don't need to display the message.
    const showOfflineMessage = computed(() => {
      return !props.localFilePlayback && isOffline.value && isBuffering.value
    })

    // #endregion offline message

    // #region setup
    let unbindAndroidMediaErrors = null
    let disableTwitchTsVideoGap = null
    onMounted(async () => {
      const videoElement = video.value
      if (process.env.IS_CAPACITOR && !process.env.IS_IOS) {
        unbindAndroidMediaErrors = bindAndroidMediaErrors(videoElement)
      }
      if (process.env.IS_CAPACITOR) {
        // The Watch view survives video changes, so its fullscreen element can
        // remain mounted while the Shaka player is replaced.
        androidFullscreenHost = container.value.closest('.videoLayout')
        androidFullscreenHost?.addEventListener('toggle', handleAndroidRotationPopoverToggle)
        androidFullscreenHostActive.value = !!androidFullscreenHost && document.fullscreenElement === androidFullscreenHost
        isFullscreen.value = androidFullscreenHostActive.value
      }

      screenWakeBinding = playbackScreenWake?.bindVideo(videoElement, () =>
        !audioPlayerMode.value && !scrollMiniPlayerDismissed.value && (isActiveTab.value || isCrossTabMiniPlayerPresented.value)
      )

      voiceOverTranslation.attach(videoElement)
      playerAudioOutput.setGain('boost', volumeBoost.value)
      playerAudioOutput.setMono(monoAudio.value)

      await initializeActiveTab()

      if (props.twitchSubOnlyVod) {
        disableTwitchTsVideoGap = enableTwitchTsVideoGap(props.manifestSrc)
      }

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
      setVideoPlaybackRate(initialPlaybackRate)
      videoElement.defaultPlaybackRate = getDefaultPlaybackRateForVideo()

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui) {
        return
      }

      const controls = ui.getControls()
      if (process.env.IS_CAPACITOR && !process.env.IS_IOS) {
        androidFullscreenCleanup = bindAndroidFullscreen(controls, {
          isActive: () => isActiveTab.value,
          prepareEnter: async () => {
            finishAndroidFullscreenExit(true)
            // The orientation event must not start a competing popover entry.
            androidFullscreenEntering = true
            if (shouldRotateFullscreenToLandscape(true, video.value, rotateFullscreenToLandscape.value, fullscreenAspectRatio.value)) {
              await prepareAndroidFullscreenRotation().catch(() => {})
            }
            requestFullscreenOrientation(true)
          },
          finishEnter: entered => {
            androidFullscreenEntering = false
            if (!entered) {
              androidFullscreenRotationRequested = false
              setLandscapeOrientation(false).catch(() => {})
            }
          },
        })
      }
      if (process.env.IS_IOS) {
        iosCaptionsCleanup = bindIosNativeCaptions(videoElement)
        iosFullscreenCleanup = bindIosFullscreen(controls, {
          isEnabled: () => fullWindowEnabled.value,
          setEnabled: enabled => events.dispatchEvent(new CustomEvent('setFullWindow', { detail: enabled })),
        })
      }
      player = controls.getPlayer()
      const textDisplayFactory = player.getConfiguration().textDisplayFactory
      player.configure({
        textDisplayFactory: instance => {
          captionTextDisplayer = textDisplayFactory(instance)
          return captionTextDisplayer
        },
      })
      nativeCaptionTiming = bindNativeCaptionTiming(
        videoElement,
        () => usesNativeCaptionTracks() ? captionTimingOffset : null,
        () => captionTextDisplayer?.remove(0, Infinity)
      )
      player.addEventListener('loaded', applyCaptionTiming)
      wrapTextTrackSelection()
      player.addEventListener('textchanged', handleTextTrackChanged)

      player.addEventListener('buffering', event => {
        isBuffering.value = event.buffering
      })

      player.addEventListener('error', event => handleError(event.detail, 'shaka error handler'))

      player.configure(getPlayerConfig(props.format, preferAutoQuality.value))

      if (process.env.SUPPORTS_LOCAL_API) {
        player.getNetworkingEngine().registerRequestFilter(requestFilter)
        player.getNetworkingEngine().registerResponseFilter(responseFilter)
        // The retry runs the request filter again, which moves it to the backup server
        player.getNetworkingEngine().addEventListener('retry', ({ error }) => {
          const { Code } = shaka.util.Error
          // Android's native proxy answers a connection failure with 502
          if (error.code === Code.TIMEOUT || error.code === Code.HTTP_ERROR ||
            (error.code === Code.BAD_HTTP_STATUS && error.data[1] === 502)) {
            markGoogleVideoHostUnreachable(error.data[0])
          }
        })
      }
      if (props.twitchSubOnlyVod) {
        player.getNetworkingEngine().registerResponseFilter(twitchSubOnlyVodResponseFilter)
      }
      if (process.env.IS_ELECTRON) {
        player.getNetworkingEngine().registerRequestFilter(async (_type, request) => {
          request.uris = await Promise.all(request.uris.map(url => getSubtitleRequestUrl(url, store.getters)))
        })
      }
      player.getNetworkingEngine().registerRequestFilter(silenceSkippingRequestFilter)
      player.getNetworkingEngine().registerResponseFilter(silenceSkippingResponseFilter)
      // Runs after the other filters so it sees the final segment data, including redirects
      player.getNetworkingEngine().registerResponseFilter(webmProjectionResponseFilter)

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
      registerQualitySelection()
      registerCaptionSelection()
      registerCaptionToggleButton()
      registerChapterOverlayButton()
      registerAutoplayToggle()
      registerAmbientModeButton()
      registerMusicVisualizerButton()
      registerMusicModeButton()
      registerVideoZoomSelection()
      registerVolumeBoostSelection()
      registerMonoAudioButton()
      registerLightsOffButton()
      registerSkipSilenceButton()
      registerVoiceOverTranslationButton()
      registerSleepTimer()
      registerSeekHistoryMenu()
      registerAbRepeatControl()

      registerTheatreModeButton()
      registerFullWindowButton()
      registerAndroidPictureInPictureButton()
      registerShortsVideoInfoButton()

      if (
        props.autoOpenChapters &&
        props.chapters.length > 0 &&
        !isNativeFullscreenActive() &&
        !fullWindowEnabled.value
      ) {
        emit('chapters-overlay-change', true)
      }

      registerLegacyQualitySelection()
      registerContextMenuButtons()
      registerStatsButton()
      registerSponsorBlockSubmissionButtons()
      registerSponsorBlockHighlightButton()
      registerSkipButtons()
      registerPlaybackAdjustedTime()
      registerQuickPlaybackRateBar()

      registeredCustomControls = true
      liveCustomControlPlayers.add(reRegisterOwnElements)

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
      controls.addEventListener('timeandseekrangeupdated', updateMobileMiniBarProgress)
      configureUI(true)

      applyInitialVolume(videoElement)

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keyup', keyboardShortcutKeyupHandler)
      document.addEventListener('keydown', handleVideoZoomModifierKey)
      document.addEventListener('keyup', handleVideoZoomModifierKey)
      // Not a template listener: it only swallows the click that shaka-player
      // would otherwise read as play/pause at the end of a pan.
      container.value?.addEventListener('click', handleVideoZoomClickCapture, true)
      // Release the hold before mobile gestures consume pointerup on window.
      window.addEventListener('pointerup', handleTemporaryPlaybackRatePointerUp, true)
      window.addEventListener('pointercancel', handleTemporaryPlaybackRatePointerCancel, true)
      document.addEventListener('visibilitychange', handleTemporaryPlaybackRateVisibilityChange)
      document.addEventListener('fullscreenchange', fullscreenChangeHandler)
      window.addEventListener('opentubex:android-window-focus', restoreAndroidStatusBarVisibility)
      // Use event delegation on document with capture phase to catch events before shaka-no-propagation stops them from bubbling
      document.addEventListener('click', handlePlaybackRateMenuClick, true)
      document.addEventListener('input', handlePlaybackRateSliderInput, true)
      document.addEventListener('change', handlePlaybackRateSliderInput, true)
      document.addEventListener('click', handleQualityMenuClick, true)

      // Set up IPC listener for exit fullscreen when tab becomes inactive (Electron only)
      // Only set up after UI is fully initialized
      if (process.env.IS_ELECTRON && ui && window.ftElectron?.tabs?.onExitFullscreen) {
        try {
          exitFullscreenCleanup = window.ftElectron.tabs.onExitFullscreen(exitPresentationModes, tabId)
        } catch (error) {
          console.error('Failed to set up exit fullscreen listener:', error)
        }
      }

      setupAutoPictureInPicture()

      if (container.value) {
        setupScrollMiniIntersectionObserver()
      }

      window.addEventListener('scroll', handleScrollMiniWindowScroll, { passive: true })
      window.addEventListener('resize', handleScrollMiniWindowResize)
      window.addEventListener('blur', handleTemporaryPlaybackRateFocusLoss)
      window.addEventListener('blur', handleSeekBarWindowBlur)

      player.addEventListener('loading', () => {
        chapterThumbnailLoadGeneration++
        chapterThumbnailsWanted = showChaptersOverlay.value || props.sidebarChaptersOpen
        silenceSkipping.reset()
        hasLoaded.value = false
        hasPlaybackPosition.value = false
        videoLayoutReady.value = false
        annotationVideoAspectRatio.value = null
        if (props.shortsPlayer) {
          shortsPaused.value = false
          shortsCaptionsAvailable.value = false
          shortsCaptionsEnabled.value = false
        }
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
            forceAspectRatio.value = firstVariant != null && !props.shortsPlayer &&
              firstVariant.width / firstVariant.height < 1.5
          }
        })
      } else if (props.legacyFormats.length > 0) {
        // force the player aspect ratio to 16:9 to avoid overflowing the layout, when the video is too tall

        const firstFormat = props.legacyFormats[0]
        forceAspectRatio.value = !props.shortsPlayer &&
          firstFormat.width / firstFormat.height < 1.5
      }

      if (useSponsorBlock.value) {
        setupSponsorBlock()
        if (sponsorBlockInfoOpen.value) {
          refreshSponsorBlockContributionStats()
        }
      }

      // shaka-player doesn't start with the cursor hidden, so hide it here for instances in which the
      // cursor is in the video player area when the video first loads
      container.value.classList.add('no-cursor')

      await performFirstLoad()
      // Whatever runs after `performFirstLoad` might be after switching to another page due to SABR backoff

      player?.addEventListener('ratechange', () => {
        const playbackRate = player.getPlaybackRate()
        if (!isTemporaryPlaybackRateActive() && !shortsNavigationSuspended.value) {
          emit('playback-rate-updated', playbackRate)
        }
        scheduleSponsorBlockSkip()
        scheduleAbRepeatBoundary()
        sleepTimer.checkChapterBoundary()
      })
    })
    onUnmounted(() => {
      unbindAndroidMediaErrors?.()
      clearSabrBackoffTimer()
      clearPreRollTimer()
      cancelSponsorBlockSkipSchedule()
      clearAbRepeatBoundarySchedule()
    })

    /**
     * @param {string} url
     * @param {number|null} startTime
     * @param {string} mimeType
     */
    async function loadPlaybackSource(url, startTime, mimeType) {
      foregroundLoadAbortController?.abort()
      const loadingPlayer = player
      const mediaElement = video.value
      if (process.env.IS_CAPACITOR && !process.env.IS_IOS &&
        !props.localFilePlayback && mimeType === MANIFEST_TYPE_SABR &&
        mediaElement.autoplay && !initialAutoplayCanceled &&
        mediaElement.played.length === 0 && isActiveTab.value) {
        // Android cannot start a fresh playback service from a hidden activity.
        // Metadata can finish after the app-state pause sweep, so defer this
        // initial load until foreground protection can be established.
        if (getAndroidAppActive() !== true) {
          const controller = new AbortController()
          const generation = formatSwitchGeneration
          foregroundLoadAbortController = controller
          while (getAndroidAppActive() !== true) {
            const activityState = getAndroidAppActive()
            if (activityState === false && !store.getters.getContinuePlaybackWhenScreenIsLocked) break
            await waitForAndroidAppState(controller.signal, activityState)
            if (controller.signal.aborted) return
          }
          if (foregroundLoadAbortController === controller) foregroundLoadAbortController = undefined
          if (controller.signal.aborted || loadingPlayer !== player || generation !== formatSwitchGeneration) return
        }
        // Protect pending autoplay before the asynchronous SABR load: even its
        // first response can arrive after Android hides the activity.
        // A queued startup seek is a position, but has not played any media.
        if (getAndroidAppActive() === true && mediaElement.autoplay && !initialAutoplayCanceled && isActiveTab.value) {
          tabMediaCoordinator.setPlaybackState(mediaTabId, 'playing')
        } else if (!store.getters.getContinuePlaybackWhenScreenIsLocked) {
          // A player initialized while hidden missed the pause sweep. Cancel
          // autoplay without publishing a paused session that starts a service.
          initialAutoplayCanceled = true
          mediaElement.autoplay = false
          mediaElement.pause()
        }
      }
      const restoreNativeStart = () => {
        if (player !== loadingPlayer || pendingMetadataSeek !== null ||
          hasPlaybackPosition.value || mediaElement.seeking || startTime == null) return
        mediaElement.currentTime = startTime
      }
      const prepareStartTime = () => {
        // Native playback still reports NOT_LOADED at this event.
        if (loadingPlayer.getManifestType() !== null) return
        // Native playback otherwise restores saved progress on canplay, after
        // a user may have sought. Restore it at metadata readiness instead.
        loadingPlayer.updateStartTime(null)
        mediaElement.addEventListener('loadedmetadata', restoreNativeStart, { once: true })
      }
      loadingPlayer.addEventListener('canupdatestarttime', prepareStartTime, { once: true })
      // Diagnostic reports have no other record of which stream each load used
      console.warn(`Loading video ${props.videoId} from ${props.playbackEngine} extraction: ${props.format} (${mimeType}) at ${Math.round(startTime ?? 0)}s`)
      try {
        await loadingPlayer.load(url, startTime, mimeType)
      } finally {
        loadingPlayer.removeEventListener('canupdatestarttime', prepareStartTime)
        mediaElement.removeEventListener('loadedmetadata', restoreNativeStart)
      }
    }

    async function performFirstLoad(isCurrentLoad = () => true, startTime = props.startTime) {
      const generation = formatSwitchGeneration
      const isCurrentInitialLoad = () => generation === formatSwitchGeneration && isCurrentLoad()
      clearSabrBackoffTimer()
      clearPreRollTimer()
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

      // Online metadata may include a preroll deadline even when playing a download.
      const initialLoadDelayMs = props.delayLoadUntilUnix - Date.now()
      if (!props.localFilePlayback && initialLoadDelayMs > 0 && (props.format === 'legacy' || props.manifestMimeType !== MANIFEST_TYPE_SABR)) {
        startPreRollTimer(initialLoadDelayMs)
        await new Promise((resolve) => setTimeout(resolve, initialLoadDelayMs))
        if (!ui || !player || !isCurrentInitialLoad()) return
        clearPreRollTimer()
      }

      if (props.format === 'dash' || props.format === 'audio') {
        try {
          await loadPlaybackSource(props.manifestSrc, startTime, props.manifestMimeType)
          if (!ui || !player || !isCurrentInitialLoad()) return

          if (props.format === 'dash') {
            // Let shaka-player's ABR pick the variant when auto quality is preferred
            if (!preferAutoQuality.value) {
              setDashQuality(preferredVideoQuality.value)
            }
          } else {
            let variants = player.getVariantTracks()

            if (hasMultipleAudioTracks.value) {
              variants = getDefaultAudioVariants(variants)
            }

            if (variants.length > 0) {
              const highestBandwidth = Math.max(...variants
                .map(variant => variant.audioBandwidth)
                .filter(Number.isFinite))
              const selectedVariant = variants.find(variant => (
                variant.audioBandwidth === highestBandwidth
              )) ?? variants[0]

              player.selectVariantTrack(selectedVariant)
            }
          }
        } catch (error) {
          if (ui && player && isCurrentInitialLoad()) {
            handleError(error, 'loading dash/audio manifest and setting default quality in mounted')
          }
        }
      } else {
        await setLegacyQuality(startTime)
      }
    }

    /**
     * Adds the captions and thumbnail tracks, also restores the previously selected captions track,
     * if this was triggered by a format change and the user had the captions enabled.
     */
    // Shaka can emit loaded again on the same player (format switch) while an
    // earlier handleLoaded still waits for its caption tracks.
    let loadGeneration = 0

    async function handleLoaded() {
      const loadedPlayer = player
      const generation = ++loadGeneration
      // Files loaded while this runs are already added to the player
      const reloadedLocalCaptions = localCaptions.value
      hasLoaded.value = true
      // Ideally we would set this in the `streaming` event handler, but for HLS this is only set to true after the loaded event fires.
      isLive.value = player.isLive()
      restorePendingPlaybackRate()
      const mediaElement = video.value
      // Native HLS can emit canplay before Shaka finishes loading its tracks.
      // Seeks already applied in that interval must not survive to a later rebuffer.
      if (videoLayoutReady.value && player.getManifestType() === null && mediaElement.readyState >= 3) pendingMetadataSeek = null
      // Background tabs may finish loading without emitting play or pause.
      shortsPaused.value = mediaElement.paused
      if (process.env.IS_ELECTRON && !mediaElement.autoplay && mediaElement.paused) {
        window.ftElectron?.tabs?.setPlaybackState('paused', tabId)
      }
      if (props.format === 'legacy' && activeLegacyFormat.value?.localFile &&
        mediaElement.videoWidth > 0 && mediaElement.videoHeight > 0) {
        const format = activeLegacyFormat.value
        format.width = mediaElement.videoWidth
        format.height = mediaElement.videoHeight
        format.qualityLabel = `${format.width}×${format.height} • ${format.localFileLabel}`
        events.dispatchEvent(new CustomEvent('legacyFormatMetadataChanged'))
      }
      emit('loaded', {
        duration: mediaElement.duration,
        width: mediaElement.videoWidth,
        height: mediaElement.videoHeight
      })

      nextTick(() => {
        rememberInlinePlayerLayoutHeight()
      })

      // getAudioTracks() returns an empty array when no variant is active, so we can't do this in the `streaming` event
      hasMultipleAudioTracks.value = deduplicateAudioTracks(player.getAudioTracks()).size > 1

      if (process.env.SUPPORTS_LOCAL_API && props.format !== 'legacy' && props.manifestMimeType === MANIFEST_TYPE_SABR) {
        sabrManifest = player.getManifest()
      }

      // Shaka cannot add external text tracks to a live presentation. Keep any
      // captions supplied by the live manifest instead. SABR already includes
      // the thumbnails, chapters and subtitles in its manifest.
      if (!isLive.value && (!process.env.SUPPORTS_LOCAL_API || props.format === 'legacy' || props.manifestMimeType !== MANIFEST_TYPE_SABR)) {
        const promises = []

        for (const caption of props.captions) {
          if (props.format === 'legacy') {
            const url = new URL(caption.url)

            if (url.hostname.endsWith('.youtube.com') && url.pathname === '/api/timedtext' &&
              url.searchParams.get('caps') === 'asr' && url.searchParams.get('kind') === 'asr' && url.searchParams.get('fmt') === 'vtt') {
              promises.push((async () => {
                try {
                  const response = await fetch(await getSubtitleRequestUrl(caption.url, store.getters))
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
                addCaptionTrack(caption)
                  .catch(error => handleError(error, 'addTextTrackAsync', caption))
              )
            }
          } else {
            promises.push(
              addCaptionTrack(caption)
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

        // Switching videos while caption tracks were still downloading tears
        // the player down; the rejected track promises are swallowed above.
        // destroyPlayer() clears hasLoaded before its own awaits, so this also
        // catches a teardown that has not nulled the player yet.
        if (player !== loadedPlayer || !hasLoaded.value || generation !== loadGeneration) {
          return
        }
      }

      // After the video's own captions, so that a restored caption index still matches the same track
      if (!isLive.value) {
        for (const caption of reloadedLocalCaptions) {
          try {
            await addCaptionTrack(caption, loadedPlayer)
          } catch (error) {
            handleError(error, 'addTextTrackAsync', caption)
          }

          if (player !== loadedPlayer || !hasLoaded.value || generation !== loadGeneration) {
            return
          }
        }
      }

      loadChapterThumbnails()

      if (restoreCaptionIndex !== null) {
        const index = restoreCaptionIndex
        restoreCaptionIndex = null

        const textTracks = player.getTextTracks()
        const textTrack = findMatchingTextTrack(textTracks, initialCaption) ?? textTracks[index]
        initialCaption = null

        if (textTrack) {
          player.selectTextTrack(textTrack, false)
        }
      }
      syncShortsCaptionsEnabled()
      emit('subtitles-state-updated', player.getTextTracks().some(track => track.active))

      // Chapters that arrived while the tracks above loaded already drew markers
      refreshChapterMarkers()
      refreshAbRepeatMarkers()

      applyPendingPresentationModes()

      if (props.resumePlaybackAfterSabrReload && !props.pauseForStreamRecovery) {
        video.value?.play()
      }
      if (props.resumePlaybackAfterSabrReload || suppressInitialAutoplay) {
        emit('resume-playback-after-sabr-reload-done')
      }
    }

    async function unloadForFormatSwitch() {
      // The previous frame disappears when Shaka unloads. Keep the normal
      // player dimensions filled with the thumbnail until the new format has
      // produced a frame of its own.
      showPoster.value = true
      video.value?.removeAttribute('poster')

      try {
        await player.unload()
      } catch { }
    }

    let formatSwitchGeneration = 0
    /**
     * A newer source update can supersede a format switch after it has paused
     * and unloaded the media element. Keep the user's state from before the
     * first switch so the latest generation does not mistake that pause for
     * user intent or restart from the beginning.
     * @type {{
     *   oldFormat: 'dash'|'audio'|'legacy',
     *   wasPaused: boolean,
     *   playbackPosition: number,
     *   useAutoQuality: boolean,
     *   audioBandwidth: number|undefined,
     *   label: string|undefined,
     *   previousQuality: number|undefined
     * } | null}
     */
    let pendingFormatSwitchState = null

    watch(
      () => [props.format, props.playbackSourceKey],
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
      async ([newFormat], [oldFormat]) => {
        const generation = ++formatSwitchGeneration
        foregroundLoadAbortController?.abort()
        const isCurrentFormatSwitch = () => generation === formatSwitchGeneration
        ignoreErrors = true

        // format switch happened before the player loaded, probably because of an error
        // as there are no previous player settings to restore, we should treat it like this was the original format
        if (!hasLoaded.value && pendingFormatSwitchState === null) {
          const startTime = props.autoplayRequested ? 0 : props.startTime
          await unloadForFormatSwitch()
          if (!isCurrentFormatSwitch()) return
          ensureSabrStream()

          if (newFormat === 'audio' && props.thumbnail) {
            // A media element that has already painted video frames may keep
            // its last frame instead of showing a newly assigned poster. Reset
            // it after Shaka detaches the video source so audio-only playback
            // reliably returns to the thumbnail.
            video.value.poster = props.thumbnail
            video.value.load()
          }

          ignoreErrors = false

          player.configure(getPlayerConfig(newFormat, preferAutoQuality.value))

          await performFirstLoad(isCurrentFormatSwitch, startTime)
          return
        }

        const video_ = video.value
        if (pendingFormatSwitchState === null) {
          const activeVariant = oldFormat === 'legacy'
            ? undefined
            : player.getVariantTracks().find(track => track.active)
          const activeCaptionIndex = player.getTextTracks().findIndex(caption => caption.active)

          // Queue the current speed before unloading so later user choices
          // replace it instead of being overwritten by a pre-switch snapshot.
          queuePlaybackRateRestore()
          pendingFormatSwitchState = {
            oldFormat,
            wasPaused: video_.paused,
            playbackPosition: video_.currentTime,
            // The legacy formats don't have an ABR configuration to carry over,
            // so fall back to the user's preference when switching away from them.
            useAutoQuality: oldFormat === 'legacy'
              ? preferAutoQuality.value
              : player.getConfiguration().abr.enabled,
            audioBandwidth: typeof activeVariant?.audioBandwidth === 'number'
              ? activeVariant.audioBandwidth
              : undefined,
            label: activeVariant?.label || undefined,
            previousQuality: oldFormat === 'dash' && activeVariant
              ? (activeVariant.height > activeVariant.width ? activeVariant.width : activeVariant.height)
              : undefined
          }

          if (!pendingFormatSwitchState.wasPaused) {
            video_.pause()
          }

          if (activeCaptionIndex >= 0) {
            restoreCaptionIndex = activeCaptionIndex

            // hide captions before switching as shaka/the browser doesn't clean up the displayed captions
            // when switching away from the legacy formats
            player.selectTextTrack(null, false)
          } else {
            restoreCaptionIndex = null
          }

          // Shaka clears its manifest before unload() finishes. A timeupdate can
          // still arrive from the media element in that window, so stop handlers
          // from querying player state as soon as the format switch begins.
          hasLoaded.value = false
          hasPlaybackPosition.value = false
        }

        // A queued copy of the same video switches sources in this player.
        // Start the queued item instead of restoring the previous source's end.
        if (props.autoplayRequested) {
          pendingFormatSwitchState.wasPaused = false
          pendingFormatSwitchState.playbackPosition = 0
        }

        const {
          oldFormat: sourceFormat,
          wasPaused,
          playbackPosition,
          useAutoQuality,
          audioBandwidth,
          label,
          previousQuality
        } = pendingFormatSwitchState

        if (newFormat === 'audio' || newFormat === 'dash') {
          let dimension

          if (sourceFormat === 'legacy' && newFormat === 'dash') {
            if (!useAutoQuality) {
              // Use the preferred quality instead of the active legacy format's dimensions, as the
              // legacy formats top out at 360p and the user may never have chosen that themselves
              dimension = preferredVideoQuality.value
            }
          }

          if (sourceFormat === 'audio' && newFormat === 'dash' && !useAutoQuality) {
            dimension = preferredVideoQuality.value
          }

          await unloadForFormatSwitch()
          if (!isCurrentFormatSwitch()) return
          ensureSabrStream()

          if (newFormat === 'audio' && props.thumbnail) {
            video_.poster = props.thumbnail
            video_.load()
          }

          ignoreErrors = false

          player.configure(getPlayerConfig(newFormat, useAutoQuality))

          try {
            await loadPlaybackSource(props.manifestSrc, playbackPosition, props.manifestMimeType)
            if (!isCurrentFormatSwitch()) return

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
                  variants = getDefaultAudioVariants(variants)
                }

                let chosenVariant

                if (typeof audioBandwidth === 'number') {
                  chosenVariant = findMostSimilarAudioBandwidth(variants, audioBandwidth)
                } else {
                  chosenVariant = variants.reduce((previous, current) => {
                    return previous === null || current.bandwidth > previous.bandwidth ? current : previous
                  }, null)
                }

                if (chosenVariant) {
                  player.selectVariantTrack(chosenVariant)
                }
              }
            }
          } catch (error) {
            if (!isCurrentFormatSwitch()) return
            handleError(error, 'loading dash/audio manifest for format switch', `${sourceFormat} -> ${newFormat}`)
          }
          activeLegacyFormat.value = null
        } else {
          await unloadForFormatSwitch()
          if (!isCurrentFormatSwitch()) return

          ignoreErrors = false

          await setLegacyQuality(playbackPosition, previousQuality)
          if (!isCurrentFormatSwitch()) return
        }

        pendingFormatSwitchState = null
        if (wasPaused || props.pauseForStreamRecovery) {
          video_.pause()
        } else {
          video_.play()
        }
      }
    )

    // #endregion setup

    // Stream-failure recovery pauses in place so the notice can be read and
    // reported before playback continues.
    watch(() => props.streamRecoveryNotice, notice => {
      if (notice !== null && props.pauseForStreamRecovery) video.value?.pause()
    })

    function dismissStreamRecoveryNotice() {
      emit('stream-recovery-notice-dismiss')
    }

    function copyStreamRecoveryNotice() {
      copyToClipboard(props.streamRecoveryNotice, {
        messageOnSuccess: t('Video.Player.Stream Recovery.Error Copied')
      })
    }

    // #region tear down

    onBeforeUnmount(() => {
      sponsorBlockRequestGeneration++
      screenWakeBinding?.destroy()
      screenWakeBinding = null
      androidFullscreenCleanup?.()
      androidFullscreenCleanup = null
      iosFullscreenCleanup?.()
      iosFullscreenCleanup = null
      iosCaptionsCleanup?.()
      iosCaptionsCleanup = null
      nativeCaptionTiming?.release()
      nativeCaptionTiming = null
      captionTextDisplayer = null
      player?.removeEventListener('loaded', applyCaptionTiming)
      clearTimeout(paidPromotionTimer)
      disableTwitchTsVideoGap?.()
      cancelPendingVolumeUserSet()
      fullWindowAnimation?.cancel()
      hasLoaded.value = false
      hasPlaybackPosition.value = false
      pendingMetadataSeek = null
      seekBarMouseDown = false
      resumeAutoplayAfterSeek = false
      initialAutoplayCanceled = false
      if (!shortsNavigationSuspended.value) {
        closeFullscreenMetadata()
        closeFullscreenTranscript()
        closeFullscreenSponsorBlock()
        closeFullscreenLiveChat()
        closeFullscreenComments()
        closeFullscreenPlaylist()
        closeFullscreenQueue()
        closeFullscreenRecommendations()
        if (document.body.dataset.playerFullWindowOwner === mediaTabId) {
          delete document.body.dataset.playerFullWindowOwner
          document.body.classList.remove('playerFullWindow')
          document.documentElement.classList.remove('appPlayerFullWindow')
        }
      }

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.removeEventListener('mousemove', handleSeekBarMouseChange)
      document.removeEventListener('mouseup', handleSeekBarMouseChange)
      document.removeEventListener('keyup', keyboardShortcutKeyupHandler)
      document.removeEventListener('keydown', handleVideoZoomModifierKey)
      document.removeEventListener('keyup', handleVideoZoomModifierKey)
      container.value?.removeEventListener('click', handleVideoZoomClickCapture, true)
      window.removeEventListener('pointerup', handleTemporaryPlaybackRatePointerUp, true)
      window.removeEventListener('pointercancel', handleTemporaryPlaybackRatePointerCancel, true)
      document.removeEventListener('visibilitychange', handleTemporaryPlaybackRateVisibilityChange)
      document.removeEventListener('fullscreenchange', fullscreenChangeHandler)
      window.removeEventListener('opentubex:android-window-focus', restoreAndroidStatusBarVisibility)
      document.removeEventListener('click', handlePlaybackRateMenuClick, true)
      document.removeEventListener('input', handlePlaybackRateSliderInput, true)
      document.removeEventListener('change', handlePlaybackRateSliderInput, true)
      document.removeEventListener('click', handleQualityMenuClick, true)
      window.removeEventListener('blur', handleTemporaryPlaybackRateFocusLoss)
      window.removeEventListener('blur', handleSeekBarWindowBlur)
      player?.removeEventListener('textchanged', handleTextTrackChanged)

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

      if (overflowMenuResizeObserver) {
        overflowMenuResizeObserver.disconnect()
        overflowMenuResizeObserver = null
      }

      if (overflowMenuMutationObserver) {
        overflowMenuMutationObserver.disconnect()
        overflowMenuMutationObserver = null
      }

      if (overflowMenuTitleFrame !== null) {
        cancelAnimationFrame(overflowMenuTitleFrame)
        overflowMenuTitleFrame = null
      }

      cleanupPhoneOptionsMenu?.()
      cleanupPhoneOptionsMenu = null
      cleanupSubmenuScrolling?.()
      cleanupSubmenuScrolling = null
      if (overflowMenuElement) {
        removeOverlayScrollbars(overflowMenuElement)
        overflowMenuElement = null
      }

      destroyAdaptiveControlPanelLayout()

      if (fullscreenControlsVisibilityObserver) {
        fullscreenControlsVisibilityObserver.disconnect()
        fullscreenControlsVisibilityObserver = null
      }

      const controls = ui?.getControls()
      controls?.removeEventListener('timeandseekrangeupdated', updateMobileMiniBarProgress)
      controls?.removeEventListener('submenuopen', handleSubMenuOpen)
      controls?.removeEventListener('submenuclose', handleSubMenuClose)

      if (!androidStatusBarVisible) {
        androidStatusBarVisible = true
        setAndroidStatusBarVisible(true).catch(() => {})
      }

      if (videoResizeObserver) {
        videoResizeObserver.disconnect()
      }

      cleanUpCustomPlayerControls()

      if (!shortsNavigationSuspended.value) {
        tabMediaCoordinator.setMiniPlayer(mediaTabId, false)
        tabMediaCoordinator.setActionHandlers(mediaTabId, mediaSessionSource, {})
        tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')

        // Clear tab playback state indicator when the active player is destroyed.
        if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
          window.ftElectron.tabs.setPlaybackState('none', tabId)
        }
      }

      skippedSponsorBlockSegments.value.forEach(segment => clearTimeout(segment.timeoutId))
      promptSponsorBlockSegments.value = []
      stopSponsorBlockToastTimer()
      clearSponsorBlockNotFoundRefetchTimeout()
      sponsorBlockMuteController.reset()

      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
      if (ui || player) {
        destroyPlayer().catch(error => {
          console.warn('Could not release an evicted Short player', error)
        })
      }
    })

    // #endregion tear down

    // #region functions used by the watch page

    let resumeShortsAfterActivation = false

    function suspendForShortsNavigation() {
      if (!props.shortsPlayer || shortsNavigationSuspended.value || !video.value) return
      resumeShortsAfterActivation = !video.value.paused
      video.value.pause()
      shortsNavigationSuspended.value = true
      sleepTimer.pauseCountdown()
      cancelSponsorBlockSkipSchedule()
      clearAbRepeatBoundarySchedule()
      tabMediaCoordinator.setActionHandlers(mediaTabId, mediaSessionSource, {})
      tabMediaCoordinator.setPlaybackState(mediaTabId, 'none')
    }

    onDeactivated(suspendForShortsNavigation)
    onActivated(() => {
      if (!shortsNavigationSuspended.value) return
      shortsNavigationSuspended.value = false
      const resume = resumeShortsAfterActivation
      resumeShortsAfterActivation = false
      if (musicMode.value) {
        setCurrentTime(0)
        applyMusicModePlaybackRate()
      }
      registerMediaSessionHandlers()
      if (suspendedShortsSabrReload) {
        const reloadContext = suspendedShortsSabrReload
        suspendedShortsSabrReload = null
        // An error from the aborted transport is part of this same recovery.
        suspendedShortsError = null
        emit('player-reload-requested', { ...getSabrReloadState(), ...reloadContext, wasPlaying: resume })
        return
      }
      if (suspendedShortsError) {
        const { error, context, details } = suspendedShortsError
        suspendedShortsError = null
        handleError(error, context, details)
        return
      }
      fullscreenChangeHandler()
      emit('loaded', {
        duration: video.value.duration,
        width: video.value.videoWidth,
        height: video.value.videoHeight
      })
      handleTimeupdate()
      handlePause()
      if (resume && isTabPresented?.value !== false) {
        video.value?.play().catch(error => {
          console.warn('Could not resume retained Short', error)
        })
      }
    })

    function isPaused() {
      return video.value.paused
    }

    function pause() {
      initialAutoplayCanceled = true
      const videoElement = video.value
      if (!videoElement) return
      const wasPaused = videoElement.paused
      if (wasPaused) videoElement.autoplay = false
      videoElement.pause()
      // Pending autoplay has no play event yet, so pause() emits no pause event.
      if (wasPaused) handlePause()
    }

    function play() {
      return video.value.play()
    }

    function getCurrentTime() {
      return video.value.currentTime
    }

    /**
     * @param {number} time
     * @param {boolean} [recordSeekHistory] Whether this is the viewer's own seek, so leaving the current position adds to the seek history
     */
    function setCurrentTime(time, recordSeekHistory = false) {
      if (!seekingIsPossible.value) return
      endSeekTarget = null
      accumulatedSeekSeconds = 0
      rememberSeekPosition(time, recordSeekHistory)
      video.value.currentTime = time
    }

    function getActiveCaption() {
      const active = player?.getTextTracks().find(track => track.active)
      if (!active) return null
      return captionSources.get(player)?.get(active.id) ??
        props.captions.find(caption => findMatchingTextTrack([active], caption)) ?? null
    }

    /**
     * Call before a user's seek to `time` is applied.
     * @param {number} time
     * @param {boolean} [recordSeekHistory] Whether this is the viewer's own seek, so leaving the current position adds to the seek history
     */
    function rememberSeekPosition(time, recordSeekHistory = false) {
      if (recordSeekHistory) noteSeekHistoryJump(time)
      // Explicit seeks supersede earlier end intent, even at its backoff position.
      endSeekTarget = null
      // Shaka temporarily pauses while scrubbing. Retain a requested end only
      // after it has restored the original playback state, including seek retries.
      if (player && video.value.paused && !props.shortsPlayer && !isLive.value && !video.value.loop &&
          !ui?.getControls().isSeeking() && !(abRepeatEnabled.value && hasValidAbRepeatRange())) {
        const { start, end } = player.seekRange()
        if (Number.isFinite(end) && end > start && time >= end) endSeekTarget = end
      }
      hasPlaybackPosition.value = true
      // Once the first canplay has passed, a lower readyState only means seeking
      // or rebuffering. Queuing then would replay the target after canplay.
      if (pendingMetadataSeek !== null || !hasLoaded.value || !videoLayoutReady.value) pendingMetadataSeek = time
    }

    function getSabrReloadState() {
      // A failed initial load has not emitted playing yet. Preserve its pending
      // autoplay through recovery unless the user canceled it.
      const pendingAutoplay = video.value?.autoplay === true &&
        video.value.played.length === 0 && !initialAutoplayCanceled
      const captionIndex = player?.getTextTracks().findIndex(caption => caption.active) ?? -1

      return {
        wasPlaying: !video.value?.paused || pendingAutoplay,
        captionIndex: captionIndex >= 0 ? captionIndex : null,
        captionTimingOffset,
        localCaptions: localCaptions.value,
        playbackRate: getCurrentPlaybackRate(),
        videoQuality: getActiveVariantQuality(),
        loopEnabled: video.value?.loop === true,
        abRepeat: {
          start: abRepeatStart.value,
          end: abRepeatEnd.value,
          enabled: abRepeatEnabled.value
        },
        repeatStats: repeatStatsTracker?.getState() ?? null
      }
    }

    function retryStreaming() {
      if (!player) return false
      ignoreErrors = false
      return player.retryStreaming()
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
     *   autoPictureInPictureState: object | null,
     *   dockedPanels: import('./opentubex/dockedPanels').DockedPanel[]
     * }>}
     */
    async function destroyPlayer() {
      foregroundLoadAbortController?.abort()
      clearSabrBackoffTimer()
      repeatStatsTracker?.destroy()
      repeatStatsLoopObserver?.disconnect()
      screenWakeBinding?.destroy()
      screenWakeBinding = null
      androidFullscreenCleanup?.()
      androidFullscreenCleanup = null
      iosFullscreenCleanup?.()
      iosFullscreenCleanup = null
      iosCaptionsCleanup?.()
      iosCaptionsCleanup = null
      nativeCaptionTiming?.release()
      nativeCaptionTiming = null
      captionTextDisplayer = null
      player?.removeEventListener('loaded', applyCaptionTiming)
      ignoreErrors = true
      cancelPendingVolumeUserSet()
      cancelSponsorBlockSkipSchedule()
      // Shaka may wait for active requests while destroying the player.
      if (process.env.SUPPORTS_LOCAL_API && sabrStream) {
        sabrStream.cleanup()
        sabrAbortController?.abort()
      }
      // The media element can emit one final timeupdate while Shaka is being
      // destroyed, after its internal manifest has already been cleared.
      hasLoaded.value = false
      hasPlaybackPosition.value = false

      // Shaka clears the video's intrinsic dimensions before this component
      // unmounts. Keep its ratio and restore the poster so recovery doesn't
      // briefly collapse the player to the empty video's 150px default height.
      if (video.value?.videoWidth > 0 && video.value.videoHeight > 0) {
        video.value.style.aspectRatio = `${video.value.videoWidth} / ${video.value.videoHeight}`
      }
      showPoster.value = true
      const remotePlayback = video.value?.remote
      await nextTick()

      let uiState = {
        startNextVideoInFullscreen: false,
        startNextVideoInFullwindow: false,
        startNextVideoInPip: false,
        autoPictureInPictureState: null,
        dockedPanels: []
      }

      if (ui) {
        if (ui.getControls()) {
          // save the state of player settings to reinitialize them upon next creation
          const controls = ui.getControls()
          const isCurrentPlayerInPip = document.pictureInPictureElement === video.value
          uiState = {
            startNextVideoInFullscreen: controls.isFullScreenEnabled(),
            startNextVideoInFullwindow: fullWindowEnabled.value,
            startNextVideoInPip: isCurrentPlayerInPip,
            autoPictureInPictureState: isCurrentPlayerInPip
              ? getAutoPictureInPictureState()
              : null,
            // The transcript and SponsorBlock panels stay closed for the next video.
            dockedPanels: DOCKED_PANEL_RESTORE_ORDER.filter(panel =>
              panel !== 'transcript' && panel !== 'sponsorBlock' && dockedPanels[panel].shown.value)
          }
        }

        // destroying the ui also destroys the player. Release it first, as its
        // controls lose their container before the destruction finishes.
        const destroyingUi = ui
        ui = null
        await destroyingUi.destroy()
        player = null
      } else if (player) {
        await player.destroy()
        player = null
      }

      // Concurrent Shaka UI updates can lose availability-watch IDs. Cancel
      // every watch on this retired video so RemotePlayback releases its DOM.
      await remotePlayback?.cancelWatchAvailability().catch(() => {})

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
      isFullscreen,
      hasLoaded,
      hasPlaybackPosition,
      scrollMiniPlayerActive,
      exitPresentationModes,

      isPaused,
      play,
      pause,
      suspendForShortsNavigation,
      getCurrentTime,
      getCurrentPlaybackRate,
      setCurrentTime,
      getSabrReloadState,
      getActiveCaption,
      retryStreaming,
      setFullscreenMetadata,
      closeFullscreenMetadata,
      setFullscreenTranscript,
      closeFullscreenTranscript,
      dismissFullscreenTranscript,
      setFullscreenSponsorBlock,
      closeFullscreenSponsorBlock,
      closeFullscreenComments,
      closeFullscreenLiveChat,
      closeFullscreenPlaylist,
      setFullscreenQueue,
      closeFullscreenQueue,
      setFullscreenRecommendations,
      closeFullscreenRecommendations,
      closeChaptersOverlay,
      toggleSponsorBlockInfo,
      closeSponsorBlockInfo,
      refreshSponsorBlockInfo,
      skipSponsorBlockInfoSegment,
      voteOnSponsorBlockInfoSegment,
      changeSponsorBlockInfoSegmentCategory,
      copyAndDownvoteSponsorBlockInfoSegment,
      copyChapterTimestamp,
      destroyPlayer
    })

    // #endregion functions used by the watch page

    const showValueChangePopup = ref(false)
    const valueChangeMessage = ref('')
    const valueChangeIcons = ref([])
    const invertValueChangeContentOrder = ref(false)
    let valueChangeTimeout = null
    let accumulatedSeekSeconds = 0
    function setShowUiOnPaused(value) {
      const config = ui?.getControls().getConfig()
      if (config) config.showUIOnPaused = value
    }

    function showOverlayControls() {
      // Fullscreen can end after a playback-engine fallback released the UI.
      ui?.getControls()?.showUI()
    }

    /**
     * Shows a popup with a message and an icon on top of the video player.
     * @param {string} message - The message to display.
     * @param {ValueChangeIcon | ValueChangeIcon[]} icons - The icons to display.
     * @param {boolean} invertContentOrder - Whether to invert the order of the icon and message.
     * @param {number} seekSeconds - Accumulated seek offset, reset by other messages.
     * @param {boolean} revealControls - Whether to also show the player controls.
     */
    function showValueChange(message, icons = [], invertContentOrder = false, seekSeconds = 0, revealControls = true) {
      accumulatedSeekSeconds = seekSeconds
      valueChangeMessage.value = message
      valueChangeIcons.value = Array.isArray(icons) ? icons : [icons]
      showValueChangePopup.value = true
      invertValueChangeContentOrder.value = invertContentOrder

      if (valueChangeTimeout) {
        clearTimeout(valueChangeTimeout)
      }

      valueChangeTimeout = setTimeout(() => {
        showValueChangePopup.value = false
        accumulatedSeekSeconds = 0
      }, 2000)

      if (revealControls) showOverlayControls()
    }

    return {
      copyStreamRecoveryNotice,
      dismissStreamRecoveryNotice,
      fullscreenDockHeaderSelector: FULLSCREEN_DOCK_HEADER_SELECTOR,
      portraitFullscreenDocks,
      fullscreenDockOpen,
      fullscreenDockTitle,
      closePortraitFullscreenDock,
      hasLoaded,
      useVrMode,
      androidFullscreenHostActive,
      videoLayoutReady,
      shortsPaused,
      playbackEnded,
      replayIcon: shaka.ui.Enums.MaterialDesignSVGIcons.REPLAY,
      replayLabel,
      seekingIsPossible,
      seekBySeconds,
      shortsMuted,
      shortsCaptionsAvailable,
      shortsCaptionsEnabled,
      closedCaptionsOutlinedIcon: CLOSED_CAPTIONS_OUTLINED,
      closedCaptionsFilledIcon: shaka.ui.Enums.MaterialDesignSVGIcons.CLOSED_CAPTIONS,
      showPoster,
      pictureInPictureActive,
      showEndedScreen,
      useFrostedGlassPlayerUi,
      endedRecommendations,
      blurThumbnails,
      showPaidPromotion,
      toggleShortsPlayback,
      toggleShortsMuted,
      toggleShortsCaptions,
      handlePlaying,
      handleWaiting,
      updateVideoElementGeometry,
      openShortsOverflowMenu,
      positionShortsContextMenu,
      handlePlayerContextMenu,
      handlePlayerTouchEnd,
      handlePlayerMouseMove,
      handlePlayerMouseLeave,
      handlePlayerFocusIn,
      toggleShortsFullscreen,
      handlePlayerControlDoubleClick,
      ambientCanvas,
      ambientFullscreenCanvas,
      ambientLayoutCanvas,
      ambientModeVisible,
      audioPlayerMode,
      musicAudioTrack,
      hideBrokenMusicImage,
      showMusicImage,
      musicVisualizerCanvas,
      musicVisualizerEnabled,
      fullscreenAmbientBarsVisible,
      captionCssVariables,
      captionPlayerVariables,
      captionAppearanceSampleBottom,
      showCaptionAppearanceSample,
      secondaryCaptionText,
      secondaryCaptionsBox,
      secondaryCaptionsAtTop,
      isActiveTab,
      container,
      mobileMiniBarOverlay,
      video,
      voiceOverTranslationState: voiceOverTranslation.state,
      vrCanvas,
      chapterOverlay,
      showChaptersOverlay,
      isFullscreen,
      playerPaused,
      pausedInterfaceRevealed,
      playingInterfaceHideDelay,
      showPlayerControlsWhenPaused,
      showVideoTitleWhenPaused,
      showFullscreenActionsWhenPaused,
      actionDockVisible,
      visibleFullscreenActions,
      actionDockFocused,
      fullscreenActionsElement,
      fullscreenActionsContent,
      fullscreenActionsBlockSize,
      sponsorBlockNoticesElement,
      sponsorBlockNoticeSize,
      playerControlsShown,
      lightsOffVisible,
      isSubMenuOpened,
      presentationModeChanging,
      chapterThumbnails,
      closeChaptersOverlay,
      selectOverlayChapter,
      copyChapterTimestamp,
      fullscreenDockStyle,
      repeatStats,
      hideRepeatStats,
      repeatStatsTime,
      repeatStatsRange,
      fullscreenDockCanResize,
      fullscreenDockCanReorder,
      fullscreenDockResizing,
      fullscreenDockReordering,
      enableMobileFullscreenSwipe,
      mobileSideSwipesEnabled,
      mobileFullscreenSwiping,
      mobileFullscreenSwipeSettling,
      mobileFullscreenSwipeStyle,
      mobileSeekPreview,
      resetFullscreenDockHeights,
      handleDocumentClick,
      handleFullscreenDockHeaderDoubleClick,
      handleFullscreenDockResizePointerDown,
      handleFullscreenDockResizeKeydown,
      handleFullscreenDockReorderPointerDown,
      fullscreenMetadataOverlay,
      fullscreenMetadataTarget,
      showFullscreenMetadata,
      closeFullscreenMetadata,
      fullscreenTranscriptOverlay,
      fullscreenTranscriptTarget,
      showFullscreenTranscript,
      closeFullscreenTranscript,
      dismissFullscreenTranscript,
      toggleFullscreenTranscript,
      fullscreenSponsorBlockOverlay,
      fullscreenSponsorBlockTarget,
      showFullscreenSponsorBlock,
      closeFullscreenSponsorBlock,
      toggleFullscreenSponsorBlock,
      fullscreenCommentsOverlay,
      showFullscreenComments,
      closeFullscreenComments,
      setFullscreenComments,
      requestShortsPhonePanel,
      fullscreenLiveChatOverlay,
      fullscreenLiveChatTarget,
      showFullscreenLiveChat,
      closeFullscreenLiveChat,
      setFullscreenLiveChat,
      fullscreenQueueOverlay,
      fullscreenQueueTarget,
      showFullscreenQueue,
      setFullscreenQueue,
      closeFullscreenQueue,
      fullscreenRecommendationsOverlay,
      fullscreenRecommendationsTarget,
      showFullscreenRecommendations,
      setFullscreenRecommendations,
      closeFullscreenRecommendations,
      fullscreenPlaylistOverlay,
      fullscreenPlaylistTarget,
      showFullscreenPlaylist,
      fullscreenDockLayoutOpen,
      closeFullscreenPlaylist,
      setFullscreenPlaylist,
      showFullscreenShareAction,
      showFullscreenPlaylistAction,
      isInAnyPlaylist,
      useSponsorBlock,
      getShareTimestamp,
      toggleQuickBookmark,
      openDownload,

      autoQualitySupported,
      tabId,

      fullWindowEnabled,
      fullWindowPlaceholderHeight,
      forceAspectRatio,

      showStats,
      stats,
      playerDimensions,
      annotationCurrentTime,
      annotationVideoAspectRatio,
      annotationVideoFit,

      autoplayVideos,
      suppressInitialAutoplay,
      loopShorts,
      sponsorBlockShowSkippedToast,
      sponsorBlockDraftEditValues,
      sponsorBlockDraftSegments,
      sponsorBlockSubmissionCategories,
      sponsorBlockSubmissionCategoryNames,
      getSponsorBlockActionTypeSelectNames,
      getSponsorBlockActionTypeSelectValues,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      isSponsorBlockDraftEditing,
      isSponsorBlockFullVideoSegment,
      isSponsorBlockPointSegment,

      promptSponsorBlockSegments,
      getSponsorBlockPromptLabel,
      getSponsorBlockPromptActionLabel,
      getSponsorBlockPromptTimeLabel,
      dismissPromptSponsorBlockSegment,
      skipPromptSponsorBlockSegment,
      skippedSponsorBlockSegments,
      sponsorBlockEnableSubmission,
      sponsorBlockVotePending,
      sponsorBlockToastEditingSegment,
      sponsorBlockToastEditingUuid,
      toggleSponsorBlockToastEditing,
      clampSponsorBlockToastEditorScroll,
      changeSponsorBlockInfoSegmentCategory,
      copyAndDownvoteSponsorBlockInfoSegment,
      getSponsorBlockToastTimeLabel,
      isSponsorBlockToastCountdownPaused,
      getSponsorBlockToastActionLabel,
      getSponsorBlockToastLabel,
      pauseSponsorBlockToastCountdown,
      resumeSponsorBlockToastCountdown,
      removeSponsorBlockToast,
      unskipSponsorBlockSegment,
      redoSkipSponsorBlockSegment,
      updateSponsorBlockDraftEditField,
      updateSponsorBlockDraftActionType,
      updateSponsorBlockDraftCategory,
      setSponsorBlockDraftTime,
      getSponsorBlockSubmissionVideoDuration,
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
      handleVideoResize,
      handleEnded,
      handleSeeking,
      handleSeeked,
      handleMediaFrameLoaded,
      handleAbRepeatDurationChange,
      updateVolume,
      handleTimeupdate,
      handleRateChange,
      handleEnterPictureInPicture,
      handleLeavePictureInPicture,

      videoZoomStyle,
      videoZoomPossible,
      videoZoomPanning,
      videoZoomPinching,
      videoZoomGestureZoom,
      videoFillZoomProximity,
      videoFillZoomSnapReady,
      formatVideoZoom,
      videoZoomPanReady,
      handleVideoZoomPointerEnter,
      handleVideoZoomPointerLeave,
      handleVideoZoomPointerDown,
      handleVideoZoomPointerMove,
      handleVideoZoomPointerUp,
      handleVideoZoomPointerCancel,
      handleMobilePlayerTouchEnd,
      handleMobilePlayerTouchMove,

      valueChangeMessage,
      valueChangeIcons,
      showValueChangePopup,
      invertValueChangeContentOrder,
      showTemporaryPlaybackRateIndicator,
      temporaryPlaybackRateIndicatorMessage,

      scrollMiniPlayerActive,
      mobileMiniBar,
      compactMobileMiniPlayer,
      mobileMiniBarExpanded,
      mobileMiniBarCollapsed,
      mobileMiniBarCanDismiss,
      mobileMiniBarControlsDisabled,
      mobileMiniBarSeekDisabled,
      mobileMiniBarSeekLabel,
      mobileMiniBarSeekValueText,
      mobileMiniBarSeeking,
      startMobileMiniBarSeek,
      handleMobileMiniBarSeekInput,
      mobileMiniBarOverlayStyle,
      mobileMiniBarProgress,
      updateMobileMiniBarProgress,
      scrollMiniPlayerAnimating,
      scrollMiniPlayerDetached,
      scrollMiniPlayerDismissed,
      scrollMiniPlaceholderHeight,
      scrollMiniPlayerStyle,
      scrollMiniPlayerDragStyle,
      scrollMiniPlayerStashed,
      scrollMiniPlayerStashedSide,
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
      dismissCrossTabMiniPlayer,
      dismissMobileMiniPlayer,
      scrollMiniTogglePlayPause,
      scrollMiniScrollToTop,
      restoreInlinePlayer,
      revealScrollMiniPlayerControls,
      updateScrollMiniVolume,
      handleScrollMiniVolumeMouseEnter,
      handleScrollMiniVolumeMouseLeave,
      handleScrollMiniVolumePointerDown,
      handleScrollMiniDragPointerDown,
      handleScrollMiniResizePointerDown,
    }
  }
})
