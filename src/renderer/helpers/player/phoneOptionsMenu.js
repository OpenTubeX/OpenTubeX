import shaka from 'shaka-player'
import { PHONE_LAYOUT_QUERY } from '../../composables/usePhoneLayout'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../overlayScrollbars'

/** Keep Shaka's controls and selection state, presenting their menu over the video on phones without locking page scrolling. */
export function setupPhoneOptionsMenu(menu, controls, t) {
  const parent = menu.parentElement
  const dialog = document.createElement('dialog')
  dialog.className = 'phonePlayerOptions shaka-no-propagation'
  dialog.ariaLabel = t('Video.More Options')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'phonePlayerOptionsClose'
  close.ariaLabel = t('Close')
  const closeIcon = new shaka.ui.Icon(close, shaka.ui.Enums.MaterialDesignSVGIcons.CLOSE)
  closeIcon.getSvgElement().setAttribute('aria-hidden', 'true')
  close.addEventListener('click', dismiss)
  dialog.append(close)
  parent.append(dialog)
  const query = window.matchMedia(PHONE_LAYOUT_QUERY)
  let frame = null
  let activeView = null
  let previousFocus = null
  // Shaka rebuilds submenus around their back button, so it stays in place and
  // the dialog's header shows a copy of it.
  let headerSource = null
  let headerSnapshot = ''
  let header = null

  function updateHeader(submenu) {
    const source = submenu?.querySelector('.shaka-back-to-overflow-button') ?? null
    const snapshot = source?.outerHTML ?? ''
    if (source === headerSource && snapshot === headerSnapshot) return
    headerSource = source
    headerSnapshot = snapshot
    header?.remove()
    header = source?.cloneNode(true) ?? null
    if (header) dialog.prepend(header)
  }

  // A submenu's header action, which stays in the submenu for the same reason,
  // is positioned into the header while it fits beside the title.
  let spacedAction = null

  function updateHeaderAction(submenu) {
    const action = header && submenu?.querySelector(':scope > .ft-submenu-header-action')
    if (spacedAction) spacedAction.style.marginBlock = ''
    spacedAction = null
    dialog.toggleAttribute('data-header-action', Boolean(action))
    if (!action) return
    const range = document.createRange()
    range.selectNodeContents(header)
    const title = range.getBoundingClientRect()
    const bounds = action.getBoundingClientRect()
    const gap = 8
    if (title.right + gap > bounds.left && bounds.right + gap > title.left) {
      dialog.removeAttribute('data-header-action')
      if (submenu.classList.contains('ft-menu-grid')) spaceAroundAction(submenu, action)
    }
  }

  // The grid's options are centred, so share the free space evenly above the
  // action, between it and the options, and below them.
  function spaceAroundAction(submenu, action) {
    const options = [...submenu.children]
      .filter(child => child !== action && child.getClientRects().length > 0)
      .map(child => child.getBoundingClientRect())
    if (options.length === 0) return
    const top = header.getBoundingClientRect().bottom
    const bottom = menu.getBoundingClientRect().bottom
    const optionsTop = Math.min(...options.map(option => option.top))
    const optionsBottom = Math.max(...options.map(option => option.bottom))
    const bounds = action.getBoundingClientRect()
    const space = (bottom - top - bounds.height - (optionsBottom - optionsTop)) / 3
    // Without room to spare, the menu scrolls and keeps the default spacing
    if (space <= 0) return
    const rowGap = parseFloat(getComputedStyle(submenu).rowGap) || 0
    action.style.marginBlock = `${top + space - bounds.top}px ${space - rowGap}px`
    spacedAction = action
  }

  function visibleSubmenu() {
    return [...menu.querySelectorAll('.shaka-sub-menu:not(.shaka-hidden)')]
      .filter(element => element.getClientRects().length > 0).at(-1) ?? null
  }

  function dismiss() {
    controls.hideSettingsMenus()
    menu.classList.add('shaka-hidden')
    update()
  }

  // The header is updated on the next frame, so a second Back before then must
  // look at the submenus themselves.
  function openBackButton() {
    return visibleSubmenu()?.querySelector('.shaka-back-to-overflow-button') ?? null
  }

  function goBack() {
    const button = openBackButton()
    if (button) button.click()
    else dismiss()
    schedule()
  }

  function update() {
    frame = null
    const open = query.matches && !menu.classList.contains('shaka-hidden')
    if (open && !dialog.open) {
      previousFocus = document.activeElement
      dialog.append(menu)
      dialog.show()
      close.focus({ preventScroll: true })
    } else if (!open && dialog.open) {
      dialog.close()
      updateHeader(null)
      updateHeaderAction(null)
      parent.append(menu)
      activeView = null
      const trigger = parent.querySelector('.shaka-overflow-menu-button')
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
    if (!open) return
    const submenu = visibleSubmenu()
    const view = submenu ?? menu
    updateHeader(submenu)
    if (view !== activeView) {
      activeView = view
      restoreOverlayScrollTop(menu, 0)
    }
    // Measured once the new view starts at the top
    updateHeaderAction(submenu)
    const end = [...view.children].filter(child => child.getClientRects().length > 0 && !child.classList.contains('os-scrollbar')).at(-1)
    clampOverlayScrollTop(menu, end ?? view)
  }

  function schedule() {
    frame ??= requestAnimationFrame(update)
  }

  let outsidePointer = null
  function handleOutsidePointer(event) {
    dialog.toggleAttribute('data-touch-input', event.pointerType === 'touch')
    outsidePointer = dialog.open && !dialog.contains(event.target)
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: window.scrollY }
      : null
  }
  function finishOutsidePointer(event) {
    const start = outsidePointer
    outsidePointer = null
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8 && Math.abs(window.scrollY - start.scroll) < 2) dismiss()
  }
  function cancelOutsidePointer() { outsidePointer = null }
  document.addEventListener('pointerdown', handleOutsidePointer, true)
  document.addEventListener('pointerup', finishOutsidePointer, true)
  document.addEventListener('pointercancel', cancelOutsidePointer, true)
  dialog.addEventListener('click', event => {
    if (header?.contains(event.target)) {
      event.stopPropagation()
      // Shaka handles Back through the submenu's bubbling click listener.
      openBackButton()?.click()
      schedule()
    }
  }, true)
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target === menu) dismiss()
  })
  dialog.addEventListener('cancel', event => {
    event.preventDefault()
    goBack()
  })
  dialog.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') dialog.removeAttribute('data-touch-input')
  })
  dialog.addEventListener('keydown', event => {
    dialog.removeAttribute('data-touch-input')
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      goBack()
    }
  })
  for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
    dialog.addEventListener(type, event => event.stopPropagation())
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('.os-scrollbar') &&
      (record.type !== 'attributes' || record.oldValue !== record.target.getAttribute('class')))) schedule()
  })
  observer.observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, characterData: true })
  const resize = new ResizeObserver(schedule)
  resize.observe(menu)
  resize.observe(parent.closest('.ftVideoPlayer') ?? parent)
  query.addEventListener('change', schedule)
  window.addEventListener('resize', schedule)
  schedule()

  return () => {
    document.removeEventListener('pointerdown', handleOutsidePointer, true)
    document.removeEventListener('pointerup', finishOutsidePointer, true)
    document.removeEventListener('pointercancel', cancelOutsidePointer, true)
    observer.disconnect()
    resize.disconnect()
    cancelAnimationFrame(frame)
    query.removeEventListener('change', schedule)
    window.removeEventListener('resize', schedule)
    updateHeader(null)
    updateHeaderAction(null)
    if (dialog.contains(menu)) {
      if (parent.querySelector(':scope > .shaka-overflow-menu')) menu.remove()
      else parent.append(menu)
    }
    dialog.remove()
  }
}
