import { applyAnimationSpeed } from '../../helpers/animationSpeed'
import { motionTiming } from '../../helpers/motionTiming'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'

// Opening tabs pop in as a dot and stretch into place; closing tabs squeeze
// back into the dot, which vanishes while its neighbors close the gap.
//
// Every frame of these animations runs on the compositor: the strip takes its
// final layout at once, a clip path draws the stretching or squeezing tab, and
// the other tabs slide from where they were with `translate`. Animating sizes
// or margins instead would lay out, paint and commit the whole window on each
// frame, which slows the page opening beside the strip.
const DOT_SIZE_PX = 22
const DOT_SCALE = 'scale(0.3)'
const DECELERATE = 'cubic-bezier(0.05, 0.7, 0.1, 1)'
const ACCELERATE = 'cubic-bezier(0.3, 0, 0.8, 0.15)'
const POP_DURATION_MS = 120
const STRETCH_DELAY_MS = 90
const CONTENT_FADE_IN_DELAY_MS = 230
const CONTENT_FADE_DURATION_MS = 160
const CONTENT_FADE_OUT_DURATION_MS = 80
const SQUEEZE_DELAY_MS = 40
const SQUEEZE_DURATION_MS = 300
// The closing tab has squeezed into the dot at this point of its animation.
const SQUEEZED_OFFSET = 0.7
const SAMPLE_INTERVAL_MS = 1000 / 60

/**
 * @param {string} easing a `linear()` or `cubic-bezier()` timing function
 * @returns {(progress: number) => number}
 */
export function parseEasing(easing) {
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(easing.trim())
  if (bezier) {
    const [x1, y1, x2, y2] = bezier[1].split(',').map(Number)
    return cubicBezier(x1, y1, x2, y2)
  }
  const linear = /^linear\((.+)\)$/s.exec(easing.trim())
  if (linear) return linearEasing(linear[1])
  return progress => progress
}

function cubicBezier(x1, y1, x2, y2) {
  const sample = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  return (progress) => {
    if (progress <= 0 || progress >= 1) return progress
    let low = 0
    let high = 1
    let t = progress
    for (let index = 0; index < 30; index++) {
      const x = sample(x1, x2, t)
      if (Math.abs(x - progress) < 1e-5) break
      if (x < progress) low = t
      else high = t
      t = (low + high) / 2
    }
    return sample(y1, y2, t)
  }
}

/**
 * Evaluates the stops of a `linear()` timing function, including stops with
 * one or two input percentages.
 * @param {string} stopList
 */
function linearEasing(stopList) {
  /** @type {{ output: number, input: number | null }[]} */
  const stops = []
  for (const stop of stopList.split(',')) {
    const [output, ...inputs] = stop.trim().split(/\s+/)
    if (inputs.length === 0) stops.push({ output: Number(output), input: null })
    for (const input of inputs) stops.push({ output: Number(output), input: parseFloat(input) / 100 })
  }
  stops[0].input ??= 0
  stops[stops.length - 1].input ??= 1
  // Inputs never decrease, and stops without one are spread evenly between
  // their neighbors.
  for (let index = 1; index < stops.length; index++) {
    if (stops[index].input !== null) {
      stops[index].input = Math.max(stops[index].input, stops[index - 1].input)
      continue
    }
    let next = index
    while (stops[next].input === null) next++
    const start = stops[index - 1].input
    const step = (Math.max(stops[next].input, start) - start) / (next - index + 1)
    for (let fill = index; fill < next; fill++) stops[fill].input = start + step * (fill - index + 1)
  }
  return (progress) => {
    if (progress <= stops[0].input) return stops[0].output
    for (let index = 1; index < stops.length; index++) {
      const { input, output } = stops[index]
      if (progress > input) continue
      const previous = stops[index - 1]
      if (input === previous.input) return output
      return previous.output + (output - previous.output) * (progress - previous.input) / (input - previous.input)
    }
    return stops[stops.length - 1].output
  }
}

