// Matches --motion-slow-spatial, which the reveal uses when it is available.
export const STARTUP_REVEAL_DURATION_MS = 650

// The 9-sided cookie's innermost points lie 42% of its size from its center;
// the margin covers the edges between them.
const COOKIE_INNER_RADIUS = 0.4

// The settings load after the splash's first paint. Cache only its appearance
// so the next launch can paint it before loading the renderer.
export function cacheStartupAppearance(appearance) {
  try {
    localStorage.setItem('opentubex-startup-appearance', JSON.stringify(appearance))
  } catch {
    // Startup still works when WebView storage is unavailable.
  }
}

export function revealStartupSplash() {
  const splash = document.getElementById('startup-splash')
  if (!splash || splash.dataset.revealing) return
  splash.dataset.revealing = 'true'
  splash.setAttribute('aria-busy', 'false')

  let timeout
  let frame = 0
  const finish = () => {
    if (!splash.isConnected) return
    clearTimeout(timeout)
    cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    splash.remove()
    document.getElementById('app')?.removeAttribute('inert')
    document.dispatchEvent(new Event('startup-splash-hidden'))
  }
  const onVisibilityChange = () => {
    if (document.hidden) finish()
  }
  if (document.hidden || document.documentElement.dataset.reducedMotion === 'reduce') {
    finish()
    return
  }

  try {
    const shape = splash.querySelector('.startupShape')
    const bounds = splash.getBoundingClientRect()
    // The app's spring, as a duration followed by a linear() easing.
    const motion = getComputedStyle(document.body).getPropertyValue('--motion-slow-spatial').trim()
    const duration = Number.parseFloat(motion) || STARTUP_REVEAL_DURATION_MS
    const easing = motion.slice(motion.indexOf(' ') + 1) || 'ease-out'
    const progress = splash.querySelector('.startupProgress')
    progress.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })

    let reveal
    if (CSS.supports('mask-composite', 'exclude')) {
      // The hole and the logo share the splash's center. Grow the hole until
      // even its innermost points pass the corners.
      const size = Math.hypot(bounds.width, bounds.height) / 2 / COOKIE_INNER_RADIUS
      reveal = splash.animate(
        [{ maskSize: '0px 0px, 100% 100%' }, { maskSize: `${size}px ${size}px, 100% 100%` }],
        { duration, easing, fill: 'forwards' }
      )
      // The tonal cookie leads the hole's edge and fades as the app shows.
      shape.animate([{ scale: 1 }, { scale: size / shape.offsetWidth }], { duration, easing, fill: 'forwards' })
      shape.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.4, easing: 'ease-out', fill: 'forwards' })
    } else {
      reveal = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-out', fill: 'forwards' })
    }
    // The window is uncovered once the spring first reaches its target, about
    // halfway through. Release the app then instead of waiting out the
    // overshoot, which only moves the hole's edge beyond the window.
    const uncovered = () => {
      if (reveal.effect.getComputedTiming().progress >= 1) finish()
      else frame = requestAnimationFrame(uncovered)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    timeout = setTimeout(finish, duration + 100)
    frame = requestAnimationFrame(uncovered)
    reveal.finished.then(finish, finish)
  } catch {
    // The ready app must never wait for a failed reveal.
    finish()
  }
}
