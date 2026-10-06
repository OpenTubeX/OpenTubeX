import { watch } from 'vue'
import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars'

import store from '../store/index'
import {
  addScrollSpeedHandler,
  DEFAULT_SCROLL_SPEED,
  normalizeScrollSpeed
} from './scrollSpeed'
import { initializePageScrollbar, observePageScrollbarVisibility } from './pageScrollbar'
import { addScrollbarAutoHide } from './scrollbarAutoHide'
import { setAndroidAlwaysShowScrollbars, setAndroidPageScrollbarsHidden } from './androidUi'

// Kept out of the core bundle by the library, so `clickScroll` below silently
// does nothing unless it is registered.
OverlayScrollbars.plugin(ClickScrollPlugin)

/*
 * Chromium's own overlay scrollbars can't be styled and fade out when idle,
 * so we hide the native ones and draw our own instead. The look is themed in
 * themes.css via the library's --os-* custom properties.
 */

/**
 * Every live instance and how it was set up.
 *
 * @type {Map<import('overlayscrollbars').OverlayScrollbars, HTMLElement | object>}
 */
const instances = new Map()
/** @type {WeakMap<import('overlayscrollbars').OverlayScrollbars, () => void>} */
const removeScrollSpeedHandlers = new WeakMap()
/** @type {WeakMap<import('overlayscrollbars').OverlayScrollbars, () => void>} */
const removeAutoHideHandlers = new WeakMap()
const SCROLL_BOUNDARY_TOLERANCE = 1
const suspendScrollbarPosition = new WeakMap()

function scrollbarOptions(initialization) {
  const options = {
    scrollbars: {
      // Our move-to-show handler changes classes only when visibility changes.
      // The library's 'move' mode rewrites them on every scroll frame.
      autoHide: 'never',
      // Track taps on a phone are easy to trigger while using nearby content.
      // Keep desktop track clicks, but let mobile touches reach the content;
      // the handle remains draggable on both platforms.
      clickScroll: !process.env.IS_CAPACITOR
    }
  }

  if (initialization === document.body) {
    // The page viewport is always a normal block-flow body. Avoid repeatedly
    // reading all flow-related computed styles while long feeds are changing;
    // only direction can change at runtime. Tab-bar mutations stay inside its
    // clipped viewport and cannot change the page's scroll range.
    options.update = {
      debounce: { resize: [0, 33] },
      ignoreMutation: ignorePageScrollbarMutation,
      flowDirectionStyles: () => ({ direction: document.documentElement.dir })
    }
  }

  return options
}

/** @param {MutationRecord} mutation */
function ignorePageScrollbarMutation(mutation) {
  const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
  return element?.closest('.tabBar') != null
}

/**
 * @param {HTMLElement | object} initialization the target element, or a full
 * initialization object when the caller wants to pick the scrolling element
 */
function create(initialization) {
  const instance = OverlayScrollbars(initialization, scrollbarOptions(initialization))
  instances.set(instance, initialization)
  updateAutoHideHandler(instance)
  updateScrollSpeedHandler(instance)
  instance.on('destroyed', () => {
    instances.delete(instance)
    removeScrollSpeedHandler(instance)
    removeAutoHideHandlers.get(instance)?.()
    removeAutoHideHandlers.delete(instance)
  })

  if (initialization === document.body) {
    updateBodyScrollbarPosition(instance)
    optimizeBodyScrollbarDrag(instance)
  } else if (initialization.elements?.viewport instanceof HTMLElement) {
    reconcileScrollbarOnResize(initialization.elements.viewport, instance)
    synchronizeScrollbarPosition(initialization.elements.viewport, instance)
  }

  return instance
}

/** Change visibility policy without rebuilding observers, tracks or offsets. */
function updateAutoHideHandler(instance) {
  removeAutoHideHandlers.get(instance)?.()
  removeAutoHideHandlers.delete(instance)
  if (store.getters.getAlwaysShowScrollbars) {
    const { scrollbarHorizontal, scrollbarVertical } = instance.elements()
    for (const { scrollbar } of [scrollbarHorizontal, scrollbarVertical]) {
      scrollbar.classList.remove('app-scrollbar-idle')
    }
  } else {
    removeAutoHideHandlers.set(instance, addScrollbarAutoHide(instance.elements()))
  }
}

