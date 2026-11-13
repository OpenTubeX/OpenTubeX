// @ts-check
import { markRaw, nextTick, reactive } from 'vue'
import { applyAnimationSpeed } from '../../helpers/animationSpeed.js'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion.js'

/**
 * Moves through a feed of Shorts with swipes, the mouse wheel, the keyboard
 * and document scrolling, and previews the next Short while it loads. It owns
 * its gesture state and global listeners; the watch page decides which feed
 * and position apply and opens the chosen Short.
 * @param {object} options
 * @param {() => boolean} options.isActive Whether the page shows a Shorts feed
 * @param {() => { videoId: string }[]} options.getFeed
 * @param {() => number} options.getIndex The current Short's position in the feed, or -1
 * @param {() => boolean} options.isPresented Whether the page is visible in its tab
 * @param {() => boolean} options.isTabSelected Whether its logical tab is the selected one
 * @param {() => boolean} options.isPanelOpen Whether comments or another panel covers the Short
 * @param {(short: { videoId: string }) => string} options.getThumbnailUrl
 * @param {() => HTMLElement} options.getViewport The element that swipes move
 * @param {(short: { videoId: string }) => void} options.openShort Opens a neighboring Short
 */
export function createShortsFeedNavigation({
  isActive,
  getFeed,
  getIndex,
  isPresented,
  isTabSelected,
  isPanelOpen,
  getThumbnailUrl,
  getViewport,
  openShort,
}) {
  /** Rendered by the watch page */
  const state = reactive({
    /** @type {{ id: number, x: number, y: number, dragging: boolean } | null} */
    pointer: null,
    /** An expanded player that the swipe moves instead of the page's viewport */
    /** @type {Element | null} */
    presentationTarget: null,
    offset: 0,
    height: 0,
    direction: 0,
    /** Thumbnail of the Short a swipe reveals */
    preview: '',
    settling: false,
    /** Thumbnail shown while the next Short loads, and the direction it came from */
    transitionPreview: '',
    transitionDirection: 0,
  })
  /** @type {Animation[]} */
  let animations = []
  let suppressClick = false
  let lockedUntil = 0
  let lastWindowScrollY = window.scrollY
  let scrollResetPending = false

  /** @param {number} offset */
  const neighbor = offset => getFeed()[getIndex() + offset]

  /** @param {number} offset 1 for the next Short, -1 for the previous one */
  function navigate(offset) {
    if (!isActive() || state.settling || Date.now() < lockedUntil) {
      return
    }

    const target = neighbor(offset)
    if (!target) {
      return
    }

    state.transitionDirection = Math.sign(offset)
    state.transitionPreview = getThumbnailUrl(target)
    lockedUntil = Date.now() + 300
    openShort(target)
  }

  /** The loading Short replaced the transition preview. */
  function finishTransition() {
    state.transitionPreview = ''
    state.transitionDirection = 0
  }

  function handleWindowScroll() {
    const scrollY = window.scrollY

    if (!isActive() || !isPresented() || !isTabSelected()) {
      lastWindowScrollY = scrollY
      return
    }

    if (scrollResetPending) {
      scrollResetPending = false
      lastWindowScrollY = scrollY
      return
    }

    if (Math.abs(scrollY - lastWindowScrollY) < 4) {
      lastWindowScrollY = scrollY
      return
    }

    const movedDown = scrollY > lastWindowScrollY
    lastWindowScrollY = scrollY

    // The document starts at its upper boundary, so native document
    // scrolling can only intentionally advance the feed. A decrease is our
    // own reset or tab scroll restoration; wheel, touch, and keyboard input
    // handle navigation to the previous Short directly.
    if (!movedDown) {
      return
    }

    navigate(1)

    // The short preview deliberately gives the document a small scroll range
    // so the page scrollbar and middle-button autoscroll can navigate. Reset
    // it after interpreting the movement; otherwise the next movement at the
    // end of the range cannot emit another scroll event.
    if (window.scrollY !== 0) {
      scrollResetPending = true
      window.scrollTo({ top: 0 })
    }
  }

  /** Tab scroll restoration on activation must not count as a scroll. */
  function resumeScrollTracking() {
    if (!isActive()) return
    scrollResetPending = false
    lastWindowScrollY = window.scrollY
    requestAnimationFrame(() => {
      if (isPresented()) {
        lastWindowScrollY = window.scrollY
      }
    })
  }

  /** @param {Event} event */
  function isPanelEvent(event) {
    return Boolean(/** @type {Element | null} */ (event.target)?.closest?.(
      '.shortsCommentsPanel, .shortsAuxPanel, .shaka-no-propagation'
    ))
  }

  /** @param {WheelEvent} event */
  function handleWheel(event) {
    if (!isActive() || isPanelEvent(event) || Math.abs(event.deltaY) < 20) {
      return
    }

    event.preventDefault()
    navigate(event.deltaY > 0 ? 1 : -1)
  }

  /** @param {PointerEvent} event */
  function handlePointerDown(event) {
    suppressClick = false
    const target = /** @type {Element | null} */ (event.target)
    if (
      isActive() &&
      !state.settling &&
      Date.now() >= lockedUntil &&
      !isPanelOpen() &&
      !isPanelEvent(event) &&
      !target?.closest?.('button, a, input, [role="slider"]') &&
      event.pointerType === 'touch' &&
      event.isPrimary
    ) {
      const presentationTarget = target?.closest?.('.ftVideoPlayer:is(.fullWindow, :fullscreen)') ?? null
      state.presentationTarget = presentationTarget ? markRaw(presentationTarget) : null
      state.height = (presentationTarget ?? getViewport()).getBoundingClientRect().height
      state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false }
    }
  }

  /** @param {PointerEvent} event */
  function handlePointerMove(event) {
    const pointer = state.pointer
    if (!pointer || pointer.id !== event.pointerId) return

    const distance = event.clientY - pointer.y
    if (!pointer.dragging) {
      if (Math.max(Math.abs(distance), Math.abs(event.clientX - pointer.x)) < 8) return
      if (Math.abs(event.clientX - pointer.x) > Math.abs(distance)) {
        resetSwipe()
        return
      }
      pointer.dragging = true
      const surface = /** @type {Element} */ (event.currentTarget)
      surface.setPointerCapture(event.pointerId)
    }

    event.preventDefault()
    suppressClick = true
    const direction = distance < 0 ? 1 : -1
    const target = neighbor(direction)
    if (direction !== state.direction) {
      state.direction = direction
      state.preview = target ? getThumbnailUrl(target) : ''
    }
    state.offset = target
      ? Math.max(-state.height, Math.min(state.height, distance))
      : distance / (1 + Math.abs(distance) / 60)
  }

  /** @param {PointerEvent} event */
  function handlePointerUp(event) {
    const pointer = state.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    if (!pointer.dragging) {
      resetSwipe()
      return
    }
    handlePointerMove(event)
    state.pointer = null
    event.preventDefault()
    event.stopPropagation()
    settleSwipe(Boolean(neighbor(state.direction)) && Math.abs(event.clientY - pointer.y) >= 50)
  }

  /** @param {PointerEvent} event */
  function handlePointerCancel(event) {
    // Claiming a touch releases its implicit capture on the player surface.
    if (event.type === 'lostpointercapture' && event.target !== event.currentTarget) return
    if (state.pointer?.id !== event.pointerId) return
    state.pointer = null
    settleSwipe(false)
  }

  /** @param {MouseEvent} event */
  function handleClick(event) {
    if (suppressClick && event.detail > 0) {
      event.preventDefault()
      event.stopPropagation()
      suppressClick = false
    }
  }

  /** @param {boolean} navigateAfterwards */
  async function settleSwipe(navigateAfterwards) {
    const presentationTarget = state.presentationTarget
    const viewport = presentationTarget ?? getViewport()
    const direction = state.direction
    const from = state.offset
    const to = navigateAfterwards ? -direction * state.height : 0
    const reducedMotion = isReducedMotionEnabled()
    state.settling = true
    state.offset = to
    /** @type {Animation[]} */
    const settling = []
    animations = settling
    await nextTick()
    if (animations !== settling) return
    const surfaces = state.presentationTarget
      ? [...viewport.children]
      : [...viewport.querySelectorAll(':scope > .videoPlayer, :scope > .shortsSwipePreview')]
    settling.push(...surfaces.map(element => {
      const previewOffset = element.classList.contains('shortsSwipePreview') ? direction * state.height : 0
      // Keep the expanded container stationary, including the browser's fullscreen top layer.
      const translateContents = state.presentationTarget && !previewOffset
      return applyAnimationSpeed(element.animate([
        translateContents ? { translate: `0 ${from}px` } : { transform: `translateY(${from + previewOffset}px)` },
        translateContents ? { translate: `0 ${to}px` } : { transform: `translateY(${to + previewOffset}px)` }
      ], { duration: reducedMotion ? 0 : 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }))
    }))
    try {
      await Promise.all(settling.map(animation => animation.finished))
    } catch {
      return // Resize, tab changes, and navigation cancel the old gesture.
    }
    if (animations !== settling) return
    resetSwipe()
    if (navigateAfterwards) {
      navigate(direction)
      state.transitionDirection = 0
    }
  }

  /** Cancels a swipe in progress, for example after a resize or navigation. */
  function resetSwipe() {
    animations.forEach(animation => animation.cancel())
    animations = []
    state.presentationTarget = null
    state.pointer = null
    state.offset = 0
    state.direction = 0
    state.preview = ''
    state.settling = false
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    const target = /** @type {HTMLElement | null} */ (event.target)
    if (
      !isActive() ||
      !isPresented() ||
      isPanelOpen() ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '') ||
      target?.isContentEditable ||
      target?.closest?.('[role="dialog"], [role="menu"]')
    ) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault()
      navigate(1)
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault()
      navigate(-1)
    }
  }

  function addListeners() {
    document.addEventListener('keydown', handleKeydown, true)
    window.addEventListener('scroll', handleWindowScroll, { passive: true })
  }

  function removeListeners() {
    document.removeEventListener('keydown', handleKeydown, true)
    window.removeEventListener('scroll', handleWindowScroll)
  }

  return markRaw({
    state,
    navigate,
    finishTransition,
    resetSwipe,
    resumeScrollTracking,
    addListeners,
    removeListeners,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleClick,
    /** Navigation waits until this time, so one gesture moves one Short */
    get lockedUntil() {
      return lockedUntil
    },
    set lockedUntil(value) {
      lockedUntil = value
    },
    /** Whether the next scroll event is the feed resetting the document */
    get scrollResetPending() {
      return scrollResetPending
    },
  })
}
