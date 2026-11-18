import { applyAnimationSpeed } from '../../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'

// Opening tabs wipe open from their leading edge while their neighbors make
// room; closing tabs wipe shut toward it while their neighbors close the gap.
// The wipe and the slides share their timing, so the gap between the tabs
// stays even.
//
// Every frame of these animations runs on the compositor: the strip takes its
// final layout at once, a clip path draws the opening or closing tab, and the
// other tabs slide from where they were with `translate`. Animating sizes or
// margins instead would lay out, paint and commit the whole window on each
// frame, which slows the page opening beside the strip.
const OPEN_TIMING = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
const CLOSE_TIMING = { duration: 150, easing: 'cubic-bezier(0.3, 0, 1, 1)' }
const CONTENT_FADE_IN_DELAY_MS = 60
const CONTENT_FADE_IN_DURATION_MS = 120
const CONTENT_FADE_OUT_DURATION_MS = 70

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

  /** @param {HTMLElement} tab */
  function getCornerRadius(tab) {
    return getComputedStyle(tab).borderTopLeftRadius || '0px'
  }

  /** @param {Element} strip */
  function isRightToLeft(strip) {
    return getComputedStyle(strip).direction === 'rtl'
  }

  /**
   * A clip that hides the whole tab against its leading edge along the strip.
   * @param {string} radius
   * @param {boolean} vertical
   * @param {boolean} rtl
   */
  function shutClip(radius, vertical, rtl) {
    if (vertical) return `inset(0 0 100% 0 round ${radius})`
    return rtl ? `inset(0 0 0 100% round ${radius})` : `inset(0 100% 0 0 round ${radius})`
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
    slide(before, items, ([x, y]) => [{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], OPEN_TIMING)

    const animations = [
      // The clip's size follows the tab's, so the tab keeps opening toward its
      // current size when its title changes while it opens.
      tab.animate(
        { clipPath: [shutClip(radius, vertical, rtl), `inset(0 0 0 0 round ${radius})`] },
        { ...OPEN_TIMING, fill: 'backwards' }
      ),
      // A filter fades the content without overriding the opacity of controls
      // that are hidden until hover.
      ...Array.from(tab.children, child => child.animate(
        { filter: ['opacity(0)', 'opacity(1)'] },
        { duration: CONTENT_FADE_IN_DURATION_MS, delay: CONTENT_FADE_IN_DELAY_MS, fill: 'backwards' }
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
    const radius = getCornerRadius(tab)
    const box = getLayoutRect(tab)
    const ghost = createGhost(tab, box, layer)
    const ghostStyle = getComputedStyle(ghost)
    stopSlides()

    // The tab leaves the strip at once; its copy closes in the ghost layer,
    // which keeps it out of the strip's scroll range.
    done()
    onLeft()

    const remaining = items.filter(item => item !== tab)
    // The copy moves with the item before it, which moves only when the
    // strip's scroll position shrinks with its range. Measure it before its
    // slide draws it where it was.
    const previous = remaining[index - 1]
    const previousBefore = previous && before.get(previous)
    const previousAfter = previous?.getBoundingClientRect()
    slide(before, remaining, ([x, y]) => [{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], CLOSE_TIMING)
    const [startX = 0, startY = 0] = ghostStyle.translate === 'none' ? [] : ghostStyle.translate.split(' ').map(parseFloat)
    const followX = previousBefore ? previousAfter.left - previousBefore.left : 0
    const followY = previousBefore ? previousAfter.top - previousBefore.top : 0

    const animations = [
      ghost.animate({
        // A tab closed while it opens shuts from its current clip.
        clipPath: [
          ghostStyle.clipPath === 'none' ? `inset(0 0 0 0 round ${radius})` : ghostStyle.clipPath,
          shutClip(radius, vertical, rtl)
        ],
        translate: [`${startX}px ${startY}px`, `${startX + followX}px ${startY + followY}px`]
      }, { ...CLOSE_TIMING, fill: 'both' }),
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
    // The strip takes its layout before completing openings, which may scroll
    // to the opened tab.
    slides.forEach(animation => animation.cancel())
    slides.clear()
    for (const [wrapper, entry] of [...running]) {
      running.delete(wrapper)
      entry.animations.forEach(animation => animation.cancel())
      entry.done()
    }
    for (const entry of ghosts) {
      entry.animations.forEach(animation => animation.cancel())
      entry.ghost.remove()
    }
    ghosts.clear()
  }

  return { onBeforeEnter, onEnter, onEnterCancelled, onLeave, finishAll }
}