/**
 * Keep nested scrollbar tracks fixed during compositor-driven touch scrolling.
 * The library positions tracks inside a reused viewport from scroll events,
 * which can arrive after Chromium has already painted the scrolled content.
 */
function synchronizeScrollbarPosition(element, instance) {
  if (!window.ScrollTimeline) return
  const timeline = new window.ScrollTimeline({ source: element, axis: 'y' })
  const { scrollbarVertical, scrollbarHorizontal } = instance.elements()
  let animations = []
  let previousRange = -1
  let suspended = false
  let touchScrolling = process.env.IS_CAPACITOR || window.matchMedia('(pointer: coarse)').matches
  const cancelAnimations = () => {
    animations.forEach(animation => animation.cancel())
    animations = []
    previousRange = -1
  }
  const update = () => {
    if (suspended || !touchScrolling) return
    const { overflowAmount } = instance.state()
    // Only vertical overflow needs synchronization. The library still handles
    // two-axis scrollers and older WebViews.
    if (overflowAmount.x > 1 || overflowAmount.y <= 0) {
      cancelAnimations()
      return
    }
    if (overflowAmount.y === previousRange) return
    previousRange = overflowAmount.y
    const frames = { transform: ['translateY(0px)', `translateY(${previousRange}px)`] }
    if (animations.length) animations.forEach(animation => animation.effect.setKeyframes(frames))
    else animations = [scrollbarVertical, scrollbarHorizontal].map(({ scrollbar }) => scrollbar.animate(frames, { timeline }))
  }
  // OverlayScrollbars positions the track during wheel scrolling. Its updates
  // can compete with the scroll-linked animation and make the thumb jump.
  const onWheel = () => {
    if (!touchScrolling) return
    touchScrolling = false
    cancelAnimations()
  }
  const onTouchStart = () => {
    if (touchScrolling) return
    touchScrolling = true
    update()
  }
  element.addEventListener('wheel', onWheel, { passive: true })
  element.addEventListener('touchstart', onTouchStart, { passive: true })
  suspendScrollbarPosition.set(instance, () => {
    suspended = true
    cancelAnimations()
    return () => {
      suspended = false
      update()
    }
  })
  update()
  instance.on('updated', update)
  instance.on('destroyed', () => {
    suspendScrollbarPosition.delete(instance)
    element.removeEventListener('wheel', onWheel)
    element.removeEventListener('touchstart', onTouchStart)
    cancelAnimations()
  })
}

/**
 * Blocking wheel listeners keep Chromium's scrolling on the main thread, so
 * only install them while a custom speed is active. At 100%, Chromium handles
 * wheel and touchpad input without renderer involvement.
 *
 * @param {import('overlayscrollbars').OverlayScrollbars} instance
 */
function updateScrollSpeedHandler(instance) {
  const usesCustomSpeed = normalizeScrollSpeed(store.getters.getScrollSpeed) !== DEFAULT_SCROLL_SPEED
  const hasHandler = removeScrollSpeedHandlers.has(instance)

  if (usesCustomSpeed && !hasHandler) {
    const { scrollOffsetElement } = instance.elements()
    removeScrollSpeedHandlers.set(instance, addScrollSpeedHandler(
      scrollOffsetElement,
      () => store.getters.getScrollSpeed
    ))
  } else if (!usesCustomSpeed && hasHandler) {
    removeScrollSpeedHandler(instance)
  }
}

/** @param {import('overlayscrollbars').OverlayScrollbars} instance */
function removeScrollSpeedHandler(instance) {
  removeScrollSpeedHandlers.get(instance)?.()
  removeScrollSpeedHandlers.delete(instance)
}

