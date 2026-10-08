import { applyAnimationSpeed } from './animationSpeed'

export function organizerSwipeProgress(distance, height) {
  return Math.max(0, Math.min(1, distance / Math.min(320, height * 0.45)))
}

export function shouldOpenSwipedOrganizer(distance, height, elapsed) {
  return organizerSwipeProgress(distance, height) >= 0.35 ||
    (distance >= 48 && distance / Math.max(1, elapsed) > 0.5)
}

// Animate the live page rather than a screenshot, preserving video and scroll
// position. Clip its lower portion to match the organizer's 16:9 preview.
export function createOrganizerSwipeAnimation(page, preview, overlay) {
  const from = page.getBoundingClientRect()
  const to = preview.getBoundingClientRect()
  const scale = to.width / from.width
  const headerBottom = document.querySelector('.topNav')?.getBoundingClientRect().bottom ?? 0
  const top = Math.max(0, Math.min(from.height, Math.max(0, headerBottom) - from.top))
  const bottom = Math.max(0, from.top + from.height - window.innerHeight)
  const crop = Math.max(0, from.height - top - to.height / scale)
  const radius = getComputedStyle(preview).borderRadius
  const reduced = document.documentElement.dataset.reducedMotion === 'reduce' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  const animations = []
  if (!reduced) {
    page.classList.add('organizerSwipePage')
    animations.push(page.animate([
      { transform: 'translate(0, 0) scale(1)', clipPath: `inset(${top}px 0 ${bottom}px round 0px)` },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top - top * scale}px) scale(${scale})`, clipPath: `inset(${top}px 0 ${crop}px round ${radius})` }
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
    }
  }
}
