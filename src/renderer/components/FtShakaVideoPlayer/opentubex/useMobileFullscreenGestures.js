import { computed, nextTick, onUnmounted, ref } from 'vue'
import { lightHaptic } from '../../../helpers/mobileHaptics.js'
import { getTwoFingerTapPoint, isTwoFingerDoubleTap, TWO_FINGER_DOUBLE_TAP_GAP } from '../../../helpers/player/twoFingerTap.js'

// A vertical swipe of this distance commits on release, even without a fling.
const MOBILE_SWIPE_COMMIT_DISTANCE = 64
// The video follows the finger up to the commit distance, then resists, approaching
// this much further travel.
const MOBILE_FULLSCREEN_SWIPE_OVERSHOOT = 60
const MOBILE_FULLSCREEN_SWIPE_MAX_OFFSET = MOBILE_SWIPE_COMMIT_DISTANCE + MOBILE_FULLSCREEN_SWIPE_OVERSHOOT
// How much the video grows toward fullscreen, or shrinks out of it, at the maximum offset.
const MOBILE_FULLSCREEN_SWIPE_MAX_SCALE = 0.05
// A tap on the mini-player bar restores the player despite this much finger drift.
const MOBILE_RESTORE_TAP_SLOP = 28
// The bar follows a downward drag to dismiss it, so once it has visibly moved
// with the finger further than this, releasing cancels the dismissal instead.
const MOBILE_DISMISS_TAP_SLOP = 16
// Matches the spring that returns a cancelled swipe in App.css.
const MOBILE_FULLSCREEN_SWIPE_SETTLE_MS = 400

// Upward swipes grow the video toward fullscreen and downward swipes shrink it.
function getMobileFullscreenSwipeScale(offset) {
  return 1 - offset / MOBILE_FULLSCREEN_SWIPE_MAX_OFFSET * MOBILE_FULLSCREEN_SWIPE_MAX_SCALE
}

export function isCapacitorMobilePlayer() {
  return document.querySelector('.app')?.classList.contains('capacitorTabs') === true
}