/**
 * Keeps the page scrollbar clear of a right-side vertical tab rail.
 * OverlayScrollbars appends this element directly to the body, so app padding
 * cannot move it out from underneath the fixed rail by itself. A left-side
 * rail does not cover the scrollbar's normal window edge and needs no offset.
 *
 * @param {import('overlayscrollbars').OverlayScrollbars} instance
 */
function updateBodyScrollbarPosition(instance) {
  const { scrollbar } = instance.elements().scrollbarVertical
  const position = store.getters.getTabBarPosition
  const width = `${store.getters.getVerticalTabBarWidth}px`

  // OverlayScrollbars transitions physical edges by default. Moving between
  // layouts should be atomic so the page scrollbar never sweeps across (or
  // briefly remains behind) the fixed tab rail.
  scrollbar.classList.add('os-scrollbar-transitionless')
  scrollbar.style.removeProperty('left')
  scrollbar.style.removeProperty('right')

  if (position === 'right') {
    scrollbar.style.right = width
  }

  requestAnimationFrame(() => {
    scrollbar.classList.remove('os-scrollbar-transitionless')
  })
}

/**
 * Opening transitions and widening wrapped content can shorten the scroll
 * range. Chromium can retain the obsolete end offset as the viewport grows,
 * which also leaves a scrollbar for overflow that no longer exists. Remeasure
 * from the true origin, then restore the old position within the new range.
 *
 * @param {HTMLElement} element
 * @param {import('overlayscrollbars').OverlayScrollbars} instance
 */
function reconcileScrollbarOnResize(element, instance) {
  let previousHeight = element.clientHeight
  let previousWidth = element.getBoundingClientRect().width
  let resizeFrame = null
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame)
    }

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      const height = element.clientHeight
      // Preserve fractional widths: even a subpixel change can unwrap a line.
      const width = element.getBoundingClientRect().width
      const viewportGrew = height > previousHeight || width > previousWidth
      previousHeight = height
      previousWidth = width
      // The library already observes ordinary size changes. Our extra pass is
      // needed only for invalid offsets or a retained end after either axis grows.
      const scrollTop = element.scrollTop
      if (scrollTop <= 0) return
      const maximumScrollTop = Math.max(0, element.scrollHeight - height)
      const outOfBounds = scrollTop > maximumScrollTop + SCROLL_BOUNDARY_TOLERANCE
      if (!outOfBounds && (!viewportGrew || scrollTop < maximumScrollTop - SCROLL_BOUNDARY_TOLERANCE)) return
      const resumeScrollbars = suspendScrollbarPosition.get(instance)?.()
      try {
        // Content can shrink (trimmed live chat) or the viewport can grow after a
        // dock transition while an obsolete end offset is still applied — that
        // parks the view on empty space until the user scrolls up.
        if (outOfBounds) {
          element.scrollTop = maximumScrollTop
          instance.update(true)
          return
        }

        element.scrollTop = 0
        instance.update(true)
        element.scrollTop = Math.min(scrollTop, instance.state().overflowAmount.y)
        instance.update(true)
      } finally {
        resumeScrollbars?.()
      }
    })
  })

  resizeObserver.observe(element)
  instance.on('destroyed', () => {
    resizeObserver.disconnect()
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame)
    }
  })
}

/**
 * OverlayScrollbars applies every pointermove directly while a handle is
 * dragged. Mouse input can arrive faster than Chromium can paint a long video
 * feed, making the handle trail the pointer. Coalesce the page scrollbar's
 * moves to one native scroll per animation frame.
 *
 * @param {import('overlayscrollbars').OverlayScrollbars} instance
 */
