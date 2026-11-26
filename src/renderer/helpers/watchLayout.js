import { nextTick } from 'vue'
import { applyAnimationSpeed } from './animationSpeed'
import { isReducedMotionEnabled } from './reducedMotion'

// Shared by the watch and external media pages, which use the same layout
// (scss-partials/_watch-layout.scss).

export const THEATRE_MODE_ANIMATION_DURATION = 400
// Matches the player's theater button breakpoint.
export const RESPONSIVE_THEATRE_MODE_MAX_WIDTH = 1350

const ANIMATED_AREAS = ['.videoPlayer', '.infoArea', '.sidebarArea', '.commentsArea']
// Areas whose cards change their size with the layout.
const CARD_AREAS = ['infoArea', 'commentsArea']
const PINNED_PROPERTIES = ['position', 'box-sizing', 'width', 'left', 'top']
const ANIMATION_OPTIONS = {
  duration: THEATRE_MODE_ANIMATION_DURATION,
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
}
// The inverse of a linearly animated scale is not linear, so counter-scaled
// content samples it. Linear steps between the samples stay within a fraction
// of a pixel.
const COUNTER_SCALE_STEPS = 16
// Enough text runs to tell where an element's text is aligned.
const TEXT_EXTENT_NODES = 8
// How deep stacked parts of a card are split, see counterScaledContent.
const COUNTER_SCALE_DEPTH = 3

export function isTheatreLayoutAvailable() {
  return window.innerWidth > RESPONSIVE_THEATRE_MODE_MAX_WIDTH
}

/**
 * Animates the layout areas from their previous positions and widths after a
 * theater mode change or after the sidebar appears or disappears. Starting a
 * new change cancels the previous animation.
 */
