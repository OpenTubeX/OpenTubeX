import { watch } from 'vue'

import store from '../store/index'
import {
  addScrollSpeedHandler,
  DEFAULT_SCROLL_SPEED,
  normalizeScrollSpeed
} from './scrollSpeed'
import { initializePageScrollbar, observePageScrollbarVisibility } from './pageScrollbar'
import { addScrollbarAutoHide } from './scrollbarAutoHide'
import { setAndroidAlwaysShowScrollbars, setAndroidPageScrollbarsHidden } from './androidUi'

/*
 * Chromium's own overlay scrollbars can't be styled and fade out when idle,
 * so scroll containers hide their native scrollbars and get drawn ones that
 * float above the content. Scrolling itself stays native; the bars only
 * display and drive it.
 *
 * Each bar is appended to its scroll container (the page's to the body) as
 * `.os-scrollbar > .os-scrollbar-track-host > .os-scrollbar-track >
 * .os-scrollbar-handle` and themed in overlayScrollbars.css through --os-*
 * custom properties. Nested tracks are sticky, so they stay in view with
 * the content's own scroll offset, and scroll-linked animations move the
 * handles along them. Size and content observers only remeasure their sizes.
 */

const VIEWPORT_ATTRIBUTE = 'data-overlayscrollbars-viewport'
// Browsers without scroll-linked animations, such as Firefox, position the
// bars from scroll events instead.
const SCROLL_LINKED = typeof ScrollTimeline !== 'undefined'
// A remaining range up to this size is rounding at fractional zoom levels,
// not content a bar could scroll to.
const SCROLL_BOUNDARY_TOLERANCE = 1
const CLICK_SCROLL_DISTANCE = 0.9
// E2E tests fail on this error, see e2e/helpers/app.mjs.
const UNPOSITIONED_VIEWPORT_ERROR = 'Overlay scrollbars need a positioned scroll container, use position: relative instead of static'
const CLIPPED_OVERFLOW = new Set(['hidden', 'clip'])
const ANIMATION_END_EVENTS = ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']
// Transitions of these, such as hover effects, cannot change a scroll range.
const PAINT_ONLY_PROPERTIES = new Set([
  'background-color', 'border-color', 'box-shadow', 'color', 'fill', 'filter',
  'opacity', 'outline-color', 'stroke', 'text-decoration-color', 'visibility'
])

/**
 * @typedef {object} Scrollbar
 * @property {'x' | 'y'} axis
 * @property {HTMLElement} scrollbar
 * @property {HTMLElement} trackHost the sticky track's containing block
 * @property {HTMLElement} track
 * @property {string} stickyGeometry the track's sticky offsets and travel of the last update
 * @property {HTMLElement} handle
 * @property {boolean} usable
 * @property {number} span how far the handle travels along the track
 * @property {Animation | null} handleAnimation
 */

/**
 * @typedef {object} Instance
 * @property {HTMLElement} element the element the bars were added to
 * @property {HTMLElement} scrollElement the element whose offsets scroll
 * @property {boolean} isPage
 * @property {Scrollbar} horizontal
 * @property {Scrollbar} vertical
 * @property {{ x?: ScrollTimeline, y?: ScrollTimeline }} timelines
 * @property {string} measurement
 * @property {{ x: number, y: number }} ranges the scroll ranges of the last update
 * @property {boolean} rtl
 * @property {boolean} atEnd whether the container is scrolled to its vertical end
 * @property {number} clientHeight the viewport height of the last update
 * @property {number} range the vertical scroll range of the last update
 * @property {(intended?: boolean) => void} syncScrollPosition
 * @property {(() => void) | null} drag reapplies an active handle drag
 * @property {(force?: boolean) => void} update
 * @property {(force?: boolean) => UpdateStages | null} prepareUpdate
 * @property {() => void} destroy
 */

/**
 * An update split into its layout reads and style writes. Running each stage
 * for every bar that changed in a frame before the next keeps them from
 * forcing a layout per container, such as while a window with several of
 * them resizes.
 *
 * @typedef {object} UpdateStages
 * @property {() => void} write
 * @property {(() => void) | undefined} [measure]
 * @property {(() => void) | undefined} [apply]
 */