function optimizeBodyScrollbarDrag(instance) {
  const { handle, track } = instance.elements().scrollbarVertical

  const onPointerDown = (event) => {
    if (event.button !== 0 || !event.isPrimary) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    const pointerId = event.pointerId
    const handleBounds = handle.getBoundingClientRect()
    const grabRatio = (event.clientY - handleBounds.top) / handleBounds.height
    let clientY = event.clientY
    let frame = null

    if (track.clientHeight <= handle.clientHeight || instance.state().overflowAmount.y <= 0) {
      return
    }

    const applyDrag = () => {
      frame = null
      const scrollRange = instance.state().overflowAmount.y
      const currentHandleBounds = handle.getBoundingClientRect()
      const trackRange = track.clientHeight - handle.clientHeight
      const handleOffset = clientY -
        (currentHandleBounds.top + currentHandleBounds.height * grabRatio)

      if (trackRange <= 0 || scrollRange <= 0) {
        return
      }

      window.scrollTo(
        window.scrollX,
        window.scrollY + handleOffset / trackRange * scrollRange
      )
    }

    const scheduleDrag = () => {
      frame ??= requestAnimationFrame(applyDrag)
    }

    const onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return
      }

      moveEvent.preventDefault()
      moveEvent.stopPropagation()
      clientY = moveEvent.clientY
      scheduleDrag()
    }

    const onUpdated = (_, { updateHints }) => {
      if (updateHints.overflowAmountChanged || updateHints.overflowEdgeChanged) {
        scheduleDrag()
      }
    }

    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return
      }

      finishEvent.stopPropagation()
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      instance.off('updated', onUpdated)

      if (frame !== null) {
        cancelAnimationFrame(frame)
        applyDrag()
      }
    }

    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    instance.on('updated', onUpdated)
    handle.setPointerCapture(pointerId)
  }

  handle.addEventListener('pointerdown', onPointerDown, true)
  instance.on('destroyed', () => handle.removeEventListener('pointerdown', onPointerDown, true))
}

/**
 * Replaces the main window's scrollbars. `window.scrollTo`, `window.scrollY`
 * and the document's scroll events keep working when the body is the target.
 */
export function initializeAppScrollbars({ useNativePageScrollbar = false } = {}) {
  initializePageScrollbar(document, useNativePageScrollbar, create)

  if (useNativePageScrollbar) {
    observePageScrollbarVisibility(document, hidden => {
      setAndroidPageScrollbarsHidden(hidden).catch(error => {
        console.warn('Could not update Android fullscreen scrollbar visibility', error)
      })
    })
  }

  watch(
    () => normalizeScrollSpeed(store.getters.getScrollSpeed),
    () => {
      for (const instance of instances.keys()) {
        updateScrollSpeedHandler(instance)
      }
    },
    { flush: 'sync' }
  )

  watch(
    () => [store.getters.getTabBarPosition, store.getters.getVerticalTabBarWidth],
    () => {
      for (const [instance, initialization] of instances) {
        if (initialization === document.body) {
          updateBodyScrollbarPosition(instance)
        }
      }
    }
  )

  // Cancel pending hides in place; retained tabs can have many live scrollers.
  watch(() => store.getters.getAlwaysShowScrollbars, enabled => {
    for (const instance of instances.keys()) updateAutoHideHandler(instance)
    if (useNativePageScrollbar) {
      setAndroidAlwaysShowScrollbars(enabled).catch(error => {
        console.warn('Could not update Android scrollbar visibility', error)
      })
    }
  }, { immediate: true })
}

/**
 * @param {HTMLElement} element
 * @param {boolean} enabled
 */
function toggleOverlayScrollbars(element, enabled) {
  const instance = OverlayScrollbars(element)

  if (enabled && !instance) {
    // Hides the native scrollbars for the moment before the library takes over,
    // the same way index.ejs does it for the page itself.
    element.setAttribute('data-overlayscrollbars-initialize', '')
    // Reusing the element as the viewport keeps it the scrolling element, so
    // existing scrollTop/scrollLeft handling and CSS carry on working.
    create({ target: element, elements: { viewport: element } })
  } else if (!enabled && instance) {
    element.removeAttribute('data-overlayscrollbars-initialize')
    instance.destroy()
  }
}

/**
 * Adds the overlay scrollbars to an element that isn't rendered by Vue, so it
 * can't use the directive below. Safe to call again for the same element.
 *
 * @param {HTMLElement} element
 */
