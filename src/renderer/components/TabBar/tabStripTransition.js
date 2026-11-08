import { applyAnimationSpeed } from '../../helpers/animationSpeed'
import { motionTiming } from '../../helpers/motionTiming'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'

// Opening tabs pop in as a dot and stretch into place; closing tabs squeeze
// back into the dot, which vanishes while its neighbors close the gap.
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

/**
 * Enter and leave hooks for the strip's `TransitionGroup`. Each strip item is a
 * `display: contents` wrapper, so the hooks animate the tab inside it.
 * @param {object} options
 * @param {() => boolean} options.isVertical
 * @param {() => boolean} options.shouldAnimateEnter false while the strip shows
 * its initial tabs, which should appear at once
 * @param {(item: HTMLElement) => void} options.onEntered
 * @param {() => void} options.onLeft runs after a closed item is removed,
 * which no longer changes the strip's size
 */
export function useTabStripTransition({ isVertical, shouldAnimateEnter, onEntered, onLeft }) {
  /** @type {Map<Element, { animations: Animation[], done: () => void }>} */
  const running = new Map()

  /**
   * @param {Element} wrapper
   * @param {Animation[]} animations
   * @param {() => void} done
   */
  function track(wrapper, animations, done) {
    const entry = { animations: animations.map(applyAnimationSpeed), done }
    running.set(wrapper, entry)
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (running.get(wrapper) !== entry) return
      running.delete(wrapper)
      // Leaving items are removed in the same task, before the next paint.
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
   * @param {Element} wrapper
   * @returns {number} the space between strip items
   */
  function getGap(wrapper) {
    const style = getComputedStyle(wrapper.parentElement)
    return parseFloat(isVertical() ? style.rowGap : style.columnGap) || 0
  }

  /**
   * @param {Element} wrapper
   * @param {() => void} done
   */
  function onEnter(wrapper, done) {
    const tab = wrapper.firstElementChild
    if (!(tab instanceof HTMLElement) || !shouldAnimateEnter() || isReducedMotionEnabled()) {
      done()
      return
    }

    // A negative end margin of the dot's size plus the gap keeps the dot out
    // of the row at first, so its neighbors part as it appears.
    const vertical = isVertical()
    const marginProperty = vertical ? 'marginBlockEnd' : 'marginInlineEnd'
    const dotSize = vertical ? parseFloat(getComputedStyle(tab).blockSize) : DOT_SIZE_PX
    const animations = [
      tab.animate([
        { opacity: 0, transform: DOT_SCALE, [marginProperty]: `${-(dotSize + getGap(wrapper))}px` },
        { opacity: 1, transform: 'none', [marginProperty]: '0px' }
      ], { duration: POP_DURATION_MS, easing: DECELERATE, fill: 'backwards' }),
      // The final size comes from the style, so the tab keeps stretching
      // toward its current size when its title changes while it opens.
      tab.animate([
        { inlineSize: `${DOT_SIZE_PX}px`, minInlineSize: '0px' },
        {}
      ], {
        ...motionTiming('--motion-default-spatial', 450, DECELERATE),
        delay: STRETCH_DELAY_MS,
        fill: 'backwards'
      }),
      // A filter fades the content without overriding the opacity of controls
      // that are hidden until hover.
      ...Array.from(tab.children, child => child.animate(
        { filter: ['opacity(0)', 'opacity(1)'] },
        { duration: CONTENT_FADE_DURATION_MS, delay: CONTENT_FADE_IN_DELAY_MS, fill: 'backwards' }
      ))
    ]
    track(wrapper, animations, () => {
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
   * @param {Element} wrapper
   * @param {() => void} done
   */
  function onLeave(wrapper, done) {
    const tab = wrapper.firstElementChild
    if (!(tab instanceof HTMLElement) || isReducedMotionEnabled()) {
      done()
      return
    }

    freeze(wrapper)
    wrapper.setAttribute('data-leaving', '')
    tab.style.pointerEvents = 'none'
    // Content past the shrinking box would keep extending the scroll range.
    tab.style.overflow = 'clip'

    // The dot collapses its box along the strip, and a negative start margin
    // takes up the gap before it. Nothing is left in the row or its scroll
    // range when it is removed, so neither moves.
    const vertical = isVertical()
    const axis = vertical ? 'Block' : 'Inline'
    const style = getComputedStyle(tab)
    const box = {
      [`padding${axis}Start`]: style[`padding${axis}Start`],
      [`padding${axis}End`]: style[`padding${axis}End`],
      [`border${axis}StartWidth`]: style[`border${axis}StartWidth`],
      [`border${axis}EndWidth`]: style[`border${axis}EndWidth`],
      [`margin${axis}Start`]: style[`margin${axis}Start`]
    }
    const collapsed = {
      [`padding${axis}Start`]: '0px',
      [`padding${axis}End`]: '0px',
      [`border${axis}StartWidth`]: '0px',
      [`border${axis}EndWidth`]: '0px',
      [`margin${axis}Start`]: `${-getGap(wrapper)}px`
    }
    if (vertical) {
      // Collapsed group chips size themselves with flex-basis.
      Object.assign(box, { blockSize: style.blockSize, flexBasis: style.blockSize, minBlockSize: '0px' })
      Object.assign(collapsed, { blockSize: '0px', flexBasis: '0px' })
    } else {
      collapsed.inlineSize = '0px'
    }
    const from = {
      ...box,
      inlineSize: style.inlineSize,
      minInlineSize: '0px',
      opacity: style.opacity,
      transform: style.transform
    }
    const squeezed = { ...from, inlineSize: `${DOT_SIZE_PX}px` }
    const animations = [
      tab.animate([
        from,
        { ...squeezed, offset: 0.7 },
        { ...squeezed, ...collapsed, opacity: 0, transform: DOT_SCALE }
      ], { duration: SQUEEZE_DURATION_MS, delay: SQUEEZE_DELAY_MS, easing: ACCELERATE, fill: 'both' }),
      ...Array.from(tab.children, child => child.animate(
        { filter: [getComputedStyle(child).filter, 'opacity(0)'] },
        { duration: CONTENT_FADE_OUT_DURATION_MS, fill: 'forwards' }
      ))
    ]
    track(wrapper, animations, () => {
      done()
      onLeft()
    })
  }

  /**
   * Complete every running animation at once, so the strip can be measured in
   * its final layout.
   */
  function finishAll() {
    for (const [wrapper, entry] of [...running]) {
      running.delete(wrapper)
      entry.animations.forEach(animation => animation.cancel())
      entry.done()
    }
  }

  return { onEnter, onEnterCancelled, onLeave, finishAll }
}