/** @type {Map<HTMLElement, Instance>} */
const instances = new Map()
/** @type {WeakMap<Instance, () => void>} */
const removeScrollSpeedHandlers = new WeakMap()
/** @type {WeakMap<Instance, () => void>} */
const removeAutoHideHandlers = new WeakMap()
/** Observed elements, including scroll containers' direct children, to their instance. */
const observedElements = new WeakMap()
let resizeObserver = null

function getResizeObserver() {
  resizeObserver ??= new ResizeObserver(entries => {
    /** @type {Map<Instance, boolean>} */
    const changed = new Map()
    for (const { target } of entries) {
      const instance = observedElements.get(target)
      // A resized track (thumb width, corner, layout overrides) changes the
      // handle's travel even when the scroll container measures the same.
      if (instance) changed.set(instance, changed.get(instance) || target.classList.contains('os-scrollbar-track'))
    }
    // Updating inside the callback, after layout and before paint, keeps
    // the bars in step with the frame that changed the content.
    updateInstances(changed)
  })
  return resizeObserver
}

/** @param {Map<Instance, boolean>} changed instances and whether to force their update */
function updateInstances(changed) {
  const stages = []
  for (const [instance, force] of changed) {
    const instanceStages = instance.prepareUpdate(force)
    if (instanceStages) stages.push(instanceStages)
  }
  for (const { write } of stages) write()
  for (const { measure } of stages) measure?.()
  for (const { apply } of stages) apply?.()
}

/** @param {'x' | 'y'} axis */
function createScrollbar(axis) {
  const scrollbar = document.createElement('div')
  scrollbar.className = `os-scrollbar os-scrollbar-${axis === 'x' ? 'horizontal' : 'vertical'} ` +
    'os-scrollbar-handle-interactive os-scrollbar-cornerless os-scrollbar-unusable'
  const trackHost = document.createElement('div')
  trackHost.className = 'os-scrollbar-track-host'
  const track = document.createElement('div')
  track.className = 'os-scrollbar-track'
  const handle = document.createElement('div')
  handle.className = 'os-scrollbar-handle'
  track.append(handle)
  trackHost.append(track)
  scrollbar.append(trackHost)

  /** @type {Scrollbar} */
  return { axis, scrollbar, trackHost, track, stickyGeometry: '', handle, usable: false, span: 0, handleAnimation: null }
}

/**
 * @param {Element} element
 * @param {string} className
 * @param {boolean} enabled
 */
function setClass(element, className, enabled) {
  // Even unchanged class writes would notify mutation observers watching the bars.
  if (element.classList.contains(className) !== enabled) {
    element.classList.toggle(className, enabled)
  }
}

/**
 * @param {Animation | null} animation
 * @param {HTMLElement} target
 * @param {Keyframe[]} keyframes
 * @param {ScrollTimeline} timeline
 */
function setScrollLinkedKeyframes(animation, target, keyframes, timeline) {
  if (animation) {
    animation.effect.setKeyframes(keyframes)
    return animation
  }
  // Without filling, an offset at the exact end of the range is outside the
  // animation's active interval and would drop the transform.
  return target.animate(keyframes, { timeline, fill: 'both' })
}

/**
 * Nested bars are laid out at the scroll origin, where they can never extend
 * the scroll range. Their sticky tracks hold their place in the scrollport,
 * which Chromium measures from the container's content box, as the content
 * scrolls. A scroll-linked animation of the tracks would run a frame ahead
 * of the content whenever the compositor draws it late.
 *
 * @param {Scrollbar} bar
 * @param {{ paddingTop: string, paddingLeft: string, paddingRight: string }} containerStyle
 * @param {boolean} rtl
 */
function measureStickyGeometry(bar, containerStyle, rtl) {
  const style = getComputedStyle(bar.scrollbar)
  const px = (value) => Number.parseFloat(value) || 0
  const block = px(style.top) + px(style.borderTopWidth) + px(style.paddingTop) - px(containerStyle.paddingTop)
  const inline = rtl
    ? px(style.right) + px(style.borderRightWidth) + px(style.paddingRight) - px(containerStyle.paddingRight)
    : px(style.left) + px(style.borderLeftWidth) + px(style.paddingLeft) - px(containerStyle.paddingLeft)
  return { block, inline }
}