export function addOverlayScrollbars(element) {
  toggleOverlayScrollbars(element, true)
}

/**
 * Counterpart of `addOverlayScrollbars`. Elements that are replaced rather than
 * unmounted have to give up their instance themselves, otherwise it outlives
 * them in `instances`.
 *
 * @param {HTMLElement} element
 */
export function removeOverlayScrollbars(element) {
  toggleOverlayScrollbars(element, false)
}

/** Forces an existing instance to remeasure its overflow. @param {HTMLElement} element */
export function updateOverlayScrollbars(element) {
  OverlayScrollbars(element)?.update(true)
}

/**
 * Forces any pending layout update before restoring a consumer-managed scroll
 * position. This is needed when a scroll container moves between layouts,
 * because OverlayScrollbars otherwise restores its previous offset afterwards.
 *
 * @param {HTMLElement} element
 * @param {number} scrollTop
 */
export function restoreOverlayScrollTop(element, scrollTop) {
  const instance = OverlayScrollbars(element)
  instance?.update(true)
  element.scrollTop = scrollTop
  // Setting an offset can change the browser's effective scroll range when a
  // previously valid position became stale after the viewport grew.
  instance?.update(true)
}

/**
 * Recalculates a nested scroll container's range and clamps an offset that was
 * valid before dynamically rendered content became shorter.
 *
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentElement the element whose rendered end defines the real scroll range
 */
export function clampOverlayScrollTop(element, contentElement = null) {
  if (element === document.body) {
    const scrollOffsetElement = document.documentElement
    const maximumScrollTop = getMaximumOverlayScrollTop(scrollOffsetElement, contentElement, window.innerHeight)
    scrollOffsetElement.scrollTop = Math.min(scrollOffsetElement.scrollTop, maximumScrollTop)
    return
  }

  const instance = OverlayScrollbars(element)
  // A compositor animation can retain the old track offset during this DOM update.
  // Remove that overflow contribution before measuring the shortened content.
  const resumeScrollbars = suspendScrollbarPosition.get(instance)?.()
  try {
    const scrollOffsetElement = instance?.elements().scrollOffsetElement ?? element
    instance?.update(true)
    const maximumScrollTop = getMaximumOverlayScrollTop(scrollOffsetElement, contentElement)
    const previousScrollTop = scrollOffsetElement.scrollTop
    // Chromium can retain native overflow after the library has already measured
    // the shorter range. Check both measurements before preserving the offset.
    const retainedOverflow = contentElement && instance && Math.max(
      instance.state().overflowAmount.y,
      scrollOffsetElement.scrollHeight - scrollOffsetElement.clientHeight
    ) > maximumScrollTop + SCROLL_BOUNDARY_TOLERANCE
    if (isScrollTopOutOfBounds(scrollOffsetElement, maximumScrollTop) || retainedOverflow) {
      if (instance) {
        // Chromium can preserve the old overflow range when content shrinks
        // beneath a non-zero offset. Remeasure from the true origin so both the
        // viewport and OverlayScrollbars discard that stale range, then restore
        // the clamped position within the newly measured range.
        scrollOffsetElement.scrollTop = 0
        instance.update(true)
        scrollOffsetElement.scrollTop = Math.min(previousScrollTop, maximumScrollTop, instance.state().overflowAmount.y)
        instance.update(true)
      } else {
        scrollOffsetElement.scrollTop = maximumScrollTop
      }
    }
  } finally {
    resumeScrollbars?.()
  }
}

/**
 * Recalculates a nested horizontal scroll container's range and clamps an
 * offset that was valid before dynamically rendered content became narrower.
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentElement
 */
