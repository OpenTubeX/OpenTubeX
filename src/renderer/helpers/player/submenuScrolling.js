import {
  addOverlayScrollbars,
  clampOverlayScrollTop,
  removeOverlayScrollbars,
  restoreOverlayScrollTop,
} from '../overlayScrollbars'

// Including the submenus of menu groups, such as the captions and their style.
// The caption submenus scroll their options in a part of their own.
const SCROLLING_SUBMENUS = '.shaka-sub-menu:not(.shaka-text-languages, .ft-caption-list-menu, .ft-caption-timing-menu)'

/**
 * Open and scrolling by itself, which it doesn't in the phone layout (`phonePlayerOptions.css`).
 * @param {HTMLElement} submenu
 */
function isOpenScroller(submenu) {
  return !submenu.classList.contains('shaka-hidden') && submenu.getClientRects().length > 0 &&
    getComputedStyle(submenu).overflowY !== 'visible'
}

/**
 * The last option, which ends the scroll range. The header and its action are fixed above the options.
 * @param {HTMLElement} submenu
 */
function lastOption(submenu) {
  return [...submenu.children].findLast(child => (
    !child.matches('.os-scrollbar, .shaka-back-to-overflow-button, .ft-submenu-header-action') &&
    child.getClientRects().length > 0
  )) ?? null
}

/**
 * Lets the overflow menu's submenus scroll their options below their header (`playerMenu.css`).
 *
 * @param {HTMLElement} menu
 * @param {EventTarget} controls
 * @returns {() => void} cleanup
 */
export function setupSubmenuScrolling(menu, controls) {
  const submenus = [...menu.querySelectorAll(SCROLLING_SUBMENUS)]
  let clampFrame = null
  let openFrame = null

  // Shaka rebuilds the options, options hide, and the menu resizes with the
  // player, all of which can shorten the range.
  function clamp() {
    clampFrame = null
    for (const submenu of submenus.filter(isOpenScroller)) {
      clampOverlayScrollTop(submenu, lastOption(submenu))
    }
  }
  const scheduleClamp = () => {
    clampFrame ??= requestAnimationFrame(clamp)
  }
  const resizeObserver = new ResizeObserver(scheduleClamp)
  const mutationObserver = new MutationObserver((records) => {
    if (records.some(record => !record.target.closest('.os-scrollbar'))) scheduleClamp()
  })

  // A submenu opens at its top, scrolled only as far as its chosen option needs.
  function onSubmenuOpen() {
    openFrame ??= requestAnimationFrame(() => {
      openFrame = null
      for (const submenu of submenus.filter(isOpenScroller)) {
        restoreOverlayScrollTop(submenu, 0)
        submenu.querySelector('.shaka-chosen-item')?.closest('button')
          ?.scrollIntoView({ block: 'nearest', container: 'nearest' })
      }
    })
  }

  // Shaka closes a submenu on any click in it, including the one that ends a
  // drag on its scrollbar.
  function onClick(event) {
    if (event.target.closest?.('.shaka-sub-menu .os-scrollbar')) {
      event.stopPropagation()
    }
  }

  for (const submenu of submenus) {
    submenu.classList.add('ft-scrolling-submenu')
    addOverlayScrollbars(submenu)
    resizeObserver.observe(submenu)
    mutationObserver.observe(submenu, { childList: true, subtree: true, attributeFilter: ['class'] })
  }
  controls.addEventListener('submenuopen', onSubmenuOpen)
  menu.addEventListener('click', onClick, true)

  return () => {
    if (clampFrame !== null) cancelAnimationFrame(clampFrame)
    if (openFrame !== null) cancelAnimationFrame(openFrame)
    resizeObserver.disconnect()
    mutationObserver.disconnect()
    controls.removeEventListener('submenuopen', onSubmenuOpen)
    menu.removeEventListener('click', onClick, true)
    for (const submenu of submenus) {
      submenu.classList.remove('ft-scrolling-submenu')
      removeOverlayScrollbars(submenu)
    }
  }
}
