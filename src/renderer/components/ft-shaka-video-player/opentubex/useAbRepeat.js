import { computed, onUnmounted, ref } from 'vue'
import { AB_REPEAT_ICON } from '../player-components/AbRepeatControl'
import {
  AbRepeatValidation,
  formatAbRepeatTimestamp,
  getAbRepeatBoundaryDelay,
  isCompleteAbRepeatRange,
  validateAbRepeatRange,
} from '../../../helpers/player/abRepeat'

const AB_REPEAT_MIN_RANGE_SECONDS = 0.05
const AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS = 0.012
export const AB_REPEAT_VALUE_CHANGE_ICON = AB_REPEAT_ICON

/**
 * Repeats the range between the A and B points, which are set from the current time,
 * the keyboard, or by dragging their markers on the seek bar.
 * @param {{
 *   addMarkers: (markers: HTMLElement[]) => void,
 *   container: import('vue').Ref<HTMLElement | null>,
 *   disableAbRepeat: import('vue').ComputedRef<boolean>,
 *   getPlayer: () => shaka.Player | null,
 *   isLive: import('vue').Ref<boolean>,
 *   onRepeat: () => void,
 *   resetSeekAccumulation: () => void,
 *   showValueChange: (message: string, icons: string | { path: string, viewBox: string }) => void,
 *   t: (key: string, named?: Record<string, unknown>) => string,
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 * }} options
 */