export function createWatchLayoutAnimator() {
  /** @type {Animation[]} */
  let animations = []
  /** @type {Set<HTMLElement>} */
  const insetElements = new Set()
  /** @type {HTMLElement | null} */
  let clippedLayout = null
  /** @type {HTMLElement | null} */
  let pinnedSidebar = null
  /** @type {HTMLElement | null} */
  let positionedLayout = null
  /** @type {Map<HTMLElement, string>} The clipped cards and their own overflow. */
  const clippedCards = new Map()

  function cleanUp() {
    document.removeEventListener('scroll', placeFixedBackgrounds, { capture: true })
    insetElements.forEach(element => element.style.removeProperty('--fixed-background-inset'))
    insetElements.clear()
    clippedLayout?.style.removeProperty('overflow-x')
    clippedLayout = null
    PINNED_PROPERTIES.forEach(property => pinnedSidebar?.style.removeProperty(property))
    pinnedSidebar = null
    positionedLayout?.style.removeProperty('position')
    positionedLayout = null
    clippedCards.forEach((overflow, card) => { card.style.overflow = overflow })
    clippedCards.clear()
  }

  function cancel() {
    animations.forEach(animation => animation.cancel())
    animations = []
    cleanUp()
  }

  /** @param {Animation} animation */
  function track(animation) {
    const end = () => {
      // A cancelled run may still deliver queued events.
      if (!animations.includes(animation)) { return }
      animations = animations.filter(item => item !== animation)
      if (animations.length === 0) {
        cleanUp()
      }
    }
    animation.addEventListener('finish', end)
    animation.addEventListener('cancel', end)
    animations.push(animation)
  }

  /**
   * Covers the viewport with the fixed layers of each animated area, measured
   * from the area's box without its animated translation. Scrolling moves
   * that box, so this runs again on scroll.
   */
  function placeFixedBackgrounds() {
    const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement
    insetElements.forEach(element => {
      const rect = element.getBoundingClientRect()
      const { m41: translateX, m42: translateY } = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      const left = rect.left - translateX + element.clientLeft
      const top = rect.top - translateY + element.clientTop
      element.style.setProperty('--fixed-background-inset', [
        -top,
        left + element.clientWidth - viewportWidth,
        top + element.clientHeight - viewportHeight,
        -left
      ].map(value => `${value}px`).join(' '))
    })
  }

  /**
   * Themes with fixed card backgrounds (FtFixedBackground) paint them in a
   * fixed layer. A transformed area becomes that layer's containing block
   * instead of the viewport, which would move the field with the area and
   * snap it back when the animation ends. Place the layers over the viewport
   * and move them against the area instead.
   * @param {HTMLElement} element
   * @param {number} offsetX
   * @param {number} offsetY
   * @param {number} [endOffsetX] Where the area moves to, instead of its box.
   */
  function keepFixedBackgroundsInPlace(element, offsetX, offsetY, endOffsetX = 0) {
    const layers = element.querySelectorAll('.fixedBackgroundLayer')
    if (layers.length === 0) { return }

    insetElements.add(element)
    layers.forEach(layer => {
      track(applyAnimationSpeed(layer.animate([
        { transform: `translate(${-offsetX}px, ${-offsetY}px)` },
        { transform: `translateX(${-endOffsetX}px)` }
      ], { ...ANIMATION_OPTIONS, pseudoElement: '::before' })))
    })
  }

  /**
   * @param {HTMLElement | null | undefined} layout
   * @param {() => void} [applyChange] Changes the layout. Watchers that run
   * before the render that changes it can omit it.
   */
  async function animate(layout, applyChange) {
    const elements = ANIMATED_AREAS.flatMap(selector => layout?.querySelector(selector) ?? [])
    const reducedMotion = isReducedMotionEnabled()
    // Measure before cancelling, so an interrupted animation continues from
    // where the areas are drawn instead of jumping to their final positions.
    const previousRects = reducedMotion ? [] : elements.map(element => element.getBoundingClientRect())
    const previousCardRects = reducedMotion ? new Map() : measureCards(elements)
    const hadSidebar = !layout?.classList.contains('noSidebar')
    cancel()
    applyChange?.()
    if (reducedMotion) { return }

    await nextTick()
    if (!layout?.isConnected) { return }

    // The areas start where they were drawn, and the scaled player can reach
    // past the page, which would flash a horizontal scrollbar.
    if (elements.length > 0) {
      clippedLayout = layout
      layout.style.overflowX = 'clip'
    }

    const hasSidebar = !layout.classList.contains('noSidebar')
    const rtl = getComputedStyle(layout).direction === 'rtl'
    let infoEndOffset = 0

    // The last panel of a closing sidebar column fades out while the column
    // collapses. Keep it where it was drawn, instead of in the single column
    // that the layout now has, where it would push the areas below it down.
    const sidebarIndex = elements.findIndex(element => element.classList.contains('sidebarArea'))
    const infoIndex = elements.findIndex(element => element.classList.contains('infoArea'))
    const sidebar = elements[sidebarIndex]
    const sidebarRect = previousRects[sidebarIndex]
    const infoRect = previousRects[infoIndex]
    const sidebarWasBesideInfo = sidebarRect && infoRect &&
      (sidebarRect.left >= infoRect.right || sidebarRect.right <= infoRect.left)
    if (hadSidebar && !hasSidebar && sidebarWasBesideInfo && sidebar.offsetHeight > 0) {
      pin(layout, sidebar, sidebarRect)
    }

    elements.forEach((element, index) => {
      const previousRect = previousRects[index]
      const nextRect = element.getBoundingClientRect()
      const isVideoPlayer = element.classList.contains('videoPlayer')
      if (element.classList.contains('sidebarArea')) {
        // An appearing sidebar has no previous place. It slides in beside the
        // narrowing info area instead.
        if (!hadSidebar && hasSidebar) {
          translate(element, infoEndOffset, 0)
        }
        // A closing sidebar slides out with the widening info area.
        if (element === pinnedSidebar && Math.abs(infoEndOffset) >= 0.5) {
          track(applyAnimationSpeed(element.animate([
            { transform: 'none' },
            { transform: `translateX(${-infoEndOffset}px)` }
          ], ANIMATION_OPTIONS)))
          keepFixedBackgroundsInPlace(element, 0, 0, -infoEndOffset)
        }
        if (!hadSidebar || !hasSidebar) { return }
      }

      const offsetX = previousRect.left - nextRect.left
      const offsetY = previousRect.top - nextRect.top
      if (element.classList.contains('infoArea')) {
        infoEndOffset = rtl ? offsetX : previousRect.right - nextRect.right
      }
      // Resized cards move and resize on their own, see morph.
      const cards = [...previousCardRects].filter(([card]) => element.contains(card))
      const cardsResize = cards.some(([card, rect]) => {
        const nextCardRect = card.getBoundingClientRect()
        return Math.abs(rect.width - nextCardRect.width) >= 0.5 || Math.abs(rect.height - nextCardRect.height) >= 0.5
      })
      if (cardsResize) {
        // Measure all cards before the first transform moves the others.
        cards.map(([card, rect]) => [card, rect, card.getBoundingClientRect()])
          .forEach(([card, rect, nextCardRect]) => morph(card, rect, nextCardRect, rtl))
        return
      }
      if (isVideoPlayer) {
        const scaleX = previousRect.width / nextRect.width
        const scaleY = previousRect.height / nextRect.height
        if (offsetX === 0 && offsetY === 0 && scaleX === 1 && scaleY === 1) { return }
        track(applyAnimationSpeed(element.animate([
          {
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`,
            transformOrigin: 'top left'
          },
          { transform: 'none', transformOrigin: 'top left' }
        ], ANIMATION_OPTIONS)))
      } else {
        translate(element, offsetX, offsetY)
      }
    })

    // Nothing moved, so no finished animation would restore the overflow.
    if (animations.length === 0) {
      cleanUp()
      return
    }

    if (insetElements.size > 0) {
      placeFixedBackgrounds()
      document.addEventListener('scroll', placeFixedBackgrounds, { capture: true, passive: true })
    }
  }

  /**
   * Takes the sidebar out of the grid and places it over its previous box.
   * The layout contains it, so it clips it as it slides out.
   * @param {HTMLElement} layout
   * @param {HTMLElement} sidebar
   * @param {DOMRect} rect
   */
  function pin(layout, sidebar, rect) {
    positionedLayout = layout
    layout.style.position = 'relative'
    pinnedSidebar = sidebar
    Object.assign(sidebar.style, { position: 'absolute', boxSizing: 'border-box', width: `${rect.width}px`, left: '0px', top: '0px' })
    const origin = sidebar.getBoundingClientRect()
    sidebar.style.left = `${rect.left - origin.left}px`
    sidebar.style.top = `${rect.top - origin.top}px`
  }

  /**
   * @param {HTMLElement[]} areas
   * @returns {Map<HTMLElement, DOMRect>}
   */
  function measureCards(areas) {
    /** @type {HTMLElement[]} */
    const cards = areas.filter(area => CARD_AREAS.some(name => area.classList.contains(name)))
      .flatMap(area => [...area.querySelectorAll('.watchVideo')])
      .filter(card => !card.parentElement?.closest('.watchVideo'))
    return new Map(cards.map(card => [card, card.getBoundingClientRect()]))
  }

  /**
   * Moves and resizes a card from where it was drawn to its new box, like the
   * fullscreen docks: its `transform` animates on the compositor, while its
   * children get the inverse scale. The content keeps its size and its final
   * layout, without reflowing on every frame, and the card's moving edges
   * reveal or cover it.
   * @param {HTMLElement} card
   * @param {DOMRect} from
   * @param {DOMRect} to
   * @param {boolean} rtl
   */
  function morph(card, from, to, rtl) {
    if (!card.isConnected || to.width < 1 || to.height < 1 || from.width < 1 || from.height < 1) { return }
    const scaleX = from.width / to.width
    const scaleY = from.height / to.height
    const offsetX = from.left - to.left
    const offsetY = from.top - to.top
    if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) {
      translate(card, offsetX, offsetY)
      return
    }

    // Every transform here applies around its element's top left corner. A
    // child's offset from its anchoring edge keeps it there.
    // Text in one half of the card stays at that half's edge, like a like
    // count at the end. Text across the middle, like a comment, stays at
    // the inline start.
    const middle = (to.left + to.right) / 2
    const children = counterScaledContent(card).map(child => {
      const rect = child.getBoundingClientRect()
      const content = textExtent(child) ?? rect
      const atRight = content.left >= middle || (content.right > middle && rtl)
      return { child, x: rect.left - (atRight ? to.right : to.left), y: rect.top - to.top }
    })
    // Cards can hold their layer deeper, like the AI summary, whose closed
    // details render only their summary. A counter-scaled child contains
    // the fixed layers inside it instead of the card.
    const layers = [...card.querySelectorAll('.fixedBackgroundLayer')]
      .filter(layer => !children.some(({ child }) => child.contains(layer)))

    clippedCards.set(card, card.style.overflow)
    card.style.overflow = 'clip'
    const transformOrigin = '0 0'
    track(applyAnimationSpeed(card.animate([
      { transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`, transformOrigin },
      { transform: 'none', transformOrigin }
    ], ANIMATION_OPTIONS)))

    // Offsets are eased progress, like the card's.
    const samples = Array.from({ length: COUNTER_SCALE_STEPS + 1 }, (_, step) => {
      const progress = step / COUNTER_SCALE_STEPS
      return {
        offset: progress,
        scaleX: scaleX + (1 - scaleX) * progress,
        scaleY: scaleY + (1 - scaleY) * progress,
        offsetX: offsetX * (1 - progress),
        offsetY: offsetY * (1 - progress),
      }
    })
    children.forEach(({ child, x, y }) => {
      track(applyAnimationSpeed(child.animate(samples.map(sample => ({
        offset: sample.offset,
        transform: `translate(${x * (1 / sample.scaleX - 1)}px, ${y * (1 / sample.scaleY - 1)}px) scale(${1 / sample.scaleX}, ${1 / sample.scaleY})`,
        transformOrigin,
      })), ANIMATION_OPTIONS)))
    })

    // The background layer scales with the card and keeps its corners, while
    // its fixed field undoes the card's transform to stay in place. Its
    // coordinates are the viewport's, see placeFixedBackgrounds.
    if (layers.length === 0) { return }
    insetElements.add(card)
    layers.forEach(layer => {
      track(applyAnimationSpeed(layer.animate(samples.map(sample => ({
        offset: sample.offset,
        transform: `scale(${1 / sample.scaleX}, ${1 / sample.scaleY}) translate(${-sample.offsetX}px, ${-sample.offsetY}px)`,
        transformOrigin: `${to.left}px ${to.top}px`,
      })), { ...ANIMATION_OPTIONS, pseudoElement: '::before' })))
    })
  }

  /**
   * The parts of a card that keep their size while it scales. A card's rows,
   * such as a title beside a like count, and stacks, such as a title above
   * its metadata, are split into their parts, so each part stays at the edge
   * its text is closer to, like it would if the card reflowed. Nested rows
   * stay whole, so a group of buttons can't come apart.
   * @param {HTMLElement} element
   * @param {number} [depth]
   * @returns {HTMLElement[]}
   */
  function counterScaledContent(element, depth = 0) {
    return [...element.children].flatMap(child => {
      if (!(child instanceof HTMLElement) || child.classList.contains('fixedBackgroundLayer')) { return [] }
      const style = getComputedStyle(child)
      const flex = style.display === 'flex' && child.children.length > 1
      const split = (flex || (style.display === 'grid' && child.children.length > 1)) && depth === 0
      const stack = flex && style.flexDirection.startsWith('column') && depth < COUNTER_SCALE_DEPTH
      return split || stack ? counterScaledContent(child, depth + 1) : [child]
    })
  }

  /**
   * Where the first lines of text in an element are, which can be at either
   * end of a wide element, like a title in another script than the page.
   * @param {HTMLElement} element
   * @returns {{ left: number, right: number } | null}
   */
  function textExtent(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let extent = null
    for (let count = 0, node = walker.nextNode(); node && count < TEXT_EXTENT_NODES; node = walker.nextNode()) {
      if (!node.textContent?.trim()) { continue }
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0) { continue }
      count++
      extent = extent
        ? { left: Math.min(extent.left, rect.left), right: Math.max(extent.right, rect.right) }
        : { left: rect.left, right: rect.right }
    }
    return extent
  }

  /**
   * @param {HTMLElement} element
   * @param {number} offsetX
   * @param {number} offsetY
   */
  function translate(element, offsetX, offsetY) {
    // A transform would also make the area the containing block of its fixed
    // backgrounds, so leave areas that don't move alone.
    if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) { return }
    track(applyAnimationSpeed(element.animate([
      { transform: `translate(${offsetX}px, ${offsetY}px)` },
      { transform: 'none' }
    ], ANIMATION_OPTIONS)))
    keepFixedBackgroundsInPlace(element, offsetX, offsetY)
  }

  return { animate, cancel }
}
