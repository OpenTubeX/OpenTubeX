import { computed, nextTick, onBeforeUnmount, onUnmounted, reactive, ref, watch } from 'vue'
import store from '../../../store/index'
import { applyAnimationSpeed } from '../../../helpers/animationSpeed'
import {
  FULLSCREEN_DOCK_GAP,
  FULLSCREEN_DOCK_OUTER_INSET,
  toggleFullscreenDockCollapsed,
} from '../../../helpers/fullscreenDocks'
import { isReducedMotionEnabled } from '../../../helpers/reducedMotion'

const FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT = 360
const FULLSCREEN_DOCK_COMPACT_MIN_HEIGHT = 96
// Matches the automatic width's minimum in FtShakaVideoPlayer.css.
const FULLSCREEN_DOCK_MIN_WIDTH = 260
// Share of the player the dock column may take, so the video stays watchable.
const FULLSCREEN_DOCK_MAX_WIDTH_SHARE = 0.7
export const FULLSCREEN_DOCK_HEADER_SELECTOR = [
  '.chapterOverlayHeader',
  '.fullscreenMetadataHeader',
  '.transcriptHeader',
  '.sponsorBlockHeader',
  '.liveChatDockHeader',
  '.fullscreenCommentHeader',
  '.playlistDockHeader',
  '.queueHeader',
  '.recommendationsDockHeader',
].join(', ')
const FULLSCREEN_DOCK_SELECTORS = {
  metadata: '.fullscreenMetadataOverlay',
  transcript: '.fullscreenTranscriptOverlay',
  sponsorBlock: '.fullscreenSponsorBlockOverlay',
  liveChat: '.fullscreenLiveChatOverlay',
  comments: '.fullscreenCommentsOverlay',
  queue: '.fullscreenQueueOverlay',
  playlist: '.fullscreenPlaylistOverlay',
  recommendations: '.fullscreenRecommendationsOverlay',
  chapters: '.chapterOverlay',
}

/**
 * Lays out the information docks stacked beside the video in fullscreen and full window:
 * their order and heights, which the viewer can resize, reorder and collapse, the width of
 * the column, which the viewer can resize, and the transitions of the video and the floating action dock when the docks open or close.
 * @param {{
 *   container: import('vue').Ref<HTMLElement | null>,
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   actionDock: import('vue').Ref<HTMLElement | null>,
 *   fullscreenDockOpen: import('vue').ComputedRef<boolean>,
 *   isFullscreenDockOpen: (dock: string) => boolean,
 *   isFullscreen: import('vue').Ref<boolean>,
 *   isFullWindow: () => boolean,
 *   isPortraitLayout: () => boolean,
 *   presentationModeChanging: import('vue').Ref<boolean>,
 * }} options
 */