/**
 * @param {Scrollbar} bar
 * @param {{ block: number, inline: number }} offsets from measureStickyGeometry
 * @param {{ x: number, y: number }} ranges
 */
function applyStickyGeometry(bar, { block, inline }, ranges) {
  const geometry = `${block},${inline},${ranges.x},${ranges.y}`
  if (geometry === bar.stickyGeometry) return
  bar.stickyGeometry = geometry
  bar.track.style.setProperty('--os-track-sticky-block', `${block}px`)
  bar.track.style.setProperty('--os-track-sticky-inline', `${inline}px`)
  // The extra pixel covers ranges rounded down at fractional zoom levels.
  const travel = (range) => `${range > 0 ? range + 1 : 0}px`
  bar.trackHost.style.setProperty('--os-track-travel-block', travel(ranges.y))
  bar.trackHost.style.setProperty('--os-track-travel-inline', travel(ranges.x))
}

/**
 * @param {HTMLElement} element
 * @returns {Instance}
 */
function create(element) {
  const isPage = element === document.body
  const scrollElement = isPage ? document.documentElement : element
  const horizontal = createScrollbar('x')
  const vertical = createScrollbar('y')
  const scrollbars = [horizontal, vertical]
  const clickScroll = !process.env.IS_CAPACITOR && element.matches('[data-scrollbar-click-scroll]')
  // Windowed lists estimate rows that never mounted, so their range can grow
  // after a scroll to the end mounts the last rows.
  const keepEnd = !isPage && element.matches('[data-scrollbar-keep-end]')
  let updateFrame = null
  let reportedStatic = false

  /** @type {Instance} */
  const instance = {
    element,
    scrollElement,
    isPage,
    horizontal,
    vertical,
    timelines: {},
    measurement: '',
    ranges: { x: 0, y: 0 },
    rtl: false,
    atEnd: false,
    clientHeight: -1,
    range: 0,
    syncScrollPosition,
    drag: null,
    update,
    prepareUpdate,
    destroy
  }

  const getTimeline = (axis) => {
    instance.timelines[axis] ??= new ScrollTimeline({ source: scrollElement, axis })
    return instance.timelines[axis]
  }

  function update(force = false) {
    const stages = prepareUpdate(force)
    if (!stages) return
    stages.write()
    stages.measure?.()
    stages.apply?.()
  }

  /**
   * Measures the container and returns the writes for its bars, or null when
   * they are current.
   *
   * @param {boolean} force
   * @returns {UpdateStages | null}
   */
  function prepareUpdate(force) {
    if (!element.isConnected) return null
    // A hidden container has nothing to scroll. It reports its size again
    // once shown, so skip measuring it until then.
    if (!isPage && !element.checkVisibility()) {
      instance.measurement = ''
      return {
        write() {
          for (const bar of scrollbars) {
            bar.usable = false
            setClass(bar.scrollbar, 'os-scrollbar-visible', false)
            setClass(bar.scrollbar, 'os-scrollbar-unusable', true)
          }
        }
      }
    }

    const style = getComputedStyle(scrollElement)
    // The bars are positioned against their container. A static one hands
    // them to an ancestor, which draws them beside the content they scroll.
    if (!isPage && !reportedStatic && style.position === 'static') {
      reportedStatic = true
      console.error(`${UNPOSITIONED_VIEWPORT_ERROR}: ${element.localName}.${[...element.classList].join('.')}`)
    }
    const rtl = (isPage ? getComputedStyle(document.body) : style).direction === 'rtl'
    const sizes = {
      x: { scroll: scrollElement.scrollWidth, client: scrollElement.clientWidth },
      y: { scroll: scrollElement.scrollHeight, client: scrollElement.clientHeight }
    }
    const ranges = {
      x: Math.max(0, sizes.x.scroll - sizes.x.client),
      y: Math.max(0, sizes.y.scroll - sizes.y.client)
    }

    // A container scrolled to its end stays there while its viewport resizes,
    // also through intermediate layouts that shortened its range, and with
    // `keepEnd` while its content grows, unless it was scrolled away since.
    if (!isPage && instance.atEnd &&
      (sizes.y.client !== instance.clientHeight ||
        (keepEnd && ranges.y > instance.range && scrollElement.scrollTop >= instance.range - SCROLL_BOUNDARY_TOLERANCE)) &&
      scrollElement.scrollTop < ranges.y - SCROLL_BOUNDARY_TOLERANCE) {
      scrollElement.scrollTop = ranges.y
    }
    instance.clientHeight = sizes.y.client
    instance.range = ranges.y
    instance.atEnd = ranges.y > SCROLL_BOUNDARY_TOLERANCE &&
      scrollElement.scrollTop >= ranges.y - SCROLL_BOUNDARY_TOLERANCE

    // The computed style is live, so copy what later stages read before any
    // write can make reading it restyle the document.
    const { overflowX, overflowY, paddingTop, paddingLeft, paddingRight } = style
    const measurement = [
      sizes.x.scroll, sizes.x.client, sizes.y.scroll, sizes.y.client,
      overflowX, overflowY, rtl,
      paddingTop, paddingLeft, paddingRight
    ].join()
    if (!force && measurement === instance.measurement) return null
    instance.measurement = measurement
    const containerStyle = { paddingTop, paddingLeft, paddingRight }
    /** @type {number[]} */
    let spans = []
    /** @type {{ block: number, inline: number }[]} */
    let stickyOffsets = []

    return {
      write() {
        for (const bar of scrollbars) {
          const overflow = bar.axis === 'x' ? overflowX : overflowY
          bar.usable = !CLIPPED_OVERFLOW.has(overflow) && ranges[bar.axis] > SCROLL_BOUNDARY_TOLERANCE
          const { scroll, client } = sizes[bar.axis]
          bar.scrollbar.style.setProperty('--os-viewport-percent', String(bar.usable ? client / scroll : 1))
        }
        for (const bar of scrollbars) {
          setClass(bar.scrollbar, 'os-scrollbar-visible', bar.usable)
          setClass(bar.scrollbar, 'os-scrollbar-unusable', !bar.usable)
          setClass(bar.scrollbar, 'os-scrollbar-cornerless', !horizontal.usable || !vertical.usable)
          setClass(bar.scrollbar, 'os-scrollbar-rtl', rtl)
        }
      },
      // Measure every usable bar before writing any animation, so restyling one
      // cannot force another layout for the next.
      measure() {
        spans = scrollbars.map(bar => {
          if (!bar.usable) return 0
          return bar.axis === 'x'
            ? bar.track.clientWidth - bar.handle.offsetWidth
            : bar.track.clientHeight - bar.handle.offsetHeight
        })
        if (!isPage) stickyOffsets = scrollbars.map(bar => measureStickyGeometry(bar, containerStyle, rtl))
      },
      apply() {
        instance.ranges = ranges
        instance.rtl = rtl
        scrollbars.forEach((bar, index) => {
          bar.span = Math.max(0, spans[index])
        })
        if (!isPage) {
          scrollbars.forEach((bar, index) => applyStickyGeometry(bar, stickyOffsets[index], ranges))
        }
        if (!SCROLL_LINKED) {
          positionFromScroll()
          instance.drag?.()
          return
        }

        scrollbars.forEach((bar) => {
          if (!bar.usable) {
            bar.handleAnimation?.cancel()
            bar.handleAnimation = null
            return
          }

          const span = bar.span
          const translate = bar.axis === 'x' ? 'translateX' : 'translateY'
          bar.handleAnimation = setScrollLinkedKeyframes(bar.handleAnimation, bar.handle, [
            { transform: `${translate}(0px)` },
            { transform: `${translate}(${bar.axis === 'x' && rtl ? -span : span}px)` }
          ], getTimeline(bar.axis))
        })

        instance.drag?.()
      }
    }
  }

  let positionFrame = null
  function positionFromScroll() {
    positionFrame = null
    const { scrollLeft, scrollTop } = scrollElement
    for (const bar of scrollbars) {
      if (!bar.usable) {
        bar.handle.style.removeProperty('transform')
        continue
      }
      const range = instance.ranges[bar.axis]
      const offset = bar.axis === 'x' ? scrollLeft : scrollTop
      const travel = Math.min(Math.abs(offset) / range, 1) * bar.span
      bar.handle.style.transform = bar.axis === 'x'
        ? `translateX(${instance.rtl ? -travel : travel}px)`
        : `translateY(${travel}px)`
    }
  }
  const schedulePosition = () => {
    positionFrame ??= requestAnimationFrame(positionFromScroll)
  }
  const positionEventTarget = isPage ? window : element

  /** @param {boolean} [intended] whether the app has just set the offset itself */
  function syncScrollPosition(intended = false) {
    const range = scrollElement.scrollHeight - scrollElement.clientHeight
    // A changed range can have clamped the offset, which must not count as
    // scrolling away from the end. The update for that layout decides.
    if (!intended && range !== instance.range) {
      scheduleUpdate()
      return
    }
    instance.atEnd = range > SCROLL_BOUNDARY_TOLERANCE &&
      scrollElement.scrollTop >= range - SCROLL_BOUNDARY_TOLERANCE
  }

  const onScroll = () => syncScrollPosition()

  const scheduleUpdate = () => {
    updateFrame ??= requestAnimationFrame(() => {
      updateFrame = null
      update()
    })
  }

  /** Keeps observing the container's direct children, whose sizes make up its content. */
  const observeChildren = (nodes, observe) => {
    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || node.classList.contains('os-scrollbar')) continue
      if (observe) {
        observedElements.set(node, instance)
        getResizeObserver().observe(node)
      } else if (node.parentNode !== element && observedElements.get(node) === instance) {
        // A child moved into another marked container belongs to that one now.
        observedElements.delete(node)
        getResizeObserver().unobserve(node)
      }
    }
  }

  // Locking the page's scrolling changes its overflow without resizing it.
  const pageStyleObserver = new MutationObserver(() => scheduleUpdate())

  const mutationObserver = new MutationObserver(records => {
    let contentChanged = false
    for (const record of records) {
      if (record.target === element) {
        observeChildren(record.addedNodes, true)
        observeChildren(record.removedNodes, false)
      }
      contentChanged ||= !(record.target instanceof Element && record.target.closest('.os-scrollbar'))
    }
    // Code that replaces a container's children takes the bars with them.
    for (const { scrollbar } of scrollbars) {
      if (scrollbar.parentNode !== element) element.append(scrollbar)
    }
    // Removed children no longer report their size, and content can overflow
    // a child that keeps its own size.
    if (contentChanged) scheduleUpdate()
  })

  const onWindowResize = () => update()
  // Transforms and out-of-flow content change the scroll range without
  // resizing anything observed. Remeasure once their animations settle.
  const onAnimationEnd = (event) => {
    if (event.target instanceof Element && event.target.closest('.os-scrollbar')) return
    if (event.propertyName !== undefined && PAINT_ONLY_PROPERTIES.has(event.propertyName)) return
    scheduleUpdate()
  }
  const animationEventTarget = isPage ? document : element

  for (const bar of scrollbars) {
    addHandleDrag(instance, bar)
    if (clickScroll) addClickScroll(instance, bar)
    observedElements.set(bar.track, instance)
    getResizeObserver().observe(bar.track)
  }

  if (isPage) {
    // The window's height and the document's content are separate sizes.
    for (const observed of [document.documentElement, document.body]) {
      observedElements.set(observed, instance)
      getResizeObserver().observe(observed)
    }
    window.addEventListener('resize', onWindowResize)
    for (const observed of [document.documentElement, document.body]) {
      pageStyleObserver.observe(observed, { attributes: true, attributeFilter: ['class', 'style'] })
    }
  } else {
    element.setAttribute(VIEWPORT_ATTRIBUTE, '')
    element.addEventListener('scroll', onScroll, { passive: true })
    observedElements.set(element, instance)
    getResizeObserver().observe(element)
    observeChildren(element.children, true)
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true })
  }
  element.append(horizontal.scrollbar, vertical.scrollbar)
  if (!SCROLL_LINKED) positionEventTarget.addEventListener('scroll', schedulePosition, { passive: true })
  for (const type of ANIMATION_END_EVENTS) {
    animationEventTarget.addEventListener(type, onAnimationEnd, { passive: true })
  }

  function destroy() {
    if (updateFrame !== null) cancelAnimationFrame(updateFrame)
    if (positionFrame !== null) cancelAnimationFrame(positionFrame)
    positionEventTarget.removeEventListener('scroll', schedulePosition)
    mutationObserver.disconnect()
    pageStyleObserver.disconnect()
    element.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onWindowResize)
    for (const type of ANIMATION_END_EVENTS) {
      animationEventTarget.removeEventListener(type, onAnimationEnd)
    }
    const observer = getResizeObserver()
    const observed = [
      ...(isPage ? [document.documentElement, document.body] : [element, ...element.children]),
      ...scrollbars.map(bar => bar.track)
    ]
    for (const target of observed) {
      if (observedElements.get(target) === instance) {
        observedElements.delete(target)
        observer.unobserve(target)
      }
    }
    for (const bar of scrollbars) {
      bar.handleAnimation?.cancel()
      bar.scrollbar.remove()
    }
    instance.drag = null
    removeScrollSpeedHandler(instance)
    removeAutoHideHandlers.get(instance)?.()
    removeAutoHideHandlers.delete(instance)
    instances.delete(element)
  }

  instances.set(element, instance)
  updateAutoHideHandler(instance)
  updateScrollSpeedHandler(instance)
  if (isPage) updatePageScrollbarPosition(instance)
  return instance
}

