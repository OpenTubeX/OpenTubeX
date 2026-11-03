/**
 * The overflow menu fades in and out, and moving between it and its submenus
 * zooms the new view into place (`playerMenu.css`). Shaka hides the old view
 * before its listeners run, so only the new one animates.
 *
 * The zooms only run while the parent of the new view is marked, so that
 * options Shaka rebuilds later, and the entries shown when the menu opens,
 * appear without them. A marker under which nothing zooms, such as with
 * reduced motion, expires at once.
 *
 * @param {HTMLElement} menu the overflow menu
 * @param {EventTarget} controls
 * @returns {() => void} cleanup
 */
export function setupMenuTransitions(menu, controls) {
  /**
   * Shaka switches the views after sending its events, so the zoom is looked
   * for once it has.
   *
   * @param {HTMLElement} container
   * @param {'in' | 'out'} zoom
   */
  function mark(container, zoom) {
    container.dataset.ftMenuTransition = zoom
    queueMicrotask(() => {
      if (
        container.dataset.ftMenuTransition === zoom &&
        !container.getAnimations({ subtree: true }).some(animation => (
          animation instanceof CSSAnimation && animation.animationName.startsWith(`ft-menu-zoom-${zoom}`)
        ))
      ) {
        delete container.dataset.ftMenuTransition
      }
    })
  }

  /** @param {Event & { container?: unknown }} event */
  function onSubmenuOpen({ container }) {
    if (container instanceof HTMLElement && menu.contains(container)) {
      mark(container, 'in')
    }
  }

  /**
   * Shaka also sends this when the menu opens or closes, and on every seek bar
   * input, so only a submenu that was open counts.
   *
   * @param {Event & { container?: unknown }} event
   */
  function onSubmenuClose({ container }) {
    if (
      !(container instanceof HTMLElement) || !menu.contains(container) ||
      !container.querySelector(':scope > .shaka-sub-menu:not(.shaka-hidden)')
    ) {
      return
    }
    if (!menu.classList.contains('shaka-hidden') && menu.checkVisibility()) {
      mark(container, 'out')
    }
  }

  /**
   * Closing the menu returns it to its entries, which would show while it
   * fades out, so it closes at once from a submenu. Shaka hides the submenu
   * along with the menu, so only their old classes tell. Hidden by the frame
   * after, it can fade again.
   *
   * @param {MutationRecord[]} records
   */
  function onClassChange(records) {
    const wasOpen = record => !record.oldValue?.split(' ').includes('shaka-hidden')
    if (
      records.some(record => record.target === menu && wasOpen(record)) &&
      menu.classList.contains('shaka-hidden') &&
      records.some(record => record.target instanceof HTMLElement && record.target.classList.contains('shaka-sub-menu') && wasOpen(record))
    ) {
      menu.dataset.ftMenuInstantClose = ''
      requestAnimationFrame(() => requestAnimationFrame(() => {
        delete menu.dataset.ftMenuInstantClose
      }))
    }
  }
  const classObserver = new MutationObserver(onClassChange)

  /**
   * Only the zoom of the current marker clears it, as going back before the
   * submenu has zoomed in cancels that zoom under the new marker.
   *
   * @param {AnimationEvent} event
   */
  function onAnimationEnd({ animationName, target }) {
    const zoom = animationName.match(/^ft-menu-zoom-(in|out)\b/)?.[1]
    const parent = zoom && target instanceof HTMLElement ? target.closest('[data-ft-menu-transition]') : null
    if (parent instanceof HTMLElement && parent.dataset.ftMenuTransition === zoom) {
      delete parent.dataset.ftMenuTransition
    }
  }

  controls.addEventListener('submenuopen', onSubmenuOpen)
  controls.addEventListener('submenuclose', onSubmenuClose)
  menu.addEventListener('animationend', onAnimationEnd)
  menu.addEventListener('animationcancel', onAnimationEnd)
  classObserver.observe(menu, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true })

  return () => {
    classObserver.disconnect()
    controls.removeEventListener('submenuopen', onSubmenuOpen)
    controls.removeEventListener('submenuclose', onSubmenuClose)
    menu.removeEventListener('animationend', onAnimationEnd)
    menu.removeEventListener('animationcancel', onAnimationEnd)
    for (const element of menu.querySelectorAll('[data-ft-menu-transition]')) {
      if (element instanceof HTMLElement) delete element.dataset.ftMenuTransition
    }
    delete menu.dataset.ftMenuTransition
    delete menu.dataset.ftMenuInstantClose
  }
}

/**
 * Measures the final layout of the menu while it opens, or of a view in it
 * that is still zooming in, whose boxes are scaled until then.
 *
 * @template T
 * @param {HTMLElement} element the overflow menu, or an element in it
 * @param {() => T} measure
 * @returns {T}
 */
export function measureWithoutMenuZoom(element, measure) {
  const menu = element.closest('.shaka-overflow-menu') ?? element
  const scaled = menu.getAnimations({ subtree: true })
    .filter(animation => animation instanceof CSSAnimation && /^ft-menu-(open|zoom-)/.test(animation.animationName))
    .map(animation => animation.effect?.target)
    .filter(target => target instanceof HTMLElement)
  // Inline, as the menu's observers react to its classes.
  for (const target of scaled) target.style.setProperty('scale', 'none', 'important')
  try {
    return measure()
  } finally {
    for (const target of scaled) target.style.removeProperty('scale')
  }
}
