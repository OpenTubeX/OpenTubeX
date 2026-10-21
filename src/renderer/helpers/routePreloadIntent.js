// Deliberate clicks follow a pointer rest of a few hundred milliseconds, while
// pointers crossing a list stay on each link for less than this.
export const ROUTE_PRELOAD_INTENT_DELAY_MS = 80

/**
 * Loads the code of internal link destinations while the pointer rests on a
 * link or keyboard focus stays on it, so the click does not wait for it.
 * Only the route component's code is loaded: nothing mounts, fetches or
 * changes the route before the click.
 *
 * @param {object} options
 * @param {(path: string) => Promise<unknown>} options.preload loads the code for a route path
 * @param {EventTarget} [options.target]
 * @param {number} [options.delay]
 * @returns {() => void} removes the listeners
 */
export function installRoutePreloadIntent({
  preload,
  target = document,
  delay = ROUTE_PRELOAD_INTENT_DELAY_MS
}) {
  /** @type {Element | null} */
  let intentLink = null
  let timer = null

  const cancel = () => {
    clearTimeout(timer)
    timer = null
    intentLink = null
  }

  /** @param {Element | null} link */
  const startIntent = (link) => {
    if (link === intentLink) return
    cancel()
    if (link === null) return
    intentLink = link
    timer = setTimeout(() => {
      timer = null
      const path = link.getAttribute('href').slice(1)
      // A failed preload leaves the click to load and report the route itself.
      new Promise(resolve => resolve(preload(path))).catch(() => {})
    }, delay)
  }

  /** @param {PointerEvent} event */
  const handlePointerMove = (event) => {
    // Touch and stylus taps have no hover phase before their click.
    if (event.pointerType !== 'mouse') return
    startIntent(findInternalLink(event.target))
  }

  /** @param {FocusEvent} event */
  const handleFocusIn = (event) => {
    // Pointer clicks also focus links; only keyboard focus shows intent.
    const link = findInternalLink(event.target)
    if (link?.matches(':focus-visible')) startIntent(link)
  }

  /** @param {PointerEvent} event */
  const handlePointerOut = (event) => {
    if (event.relatedTarget === null) cancel()
  }

  /** @param {FocusEvent} event */
  const handleFocusOut = (event) => {
    if (findInternalLink(event.target) === intentLink) cancel()
  }

  const listeners = [
    ['pointermove', handlePointerMove],
    ['pointerout', handlePointerOut],
    ['focusin', handleFocusIn],
    ['focusout', handleFocusOut],
    // Content scrolling beneath a resting pointer is not intent.
    ['scroll', cancel],
    ['pointerdown', cancel]
  ]
  for (const [type, listener] of listeners) {
    target.addEventListener(type, listener, { capture: true, passive: true })
  }

  return () => {
    cancel()
    for (const [type, listener] of listeners) {
      target.removeEventListener(type, listener, { capture: true })
    }
  }
}

/** @param {EventTarget | null} target */
function findInternalLink(target) {
  return target instanceof Element ? target.closest('a[href^="#/"]') : null
}