/**
 * Pointer moves can arrive faster than Chromium paints a long video feed, so
 * a dragged handle scrolls at most once per frame. Each frame places the grab
 * point under the pointer within the current track and range, which keeps it
 * there when content loads during the drag.
 *
 * @param {Instance} instance
 * @param {Scrollbar} bar
 */
function addHandleDrag(instance, bar) {
  const { handle, track, axis } = bar

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || !bar.usable) return
    // The press still reaches the container, whose handlers can read it as
    // scroll intent.
    event.preventDefault()

    const pointerId = event.pointerId
    const handleBounds = handle.getBoundingClientRect()
    const rtl = axis === 'x' && bar.scrollbar.classList.contains('os-scrollbar-rtl')
    // Where along the handle it was grabbed, which stays under the pointer
    // when the handle's length changes.
    const grabRatio = axis === 'y'
      ? (event.clientY - handleBounds.top) / handleBounds.height
      : (rtl ? handleBounds.right - event.clientX : event.clientX - handleBounds.left) / handleBounds.width
    let pointer = axis === 'x' ? event.clientX : event.clientY
    let frame = null

    const applyDrag = () => {
      frame = null
      const { scrollElement } = instance
      const trackBounds = track.getBoundingClientRect()
      const handleLength = axis === 'x' ? handle.offsetWidth : handle.offsetHeight
      const span = (axis === 'x' ? track.clientWidth : track.clientHeight) - handleLength
      const grab = grabRatio * handleLength
      const range = axis === 'x'
        ? scrollElement.scrollWidth - scrollElement.clientWidth
        : scrollElement.scrollHeight - scrollElement.clientHeight
      if (span <= 0 || range <= 0) return

      const handleOffset = axis === 'y'
        ? pointer - grab - trackBounds.top
        : rtl ? trackBounds.right - pointer - grab : pointer - grab - trackBounds.left
      const progress = Math.min(Math.max(handleOffset / span, 0), 1)
      if (axis === 'x') {
        scrollElement.scrollTo({ left: (rtl ? -progress : progress) * range, behavior: 'instant' })
      } else {
        scrollElement.scrollTo({ top: progress * range, behavior: 'instant' })
      }
    }

    const scheduleDrag = () => {
      frame ??= requestAnimationFrame(applyDrag)
    }

    const onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      moveEvent.stopPropagation()
      pointer = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
      scheduleDrag()
    }

    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== pointerId) return
      finishEvent.stopPropagation()
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      handle.removeEventListener('lostpointercapture', finish)
      if (instance.drag === scheduleDrag) instance.drag = null
      if (frame !== null) {
        cancelAnimationFrame(frame)
        applyDrag()
      }
    }

    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    // Moving the bars, when a container's children are replaced, releases
    // the capture without a pointerup.
    handle.addEventListener('lostpointercapture', finish)
    instance.drag = scheduleDrag
    handle.setPointerCapture(pointerId)
  })
}