export function useAbRepeat({
  addMarkers,
  container,
  disableAbRepeat,
  getPlayer,
  isLive,
  onRepeat,
  resetSeekAccumulation,
  showValueChange,
  t,
  video,
}) {
  const abRepeatStart = ref(null)
  const abRepeatEnd = ref(null)
  const abRepeatEnabled = ref(false)
  const abRepeatDuration = ref(Number.POSITIVE_INFINITY)
  const abRepeatValidation = computed(() => validateAbRepeatRange(
    abRepeatStart.value,
    abRepeatEnd.value,
    abRepeatDuration.value
  ))
  const abRepeatAvailable = computed(() => isCompleteAbRepeatRange(
    abRepeatStart.value,
    abRepeatEnd.value,
    abRepeatDuration.value
  ))
  /**
   * @param {string | null} validation
   * @returns {string}
   */
  function getAbRepeatValidationMessage(validation) {
    switch (validation) {
      case AbRepeatValidation.END_NOT_AFTER_START:
        return t('Video.Player.A-B Repeat.End Before Start')
      case AbRepeatValidation.OUTSIDE_DURATION:
        return t('Video.Player.A-B Repeat.Outside Duration')
      default:
        return ''
    }
  }
  const abRepeatValidationMessage = computed(() => (
    getAbRepeatValidationMessage(abRepeatValidation.value)
  ))

  let abRepeatBoundaryTimeout = null
  let abRepeatDragCleanup = null

  function clearAbRepeatBoundarySchedule() {
    clearTimeout(abRepeatBoundaryTimeout)
    abRepeatBoundaryTimeout = null
  }

  // Where playback last ran inside the range since the latest seek. Only playback from
  // there counts as a repeat at B: the events of a seek to B or to the media end can
  // still report playback or arrive in either order.
  let abRepeatPlaybackPosition = null

  function handleAbRepeatSeeking() {
    clearAbRepeatBoundarySchedule()
    abRepeatPlaybackPosition = null
  }

  /**
   * @param {'start' | 'end'} point
   * @param {number} value
   * @returns {number}
   */
  function clampAbRepeatBoundary(point, value) {
    const seekRange = getPlayer()?.seekRange()
    const rangeStart = Number.isFinite(seekRange?.start) ? seekRange.start : 0
    const rangeEnd = Number.isFinite(seekRange?.end) ? seekRange.end : getAbRepeatDuration()

    if (point === 'start') {
      const latestStart = abRepeatEnd.value === null
        ? rangeEnd
        : abRepeatEnd.value - AB_REPEAT_MIN_RANGE_SECONDS
      return Math.min(Math.max(value, rangeStart), Math.max(rangeStart, latestStart))
    }

    const earliestEnd = abRepeatStart.value === null
      ? rangeStart
      : abRepeatStart.value + AB_REPEAT_MIN_RANGE_SECONDS
    return Math.max(Math.min(value, rangeEnd), Math.min(rangeEnd, earliestEnd))
  }

  /**
   * @param {'start' | 'end'} point
   * @param {number} clientX
   * @param {HTMLElement} seekBar
   */
  function setAbRepeatBoundaryFromPointer(point, clientX, seekBar) {
    const bounds = seekBar.getBoundingClientRect()
    const seekRange = getPlayer()?.seekRange()
    if (!seekRange || bounds.width <= 0) {
      return
    }

    const position = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1)
    const value = seekRange.start + position * (seekRange.end - seekRange.start)
    setAbRepeatBoundary(point, clampAbRepeatBoundary(point, value))
  }

  /**
   * @param {'start' | 'end'} point
   * @param {PointerEvent} event
   */
  function startAbRepeatMarkerDrag(point, event) {
    const seekBar = container.value?.querySelector('.shaka-seek-bar-container')
    if (!(seekBar instanceof HTMLElement)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    abRepeatDragCleanup?.()

    const pointerId = event.pointerId
    let latestClientX = event.clientX
    let updateFrame = null

    const applyPendingPosition = () => {
      updateFrame = null
      setAbRepeatBoundaryFromPointer(point, latestClientX, seekBar)
    }
    const queuePosition = (clientX) => {
      latestClientX = clientX
      if (updateFrame === null) {
        updateFrame = requestAnimationFrame(applyPendingPosition)
      }
    }
    const handlePointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return
      }
      moveEvent.preventDefault()
      queuePosition(moveEvent.clientX)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      if (updateFrame !== null) {
        cancelAnimationFrame(updateFrame)
        updateFrame = null
      }
      container.value?.classList.remove('abRepeatDragging')
      abRepeatDragCleanup = null
    }
    const handlePointerEnd = (endEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return
      }
      setAbRepeatBoundaryFromPointer(point, endEvent.clientX, seekBar)
      cleanup()
    }

    abRepeatDragCleanup = cleanup
    container.value?.classList.add('abRepeatDragging')
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
  }

  /**
   * @param {'start' | 'end'} point
   * @param {KeyboardEvent} event
   */
  function handleAbRepeatMarkerKeydown(point, event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const currentValue = point === 'start' ? abRepeatStart.value : abRepeatEnd.value
    if (currentValue === null) {
      return
    }

    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const step = event.shiftKey ? 1 : 0.1
    setAbRepeatBoundary(point, clampAbRepeatBoundary(point, currentValue + direction * step))
    requestAnimationFrame(() => {
      container.value?.querySelector(`.abRepeatMarker${point === 'start' ? 'A' : 'B'}`)?.focus()
    })
  }

  function getAbRepeatDuration() {
    const duration = video.value?.duration
    return Number.isFinite(duration) && duration >= 0
      ? duration
      : Number.POSITIVE_INFINITY
  }

  function hasValidAbRepeatRange() {
    return abRepeatAvailable.value
  }

  function repeatAbRangeFromStart(countRepeat = false) {
    const videoElement = video.value
    if (!videoElement || !hasValidAbRepeatRange()) {
      return
    }

    clearAbRepeatBoundarySchedule()
    if (countRepeat) onRepeat()
    resetSeekAccumulation()
    videoElement.currentTime = abRepeatStart.value
  }

  /** @param {boolean} [countRepeat] */
  function checkAbRepeatBoundary(countRepeat = true) {
    clearAbRepeatBoundarySchedule()
    const videoElement = video.value
    if (!videoElement || !abRepeatEnabled.value || !hasValidAbRepeatRange()) {
      return
    }

    const reachedEnd = videoElement.currentTime >= abRepeatEnd.value - AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS
    if (videoElement.currentTime < abRepeatStart.value - AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS || reachedEnd) {
      // Playback that reaches B at the media end has already paused, so the pause state
      // cannot tell it apart from a seek there.
      const playedToEnd = reachedEnd && !videoElement.seeking && abRepeatPlaybackPosition !== null &&
        abRepeatPlaybackPosition >= abRepeatStart.value - AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS &&
        abRepeatPlaybackPosition < abRepeatEnd.value - AB_REPEAT_BOUNDARY_TOLERANCE_SECONDS
      repeatAbRangeFromStart(countRepeat && playedToEnd)
      return
    }

    scheduleAbRepeatBoundary()
  }

  function scheduleAbRepeatBoundary() {
    clearAbRepeatBoundarySchedule()

    const videoElement = video.value
    if (
      !videoElement ||
      videoElement.paused ||
      videoElement.seeking ||
      !abRepeatEnabled.value ||
      !hasValidAbRepeatRange()
    ) {
      return
    }

    if (videoElement.currentTime < abRepeatStart.value || videoElement.currentTime >= abRepeatEnd.value) {
      repeatAbRangeFromStart()
      return
    }

    abRepeatPlaybackPosition = videoElement.currentTime
    const delay = getAbRepeatBoundaryDelay(
      videoElement.currentTime,
      abRepeatEnd.value,
      videoElement.playbackRate
    )

    abRepeatBoundaryTimeout = setTimeout(checkAbRepeatBoundary, Math.max(4, delay))
  }

  /**
   * @param {'start' | 'end'} point
   * @param {number | null} value
   * @returns {string | null}
   */
  function setAbRepeatBoundary(point, value) {
    if (disableAbRepeat.value) {
      return null
    }

    const nextStart = point === 'start' ? value : abRepeatStart.value
    const nextEnd = point === 'end' ? value : abRepeatEnd.value
    const validation = validateAbRepeatRange(nextStart, nextEnd, abRepeatDuration.value)
    if (validation !== null) {
      return validation
    }

    const hadValidRange = hasValidAbRepeatRange()
    if (point === 'start') {
      abRepeatStart.value = value
    } else {
      abRepeatEnd.value = value
    }

    const validRange = hasValidAbRepeatRange()
    if (!validRange) {
      abRepeatEnabled.value = false
    } else if (!hadValidRange) {
      abRepeatEnabled.value = true
    }
    if (validRange && video.value) {
      video.value.loop = false
    }

    refreshAbRepeatMarkers()
    scheduleAbRepeatBoundary()
    return null
  }

  /** @param {'start' | 'end'} point */
  function setCurrentAbRepeatBoundary(point) {
    const currentTime = video.value?.currentTime
    if (disableAbRepeat.value || isLive.value || !Number.isFinite(currentTime)) {
      return
    }

    const validation = setAbRepeatBoundary(point, currentTime)
    const label = point === 'start'
      ? t('Video.Player.A-B Repeat.Point A')
      : t('Video.Player.A-B Repeat.Point B')
    const message = getAbRepeatValidationMessage(validation) ||
      `${label} ${formatAbRepeatTimestamp(currentTime)}`
    showValueChange(message, AB_REPEAT_VALUE_CHANGE_ICON)
  }

  function toggleAbRepeat() {
    if (disableAbRepeat.value || !hasValidAbRepeatRange()) {
      return
    }

    abRepeatEnabled.value = !abRepeatEnabled.value
    if (abRepeatEnabled.value && video.value) {
      video.value.loop = false
    }
    refreshAbRepeatMarkers()
    scheduleAbRepeatBoundary()
  }

  function clearAbRepeat() {
    abRepeatDragCleanup?.()
    abRepeatStart.value = null
    abRepeatEnd.value = null
    abRepeatEnabled.value = false
    clearAbRepeatBoundarySchedule()
    refreshAbRepeatMarkers()
  }

  function resetAbRepeat() {
    abRepeatDuration.value = Number.POSITIVE_INFINITY
    clearAbRepeat()
  }

  function updateAbRepeatDuration() {
    abRepeatDuration.value = getAbRepeatDuration()
    if (abRepeatValidation.value !== null) {
      abRepeatEnabled.value = false
    }
    refreshAbRepeatMarkers()
    scheduleAbRepeatBoundary()
  }

  function clearAbRepeatMarkers() {
    container.value?.querySelectorAll('.abRepeatMarker, .abRepeatRange').forEach(marker => marker.remove())
  }

  function refreshAbRepeatMarkers() {
    clearAbRepeatMarkers()

    const player = getPlayer()
    const seekBarContainer = container.value?.querySelector('.shaka-seek-bar-container')
    if (
      disableAbRepeat.value ||
      !seekBarContainer ||
      !player ||
      (abRepeatStart.value === null && abRepeatEnd.value === null)
    ) {
      return
    }

    const { start, end } = player.seekRange()
    const duration = end - start
    if (!Number.isFinite(duration) || duration <= 0) {
      return
    }

    // The media duration can extend beyond the last seekable sample.
    // Keep the saved boundaries visible at the nearest timeline edge.
    const position = time => Math.min(100, Math.max(0, ((time - start) / duration) * 100))
    const markers = []
    if (hasValidAbRepeatRange()) {
      const range = document.createElement('div')
      range.className = `abRepeatRange${abRepeatEnabled.value ? '' : ' abRepeatRangeInactive'}`
      range.style.left = `${position(abRepeatStart.value)}%`
      range.style.width = `${position(abRepeatEnd.value) - position(abRepeatStart.value)}%`
      markers.push(range)
    }

    markers.push(...[
      ['A', abRepeatStart.value],
      ['B', abRepeatEnd.value],
    ]
      .filter(([_point, time]) => time !== null)
      .map(([point, time]) => {
        const marker = document.createElement('button')
        marker.type = 'button'
        marker.className = `abRepeatMarker abRepeatMarker${point}${abRepeatEnabled.value ? '' : ' abRepeatMarkerInactive'}`
        marker.style.left = `calc(${position(time)}% - 22px)`
        marker.dataset.point = point
        marker.ariaLabel = t('Video.Player.A-B Repeat.Adjust Point', {
          point,
          timestamp: formatAbRepeatTimestamp(time),
        })
        marker.addEventListener('pointerdown', event => startAbRepeatMarkerDrag(
          point === 'A' ? 'start' : 'end',
          event
        ))
        marker.addEventListener('keydown', event => handleAbRepeatMarkerKeydown(
          point === 'A' ? 'start' : 'end',
          event
        ))
        return marker
      }))

    addMarkers(markers)
  }

  onUnmounted(() => abRepeatDragCleanup?.())

  return {
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
  }
}
