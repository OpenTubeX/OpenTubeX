import { computed, nextTick, ref, watch } from 'vue'

import store from '../../../store/index'
import { applyAnimationSpeed } from '../../../helpers/animationSpeed'
import {
  hasCrossTabMiniPlayerOwner,
  isCrossTabMiniPlayerOwner,
  markCrossTabMiniPlayerActive,
  markCrossTabMiniPlayerInactive,
  refreshCrossTabMiniPlayer,
  releaseCrossTabMiniPlayerOwnership,
  unregisterCrossTabMiniPlayer,
} from '../../../helpers/crossTabMiniPlayer'
import { isReducedMotionEnabled } from '../../../helpers/reducedMotion'
import {
  animateScrollMiniPlayerBounce,
  clampScrollMiniPlayerRect,
  DEFAULT_ASPECT_RATIO,
  getAnchorVisibleRatio,
  getDefaultScrollMiniPlayerRect,
  getResizeHandleCorner,
  getSavedScrollMiniPlayerRect,
  getViewportInsets,
  getScrollMiniInlineLayoutHeight,
  getScrollMiniVerticalAnchor,
  parseScrollMiniPlayerSavedRect,
  pickScrollMiniVerticalAnchor,
  reanchorScrollMiniPlayerRect,
  resizeScrollMiniPlayerFromCorner,
  resolveScrollMiniDragHandleOnLightBg,
  sampleScrollMiniDragHandleLuminance,
  sampleScrollMiniHandleLuminance,
  scrollMiniPlayerRectToStyle,
  serializeScrollMiniPlayerSavedRect,
  setSavedScrollMiniPlayerRect,
  shouldBounceScrollMiniPlayerToEdge,
  snapScrollMiniPlayerToEdge,
  updateScrollMiniPlayerVolumeBarFill,
  ENTER_MINI_RATIO,
  EXIT_MINI_RATIO,
  SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT,
} from '../../../helpers/scrollMiniPlayer'

const SCROLL_MINI_PLAY_PAUSE_HIDE_MS = 3000
const SCROLL_MINI_VOLUME_HIDE_MS = 1000
const SCROLL_MINI_DRAG_HANDLE_CONTRAST_MS = 400
const SCROLL_MINI_POINTER_REVEAL_SUPPRESS_MS = 250
const SCROLL_MINI_POINTER_REVEAL_MIN_DISTANCE = 8
const SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS = 300

/**
 * OpenTubeX's scroll mini-player integration. Keeping this composable outside the
 * upstream-derived player limits FreeTube merge conflicts to the call site.
 *
 * @param {{
 *   container: import('vue').Ref<HTMLDivElement | null>,
 *   fullWindowEnabled: import('vue').Ref<boolean>,
 *   getUi: () => import('shaka-player').ui.Overlay | null,
 *   isActiveTab: import('vue').ComputedRef<boolean>,
 *   pictureInPictureActive: import('vue').Ref<boolean>,
 *   props: { format: string, videoId: string },
 *   tabId?: string | null,
 *   video: import('vue').Ref<HTMLVideoElement | null>
 * }} options
 */
