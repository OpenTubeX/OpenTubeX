import { nextTick, onBeforeUnmount, onUnmounted, reactive, ref, watch } from 'vue'
import { applyAnimationSpeed } from '../../../helpers/animationSpeed'
import {
  FULLSCREEN_DOCK_GAP,
  FULLSCREEN_DOCK_OUTER_INSET,
  toggleFullscreenDockCollapsed,
} from '../../../helpers/fullscreenDocks'
import { isReducedMotionEnabled } from '../../../helpers/reducedMotion'

const FULLSCREEN_DOCK_PREFERRED_MIN_HEIGHT = 360
const FULLSCREEN_DOCK_COMPACT_MIN_HEIGHT = 96
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

/**
 * Lays out the information docks stacked beside the video in fullscreen and full window:
 * their order and heights, which the viewer can resize, reorder and collapse, and the
 * video's transition when the docks open or close.
 * @param {{
 *   container: import('vue').Ref<HTMLElement | null>,
 *   video: import('vue').Ref<HTMLVideoElement | null>,
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
  fullscreenDockOpen,
  isFullscreenDockOpen,
  isFullscreen,
  isFullWindow,
  isPortraitLayout,
  presentationModeChanging,
}) {
  const fullscreenDockLayoutOpen = ref(false)
  let fullscreenDockLayoutFrame = null
  /** @type {Animation | null} */
  let fullscreenDockVideoAnimation = null
  let fullscreenDockAnimationGeneration = 0

  function cancelFullscreenDockVideoAnimation() {
    fullscreenDockAnimationGeneration++
    fullscreenDockVideoAnimation?.cancel()
    fullscreenDockVideoAnimation = null
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

  // Commit the final layout once, then animate the fitted video on the
  // compositor. Animating its width also reflows Shaka, captions, annotations
  // and ResizeObservers on every frame, even when the dock only slides in.
  watch(fullscreenDockLayoutOpen, async () => {
    const before = getFullscreenDockVideoGeometry()
    cancelFullscreenDockVideoAnimation()
    const generation = fullscreenDockAnimationGeneration
    if (!before || presentationModeChanging.value || isReducedMotionEnabled() ||
      (!isFullscreen.value && !isFullWindow())) return

    await nextTick()
    if (generation !== fullscreenDockAnimationGeneration || presentationModeChanging.value) return
    const after = getFullscreenDockVideoGeometry()
    if (!after || after.width <= 0) return
    const scale = before.width / after.width
    // Zoom/pan uses `transform`. Individual scale/translate keep that intact;
    // compensate for scaling its translation around the element's center.
    const transform = new DOMMatrix(getComputedStyle(video.value).transform)
    const x = before.x - after.x + transform.e * (1 - scale)
    const y = before.y - after.y + transform.f * (1 - scale)
    const animation = applyAnimationSpeed(video.value.animate([
      { scale: String(scale), translate: `${x}px ${y}px` },
      { scale: '1', translate: '0px 0px' },
    ], { duration: 250, easing: 'ease' }))
    fullscreenDockVideoAnimation = animation
    animation.addEventListener('finish', () => {
      if (fullscreenDockVideoAnimation === animation) fullscreenDockVideoAnimation = null
    })
  })

  watch(presentationModeChanging, changing => {
    if (changing) cancelFullscreenDockVideoAnimation()
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
    if (event.button !== 0 || !fullscreenDockCanResize(dock)) {
      return
    }

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
    const pointerWeight = (event.clientY - resizingFullscreenDockBounds.top) /
      resizingFullscreenDockBounds.height * resizingFullscreenDockTotalWeight
    setFullscreenDockBoundary(resizingFullscreenDock, pointerWeight - resizingFullscreenDockWeightBefore)
  }

  function stopFullscreenDockResize() {
    fullscreenDockResizing.value = false
    resizingFullscreenDock = null
    resizingFullscreenDockBounds = null
    window.removeEventListener('pointermove', handleFullscreenDockResizePointerMove)
    window.removeEventListener('pointerup', stopFullscreenDockResize)
    window.removeEventListener('pointercancel', stopFullscreenDockResize)
  }

  onUnmounted(stopFullscreenDockResize)

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
      event.button !== 0 || !fullscreenDockCanReorder(dock) || !header ||
      interactiveTarget || !event.currentTarget.contains(header)
    ) {
      return
    }

    fullscreenDockReordering.value = true
    reorderingFullscreenDock = dock
    reorderingFullscreenDockBounds = getFullscreenDockBounds()
    window.addEventListener('pointermove', handleFullscreenDockReorderPointerMove)
    window.addEventListener('pointerup', stopFullscreenDockReorder)
    window.addEventListener('pointercancel', stopFullscreenDockReorder)
    event.preventDefault()
  }

  function handleFullscreenDockReorderPointerMove(event) {
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

  function stopFullscreenDockReorder() {
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
    cancelFullscreenDockVideoAnimation()
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
    handleFullscreenDockHeaderDoubleClick,
    handleFullscreenDockReorderPointerDown,
    handleFullscreenDockResizeKeydown,
    handleFullscreenDockResizePointerDown,
    resetFullscreenDockHeights,
  }
}
