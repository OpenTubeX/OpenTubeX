import { computed, onUnmounted, ref } from 'vue'

export function isCapacitorMobilePlayer() {
  return document.querySelector('.app')?.classList.contains('capacitorTabs') === true
}

export function useMobileFullscreenGestures({
  getContainer,
  getControls,
  isFullscreenActive,
  isFullscreenMetadataShown,
  isFullscreenSwipeEnabled,
  isPlaybackEnded,
  isPlaybackPaused,
  isPlayerSurfaceTarget,
  isScrollMiniPlayerActive,
  setFullscreenMetadata,
  setShowUiOnPaused,
  showOverlayControls,
  togglePlayerFullScreen,
}) {
  const mobileFullscreenSwiping = ref(false)
  const mobileFullscreenSwipeSettling = ref(false)
  const mobileFullscreenSwipeOffset = ref(0)
  const mobileFullscreenSwipeStyle = computed(() => (
    mobileFullscreenSwiping.value || mobileFullscreenSwipeSettling.value
      ? { '--mobile-fullscreen-swipe-offset': `${mobileFullscreenSwipeOffset.value}px` }
      : undefined
  ))
  /** @type {{ pointerId: number, startX: number, startY: number, startTime: number, fullscreen: boolean, distance: number, sideDoubleTap: boolean, controlsShownAtStart: boolean, fullscreenSwipeEnabled: boolean } | null} */
  let mobileFullscreenGesture = null
  /** @type {number | null} */
  let mobileFullscreenSettleTimer = null
  /** @type {number | null} */
  let mobileSurfaceTapTimer = null
  let mobilePlayerSuppressClickUntil = 0
  let mobileSurfaceSuppressTouchEndUntil = 0
  let mobileTitleSuppressClickUntil = 0
  /** @type {{ pointerId: number, startX: number, startY: number, startTime: number, blocked: boolean } | null} */
  let mobileFullscreenTitleGesture = null
  /** @type {{ x: number, y: number, time: number } | null} */
  let lastMobileFullscreenTitleTap = null

  function isFullscreenTitleTarget(target) {
    return target instanceof Element && target.closest('.playerFullscreenTitleOverlay') !== null
  }

  function startMobileFullscreenGesture(event) {
    if (
      !isCapacitorMobilePlayer() ||
      event.pointerType !== 'touch' ||
      event.button !== 0 ||
      !event.isPrimary ||
      isScrollMiniPlayerActive()
    ) {
      return
    }

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

    if (!isPlayerSurfaceTarget(event.target)) return

    const bounds = getContainer()?.getBoundingClientRect()
    const relativeX = bounds?.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5
    mobileFullscreenGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      fullscreen: isFullscreenActive(),
      distance: 0,
      sideDoubleTap: relativeX <= 0.35 || relativeX >= 0.65,
      controlsShownAtStart: getControls()?.getControlsContainer().hasAttribute('shown') === true,
      fullscreenSwipeEnabled: isFullscreenSwipeEnabled(),
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
    mobileFullscreenSwipeOffset.value = (mobileFullscreenGesture.fullscreen ? 1 : -1) *
      Math.min(96, directionalDistance * 0.65)
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
      showOverlayControls()
      return true
    }

    if (event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    const gesture = mobileFullscreenGesture
    mobileFullscreenGesture = null
    if (!mobileFullscreenSwiping.value) {
      const elapsed = performance.now() - gesture.startTime
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      )
      if (elapsed > 450 || distance > 12) return false

      mobilePlayerSuppressClickUntil = performance.now() + 350
      const waitForDoubleTap = gesture.sideDoubleTap && !isPlaybackPaused()
      if (!waitForDoubleTap) {
        mobileSurfaceSuppressTouchEndUntil = performance.now() + 350
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      queueMobilePlayerSurfaceTap(!gesture.controlsShownAtStart, waitForDoubleTap)
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

    const elapsed = Math.max(1, performance.now() - gesture.startTime)
    const shouldToggle = gesture.distance >= 64 ||
      (gesture.distance >= 28 && gesture.distance / elapsed >= 0.55)
    settleMobileFullscreenGesture(shouldToggle, gesture.fullscreen)
    return true
  }

  function settleMobileFullscreenGesture(shouldToggle, wasFullscreen) {
    clearTimeout(mobileFullscreenSettleTimer)
    mobileFullscreenSwiping.value = false
    mobileFullscreenSwipeSettling.value = true
    mobileFullscreenSwipeOffset.value = shouldToggle ? (wasFullscreen ? 96 : -96) : 0

    const settleDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140
    mobileFullscreenSettleTimer = window.setTimeout(() => {
      mobileFullscreenSettleTimer = null
      mobileFullscreenSwipeOffset.value = 0
      mobileFullscreenSwipeSettling.value = false
      if (shouldToggle) togglePlayerFullScreen()
    }, settleDuration)
  }

  function cancelMobileFullscreenGesture(event) {
    if (!event || event.pointerId === mobileFullscreenTitleGesture?.pointerId) {
      mobileFullscreenTitleGesture = null
    }
    if (event && event.pointerId !== mobileFullscreenGesture?.pointerId) return false

    const wasActive = mobileFullscreenGesture !== null || mobileFullscreenSwiping.value
    mobileFullscreenGesture = null
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
    }
  }

  function queueMobilePlayerSurfaceTap(showControls, waitForDoubleTap) {
    if (!waitForDoubleTap) {
      applyMobilePlayerSurfaceTap(showControls)
      return
    }

    if (mobileSurfaceTapTimer !== null) {
      clearTimeout(mobileSurfaceTapTimer)
      mobileSurfaceTapTimer = null
      return
    }

    mobileSurfaceTapTimer = window.setTimeout(() => {
      mobileSurfaceTapTimer = null
      applyMobilePlayerSurfaceTap(showControls)
    }, 240)
  }

  function handleMobilePlayerTouchEnd(event) {
    if (
      !isCapacitorMobilePlayer() ||
      performance.now() >= mobileSurfaceSuppressTouchEndUntil
    ) {
      return
    }

    mobileSurfaceSuppressTouchEndUntil = 0
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function handleMobilePlayerSurfaceClick(event) {
    if (!isCapacitorMobilePlayer() || !isPlayerSurfaceTarget(event.target)) return false

    event.preventDefault()
    event.stopPropagation()
    if (performance.now() < mobilePlayerSuppressClickUntil) {
      mobilePlayerSuppressClickUntil = 0
      return true
    }
    mobilePlayerSuppressClickUntil = 0
    if (event.detail >= 2) {
      clearTimeout(mobileSurfaceTapTimer)
      mobileSurfaceTapTimer = null
      return true
    }

    const controlsContainer = getControls()?.getControlsContainer()
    const bounds = getContainer()?.getBoundingClientRect()
    const relativeX = bounds?.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5
    const waitForDoubleTap = !isPlaybackPaused() && (relativeX <= 0.35 || relativeX >= 0.65)
    queueMobilePlayerSurfaceTap(controlsContainer?.hasAttribute('shown') !== true, waitForDoubleTap)
    return true
  }

  function consumeMobileTitleClickSuppression() {
    if (!isCapacitorMobilePlayer() || performance.now() >= mobileTitleSuppressClickUntil) {
      return false
    }

    mobileTitleSuppressClickUntil = 0
    return true
  }

  onUnmounted(() => {
    clearTimeout(mobileFullscreenSettleTimer)
    clearTimeout(mobileSurfaceTapTimer)
    mobileFullscreenGesture = null
    mobilePlayerSuppressClickUntil = 0
    mobileSurfaceSuppressTouchEndUntil = 0
    mobileTitleSuppressClickUntil = 0
    mobileFullscreenTitleGesture = null
    lastMobileFullscreenTitleTap = null
  })

  return {
    cancelMobileFullscreenGesture,
    consumeMobileTitleClickSuppression,
    finishMobileFullscreenGesture,
    handleMobilePlayerSurfaceClick,
    handleMobilePlayerTouchEnd,
    mobileFullscreenSwipeSettling,
    mobileFullscreenSwipeStyle,
    mobileFullscreenSwiping,
    moveMobileFullscreenGesture,
    startMobileFullscreenGesture,
  }
}
