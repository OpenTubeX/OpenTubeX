import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import shaka from 'shaka-player'
import { useI18n } from '../../composables/use-i18n-polyfill'

import store from '../../store/index'
import { KeyboardShortcuts } from '../../../constants'
import { AudioTrackSelection } from './player-components/AudioTrackSelection'
import { CopyVideoUrlButton } from './player-components/CopyVideoUrlButton'
import { FullWindowButton } from './player-components/FullWindowButton'
import { LegacyQualitySelection } from './player-components/LegacyQualitySelection'
import { LoopButton } from './player-components/LoopButton'
import { QuickPlaybackRateBar } from './player-components/QuickPlaybackRateBar'
import { ScreenshotButton } from './player-components/ScreenshotButton'
import { SponsorBlockCancelButton } from './player-components/SponsorBlockCancelButton'
import { SponsorBlockClearButton } from './player-components/SponsorBlockClearButton'
import { SponsorBlockEndButton } from './player-components/SponsorBlockEndButton'
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
import { submitSponsorBlockSegments } from '../../helpers/sponsorblock'
import {
  addKeyboardShortcutToActionTitle,
  formatDurationAsTimestamp,
  openExternalLink,
  showToast,
  writeFileWithPicker,
  throttle,
  removeFromArrayIfExists,
  copyToClipboard,
} from '../../helpers/utils'
import { colors } from '../../helpers/colors'
import { appendTimestamp, getInvidiousVideoUrl, getYoutubeVideoShareUrl } from '../../helpers/share'
import { MANIFEST_TYPE_SABR } from '../../helpers/player/SabrManifestParser'
import { setupSabrScheme } from '../../helpers/player/SabrSchemePlugin'
import { getRememberedPlayerVolume, setRememberedPlayerVolume } from '../../helpers/player/volume-storage'

/** @typedef {import('../../helpers/sponsorblock').SponsorBlockCategory} SponsorBlockCategory */

const SPONSORBLOCK_SUBMISSION_CATEGORIES = Object.freeze([
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'music_offtopic',
  'filler'
])

const SPONSORBLOCK_PREVIEW_SECONDS = 2
const SPONSORBLOCK_TIMESTAMP_PRECISION_MS = 1
const SPONSORBLOCK_PREVIEW_END_EPSILON_SECONDS = 0.01
const SPONSORBLOCK_NOT_FOUND_REFETCH_RECENT_VIDEO_AGE_MS = 24 * 60 * 60 * 1000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS = 10000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS = 40000
const SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS = 150

function createSponsorBlockDraftId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `sb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatSponsorBlockDraftTimestamp(seconds) {
  const safeMilliseconds = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000))
  const wholeSeconds = Math.floor(safeMilliseconds / 1000)
  const milliseconds = safeMilliseconds % 1000
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60

  const formatted = `${minutes.toString().padStart(hours > 0 ? 2 : 1, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
  return hours > 0 ? `${hours.toString().padStart(2, '0')}:${formatted}` : formatted
}

function parseSponsorBlockDraftTimestamp(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()
  if (trimmedValue === '') {
    return null
  }

  const parts = trimmedValue.split(':')
  if (parts.length > 3 || parts.some(part => part === '')) {
    return null
  }

  const secondsPart = parts.pop()
  if (!/^\d+(?:\.\d{1,3})?$/.test(secondsPart)) {
    return null
  }

  const [wholeSecondsPart, fractionalPart = ''] = secondsPart.split('.')
  const seconds = Number.parseInt(wholeSecondsPart, 10)
  const fractionalMilliseconds = Number.parseInt(fractionalPart.padEnd(3, '0'), 10)

  let totalMilliseconds = (seconds * 1000) + fractionalMilliseconds
  let multiplier = 60

  while (parts.length > 0) {
    const part = parts.pop()
    if (!/^\d+$/.test(part)) {
      return null
    }

    totalMilliseconds += Number.parseInt(part, 10) * multiplier * 1000
    multiplier *= 60
  }

  return totalMilliseconds / 1000
}

function normalizeSponsorBlockDraftTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return null
  }

  return Math.max(0, Math.round(seconds * 1000 / SPONSORBLOCK_TIMESTAMP_PRECISION_MS) * SPONSORBLOCK_TIMESTAMP_PRECISION_MS / 1000)
}

// The UTF-8 characters "h", "t", "t", and "p".
const HTTP_IN_HEX = 0x68747470

const USE_OVERFLOW_MENU_WIDTH_THRESHOLD = 634

const RequestType = shaka.net.NetworkingEngine.RequestType
const AdvancedRequestType = shaka.net.NetworkingEngine.AdvancedRequestType
const TrackLabelFormat = shaka.ui.Overlay.TrackLabelFormat
const { Severity: ErrorSeverity, Category: ErrorCategory, Code: ErrorCode } = shaka.util.Error

/*
  Mapping of Shaka localization keys for control labels to FreeTube shortcuts.
  See: https://github.com/shaka-project/shaka-player/blob/main/ui/locales/en.json
*/
const shakaControlKeysToShortcuts = {
  MUTE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  UNMUTE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  PLAY: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PAUSE: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PICTURE_IN_PICTURE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  ENTER_PICTURE_IN_PICTURE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  EXIT_PICTURE_IN_PICTURE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  CAPTIONS: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS,
  FULL_SCREEN: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN,
  EXIT_FULL_SCREEN: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN
}

/** @type {Map<string, string>} */
const LOCALE_MAPPINGS = new Map(process.env.SHAKA_LOCALE_MAPPINGS)

