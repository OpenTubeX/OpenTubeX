import { computed, reactive, ref } from 'vue'

import store from '../../../store/index'
import { submitSponsorBlockSegments } from '../../../helpers/sponsorblock'
import { openExternalLink, showToast } from '../../../helpers/utils'

const SPONSORBLOCK_SUBMISSION_CATEGORIES = Object.freeze([
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'hook',
  'music_offtopic',
  'filler',
  'poi_highlight'
])

const SPONSORBLOCK_PREVIEW_SECONDS = 2
const SPONSORBLOCK_TIMESTAMP_PRECISION_MS = 1
const SPONSORBLOCK_PREVIEW_END_EPSILON_SECONDS = 0.01

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

/**
 * OpenTubeX's SponsorBlock draft and submission workflow.
 *
 * @param {{
 *   canSeek: () => boolean,
 *   events: EventTarget,
 *   getPlayer: () => import('shaka-player').Player | null,
 *   isLive: import('vue').Ref<boolean>,
 *   onSubmittedSegments: (segments: Array<object>) => void,
 *   props: { videoId: string },
 *   showOverlayControls: () => void,
 *   sponsorBlockCurrentTime: import('vue').Ref<number>,
 *   t: (key: string) => string,
 *   useSponsorBlock: import('vue').ComputedRef<boolean>,
 *   video: import('vue').Ref<HTMLVideoElement | null>
 * }} options
 */