/**
 * The part of the space an opening tab takes in the strip at `time`, as it
 * pops in and stretches. Its neighbors move by this part of their distance.
 * @param {object} options
 * @param {number} options.size the tab's final size along the strip
 * @param {number} options.dotSize the dot's size along the strip
 * @param {number} options.gap
 * @param {{ duration: number, easing: string }} options.stretch
 * @returns {{ duration: number, easing: string }}
 */
export function getOpeningSpaceTiming({ size, dotSize, gap, stretch }) {
  const pop = parseEasing(DECELERATE)
  const stretchEasing = parseEasing(stretch.easing)
  const duration = Math.max(POP_DURATION_MS, STRETCH_DELAY_MS + stretch.duration)
  const total = size + gap
  const steps = Math.max(1, Math.ceil(duration / SAMPLE_INTERVAL_MS))
  const points = []
  for (let step = 0; step <= steps; step++) {
    const time = duration * step / steps
    const stretchProgress = stretch.duration > 0
      ? stretchEasing(Math.min(1, Math.max(0, (time - STRETCH_DELAY_MS) / stretch.duration)))
      : 1
    // The dot starts out of the row behind a negative margin, which goes
    // while it pops in.
    const margin = -(dotSize + gap) * (1 - pop(Math.min(1, time / POP_DURATION_MS)))
    const occupied = dotSize + (size - dotSize) * stretchProgress + gap + margin
    points.push(total > 0 ? Math.round(occupied / total * 10000) / 10000 : 1)
  }
  return { duration, easing: `linear(${points.join(', ')})` }
}

/**
 * The box an element lays out to, without its `translate` and scale.
 * @param {HTMLElement} element
 */
function getLayoutRect(element) {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform)
  const [translateX = 0, translateY = 0] = style.translate === 'none' ? [] : style.translate.split(' ').map(parseFloat)
  const [originX, originY] = style.transformOrigin.split(' ').map(parseFloat)
  return {
    left: rect.left - translateX - matrix.e - originX * (1 - matrix.a),
    top: rect.top - translateY - matrix.f - originY * (1 - matrix.d),
    width: rect.width / (matrix.a || 1),
    height: rect.height / (matrix.d || 1)
  }
}

/**
 * Enter and leave hooks for the strip's `TransitionGroup`. Each strip item is a
 * `display: contents` wrapper, so the hooks animate the tab inside it.
 * @param {object} options
 * @param {() => boolean} options.isVertical
 * @param {() => boolean} options.shouldAnimateEnter false while the strip shows
 * its initial tabs, which should appear at once
 * @param {() => HTMLElement | null} options.getStrip the element holding the strip items
 * @param {() => HTMLElement | null} options.getGhostLayer a clipping layer over
 * the strip's viewport, outside its scroll range, that shows closing tabs
 * @param {(item: HTMLElement) => void} options.onEnter runs once an opening tab
 * has its final layout, before the strip is measured for the animation
 * @param {(item: HTMLElement) => void} options.onEntered
 * @param {() => void} options.onLeft runs after a closed item is removed
 */
