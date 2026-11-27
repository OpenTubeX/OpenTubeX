import { applyAnimationSpeed } from './animationSpeed'
import { getCapacitorTabPreviewRegion } from './capacitorTabPreviewRegion'
import { getFixedBackgroundContainment, getWindowFieldPlacement } from './fixedBackground'

export function organizerSwipeProgress(distance, height) {
  return Math.max(0, Math.min(1, distance / Math.min(320, height * 0.45)))
}

export function shouldOpenSwipedOrganizer(distance, height, elapsed) {
  return organizerSwipeProgress(distance, height) >= 0.35 ||
    (distance >= 48 && distance / Math.max(1, elapsed) > 0.5)
}

// Animate the live page rather than a screenshot, preserving video and scroll
// position. Use the same viewport bounds as the cached preview.
export function createOrganizerSwipeAnimation(page, preview, overlay) {
  const from = page.getBoundingClientRect()
  const to = preview.getBoundingClientRect()
  const scale = to.width / from.width
  const region = getCapacitorTabPreviewRegion()
  const top = Math.max(0, Math.min(from.height, region.top - from.top))
  const bottom = Math.max(0, from.top + from.height - region.bottom)
  const visibleBottom = from.height - bottom
  const cropBottom = Math.min(visibleBottom, top + to.height / scale)
  const fillsPreview = (from.height - top - bottom) * scale >= to.height
  const radius = Number.parseFloat(getComputedStyle(preview).borderTopLeftRadius) || 0
  const reduced = document.documentElement.dataset.reducedMotion === 'reduce'
  const animations = []
  /** @type {{ element: HTMLElement, name: string }[]} */
  let pageStyles = []
  if (!reduced) {
    // The page lets the window's field show through, so its backdrop paints
    // the field where the page covers it. The class's transform hint also
    // makes the page contain the fixed field layers of its cards, which
    // would jump to other parts of their fields and span the whole page,
    // where repainting them for every step of the crop drops frames. Measure
    // them before the hint applies, see getFixedBackgroundContainment.
    const { size, position } = getWindowFieldPlacement(from.left, from.top)
    pageStyles = [
      { element: page, name: '--organizer-swipe-field-size', value: size },
      { element: page, name: '--organizer-swipe-field-position', value: position },
      ...getFixedBackgroundContainment(page)
    ]
    page.classList.add('organizerSwipePage')
    for (const { element, name, value } of pageStyles) element.style.setProperty(name, value)
    // Short landscape pages cannot fill a compact card at this width scale.
    // Crossfade to the cached image, which covers the whole card.
    if (fillsPreview) {
      preview.classList.add('organizerSwipePreview')
    }
    animations.push(page.animate([
      // Anchor the crop to the captured region, not the page's old height:
      // feed rows can load or disappear while the finger is still down.
      { transform: 'translate(0, 0) scale(1)', clipPath: `inset(${top}px 0 calc(100% - ${visibleBottom}px) round 0px)`, opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top - top * scale}px) scale(${scale})`, clipPath: `inset(${top}px 0 calc(100% - ${cropBottom}px) round ${radius / scale}px ${radius / scale}px 0 0)`, opacity: fillsPreview ? 1 : 0 }
    ], { duration: 1000, fill: 'both' }))
  }
  // Reveal the organizer early so its header never remains superimposed on
  // the app header while the live page continues travelling to its card.
  const backdrop = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1 }]
  animations.push(overlay.animate(backdrop, { duration: 1000, fill: 'both' }))
  for (const animation of animations) animation.pause()
  let disposed = false
  let progress = 0
  let settlement = null
  return {
    update(value) {
      if (disposed) return
      progress = value
      for (const animation of animations) animation.currentTime = value * 1000
    },
    async finish(commit) {
      const destination = commit ? 1 : 0
      if (!reduced && progress !== destination) {
        // A separate timing animation eases the remaining distance without
        // restarting the page transition or changing its geometry on release.
        settlement = applyAnimationSpeed(overlay.animate([{}, {}], { duration: 240 }))
        const start = progress
        const tick = () => {
          const fraction = Math.min(1, Number(settlement.currentTime) / 240)
          this.update(start + (destination - start) * (1 - (1 - fraction) ** 3))
          if (settlement.playState === 'running') frame = requestAnimationFrame(tick)
        }
        let frame = requestAnimationFrame(tick)
        await settlement.finished.catch(() => {})
        cancelAnimationFrame(frame)
      }
      this.update(destination)
    },
    dispose() {
      disposed = true
      settlement?.cancel()
      for (const animation of animations) animation.cancel()
      page.classList.remove('organizerSwipePage')
      for (const { element, name } of pageStyles) element.style.removeProperty(name)
      preview.classList.remove('organizerSwipePreview')
    }
  }
}