export function useSponsorBlockSubmission({
  canSeek,
  events,
  getPlayer,
  isLive,
  onSubmittedSegments,
  props,
  showOverlayControls,
  sponsorBlockCurrentTime,
  t,
  useSponsorBlock,
  video,
}) {
  const sponsorBlockEnableSubmission = computed(() => store.getters.getSponsorBlockEnableSubmission)
  const sponsorBlockDraftSegmentsByVideoId = computed(() => store.getters.getSponsorBlockDraftSegmentsByVideoId)

  /** @type {import('vue').Ref<{id: string, startTime: number, endTime: number | null, category: import('../../../helpers/sponsorblock').SponsorBlockCategory, previewed: boolean}[]>} */
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
    return sponsorBlockDraftSegments.value.filter(isSponsorBlockDraftComplete)
  })

  const sponsorBlockHasIncompleteDraft = computed(() => {
    return sponsorBlockDraftSegments.value.some(segment => !isSponsorBlockDraftComplete(segment))
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

  function isSponsorBlockDraftEditing(segmentId) {
    return sponsorBlockDraftEditingStates[segmentId] !== false
  }

  function setSponsorBlockDraftEditing(segmentId, isEditing) {
    sponsorBlockDraftEditingStates[segmentId] = isEditing
  }

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
      previewed: Boolean(segment?.previewed && (endTime != null || isSponsorBlockPointCategory(category)))
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
      if (!sponsorBlockPreviewSkipSegment.value || !video.value || !getPlayer() || !canSeek()) {
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

  function getCurrentSponsorBlockDraft() {
    return sponsorBlockDraftSegments.value.findLast(segment => segment.endTime == null) ?? null
  }

  function getSponsorBlockSubmissionVideoDuration() {
    const player = getPlayer()
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
      showToast({ message: errorMessage, icon: ['fas', 'circle-exclamation'] })
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
    const category = SPONSORBLOCK_SUBMISSION_CATEGORIES.includes(editValue.category) ? editValue.category : 'sponsor'
    const isPointCategory = isSponsorBlockPointCategory(category)
    const endTime = isPointCategory || editValue.endTime.trim() === '' ? null : parseSponsorBlockDraftTimestamp(editValue.endTime)

    if (startTime == null) {
      const errorMessage = t('Video.Player.SponsorBlock.InvalidStartTime')
      sponsorBlockSubmissionError.value = errorMessage
      showToast({ message: errorMessage, icon: ['fas', 'circle-exclamation'] })
      return false
    }

    if (!isPointCategory && endTime != null && endTime <= startTime) {
      const errorMessage = t('Video.Player.SponsorBlock.EndTimeAfterStart')
      sponsorBlockSubmissionError.value = errorMessage
      showToast({ message: errorMessage, icon: ['fas', 'circle-exclamation'] })
      return false
    }

    const currentDuration = getSponsorBlockSubmissionVideoDuration()
    if (currentDuration != null && (isPointCategory ? startTime : endTime) > currentDuration) {
      const errorMessage = t('Video.Player.SponsorBlock.EndTimeBeforeVideoEnd')
      sponsorBlockSubmissionError.value = errorMessage
      showToast({ message: errorMessage, icon: ['fas', 'circle-exclamation'] })
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

    if (draft.endTime == null && !isSponsorBlockPointSegment(draft)) {
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
      if (draft.endTime == null) {
        return
      }

      video.value.currentTime = draft.endTime
      sponsorBlockCurrentTime.value = draft.endTime
      showOverlayControls()
      return
    }

    if (isSponsorBlockPointSegment(draft)) {
      video.value.currentTime = draft.startTime
      sponsorBlockCurrentTime.value = draft.startTime
      replaceSponsorBlockDraftSegment(segmentId, (segment) => ({
        ...segment,
        previewed: true
      }))
      sponsorBlockSubmissionError.value = ''
      await persistSponsorBlockDrafts()
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

  function isSponsorBlockPointCategory(category) {
    return category === 'poi_highlight'
  }

  function isSponsorBlockPointSegment(segment) {
    return segment.actionType === 'poi' || isSponsorBlockPointCategory(segment.category)
  }

  function isSponsorBlockDraftComplete(segment) {
    return isSponsorBlockPointSegment(segment) || typeof segment.endTime === 'number'
  }

  function sponsorBlockDraftRequiresPreview(segment) {
    return !isSponsorBlockPointSegment(segment)
  }

  function getSponsorBlockSubmissionSegmentTimes(segment) {
    return isSponsorBlockPointSegment(segment)
      ? [segment.startTime, segment.startTime]
      : [segment.startTime, segment.endTime]
  }

  function getSponsorBlockSubmissionActionType(segment) {
    return isSponsorBlockPointSegment(segment) ? 'poi' : 'skip'
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
      showToast({ message: sponsorBlockSubmissionError.value, icon: ['fas', 'circle-exclamation'] })
      return
    }

    for (const segment of sponsorBlockDraftSegments.value) {
      if (!await saveSponsorBlockDraft(segment.id)) {
        return
      }
    }

    if (sponsorBlockDraftSegments.value.some(segment => sponsorBlockDraftRequiresPreview(segment) && !segment.previewed)) {
      sponsorBlockSubmissionError.value = t('Video.Player.SponsorBlock.PreviewRequired')
      showToast({ message: sponsorBlockSubmissionError.value, icon: ['fas', 'circle-exclamation'] })
      return
    }

    const duplicateKeySet = new Set()
    for (const segment of sponsorBlockDraftSegments.value) {
      const duplicateKey = `${segment.startTime}-${segment.endTime}-${segment.category}`
      if (duplicateKeySet.has(duplicateKey)) {
        sponsorBlockSubmissionError.value = t('Video.Player.SponsorBlock.DuplicateSegments')
        showToast({ message: sponsorBlockSubmissionError.value, icon: ['fas', 'circle-exclamation'] })
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
          segment: getSponsorBlockSubmissionSegmentTimes(segment),
          category: segment.category,
          actionType: getSponsorBlockSubmissionActionType(segment),
          description: ''
        }))
      )

      onSubmittedSegments(response.map((segment) => ({
        uuid: segment.UUID,
        category: segment.category,
        actionType: segment.actionType,
        startTime: segment.segment[0],
        endTime: segment.segment[1]
      })))

      sponsorBlockDraftSegments.value = []
      pruneSponsorBlockDraftEditValues()
      closeSponsorBlockSubmissionMenu()
      await persistSponsorBlockDrafts()
      showToast({ message: t('Video.Player.SponsorBlock.SubmissionSuccess'), icon: ['fas', 'check'] })
    } catch (error) {
      sponsorBlockSubmissionError.value = getSponsorBlockSubmitErrorMessage(error)
      showToast({ message: sponsorBlockSubmissionError.value, time: 5000, icon: ['fas', 'circle-exclamation'] })
    } finally {
      sponsorBlockSubmissionPending.value = false
    }
  }

  function openSponsorBlockGuidelines() {
    openExternalLink('https://wiki.sponsor.ajay.app/w/Guidelines')
  }

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
      const player = getPlayer()
      const seekRange = player.seekRange()
      const targetTime = Math.min(previewSegment.endTime + SPONSORBLOCK_PREVIEW_END_EPSILON_SECONDS, seekRange.end)
      video.value.currentTime = targetTime
      sponsorBlockCurrentTime.value = targetTime
      stopSponsorBlockPreviewSkip()
    }
  }

  return {
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
    sponsorBlockSubmissionCategories: SPONSORBLOCK_SUBMISSION_CATEGORIES,
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
  }
}