export function useTabStripTransition({ isVertical, shouldAnimateEnter, getStrip, getGhostLayer, onEnter: onEnterLayout, onEntered, onLeft }) {
  /** @type {Map<Element, { tab: HTMLElement, animations: Animation[], done: () => void }>} */
  const running = new Map()
  /** Slides of strip items toward their new positions. @type {Map<Element, Animation>} */
  const slides = new Map()
  /** @type {Set<{ ghost: HTMLElement, animations: Animation[] }>} */
  const ghosts = new Set()
  /** Strip item positions before the current update inserted items. @type {Map<Element, DOMRect> | null} */
  let positionsBeforeEnter = null

  /**
   * @param {Element | null} strip
   * @returns {HTMLElement[]}
   */
  function getItems(strip) {
    if (!strip) return []
    return Array.from(strip.children, wrapper => wrapper.firstElementChild)
      .filter(item => item instanceof HTMLElement)
  }

  /** @param {HTMLElement[]} items */
  function measure(items) {
    return new Map(items.map(item => [item, item.getBoundingClientRect()]))
  }

  /**
   * @param {Element} strip
   * @returns {number} the space between strip items
   */
  function getGap(strip) {
    const style = getComputedStyle(strip)
    return parseFloat(isVertical() ? style.rowGap : style.columnGap) || 0
  }

  /** @param {HTMLElement} tab */
  function getCornerRadius(tab) {
    return getComputedStyle(tab).borderTopLeftRadius || '0px'
  }

  /** @param {Element} strip */
  function isRightToLeft(strip) {
    return !isVertical() && getComputedStyle(strip).direction === 'rtl'
  }

  /**
   * A clip that shows only the dot at the tab's inline start.
   * @param {string} radius
   * @param {boolean} rtl
   */
  function dotClip(radius, rtl) {
    const inset = `calc(100% - ${DOT_SIZE_PX}px)`
    return rtl ? `inset(0 0 0 ${inset} round ${radius})` : `inset(0 ${inset} 0 0 round ${radius})`
  }

  /** @param {boolean} rtl */
  function dotOrigin(rtl) {
    return rtl ? `calc(100% - ${DOT_SIZE_PX / 2}px) 50%` : `${DOT_SIZE_PX / 2}px 50%`
  }

  /** Stop the slides, which returns the strip items to their layout. */
  function stopSlides() {
    slides.forEach(animation => animation.cancel())
    slides.clear()
  }

  /**
   * Slide the strip items from where they were drawn to their new layout.
   * @param {Map<Element, DOMRect>} before
   * @param {HTMLElement[]} items
   * @param {(distance: string) => Keyframe[]} keyframes from the distance to
   * cover to the item's place
   * @param {KeyframeAnimationOptions} timing
   */
  function slide(before, items, keyframes, timing) {
    for (const [item, after] of measure(items)) {
      const position = before.get(item)
      if (!position) continue
      const x = position.left - after.left
      const y = position.top - after.top
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
      const animation = applyAnimationSpeed(item.animate(keyframes([x, y]), timing))
      slides.set(item, animation)
      animation.finished.then(() => {
        if (slides.get(item) !== animation) return
        slides.delete(item)
        animation.cancel()
      }, () => {})
    }
  }

  /**
   * @param {Element} wrapper
   * @param {HTMLElement} tab
   * @param {Animation[]} animations
   * @param {() => void} done
   */
  function track(wrapper, tab, animations, done) {
    const entry = { tab, animations: animations.map(applyAnimationSpeed), done }
    running.set(wrapper, entry)
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (running.get(wrapper) !== entry) return
      running.delete(wrapper)
      entry.animations.forEach(animation => animation.cancel())
      tab.style.removeProperty('transform-origin')
      done()
    }, () => {})
  }

  /**
   * Hold the current frame of an interrupted animation, so the next one
   * starts where it stopped.
   * @param {Element} wrapper
   */
  function freeze(wrapper) {
    const entry = running.get(wrapper)
    if (!entry) return
    running.delete(wrapper)
    for (const animation of entry.animations) {
      try {
        animation.commitStyles()
      } catch {
        // Unrendered elements have no frame to keep.
      }
      animation.cancel()
    }
  }

  /**
   * Record where the strip items are before the update inserts new ones.
   */
  function onBeforeEnter() {
    if (positionsBeforeEnter || !shouldAnimateEnter() || isReducedMotionEnabled()) return
    positionsBeforeEnter = measure(getItems(getStrip()))
    // The enter hooks of the same update run before this.
    queueMicrotask(() => { positionsBeforeEnter = null })
  }

  /**
   * @param {Element} wrapper
   * @param {() => void} done
   */
  function onEnter(wrapper, done) {
    const tab = wrapper.firstElementChild
    const strip = wrapper.parentElement
    if (!(tab instanceof HTMLElement) || !strip || !positionsBeforeEnter ||
      !shouldAnimateEnter() || isReducedMotionEnabled()) {
      done()
      return
    }

    const items = getItems(strip)
    // Items inserted by the same update start where they are drawn now.
    const before = new Map([...measure(items), ...positionsBeforeEnter])
    stopSlides()
    onEnterLayout(tab)

    const vertical = isVertical()
    const rtl = isRightToLeft(strip)
    const radius = getCornerRadius(tab)
    const rect = tab.getBoundingClientRect()
    const size = vertical ? rect.height : rect.width
    const stretch = motionTiming('--motion-default-spatial', 450, DECELERATE)
    const space = getOpeningSpaceTiming({
      size,
      dotSize: vertical ? size : DOT_SIZE_PX,
      gap: getGap(strip),
      stretch
    })

    // The new tab moves with the item before it, which moves only when the
    // strip scrolls to reveal it.
    const index = items.indexOf(tab)
    const previous = items[index - 1]
    const previousBefore = previous && before.get(previous)
    if (previousBefore) {
      const previousAfter = previous.getBoundingClientRect()
      before.set(tab, {
        left: rect.left + previousBefore.left - previousAfter.left,
        top: rect.top + previousBefore.top - previousAfter.top
      })
    }
    slide(before, items, ([x, y]) => [{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], space)

    tab.style.transformOrigin = dotOrigin(rtl)
    const animations = [
      tab.animate(
        { opacity: [0, 1], transform: [DOT_SCALE, 'none'] },
        { duration: POP_DURATION_MS, easing: DECELERATE, fill: 'backwards' }
      ),
      // The clip's size follows the tab's, so the tab keeps stretching toward
      // its current size when its title changes while it opens.
      tab.animate(
        { clipPath: [dotClip(radius, rtl), `inset(0 0 0 0 round ${radius})`] },
        { ...stretch, delay: STRETCH_DELAY_MS, fill: 'backwards' }
      ),
      // A filter fades the content without overriding the opacity of controls
      // that are hidden until hover.
      ...Array.from(tab.children, child => child.animate(
        { filter: ['opacity(0)', 'opacity(1)'] },
        { duration: CONTENT_FADE_DURATION_MS, delay: CONTENT_FADE_IN_DELAY_MS, fill: 'backwards' }
      ))
    ]
    track(wrapper, tab, animations, () => {
      done()
      onEntered(tab)
    })
  }

  /**
   * @param {Element} wrapper
   */
  function onEnterCancelled(wrapper) {
    freeze(wrapper)
  }

  /**
   * A copy of a closing tab in the ghost layer, drawn where the tab is.
   * @param {HTMLElement} tab
   * @param {ReturnType<typeof getLayoutRect>} box
   * @param {HTMLElement} layer
   */
  function createGhost(tab, box, layer) {
    const translate = getComputedStyle(tab).translate
    const layerRect = layer.getBoundingClientRect()
    const ghost = /** @type {HTMLElement} */ (tab.cloneNode(true))
    for (const element of [ghost, ...ghost.querySelectorAll('[id]')]) element.removeAttribute('id')
    ghost.removeAttribute('data-reorder-id')
    ghost.inert = true
    Object.assign(ghost.style, {
      position: 'absolute',
      left: `${box.left - layerRect.left}px`,
      top: `${box.top - layerRect.top}px`,
      inlineSize: `${box.width}px`,
      blockSize: `${box.height}px`,
      minInlineSize: '0px',
      maxInlineSize: 'none',
      margin: '0px',
      translate,
      transition: 'none'
    })
    layer.append(ghost)
    return ghost
  }

  /**
   * @param {Element} wrapper
   * @param {() => void} done
   */
  function onLeave(wrapper, done) {
    const tab = wrapper.firstElementChild
    const strip = wrapper.parentElement
    const layer = getGhostLayer()
    if (!(tab instanceof HTMLElement) || !strip || !layer || isReducedMotionEnabled()) {
      done()
      return
    }

    const items = getItems(strip)
    const index = items.indexOf(tab)
    freeze(wrapper)
    const before = measure(items)
    const vertical = isVertical()
    const rtl = isRightToLeft(strip)
    const gap = getGap(strip)
    const radius = getCornerRadius(tab)
    const box = getLayoutRect(tab)
    const size = vertical ? box.height : box.width
    const ghost = createGhost(tab, box, layer)
    // A copy of an opening tab keeps the dot's center as its origin.
    ghost.style.transformOrigin = dotOrigin(rtl)
    const ghostStyle = getComputedStyle(ghost)
    stopSlides()

    // The tab leaves the strip at once; its copy closes in the ghost layer,
    // which keeps it out of the strip's scroll range.
    done()
    onLeft()

    const remaining = items.filter(item => item !== tab)
    // Along the strip, the closed tab has given up this part of its space
    // when it has squeezed into the dot.
    const squeezedShare = vertical ? 0 : (size - DOT_SIZE_PX) / (size + gap)
    const timing = { duration: SQUEEZE_DURATION_MS, delay: SQUEEZE_DELAY_MS, easing: ACCELERATE, fill: /** @type {FillMode} */ ('backwards') }
    slide(before, remaining, ([x, y]) => [
      { translate: `${x}px ${y}px` },
      { translate: `${x * (1 - squeezedShare)}px ${y * (1 - squeezedShare)}px`, offset: SQUEEZED_OFFSET },
      { translate: '0px 0px' }
    ], timing)

    // The copy moves with the item before it, which moves only when the
    // strip's scroll position shrinks with its range.
    const previous = remaining[index - 1]
    const previousBefore = previous && before.get(previous)
    const previousAfter = previous?.getBoundingClientRect()
    const [startX = 0, startY = 0] = ghostStyle.translate === 'none' ? [] : ghostStyle.translate.split(' ').map(parseFloat)
    const followX = previousBefore ? previousAfter.left - previousBefore.left : 0
    const followY = previousBefore ? previousAfter.top - previousBefore.top : 0

    const from = {
      clipPath: ghostStyle.clipPath === 'none' ? `inset(0 0 0 0 round ${radius})` : ghostStyle.clipPath,
      opacity: ghostStyle.opacity,
      transform: ghostStyle.transform,
      translate: `${startX}px ${startY}px`
    }
    const squeezed = {
      ...from,
      clipPath: dotClip(radius, rtl),
      translate: `${startX + followX * squeezedShare}px ${startY + followY * squeezedShare}px`
    }
    const animations = [
      ghost.animate([
        from,
        { ...squeezed, offset: SQUEEZED_OFFSET },
        {
          ...squeezed,
          opacity: 0,
          transform: from.transform === 'none' ? DOT_SCALE : `${from.transform} ${DOT_SCALE}`,
          translate: `${startX + followX}px ${startY + followY}px`
        }
      ], { ...timing, fill: 'both' }),
      ...Array.from(ghost.children, child => child.animate(
        { filter: [getComputedStyle(child).filter, 'opacity(0)'] },
        { duration: CONTENT_FADE_OUT_DURATION_MS, fill: 'forwards' }
      ))
    ].map(applyAnimationSpeed)
    const entry = { ghost, animations }
    ghosts.add(entry)
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (!ghosts.delete(entry)) return
      ghost.remove()
    }, () => {})
  }

  /**
   * Complete every running animation at once, so the strip can be measured in
   * its final layout.
   */
  function finishAll() {
    for (const [wrapper, entry] of [...running]) {
      running.delete(wrapper)
      entry.animations.forEach(animation => animation.cancel())
      entry.tab.style.removeProperty('transform-origin')
      entry.done()
    }
    slides.forEach(animation => animation.cancel())
    slides.clear()
    for (const entry of ghosts) {
      entry.animations.forEach(animation => animation.cancel())
      entry.ghost.remove()
    }
    ghosts.clear()
  }

  return { onBeforeEnter, onEnter, onEnterCancelled, onLeave, finishAll }
}