export function useFullscreenDocks({
  container,
  video,
  actionDock,
  fullscreenDockOpen,
  isFullscreenDockOpen,
  isFullscreen,
  isFullWindow,
  isPortraitLayout,
  presentationModeChanging,
}) {
  const fullscreenDockLayoutOpen = ref(false)
  let fullscreenDockLayoutFrame = null
  /** @type {Animation[]} */
  let fullscreenDockAnimations = []
  let fullscreenDockAnimationGeneration = 0

  function cancelFullscreenDockAnimations() {
    fullscreenDockAnimationGeneration++
    fullscreenDockAnimations.forEach(animation => animation.cancel())
    fullscreenDockAnimations = []
  }

  /**
   * @param {HTMLElement} element
   * @param {Keyframe[]} keyframes
   */
  function animateFullscreenDockPush(element, keyframes) {
    const animation = applyAnimationSpeed(element.animate(keyframes, { duration: 250, easing: 'ease' }))
    fullscreenDockAnimations.push(animation)
    animation.addEventListener('finish', () => {
      fullscreenDockAnimations = fullscreenDockAnimations.filter(entry => entry !== animation)
    })
  }

  /**
   * The action dock and SponsorBlock's notices and submission menu float at the
   * video's inline end, so only that edge moves with a dock push.
   * @returns {Map<HTMLElement, number>}
   */
  function getFloatingInlineEnds() {
    const notices = container.value?.querySelectorAll(':scope > :is(.skippedSegmentsWrapper, .sponsorBlockSubmissionWrapper)') ?? []
    return new Map([actionDock.value, ...notices].filter(element => element instanceof HTMLElement).map(element => {
      const bounds = element.getBoundingClientRect()
      return [element, getComputedStyle(element).direction === 'rtl' ? bounds.left : bounds.right]
    }))
  }

  function getFullscreenDockVideoGeometry() {
    const element = video.value
    if (!element || !element.videoWidth || !element.videoHeight) return null
    const bounds = element.getBoundingClientRect()
    const fit = Math.min(bounds.width / element.videoWidth, bounds.height / element.videoHeight)
    return {
      width: element.videoWidth * fit,
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    }
  }

  // Commit the final layout once, then animate the fitted video and the floating
  // controls beside it on the compositor. Animating layout properties reflows
  // Shaka, captions, annotations and ResizeObservers on every frame and stalls
  // under load.
  watch(fullscreenDockLayoutOpen, async () => {
    const before = getFullscreenDockVideoGeometry()
    const floatingBefore = getFloatingInlineEnds()
    cancelFullscreenDockAnimations()
    const generation = fullscreenDockAnimationGeneration
    if (presentationModeChanging.value || isReducedMotionEnabled() ||
      (!isFullscreen.value && !isFullWindow())) return

    await nextTick()
    if (generation !== fullscreenDockAnimationGeneration || presentationModeChanging.value) return

    for (const [element, after] of getFloatingInlineEnds()) {
      const previous = floatingBefore.get(element)
      if (previous === undefined || Math.abs(previous - after) < 0.5) continue
      animateFullscreenDockPush(element, [
        { translate: `${previous - after}px 0px` },
        { translate: '0px 0px' },
      ])
    }

    const after = getFullscreenDockVideoGeometry()
    if (!before || !after || after.width <= 0) return
    const scale = before.width / after.width
    // Zoom/pan uses `transform`. Individual scale/translate keep that intact;
    // compensate for scaling its translation around the element's center.
    const transform = new DOMMatrix(getComputedStyle(video.value).transform)
    const x = before.x - after.x + transform.e * (1 - scale)
    const y = before.y - after.y + transform.f * (1 - scale)
    animateFullscreenDockPush(video.value, [
      { scale: String(scale), translate: `${x}px ${y}px` },
      { scale: '1', translate: '0px 0px' },
    ])
  })

  watch(presentationModeChanging, changing => {
    if (changing) cancelFullscreenDockAnimations()
  })

  watch(fullscreenDockOpen, (open) => {
    if (fullscreenDockLayoutFrame !== null) {
      cancelAnimationFrame(fullscreenDockLayoutFrame)
      fullscreenDockLayoutFrame = null
    }

    if (open) {
      fullscreenDockLayoutOpen.value = true
    } else {
      // Paint the layout once after teleported dock content settles, then start the reverse transition.
      fullscreenDockLayoutFrame = requestAnimationFrame(() => {
        fullscreenDockLayoutFrame = requestAnimationFrame(() => {
          fullscreenDockLayoutFrame = null
          fullscreenDockLayoutOpen.value = false
        })
      })
    }
  }, { flush: 'post' })

  const fullscreenDockOrder = reactive(['metadata', 'transcript', 'sponsorBlock', 'liveChat', 'comments', 'queue', 'playlist', 'recommendations', 'chapters'])
  const fullscreenDockWeights = reactive(Object.fromEntries(fullscreenDockOrder.map(dock => [dock, 1])))
  const fullscreenDockCollapsedState = Object.fromEntries(fullscreenDockOrder.map(dock => [dock, null]))
  const fullscreenDockResizing = ref(false)
  const fullscreenDockReordering = ref(false)
  let resizingFullscreenDock = null
  let resizingFullscreenDockWeightBefore = 0
  let resizingFullscreenDockTotalWeight = 0
  let resizingFullscreenDockBounds = null
  // Each drag follows the pointer that started it, so a second touch cannot move or end it.
  let fullscreenDockGesturePointerId = null

  /** @param {PointerEvent} [event] */
  function isOtherFullscreenDockPointer(event) {
    return event != null && event.pointerId !== fullscreenDockGesturePointerId
  }

  function getFullscreenOpenDocks(includeDock) {
    const openDocks = fullscreenDockOrder.filter(isFullscreenDockOpen)

    // Keep a closed dock in the slot it will enter so its transition stays
    // horizontal while the currently open docks resize around it.
    if (includeDock && !openDocks.includes(includeDock)) {
      openDocks.push(includeDock)
      openDocks.sort((a, b) => fullscreenDockOrder.indexOf(a) - fullscreenDockOrder.indexOf(b))
    }

    return openDocks
  }

  function fullscreenDockStyle(dock) {
    if (isPortraitLayout()) return null
    const openDocks = getFullscreenOpenDocks(dock)
    const index = openDocks.indexOf(dock)
    const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
    const weightBefore = openDocks
      .slice(0, index)
      .reduce((total, name) => total + fullscreenDockWeights[name], 0)
    const weightAfter = totalWeight - weightBefore - fullscreenDockWeights[dock]

    return {
      insetBlockStart: index === 0
        ? 'calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 12px)'
        : `calc((100% - var(--fullscreen-actions-footer-space, 0px)) * ${weightBefore / totalWeight} + 6px)`,
      insetBlockEnd: index === openDocks.length - 1
        ? 'calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px + var(--fullscreen-actions-footer-space, 0px))'
        : `calc((100% - var(--fullscreen-actions-footer-space, 0px)) * ${weightAfter / totalWeight} + var(--fullscreen-actions-footer-space, 0px) + 6px)`,
    }
  }

  /** @type {Animation[]} */
  let fullscreenDockArrangementAnimations = []
  let fullscreenDockArrangementGeneration = 0

  function cancelFullscreenDockArrangementAnimations() {
    fullscreenDockArrangementGeneration++
    fullscreenDockArrangementAnimations.forEach(animation => animation.cancel())
    fullscreenDockArrangementAnimations = []
  }

  /** @param {string} dock */
  function getFullscreenDockElement(dock) {
    return container.value?.querySelector(FULLSCREEN_DOCK_SELECTORS[dock]) ?? null
  }

  /**
   * @param {Element} element
   * @param {Keyframe[]} keyframes
   */
  function animateFullscreenDockArrangement(element, keyframes) {
    const animation = applyAnimationSpeed(element.animate(keyframes, { duration: 250, easing: 'ease' }))
    fullscreenDockArrangementAnimations.push(animation)
    animation.addEventListener('finish', () => {
      fullscreenDockArrangementAnimations = fullscreenDockArrangementAnimations.filter(entry => entry !== animation)
    })
  }

  /**
   * Moves and resizes a dock from where it was drawn to its new slot with a
   * vertical `scale` and `translate`, which the compositor animates without
   * laying out the dock's content again. Its children get the inverse scale,
   * so the content keeps its size, stays at the dock's top edge and is
   * revealed or covered by the moving bottom edge.
   * @param {HTMLElement} element
   * @param {{ top: number, height: number }} from
   * @param {DOMRect} to
   */
  function animateFullscreenDockSlot(element, from, to) {
    const startScale = from.height / to.height
    const resized = Math.abs(startScale - 1) >= 0.001
    // Measure the children's centers, which their scale applies around, before
    // the dock's own transform moves them.
    const children = resized
      ? [...element.children].flatMap(child => {
          if (!(child instanceof HTMLElement) || child.classList.contains('fullscreenDockResizeHandle')) return []
          const bounds = child.getBoundingClientRect()
          return bounds.height > 0 ? [{ child, center: bounds.top + bounds.height / 2 - to.top }] : []
        })
      : []

    // Both transforms apply around the dock's center, which scaling moves.
    const startTranslate = from.top - to.top - to.height * (1 - startScale) / 2
    animateFullscreenDockArrangement(element, [
      { translate: `0px ${startTranslate}px`, scale: `1 ${startScale}` },
      { translate: '0px 0px', scale: '1 1' },
    ])
    if (!resized) return

    // The inverse of a linearly animated scale is not linear, so sample it at
    // geometrically spaced scales, where linear steps between them stay within
    // a fraction of a pixel. Offsets are eased progress, like the dock's.
    const steps = 16
    const scales = Array.from({ length: steps + 1 }, (_, step) => startScale ** (1 - step / steps))
    for (const { child, center } of children) {
      animateFullscreenDockArrangement(child, scales.map((scale, step) => ({
        offset: step === steps ? 1 : (scale - startScale) / (1 - startScale),
        translate: `0px ${center * (1 - scale) / scale}px`,
        scale: `1 ${1 / scale}`,
      })))
    }
  }

  // Docks that keep their place in the column glide to their new slots when
  // another one opens, closes, collapses or moves, or the heights reset, while
  // the opening or closing dock slides in or out sideways. Animating the slots'
  // insets instead would lay out every dock's content on every frame. The
  // player declares the portrait layout after setting this up, so only the
  // callback checks it.
  watch(() => getFullscreenOpenDocks().map(dock => `${dock}:${fullscreenDockWeights[dock]}`).join(), async (_, previousArrangement) => {
    if (isPortraitLayout() || fullscreenDockResizing.value || presentationModeChanging.value ||
      isReducedMotionEnabled() || (!isFullscreen.value && !isFullWindow())) {
      cancelFullscreenDockArrangementAnimations()
      return
    }

    // Runs before the player renders the new slots. Measure where the docks
    // are drawn, so an interrupted animation continues from its current frame.
    const previousDocks = previousArrangement.split(',').map(entry => entry.split(':')[0])
    const staying = getFullscreenOpenDocks().filter(dock => previousDocks.includes(dock))
    const before = new Map()
    for (const dock of staying) {
      const element = getFullscreenDockElement(dock)
      if (element) before.set(dock, element.getBoundingClientRect())
    }
    if (before.size === 0) return

    const generation = ++fullscreenDockArrangementGeneration
    await nextTick()
    if (generation !== fullscreenDockArrangementGeneration) return
    cancelFullscreenDockArrangementAnimations()

    for (const [dock, from] of before) {
      const element = getFullscreenDockElement(dock)
      if (!element) continue
      const to = element.getBoundingClientRect()
      if (to.height > 0 && (Math.abs(from.top - to.top) >= 0.5 || Math.abs(from.height - to.height) >= 0.5)) {
        animateFullscreenDockSlot(element, from, to)
      }
    }
  })

  watch(fullscreenDockResizing, resizing => {
    if (resizing) cancelFullscreenDockArrangementAnimations()
  })

  function getFullscreenDockBounds() {
    const bounds = container.value.getBoundingClientRect()
    const footerSpace = parseFloat(getComputedStyle(container.value).getPropertyValue('--fullscreen-actions-footer-space')) || 0
    return { top: bounds.top, height: Math.max(1, bounds.height - footerSpace) }
  }

  function fullscreenDockCanResize(dock) {
    if (isPortraitLayout()) return false
    const openDocks = getFullscreenOpenDocks()
    const index = openDocks.indexOf(dock)
    return index >= 0 && index < openDocks.length - 1
  }

  function fullscreenDockCanReorder(dock) {
    if (isPortraitLayout()) return false
    const openDocks = getFullscreenOpenDocks()
    return openDocks.length > 1 && openDocks.includes(dock)
  }

  function resetFullscreenDockHeights() {
    for (const dock of fullscreenDockOrder) {
      fullscreenDockWeights[dock] = 1
      fullscreenDockCollapsedState[dock] = null
    }
  }

  function handleFullscreenDockHeaderDoubleClick(event, dock) {
    if (isPortraitLayout()) return
    const target = event.target instanceof Element ? event.target : null
    const header = target?.closest(FULLSCREEN_DOCK_HEADER_SELECTOR)
    const interactiveTarget = target?.closest('button, a, input, select, textarea, [role="button"]')
    if (!header || interactiveTarget || !event.currentTarget.contains(header)) {
      return
    }

    const toggled = toggleFullscreenDockCollapsed(
      getFullscreenOpenDocks(),
      dock,
      fullscreenDockWeights,
      fullscreenDockCollapsedState,
      getFullscreenDockBounds().height
    )

    if (toggled) {
      event.preventDefault()
    }
  }

  function setFullscreenDockBoundary(dock, firstWeight) {
    const openDocks = getFullscreenOpenDocks()
    const index = openDocks.indexOf(dock)
    const nextDock = openDocks[index + 1]
    if (!nextDock) {
      return
    }

    const pairWeight = fullscreenDockWeights[dock] + fullscreenDockWeights[nextDock]
    const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
    // Only enforce the comfortable minimum when every open dock can have
    // it. Dense stacks keep the full header plus a small content sliver so
    // dividers stay useful without clipping the header.
    const panelChrome = FULLSCREEN_DOCK_OUTER_INSET + FULLSCREEN_DOCK_GAP / 2
    const layoutHeight = getFullscreenDockBounds().height
    const preferredMinimumFits = openDocks.length === 2 && layoutHeight >=
      openDocks.length * FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT +
      FULLSCREEN_DOCK_OUTER_INSET * 2 +
      FULLSCREEN_DOCK_GAP * (openDocks.length - 1)
    const minimumHeight = preferredMinimumFits
      ? FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT
      : FULLSCREEN_DOCK_COMPACT_MIN_HEIGHT
    const minimumShare = minimumHeight + panelChrome
    const minimumWeight = Math.min(
      pairWeight / 2,
      minimumShare / layoutHeight * totalWeight
    )
    const clampedWeight = Math.min(pairWeight - minimumWeight, Math.max(minimumWeight, firstWeight))
    fullscreenDockWeights[dock] = clampedWeight
    fullscreenDockWeights[nextDock] = pairWeight - clampedWeight
    fullscreenDockCollapsedState[dock] = null
    fullscreenDockCollapsedState[nextDock] = null
  }

  function handleFullscreenDockResizePointerDown(event, dock) {
    if (event.button !== 0 || fullscreenDockGesturePointerId !== null || !fullscreenDockCanResize(dock)) {
      return
    }

    fullscreenDockGesturePointerId = event.pointerId

    const openDocks = getFullscreenOpenDocks()
    const index = openDocks.indexOf(dock)
    fullscreenDockResizing.value = true
    resizingFullscreenDock = dock
    resizingFullscreenDockWeightBefore = openDocks
      .slice(0, index)
      .reduce((total, name) => total + fullscreenDockWeights[name], 0)
    resizingFullscreenDockTotalWeight = openDocks
      .reduce((total, name) => total + fullscreenDockWeights[name], 0)
    resizingFullscreenDockBounds = getFullscreenDockBounds()
    window.addEventListener('pointermove', handleFullscreenDockResizePointerMove)
    window.addEventListener('pointerup', stopFullscreenDockResize)
    window.addEventListener('pointercancel', stopFullscreenDockResize)
    event.preventDefault()
  }

  function handleFullscreenDockResizePointerMove(event) {
    if (isOtherFullscreenDockPointer(event)) return
    const pointerWeight = (event.clientY - resizingFullscreenDockBounds.top) /
      resizingFullscreenDockBounds.height * resizingFullscreenDockTotalWeight
    setFullscreenDockBoundary(resizingFullscreenDock, pointerWeight - resizingFullscreenDockWeightBefore)
  }

  function stopFullscreenDockResize(event) {
    if (isOtherFullscreenDockPointer(event)) return
    fullscreenDockGesturePointerId = null
    fullscreenDockResizing.value = false
    resizingFullscreenDock = null
    resizingFullscreenDockBounds = null
    window.removeEventListener('pointermove', handleFullscreenDockResizePointerMove)
    window.removeEventListener('pointerup', stopFullscreenDockResize)
    window.removeEventListener('pointercancel', stopFullscreenDockResize)
  }

  onUnmounted(stopFullscreenDockResize)

  const fullscreenDockWidthResizing = ref(false)
  let resizingFullscreenDockWidthOffset = 0
  /** @type {{ end: number, rtl: boolean, maximumWidth: number } | null} */
  let resizingFullscreenDockWidthBounds = null
  /** @type {number | null} */
  let draggedFullscreenDockWidth = null

  /**
   * CSS clamps the saved width again, so shrinking the window keeps the limits.
   * @param {number} width
   */
  function getFullscreenDockWidthValue(width) {
    return `min(clamp(${FULLSCREEN_DOCK_MIN_WIDTH}px, ${width}px, ${FULLSCREEN_DOCK_MAX_WIDTH_SHARE * 100}%), 100%)`
  }

  // A drag sets the width on the container itself, so that it neither re-renders
  // the player every frame nor is reset by a re-render for something else.
  const fullscreenDockWidthStyle = computed(() => {
    const width = store.getters.getFullscreenDockWidth
    if (fullscreenDockWidthResizing.value || !(width > 0) || isPortraitLayout()) return null
    return { '--side-panel-width': getFullscreenDockWidthValue(width) }
  })

  /** @param {number} width */
  function applyDraggedFullscreenDockWidth(width) {
    container.value?.style.setProperty('--side-panel-width', getFullscreenDockWidthValue(width))
  }

  /**
   * The dock column's width if its edge was at `clientX`, measured from the
   * player's inline end.
   * @param {number} clientX
   * @param {{ end: number, rtl: boolean }} bounds
   */
  function getFullscreenDockWidthAt(clientX, bounds) {
    return bounds.rtl ? clientX - bounds.end : bounds.end - clientX
  }

  function getFullscreenDockWidthBounds() {
    const bounds = container.value.getBoundingClientRect()
    const rtl = getComputedStyle(container.value).direction === 'rtl'
    return {
      end: rtl ? bounds.left : bounds.right,
      rtl,
      maximumWidth: bounds.width * FULLSCREEN_DOCK_MAX_WIDTH_SHARE,
    }
  }

  /**
   * @param {number} width
   * @param {number} maximumWidth
   */
  function clampFullscreenDockWidth(width, maximumWidth) {
    return Math.round(Math.max(FULLSCREEN_DOCK_MIN_WIDTH, Math.min(maximumWidth, width)))
  }

  /**
   * The rendered width, which differs from the saved one when it is automatic
   * or clamped to the current player size.
   * @param {HTMLElement} handle
   * @param {{ end: number, rtl: boolean }} bounds
   */
  function getRenderedFullscreenDockWidth(handle, bounds) {
    const handleBounds = handle.getBoundingClientRect()
    return getFullscreenDockWidthAt(bounds.rtl ? handleBounds.right : handleBounds.left, bounds)
  }

  function handleFullscreenDockWidthPointerDown(event) {
    if (event.button !== 0 || fullscreenDockGesturePointerId !== null || isPortraitLayout()) {
      return
    }

    fullscreenDockGesturePointerId = event.pointerId

    // The player keeps its size during the drag, so measure it only once.
    const bounds = getFullscreenDockWidthBounds()
    resizingFullscreenDockWidthBounds = bounds
    const renderedWidth = getRenderedFullscreenDockWidth(event.currentTarget, bounds)
    // Keep the grabbed point under the pointer instead of snapping the edge to it.
    resizingFullscreenDockWidthOffset = renderedWidth - getFullscreenDockWidthAt(event.clientX, bounds)
    draggedFullscreenDockWidth = null
    fullscreenDockWidthResizing.value = true
    // Hold the rendered width once the player stops binding the saved one.
    nextTick(() => {
      if (fullscreenDockWidthResizing.value) {
        applyDraggedFullscreenDockWidth(draggedFullscreenDockWidth ?? renderedWidth)
      }
    })
    window.addEventListener('pointermove', handleFullscreenDockWidthPointerMove)
    window.addEventListener('pointerup', stopFullscreenDockWidthResize)
    window.addEventListener('pointercancel', stopFullscreenDockWidthResize)
    event.preventDefault()
  }

  function handleFullscreenDockWidthPointerMove(event) {
    if (isOtherFullscreenDockPointer(event)) return
    const bounds = resizingFullscreenDockWidthBounds
    draggedFullscreenDockWidth = clampFullscreenDockWidth(
      getFullscreenDockWidthAt(event.clientX, bounds) + resizingFullscreenDockWidthOffset,
      bounds.maximumWidth
    )
    applyDraggedFullscreenDockWidth(draggedFullscreenDockWidth)
  }

  function stopFullscreenDockWidthResize(event) {
    if (!fullscreenDockWidthResizing.value || isOtherFullscreenDockPointer(event)) return
    fullscreenDockGesturePointerId = null
    window.removeEventListener('pointermove', handleFullscreenDockWidthPointerMove)
    window.removeEventListener('pointerup', stopFullscreenDockWidthResize)
    window.removeEventListener('pointercancel', stopFullscreenDockWidthResize)
    // Hand the width back to the player's style binding, which re-renders
    // before the next frame.
    container.value?.style.removeProperty('--side-panel-width')
    fullscreenDockWidthResizing.value = false
    resizingFullscreenDockWidthBounds = null
    const width = draggedFullscreenDockWidth
    draggedFullscreenDockWidth = null
    // A click without a drag keeps an automatic width automatic.
    if (width !== null) {
      // Commit first, so the player renders the width before saving finishes.
      store.commit('setFullscreenDockWidth', width)
      store.dispatch('updateFullscreenDockWidth', width)
    }
  }

  onUnmounted(stopFullscreenDockWidthResize)

  function handleFullscreenDockWidthKeydown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    // The dock sits at the inline end, so moving its edge towards the start widens it.
    const bounds = getFullscreenDockWidthBounds()
    const towardsStart = (event.key === 'ArrowLeft') !== bounds.rtl
    const width = clampFullscreenDockWidth(
      getRenderedFullscreenDockWidth(event.currentTarget, bounds) + (towardsStart ? 20 : -20),
      bounds.maximumWidth
    )
    store.commit('setFullscreenDockWidth', width)
    store.dispatch('updateFullscreenDockWidth', width)
    event.preventDefault()
  }

  function resetFullscreenDockWidth() {
    store.dispatch('updateFullscreenDockWidth', 0)
  }

  function handleFullscreenDockResizeKeydown(event, dock) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }

    const openDocks = getFullscreenOpenDocks()
    const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
    const movement = (event.key === 'ArrowUp' ? -20 : 20) / getFullscreenDockBounds().height * totalWeight
    setFullscreenDockBoundary(dock, fullscreenDockWeights[dock] + movement)
    event.preventDefault()
  }

  let reorderingFullscreenDock = null
  let reorderingFullscreenDockBounds = null

  function handleFullscreenDockReorderPointerDown(event, dock) {
    const target = event.target instanceof Element ? event.target : null
    const header = target?.closest(FULLSCREEN_DOCK_HEADER_SELECTOR)
    const interactiveTarget = target?.closest('button, a, input, select, textarea, [role="button"]')
    if (
      event.button !== 0 || fullscreenDockGesturePointerId !== null || !fullscreenDockCanReorder(dock) ||
      !header || interactiveTarget || !event.currentTarget.contains(header)
    ) {
      return
    }

    fullscreenDockGesturePointerId = event.pointerId

    fullscreenDockReordering.value = true
    reorderingFullscreenDock = dock
    reorderingFullscreenDockBounds = getFullscreenDockBounds()
    window.addEventListener('pointermove', handleFullscreenDockReorderPointerMove)
    window.addEventListener('pointerup', stopFullscreenDockReorder)
    window.addEventListener('pointercancel', stopFullscreenDockReorder)
    event.preventDefault()
  }

  function handleFullscreenDockReorderPointerMove(event) {
    if (isOtherFullscreenDockPointer(event)) return
    const openDocks = getFullscreenOpenDocks()
    const currentIndex = openDocks.indexOf(reorderingFullscreenDock)
    const otherDocks = openDocks.filter(dock => dock !== reorderingFullscreenDock)
    // Hit-test against the target layout derived from the dock weights.
    // Measuring the panels while they animate towards their new slots would
    // force a layout pass per pointer move and oscillate around the pointer.
    const bounds = reorderingFullscreenDockBounds
    const totalWeight = openDocks.reduce((total, name) => total + fullscreenDockWeights[name], 0)
    let insertionIndex = otherDocks.length
    let weightBefore = 0
    let otherIndex = 0
    for (const dock of openDocks) {
      if (dock !== reorderingFullscreenDock) {
        const midpoint = bounds.top +
          (weightBefore + fullscreenDockWeights[dock] / 2) / totalWeight * bounds.height
        if (event.clientY < midpoint) {
          insertionIndex = otherIndex
          break
        }
        otherIndex++
      }
      weightBefore += fullscreenDockWeights[dock]
    }
    if (insertionIndex === currentIndex) {
      return
    }

    const orderIndex = fullscreenDockOrder.indexOf(reorderingFullscreenDock)
    fullscreenDockOrder.splice(orderIndex, 1)
    if (insertionIndex === otherDocks.length) {
      const lastOpenIndex = fullscreenDockOrder.indexOf(otherDocks.at(-1))
      fullscreenDockOrder.splice(lastOpenIndex + 1, 0, reorderingFullscreenDock)
    } else {
      const nextOpenIndex = fullscreenDockOrder.indexOf(otherDocks[insertionIndex])
      fullscreenDockOrder.splice(nextOpenIndex, 0, reorderingFullscreenDock)
    }
  }

  function stopFullscreenDockReorder(event) {
    if (isOtherFullscreenDockPointer(event)) return
    fullscreenDockGesturePointerId = null
    fullscreenDockReordering.value = false
    reorderingFullscreenDock = null
    reorderingFullscreenDockBounds = null
    window.removeEventListener('pointermove', handleFullscreenDockReorderPointerMove)
    window.removeEventListener('pointerup', stopFullscreenDockReorder)
    window.removeEventListener('pointercancel', stopFullscreenDockReorder)
  }

  onUnmounted(stopFullscreenDockReorder)

  /**
   * Expands a collapsed dock that opens on its own, so it doesn't come back as just its header.
   * @param {string} dock
   */
  function expandCollapsedFullscreenDock(dock) {
    const openDocks = getFullscreenOpenDocks(dock)
    if (openDocks.length === 1 && fullscreenDockCollapsedState[dock] != null) {
      toggleFullscreenDockCollapsed(
        openDocks,
        dock,
        fullscreenDockWeights,
        fullscreenDockCollapsedState,
        getFullscreenDockBounds().height
      )
    }
  }

  onBeforeUnmount(() => {
    if (fullscreenDockLayoutFrame !== null) {
      cancelAnimationFrame(fullscreenDockLayoutFrame)
    }
    cancelFullscreenDockAnimations()
    cancelFullscreenDockArrangementAnimations()
  })

  return {
    expandCollapsedFullscreenDock,
    fullscreenDockCanReorder,
    fullscreenDockCanResize,
    fullscreenDockLayoutOpen,
    fullscreenDockOrder,
    fullscreenDockReordering,
    fullscreenDockResizing,
    fullscreenDockStyle,
    fullscreenDockWidthResizing,
    fullscreenDockWidthStyle,
    handleFullscreenDockHeaderDoubleClick,
    handleFullscreenDockReorderPointerDown,
    handleFullscreenDockResizeKeydown,
    handleFullscreenDockResizePointerDown,
    handleFullscreenDockWidthKeydown,
    handleFullscreenDockWidthPointerDown,
    resetFullscreenDockHeights,
    resetFullscreenDockWidth,
  }
}
