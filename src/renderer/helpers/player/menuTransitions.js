/**
 * The overflow menu fades in and out, and moving between it and its submenus
 * zooms the new view into place (`playerMenu.css`). Shaka hides the old view
 * before its listeners run, so only the new one shows while the menu zooms.
 *
 * The zooms only run while the parent of the new view is marked, so that
 * the menu doesn't zoom when it opens or Shaka rebuilds its options later.
 * A marker under which nothing zooms, such as with reduced motion, expires
 * at once.
 *
 * @param {HTMLElement} menu the overflow menu
 * @param {EventTarget} controls
 * @returns {() => void} cleanup
 */
export function setupMenuTransitions(menu, controls) {
  /** @param {Event & { container?: unknown }} event */
  function onSubmenuOpen({ container }) {
    if (container instanceof HTMLElement && menu.contains(container)) {
      markMenuTransition(container, 'in')
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
      markMenuTransition(container, 'out')
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
   * submenu has zoomed in cancels that zoom under the new marker. The menu
   * zooms itself for the views of the menu groups in it too, which may have
   * been marked while it zoomed, while on phones the entries of a view with a
   * header action zoom (`playerMenu.css`). Leaving such a view while it zooms
   * cancels its entries' zoom while the next view zooms under the same
   * marker, so the marker stays while a zoom of its kind still runs.
   *
   * @param {AnimationEvent} event
   */
  function onAnimationEnd({ animationName, target }) {
    const zoom = animationName.match(/^ft-menu-zoom-(in|out)\b/)?.[1]
    if (!zoom || !(target instanceof HTMLElement)) return
    if (menu.getAnimations({ subtree: true }).some(animation => (
      animation instanceof CSSAnimation && animation.animationName.startsWith(`ft-menu-zoom-${zoom}`)
    ))) {
      return
    }
    const parents = target === menu
      ? [menu, ...menu.querySelectorAll('[data-ft-menu-transition]')]
      : [target.closest('[data-ft-menu-transition]')]
    for (const parent of parents) {
      if (parent instanceof HTMLElement && parent.dataset.ftMenuTransition === zoom) {
        delete parent.dataset.ftMenuTransition
      }
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
 * Zooms the view just shown in an overflow menu into place, as moving to a
 * submenu (`'in'`) or back from one (`'out'`) does. Shaka marks its own
 * submenus through its events, while views that switch themselves, such as
 * those of the captions menu, mark their container here. Outside an overflow
 * menu, nothing zooms.
 *
 * The zoom is looked for once the current task has switched the views,
 * anywhere in the menu, as the menu zooms itself for the views of its menu
 * groups. Without one, the marker expires.
 *
 * @param {HTMLElement} container the element holding the views
 * @param {'in' | 'out'} zoom
 */
export function markMenuTransition(container, zoom) {
  const menu = container.closest('.shaka-overflow-menu')
  if (!(menu instanceof HTMLElement)) return
  container.dataset.ftMenuTransition = zoom
  queueMicrotask(() => {
    if (
      container.dataset.ftMenuTransition === zoom &&
      !menu.getAnimations({ subtree: true }).some(animation => (
        animation instanceof CSSAnimation && animation.animationName.startsWith(`ft-menu-zoom-${zoom}`)
      ))
    ) {
      delete container.dataset.ftMenuTransition
    }
  })
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