export function useScrollMiniPlayer({ container, fullWindowEnabled, getUi, isActiveTab, pictureInPictureActive, props, tabId = null, video }) {
  const scrollMiniVideoAspectRatio = ref(DEFAULT_ASPECT_RATIO)
  const scrollMiniPlayerEnabled = computed(() => store.getters.getScrollMiniPlayerEnabled)
  const scrollMiniPlayerOnAllTabs = computed(() => store.getters.getScrollMiniPlayerOnAllTabs)
  const autoPictureInPictureOnTabChange = computed(
    () => store.getters.getAutoPictureInPictureTriggers.includes('tab')
  )
  const scrollMiniPlayerActive = ref(false)
  const scrollMiniPlayerAnimating = ref(false)
  const scrollMiniPlaceholderHeight = ref(0)
  /** @type {import('vue').Ref<import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect>} */
  const scrollMiniPlayerRect = ref(getDefaultScrollMiniPlayerRect())
  const scrollMiniIsPaused = ref(true)
  const scrollMiniVolume = ref(1)
  const scrollMiniPlayPauseVisible = ref(true)
  const scrollMiniVolumeExpanded = ref(false)
  const scrollMiniDragHandleOnLightBg = ref(false)
  const scrollMiniResizeHandleOnLightBg = ref(false)
  const scrollMiniResizeCorner = ref('bottom-right')
  const scrollMiniAnchor = ref(null)
  const scrollMiniPlaceholder = ref(null)
  const scrollMiniVolumeTrack = ref(null)

  const crossTabMiniPlayerCandidate = {
    canShow: () => canShowCrossTabMiniPlayer(),
    hide: () => deactivateScrollMiniPlayer(),
    show: () => activateScrollMiniPlayer(false),
  }

  const scrollMiniPlayerStyle = computed(() => scrollMiniPlayerRectToStyle(scrollMiniPlayerRect.value))
  const scrollMiniPlayerDetached = computed(() => {
    return scrollMiniPlayerActive.value &&
      !isActiveTab.value &&
      isCrossTabMiniPlayerOwner(crossTabMiniPlayerCandidate)
  })
  const scrollMiniVolumePercent = computed(() => Math.round(scrollMiniVolume.value * 100))
  const scrollMiniVolumeIcon = computed(() => {
    if (scrollMiniVolume.value === 0) {
      return ['fas', 'volume-mute']
    }
    if (scrollMiniVolume.value < 0.5) {
      return ['fas', 'volume-low']
    }
    return ['fas', 'volume-high']
  })

  /** @type {IntersectionObserver | null} */
  let scrollMiniIntersectionObserver = null
  /** @type {number | null} */
  let scrollMiniPlayPauseHideTimeout = null
  /** @type {number | null} */
  let scrollMiniVolumeHideTimeout = null
  /** @type {(() => void) | null} */
  let scrollMiniBounceCancel = null
  /** @type {Animation | null} */
  let scrollMiniLayoutAnimation = null
  let scrollMiniLayoutAnimationSequence = 0
  let scrollMiniPlayPauseHiddenByTimer = false
  let scrollMiniDragHandleContrastLastUpdate = 0
  let scrollMiniPointerRevealSuppressedUntil = 0
  /** @type {number | null} */
  let scrollMiniPointerRevealSampleX = null
  /** @type {number | null} */
  let scrollMiniPointerRevealSampleY = null

  /** @type {{ type: 'drag' | 'resize' | 'volume', corner?: string, startX: number, startY: number, startRect: import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect } | null} */
  let scrollMiniPointerSession = null
  let lastKnownInlinePlayerHeight = 0
  /** @type {number | null} */
  let scrollMiniScrollFrame = null

  function updateScrollMiniVideoAspectRatio() {
    const videoElement = video.value
    if (!videoElement?.videoWidth || !videoElement.videoHeight) {
      return
    }

    scrollMiniVideoAspectRatio.value = videoElement.videoWidth / videoElement.videoHeight

    if (scrollMiniPlayerActive.value) {
      // Resizing to the video's aspect ratio is not the user moving the player,
      // so it must not turn a temporarily clamped position into its anchor.
      applyScrollMiniPlayerRect(scrollMiniPlayerRect.value, false, true)
    }
  }

  function rememberInlinePlayerLayoutHeight() {
    if (scrollMiniPlayerActive.value) {
      return
    }

    const layoutHeight = getScrollMiniInlineLayoutHeight(container.value, lastKnownInlinePlayerHeight)
    if (layoutHeight >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      lastKnownInlinePlayerHeight = layoutHeight
    }
  }

  function getScrollMiniPlaceholderLayoutHeight() {
    return getScrollMiniInlineLayoutHeight(container.value, lastKnownInlinePlayerHeight)
  }

  function canActivateScrollMiniPlayer() {
    if (!canUseScrollMiniPlayer()) {
      return false
    }

    return getScrollMiniPlaceholderLayoutHeight() >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT
  }

  function repairScrollMiniPlaceholderHeight() {
    if (!scrollMiniPlayerActive.value) {
      return
    }

    if (scrollMiniPlaceholderHeight.value >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      return
    }

    const layoutHeight = getScrollMiniPlaceholderLayoutHeight()
    if (layoutHeight < SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      return
    }

    scrollMiniPlaceholderHeight.value = layoutHeight
  }

  function clearScrollMiniPlayPauseHideTimeout() {
    if (scrollMiniPlayPauseHideTimeout != null) {
      clearTimeout(scrollMiniPlayPauseHideTimeout)
      scrollMiniPlayPauseHideTimeout = null
    }
  }

  function clearScrollMiniVolumeHideTimeout() {
    if (scrollMiniVolumeHideTimeout != null) {
      clearTimeout(scrollMiniVolumeHideTimeout)
      scrollMiniVolumeHideTimeout = null
    }
  }

  function showScrollMiniVolume() {
    clearScrollMiniVolumeHideTimeout()
    scrollMiniVolumeExpanded.value = true
  }

  function scheduleScrollMiniVolumeHide() {
    clearScrollMiniVolumeHideTimeout()

    scrollMiniVolumeHideTimeout = window.setTimeout(() => {
      scrollMiniVolumeHideTimeout = null
      scrollMiniVolumeExpanded.value = false
    }, SCROLL_MINI_VOLUME_HIDE_MS)
  }

  function hideScrollMiniPlayPause() {
    clearScrollMiniPlayPauseHideTimeout()
    scrollMiniPlayPauseVisible.value = false
    scrollMiniPlayPauseHiddenByTimer = true
  }

  function scheduleScrollMiniPlayPauseHide() {
    clearScrollMiniPlayPauseHideTimeout()

    const videoElement = video.value
    if (!videoElement || videoElement.paused) {
      return
    }

    scrollMiniPlayPauseHideTimeout = window.setTimeout(() => {
      scrollMiniPlayPauseHideTimeout = null

      if (video.value && !video.value.paused) {
        hideScrollMiniPlayPause()
      }
    }, SCROLL_MINI_PLAY_PAUSE_HIDE_MS)
  }

  /** @param {boolean} [autoHide] */
  function showScrollMiniPlayPause(autoHide = false) {
    scrollMiniPlayPauseVisible.value = true
    scrollMiniPlayPauseHiddenByTimer = false
    clearScrollMiniPlayPauseHideTimeout()

    if (autoHide) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function canRevealScrollMiniPlayPauseFromPointer() {
    return performance.now() >= scrollMiniPointerRevealSuppressedUntil
  }

  function suppressScrollMiniPlayPausePointerReveal() {
    scrollMiniPointerRevealSuppressedUntil = performance.now() + SCROLL_MINI_POINTER_REVEAL_SUPPRESS_MS
  }

  /** @param {MouseEvent | FocusEvent} event */
  function handleScrollMiniPlayerLeave(event) {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    const currentTarget = event.currentTarget
    const relatedTarget = event.relatedTarget
    if (
      currentTarget instanceof Node &&
      relatedTarget instanceof Node &&
      currentTarget.contains(relatedTarget)
    ) {
      return
    }

    scrollMiniPointerRevealSampleX = null
    scrollMiniPointerRevealSampleY = null

    if (scrollMiniPlayPauseVisible.value) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function handleScrollMiniPlayerEnter() {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    clearScrollMiniPlayPauseHideTimeout()

    if (scrollMiniPlayPauseVisible.value) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function handleScrollMiniPlayPauseMouseEnter() {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    showScrollMiniPlayPause(true)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniControlsPointerMove(event) {
    const videoElement = video.value
    if (!scrollMiniPlayerActive.value || !videoElement || videoElement.paused) return
    if (scrollMiniPlayPauseVisible.value) return
    if (!canRevealScrollMiniPlayPauseFromPointer()) return
    if (event.pointerType === 'mouse' && event.buttons !== 0) return

    if (scrollMiniPointerRevealSampleX == null || scrollMiniPointerRevealSampleY == null) {
      scrollMiniPointerRevealSampleX = event.clientX
      scrollMiniPointerRevealSampleY = event.clientY
      return
    }

    const dx = event.clientX - scrollMiniPointerRevealSampleX
    const dy = event.clientY - scrollMiniPointerRevealSampleY
    scrollMiniPointerRevealSampleX = event.clientX
    scrollMiniPointerRevealSampleY = event.clientY

    if (Math.hypot(dx, dy) < SCROLL_MINI_POINTER_REVEAL_MIN_DISTANCE) return

    showScrollMiniPlayPause(true)
  }

  function isNativePipActive() {
    return pictureInPictureActive.value
  }

  function isNativeFullscreenActive() {
    return Boolean(getUi()?.getControls?.()?.isFullScreenEnabled?.())
  }

  function restoreScrollMiniPlayerBeforeFullscreen() {
    if (!scrollMiniPlayerActive.value) {
      return
    }

    deactivateScrollMiniPlayer()
    container.value?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }

  function togglePlayerFullScreen() {
    const ui = getUi()
    if (!ui) {
      return
    }

    const controls = ui.getControls()

    if (controls.isFullScreenEnabled()) {
      controls.toggleFullScreen()
      return
    }

    if (scrollMiniPlayerActive.value) {
      restoreScrollMiniPlayerBeforeFullscreen()
      nextTick(() => {
        controls.toggleFullScreen()
      })
      return
    }

    controls.toggleFullScreen()
  }

  /** @param {MouseEvent} event */
  function handleFullscreenButtonClick(event) {
    if (!scrollMiniPlayerActive.value) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    togglePlayerFullScreen()
  }

  function canUseScrollMiniPlayerBase() {
    if (props.format === 'audio') return false
    if (fullWindowEnabled.value) return false
    if (isNativeFullscreenActive()) return false
    if (isNativePipActive()) return false
    const videoElement = video.value
    if (!videoElement || videoElement.ended) return false
    return true
  }

  function canShowCrossTabMiniPlayer() {
    const videoElement = video.value
    return !isActiveTab.value &&
      !autoPictureInPictureOnTabChange.value &&
      scrollMiniPlayerOnAllTabs.value &&
      canUseScrollMiniPlayerBase() &&
      (isCrossTabMiniPlayerOwner(crossTabMiniPlayerCandidate) || !videoElement.paused)
  }

  function canUseScrollMiniPlayer() {
    if (!canUseScrollMiniPlayerBase()) return false

    if (isActiveTab.value) {
      return scrollMiniPlayerEnabled.value && !hasCrossTabMiniPlayerOwner()
    }

    return !autoPictureInPictureOnTabChange.value &&
      scrollMiniPlayerOnAllTabs.value &&
      isCrossTabMiniPlayerOwner(crossTabMiniPlayerCandidate)
  }

  function getScrollMiniAnchor() {
    return scrollMiniAnchor.value
  }

  /**
   * @param {import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect} rect
   * @param {boolean} [persist]
   * @param {boolean} [keepAnchor] trust the rect's own anchor over its geometry
   */
  function applyScrollMiniPlayerRect(rect, persist = false, keepAnchor = false) {
    const insets = getViewportInsets()
    const clamped = clampScrollMiniPlayerRect(rect, scrollMiniVideoAspectRatio.value)
    // Remember the edge the player is parked at, so a later resize can put it
    // back against that edge instead of leaving it where the old viewport was.
    // Dragging makes the geometry authoritative, but a re-anchored rect brings
    // the distance it is meant to keep: a viewport too short to honour it clamps
    // the rect, and re-deriving from that would forget the distance for good.
    Object.assign(clamped, (keepAnchor && pickScrollMiniVerticalAnchor(rect)) ||
      getScrollMiniVerticalAnchor(clamped, insets))
    scrollMiniPlayerRect.value = clamped
    scrollMiniResizeCorner.value = getResizeHandleCorner(clamped, insets)

    if (persist) {
      // Drag and bounce frames can be interrupted, so only remember settled positions.
      setSavedScrollMiniPlayerRect(clamped)
      store.dispatch('updateScrollMiniPlayerSavedRect', serializeScrollMiniPlayerSavedRect(clamped))
    }
  }

  function cancelScrollMiniPlayerBounce() {
    if (!scrollMiniBounceCancel) return

    scrollMiniBounceCancel()
    scrollMiniBounceCancel = null
  }

  function cancelScrollMiniPlayerLayoutAnimation() {
    scrollMiniLayoutAnimationSequence++
    scrollMiniLayoutAnimation?.cancel()
    scrollMiniLayoutAnimation = null
    scrollMiniPlayerAnimating.value = false
  }

  /**
   * Animate the player from its bounds before a layout switch to its new ones.
   *
   * @param {DOMRect} previousRect
   * @param {boolean} expectedActive
   * @param {number} sequence
   */
  async function animateScrollMiniPlayerLayout(previousRect, expectedActive, sequence) {
    const playerContainer = container.value
    if (!playerContainer) return

    await nextTick()
    if (
      scrollMiniLayoutAnimationSequence !== sequence ||
      scrollMiniPlayerActive.value !== expectedActive
    ) return

    const nextRect = playerContainer.getBoundingClientRect()
    if (nextRect.width === 0 || nextRect.height === 0) {
      scrollMiniPlayerAnimating.value = false
      return
    }

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
      duration: SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    }))

    scrollMiniLayoutAnimation = animation
    animation.addEventListener('finish', () => {
      if (scrollMiniLayoutAnimation === animation) {
        scrollMiniLayoutAnimation = null
        scrollMiniPlayerAnimating.value = false
      }
    })
  }

  function loadScrollMiniPlayerSavedRectFromSettings() {
    const savedRect = parseScrollMiniPlayerSavedRect(store.getters.getScrollMiniPlayerSavedRect)
    if (savedRect) {
      setSavedScrollMiniPlayerRect(savedRect)
    }
  }

  function syncScrollMiniPlayerState() {
    const videoElement = video.value
    if (!videoElement) return

    scrollMiniVolume.value = videoElement.muted ? 0 : videoElement.volume
    scrollMiniIsPaused.value = videoElement.paused
    updateScrollMiniVolumeBarFill()
  }

  function updateScrollMiniVolumeBarFill() {
    updateScrollMiniPlayerVolumeBarFill(
      scrollMiniVolumeTrack.value,
      scrollMiniVolumePercent.value
    )
  }

  /** @param {boolean} [force] */
  function updateScrollMiniDragHandleContrast(force = false) {
    if (!scrollMiniPlayerActive.value) return

    const now = performance.now()
    if (!force && now - scrollMiniDragHandleContrastLastUpdate < SCROLL_MINI_DRAG_HANDLE_CONTRAST_MS) {
      return
    }

    scrollMiniDragHandleContrastLastUpdate = now

    const rect = scrollMiniPlayerRect.value
    const luminance = sampleScrollMiniDragHandleLuminance(
      video.value,
      rect.width,
      rect.height
    )
    if (luminance == null) return

    scrollMiniDragHandleOnLightBg.value = resolveScrollMiniDragHandleOnLightBg(
      luminance,
      scrollMiniDragHandleOnLightBg.value
    )

    const resizeLuminance = sampleScrollMiniHandleLuminance(
      video.value,
      rect.width,
      rect.height,
      getScrollMiniResizeHandleSampleRect(rect, scrollMiniResizeCorner.value)
    )
    if (resizeLuminance == null) return

    scrollMiniResizeHandleOnLightBg.value = resolveScrollMiniDragHandleOnLightBg(
      resizeLuminance,
      scrollMiniResizeHandleOnLightBg.value
    )
  }

  /**
   * @param {import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect} rect
   * @param {string} corner
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  function getScrollMiniResizeHandleSampleRect(rect, corner) {
    const size = 18
    return {
      left: corner.endsWith('right') ? rect.width - size : 0,
      top: corner.startsWith('bottom') ? rect.height - size : 0,
      width: size,
      height: size,
    }
  }

  function setupScrollMiniIntersectionObserver() {
    if (scrollMiniIntersectionObserver) {
      scrollMiniIntersectionObserver.disconnect()
      scrollMiniIntersectionObserver = null
    }

    if (props.format === 'audio' || typeof IntersectionObserver === 'undefined') {
      return
    }

    const anchor = getScrollMiniAnchor()
    if (!anchor) return

    scrollMiniIntersectionObserver = new IntersectionObserver(() => {
      updateScrollMiniPlayer()
    }, { threshold: [0, ENTER_MINI_RATIO, EXIT_MINI_RATIO, 1] })

    scrollMiniIntersectionObserver.observe(anchor)
  }

  /** @param {boolean} [animate] */
  function activateScrollMiniPlayer(animate = true) {
    if (scrollMiniPlayerActive.value) return

    const playerContainer = container.value
    if (!playerContainer) return
    const shouldAnimate = animate && !isReducedMotionEnabled()
    const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null

    const layoutHeight = getScrollMiniPlaceholderLayoutHeight()
    if (layoutHeight < SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      return
    }

    // Size the placeholder to the container's actual in-flow height so switching
    // the player to fixed positioning does not change the document height. The
    // max-based layout height can overshoot the real rendered height (e.g. for
    // non-16:9 videos), which would shift content below and jump the scroll up.
    const measuredHeight = playerContainer.offsetHeight
    const placeholderHeight = measuredHeight >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT
      ? measuredHeight
      : layoutHeight

    lastKnownInlinePlayerHeight = layoutHeight
    scrollMiniPlaceholderHeight.value = placeholderHeight

    cancelScrollMiniPlayerLayoutAnimation()
    const animationSequence = scrollMiniLayoutAnimationSequence
    scrollMiniPlayerAnimating.value = previousRect !== null

    const savedRect = getSavedScrollMiniPlayerRect()
    scrollMiniPlayerActive.value = true
    updateScrollMiniVideoAspectRatio()
    applyScrollMiniPlayerRect(
      savedRect
        // The window may have changed size since the rect was saved, so replay
        // it against the edges it was docked to rather than its old coordinates.
        ? reanchorScrollMiniPlayerRect(savedRect, scrollMiniVideoAspectRatio.value)
        : getDefaultScrollMiniPlayerRect(scrollMiniVideoAspectRatio.value),
      false,
      true
    )
    syncScrollMiniPlayerState()

    if (scrollMiniPlayPauseHiddenByTimer) {
      scrollMiniPlayPauseVisible.value = false
    } else {
      showScrollMiniPlayPause(true)
    }

    nextTick(() => {
      updateScrollMiniVolumeBarFill()
      updateScrollMiniDragHandleContrast(true)
    })

    if (previousRect) {
      animateScrollMiniPlayerLayout(previousRect, true, animationSequence)
    }
  }

  /** @param {boolean} [animate] */
  function deactivateScrollMiniPlayer(animate = false) {
    releaseCrossTabMiniPlayerOwnership(crossTabMiniPlayerCandidate)

    const playerContainer = container.value
    const shouldAnimate = animate && playerContainer !== null && !isReducedMotionEnabled()
    const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null

    cancelScrollMiniPlayerLayoutAnimation()
    const animationSequence = scrollMiniLayoutAnimationSequence
    scrollMiniPlayerAnimating.value = previousRect !== null

    scrollMiniPlayerActive.value = false
    scrollMiniPlaceholderHeight.value = 0
    scrollMiniDragHandleOnLightBg.value = false
    scrollMiniResizeHandleOnLightBg.value = false
    scrollMiniPlayPauseHiddenByTimer = false
    clearScrollMiniPlayPauseHideTimeout()
    clearScrollMiniVolumeHideTimeout()
    scrollMiniVolumeExpanded.value = false

    cancelScrollMiniPlayerBounce()

    if (previousRect) {
      animateScrollMiniPlayerLayout(previousRect, false, animationSequence)
    }
  }

  /** @param {{ animateActivation?: boolean }} [options] */
  function updateScrollMiniPlayer({ animateActivation = true } = {}) {
    if (!isActiveTab.value) {
      refreshCrossTabMiniPlayer(crossTabMiniPlayerCandidate)
    }

    // Check first: everything below reads layout, which forces a synchronous
    // reflow. Measuring before knowing whether the mini player can run at all
    // would do that on every scroll event even with the feature turned off.
    if (!canUseScrollMiniPlayer()) {
      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }
      return
    }

    rememberInlinePlayerLayoutHeight()

    repairScrollMiniPlaceholderHeight()

    if (!isActiveTab.value) {
      if (scrollMiniPlayerActive.value) {
        syncScrollMiniPlayerState()
        updateScrollMiniDragHandleContrast()
      } else if (canActivateScrollMiniPlayer()) {
        activateScrollMiniPlayer(false)
      }
      return
    }

    const anchor = getScrollMiniAnchor()
    if (!anchor) return

    const ratio = getAnchorVisibleRatio(anchor, getScrollMiniPlaceholderLayoutHeight())

    if (scrollMiniPlayerActive.value) {
      if (ratio >= EXIT_MINI_RATIO) {
        deactivateScrollMiniPlayer(true)
      } else {
        syncScrollMiniPlayerState()
        updateScrollMiniDragHandleContrast()
      }
    } else if (ratio < ENTER_MINI_RATIO && canActivateScrollMiniPlayer()) {
      activateScrollMiniPlayer(animateActivation)
    }
  }

  function handleScrollMiniWindowScroll() {
    suppressScrollMiniPlayPausePointerReveal()

    // Scroll fires far more often than the screen refreshes, so coalesce the
    // layout-reading update into the next frame instead of running it per event.
    if (scrollMiniScrollFrame !== null) {
      return
    }

    scrollMiniScrollFrame = requestAnimationFrame(() => {
      scrollMiniScrollFrame = null
      updateScrollMiniPlayer()
    })
  }

  function cancelPendingScrollMiniScrollFrame() {
    if (scrollMiniScrollFrame !== null) {
      cancelAnimationFrame(scrollMiniScrollFrame)
      scrollMiniScrollFrame = null
    }
  }

  /**
   * Re-dock to the current insets, horizontally and vertically. Needed whenever
   * the usable area changes (window resize, or the vertical tab bar being
   * toggled/resized), otherwise the player is stranded mid-screen at its old edge.
   */
  function resnapScrollMiniPlayerToEdge() {
    if (!scrollMiniPlayerActive.value) return
    // Only a drag/resize is positioning the player; a volume session must not
    // block re-docking, since its pointer-up path never snaps.
    if (scrollMiniPointerSession?.type === 'drag' || scrollMiniPointerSession?.type === 'resize') return

    cancelScrollMiniPlayerBounce()
    applyScrollMiniPlayerRect(
      reanchorScrollMiniPlayerRect(scrollMiniPlayerRect.value, scrollMiniVideoAspectRatio.value),
      true,
      true
    )
  }

  function handleScrollMiniWindowResize() {
    resnapScrollMiniPlayerToEdge()
    updateScrollMiniPlayer()
  }

  function scrollMiniScrollToTop(event) {
    event?.preventDefault()
    event?.stopPropagation()

    if (scrollMiniPlayerDetached.value && tabId) {
      store.dispatch('activateTab', tabId)
      return
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function scrollMiniTogglePlayPause(event) {
    event?.preventDefault()
    event?.stopPropagation()

    const videoElement = video.value
    if (!videoElement) return

    if (videoElement.paused) {
      videoElement.play()
    } else {
      videoElement.pause()
    }

    syncScrollMiniPlayerState()
    showScrollMiniPlayPause(true)
  }

  /** @param {Event} event */
  function updateScrollMiniVolume(event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return

    showScrollMiniVolume()

    const nextVolume = Number.parseFloat(target.value) / 100
    const videoElement = video.value
    if (!videoElement || Number.isNaN(nextVolume)) return

    videoElement.volume = nextVolume
    videoElement.muted = nextVolume === 0
    scrollMiniVolume.value = nextVolume
    updateScrollMiniVolumeBarFill()
  }

  function handleScrollMiniVolumeMouseEnter() {
    if (!scrollMiniPlayerActive.value) return

    showScrollMiniVolume()
  }

  function handleScrollMiniVolumeMouseLeave() {
    if (!scrollMiniPlayerActive.value) return
    if (scrollMiniPointerSession?.type === 'volume') return

    scheduleScrollMiniVolumeHide()
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniVolumePointerDown(event) {
    if (!scrollMiniPlayerActive.value) return

    showScrollMiniVolume()
    scrollMiniPointerSession = {
      type: 'volume',
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...scrollMiniPlayerRect.value },
    }

    window.addEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.addEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
  }

  function handleScrollMiniVolumePointerUpWindow() {
    if (scrollMiniPointerSession?.type === 'volume') {
      scrollMiniPointerSession = null
    }

    window.removeEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
    scheduleScrollMiniVolumeHide()
  }

  function endScrollMiniPointerSession() {
    scrollMiniPointerSession = null
    document.body.classList.remove('scroll-mini-player-grabbing')
    window.removeEventListener('pointermove', handleScrollMiniPointerMoveWindow)
    window.removeEventListener('pointerup', handleScrollMiniPointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniPointerUpWindow)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniPointerMoveWindow(event) {
    if (!scrollMiniPointerSession || !scrollMiniPlayerActive.value) return

    const insets = getViewportInsets()

    if (scrollMiniPointerSession.type === 'drag') {
      const startRect = scrollMiniPointerSession.startRect
      const dx = event.clientX - scrollMiniPointerSession.startX
      const dy = event.clientY - scrollMiniPointerSession.startY

      applyScrollMiniPlayerRect(clampScrollMiniPlayerRect({
        ...startRect,
        left: startRect.left + dx,
        top: startRect.top + dy,
      }, scrollMiniVideoAspectRatio.value))
    } else if (scrollMiniPointerSession.type === 'resize' && scrollMiniPointerSession.corner) {
      applyScrollMiniPlayerRect(resizeScrollMiniPlayerFromCorner(
        scrollMiniPointerSession.startRect,
        /** @type {'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'} */ (scrollMiniPointerSession.corner),
        event.clientX,
        event.clientY,
        insets,
        scrollMiniVideoAspectRatio.value
      ))
    }

    updateScrollMiniDragHandleContrast()
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniPointerUpWindow(event) {
    if (!scrollMiniPointerSession) return

    if (scrollMiniPointerSession.type === 'drag') {
      const insets = getViewportInsets()
      const currentRect = scrollMiniPlayerRect.value

      if (shouldBounceScrollMiniPlayerToEdge(currentRect, insets)) {
        const targetRect = snapScrollMiniPlayerToEdge(currentRect, insets)
        const fromRect = { ...currentRect }

        if (scrollMiniBounceCancel) {
          scrollMiniBounceCancel()
        }

        scrollMiniBounceCancel = animateScrollMiniPlayerBounce(
          fromRect,
          targetRect,
          (rect) => {
            applyScrollMiniPlayerRect(clampScrollMiniPlayerRect(rect, scrollMiniVideoAspectRatio.value))
          },
          () => {
            applyScrollMiniPlayerRect(clampScrollMiniPlayerRect(targetRect, scrollMiniVideoAspectRatio.value), true)
            scrollMiniBounceCancel = null
          }
        )
      } else {
        applyScrollMiniPlayerRect(snapScrollMiniPlayerToEdge(currentRect, insets), true)
      }
    } else {
      applyScrollMiniPlayerRect(clampScrollMiniPlayerRect(scrollMiniPlayerRect.value, scrollMiniVideoAspectRatio.value), true)
    }

    endScrollMiniPointerSession()
    event.preventDefault()
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniDragPointerDown(event) {
    if (!scrollMiniPlayerActive.value) return

    event.preventDefault()
    event.stopPropagation()
    cancelScrollMiniPlayerBounce()

    scrollMiniPointerSession = {
      type: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...scrollMiniPlayerRect.value },
    }

    document.body.classList.add('scroll-mini-player-grabbing')
    window.addEventListener('pointermove', handleScrollMiniPointerMoveWindow)
    window.addEventListener('pointerup', handleScrollMiniPointerUpWindow)
    window.addEventListener('pointercancel', handleScrollMiniPointerUpWindow)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniResizePointerDown(event) {
    if (!scrollMiniPlayerActive.value) return

    event.preventDefault()
    event.stopPropagation()
    cancelScrollMiniPlayerBounce()

    scrollMiniPointerSession = {
      type: 'resize',
      corner: getResizeHandleCorner(scrollMiniPlayerRect.value, getViewportInsets()),
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...scrollMiniPlayerRect.value },
    }

    document.body.classList.add('scroll-mini-player-grabbing')
    window.addEventListener('pointermove', handleScrollMiniPointerMoveWindow)
    window.addEventListener('pointerup', handleScrollMiniPointerUpWindow)
    window.addEventListener('pointercancel', handleScrollMiniPointerUpWindow)
  }

  function teardownScrollMiniPlayer() {
    unregisterCrossTabMiniPlayer(crossTabMiniPlayerCandidate)

    if (scrollMiniIntersectionObserver) {
      scrollMiniIntersectionObserver.disconnect()
      scrollMiniIntersectionObserver = null
    }

    clearScrollMiniPlayPauseHideTimeout()
    clearScrollMiniVolumeHideTimeout()

    cancelScrollMiniPlayerBounce()
    cancelScrollMiniPlayerLayoutAnimation()
    cancelPendingScrollMiniScrollFrame()

    endScrollMiniPointerSession()
    window.removeEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('scroll', handleScrollMiniWindowScroll)
    window.removeEventListener('resize', handleScrollMiniWindowResize)

    if (scrollMiniPlayerActive.value) {
      scrollMiniPlayerActive.value = false
    }
  }

  watch(scrollMiniVolumePercent, updateScrollMiniVolumeBarFill)

  watch(() => props.videoId, () => {
    lastKnownInlinePlayerHeight = 0

    if (scrollMiniPlayerActive.value) {
      deactivateScrollMiniPlayer()
    }
  })

  watch(isActiveTab, (active) => {
    if (active) {
      markCrossTabMiniPlayerActive(crossTabMiniPlayerCandidate)
    } else {
      markCrossTabMiniPlayerInactive(crossTabMiniPlayerCandidate)
    }

    nextTick(() => updateScrollMiniPlayer({ animateActivation: false }))
  }, { flush: 'sync' })

  watch(
    () => store.getters.getScrollMiniPlayerSavedRect,
    loadScrollMiniPlayerSavedRectFromSettings,
    { immediate: true }
  )

  watch(scrollMiniPlayerEnabled, () => updateScrollMiniPlayer())
  watch(scrollMiniPlayerOnAllTabs, () => updateScrollMiniPlayer())
  watch(autoPictureInPictureOnTabChange, () => updateScrollMiniPlayer())
  watch(fullWindowEnabled, () => {
    refreshCrossTabMiniPlayer(crossTabMiniPlayerCandidate)
    updateScrollMiniPlayer()
  })

  // Toggling or resizing the vertical tab bar changes the usable area without
  // firing a window resize, so re-dock explicitly (after the DOM updates, so the
  // rail's new bounds are measurable).
  watch(
    () => [store.getters.getTabBarPosition, store.getters.getVerticalTabBarWidth],
    () => { nextTick(resnapScrollMiniPlayerToEdge) }
  )

  return {
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
    scrollMiniPlayerAnimating,
    scrollMiniPlayerDetached,
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
  }
}