export function useMobileFullscreenGestures({
  getContainer,
  getControls,
  getSeekState,
  seekToTime,
  isFullscreenActive,
  isFullscreenMetadataShown,
  isFullscreenSwipeEnabled,
  isSeekSwipeEnabled,
  isPlaybackEnded,
  isPlayerSurfaceTarget,
  isScrollMiniPlayerActive,
  isShortsPlayer,
  seekOnDoubleTap,
  isTwoFingerTapEnabled = () => false,
  onTwoFingerDoubleTap = () => false,
  getSwipeAction = () => 'disabled',
  getAnimationSpeedMultiplier = () => 1,
  adjustments,
  miniPlayerDrag,
  setFullscreenMetadata,
  setShowUiOnPaused,
  showOverlayControls,
  togglePlayerFullScreen,
}) {
  const mobileFullscreenSwiping = ref(false)
  const mobileFullscreenSwipeSettling = ref(false)
  const mobileFullscreenSwipeOffset = ref(0)
  /** @type {import('vue').Ref<{ time: number } | null>} */
  const mobileSeekPreview = ref(null)
  /** @type {import('vue').Ref<number | null>} */
  const mobileMiniPlayerDismissOffset = ref(null)
  const mobileMiniPlayerDismissSettling = ref(false)
  const mobileFullscreenSwipeStyle = computed(() => {
    if (mobileMiniPlayerDismissOffset.value !== null) {
      return {
        '--mobile-mini-dismiss-offset': `${mobileMiniPlayerDismissOffset.value}px`,
        '--mobile-mini-dismiss-duration': mobileMiniPlayerDismissSettling.value ? '140ms' : '0ms',
      }
    }
    if (!mobileFullscreenSwiping.value && !mobileFullscreenSwipeSettling.value) return undefined
    const offset = mobileFullscreenSwipeOffset.value
    return {
      '--mobile-fullscreen-swipe-offset': `${offset}px`,
      '--mobile-fullscreen-swipe-scale': String(getMobileFullscreenSwipeScale(offset)),
    }
  })
  /** @type {number | null} */
  let mobileMiniPlayerDismissTimer = null
  let mobileMiniPlayerDismissSequence = 0
  /** @type {{ pointerId: number, startX: number, startY: number, startTime: number, fullscreen: boolean, restoring: boolean, returnTarget: boolean, minimizing?: boolean, dismissing?: boolean, pastCommit?: boolean, shorts: boolean, distance: number, tapDirection: number, controlsShownAtStart: boolean, fullscreenSwipeEnabled: boolean, surfaceTap: boolean, action: string, adjusting: boolean, height: number, width: number, seeking: boolean, seekState: { time: number, start: number, end: number } | null } | null} */
  let mobileFullscreenGesture = null
  /** @type {number | null} */
  let mobileFullscreenSettleTimer = null
  let mobileFullscreenSettleSequence = 0
  // A committed swipe keeps its preview until the player releases it.
  let mobileFullscreenSwipeHandoff = false

  /** @type {number | null} */
  let mobileSurfaceTapTimer = null
  /** @type {{ direction: number, time: number } | null} */
  let lastMobileSideTap = null
  /** @type {HTMLElement | null} */
  let mobileSeekFeedback = null
  /** @type {number | null} */
  let mobileSeekFeedbackTimer = null
  let mobileSeekSeconds = 0
  const doubleTapWindow = 350
  let mobilePlayerSuppressClickUntil = 0
  let mobileControlSuppressClickUntil = 0
  let mobileSurfaceSuppressTouchEndUntil = 0
  let mobileAdjustmentTouchEnd = false
  // Shaka stops its idle timer for touchmoves until a touchend restarts it
  let mobileShakaTouchMoved = false
  // A tap hid the controls, which Shaka shows again for any touchend
  let mobileSurfaceTapHidControls = false
  let mobileGestureTouchCancelled = false
  let mobileTitleSuppressClickUntil = 0
  /** @type {{ pointerId: number, startX: number, startY: number, startTime: number, blocked: boolean } | null} */
  let mobileFullscreenTitleGesture = null
  /** @type {{ x: number, y: number, time: number } | null} */
  let lastMobileFullscreenTitleTap = null

  function isFullscreenTitleTarget(target) {
    return target instanceof Element && target.closest('.playerFullscreenTitleOverlay') !== null
  }

  function isSwipeControlTarget(target) {
    return target instanceof Element && target.closest('.shaka-controls-button-panel, .shaka-play-button, .scrollMiniPlayPause, .scrollMiniPointerLayer, .mobileMiniBarReturn') !== null
  }

  // An open fullscreen dock narrows Shaka's controls to the video beside it.
  // The scroll mini player hides them, which leaves the player bounds.
  function getSurfaceBounds() {
    const bounds = getControls()?.getControlsContainer().getBoundingClientRect()
    return bounds?.width > 0 ? bounds : getContainer()?.getBoundingClientRect()
  }

  /** @returns {-1 | 0 | 1} The side of the video surface, or 0 for its center. */
  function getMobileTapDirection(clientX, bounds = getSurfaceBounds()) {
    const relativeX = bounds?.width > 0 ? (clientX - bounds.left) / bounds.width : 0.5
    return relativeX <= 0.35 ? -1 : relativeX >= 0.65 ? 1 : 0
  }

  function startMobileFullscreenGesture(event) {
    if (mobileMiniPlayerDismissSettling.value) return
    if (event.pointerType === 'touch' && !event.isPrimary) {
      cancelMobileFullscreenGesture()
      return
    }
    if (
      !isCapacitorMobilePlayer() ||
      event.pointerType !== 'touch' ||
      event.button !== 0 ||
      !event.isPrimary
    ) {
      return
    }

    mobileGestureTouchCancelled = false
    // A canceled touch never reached the touchend that clears these
    mobileShakaTouchMoved = false
    mobileSurfaceTapHidControls = false

    const previousTitleTap = lastMobileFullscreenTitleTap
    const blocksPreviousTitleTap = previousTitleTap !== null &&
      performance.now() - previousTitleTap.time < 350 &&
      Math.hypot(event.clientX - previousTitleTap.x, event.clientY - previousTitleTap.y) <= 32
    if (isFullscreenTitleTarget(event.target) || blocksPreviousTitleTap) {
      mobileFullscreenTitleGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: performance.now(),
        blocked: blocksPreviousTitleTap,
      }
      return
    }

    const surfaceTap = isPlayerSurfaceTarget(event.target) ||
      (isScrollMiniPlayerActive() && event.target === getContainer())
    if (!surfaceTap) {
      clearTimeout(mobileSurfaceTapTimer)
      mobileSurfaceTapTimer = null
      lastMobileSideTap = null
    }
    if (!surfaceTap && !isSwipeControlTarget(event.target)) return
    // A new touch supersedes a fullscreen swipe that is still settling.
    mobileFullscreenSettleSequence++
    releaseMobileFullscreenSwipe(true)
    mobileControlSuppressClickUntil = 0
    mobileSurfaceSuppressTouchEndUntil = 0
    mobileAdjustmentTouchEnd = false

    const bounds = getSurfaceBounds()
    const tapDirection = getMobileTapDirection(event.clientX, bounds)
    const side = tapDirection < 0 ? 'left' : tapDirection > 0 ? 'right' : null
    const restoring = isScrollMiniPlayerActive()
    const shorts = isShortsPlayer()
    const fullscreen = isFullscreenActive()
    // Side swipes adjust only in fullscreen, so the inline player keeps its
    // vertical swipes for entering fullscreen and docking across its width.
    const action = side && fullscreen && !restoring && !shorts ? getSwipeAction(side) : 'disabled'
    mobileFullscreenGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      surfaceTap,
      fullscreen,
      restoring,
      returnTarget: restoring && event.target instanceof Element && event.target.closest('.mobileMiniBarReturn:enabled') !== null,
      shorts,
      distance: 0,
      tapDirection,
      controlsShownAtStart: getControls()?.getControlsContainer().hasAttribute('shown') === true,
      fullscreenSwipeEnabled: !shorts && isFullscreenSwipeEnabled(),
      action: ['brightness', 'volume', 'speed'].includes(action) ? action : 'disabled',
      adjusting: false,
      height: Math.max(1, bounds?.height ?? 1),
      width: Math.max(1, bounds?.width ?? 1),
      seeking: false,
      seekState: surfaceTap && isSeekSwipeEnabled() && fullscreen && !shorts && !restoring && !getControls()?.anySettingsMenusAreOpen()
        ? getSeekState()
        : null,
    }
  }

  function moveMobileFullscreenGesture(event) {
    if (event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      const distance = Math.hypot(
        event.clientX - mobileFullscreenTitleGesture.startX,
        event.clientY - mobileFullscreenTitleGesture.startY
      )
      if (distance > 12) mobileFullscreenTitleGesture = null
      return false
    }

    if (event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    const deltaX = event.clientX - mobileFullscreenGesture.startX
    const deltaY = event.clientY - mobileFullscreenGesture.startY
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
      clearTimeout(mobileSurfaceTapTimer)
      mobileSurfaceTapTimer = null
      lastMobileSideTap = null
    }
    // Lock the direction once: horizontal seeking must not turn into a
    // volume/brightness adjustment or fullscreen exit after sideways drift.
    if (mobileFullscreenGesture.seekState && !mobileFullscreenGesture.adjusting && !mobileFullscreenSwiping.value &&
      (mobileFullscreenGesture.seeking || (Math.abs(deltaX) >= 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5))) {
      if (!mobileFullscreenGesture.seeking) {
        mobileFullscreenGesture.seeking = true
        clearMobileSeekFeedback()
        getContainer()?.setPointerCapture(event.pointerId)
      }
      const { time: startTime, start, end } = mobileFullscreenGesture.seekState
      // At most two minutes per player width keeps long videos controllable.
      const seconds = Math.round(deltaX / mobileFullscreenGesture.width * Math.min(120, end - start))
      const time = Math.max(start, Math.min(end, startTime + seconds))
      mobileSeekPreview.value = { time }
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    const dragDistance = deltaY * (mobileFullscreenGesture.restoring ? -1 : 1)
    if (!mobileFullscreenGesture.fullscreen && mobileFullscreenGesture.restoring && !mobileFullscreenGesture.minimizing &&
      (mobileFullscreenGesture.dismissing || (deltaY >= 8 && deltaY > Math.abs(deltaX) && miniPlayerDrag?.canDismiss()))) {
      if (!mobileFullscreenGesture.dismissing) {
        mobileFullscreenGesture.dismissing = true
        getContainer()?.setPointerCapture(event.pointerId)
      }
      mobileFullscreenGesture.distance = Math.max(0, deltaY)
      mobileMiniPlayerDismissOffset.value = mobileFullscreenGesture.distance
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    if (!mobileFullscreenGesture.fullscreen && !mobileFullscreenGesture.shorts && mobileFullscreenGesture.action === 'disabled' &&
      (mobileFullscreenGesture.minimizing || (dragDistance >= 8 && dragDistance > Math.abs(deltaX)))) {
      if (!mobileFullscreenGesture.minimizing) {
        if (!miniPlayerDrag?.begin(mobileFullscreenGesture.restoring, mobileFullscreenGesture.startTime)) return false
        mobileFullscreenGesture.minimizing = true
        getContainer()?.setPointerCapture(event.pointerId)
      }
      mobileFullscreenGesture.distance = Math.max(0, dragDistance)
      miniPlayerDrag.move(deltaX, mobileFullscreenGesture.restoring ? Math.min(0, deltaY) : Math.max(0, deltaY))
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    if (mobileFullscreenGesture.action !== 'disabled') {
      if (!mobileFullscreenGesture.adjusting) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 12) return false
        // Allow some sideways drift before locking a vertical swipe. A single
        // nearly diagonal sample should not discard the rest of the gesture.
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          mobileFullscreenGesture = null
          return false
        }
        if (Math.abs(deltaY) < 12) return false
        mobileFullscreenGesture.adjusting = true
        clearTimeout(mobileSurfaceTapTimer)
        mobileSurfaceTapTimer = null
        getContainer()?.setPointerCapture(event.pointerId)
        adjustments.begin(mobileFullscreenGesture.action)
      }
      adjustments.update(-deltaY / mobileFullscreenGesture.height)
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    // A bar that cannot be dismissed keeps a drifting tap until it leaves the
    // tap tolerance, so its release can still restore the player.
    if (mobileFullscreenGesture.returnTarget) {
      if (Math.hypot(deltaX, deltaY) >= MOBILE_RESTORE_TAP_SLOP) mobileFullscreenGesture = null
      return false
    }
    if (!mobileFullscreenGesture.fullscreenSwipeEnabled) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
        mobileFullscreenGesture = null
      }
      return false
    }
    const directionalDistance = mobileFullscreenGesture.fullscreen ? deltaY : -deltaY
    if (!mobileFullscreenSwiping.value) {
      if (Math.abs(deltaX) > Math.abs(deltaY) || directionalDistance <= 0) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 12) {
          mobileFullscreenGesture = null
        }
        return false
      }
      if (directionalDistance < 8) return false

      mobileFullscreenSwiping.value = true
      getContainer()?.setPointerCapture(event.pointerId)
    }

    mobileFullscreenGesture.distance = directionalDistance
    const pastCommit = directionalDistance >= MOBILE_SWIPE_COMMIT_DISTANCE
    if (pastCommit !== Boolean(mobileFullscreenGesture.pastCommit)) {
      // Tick whenever releasing would start, or no longer start, the toggle.
      mobileFullscreenGesture.pastCommit = pastCommit
      lightHaptic()
    }
    // Track the finger up to the commit distance, then resist without a hard stop.
    // Moving back past the start returns the video to rest instead of reversing it.
    const distance = Math.max(0, directionalDistance)
    const overshoot = Math.max(0, distance - MOBILE_SWIPE_COMMIT_DISTANCE)
    const offset = Math.min(distance, MOBILE_SWIPE_COMMIT_DISTANCE) +
      MOBILE_FULLSCREEN_SWIPE_OVERSHOOT * overshoot / (MOBILE_FULLSCREEN_SWIPE_OVERSHOOT + overshoot)
    mobileFullscreenSwipeOffset.value = (mobileFullscreenGesture.fullscreen ? 1 : -1) * offset
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  function finishMobileFullscreenGesture(event) {
    if (event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      const gesture = mobileFullscreenTitleGesture
      mobileFullscreenTitleGesture = null
      const elapsed = performance.now() - gesture.startTime
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      )
      if (elapsed > 450 || distance > 12) return false

      event.preventDefault()
      event.stopImmediatePropagation()
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      mobileTitleSuppressClickUntil = performance.now() + 350
      if (gesture.blocked) {
        lastMobileFullscreenTitleTap = null
        return true
      }

      lastMobileFullscreenTitleTap = {
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      }
      setFullscreenMetadata(!isFullscreenMetadataShown())
      // A side tap's hide can fire during this touch. The controls show again,
      // so its touchend has to restart Shaka's idle timer.
      mobileSurfaceTapHidControls = false
      showOverlayControls()
      return true
    }

    if (event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    const gesture = mobileFullscreenGesture
    mobileFullscreenGesture = null
    if (gesture.seeking) {
      const preview = mobileSeekPreview.value
      mobileSeekPreview.value = null
      const container = getContainer()
      if (container?.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      mobileControlSuppressClickUntil = performance.now() + 350
      event.preventDefault()
      event.stopImmediatePropagation()
      if (preview && isFullscreenActive() && isSeekSwipeEnabled()) seekToTime(preview.time)
      return true
    }
    // Event times keep a busy main thread from slowing a measured fling.
    const elapsed = Math.max(1, event.timeStamp - gesture.startTime)
    // A mini-player drag whose whole path is shorter, such as in a short
    // landscape window at a larger UI Scale, commits past its halfway point.
    const commitDistance = gesture.minimizing
      ? Math.min(MOBILE_SWIPE_COMMIT_DISTANCE, miniPlayerDrag.distance() / 2)
      : MOBILE_SWIPE_COMMIT_DISTANCE
    // A short swipe still commits when it is flung.
    const swipeCommitted = gesture.distance >= commitDistance || (gesture.distance >= 28 && gesture.distance / elapsed >= 0.55)
    // Restore taps on the bar here rather than through its click. A finger that
    // drifts a few pixels starts a drag, and a tap that stops a page fling
    // reaches the bar without Chromium dispatching a click at all.
    const restoreTap = gesture.returnTarget && !swipeCommitted && elapsed <= 450 &&
      Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <
        (gesture.dismissing ? MOBILE_DISMISS_TAP_SLOP : MOBILE_RESTORE_TAP_SLOP)
    if (restoreTap) suppressNextClick()
    if (gesture.minimizing || gesture.dismissing) {
      const container = getContainer()
      if (container?.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      mobileControlSuppressClickUntil = performance.now() + 350
      event.preventDefault()
      event.stopImmediatePropagation()
      if (restoreTap) {
        clearMobileMiniPlayerDismiss()
        miniPlayerDrag.restore()
      } else if (gesture.dismissing) {
        settleMobileMiniPlayerDismiss(swipeCommitted, gesture.height)
      } else {
        miniPlayerDrag.finish(swipeCommitted)
      }
      return true
    }
    if (restoreTap) {
      event.preventDefault()
      event.stopImmediatePropagation()
      miniPlayerDrag.restore()
      return true
    }
    if (gesture.restoring) return false
    if (gesture.adjusting) {
      adjustments.finish()
      const container = getContainer()
      if (container?.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      mobileAdjustmentTouchEnd = true
      mobileControlSuppressClickUntil = performance.now() + 350
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    if (!mobileFullscreenSwiping.value) {
      if (!gesture.surfaceTap) return false
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      )
      if (elapsed > 450 || distance > 12) return false

      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      event.preventDefault()
      event.stopImmediatePropagation()
      queueMobilePlayerSurfaceTap(!gesture.controlsShownAtStart, gesture.tapDirection)
      return true
    }

    const container = getContainer()
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
    mobilePlayerSuppressClickUntil = performance.now() + 350
    mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
    mobileControlSuppressClickUntil = performance.now() + 350

    // The commit tick already confirmed a swipe released past the commit distance.
    settleMobileFullscreenGesture(swipeCommitted, gesture.fullscreen, !gesture.pastCommit)
    return true
  }

  // The tap's click may still follow and would land on the restored Watch page.
  // A new touch means it never came, so that touch's click is left alone.
  function suppressNextClick() {
    const remove = () => {
      clearTimeout(timer)
      window.removeEventListener('click', block, true)
      window.removeEventListener('pointerdown', remove, true)
    }
    const block = event => {
      remove()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const timer = window.setTimeout(remove, 350)
    window.addEventListener('click', block, true)
    window.addEventListener('pointerdown', remove, true)
  }

  function settleMobileFullscreenGesture(shouldToggle, wasFullscreen, haptic = true) {
    const sequence = ++mobileFullscreenSettleSequence
    clearTimeout(mobileFullscreenSettleTimer)
    mobileFullscreenSettleTimer = null
    mobileFullscreenSwiping.value = false
    mobileFullscreenSwipeSettling.value = true
    mobileFullscreenSwipeHandoff = false
    if (!shouldToggle) {
      springBackMobileFullscreenSwipe()
      return
    }
    if (isFullscreenActive() !== wasFullscreen) {
      releaseMobileFullscreenSwipe(true)
      return
    }
    // A committed swipe hands its preview to the fullscreen transition instead
    // of returning first. The player releases it once the next presentation
    // covers it: on Android, the rotation frame or the retained exit surface.
    mobileFullscreenSwipeHandoff = true
    ;(async () => {
      try {
        await togglePlayerFullScreen()
        if (sequence !== mobileFullscreenSettleSequence) return
        if (isFullscreenActive() === wasFullscreen) {
          springBackMobileFullscreenSwipe()
          return
        }
        // Restart Shaka's touchmove-stopped idle timer with the fullscreen
        // delay, without invoking the surface-tap handler on its child.
        getContainer()?.dispatchEvent(new Event('touchend'))
        if (haptic) lightHaptic()
      } catch (error) {
        console.warn('Fullscreen gesture failed', error)
        if (sequence === mobileFullscreenSettleSequence) springBackMobileFullscreenSwipe()
      }
    })()
  }

  function springBackMobileFullscreenSwipe() {
    mobileFullscreenSwipeHandoff = false
    mobileFullscreenSwipeOffset.value = 0
    const settleDuration = document.documentElement.dataset.reducedMotion === 'reduce'
      ? 0
      : MOBILE_FULLSCREEN_SWIPE_SETTLE_MS / getAnimationSpeedMultiplier()
    mobileFullscreenSettleTimer = window.setTimeout(() => {
      mobileFullscreenSettleTimer = null
      mobileFullscreenSwipeSettling.value = false
    }, settleDuration)
  }

  /**
   * Removes a committed swipe's preview without animating it back.
   * @param {boolean} [force] also remove a preview that was not handed off
   * @returns {{ offset: number, scale: number } | null} the handed-off preview, if any
   */
  function releaseMobileFullscreenSwipe(force = false) {
    const offset = mobileFullscreenSwipeOffset.value
    const preview = mobileFullscreenSwipeHandoff ? { offset, scale: getMobileFullscreenSwipeScale(offset) } : null
    if (!force && !preview) return null
    mobileFullscreenSwipeHandoff = false
    clearTimeout(mobileFullscreenSettleTimer)
    mobileFullscreenSettleTimer = null
    mobileFullscreenSwipeSettling.value = false
    mobileFullscreenSwipeOffset.value = 0
    return preview
  }

  function clearMobileMiniPlayerDismiss() {
    mobileMiniPlayerDismissSequence++
    clearTimeout(mobileMiniPlayerDismissTimer)
    mobileMiniPlayerDismissTimer = null
    mobileMiniPlayerDismissOffset.value = null
    mobileMiniPlayerDismissSettling.value = false
  }

  function dismissMobileMiniPlayer() {
    if (mobileMiniPlayerDismissSettling.value || !isScrollMiniPlayerActive() || !miniPlayerDrag?.canDismiss()) return
    const container = getContainer()
    if (!container) return
    settleMobileMiniPlayerDismiss(true, container.getBoundingClientRect().height)
  }

  function settleMobileMiniPlayerDismiss(commit, height) {
    const sequence = ++mobileMiniPlayerDismissSequence
    mobileMiniPlayerDismissSettling.value = true
    mobileMiniPlayerDismissOffset.value = commit ? height + 96 : 0
    const duration = miniPlayerDrag.dismissDuration?.() ??
      (document.documentElement.dataset.reducedMotion === 'reduce' ? 0 : 140)
    nextTick(() => {
      if (sequence !== mobileMiniPlayerDismissSequence) return
      // Start the timeout after Vue applies the transform and the browser
      // starts its transition, including a close-button dismissal from rest.
      getContainer()?.getBoundingClientRect()
      mobileMiniPlayerDismissTimer = window.setTimeout(() => {
        clearMobileMiniPlayerDismiss()
        if (commit && isScrollMiniPlayerActive() && miniPlayerDrag.canDismiss()) miniPlayerDrag.dismiss()
      }, duration)
    })
  }

  function cancelMobileFullscreenGesture(event) {
    if (!event || event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      mobileFullscreenTitleGesture = null
    }
    if (event && event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    mobileFullscreenSettleSequence++
    releaseMobileFullscreenSwipe(true)

    clearMobileMiniPlayerDismiss()

    clearTimeout(mobileSurfaceTapTimer)
    mobileSurfaceTapTimer = null
    lastMobileSideTap = null
    const wasActive = mobileFullscreenGesture !== null || mobileFullscreenSwiping.value
    if (mobileFullscreenGesture?.minimizing) miniPlayerDrag.finish(false)
    if (mobileFullscreenGesture?.adjusting || mobileFullscreenGesture?.dismissing || mobileFullscreenGesture?.seeking) {
      if (mobileFullscreenGesture.seeking || mobileFullscreenGesture.adjusting) mobileGestureTouchCancelled = true
      if (mobileFullscreenGesture.adjusting) {
        adjustments.cancel()
        mobileAdjustmentTouchEnd = true
      }
      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
      mobileControlSuppressClickUntil = performance.now() + 350
    }
    const container = getContainer()
    const pointerId = mobileFullscreenGesture?.pointerId
    if (pointerId !== undefined && container?.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId)
    mobileFullscreenGesture = null
    mobileSeekPreview.value = null
    if (mobileFullscreenSwiping.value) settleMobileFullscreenGesture(false, false)
    return wasActive
  }

  function applyMobilePlayerSurfaceTap(showControls) {
    const controls = getControls()
    const controlsContainer = controls?.getControlsContainer()
    if (!controls || !controlsContainer) return

    if (showControls || isPlaybackEnded()) {
      setShowUiOnPaused(true)
      controls.showUI()
    } else {
      setShowUiOnPaused(false)
      const config = controls.getConfig()
      const fadeDelay = config.fadeDelay
      config.fadeDelay = 0
      controls.hideUI()
      config.fadeDelay = fadeDelay
      mobileSurfaceTapHidControls = true
    }
  }

  function queueMobilePlayerSurfaceTap(showControls, direction) {
    const controls = getControls()
    clearTimeout(mobileSurfaceTapTimer)
    mobileSurfaceTapTimer = null
    if (controls?.anySettingsMenusAreOpen()) {
      lastMobileSideTap = null
      controls.hideSettingsMenus()
      return
    }

    const seekDistance = controls?.getConfig().tapSeekDistance ?? 0
    if (!direction || seekDistance <= 0) {
      lastMobileSideTap = null
      applyMobilePlayerSurfaceTap(showControls)
      return
    }

    // Own both taps: Shaka requires visible controls before it starts counting
    // side taps, which otherwise consumes the first tap just to show the UI.
    const now = performance.now()
    const doubleTap = lastMobileSideTap?.direction === direction &&
      now - lastMobileSideTap.time <= doubleTapWindow
    lastMobileSideTap = { direction, time: now }
    if (doubleTap) {
      const seconds = seekOnDoubleTap(direction * seekDistance)
      if (seconds) lightHaptic()
      showMobileSeekFeedback(seconds)
      return
    }

    mobileSurfaceTapTimer = window.setTimeout(() => {
      mobileSurfaceTapTimer = null
      lastMobileSideTap = null
      applyMobilePlayerSurfaceTap(showControls)
    }, doubleTapWindow)
  }

  function clearMobileSeekFeedback() {
    clearTimeout(mobileSeekFeedbackTimer)
    mobileSeekFeedbackTimer = null
    if (mobileSeekFeedback) {
      mobileSeekFeedback.style.opacity = '0'
      const label = mobileSeekFeedback.querySelector('span')
      if (label) label.textContent = '0s'
    }
    mobileSeekFeedback = null
    mobileSeekSeconds = 0
  }

  function showMobileSeekFeedback(seconds) {
    if (!seconds) return
    const feedback = getContainer()?.querySelector(seconds < 0 ? '.shaka-rewind-container' : '.shaka-fast-forward-container')
    if (!(feedback instanceof HTMLElement)) return
    if (mobileSeekFeedback !== feedback) clearMobileSeekFeedback()
    clearTimeout(mobileSeekFeedbackTimer)
    mobileSeekFeedback = feedback
    mobileSeekSeconds += seconds
    const label = feedback.querySelector('span')
    if (label) label.textContent = `${+mobileSeekSeconds.toFixed(2)}s`
    feedback.style.opacity = '1'
    mobileSeekFeedbackTimer = window.setTimeout(clearMobileSeekFeedback, 500)
  }

  // Shaka reveals its controls for any touch movement over the player. A side
  // swipe adjustment shows only its own indicator instead.
  function handleMobilePlayerTouchMove(event) {
    if (!mobileFullscreenGesture || mobileFullscreenGesture.action === 'disabled' || mobileFullscreenGesture.seeking) {
      // This movement stops Shaka's idle timer, so its touch end must restart it.
      mobileAdjustmentTouchEnd = false
      mobileShakaTouchMoved = true
      return
    }
    event.stopImmediatePropagation()
  }

  function handleMobilePlayerTouchEnd(event) {
    // Shaka gets this touchend, or the synthetic one below unless it never saw the touch move
    mobileShakaTouchMoved = false
    // Compare the input time so a busy main thread cannot let the touchend of
    // an already handled tap reach Shaka's own surface toggle.
    if (
      !isCapacitorMobilePlayer() ||
      (!mobileGestureTouchCancelled && event.timeStamp >= mobileSurfaceSuppressTouchEndUntil)
    ) {
      return
    }

    mobileSurfaceSuppressTouchEndUntil = 0
    const adjustmentTouchEnd = mobileAdjustmentTouchEnd
    const hidControls = mobileSurfaceTapHidControls
    mobileSurfaceTapHidControls = false
    if (mobileGestureTouchCancelled) {
      mobileGestureTouchCancelled = event.touches?.length > 0
      mobilePlayerSuppressClickUntil = performance.now() + 350
      mobileControlSuppressClickUntil = performance.now() + 350
    }
    // Fingers that remain after a canceled adjustment still end it.
    mobileAdjustmentTouchEnd = adjustmentTouchEnd && mobileGestureTouchCancelled
    event.preventDefault()
    event.stopImmediatePropagation()
    // An adjustment never let Shaka see its touchmoves, so the idle timer is
    // still running and notifying Shaka would reveal the controls. Hidden
    // controls need no idle timer, and Shaka would cancel their fade.
    if (adjustmentTouchEnd || hidControls) return
    // Shaka's surface-tap handler is on the child controls container. Notify
    // only the player container so its touchmove-stopped idle timer resumes.
    getContainer()?.dispatchEvent(new Event('touchend'))
  }

  // For a touchend that the player stops before this composable handles it,
  // such as after a canceled playback speed hold.
  function handleStoppedPlayerTouchEnd() {
    const moved = mobileShakaTouchMoved
    mobileShakaTouchMoved = false
    // The gesture suppressed this touchend, not the synthetic one
    mobileSurfaceSuppressTouchEndUntil = 0
    // Without a touchend after its touchmoves, Shaka keeps the controls shown
    if (moved) getContainer()?.dispatchEvent(new Event('touchend'))
  }

  function handleMobilePlayerSurfaceClick(event) {
    if (isCapacitorMobilePlayer() && isSwipeControlTarget(event.target) && performance.now() < mobileControlSuppressClickUntil) {
      mobileControlSuppressClickUntil = 0
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    }
    if (!isCapacitorMobilePlayer() || !isPlayerSurfaceTarget(event.target)) return false

    event.preventDefault()
    event.stopPropagation()
    if (performance.now() < mobilePlayerSuppressClickUntil) {
      mobilePlayerSuppressClickUntil = 0
      return true
    }
    mobilePlayerSuppressClickUntil = 0
    const controlsContainer = getControls()?.getControlsContainer()
    queueMobilePlayerSurfaceTap(controlsContainer?.hasAttribute('shown') !== true, getMobileTapDirection(event.clientX))
    return true
  }

  function consumeMobileTitleClickSuppression() {
    if (!isCapacitorMobilePlayer() || performance.now() >= mobileTitleSuppressClickUntil) {
      return false
    }

    mobileTitleSuppressClickUntil = 0
    return true
  }

  // #region two-finger taps

  /** @type {{ touches: Map<number, { startX: number, startY: number, maxDistance: number, lifted: boolean }>, startTime: number, valid: boolean, controlsShownAtStart: boolean } | null} */
  let mobileTwoFingerTap = null
  /** @type {{ direction: number, endTime: number } | null} */
  let lastMobileTwoFingerTap = null
  /** @type {number | null} */
  let mobileTwoFingerTapTimer = null

  // Whether the fingers on the player could still become a two-finger tap.
  function isMobileTwoFingerTapCandidate() {
    return mobileTwoFingerTap?.valid === true && mobileTwoFingerTap.touches.size === 2
  }

  function clearMobileTwoFingerTaps() {
    clearTimeout(mobileTwoFingerTapTimer)
    mobileTwoFingerTapTimer = null
    mobileTwoFingerTap = null
    lastMobileTwoFingerTap = null
  }

  // A pinch that starts zooming is never a tap.
  function invalidateMobileTwoFingerTap() {
    if (mobileTwoFingerTap) mobileTwoFingerTap.valid = false
  }

  /**
   * Follows every touch on the player, alongside the other gestures, to find
   * two-finger double taps on either side. Fingers that move past the tap
   * slop, as in a pinch, or a third finger never count.
   * @param {PointerEvent} event
   */
  function trackMobileTwoFingerTap(event) {
    if (event.pointerType !== 'touch') return
    if (event.type === 'pointerdown') {
      if (event.isPrimary) {
        clearTimeout(mobileTwoFingerTapTimer)
        mobileTwoFingerTapTimer = null
        if (!isCapacitorMobilePlayer() || isScrollMiniPlayerActive() || isShortsPlayer() || !isTwoFingerTapEnabled()) {
          clearMobileTwoFingerTaps()
          return
        }
        mobileTwoFingerTap = {
          touches: new Map(),
          startTime: event.timeStamp,
          valid: true,
          controlsShownAtStart: getControls()?.getControlsContainer().hasAttribute('shown') === true,
        }
      }
      if (!mobileTwoFingerTap) return
      if (mobileTwoFingerTap.touches.size >= 2 || !isPlayerSurfaceTarget(event.target)) {
        mobileTwoFingerTap.valid = false
      }
      mobileTwoFingerTap.touches.set(event.pointerId, { startX: event.clientX, startY: event.clientY, maxDistance: 0, lifted: false })
      return
    }

    const tap = mobileTwoFingerTap
    const touch = tap?.touches.get(event.pointerId)
    if (!touch || touch.lifted) return
    if (event.type === 'pointercancel') {
      clearMobileTwoFingerTaps()
      return
    }
    touch.maxDistance = Math.max(touch.maxDistance, Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY))
    if (event.type !== 'pointerup') return

    touch.lifted = true
    const touches = [...tap.touches.values()]
    const point = tap.valid ? getTwoFingerTapPoint(touches, event.timeStamp - tap.startTime) : null
    // Shaka would toggle its controls for the touchend of each finger.
    if (point) mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
    if (touches.some(({ lifted }) => !lifted)) return

    mobileTwoFingerTap = null
    if (!point) {
      lastMobileTwoFingerTap = null
      return
    }
    const controls = getControls()
    if (controls?.anySettingsMenusAreOpen()) {
      lastMobileTwoFingerTap = null
      controls.hideSettingsMenus()
      return
    }
    const direction = getMobileTapDirection(point.x)
    if (isTwoFingerDoubleTap(lastMobileTwoFingerTap, { direction, startTime: tap.startTime })) {
      lastMobileTwoFingerTap = null
      if (onTwoFingerDoubleTap(direction)) lightHaptic()
      return
    }
    // A lone two-finger tap toggles the controls like a one-finger tap.
    if (!direction) {
      lastMobileTwoFingerTap = null
      applyMobilePlayerSurfaceTap(!tap.controlsShownAtStart)
      return
    }
    // Pair taps by their input times only: a busy main thread can run this
    // timer before it handles a second tap that came in time.
    lastMobileTwoFingerTap = { direction, endTime: event.timeStamp }
    mobileTwoFingerTapTimer = window.setTimeout(() => {
      mobileTwoFingerTapTimer = null
      applyMobilePlayerSurfaceTap(!tap.controlsShownAtStart)
    }, TWO_FINGER_DOUBLE_TAP_GAP)
  }

  // #endregion two-finger taps

  onUnmounted(() => {
    clearMobileTwoFingerTaps()
    mobileFullscreenSettleSequence++
    clearMobileMiniPlayerDismiss()
    clearMobileSeekFeedback()
    miniPlayerDrag?.cancel()
    adjustments?.cancel()
    clearTimeout(mobileFullscreenSettleTimer)
    clearTimeout(mobileSurfaceTapTimer)
    mobileFullscreenGesture = null
    mobileSeekPreview.value = null
    mobilePlayerSuppressClickUntil = 0
    mobileSurfaceSuppressTouchEndUntil = 0
    mobileAdjustmentTouchEnd = false
    mobileShakaTouchMoved = false
    mobileSurfaceTapHidControls = false
    mobileTitleSuppressClickUntil = 0
    mobileFullscreenTitleGesture = null
    lastMobileFullscreenTitleTap = null
  })

  return {
    cancelMobileFullscreenGesture,
    consumeMobileTitleClickSuppression,
    dismissMobileMiniPlayer,
    finishMobileFullscreenGesture,
    getMobileTapDirection,
    handleMobilePlayerSurfaceClick,
    handleMobilePlayerTouchEnd,
    handleMobilePlayerTouchMove,
    handleStoppedPlayerTouchEnd,
    invalidateMobileTwoFingerTap,
    isMobileTwoFingerTapCandidate,
    mobileFullscreenSwipeSettling,
    mobileFullscreenSwipeStyle,
    mobileFullscreenSwiping,
    mobileMiniPlayerDismissSettling,
    mobileSeekPreview,
    moveMobileFullscreenGesture,
    releaseMobileFullscreenSwipe,
    startMobileFullscreenGesture,
    trackMobileTwoFingerTap,
  }
}