export default defineComponent({
  name: 'FtShakaVideoPlayer',
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
    chaptersSrc: {
      type: String,
      default: ''
    },
    storyboardSrc: {
      type: String,
      default: ''
    },
    videoId: {
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
    channelId: {
      type: String,
      default: ''
    },
    published: {
      type: Number,
      default: 0
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
    resumePlaybackAfterSabrReload: {
      type: Boolean,
      default: false
    },
  },
  emits: [
    'error',
    'loaded',
    'ended',
    'pause',
    'timeupdate',
    'toggle-autoplay',
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
  ],
  setup: function (props, { emit, expose }) {
    const { locale, t } = useI18n()

    /** @type {shaka.Player|null} */
    let player = null

    /** @type {shaka.ui.Overlay|null} */
    let ui = null

    const events = new EventTarget()

    /** @type {import('vue').Ref<HTMLDivElement | null>} */
    const container = ref(null)

    /** @type {import('vue').Ref<HTMLVideoElement | null>} */
    const video = ref(null)

    /** @type {import('vue').Ref<HTMLCanvasElement | null>} */
    const vrCanvas = ref(null)

    const hasLoaded = ref(false)

    const hasMultipleAudioTracks = ref(false)
    const isLive = ref(false)

    const onlyUseOverFlowMenu = ref(false)
    const forceAspectRatio = ref(false)

    const activeLegacyFormat = shallowRef(null)

    const fullWindowEnabled = ref(false)
    const startInFullwindow = props.startInFullwindow
    let startInFullscreen = props.startInFullscreen
    let startInPip = props.startInPip
    let exitFullscreenCleanup = null

    /** @type {number|null} */
    let restoreCaptionIndex = null

    if (store.getters.getEnableSubtitlesByDefault && props.captions.length > 0) {
      restoreCaptionIndex = 0
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

    const isActiveTab = ref(!process.env.IS_ELECTRON)

    /** @type {import('vue').ComputedRef<boolean>} */
    const autoplayVideos = computed(() => {
      return store.getters.getAutoplayVideos && isActiveTab.value
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const displayVideoPlayButton = computed(() => {
      return store.getters.getDisplayVideoPlayButton
    })

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
        video.value.defaultPlaybackRate = newValue
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

    /** @type {import('vue').ComputedRef<number>} */
    const sponsorBlockSkippedToastDuration = computed(() => {
      return store.getters.getSponsorBlockSkippedToastDuration
    })

    const sponsorBlockSkippedToastDurationMs = computed(() => {
      return Math.max(2, Math.min(15, sponsorBlockSkippedToastDuration.value)) * 1000
    })

    /** @type {import('vue').ComputedRef<boolean>} */
    const sponsorBlockEnableSubmission = computed(() => {
      return store.getters.getSponsorBlockEnableSubmission
    })

    /** @type {import('vue').ComputedRef<Record<string, {id: string, startTime: number, endTime: number | null, category: SponsorBlockCategory, previewed: boolean}[]>>} */
    const sponsorBlockDraftSegmentsByVideoId = computed(() => {
      return store.getters.getSponsorBlockDraftSegmentsByVideoId
    })

    const sponsorSkips = computed(() => {
      // save some work when sponsorblock is disabled
      if (!useSponsorBlock.value) {
        return {}
      }

      /** @type {SponsorBlockCategory[]} */
      const sponsorCategories = ['sponsor',
        'selfpromo',
        'interaction',
        'intro',
        'outro',
        'preview',
        'music_offtopic',
        'filler',
        'poi_highlight'
      ]

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

      sponsorCategories.forEach(x => {
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
     *   startTime: number,
     *   endTime: number
     * }[]}
     */
    let sponsorBlockSegments = []
    let sponsorBlockAverageVideoDuration = 0

    /**
     * Yes a map would be much more suitable for this (unlike objects they retain the order that items were inserted),
     * but Vue 2 doesn't support reactivity on Maps, so we have to use an array instead
     * @type {import('vue').Ref<{uuid: string, translatedCategory: string, color: string, timeoutId: ReturnType<typeof setTimeout>|0, hideAt: number|null, hideRemainingMs: number, unskipped: boolean, countdownPaused: boolean}[]>}
     */
    const skippedSponsorBlockSegments = ref([])
    const promptSponsorBlockSegments = ref([])
    const sponsorBlockToastNow = ref(Date.now())
    const sponsorBlockCurrentTime = ref(0)
    let sponsorBlockToastTimeInterval = null

    /** @type {import('vue').Ref<{id: string, startTime: number, endTime: number | null, category: SponsorBlockCategory, previewed: boolean}[]>} */
    const sponsorBlockDraftSegments = ref([])
    const sponsorBlockDraftEditValues = reactive({})
    const sponsorBlockDraftEditingStates = reactive({})
    const sponsorBlockSubmissionMenuOpen = ref(false)
    const sponsorBlockSubmissionError = ref('')
    const sponsorBlockSubmissionPending = ref(false)
    const sponsorBlockPreviewSkipSegment = ref(null)
    let sponsorBlockPreviewSkipAnimationFrame = null

    const sponsorBlockSubmissionAvailable = computed(() => {
      return useSponsorBlock.value &&
        sponsorBlockEnableSubmission.value &&
        props.videoId !== '' &&
        !isLive.value
    })

    const sponsorBlockCompleteDraftSegments = computed(() => {
      return sponsorBlockDraftSegments.value.filter(segment => typeof segment.endTime === 'number')
    })

    const sponsorBlockHasIncompleteDraft = computed(() => {
      return sponsorBlockDraftSegments.value.some(segment => segment.endTime == null)
    })

    const sponsorBlockSubmissionVisibleButtons = computed(() => {
      if (!sponsorBlockSubmissionAvailable.value) {
        return []
      }

      const visibleButtons = []

      if (sponsorBlockDraftSegments.value.length === 0) {
        visibleButtons.push('start')
        return visibleButtons
      }

      visibleButtons.push('menu')

      if (sponsorBlockHasIncompleteDraft.value) {
        visibleButtons.push('cancel', 'end')
      } else {
        visibleButtons.push('start')
      }

      if (sponsorBlockCompleteDraftSegments.value.length > 0) {
        visibleButtons.push('clear')
      }

      return visibleButtons
    })

    function updateSponsorBlockSubmissionState() {
      events.dispatchEvent(new CustomEvent('sponsorBlockSubmissionStateChanged', {
        detail: {
          visibleButtons: sponsorBlockSubmissionVisibleButtons.value
        }
      }))
    }

    function getSponsorBlockDraftEditValue(segmentId) {
      if (!sponsorBlockDraftEditValues[segmentId]) {
        sponsorBlockDraftEditValues[segmentId] = {
          startTime: '',
          endTime: '',
          category: 'sponsor'
        }
      }

      return sponsorBlockDraftEditValues[segmentId]
    }

    /**
     * @param {string} segmentId
     * @returns {boolean}
     */
    function isSponsorBlockDraftEditing(segmentId) {
      return sponsorBlockDraftEditingStates[segmentId] !== false
    }

    /**
     * @param {string} segmentId
     * @param {boolean} isEditing
     */
    function setSponsorBlockDraftEditing(segmentId, isEditing) {
      sponsorBlockDraftEditingStates[segmentId] = isEditing
    }

    /**
     * @param {{id: string, startTime: number, endTime: number | null, category: SponsorBlockCategory}} segment
     */
    function setSponsorBlockDraftEditValue(segment) {
      sponsorBlockDraftEditValues[segment.id] = {
        startTime: formatSponsorBlockDraftTimestamp(segment.startTime),
        endTime: segment.endTime == null ? '' : formatSponsorBlockDraftTimestamp(segment.endTime),
        category: segment.category
      }
    }

    function pruneSponsorBlockDraftEditValues() {
      const validIds = new Set(sponsorBlockDraftSegments.value.map(segment => segment.id))

      Object.keys(sponsorBlockDraftEditValues).forEach((id) => {
        if (!validIds.has(id)) {
          delete sponsorBlockDraftEditValues[id]
        }
      })

      Object.keys(sponsorBlockDraftEditingStates).forEach((id) => {
        if (!validIds.has(id)) {
          delete sponsorBlockDraftEditingStates[id]
        }
      })
    }

    /**
     * Replace a draft segment in the reactive array so downstream UI state updates reliably.
     *
     * @param {string} segmentId
     * @param {(segment: {
     *   id: string,
     *   startTime: number,
     *   endTime: number | null,
     *   category: SponsorBlockCategory,
     *   previewed: boolean
     * }) => {
     *   id: string,
     *   startTime: number,
     *   endTime: number | null,
     *   category: SponsorBlockCategory,
     *   previewed: boolean
     * }} updateSegment
     * @returns {{
     *   id: string,
     *   startTime: number,
     *   endTime: number | null,
     *   category: SponsorBlockCategory,
     *   previewed: boolean
     * } | null}
     */
    function replaceSponsorBlockDraftSegment(segmentId, updateSegment) {
      const segmentIndex = sponsorBlockDraftSegments.value.findIndex(segment => segment.id === segmentId)
      if (segmentIndex === -1) {
        return null
      }

      const nextSegment = updateSegment(sponsorBlockDraftSegments.value[segmentIndex])
      sponsorBlockDraftSegments.value = sponsorBlockDraftSegments.value.map((segment, index) => {
        return index === segmentIndex ? nextSegment : segment
      })
      return nextSegment
    }

    function normalizeSponsorBlockDraftSegment(segment) {
      const category = SPONSORBLOCK_SUBMISSION_CATEGORIES.includes(segment?.category)
        ? segment.category
        : 'sponsor'

      const startTime = normalizeSponsorBlockDraftTime(segment?.startTime) ?? 0
      const endTime = normalizeSponsorBlockDraftTime(segment?.endTime)

      return {
        id: typeof segment?.id === 'string' && segment.id !== '' ? segment.id : createSponsorBlockDraftId(),
        startTime,
        endTime,
        category,
        previewed: Boolean(segment?.previewed && endTime != null)
      }
    }

    function serializeSponsorBlockDraftSegment(segment) {
      const normalizedSegment = normalizeSponsorBlockDraftSegment(segment)

      return {
        id: normalizedSegment.id,
        startTime: normalizedSegment.startTime,
        endTime: normalizedSegment.endTime,
        category: normalizedSegment.category,
        previewed: normalizedSegment.previewed
      }
    }

    function loadSponsorBlockDrafts() {
      const persistedDrafts = sponsorBlockDraftSegmentsByVideoId.value[props.videoId] ?? []
      sponsorBlockDraftSegments.value = persistedDrafts.map(normalizeSponsorBlockDraftSegment)
      sponsorBlockDraftSegments.value.forEach((segment) => {
        setSponsorBlockDraftEditValue(segment)

        if (!(segment.id in sponsorBlockDraftEditingStates)) {
          sponsorBlockDraftEditingStates[segment.id] = true
        }
      })
      pruneSponsorBlockDraftEditValues()

      if (sponsorBlockDraftSegments.value.length === 0) {
        sponsorBlockSubmissionMenuOpen.value = false
        stopSponsorBlockPreviewSkip()
      }
    }

    function stopSponsorBlockPreviewSkip() {
      sponsorBlockPreviewSkipSegment.value = null

      if (sponsorBlockPreviewSkipAnimationFrame !== null) {
        cancelAnimationFrame(sponsorBlockPreviewSkipAnimationFrame)
        sponsorBlockPreviewSkipAnimationFrame = null
      }
    }

    function startSponsorBlockPreviewSkipMonitor() {
      if (sponsorBlockPreviewSkipAnimationFrame !== null) {
        cancelAnimationFrame(sponsorBlockPreviewSkipAnimationFrame)
      }

      const step = () => {
        if (!sponsorBlockPreviewSkipSegment.value || !video.value || !player || !canSeek()) {
          sponsorBlockPreviewSkipAnimationFrame = null
          return
        }

        handleSponsorBlockPreviewSkip(video.value.currentTime)

        if (sponsorBlockPreviewSkipSegment.value) {
          sponsorBlockPreviewSkipAnimationFrame = requestAnimationFrame(step)
        } else {
          sponsorBlockPreviewSkipAnimationFrame = null
        }
      }

      sponsorBlockPreviewSkipAnimationFrame = requestAnimationFrame(step)
    }

    async function persistSponsorBlockDrafts() {
      const persistedDrafts = Object.fromEntries(
        Object.entries(sponsorBlockDraftSegmentsByVideoId.value).map(([videoId, segments]) => {
          return [videoId, Array.isArray(segments) ? segments.map(serializeSponsorBlockDraftSegment) : []]
        })
      )

      if (sponsorBlockDraftSegments.value.length === 0) {
        delete persistedDrafts[props.videoId]
      } else {
        persistedDrafts[props.videoId] = sponsorBlockDraftSegments.value.map(serializeSponsorBlockDraftSegment)
      }

      await store.dispatch('updateSponsorBlockDraftSegmentsByVideoId', persistedDrafts)
    }

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
        sponsorSkips.value.seekBar.length === 0 ||
        sponsorBlockSegments.length > 0
      ) {
        return
      }

      const videoId = props.videoId
      const refetchDelayMs = SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS +
        Math.random() * (SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS - SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS)

      sponsorBlockNotFoundRefetchTimeout = setTimeout(() => {
        sponsorBlockNotFoundRefetchTimeout = null

        if (!ui || !player || props.videoId !== videoId || sponsorBlockSegments.length > 0) {
          return
        }

        refetchSponsorBlockSegmentsWhenNotFound()
      }, refetchDelayMs)
    }

    async function refetchSponsorBlockSegmentsWhenNotFound() {
      let segments, averageDuration

      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(props.videoId, sponsorSkips.value.seekBar))
      } catch (e) {
        console.error(e)
        return
      }

      if (!ui || !player) {
        return
      }

      if (segments.length > 0) {
        sponsorBlockSegments = segments
        sponsorBlockAverageVideoDuration = averageDuration
        refreshSponsorBlockMarkers()
        if (canSeek()) {
          syncPromptSponsorBlockSegments(video.value?.currentTime ?? 0)
        }
      } else {
        scheduleSponsorBlockNotFoundRefetch()
      }
    }

    async function setupSponsorBlock() {
      let segments, averageDuration
      let refetchWhenNotFound = false

      clearSponsorBlockNotFoundRefetchTimeout()

      // Reset the do-not-skip set for the new video
      sponsorBlockDoNotSkipSegments = new Set()
      sponsorBlockDismissedPromptSegments = new Set()
      sponsorBlockSegments = []
      sponsorBlockAverageVideoDuration = 0

      try {
        ({ segments, averageDuration } = await getSponsorBlockSegments(props.videoId, sponsorSkips.value.seekBar))
        refetchWhenNotFound = segments.length === 0
      } catch (e) {
        console.error(e)
        segments = []
      }

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui || !player) {
        return
      }

      clearSponsorBlockMarkers()

      if (segments.length > 0) {
        sponsorBlockSegments = segments
        sponsorBlockAverageVideoDuration = averageDuration
      } else if (refetchWhenNotFound) {
        scheduleSponsorBlockNotFoundRefetch()
      }

      refreshSponsorBlockMarkers()
      if (segments.length > 0 && canSeek()) {
        syncPromptSponsorBlockSegments(video.value?.currentTime ?? 0)
      }
    }

    function getCurrentSponsorBlockDraft() {
      return sponsorBlockDraftSegments.value.findLast(segment => segment.endTime == null) ?? null
    }

    function getSponsorBlockSubmissionVideoDuration() {
      const seekRangeEnd = player?.seekRange()?.end
      const mediaDuration = video.value?.duration
      const durations = [seekRangeEnd, mediaDuration].filter(Number.isFinite)

      return durations.length > 0 ? Math.max(...durations) : null
    }

    function openSponsorBlockSubmissionMenu() {
      if (!sponsorBlockSubmissionAvailable.value || sponsorBlockDraftSegments.value.length === 0) {
        return
      }

      sponsorBlockSubmissionMenuOpen.value = true
      sponsorBlockSubmissionError.value = ''
      showOverlayControls()
    }

    function closeSponsorBlockSubmissionMenu() {
      sponsorBlockSubmissionMenuOpen.value = false
      sponsorBlockSubmissionError.value = ''
    }

    async function startSponsorBlockDraft() {
      if (!sponsorBlockSubmissionAvailable.value || getCurrentSponsorBlockDraft() !== null) {
        return
      }

      sponsorBlockDraftSegments.value.push({
        id: createSponsorBlockDraftId(),
        startTime: Math.max(video.value?.currentTime ?? 0, 0),
        endTime: null,
        category: 'sponsor',
        previewed: false
      })

      sponsorBlockDraftSegments.value.forEach(setSponsorBlockDraftEditValue)
      sponsorBlockDraftEditingStates[sponsorBlockDraftSegments.value.at(-1).id] = true
      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()
    }

    async function endSponsorBlockDraft() {
      const draft = getCurrentSponsorBlockDraft()
      if (!draft) {
        return
      }

      const currentDuration = getSponsorBlockSubmissionVideoDuration()
      const endTime = normalizeSponsorBlockDraftTime(Math.max(video.value?.currentTime ?? 0, 0))
      const clampedEndTime = currentDuration == null
        ? endTime
        : Math.min(endTime ?? 0, currentDuration)
      if (clampedEndTime <= draft.startTime) {
        const errorMessage = t('Video.Player.SponsorBlock.EndTimeAfterStart')
        sponsorBlockSubmissionError.value = errorMessage
        showToast(errorMessage)
        return
      }

      const updatedDraft = replaceSponsorBlockDraftSegment(draft.id, (segment) => ({
        ...segment,
        endTime: clampedEndTime,
        previewed: false
      }))
      if (!updatedDraft) {
        return
      }

      setSponsorBlockDraftEditValue(updatedDraft)
      setSponsorBlockDraftEditing(updatedDraft.id, true)
      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()
      openSponsorBlockSubmissionMenu()
    }

    async function cancelCurrentSponsorBlockDraft() {
      const currentDraft = getCurrentSponsorBlockDraft()
      if (!currentDraft) {
        return
      }

      sponsorBlockDraftSegments.value = sponsorBlockDraftSegments.value.filter(segment => segment.id !== currentDraft.id)
      pruneSponsorBlockDraftEditValues()
      if (sponsorBlockDraftSegments.value.length === 0) {
        closeSponsorBlockSubmissionMenu()
      }

      if (sponsorBlockPreviewSkipSegment.value?.id === currentDraft.id) {
        stopSponsorBlockPreviewSkip()
      }

      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()
    }

    async function clearSponsorBlockDrafts() {
      if (sponsorBlockCompleteDraftSegments.value.length === 0) {
        return
      }

      if (!confirm(t('Video.Player.SponsorBlock.ClearSegmentsPrompt'))) {
        return
      }

      sponsorBlockDraftSegments.value = []
      pruneSponsorBlockDraftEditValues()
      closeSponsorBlockSubmissionMenu()
      await persistSponsorBlockDrafts()
    }

    function updateSponsorBlockDraftEditField(segmentId, field, value) {
      getSponsorBlockDraftEditValue(segmentId)[field] = value
    }

    async function updateSponsorBlockDraftCategory(segmentId, value) {
      updateSponsorBlockDraftEditField(segmentId, 'category', value)
      await saveSponsorBlockDraft(segmentId)
    }

    async function saveSponsorBlockDraft(segmentId) {
      const segment = sponsorBlockDraftSegments.value.find(draft => draft.id === segmentId)
      if (!segment) {
        return false
      }

      const editValue = getSponsorBlockDraftEditValue(segmentId)
      const startTime = parseSponsorBlockDraftTimestamp(editValue.startTime)
      const endTime = editValue.endTime.trim() === '' ? null : parseSponsorBlockDraftTimestamp(editValue.endTime)
      const category = SPONSORBLOCK_SUBMISSION_CATEGORIES.includes(editValue.category) ? editValue.category : 'sponsor'

      if (startTime == null) {
        const errorMessage = t('Video.Player.SponsorBlock.InvalidStartTime')
        sponsorBlockSubmissionError.value = errorMessage
        showToast(errorMessage)
        return false
      }

      if (endTime != null && endTime <= startTime) {
        const errorMessage = t('Video.Player.SponsorBlock.EndTimeAfterStart')
        sponsorBlockSubmissionError.value = errorMessage
        showToast(errorMessage)
        return false
      }

      const currentDuration = getSponsorBlockSubmissionVideoDuration()
      if (endTime != null && currentDuration != null && endTime > currentDuration) {
        const errorMessage = t('Video.Player.SponsorBlock.EndTimeBeforeVideoEnd')
        sponsorBlockSubmissionError.value = errorMessage
        showToast(errorMessage)
        return false
      }

      const hasChanged = segment.startTime !== startTime ||
        segment.endTime !== endTime ||
        segment.category !== category

      const updatedSegment = replaceSponsorBlockDraftSegment(segmentId, (draft) => ({
        ...draft,
        startTime: normalizeSponsorBlockDraftTime(startTime) ?? 0,
        endTime: normalizeSponsorBlockDraftTime(endTime),
        category,
        previewed: hasChanged ? false : draft.previewed
      }))
      if (!updatedSegment) {
        return false
      }

      setSponsorBlockDraftEditValue(updatedSegment)
      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()
      updateSponsorBlockSubmissionState()
      return true
    }

    async function toggleSponsorBlockDraftEditing(segmentId) {
      if (isSponsorBlockDraftEditing(segmentId)) {
        if (await saveSponsorBlockDraft(segmentId)) {
          setSponsorBlockDraftEditing(segmentId, false)
        }
      } else {
        const segment = sponsorBlockDraftSegments.value.find(draft => draft.id === segmentId)
        if (!segment) {
          return
        }

        setSponsorBlockDraftEditValue(segment)
        setSponsorBlockDraftEditing(segmentId, true)
      }
    }

    async function setSponsorBlockDraftTime(segmentId, field, value) {
      const editValue = getSponsorBlockDraftEditValue(segmentId)
      editValue[field] = value == null ? '' : formatSponsorBlockDraftTimestamp(value)
      await saveSponsorBlockDraft(segmentId)
    }

    async function previewSponsorBlockDraft(segmentId, mode = 'preview') {
      const draft = sponsorBlockDraftSegments.value.find(segment => segment.id === segmentId)
      if (!draft || !canSeek()) {
        return
      }

      if (!await saveSponsorBlockDraft(segmentId)) {
        return
      }

      if (draft.endTime == null) {
        return
      }

      stopSponsorBlockPreviewSkip()

      if (mode === 'inspect') {
        video.value.currentTime = draft.startTime
        sponsorBlockCurrentTime.value = draft.startTime
        showOverlayControls()
        return
      }

      if (mode === 'end') {
        video.value.currentTime = draft.endTime
        sponsorBlockCurrentTime.value = draft.endTime
        showOverlayControls()
        return
      }

      const previewStartTime = draft.startTime === 0
        ? 0
        : Math.max(draft.startTime - (SPONSORBLOCK_PREVIEW_SECONDS * video.value.playbackRate), 0)

      video.value.currentTime = previewStartTime
      sponsorBlockCurrentTime.value = previewStartTime
      sponsorBlockPreviewSkipSegment.value = {
        id: draft.id,
        startTime: draft.startTime,
        endTime: draft.endTime
      }
      startSponsorBlockPreviewSkipMonitor()
      replaceSponsorBlockDraftSegment(segmentId, (segment) => ({
        ...segment,
        previewed: true
      }))
      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()

      try {
        await video.value.play()
      } catch (error) {
        console.error('failed to play SponsorBlock preview', error)
      }

      showOverlayControls()
    }

    async function deleteSponsorBlockDraft(segmentId) {
      sponsorBlockDraftSegments.value = sponsorBlockDraftSegments.value.filter(segment => segment.id !== segmentId)
      pruneSponsorBlockDraftEditValues()
      if (sponsorBlockDraftSegments.value.length === 0) {
        closeSponsorBlockSubmissionMenu()
      }

      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()
    }

    function getSponsorBlockSubmitErrorMessage(error) {
      const status = Number.parseInt(error?.name?.split(':')[1] ?? '', 10)

      switch (status) {
        case 400:
          return t('Video.Player.SponsorBlock.SubmissionBadRequest')
        case 403:
          return error.message || t('Video.Player.SponsorBlock.SubmissionForbidden')
        case 409:
          return t('Video.Player.SponsorBlock.SubmissionDuplicate')
        case 429:
          return t('Video.Player.SponsorBlock.SubmissionRateLimited')
        default:
          return error?.message || t('Video.Player.SponsorBlock.SubmissionFailed')
      }
    }

    async function submitSponsorBlockDrafts() {
      if (!sponsorBlockSubmissionAvailable.value || sponsorBlockSubmissionPending.value) {
        return
      }

      if (sponsorBlockDraftSegments.value.length === 0) {
        sponsorBlockSubmissionError.value = t('Video.Player.SponsorBlock.NoSegmentsToSubmit')
        return
      }

      if (sponsorBlockHasIncompleteDraft.value) {
        sponsorBlockSubmissionError.value = t('Video.Player.SponsorBlock.CompleteSegmentsBeforeSubmitting')
        showToast(sponsorBlockSubmissionError.value)
        return
      }

      for (const segment of sponsorBlockDraftSegments.value) {
        if (!await saveSponsorBlockDraft(segment.id)) {
          return
        }
      }

      if (sponsorBlockDraftSegments.value.some(segment => !segment.previewed)) {
        sponsorBlockSubmissionError.value = t('Video.Player.SponsorBlock.PreviewRequired')
        showToast(sponsorBlockSubmissionError.value)
        return
      }

      const duplicateKeySet = new Set()
      for (const segment of sponsorBlockDraftSegments.value) {
        const duplicateKey = `${segment.startTime}-${segment.endTime}-${segment.category}`
        if (duplicateKeySet.has(duplicateKey)) {
          sponsorBlockSubmissionError.value = t('Video.Player.SponsorBlock.DuplicateSegments')
          showToast(sponsorBlockSubmissionError.value)
          return
        }

        duplicateKeySet.add(duplicateKey)
      }

      sponsorBlockSubmissionPending.value = true
      sponsorBlockSubmissionError.value = ''

      try {
        const videoDuration = getSponsorBlockSubmissionVideoDuration()
        const response = await submitSponsorBlockSegments(
          props.videoId,
          videoDuration,
          sponsorBlockDraftSegments.value.map(segment => ({
            segment: [segment.startTime, segment.endTime],
            category: segment.category,
            actionType: 'skip',
            description: ''
          }))
        )

        const submittedSegments = response.map((segment) => ({
          uuid: segment.UUID,
          category: segment.category,
          startTime: segment.segment[0],
          endTime: segment.segment[1]
        }))

        sponsorBlockSegments = sponsorBlockSegments.concat(submittedSegments).sort((a, b) => a.startTime - b.startTime)

        refreshSponsorBlockMarkers()

        sponsorBlockDraftSegments.value = []
        pruneSponsorBlockDraftEditValues()
        closeSponsorBlockSubmissionMenu()
        await persistSponsorBlockDrafts()
        showToast(t('Video.Player.SponsorBlock.SubmissionSuccess'))
      } catch (error) {
        sponsorBlockSubmissionError.value = getSponsorBlockSubmitErrorMessage(error)
        showToast(sponsorBlockSubmissionError.value, 5000)
      } finally {
        sponsorBlockSubmissionPending.value = false
      }
    }

    function openSponsorBlockGuidelines() {
      openExternalLink('https://wiki.sponsor.ajay.app/w/Guidelines')
    }

    /**
     * @param {number} currentTime
     */
    function handleSponsorBlockPreviewSkip(currentTime) {
      const previewSegment = sponsorBlockPreviewSkipSegment.value
      if (!previewSegment || !canSeek()) {
        return
      }

      if (currentTime >= previewSegment.endTime || currentTime < previewSegment.startTime - 5) {
        stopSponsorBlockPreviewSkip()
        return
      }

      if (currentTime >= previewSegment.startTime && currentTime <= previewSegment.endTime) {
        const seekRange = player.seekRange()
        const targetTime = Math.min(previewSegment.endTime + SPONSORBLOCK_PREVIEW_END_EPSILON_SECONDS, seekRange.end)
        video.value.currentTime = targetTime
        sponsorBlockCurrentTime.value = targetTime
        stopSponsorBlockPreviewSkip()
      }
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
     * @param {{ uuid: string, translatedCategory: string, color: string }} toast
     */
    function upsertSkippedSponsorBlockToast({ uuid, translatedCategory, color }) {
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
     * @returns {string}
     */
    function getSponsorBlockToastActionLabel(unskipped) {
      const actionLabel = unskipped
        ? t('Video.Player.SponsorBlock.SkipToastReskip')
        : t('Video.Player.SponsorBlock.SkipToastUnskip')

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
     * @returns {string}
     */
    function getSponsorBlockPromptActionLabel() {
      return addKeyboardShortcutToActionTitle(
        t('Video.Player.SponsorBlock.SkipPromptAction'),
        t('Keys.enter')
      )
    }

    /**
     * @param {{ category: SponsorBlockCategory }} segment
     * @returns {boolean}
     */
    function isSponsorBlockPointSegment(segment) {
      return segment.category === 'poi_highlight'
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
      if (!segment || !canSeek()) {
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

    function toggleActiveSponsorBlockSkipState() {
      const promptToastEntry = getActivePromptSponsorBlockToast()
      if (promptToastEntry) {
        return skipPromptSponsorBlockSegment(promptToastEntry.uuid)
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
        if (!promptSkip.has(segment.category) || sponsorBlockDoNotSkipSegments.has(segment.uuid)) {
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
        if (segment && (currentTime < segment.startTime || currentTime >= segment.endTime)) {
          sponsorBlockDoNotSkipSegments.delete(uuid)
          removeSponsorBlockToast(uuid)
        }
      }

      const video_ = video.value

      let newTime = 0
      const skippedSegments = []

      sponsorBlockSegments.forEach(segment => {
        if (sponsorBlockDoNotSkipSegments.has(segment.uuid)) {
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
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
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
      if (!segment) {
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
          translatedCategory: toastEntry.translatedCategory
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
          'captions',
          'ft_audio_tracks',
          'chapter',
          'ft_loop',
          'ft_screenshot',
          'picture_in_picture',
          'ft_full_window',
          'recenter_vr',
          'toggle_stereoscopic',
        ]

        elementList = uiConfig.overflowMenuButtons

        uiConfig.controlPanelElements.push('overflow_menu', 'fullscreen')
      } else {
        uiConfig.controlPanelElements.push(
          ...(useQuickPlaybackSpeedBar.value ? ['ft_quick_playback_rate_bar'] : []),
          'ft_sponsorblock_open_menu',
          'ft_sponsorblock_clear',
          'ft_sponsorblock_start',
          'ft_sponsorblock_cancel',
          'ft_sponsorblock_end',
          'ft_screenshot',
          'ft_autoplay_toggle',
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
          props.format === 'legacy' ? 'ft_legacy_quality' : 'quality',
          'chapter',
          'ft_loop',
          'recenter_vr',
          'toggle_stereoscopic',
        )

        elementList = uiConfig.controlPanelElements
      }

      if (!enableScreenshot.value || props.format === 'audio') {
        removeFromArrayIfExists(elementList, 'ft_screenshot')
      }

      if (!props.theatrePossible) {
        removeFromArrayIfExists(uiConfig.controlPanelElements, 'ft_theatre_mode')
      }

      if (!props.autoplayPossible) {
        removeFromArrayIfExists(elementList, 'ft_autoplay_toggle')
      }

      if (props.format === 'audio') {
        removeFromArrayIfExists(elementList, 'picture_in_picture')
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

      if (props.chapters.length === 0) {
        removeFromArrayIfExists(uiConfig.overflowMenuButtons, 'chapter')
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
        ui.configure(uiConfig.value)
      }
    }

    /**
     * @param {WheelEvent} event
     */
    function handleControlsContainerWheel(event) {
      /** @type {DOMTokenList} */
      const classList = event.target.classList

      if (classList.contains('shaka-scrim-container') ||
        classList.contains('shaka-fast-foward-container') ||
        classList.contains('shaka-rewind-container') ||
        classList.contains('shaka-play-button-container') ||
        classList.contains('shaka-play-button') ||
        classList.contains('shaka-controls-container')) {
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

        showValueChange(`${defaultPlaybackRate.value}x`)
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

    function setupChapterPreview() {
      if (!container.value) return

      const seekBarContainer = container.value.querySelector('.shaka-seek-bar-container')
      if (!seekBarContainer) return

      seekBarContainer.removeEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.removeEventListener('mouseleave', handleSeekBarMouseLeave)
      seekBarContainer.addEventListener('mousemove', handleSeekBarMouseMove)
      seekBarContainer.addEventListener('mouseleave', handleSeekBarMouseLeave)
    }

    function addUICustomizations() {
      /** @type {HTMLDivElement} */
      const controlsContainer = ui.getControls().getControlsContainer()

      controlsContainer.removeEventListener('wheel', handleControlsContainerWheel)
      controlsContainer.removeEventListener('click', handleControlsContainerClick, true)

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

      if (useSponsorBlock.value && (sponsorBlockSegments.length > 0 || sponsorBlockCompleteDraftSegments.value.length > 0)) {
        refreshSponsorBlockMarkers()
      }

      updateSponsorBlockSubmissionState()
    }

    watch(uiConfig, (newValue, oldValue) => {
      if (newValue !== oldValue && ui) {
        configureUI()
      }
    })

    watch(sponsorBlockSubmissionVisibleButtons, () => {
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

    watch(() => props.videoId, () => {
      loadSponsorBlockDrafts()
      sponsorBlockSubmissionError.value = ''
      updateSponsorBlockSubmissionState()
    }, { immediate: true })

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

    watch(
      [
        useQuickPlaybackSpeedBar,
        rememberPlaybackSpeedPerChannel,
        autoUpdateChannelPlaybackSpeeds,
        savedChannelPlaybackRate,
        () => props.channelId
      ],
      () => {
        events.dispatchEvent(new CustomEvent('quickPlaybackRateBarStateChanged'))
      }
    )

    /** @type {ResizeObserver|null} */
    let containerResizeObserver = null

    /** @type {ResizeObserverCallback} */
    function resized(entries) {
      onlyUseOverFlowMenu.value = entries[0].contentBoxSize[0].inlineSize <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD
    }

    // #endregion UI config

    // #region player locales

    // shaka-player ships with some locales prebundled and already loaded
    const loadedLocales = new Set(process.env.SHAKA_LOCALES_PREBUNDLED)

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

      const shakaControlKeysToShortcutLocalizations = new Map()
      Object.entries(shakaControlKeysToShortcuts).forEach(([shakaControlKey, shortcut]) => {
        const originalLocalization = localization.resolve(shakaControlKey)
        if (originalLocalization === '') {
          // e.g., A Shaka localization key in shakaControlKeysToShortcuts has fallen out of date and need to be updated
          console.error('Mising Shaka localization key "%s"', shakaControlKey)
          return
        }

        const localizationWithShortcut = addKeyboardShortcutToActionTitle(
          originalLocalization,
          shortcut
        )

        shakaControlKeysToShortcutLocalizations.set(shakaControlKey, localizationWithShortcut)
      })

      localization.insert(shakaLocale, shakaControlKeysToShortcutLocalizations)

      events.dispatchEvent(new CustomEvent('localeChanged'))
    }

    watch(locale, setLocale)

    // #endregion player locales

    // #region power save blocker

    function startPowerSaveBlocker() {
      if (process.env.IS_ELECTRON) {
        window.ftElectron.startPowerSaveBlocker()
      }
    }

    function stopPowerSaveBlocker() {
      if (process.env.IS_ELECTRON) {
        window.ftElectron.stopPowerSaveBlocker()
      }
    }

    // #endregion power save blocker

    // #region video event handlers

    function handlePlay() {
      if (process.env.IS_ELECTRON && !isActiveTab.value) {
        video.value.pause()
        return
      }

      startPowerSaveBlocker()

      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('playing')
      }

      updateAutoPip()
    }

    function handlePause() {
      stopPowerSaveBlocker()

      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('paused')
      }

      updateAutoPip()

      emit('pause')
    }

    function handleEnded() {
      stopPowerSaveBlocker()

      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
      }

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none')
      }

      updateAutoPip()

      emit('ended')
    }

    function handleCanPlay() {
      // PiP can only be activated once the video's readState and video track are populated
      if (startInPip && props.format !== 'audio' && ui.getControls().isPiPAllowed() && process.env.IS_ELECTRON) {
        startInPip = false
        window.ftElectron.requestPiP()
      }

      // Re-evaluate auto-PiP now that PiP is actually allowed (the video was possibly
      // in a hidden tab / scrolled out of view while still loading).
      updateAutoPip()
    }

    function updateVolume() {
      const video_ = video.value

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

        emit('timeupdate', currentTime)

        if (showStats.value && hasLoaded.value) {
          updateStats()
        }

        handleSponsorBlockPreviewSkip(currentTime)

        if (useSponsorBlock.value && sponsorBlockSegments.length > 0 && canSeek()) {
          syncPromptSponsorBlockSegments(currentTime)

          if (!props.sponsorBlockAutoSkipDisabled) {
            skipSponsorBlockSegments(currentTime)
          }
        }
      }
    }

    const videoElementWidth = ref(0)
    const videoElementHeight = ref(0)

    /** @type {ResizeObserver} */
    const videoResizeObserver = new ResizeObserver(() => {
      if (video.value) {
        const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1
        const video_ = video.value

        videoElementWidth.value = video_.clientWidth * devicePixelRatio
        videoElementHeight.value = video_.clientHeight * devicePixelRatio
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
    }

    function handleLeavePictureInPicture() {
      if (pipWindow) {
        pipWindow.removeEventListener('resize', handlePictureInPictureResize)
      }

      pipWindow = null
      pipWindowWidth.value = null
      pipWindowHeight.value = null

      // If the user manually exits PiP (or the browser dismisses the PiP window for any
      // other reason), forget that auto-PiP initiated it so we don't re-enter later.
      autoPipActive = false
    }

    // #region auto picture-in-picture

    /** @type {import('vue').ComputedRef<'never' | 'tab' | 'scroll' | 'both'>} */
    const autoPictureInPictureMode = computed(() => store.getters.getAutoPictureInPictureMode)

    // Whether this auto-mechanism is currently responsible for the active PiP session.
    // Used to avoid auto-exiting PiP sessions that the user initiated themselves.
    let autoPipActive = false
    let tabVisible = !document.hidden
    // Assume visible until the IntersectionObserver reports otherwise.
    let videoMostlyVisible = true

    /** @type {IntersectionObserver | null} */
    let videoIntersectionObserver = null
    /** @type {(() => void) | null} */
    let activeTabChangedCleanup = null

    function shouldAutoPipNow() {
      const mode = autoPictureInPictureMode.value
      if (mode === 'never' || props.format === 'audio') return false

      // Only enter auto PiP while playing. Once auto PiP owns the session,
      // keep it open while paused as long as the tab/scroll trigger still applies.
      const videoElement = video.value
      if (!videoElement || videoElement.ended || (videoElement.paused && !autoPipActive)) return false

      const tabTrigger = (mode === 'tab' || mode === 'both') && !tabVisible
      const scrollTrigger = (mode === 'scroll' || mode === 'both') && !videoMostlyVisible

      return tabTrigger || scrollTrigger
    }

    function triggerPipToggle() {
      // In Electron we go through a privileged channel so the call is treated as a
      // user gesture (otherwise the browser refuses to enter PiP programmatically).
      if (process.env.IS_ELECTRON && window.ftElectron?.requestPiP) {
        window.ftElectron.requestPiP()
        return true
      }

      if (!ui) return false

      try {
        ui.getControls().togglePiP()
        return true
      } catch (err) {
        console.warn('Auto Picture-in-Picture: togglePiP failed', err)
        return false
      }
    }

    function updateAutoPip() {
      if (!ui) return
      const controls = ui.getControls?.()
      if (!controls) return

      const wantPip = shouldAutoPipNow()
      const inPip = controls.isPiPEnabled()

      if (wantPip && !inPip) {
        if (!controls.isPiPAllowed()) return
        // Optimistically mark auto as active before issuing the toggle - if it
        // fails we reset the flag so a later manual request is still respected.
        autoPipActive = true
        if (!triggerPipToggle()) {
          autoPipActive = false
        }
      } else if (!wantPip && inPip && autoPipActive) {
        triggerPipToggle()
        autoPipActive = false
      }
    }

    function handleDocumentVisibilityChange() {
      tabVisible = !document.hidden
      updateAutoPip()
    }

    watch(autoPictureInPictureMode, () => {
      updateAutoPip()
    })

    // #endregion auto picture-in-picture

    function handlePictureInPictureResize() {
      const devicePixelRatio = window.devicePixelRatio > 1 ? window.devicePixelRatio : 1

      pipWindowWidth.value = pipWindow.width * devicePixelRatio
      pipWindowHeight.value = pipWindow.height * devicePixelRatio
    }

    const playerWidth = computed(() => Math.round(pipWindowWidth.value ?? videoElementWidth.value))
    const playerHeight = computed(() => Math.round(pipWindowHeight.value ?? videoElementHeight.value))

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

    const showSabrBackoffOverlay = computed(() => sabrBackoffRemainingMs.value > 0)
    const sabrBackoffTimeLabel = computed(() => `${+(sabrBackoffRemainingMs.value / 1000).toFixed(1)}s`)
    const sabrBackoffAriaLabel = computed(() => {
      return t('Video.Watch.Remaining SABR backoff time: {remindingTimeSeconds}s', { remindingTimeSeconds: +(sabrBackoffRemainingMs.value / 1000).toFixed(1) })
    })
    const SABR_BACKOFF_RING_RADIUS = 38
    const sabrBackoffRingCircumference = 2 * Math.PI * SABR_BACKOFF_RING_RADIUS
    const sabrBackoffRingDashoffset = computed(() => {
      if (sabrBackoffDurationMs.value <= 0) {
        return sabrBackoffRingCircumference
      }

      const progress = 1 - (sabrBackoffRemainingMs.value / sabrBackoffDurationMs.value)
      const clampedProgress = Math.min(1, Math.max(0, progress))
      return sabrBackoffRingCircumference * (1 - clampedProgress)
    })

    function requestTabPreviewRefresh(delayMs = SABR_BACKOFF_PREVIEW_REFRESH_DELAY_MS) {
      if (
        !process.env.IS_ELECTRON ||
        typeof window.ftElectron?.tabs?.requestPreviewRefresh !== 'function'
      ) {
        return
      }

      window.ftElectron.tabs.requestPreviewRefresh({ delayMs })
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

    if (process.env.SUPPORTS_LOCAL_API && props.sabrData) {
      sabrStream = /** @__NOINLINE__ */ setupSabrScheme(props.sabrData, () => player, () => sabrManifest, playerWidth, playerHeight)
      sabrAbortController = new AbortController()
      sabrStream.onBackoffRequested(({ backoffMs }) => {
        startSabrBackoffTimer(backoffMs)
      })
      sabrStream.onReloadOnce(() => {
        sabrAbortController.abort()
        clearSabrBackoffTimer()
        emit('player-reload-requested', { wasPlaying: !video.value?.paused })
      })
    }

    // #endregion SABR

    // #region request/response filters

    /** @type {shaka.extern.RequestFilter} */
    function requestFilter(type, request, _context) {
      if (type === RequestType.SEGMENT) {
        const url = new URL(request.uris[0])

        // only when we aren't proxying through Invidious,
        // it doesn't like the range param and makes get requests to youtube anyway
        if (url.protocol !== 'sabr:' && url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
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

        if (url.protocol === 'sabr:') {
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

    function registerAudioTrackSelection() {
      /** @implements {shaka.extern.IUIElement.Factory} */
      class AudioTrackSelectionFactory {
        create(rootElement, controls) {
          return new AudioTrackSelection(events, rootElement, controls)
        }
      }

      shakaControls.registerElement('ft_audio_tracks', new AudioTrackSelectionFactory())
      shakaOverflowMenu.registerElement('ft_audio_tracks', new AudioTrackSelectionFactory())
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

      shakaControls.registerElement('ft_autoplay_toggle', new AutoplayToggleFactory())
      shakaOverflowMenu.registerElement('ft_autoplay_toggle', new AutoplayToggleFactory())
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

      shakaControls.registerElement('ft_theatre_mode', new TheatreModeButtonFactory())
      shakaOverflowMenu.registerElement('ft_theatre_mode', new TheatreModeButtonFactory())
    }

    function registerFullWindowButton() {
      events.addEventListener('setFullWindow', (/** @type {CustomEvent} */ event) => {
        if (event.detail) {
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        }

        fullWindowEnabled.value = event.detail

        if (fullWindowEnabled.value) {
          document.body.classList.add('playerFullWindow')
        } else {
          document.body.classList.remove('playerFullWindow')
        }
      })

      if (startInFullwindow) {
        events.dispatchEvent(new CustomEvent('setFullWindow', {
          detail: true
        }))
      }

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class FullWindowButtonFactory {
        create(rootElement, controls) {
          return new FullWindowButton(fullWindowEnabled.value, events, rootElement, controls)
        }
      }

      shakaControls.registerElement('ft_full_window', new FullWindowButtonFactory())
      shakaOverflowMenu.registerElement('ft_full_window', new FullWindowButtonFactory())
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
            activeLegacyFormat.value,
            props.legacyFormats,
            events,
            rootElement,
            controls
          )
        }
      }

      shakaControls.registerElement('ft_legacy_quality', new LegacyQualitySelectionFactory())
      shakaOverflowMenu.registerElement('ft_legacy_quality', new LegacyQualitySelectionFactory())
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

      shakaContextMenu.registerElement('ft_stats', new StatsButtonFactory())
    }

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
          ? getInvidiousVideoUrl(store.getters.getCurrentInvidiousInstanceUrl, props.videoId)
          : getYoutubeVideoShareUrl(props.videoId)

        if (!includeTimestamp) {
          return videoUrl
        }

        return appendTimestamp(videoUrl, getCurrentTimestamp())
      }

      /**
       * @param {'youtube' | 'invidious'} backend
       * @returns {string}
       */
      function getCopySuccessMessage(backend) {
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
            () => getVideoUrl(this.backend, this.includeTimestamp),
            () => getCopyLabel(this.backend, this.includeTimestamp),
            () => getCopySuccessMessage(this.backend),
            rootElement,
            controls
          )
        }
      }

      /**
       * @implements {shaka.extern.IUIElement.Factory}
       */
      class LoopButtonFactory {
        create(rootElement, controls) {
          return new LoopButton(rootElement, controls)
        }
      }

      shakaContextMenu.registerElement('ft_copy_youtube_video_url', new CopyVideoUrlButtonFactory('youtube', false))
      shakaContextMenu.registerElement('ft_copy_youtube_video_url_at_current_time', new CopyVideoUrlButtonFactory('youtube', true))
      shakaContextMenu.registerElement('ft_copy_invidious_video_url', new CopyVideoUrlButtonFactory('invidious', false))
      shakaContextMenu.registerElement('ft_copy_invidious_video_url_at_current_time', new CopyVideoUrlButtonFactory('invidious', true))
      shakaContextMenu.registerElement('ft_loop', new LoopButtonFactory())
      shakaOverflowMenu.registerElement('ft_loop', new LoopButtonFactory())
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

      shakaControls.registerElement('ft_screenshot', new ScreenshotButtonFactory())
      shakaOverflowMenu.registerElement('ft_screenshot', new ScreenshotButtonFactory())
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

      shakaControls.registerElement('ft_sponsorblock_start', new SponsorBlockStartButtonFactory())
      shakaControls.registerElement('ft_sponsorblock_end', new SponsorBlockEndButtonFactory())
      shakaControls.registerElement('ft_sponsorblock_open_menu', new SponsorBlockOpenMenuButtonFactory())
      shakaControls.registerElement('ft_sponsorblock_cancel', new SponsorBlockCancelButtonFactory())
      shakaControls.registerElement('ft_sponsorblock_clear', new SponsorBlockClearButtonFactory())

      updateSponsorBlockSubmissionState()
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

      shakaControls.registerElement('ft_skip_next', new SkipNextButtonFactory())
      shakaOverflowMenu.registerElement('ft_skip_next', new SkipNextButtonFactory())

      // skip to previous video button
      events.addEventListener('previousVideo', () => {
        emit('skip-to-prev')
      })

      class SkipPreviousButtonFactory {
        create(rootElement, controls) {
          return new SkipButton(events, rootElement, controls, 'previous')
        }
      }

      shakaControls.registerElement('ft_skip_previous', new SkipPreviousButtonFactory())
      shakaOverflowMenu.registerElement('ft_skip_previous', new SkipPreviousButtonFactory())
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

      shakaControls.registerElement('ft_playback_adjusted_time', new PlaybackAdjustedTimeFactory())
    }

    function registerQuickPlaybackRateBar() {
      events.addEventListener('quickPlaybackRateUserSet', (/** @type {CustomEvent} */ event) => {
        emit('playback-rate-user-set', event.detail)
      })

      events.addEventListener('saveChannelPlaybackSpeed', () => {
        emit('save-channel-playback-speed')
      })

      /** @implements {shaka.extern.IUIElement.Factory} */
      class QuickPlaybackRateBarFactory {
        create(rootElement, controls) {
          return new QuickPlaybackRateBar(
            () => savedChannelPlaybackRate.value,
            () => canManuallySaveChannelPlaybackRate.value,
            events,
            rootElement,
            controls
          )
        }
      }

      shakaControls.registerElement('ft_quick_playback_rate_bar', new QuickPlaybackRateBarFactory())
    }

    /**
     * As shaka-player doesn't let you unregister custom control factories,
     * overwrite them with `null` instead so the referenced objects
     * (e.g. {@linkcode events}, {@linkcode fullWindowEnabled}) can get garbage collected
     */
    function cleanUpCustomPlayerControls() {
      shakaControls.registerElement('ft_audio_tracks', null)
      shakaOverflowMenu.registerElement('ft_audio_tracks', null)

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
      shakaOverflowMenu.registerElement('ft_loop', null)

      shakaControls.registerElement('ft_screenshot', null)
      shakaOverflowMenu.registerElement('ft_screenshot', null)

      shakaControls.registerElement('ft_sponsorblock_start', null)
      shakaControls.registerElement('ft_sponsorblock_end', null)
      shakaControls.registerElement('ft_sponsorblock_open_menu', null)
      shakaControls.registerElement('ft_sponsorblock_cancel', null)
      shakaControls.registerElement('ft_sponsorblock_clear', null)

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

    const NORMAL_PLAYBACK_RATE = 1

    /** @type {number | null} */
    let togglePlaybackRate = null

    /** @type {number | null} */
    let pendingPlaybackRateRestore = null

    /**
     * @param {unknown} rate
     * @returns {number | null}
     */
    function normalizePlaybackRate(rate) {
      const parsedRate = typeof rate === 'number' ? rate : Number(rate)
      return Number.isFinite(parsedRate) && parsedRate > 0.07 ? parsedRate : null
    }

    /**
     * @returns {number | null}
     */
    function getCurrentPlaybackRate() {
      const playerRate = normalizePlaybackRate(player?.getPlaybackRate())
      if (playerRate !== null) {
        return playerRate
      }

      const videoRate = normalizePlaybackRate(video.value?.playbackRate)
      if (videoRate !== null) {
        return videoRate
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
      const playbackRate = pendingPlaybackRateRestore ?? normalizePlaybackRate(props.currentPlaybackRate)
      pendingPlaybackRateRestore = null

      if (playbackRate === null || !video.value || !player) {
        return
      }

      video.value.defaultPlaybackRate = defaultPlaybackRate.value

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
     * @param {number} rate
     */
    function applyPlaybackRate(rate) {
      const newPlaybackRateString = rate.toFixed(2)
      const newPlaybackRate = parseFloat(newPlaybackRateString)

      // The following error is thrown if you go below 0.07:
      // The provided playback rate (0.05) is not in the supported playback range.
      if (newPlaybackRate > 0.07 && newPlaybackRate <= maxVideoPlaybackRate.value) {
        if (Math.abs(newPlaybackRate - defaultPlaybackRate.value) < 0.01) {
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
      applyPlaybackRate(player.getPlaybackRate() + step)
    }

    /**
     * @param {number} rate
     */
    function isNormalPlaybackRate(rate) {
      return Math.abs(rate - NORMAL_PLAYBACK_RATE) < 0.01
    }

    function toggleNormalPlaybackRate() {
      const currentRate = player.getPlaybackRate()

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
      const seekMultiplier = seekIntervalMultiplyByPlaybackRate.value ? player.getPlaybackRate() : 1
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
     * determines whether the jump to the previous or next chapter
     * with the the keyboard shortcuts, should be done
     * first it checks whether there are any chapters (the array is also empty if chapters are hidden)
     * it also checks that the approprate combination was used ALT/OPTION on macOS and CTRL everywhere else
     * @param {KeyboardEvent} event the keyboard event
     * @param {string} direction the direction of the jump either previous or next
     */
    function canChapterJump(event, direction) {
      const currentChapter = props.currentChapterIndex
      return props.chapters.length > 0 &&
        (direction === 'previous' ? currentChapter > 0 : props.chapters.length - 1 !== currentChapter) &&
        ((process.platform !== 'darwin' && event.ctrlKey) ||
          (process.platform === 'darwin' && event.metaKey))
    }

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

      return target.classList.contains('ft-input') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
    }

    /**
     * @param {KeyboardEvent} event
     */
    function keyboardShortcutHandler(event) {
      if (!player) {
        return
      }

      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement) || event.altKey) {
        return
      }

      // exit fullscreen and/or fullwindow if keyboard shortcut modal is opened
      if (event.shiftKey && event.key === '?') {
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

      // allow chapter jump keyboard shortcuts
      if (event.ctrlKey && (process.platform === 'darwin' || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'))) {
        return
      }

      // allow copying text
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        return
      }

      // allow focusing on search bar without affecting the playback
      if ((process.platform === 'darwin' && event.metaKey) && event.key.toLowerCase() === 'l') {
        return
      }

      const video_ = video.value

      // Skip to next video in playlist or recommended
      if (event.shiftKey && event.key.toLowerCase() === 'n') {
        emit('skip-to-next')
        return
      }

      // Skip to previous video in playlist
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        emit('skip-to-prev')
        return
      }

      switch (event.key.toLowerCase()) {
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN:
          // Toggle full screen
          event.preventDefault()
          ui.getControls().toggleFullScreen()
          blurTooltipButtons()
          break
        case 'escape':
          // Exit full window
          if (fullWindowEnabled.value) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('setFullWindow', {
              detail: false
            }))
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLWINDOW:
          // Toggle full window mode
          event.preventDefault()
          events.dispatchEvent(new CustomEvent('setFullWindow', {
            detail: !fullWindowEnabled.value
          }))
          blurTooltipButtons()
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.THEATRE_MODE:
          // Toggle theatre mode
          if (props.theatrePossible) {
            event.preventDefault()

            events.dispatchEvent(new CustomEvent('toggleTheatreMode', {
              detail: !props.useTheatreMode
            }))
          }
          blurTooltipButtons()
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE:
          // Toggle mute only if metakey is not pressed
          if (!event.metaKey) {
            event.preventDefault()
            const isMuted = !video_.muted
            video_.muted = isMuted

            const messageIcon = isMuted ? 'volume-mute' : 'volume-high'
            const message = isMuted ? '0%' : `${Math.round(video_.volume * 100)}%`
            showValueChange(message, messageIcon)
          }
          blurTooltipButtons()
          break
      }

      if (!hasLoaded.value) {
        return
      }

      if (event.key === 'Enter' && toggleActiveSponsorBlockSkipState()) {
        event.preventDefault()
        return
      }

      switch (event.key.toLowerCase()) {
        case ' ':
        case 'spacebar': // older browsers might return spacebar instead of a space character
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY:
          // Toggle Play/Pause
          event.preventDefault()
          video_.paused ? video_.play() : video_.pause()
          blurTooltipButtons()
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LARGE_REWIND: {
          // Rewind by 2x the time-skip interval (in seconds)
          event.preventDefault()
          const largeRewindMultiplier = seekIntervalMultiplyByPlaybackRate.value ? player.getPlaybackRate() : 1
          seekBySeconds(-defaultSkipInterval.value * largeRewindMultiplier * 2, false, true)
          break
        }
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LARGE_FAST_FORWARD: {
          // Fast-Forward by 2x the time-skip interval (in seconds)
          event.preventDefault()
          const largeFastForwardMultiplier = seekIntervalMultiplyByPlaybackRate.value ? player.getPlaybackRate() : 1
          seekBySeconds(defaultSkipInterval.value * largeFastForwardMultiplier * 2, false, true)
          break
        }
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED:
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.DECREASE_VIDEO_SPEED_ALT:
          // Decrease playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(-videoPlaybackRateInterval.value)
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED:
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.INCREASE_VIDEO_SPEED_ALT:
          // Increase playback rate by user configured interval
          event.preventDefault()
          changePlayBackRate(videoPlaybackRateInterval.value)
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_NORMAL_PLAYBACK_SPEED:
          // Toggle between 1x and the previous playback speed
          event.preventDefault()
          toggleNormalPlaybackRate()
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS: {
          // Toggle caption/subtitles

          const textTracks = player.getTextTracks()
          if (textTracks.length > 0) {
            event.preventDefault()

            if (textTracks.some(track => track.active)) {
              player.selectTextTrack(null)
            } else {
              player.selectTextTrack(textTracks[0])
            }

            showOverlayControls()
          }
          break
        }
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VOLUME_UP:
          // Increase volume
          event.preventDefault()
          changeVolume(0.05)
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.VOLUME_DOWN:
          // Decrease Volume
          event.preventDefault()
          changeVolume(-0.05)
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SMALL_REWIND:
          if (event.shiftKey) {
            break
          }
          event.preventDefault()
          if (canChapterJump(event, 'previous')) {
            // Jump to the previous chapter
            video_.currentTime = props.chapters[props.currentChapterIndex - 1].startSeconds
            showOverlayControls()
          } else {
            // Rewind by the time-skip interval (in seconds)
            const smallRewindMultiplier = seekIntervalMultiplyByPlaybackRate.value ? player.getPlaybackRate() : 1
            seekBySeconds(-defaultSkipInterval.value * smallRewindMultiplier, false, true)
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.SMALL_FAST_FORWARD:
          if (event.shiftKey) {
            break
          }
          event.preventDefault()
          if (canChapterJump(event, 'next')) {
            // Jump to the next chapter
            video_.currentTime = (props.chapters[props.currentChapterIndex + 1].startSeconds)
            showOverlayControls()
          } else {
            // Fast-Forward by the time-skip interval (in seconds)
            const smallFastForwardMultiplier = seekIntervalMultiplyByPlaybackRate.value ? player.getPlaybackRate() : 1
            seekBySeconds(defaultSkipInterval.value * smallFastForwardMultiplier, false, true)
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE:
          // Toggle picture in picture
          if (props.format !== 'audio') {
            const controls = ui.getControls()
            if (controls.isPiPAllowed()) {
              controls.togglePiP()
            }
          }
          blurTooltipButtons()
          break
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
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
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.LAST_FRAME:
          // `⌘+,` is for settings in MacOS
          if (!event.metaKey && video_.paused) {
            event.preventDefault()
            // Return to previous frame
            frameByFrame(-1)
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.NEXT_FRAME:
          if (video_.paused) {
            event.preventDefault()
            // Advance to next frame
            frameByFrame(1)
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.STATS:
          // Toggle stats display
          event.preventDefault()

          events.dispatchEvent(new CustomEvent('setStatsVisibility', {
            detail: !showStats.value
          }))
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.HOME:
          // Jump to beginning of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            video_.currentTime = seekRange.start
            showOverlayControls()
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.END:
          // Jump to end of video
          if (canSeek()) {
            event.preventDefault()
            // use seek range instead of duration so that it works for live streams too
            const seekRange = player.seekRange()
            video_.currentTime = seekRange.end
            showOverlayControls()
          }
          break
        case KeyboardShortcuts.VIDEO_PLAYER.GENERAL.TAKE_SCREENSHOT:
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

        stopPowerSaveBlocker()

        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'none'
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
        return createSponsorBlockMarker(
          duration,
          segment.startTime,
          segment.endTime,
          translateSponsorBlockCategory(segment.category),
          'sponsorBlockMarker sponsorBlockDraftMarker'
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
      const playbackRatesContainer = target.closest('.shaka-playback-rates')

      if (playbackRatesContainer) {
        const button = target.closest('button')

        if (button && !button.classList.contains('shaka-back-to-overflow-button')) {
          setTimeout(() => {
            emit('playback-rate-user-set', player.getPlaybackRate())
          }, 10)
        }
      }
    }

    /**
     * @param {MouseEvent} event
     */
    function handleQualityMenuClick(event) {
      const target = event.target
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
    const initLoadWaitTimeToastAC = new AbortController()

    onMounted(async () => {
      const videoElement = video.value

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.isActive) {
        try {
          const isActive = await window.ftElectron.tabs.isActive()
          isActiveTab.value = isActive
          tabVisible = isActive
        } catch (error) {
          console.error('Failed to get active tab state for video autoplay:', error)
        }
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

      queuePlaybackRateRestore(props.currentPlaybackRate)
      videoElement.playbackRate = props.currentPlaybackRate
      videoElement.defaultPlaybackRate = defaultPlaybackRate.value

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui) {
        return
      }

      const controls = ui.getControls()
      player = controls.getPlayer()

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

      // check if the component is already getting destroyed
      // which is possible because this function runs asynchronously
      if (!ui || !player) {
        return
      }

      videoResizeObserver.observe(videoElement)

      registerScreenshotButton()
      registerAudioTrackSelection()
      registerAutoplayToggle()

      registerTheatreModeButton()
      registerFullWindowButton()
      registerLegacyQualitySelection()
      registerContextMenuButtons()
      registerStatsButton()
      registerSponsorBlockSubmissionButtons()
      registerSkipButtons()
      registerPlaybackAdjustedTime()
      registerQuickPlaybackRateBar()

      if (ui.isMobile()) {
        onlyUseOverFlowMenu.value = true
      } else {
        onlyUseOverFlowMenu.value = container.value.getBoundingClientRect().width <= USE_OVERFLOW_MENU_WIDTH_THRESHOLD

        containerResizeObserver = new ResizeObserver(resized)
        containerResizeObserver.observe(container.value)
      }

      controls.addEventListener('uiupdated', addUICustomizations)
      configureUI(true)

      applyInitialVolume(videoElement)

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('keydown', keyboardShortcutHandler)
      document.addEventListener('fullscreenchange', fullscreenChangeHandler)
      // Use event delegation on document with capture phase to catch events before shaka-no-propagation stops them from bubbling
      document.addEventListener('click', handlePlaybackRateMenuClick, true)
      document.addEventListener('click', handleQualityMenuClick, true)

      // Set up IPC listener for exit fullscreen when tab becomes inactive (Electron only)
      // Only set up after UI is fully initialized
      if (process.env.IS_ELECTRON && ui && window.ftElectron?.tabs?.onExitFullscreen) {
        try {
          exitFullscreenCleanup = window.ftElectron.tabs.onExitFullscreen(exitFullscreenHandler)
        } catch (error) {
          console.error('Failed to set up exit fullscreen listener:', error)
        }
      }

      // Set up auto picture-in-picture listeners. The actual entering/exiting of PiP
      // happens once the video reaches `canplay` (see handleCanPlay).
      document.addEventListener('visibilitychange', handleDocumentVisibilityChange)

      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.onActiveChanged) {
        try {
          activeTabChangedCleanup = window.ftElectron.tabs.onActiveChanged((isActive) => {
            isActiveTab.value = isActive
            tabVisible = isActive
            updateAutoPip()
          })
        } catch (error) {
          console.error('Failed to set up active tab listener for auto PiP:', error)
        }
      }

      if (container.value && props.format !== 'audio' && typeof IntersectionObserver !== 'undefined') {
        videoIntersectionObserver = new IntersectionObserver((entries) => {
          const entry = entries[entries.length - 1]
          videoMostlyVisible = entry.intersectionRatio >= 0.25
          updateAutoPip()
        }, { threshold: [0, 0.25, 1] })
        videoIntersectionObserver.observe(container.value)
      }

      player.addEventListener('loading', () => {
        hasLoaded.value = false
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

      if (useSponsorBlock.value && sponsorSkips.value.seekBar.length > 0) {
        setupSponsorBlock()
      }

      window.addEventListener('beforeunload', stopPowerSaveBlocker)

      // shaka-player doesn't start with the cursor hidden, so hide it here for instances in which the
      // cursor is in the video player area when the video first loads
      container.value.classList.add('no-cursor')

      await performFirstLoad()
      // Whatever runs after `performFirstLoad` might be after switching to another page due to SABR backoff

      player?.addEventListener('ratechange', () => {
        emit('playback-rate-updated', player.getPlaybackRate())
      })
    })
    onUnmounted(() => {
      initLoadWaitTimeToastAC.abort()
      clearSabrBackoffTimer()
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
        showToast(
          ({ remainingMs }) => {
            // `+value` converts string back to float
            return t('Video.Watch.Remaining preroll-ad time: {remindingTimeSeconds}s', { remindingTimeSeconds: +(remainingMs / 1000).toFixed(1) })
          },
          // So that we don't see last countdown text like 0/N
          initialLoadDelayMs,
          null,
          initLoadWaitTimeToastAC.signal,
        )
        await new Promise((resolve) => setTimeout(resolve, initialLoadDelayMs))
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
      restorePendingPlaybackRate()
      emit('loaded')

      // ideally we would set this in the `streaming` event handler, but for HLS this is only set to true after the loaded event fires.
      isLive.value = player.isLive()
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

      if (startInFullscreen && process.env.IS_ELECTRON) {
        startInFullscreen = false
        window.ftElectron.requestFullscreen()
      }

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
      hasLoaded.value = false
      document.body.classList.remove('playerFullWindow')

      document.removeEventListener('keydown', keyboardShortcutHandler)
      document.removeEventListener('fullscreenchange', fullscreenChangeHandler)
      document.removeEventListener('click', handlePlaybackRateMenuClick, true)
      document.removeEventListener('click', handleQualityMenuClick, true)

      // Clean up IPC listener for exit fullscreen
      if (exitFullscreenCleanup) {
        exitFullscreenCleanup()
        exitFullscreenCleanup = null
      }

      // Clean up auto picture-in-picture listeners
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)
      if (activeTabChangedCleanup) {
        activeTabChangedCleanup()
        activeTabChangedCleanup = null
      }
      if (videoIntersectionObserver) {
        videoIntersectionObserver.disconnect()
        videoIntersectionObserver = null
      }

      if (containerResizeObserver) {
        containerResizeObserver.disconnect()
        containerResizeObserver = null
      }

      if (videoResizeObserver) {
        videoResizeObserver.disconnect()
      }

      cleanUpCustomPlayerControls()

      stopPowerSaveBlocker()
      window.removeEventListener('beforeunload', stopPowerSaveBlocker)

      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
      }

      // Clear tab playback state indicator when player is destroyed
      if (process.env.IS_ELECTRON && window.ftElectron?.tabs?.setPlaybackState) {
        window.ftElectron.tabs.setPlaybackState('none')
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

    function getCurrentTime() {
      return video.value.currentTime
    }

    /**
     * @param {number} time
     */
    function setCurrentTime(time) {
      video.value.currentTime = time
    }

    /**
     * Vue's lifecycle hooks are synchonous, so if we destroy the player in {@linkcode onBeforeUnmount},
     * it won't be finished in time, as the player destruction is asynchronous.
     * To workaround that we destroy the player first and wait for it to finish before we unmount this component.
     *
     * @returns {Promise<{ startNextVideoInFullscreen: boolean, startNextVideoInFullwindow: boolean, startNextVideoInPip: boolean }>}
     */
    async function destroyPlayer() {
      ignoreErrors = true

      let uiState = { startNextVideoInFullscreen: false, startNextVideoInFullwindow: false, startNextVideoInPip: false }

      if (ui) {
        if (ui.getControls()) {
          // save the state of player settings to reinitialize them upon next creation
          const controls = ui.getControls()
          uiState = {
            startNextVideoInFullscreen: controls.isFullScreenEnabled(),
            startNextVideoInFullwindow: fullWindowEnabled.value,
            startNextVideoInPip: controls.isPiPEnabled()
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
      pause,
      getCurrentTime,
      setCurrentTime,
      destroyPlayer
    })

    // #endregion functions used by the watch page

    const showValueChangePopup = ref(false)
    const valueChangeMessage = ref('')
    const valueChangeIcon = ref(null)
    const invertValueChangeContentOrder = ref(false)
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
      container,
      video,
      vrCanvas,

      fullWindowEnabled,
      forceAspectRatio,

      showStats,
      stats,
      playerDimensions,

      autoplayVideos,
      sponsorBlockShowSkippedToast,
      sponsorBlockDraftEditValues,
      sponsorBlockDraftSegments,
      sponsorBlockSubmissionCategories: SPONSORBLOCK_SUBMISSION_CATEGORIES,
      sponsorBlockSubmissionError,
      sponsorBlockSubmissionMenuOpen,
      sponsorBlockSubmissionPending,
      isSponsorBlockDraftEditing,

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
      showSabrBackoffOverlay,
      sabrBackoffTimeLabel,
      sabrBackoffAriaLabel,
      sabrBackoffRingCircumference,
      sabrBackoffRingDashoffset,

      handlePlay,
      handlePause,
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
    }
  }
})