export function clampOverlayScrollLeft(element, contentElement = null) {
  const instance = OverlayScrollbars(element)
  const scrollOffsetElement = instance?.elements().scrollOffsetElement ?? element
  instance?.update(true)

  const maximumScrollLeft = Math.max(
    0,
    (contentElement?.scrollWidth ?? scrollOffsetElement.scrollWidth) - scrollOffsetElement.clientWidth
  )
  const rtl = getComputedStyle(scrollOffsetElement).direction === 'rtl'
  const isOutOfBounds = rtl
    ? scrollOffsetElement.scrollLeft < -maximumScrollLeft - SCROLL_BOUNDARY_TOLERANCE
    : scrollOffsetElement.scrollLeft > maximumScrollLeft + SCROLL_BOUNDARY_TOLERANCE
  if (!isOutOfBounds) return

  if (instance) {
    scrollOffsetElement.scrollLeft = 0
    instance.update(true)
    const available = instance.state().overflowAmount.x
    scrollOffsetElement.scrollLeft = rtl
      ? -Math.min(maximumScrollLeft, available)
      : Math.min(maximumScrollLeft, available)
    instance.update(true)
  } else {
    scrollOffsetElement.scrollLeft = rtl ? -maximumScrollLeft : maximumScrollLeft
  }
}

/**
 * Checks whether a nested scroll container is beyond its content's real end
 * without forcing an OverlayScrollbars update. Useful for hot scroll handlers
 * that should only call `clampOverlayScrollTop` when a clamp is necessary.
 *
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentElement the element whose rendered end defines the real scroll range
 */
export function isOverlayScrollTopOutOfBounds(element, contentElement = null) {
  return isScrollTopOutOfBounds(element, getMaximumOverlayScrollTop(element, contentElement))
}

/**
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentElement
 * @param {number} [viewportHeight]
 */
function getMaximumOverlayScrollTop(element, contentElement, viewportHeight = element.clientHeight) {
  const contentMarginBlockEnd = contentElement === null
    ? 0
    : Number.parseFloat(getComputedStyle(contentElement).marginBlockEnd) || 0
  const contentEnd = contentElement === null
    ? element.scrollHeight
    : offsetTopFromDocument(contentElement) - offsetTopFromDocument(element) +
      contentElement.offsetHeight +
      contentMarginBlockEnd +
      Number.parseFloat(getComputedStyle(element).paddingBottom)
  return Math.max(0, contentEnd - viewportHeight)
}

/**
 * @param {HTMLElement} element
 * @param {number} maximumScrollTop
 */
function isScrollTopOutOfBounds(element, maximumScrollTop) {
  // Electron zoom can leave the real scroll boundary at a fractional CSS
  // pixel even though offsetHeight / clientHeight round the calculated end to
  // an integer. Treat that subpixel difference as the same position; trying
  // to clamp it makes OverlayScrollbars restore the fractional boundary and
  // starts a reset / restore loop on every subsequent scroll event.
  return element.scrollTop > maximumScrollTop + SCROLL_BOUNDARY_TOLERANCE
}

/** @param {HTMLElement} element */
function offsetTopFromDocument(element) {
  let offsetTop = 0
  let currentElement = element
  while (currentElement != null) {
    offsetTop += currentElement.offsetTop
    currentElement = currentElement.offsetParent
  }
  return offsetTop
}

/**
 * `v-overlay-scrollbars` - does the same for a nested scroll container.
 * Pass `false` to leave the native scrollbars alone, for containers that only
 * scroll in some layouts.
 *
 * Surviving a `<Teleport>` is fine. Use `restoreOverlayScrollTop` when the
 * destination layout needs a different offset.
 */
export const overlayScrollbarsDirective = {
  mounted(element, binding) {
    toggleOverlayScrollbars(element, binding.value !== false)
  },

  updated(element, binding) {
    toggleOverlayScrollbars(element, binding.value !== false)
  },

  unmounted(element) {
    const hadOverlayScrollbars = OverlayScrollbars(element) != null
    toggleOverlayScrollbars(element, false)
    if (!hadOverlayScrollbars) {
      return
    }

    // A parent transition can keep this element visible after Vue has already
    // unmounted the directive. Keep native scrollbars suppressed during that
    // leave animation; the element is about to be removed from the DOM.
    element.setAttribute('data-overlayscrollbars-initialize', '')
  }
}