/**
 * Scrolls a page towards a pressed point on the track. Only bars in their own
 * strip opt in; elsewhere the empty track lets clicks reach the content below.
 *
 * @param {Instance} instance
 * @param {Scrollbar} bar
 */
function addClickScroll(instance, bar) {
  const { scrollbar, track, handle, axis } = bar
  scrollbar.classList.add('os-scrollbar-track-interactive')

  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || !bar.usable || event.target !== track) return
    event.preventDefault()

    const { scrollElement } = instance
    const handleBounds = handle.getBoundingClientRect()
    const pointer = axis === 'x' ? event.clientX : event.clientY
    // Offsets are physical, also in RTL, where scrollLeft is negative.
    const direction = pointer > (axis === 'x' ? handleBounds.right : handleBounds.bottom) ? 1 : -1
    const page = (axis === 'x' ? scrollElement.clientWidth : scrollElement.clientHeight) * CLICK_SCROLL_DISTANCE
    scrollElement.scrollBy(axis === 'x' ? { left: direction * page } : { top: direction * page })
  })
}

/** Change visibility policy without rebuilding the bars or losing offsets. */
function updateAutoHideHandler(instance) {
  removeAutoHideHandlers.get(instance)?.()
  removeAutoHideHandlers.delete(instance)
  const { horizontal, vertical } = instance
  if (store.getters.getAlwaysShowScrollbars) {
    for (const { scrollbar } of [horizontal, vertical]) {
      scrollbar.classList.remove('app-scrollbar-idle')
    }
  } else {
    removeAutoHideHandlers.set(instance, addScrollbarAutoHide({
      host: instance.element,
      scrollEventElement: instance.isPage ? window : instance.element,
      scrollbars: [horizontal.scrollbar, vertical.scrollbar]
    }))
  }
}

