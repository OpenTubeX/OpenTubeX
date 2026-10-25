import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'

import store from '../../../store/index'
import { resolveColorValue } from '../../../helpers/colors'
import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import { getSponsorBlockCategoryVoteOptions } from '../../../helpers/player/sponsorBlockCategories'
import { createSponsorBlockMuteController } from '../../../helpers/player/sponsorBlockMute'
import { findSponsorBlockSeekBarSegment } from '../../../helpers/player/sponsorBlockSeekBar'
import { resolveSponsorBlockEnterTarget, resolveSponsorBlockEnterTargets } from '../../../helpers/player/sponsorBlockShortcut'
import { getSponsorBlockSegments, translateSponsorBlockCategory } from '../../../helpers/player/utils'
import { getSponsorBlockContributionStats, voteOnSponsorBlockSegment } from '../../../helpers/sponsorblock'
import { addKeyboardShortcutToActionTitle, formatDurationAsTimestamp, showToast } from '../../../helpers/utils'
import { useSponsorBlockSubmission } from './useSponsorBlockSubmission'

/** @typedef {import('../../../helpers/sponsorblock').SponsorBlockCategory} SponsorBlockCategory */

const SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS = 5000
export const SPONSORBLOCK_SEGMENT_START_TOLERANCE_SECONDS = 0.1
const SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS = 500
const SPONSORBLOCK_SKIP_POLL_INTERVAL_MS = 4
const SPONSORBLOCK_TERMINAL_OUTRO_TOLERANCE_SECONDS = 1
const SPONSORBLOCK_NOT_FOUND_REFETCH_RECENT_VIDEO_AGE_MS = 24 * 60 * 60 * 1000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MIN_DELAY_MS = 10000
const SPONSORBLOCK_NOT_FOUND_REFETCH_MAX_DELAY_MS = 40000
export const SPONSORBLOCK_CATEGORIES = Object.freeze([
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
export const SPONSORBLOCK_INFO_CATEGORIES = Object.freeze([...SPONSORBLOCK_CATEGORIES, 'exclusive_access'])
export const SPONSORBLOCK_INFO_ACTION_TYPES = Object.freeze(['skip', 'mute', 'full', 'poi'])
export const SPONSORBLOCK_PLAYBACK_ACTION_TYPES = Object.freeze(['skip', 'mute', 'poi'])

/**
 * OpenTubeX's SponsorBlock playback: auto-skip scheduling, muted segments, skip and prompt toasts,
 * the highlight button, the segment info menu with voting, and the not-found refetch.
 * The player keeps the segments and the upstream fetch and skip functions; this reads and replaces them.
 *
 * @param {{
 *   canSeek: () => boolean,
 *   cancelFullscreenSponsorBlockRestore: () => void,
 *   container: import('vue').Ref<HTMLElement | null>,
 *   emit: (event: string, ...args: unknown[]) => void,
 *   events: EventTarget,
 *   getPlayer: () => import('shaka-player').Player | null,
 *   getRequestGeneration: () => number,
 *   getSegments: () => Array<{ uuid: string, category: SponsorBlockCategory, actionType?: 'skip' | 'mute' | 'full' | 'poi', startTime: number, endTime: number }>,
 *   getUi: () => import('shaka-player').ui.Overlay | null,
 *   hardwareKeyboardAttached: import('vue').Ref<boolean>,
 *   isLive: import('vue').Ref<boolean>,
 *   locale: import('vue').Ref<string>,
 *   props: { videoId: string, published: number, offline: boolean, sponsorBlockAutoSkipDisabled: boolean, sponsorBlockInfoOpen: boolean },
 *   refreshSponsorBlockMarkers: () => void,
 *   resetAccumulatedSeek: () => void,
 *   setAverageVideoDuration: (duration: number) => void,
 *   setCurrentTime: (time: number, recordSeekHistory?: boolean) => void,
 *   setSegments: (segments: Array<object>) => void,
 *   setupSponsorBlock: () => Promise<void>,
 *   showOverlayControls: () => void,
 *   skipSponsorBlockSegments: (currentTime: number) => void,
 *   skippedSponsorBlockSegments: import('vue').Ref<Array<object>>,
 *   sponsorBlockShowSkippedToast: import('vue').ComputedRef<boolean>,
 *   sponsorSkips: import('vue').ComputedRef<{ autoSkip: Set<SponsorBlockCategory>, seekBar: SponsorBlockCategory[], promptSkip: Set<SponsorBlockCategory>, categoryData: object }>,
 *   t: (key: string, values?: object) => string,
 *   useSponsorBlock: import('vue').ComputedRef<boolean>,
 *   video: import('vue').Ref<HTMLVideoElement | null>
 * }} options
 */
export function useSponsorBlockPlayback({
  canSeek,
  cancelFullscreenSponsorBlockRestore,
  container,
  emit,
  events,
  getPlayer,
  getRequestGeneration,
  getSegments,
  getUi,
  hardwareKeyboardAttached,
  isLive,
  locale,
  props,
  refreshSponsorBlockMarkers,
  resetAccumulatedSeek,
  setAverageVideoDuration,
  setCurrentTime,
  setSegments,
  setupSponsorBlock,
  showOverlayControls,
  skipSponsorBlockSegments,
  skippedSponsorBlockSegments,
  sponsorBlockShowSkippedToast,
  sponsorSkips,
  t,
  useSponsorBlock,
  video,
}) {
  const sponsorBlockEnableSubmission = computed(() => {
    return !props.offline && store.getters.getSponsorBlockEnableSubmission
  })

  /** @type {import('vue').ComputedRef<number>} */
  const sponsorBlockSkippedToastDuration = computed(() => {
    return store.getters.getSponsorBlockSkippedToastDuration
  })

  const sponsorBlockSkippedToastDurationMs = computed(() => {
    return Math.max(2, Math.min(15, sponsorBlockSkippedToastDuration.value)) * 1000
  })

  const sponsorBlockInfoSegments = ref([])
  const sponsorBlockInfoOpen = ref(props.sponsorBlockInfoOpen)
  const sponsorBlockInfoLoading = ref(false)
  const sponsorBlockContributionStats = ref(null)
  const sponsorBlockContributionStatsError = ref(false)
  const sponsorBlockContributionStatsLoaded = ref(false)
  const sponsorBlockContributionStatsLoading = ref(false)
  const sponsorBlockVotePending = ref(null)
  const sponsorBlockUserVotes = reactive({})
  let terminalSponsorBlockOutroStarted = false
  const hasSponsorBlockMusicOfftopicSegment = ref(false)
  const activeSponsorBlockHighlightSegment = ref(null)
  let sponsorBlockHighlightLabelVisible = true
  let sponsorBlockHighlightLabelRemainingMs = SPONSORBLOCK_HIGHLIGHT_LABEL_PLAYBACK_MS
  let sponsorBlockHighlightLabelStartedAt = null
  let sponsorBlockHighlightLabelTimeout = null
  const sponsorBlockToastEditingUuid = ref(null)
  const sponsorBlockToastEditingSegment = computed(() => {
    return sponsorBlockInfoSegments.value.find(segment => segment.uuid === sponsorBlockToastEditingUuid.value)
  })
  const promptSponsorBlockSegments = ref([])
  const sponsorBlockToastNow = ref(Date.now())
  const sponsorBlockCurrentTime = ref(0)
  let sponsorBlockToastTimeInterval = null
  const manuallyMutedSponsorBlockSegments = new Set()
  const sponsorBlockDoNotMuteSegments = new Set()
  const notifiedSponsorBlockMuteSegments = new Set()
  const sponsorBlockMuteController = createSponsorBlockMuteController({
    getMuted: () => video.value?.muted ?? false,
    setMuted: muted => {
      if (video.value) {
        video.value.muted = muted
      }
    }
  })

  const sponsorBlockSubmission = useSponsorBlockSubmission({
    canSeek,
    setCurrentTime,
    events,
    getPlayer,
    isLive,
    onSubmittedSegments: (submittedSegments) => {
      const playbackSegments = submittedSegments.filter(segment => {
        return SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType)
      })
      setSegments(getSegments().concat(playbackSegments).sort((a, b) => a.startTime - b.startTime))
      sponsorBlockInfoSegments.value = sponsorBlockInfoSegments.value
        .concat(submittedSegments.map(segment => ({ ...segment, locked: 0, votes: 0 })))
        .sort((a, b) => a.startTime - b.startTime)
      scheduleSponsorBlockSkip()
      emitSponsorBlockInfoState()
      refreshSponsorBlockMarkers()
      if (sponsorBlockInfoOpen.value) {
        refreshSponsorBlockContributionStats()
      } else {
        sponsorBlockContributionStatsLoaded.value = false
      }
    },
    props,
    showOverlayControls,
    sponsorBlockCurrentTime,
    setSponsorBlockPreviewMuted: muted => sponsorBlockMuteController.setSourceActive('preview', muted),
    t,
    useSponsorBlock,
    video,
  })
  const {
    copySponsorBlockSegmentToDraft,
    getSponsorBlockSubmissionVideoDuration,
    isSponsorBlockFullVideoSegment,
    isSponsorBlockPointSegment,
    sponsorBlockCompleteDraftSegments,
  } = sponsorBlockSubmission

  /**
   * Segment UUIDs that the user has explicitly unskipped, mapped to the time range the user has to leave
   * before they are auto-skipped again (the whole range of segments that were skipped together).
   * @type {Map<string, { startTime: number, endTime: number }>}
   */
  const sponsorBlockDoNotSkipSegments = new Map()
  /**
   * Set of segment UUIDs whose prompt has been dismissed until playback leaves the segment.
   * @type {Set<string>}
   */
  const sponsorBlockDismissedPromptSegments = new Set()
  let sponsorBlockNotFoundRefetchTimeout = null
  let sponsorBlockSkipScheduleTimeout = null
  let sponsorBlockSkipScheduleInterval = null
  let sponsorBlockSkipScheduleTaskController = null
  // Identifies the boundary the pending schedule waits for, so timeupdates
  // only reschedule after a seek, rate change or a different next segment.
  let sponsorBlockSkipScheduleKey = null

  function cancelSponsorBlockSkipSchedule() {
    clearTimeout(sponsorBlockSkipScheduleTimeout)
    clearInterval(sponsorBlockSkipScheduleInterval)
    sponsorBlockSkipScheduleTaskController?.abort()
    sponsorBlockSkipScheduleTimeout = null
    sponsorBlockSkipScheduleInterval = null
    sponsorBlockSkipScheduleTaskController = null
    sponsorBlockSkipScheduleKey = null
  }

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

      if (!getUi() || !getPlayer() || props.videoId !== videoId || sponsorBlockInfoSegments.value.length > 0) {
        return
      }

      refetchSponsorBlockSegmentsWhenNotFound()
    }, refetchDelayMs)
  }

  async function refetchSponsorBlockSegmentsWhenNotFound() {
    const videoId = props.videoId
    const generation = getRequestGeneration()
    let segments, averageDuration

    try {
      ({ segments, averageDuration } = await getSponsorBlockSegments(
        videoId,
        SPONSORBLOCK_INFO_CATEGORIES,
        SPONSORBLOCK_INFO_ACTION_TYPES
      ))
    } catch (e) {
      console.error(e)
      return
    }

    if (!getUi() || !getPlayer() || generation !== getRequestGeneration() || videoId !== props.videoId) {
      return
    }

    if (segments.length > 0) {
      sponsorBlockInfoSegments.value = segments
      setSegments(segments.filter(segment => {
        return SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType) && sponsorSkips.value.seekBar.includes(segment.category)
      }))
      setAverageVideoDuration(averageDuration)
      hasSponsorBlockMusicOfftopicSegment.value = segments.some(segment => segment.category === 'music_offtopic')
      refreshSponsorBlockMarkers()
      syncSponsorBlockPlaybackState()
    } else {
      scheduleSponsorBlockNotFoundRefetch()
    }
    emitSponsorBlockInfoState()
  }

  /**
   * Clears the playback state of the previous segments before segments are fetched again.
   * The caller clears the segments themselves first.
   */
  function resetSponsorBlockPlaybackState() {
    clearSponsorBlockNotFoundRefetchTimeout()
    cancelSponsorBlockSkipSchedule()
    // Reset the do-not-skip set for the new video
    sponsorBlockDoNotSkipSegments.clear()
    sponsorBlockDismissedPromptSegments.clear()
    clearSponsorBlockMuteSegments()
    sponsorBlockInfoSegments.value = []
    terminalSponsorBlockOutroStarted = false
    hasSponsorBlockMusicOfftopicSegment.value = false
    activeSponsorBlockHighlightSegment.value = null
    updateSponsorBlockHighlightState(0)
  }

  function syncSponsorBlockPlaybackState() {
    if (useSponsorBlock.value && canSeek()) {
      const currentTime = video.value?.currentTime ?? 0
      syncPromptSponsorBlockSegments(currentTime)
      updateSponsorBlockHighlightState(currentTime)
      syncSponsorBlockMuteSegments(currentTime, !props.sponsorBlockAutoSkipDisabled)
      scheduleSponsorBlockSkip()
    }
  }

  async function refreshSponsorBlockInfo() {
    if (props.offline || sponsorBlockVotePending.value !== null) return
    const refreshTasks = [setupSponsorBlock()]
    if (sponsorBlockEnableSubmission.value) {
      refreshTasks.push(refreshSponsorBlockContributionStats())
    }
    await Promise.all(refreshTasks)
  }

  async function refreshSponsorBlockContributionStats() {
    if (!sponsorBlockEnableSubmission.value || sponsorBlockContributionStatsLoading.value) {
      return
    }

    sponsorBlockContributionStatsLoading.value = true
    sponsorBlockContributionStatsError.value = false
    emitSponsorBlockInfoState()

    try {
      sponsorBlockContributionStats.value = await getSponsorBlockContributionStats()
    } catch {
      sponsorBlockContributionStatsError.value = true
    } finally {
      sponsorBlockContributionStatsLoaded.value = true
      sponsorBlockContributionStatsLoading.value = false
      emitSponsorBlockInfoState()
    }
  }

  function emitSponsorBlockInfoState() {
    const detail = {
      open: sponsorBlockInfoOpen.value,
      loading: sponsorBlockInfoLoading.value,
      contributionStats: sponsorBlockContributionStats.value,
      contributionStatsError: sponsorBlockContributionStatsError.value,
      contributionStatsLoaded: sponsorBlockContributionStatsLoaded.value,
      contributionStatsLoading: sponsorBlockContributionStatsLoading.value,
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
    if (
      sponsorBlockInfoOpen.value &&
      sponsorBlockEnableSubmission.value &&
      !sponsorBlockContributionStatsLoaded.value &&
      !sponsorBlockContributionStatsLoading.value
    ) {
      refreshSponsorBlockContributionStats()
    }
    if (!sponsorBlockInfoOpen.value) {
      cancelFullscreenSponsorBlockRestore()
    }
    getUi()?.getControls().hideSettingsMenus()
    showOverlayControls()
    emitSponsorBlockInfoState()
  }

  function closeSponsorBlockInfo() {
    sponsorBlockInfoOpen.value = false
    cancelFullscreenSponsorBlockRestore()
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

  async function voteOnSponsorBlockInfoSegment(uuid, vote, copyToDraft = false) {
    if (!sponsorBlockEnableSubmission.value || sponsorBlockVotePending.value !== null) {
      return
    }

    const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
    if (!segment) {
      return
    }

    const previousVote = sponsorBlockUserVotes[segment.uuid]
    const videoId = props.videoId
    const nextVote = !copyToDraft && previousVote === vote ? null : vote
    const type = nextVote === null ? 20 : nextVote
    sponsorBlockVotePending.value = segment.uuid
    emitSponsorBlockInfoState()

    try {
      if (copyToDraft) {
        if (!await copySponsorBlockSegmentToDraft(segment)) return
        closeSponsorBlockInfo()
        if (sponsorBlockToastEditingUuid.value === uuid) sponsorBlockToastEditingUuid.value = null
        // Keep the original from interrupting inspection and preview of the corrected draft.
        setSegments(getSegments().filter(item => item.uuid !== uuid))
        refreshSponsorBlockToastSegments(uuid)
        cancelSponsorBlockSkipSchedule()
        refreshSponsorBlockMarkers()
        syncSponsorBlockPlaybackState()
        if (previousVote === 0) return
      }
      await voteOnSponsorBlockSegment(videoId, segment.uuid, type)
      if (props.videoId !== videoId) return
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
      showToast({ message: t('Video.Player.SponsorBlock.VoteFailed'), icon: ['fas', 'circle-exclamation'] })
    } finally {
      sponsorBlockVotePending.value = null
      emitSponsorBlockInfoState()
    }
  }

  async function changeSponsorBlockInfoSegmentCategory(uuid, category) {
    if (!sponsorBlockEnableSubmission.value || sponsorBlockVotePending.value !== null) return
    const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
    if (!segment || segment.category === category ||
      !getSponsorBlockCategoryVoteOptions(segment.actionType).includes(category)) return

    const videoId = props.videoId
    sponsorBlockVotePending.value = uuid
    emitSponsorBlockInfoState()
    try {
      await voteOnSponsorBlockSegment(videoId, uuid, category)
      if (props.videoId !== videoId) return
      segment.category = category
      hasSponsorBlockMusicOfftopicSegment.value = sponsorBlockInfoSegments.value.some(item => item.category === 'music_offtopic')
      setSegments(getSegments().filter(item => item.uuid !== uuid))
      if (SPONSORBLOCK_PLAYBACK_ACTION_TYPES.includes(segment.actionType) && sponsorSkips.value.seekBar.includes(category)) {
        getSegments().push(segment)
        getSegments().sort((a, b) => a.startTime - b.startTime)
      }
      refreshSponsorBlockToastSegments(uuid)
      cancelSponsorBlockSkipSchedule()
      refreshSponsorBlockMarkers()
      syncSponsorBlockPlaybackState()
      showToast({ message: t('Video.Player.SponsorBlock.CategoryVoteSuccess'), icon: ['fas', 'check'] })
    } catch (error) {
      console.error(error)
      showToast({ message: t('Video.Player.SponsorBlock.VoteFailed'), icon: ['fas', 'circle-exclamation'] })
    } finally {
      sponsorBlockVotePending.value = null
      emitSponsorBlockInfoState()
    }
  }

  function copyAndDownvoteSponsorBlockInfoSegment(uuid) {
    return voteOnSponsorBlockInfoSegment(uuid, 0, true)
  }

  function skipSponsorBlockInfoSegment(uuid) {
    const segment = sponsorBlockInfoSegments.value.find(item => item.uuid === uuid)
    if (!segment || !canSeek()) {
      return
    }

    if (segment.actionType === 'mute') {
      manuallyMutedSponsorBlockSegments.add(uuid)
      const currentTime = video.value.currentTime
      if (currentTime < segment.startTime || currentTime >= segment.endTime) {
        resetAccumulatedSeek()
        video.value.currentTime = segment.startTime
        sponsorBlockCurrentTime.value = segment.startTime
      }
      syncSponsorBlockMuteSegments(video.value.currentTime)
      showOverlayControls()
      return
    }

    const seekRange = getPlayer().seekRange()
    resetAccumulatedSeek()
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
    // also accepts any segment of a grouped toast
    const index = skippedSponsorBlockSegments.value.findIndex(segment => segment.uuid === uuid || segment.groupUuids?.includes(uuid))
    if (index !== -1) {
      if (sponsorBlockToastEditingUuid.value === skippedSponsorBlockSegments.value[index].uuid) sponsorBlockToastEditingUuid.value = null
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
    return resolveColorValue(colorName, '#39be70')
  }

  /**
   * One color per distinct category, in the order the categories are listed in the toast.
   * @param {{ category: SponsorBlockCategory }[]} segments
   * @returns {string[]}
   */
  function getSponsorBlockToastColors(segments) {
    return [...new Set(segments.map(({ category }) => category))].map(getSponsorBlockToastColor)
  }

  /**
   * @param {{ uuid: string, groupUuids?: string[], translatedCategory: string, colors: string[], isHighlight?: boolean, unskipTime?: number }} toast
   */
  function upsertSkippedSponsorBlockToast({ uuid, groupUuids = [uuid], translatedCategory, colors, isHighlight = false, unskipTime }) {
    const hideAt = Date.now() + sponsorBlockSkippedToastDurationMs.value

    // segments skipped together share one toast, so replace older toasts for any of them
    skippedSponsorBlockSegments.value
      .filter(skipped => skipped.uuid !== uuid && (skipped.groupUuids ?? [skipped.uuid]).some(groupUuid => groupUuids.includes(groupUuid)))
      .forEach(skipped => removeSponsorBlockToast(skipped.uuid))

    const existingSkip = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

    if (existingSkip) {
      clearTimeout(existingSkip.timeoutId)
      existingSkip.groupUuids = groupUuids
      existingSkip.translatedCategory = translatedCategory
      existingSkip.colors = colors
      existingSkip.unskipped = false
      existingSkip.hideRemainingMs = sponsorBlockSkippedToastDurationMs.value
      existingSkip.isHighlight = isHighlight
      existingSkip.isMute = false
      existingSkip.unskipTime = unskipTime ?? null
      // A toast under the pointer or focus stays until it is left, even when its segment is skipped again
      if (existingSkip.countdownPaused) {
        existingSkip.hideAt = null
        existingSkip.timeoutId = 0
        return
      }
      existingSkip.hideAt = hideAt
      existingSkip.timeoutId = setTimeout(() => {
        removeSponsorBlockToast(uuid)
      }, sponsorBlockSkippedToastDurationMs.value)
      return
    }

    skippedSponsorBlockSegments.value.push({
      uuid,
      groupUuids,
      translatedCategory,
      colors,
      unskipped: false,
      hideAt,
      hideRemainingMs: sponsorBlockSkippedToastDurationMs.value,
      countdownPaused: false,
      isHighlight,
      isMute: false,
      unskipTime: unskipTime ?? null,
      timeoutId: setTimeout(() => {
        removeSponsorBlockToast(uuid)
      }, sponsorBlockSkippedToastDurationMs.value)
    })
  }

  /**
   * @param {{ uuid: string, translatedCategory: string, color: string }} toast
   */
  function upsertMutedSponsorBlockToast({ uuid, translatedCategory, color }) {
    const existingToast = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

    if (existingToast) {
      clearTimeout(existingToast.timeoutId)
      existingToast.translatedCategory = translatedCategory
      existingToast.colors = [color]
      existingToast.unskipped = !(video.value?.muted ?? true)
      existingToast.hideAt = null
      existingToast.hideRemainingMs = 0
      existingToast.countdownPaused = false
      existingToast.isHighlight = false
      existingToast.isMute = true
      existingToast.unskipTime = null
      existingToast.timeoutId = 0
      return
    }

    skippedSponsorBlockSegments.value.push({
      uuid,
      translatedCategory,
      colors: [color],
      unskipped: !(video.value?.muted ?? true),
      hideAt: null,
      hideRemainingMs: 0,
      countdownPaused: false,
      isHighlight: false,
      isMute: true,
      unskipTime: null,
      timeoutId: 0
    })
  }

  /**
   * @param {{ category: SponsorBlockCategory }[]} segments
   * @returns {string}
   */
  function formatSponsorBlockToastCategories(segments) {
    const translatedCategories = [...new Set(segments.map(({ category }) => translateSponsorBlockCategory(category)))]
    return new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }).format(translatedCategories)
  }

  /**
   * @param {{ startTime: number, endTime: number }[]} segments
   * @returns {{ startTime: number, endTime: number }}
   */
  function getSponsorBlockSegmentsRange(segments) {
    return {
      startTime: Math.min(...segments.map(segment => segment.startTime)),
      endTime: Math.max(...segments.map(segment => segment.endTime))
    }
  }

  /**
   * Updates the toast containing a segment after segments were removed from or re-added to playback.
   * @param {string} uuid
   */
  function refreshSponsorBlockToastSegments(uuid) {
    const toast = skippedSponsorBlockSegments.value.find(item => item.uuid === uuid || item.groupUuids?.includes(uuid))
    if (!toast) {
      return
    }

    // describe the segments the toast still acts on, or drop it and its unskip state when none remain
    const toastSegments = getSponsorBlockToastSegments(toast.uuid)
    if (toastSegments.length === 0) {
      (toast.groupUuids ?? [toast.uuid]).forEach(groupUuid => sponsorBlockDoNotSkipSegments.delete(groupUuid))
      removeSponsorBlockToast(toast.uuid)
      return
    }

    toast.translatedCategory = formatSponsorBlockToastCategories(toastSegments)
    toast.colors = getSponsorBlockToastColors(toastSegments)
    // an unskipped group stays unskipped until playback passes its remaining segments,
    // keeping the original start so playback before them doesn't count as leaving the group
    const previousRange = toastSegments.map(segment => sponsorBlockDoNotSkipSegments.get(segment.uuid)).find(Boolean)
    if (previousRange) {
      const range = { startTime: previousRange.startTime, endTime: getSponsorBlockSegmentsRange(toastSegments).endTime }
      toast.groupUuids?.forEach(groupUuid => sponsorBlockDoNotSkipSegments.delete(groupUuid))
      toastSegments.forEach(segment => sponsorBlockDoNotSkipSegments.set(segment.uuid, range))
    }
  }

  /**
   * Returns the segments a skipped toast stands for, as segments skipped in one go share a toast.
   * @param {string} uuid
   */
  function getSponsorBlockToastSegments(uuid) {
    const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
    const groupUuids = toastEntry?.groupUuids ?? [uuid]
    return getSegments().filter(segment => groupUuids.includes(segment.uuid))
  }

  /**
   * @param {string} uuid
   * @returns {string}
   */
  function getSponsorBlockToastTimeLabel(uuid) {
    const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
    const segments = getSponsorBlockToastSegments(uuid)

    if (!toastEntry || segments.length === 0) {
      return '0s'
    }

    const endTime = Math.max(...segments.map(segment => segment.endTime))
    const remainingSeconds = toastEntry.unskipped || toastEntry.isMute
      ? Math.max(endTime - sponsorBlockCurrentTime.value, 0)
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
    return Boolean(toastEntry?.countdownPaused && !toastEntry.unskipped && !toastEntry.isMute)
  }

  /**
   * @param {boolean} unskipped
   * @param {string} uuid
   * @returns {string}
   */
  function getSponsorBlockToastActionLabel(unskipped, uuid) {
    const segment = getSegments().find(candidate => candidate.uuid === uuid)
    const actionLabel = segment?.actionType === 'mute'
      ? unskipped
        ? t('Video.Player.SponsorBlock.MuteActionType')
        : t('Video.Player.SponsorBlock.MuteToastUnmute')
      : unskipped
        ? t('Video.Player.SponsorBlock.SkipToastReskip')
        : t('Video.Player.SponsorBlock.SkipToastUnskip')

    const activeToast = getActiveSponsorBlockToast()
    if (!hardwareKeyboardAttached.value || getActivePromptSponsorBlockToast() || activeToast?.uuid !== uuid) {
      return actionLabel
    }

    return addKeyboardShortcutToActionTitle(
      actionLabel,
      t('Keys.enter')
    )
  }

  function getSponsorBlockToastLabel(uuid, translatedCategory, isHighlight) {
    if (isHighlight) {
      return t('Video.Player.SponsorBlock.SkippedToHighlight')
    }

    const segment = getSegments().find(candidate => candidate.uuid === uuid)
    return segment?.actionType === 'mute'
      ? t('Video.Player.SponsorBlock.MutedSegment', { segmentCategory: translatedCategory })
      : t('Video.Player.Skipped segment', { segmentCategory: translatedCategory })
  }

  /**
   * @param {string} translatedCategory
   * @returns {string}
   */
  function getSponsorBlockPromptLabel(translatedCategory, uuid) {
    const segment = getSegments().find(candidate => candidate.uuid === uuid)
    if (segment?.actionType === 'mute') {
      return t('Video.Player.SponsorBlock.MutePrompt', { segmentCategory: translatedCategory })
    }

    return t('Video.Player.SponsorBlock.SkipPrompt', { segmentCategory: translatedCategory })
  }

  /**
   * @param {string} uuid
   * @returns {string}
   */
  function getSponsorBlockPromptActionLabel(uuid) {
    const segment = getSegments().find(candidate => candidate.uuid === uuid)
    const actionLabel = segment?.actionType === 'mute'
      ? t('Video.Player.SponsorBlock.MuteActionType')
      : t('Video.Player.SponsorBlock.SkipPromptAction')

    if (!hardwareKeyboardAttached.value || getActivePromptSponsorBlockToast()?.uuid !== uuid) {
      return actionLabel
    }

    return addKeyboardShortcutToActionTitle(
      actionLabel,
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
    const segment = getSegments().find(seg => seg.uuid === uuid)
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
    const segment = getSegments().find(seg => seg.uuid === uuid)
    if (!segment || isSponsorBlockPointSegment(segment) || !canSeek()) {
      return false
    }

    sponsorBlockDismissedPromptSegments.add(uuid)
    removePromptSponsorBlockToast(uuid)

    if (segment.actionType === 'mute') {
      manuallyMutedSponsorBlockSegments.add(uuid)
      syncSponsorBlockMuteSegments(video.value.currentTime)
      return true
    }

    const seekRange = getPlayer().seekRange()
    const targetTime = Math.min(
      Math.max(getSponsorBlockSegmentSkipTarget(segment), seekRange.start),
      seekRange.end
    )
    resetAccumulatedSeek()
    video.value.currentTime = targetTime
    sponsorBlockCurrentTime.value = targetTime

    if (sponsorBlockShowSkippedToast.value) {
      upsertSkippedSponsorBlockToast({
        uuid,
        translatedCategory: translateSponsorBlockCategory(segment.category),
        colors: [getSponsorBlockToastColor(segment.category)]
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
    const seekRange = getPlayer().seekRange()
    const targetTime = Math.min(
      Math.max(segment.startTime, seekRange.start),
      seekRange.end
    )
    resetAccumulatedSeek()
    video.value.currentTime = targetTime
    sponsorBlockCurrentTime.value = targetTime
    updateSponsorBlockHighlightState(targetTime)

    if (sponsorBlockShowSkippedToast.value) {
      upsertSkippedSponsorBlockToast({
        uuid: segment.uuid,
        translatedCategory: translateSponsorBlockCategory(segment.category),
        colors: [getSponsorBlockToastColor(segment.category)],
        isHighlight: true,
        unskipTime
      })
    }

    showOverlayControls()
    return true
  }

  function toggleActiveSponsorBlockSkipState() {
    const promptToastEntry = getActivePromptSponsorBlockToast()
    const toastEntry = getActiveSponsorBlockToast()

    const targets = resolveSponsorBlockEnterTargets(
      !!promptToastEntry,
      !!toastEntry,
      !!activeSponsorBlockHighlightSegment.value
    )

    // a target can turn out to be a no-op (e.g. a toast whose segment vanished on a SponsorBlock
    // refresh), so fall through to the next one instead of swallowing the key press
    for (const target of targets) {
      let handled = false

      switch (target) {
        case 'prompt':
          handled = skipPromptSponsorBlockSegment(promptToastEntry.uuid)
          break
        case 'toast':
          handled = toastEntry.unskipped
            ? redoSkipSponsorBlockSegment(toastEntry.uuid)
            : unskipSponsorBlockSegment(toastEntry.uuid)
          break
        case 'highlight':
          handled = skipToSponsorBlockHighlight()
          break
      }

      if (handled) {
        return true
      }
    }

    return false
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
      const segment = getSegments().find(seg => seg.uuid === uuid)
      if (!segment || !isSponsorBlockSegmentActiveForPrompt(segment, currentTime)) {
        sponsorBlockDismissedPromptSegments.delete(uuid)
      }
    }

    getSegments().forEach(segment => {
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
   * Last state sent to the highlight button. Timeupdates only dispatch when
   * it changes; rebuilt buttons start from it.
   * @type {{ visible: boolean, labelVisible: boolean, shortcutAvailable: boolean } | null}
   */
  let sponsorBlockHighlightState = null

  /**
   * @param {number} currentTime
   */
  function updateSponsorBlockHighlightState(currentTime = sponsorBlockCurrentTime.value) {
    const { promptSkip } = sponsorSkips.value
    const nextHighlightSegment = promptSkip.has('poi_highlight')
      ? getSegments().find(segment => {
        return isSponsorBlockPointSegment(segment) &&
          segment.category === 'poi_highlight' &&
          segment.startTime - currentTime > 0.5
      }) ?? null
      : null

    activeSponsorBlockHighlightSegment.value = nextHighlightSegment
    const state = {
      visible: nextHighlightSegment !== null,
      labelVisible: sponsorBlockHighlightLabelVisible,
      shortcutAvailable: resolveSponsorBlockEnterTarget(
        !!getActivePromptSponsorBlockToast(),
        !!getActiveSponsorBlockToast(),
        nextHighlightSegment !== null
      ) === 'highlight'
    }
    if (
      sponsorBlockHighlightState?.visible === state.visible &&
      sponsorBlockHighlightState.labelVisible === state.labelVisible &&
      sponsorBlockHighlightState.shortcutAvailable === state.shortcutAvailable
    ) {
      return
    }
    sponsorBlockHighlightState = state
    events.dispatchEvent(new CustomEvent('sponsorBlockHighlightStateChanged', { detail: state }))
  }

  // the highlight button only advertises the Enter shortcut while no toast is claiming it
  watch(
    () => skippedSponsorBlockSegments.value.length > 0 || promptSponsorBlockSegments.value.length > 0,
    () => {
      if (activeSponsorBlockHighlightSegment.value) {
        updateSponsorBlockHighlightState()
      }
    }
  )

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
    if (!toastEntry || toastEntry.unskipped || toastEntry.isMute || toastEntry.countdownPaused) {
      return
    }

    clearTimeout(toastEntry.timeoutId)
    toastEntry.hideRemainingMs = Math.max((toastEntry.hideAt ?? 0) - Date.now(), 0)
    toastEntry.hideAt = null
    toastEntry.timeoutId = 0
    toastEntry.countdownPaused = true
  }

  function toggleSponsorBlockToastEditing(uuid) {
    if (!sponsorBlockEnableSubmission.value || sponsorBlockVotePending.value !== null) return
    if (!sponsorBlockInfoSegments.value.some(segment => segment.uuid === uuid)) return
    sponsorBlockToastEditingUuid.value = sponsorBlockToastEditingUuid.value === uuid ? null : uuid
    if (sponsorBlockToastEditingUuid.value === uuid) pauseSponsorBlockToastCountdown(uuid)
  }

  function clampSponsorBlockToastEditorScroll() {
    nextTick(() => {
      const scroller = container.value?.querySelector('.sponsorBlockToastEditor')
      if (scroller) clampOverlayScrollTop(scroller, scroller.querySelector('.sponsorBlockEditActions'))
    })
  }

  /**
   * @param {string} uuid
   */
  function resumeSponsorBlockToastCountdown(uuid) {
    if (sponsorBlockToastEditingUuid.value === uuid) return
    const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
    if (!toastEntry || toastEntry.unskipped || toastEntry.isMute || !toastEntry.countdownPaused) {
      return
    }

    toastEntry.hideAt = Date.now() + toastEntry.hideRemainingMs
    toastEntry.timeoutId = setTimeout(() => {
      removeSponsorBlockToast(uuid)
    }, toastEntry.hideRemainingMs)
    toastEntry.countdownPaused = false
  }

  function getNextSponsorBlockAutoSkipSegment(currentTime) {
    const { autoSkip } = sponsorSkips.value

    return getSegments().find(segment =>
      segment.actionType === 'skip' &&
      !isSponsorBlockPointSegment(segment) &&
      !sponsorBlockDoNotSkipSegments.has(segment.uuid) &&
      autoSkip.has(segment.category) &&
      segment.startTime > currentTime &&
      segment.endTime > segment.startTime
    ) ?? null
  }

  function startSponsorBlockSkipPolling(segment) {
    function checkBoundary() {
      const videoElement = video.value
      if (!videoElement || videoElement.paused || videoElement.ended) {
        cancelSponsorBlockSkipSchedule()
        return false
      }

      const currentTime = videoElement.currentTime
      if (currentTime < segment.startTime) {
        const remainingMs = (segment.startTime - currentTime) * 1000 / videoElement.playbackRate
        if (remainingMs > SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS) {
          // Woke too early (e.g. playback stalled): wait for the same boundary again.
          cancelSponsorBlockSkipSchedule()
          scheduleSponsorBlockSkip()
          return false
        }
        return true
      }

      cancelSponsorBlockSkipSchedule()
      skipSponsorBlockSegments(currentTime)
      scheduleSponsorBlockSkip()
      return false
    }

    function scheduleTaskCheck() {
      return scheduleSponsorBlockSkipTask(() => {
        if (checkBoundary()) {
          scheduleTaskCheck()
        }
      }, SPONSORBLOCK_SKIP_POLL_INTERVAL_MS)
    }

    if (!scheduleTaskCheck()) {
      sponsorBlockSkipScheduleInterval = setInterval(checkBoundary, SPONSORBLOCK_SKIP_POLL_INTERVAL_MS)
    }
  }

  function scheduleSponsorBlockSkipTask(callback, delayMs) {
    if (typeof window.scheduler?.postTask !== 'function') {
      return false
    }

    const controller = sponsorBlockSkipScheduleTaskController ?? new AbortController()
    sponsorBlockSkipScheduleTaskController = controller
    window.scheduler.postTask(callback, {
      delay: delayMs,
      priority: 'user-blocking',
      signal: controller.signal
    }).catch((error) => {
      if (error !== controller.signal.reason) {
        console.error(error)
      }
    })
    return true
  }

  function scheduleSponsorBlockSkip() {
    const videoElement = video.value
    if (
      !useSponsorBlock.value ||
      props.sponsorBlockAutoSkipDisabled ||
      !videoElement ||
      videoElement.paused ||
      videoElement.ended ||
      !Number.isFinite(videoElement.playbackRate) ||
      videoElement.playbackRate <= 0 ||
      getSegments().length === 0 ||
      !canSeek()
    ) {
      cancelSponsorBlockSkipSchedule()
      return
    }

    const segment = getNextSponsorBlockAutoSkipSegment(videoElement.currentTime)
    if (!segment) {
      cancelSponsorBlockSkipSchedule()
      return
    }

    // Seeks and pauses cancel the schedule, so an unchanged key means the
    // pending timer still fires at the right time.
    const scheduleKey = `${segment.uuid}:${segment.startTime}:${videoElement.playbackRate}`
    if (scheduleKey === sponsorBlockSkipScheduleKey) {
      return
    }
    cancelSponsorBlockSkipSchedule()
    sponsorBlockSkipScheduleKey = scheduleKey

    const delayMs = (segment.startTime - videoElement.currentTime) * 1000 / videoElement.playbackRate
    if (delayMs <= SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS) {
      startSponsorBlockSkipPolling(segment)
      return
    }

    if (!scheduleSponsorBlockSkipTask(
      () => startSponsorBlockSkipPolling(segment),
      delayMs - SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS
    )) {
      sponsorBlockSkipScheduleTimeout = setTimeout(() => {
        sponsorBlockSkipScheduleTimeout = null
        startSponsorBlockSkipPolling(segment)
      }, delayMs - SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS)
    }
  }

  function syncSponsorBlockMuteSegments(currentTime, autoMuteEnabled = true) {
    const activeMuteSegments = new Set()

    for (const uuid of manuallyMutedSponsorBlockSegments) {
      const segment = getSegments().find(candidate => candidate.uuid === uuid)
      if (!segment || currentTime < segment.startTime || currentTime >= segment.endTime) {
        manuallyMutedSponsorBlockSegments.delete(uuid)
      }
    }

    for (const uuid of sponsorBlockDoNotMuteSegments) {
      const segment = getSegments().find(candidate => candidate.uuid === uuid)
      if (!segment || currentTime < segment.startTime || currentTime >= segment.endTime) {
        sponsorBlockDoNotMuteSegments.delete(uuid)
      }
    }

    getSegments().forEach(segment => {
      const isActive = segment.actionType === 'mute' &&
        currentTime >= segment.startTime &&
        currentTime < segment.endTime &&
        (manuallyMutedSponsorBlockSegments.has(segment.uuid) ||
          sponsorBlockDoNotMuteSegments.has(segment.uuid) ||
          (autoMuteEnabled && sponsorSkips.value.autoSkip.has(segment.category)))

      if (!isActive) {
        return
      }

      activeMuteSegments.add(segment.uuid)
    })

    for (const uuid of notifiedSponsorBlockMuteSegments) {
      if (!activeMuteSegments.has(uuid)) {
        notifiedSponsorBlockMuteSegments.delete(uuid)
        removeSponsorBlockToast(uuid)
      }
    }

    const shouldMute = getSegments().some(segment => {
      return activeMuteSegments.has(segment.uuid) &&
        !sponsorBlockDoNotMuteSegments.has(segment.uuid)
    })

    sponsorBlockMuteController.setSourceActive('segments', activeMuteSegments.size > 0)
    sponsorBlockMuteController.setSourceSuppressed('segments', !shouldMute)

    getSegments().forEach(segment => {
      if (!activeMuteSegments.has(segment.uuid) ||
          !sponsorBlockShowSkippedToast.value ||
          notifiedSponsorBlockMuteSegments.has(segment.uuid)) {
        return
      }

      notifiedSponsorBlockMuteSegments.add(segment.uuid)
      upsertMutedSponsorBlockToast({
        uuid: segment.uuid,
        translatedCategory: translateSponsorBlockCategory(segment.category),
        color: getSponsorBlockToastColor(segment.category)
      })
    })
  }

  function clearSponsorBlockMuteSegments(preserveDecisions = false) {
    if (!preserveDecisions) {
      manuallyMutedSponsorBlockSegments.clear()
      sponsorBlockDoNotMuteSegments.clear()
    }
    notifiedSponsorBlockMuteSegments.clear()
    skippedSponsorBlockSegments.value
      .filter(segment => segment.isMute)
      .forEach(segment => removeSponsorBlockToast(segment.uuid))
    sponsorBlockMuteController.setSourceActive('segments', false)
  }

  /**
   * Unskips a SponsorBlock segment by seeking back to its start time
   * and preventing it from being auto-skipped again until the user leaves the segment.
   * @param {string} uuid - The UUID of the segment to unskip
   * @returns {boolean} whether anything was actually unskipped
   */
  function unskipSponsorBlockSegment(uuid) {
    // a grouped toast keeps working when its first segment was removed (e.g. after a category change)
    const segment = getSponsorBlockToastSegments(uuid)[0]
    if (!segment) {
      return false
    }

    const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)

    if (segment.actionType === 'mute') {
      sponsorBlockDoNotMuteSegments.add(uuid)
      manuallyMutedSponsorBlockSegments.delete(uuid)
      syncSponsorBlockMuteSegments(video.value.currentTime, !props.sponsorBlockAutoSkipDisabled)
      if (toastEntry) {
        toastEntry.unskipped = true
      }
      return true
    }

    if (isSponsorBlockPointSegment(segment)) {
      if (!toastEntry?.isHighlight || toastEntry.unskipTime === null || !canSeek()) {
        return false
      }

      const seekRange = getPlayer().seekRange()
      const targetTime = Math.min(
        Math.max(toastEntry.unskipTime, seekRange.start),
        seekRange.end
      )
      resetAccumulatedSeek()
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime
      removeSponsorBlockToast(uuid)
      updateSponsorBlockHighlightState(targetTime)
      return true
    }

    const groupSegments = getSponsorBlockToastSegments(uuid)
    const range = getSponsorBlockSegmentsRange(groupSegments)
    groupSegments.forEach(groupSegment => {
      sponsorBlockDoNotSkipSegments.set(groupSegment.uuid, range)
      sponsorBlockDismissedPromptSegments.add(groupSegment.uuid)
      removePromptSponsorBlockToast(groupSegment.uuid)
    })

    if (canSeek()) {
      const seekRange = getPlayer().seekRange()
      const targetTime = Math.max(range.startTime, seekRange.start)
      resetAccumulatedSeek()
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

    return true
  }

  /**
   * Re-skips a SponsorBlock segment that was previously unskipped,
   * seeking to the end of the segment and restoring auto-skip behavior.
   * @param {string} uuid - The UUID of the segment to re-skip
   * @returns {boolean} whether anything was actually re-skipped
   */
  function redoSkipSponsorBlockSegment(uuid) {
    const segment = getSponsorBlockToastSegments(uuid)[0]
    if (!segment || isSponsorBlockPointSegment(segment)) {
      return false
    }

    if (segment.actionType === 'mute') {
      sponsorBlockDoNotMuteSegments.delete(uuid)
      manuallyMutedSponsorBlockSegments.add(uuid)
      syncSponsorBlockMuteSegments(video.value.currentTime, !props.sponsorBlockAutoSkipDisabled)
      sponsorBlockMuteController.enforceMuted()
      const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
      if (toastEntry) {
        toastEntry.unskipped = false
      }
      return true
    }

    const groupSegments = getSponsorBlockToastSegments(uuid)
    groupSegments.forEach(groupSegment => {
      sponsorBlockDoNotSkipSegments.delete(groupSegment.uuid)
      sponsorBlockDismissedPromptSegments.add(groupSegment.uuid)
      removePromptSponsorBlockToast(groupSegment.uuid)
    })

    if (canSeek()) {
      const seekRange = getPlayer().seekRange()
      const targetTime = Math.min(Math.max(...groupSegments.map(groupSegment => groupSegment.endTime)), seekRange.end)
      resetAccumulatedSeek()
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime
    }

    // Update the toast entry to show it's been re-skipped and reset the timeout
    const toastEntry = skippedSponsorBlockSegments.value.find(skipped => skipped.uuid === uuid)
    if (toastEntry) {
      upsertSkippedSponsorBlockToast({
        uuid,
        groupUuids: toastEntry.groupUuids,
        translatedCategory: toastEntry.translatedCategory,
        colors: toastEntry.colors
      })
    }

    return true
  }

  /**
   * @param {number} hoverTime
   * @param {number} secondsPerPixel
   * @returns {string}
   */
  function getSponsorBlockSeekBarTooltipLabel(hoverTime, secondsPerPixel) {
    const segments = getSegments().concat(
      sponsorBlockCompleteDraftSegments.value.filter(segment => !isSponsorBlockFullVideoSegment(segment))
    )
    const segment = findSponsorBlockSeekBarSegment(segments, hoverTime, secondsPerPixel)

    return segment ? translateSponsorBlockCategory(segment.category) : ''
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

    const terminalOutro = getSegments().find(segment =>
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

  watch(() => skippedSponsorBlockSegments.value.length, (length) => {
    if (length > 0) {
      sponsorBlockToastNow.value = Date.now()
      startSponsorBlockToastTimer()
    } else {
      stopSponsorBlockToastTimer()
    }
  })

  onUnmounted(() => {
    clearTimeout(sponsorBlockHighlightLabelTimeout)
  })

  return {
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
    getSponsorBlockHighlightState: () => sponsorBlockHighlightState,
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
  }
}