/**
 * Blocking wheel listeners keep Chromium's scrolling on the main thread, so
 * only install them while a custom speed is active. At 100%, Chromium handles
 * wheel and touchpad input without renderer involvement.
 *
 * @param {Instance} instance
 */
function updateScrollSpeedHandler(instance) {
  const usesCustomSpeed = normalizeScrollSpeed(store.getters.getScrollSpeed) !== DEFAULT_SCROLL_SPEED
  const hasHandler = removeScrollSpeedHandlers.has(instance)

  if (usesCustomSpeed && !hasHandler) {
    removeScrollSpeedHandlers.set(instance, addScrollSpeedHandler(
      instance.scrollElement,
      () => store.getters.getScrollSpeed
    ))
  } else if (!usesCustomSpeed && hasHandler) {
    removeScrollSpeedHandler(instance)
  }
}

/** @param {Instance} instance */
function removeScrollSpeedHandler(instance) {
  removeScrollSpeedHandlers.get(instance)?.()
  removeScrollSpeedHandlers.delete(instance)
}

/**
 * Keeps the page scrollbar clear of a right-side vertical tab rail, which is
 * fixed above the window edge the bar is attached to. A left-side rail does
 * not cover that edge and needs no offset.
 *
 * @param {Instance} instance
 */
function updatePageScrollbarPosition(instance) {
  const { scrollbar } = instance.vertical
  const position = store.getters.getTabBarPosition
  const width = `${store.getters.getVerticalTabBarWidth}px`

  // Moving between layouts should be atomic so the page scrollbar never
  // sweeps across (or briefly remains behind) the fixed tab rail.
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
 * Replaces the main window's scrollbars. The document keeps scrolling
 * natively, so `window.scrollTo`, `window.scrollY` and its scroll events work.
 */
export function initializeAppScrollbars({ useNativePageScrollbar = false } = {}) {
  initializePageScrollbar(document, useNativePageScrollbar, create)

  if (useNativePageScrollbar) {
    observePageScrollbarVisibility(document, hidden => {
      setAndroidPageScrollbarsHidden(hidden).catch(error => {
        console.warn('Could not update Android page scrollbar visibility', error)
      })
    })
  }

  // Switching between LTR and RTL languages flips the direction every bar
  // inherits, which no size change reports.
  const directionObserver = new MutationObserver(() => {
    updateInstances(new Map([...instances.values()].map(instance => [instance, false])))
  })
  for (const element of [document.documentElement, document.body]) {
    directionObserver.observe(element, { attributes: true, attributeFilter: ['dir'] })
  }

  watch(
    () => normalizeScrollSpeed(store.getters.getScrollSpeed),
    () => {
      for (const instance of instances.values()) {
        updateScrollSpeedHandler(instance)
      }
    },
    { flush: 'sync' }
  )

  watch(
    () => [store.getters.getTabBarPosition, store.getters.getVerticalTabBarWidth],
    () => {
      const instance = instances.get(document.body)
      if (instance) updatePageScrollbarPosition(instance)
    }
  )

  // Cancel pending hides in place; retained tabs can have many live scrollers.
  watch(() => store.getters.getAlwaysShowScrollbars, enabled => {
    for (const instance of instances.values()) updateAutoHideHandler(instance)
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
  const instance = instances.get(element)

  if (enabled && !instance) {
    create(element)
  } else if (!enabled && instance) {
    instance.destroy()
    element.removeAttribute(VIEWPORT_ATTRIBUTE)
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

/** Remeasures an element's scrollbars. @param {HTMLElement} element */
export function updateOverlayScrollbars(element) {
  instances.get(element)?.update(true)
}

/**
 * Restores a consumer-managed scroll position, for example after a scroll
 * container moves between layouts, and updates its bars for the new range.
 *
 * @param {HTMLElement} element
 * @param {number} scrollTop
 */
export function restoreOverlayScrollTop(element, scrollTop) {
  element.scrollTop = scrollTop
  const instance = instances.get(element)
  instance?.syncScrollPosition(true)
  instance?.update()
}

/**
 * Clamps an offset that was valid before dynamically rendered content became
 * shorter, when the scroll range extends past the content's real end.
 *
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentElement the element whose rendered end defines the real scroll range
 */
export function clampOverlayScrollTop(element, contentElement = null) {
  const isPage = element === document.body
  const scrollElement = isPage ? document.documentElement : element
  const maximumScrollTop = getMaximumOverlayScrollTop(
    scrollElement,
    contentElement,
    isPage ? window.innerHeight : scrollElement.clientHeight
  )
  const instance = instances.get(element)
  if (isScrollTopOutOfBounds(scrollElement, maximumScrollTop)) {
    scrollElement.scrollTop = maximumScrollTop
    if (!isPage) instance?.syncScrollPosition(true)
  }
  instance?.update()
}

/**
 * Clamps a horizontal offset that was valid before dynamically rendered
 * content became narrower.
 *
 * @param {HTMLElement} element
 * @param {HTMLElement | null} contentElement
 */
export function clampOverlayScrollLeft(element, contentElement = null) {
  // scrollWidth stops at the padding box, but the content's borders are rendered too.
  const contentWidth = contentElement === null
    ? element.scrollWidth
    : contentElement.scrollWidth + contentElement.offsetWidth - contentElement.clientWidth
  const maximumScrollLeft = Math.max(0, contentWidth - element.clientWidth)
  const rtl = getComputedStyle(element).direction === 'rtl'
  const isOutOfBounds = rtl
    ? element.scrollLeft < -maximumScrollLeft - SCROLL_BOUNDARY_TOLERANCE
    : element.scrollLeft > maximumScrollLeft + SCROLL_BOUNDARY_TOLERANCE
  if (isOutOfBounds) {
    element.scrollLeft = rtl ? -maximumScrollLeft : maximumScrollLeft
  }
  instances.get(element)?.update()
}

/**
 * Checks whether a nested scroll container is beyond its content's real end
 * without updating its bars. Useful for hot scroll handlers that should only
 * call `clampOverlayScrollTop` when a clamp is necessary.
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
  // an integer. Treat that subpixel difference as the same position.
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
    const instance = instances.get(element)
    if (!instance) return

    // A parent transition can keep this element visible after Vue has already
    // unmounted the directive. Keep its native scrollbars hidden during that
    // leave animation; the element is about to be removed from the DOM.
    instance.destroy()
  }
}
