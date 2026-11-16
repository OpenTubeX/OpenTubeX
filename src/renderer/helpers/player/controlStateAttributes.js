// @ts-check

const POINTER_STATES = {
  'data-seek-bar-hovered': '.shaka-seek-bar-container:hover',
  'data-control-tooltip-shown': '.shaka-controls-button-panel > :is(.shaka-tooltip, .shaka-tooltip-status):is(:hover, :focus-visible, :active)',
}

const POINTER_EVENTS = ['pointerover', 'pointerout', 'pointerdown', 'focusin', 'focusout', 'keydown', 'keyup']
// A press ends wherever the pointer is released, even outside the controls.
const RELEASE_EVENTS = ['pointerup', 'pointercancel']

const OPEN_MENU = '.shaka-overflow-menu:not(.shaka-hidden), .shaka-sub-menu:not(.shaka-hidden)'
const MENU_BUTTON_STATE = 'data-menu-open'

/**
 * Marks the player while its seek bar is hovered or a control bar tooltip
 * shows, so that its overlays can make way for them (`fullscreen.css`), and
 * the options button while a menu is open (`controlBar.css`).
 *
 * A `.ftVideoPlayer:has(...) .overlay` rule would need no script, but Chromium
 * restyles every descendant of such an ancestor that any rule like it could
 * match whenever a class, attribute or state that any `:has()` checks changes
 * below it. Opening the options menu or moving between its entries would then
 * restyle much of the player each time, and the whole page for a rule on the
 * page layout. Rules on the element that `:has()` checks itself restyle only
 * that element.
 *
 * @param {HTMLElement} player the element the overlays are styled from
 * @param {HTMLElement} controlsContainer
 * @returns {() => void} cleanup
 */
export function mirrorControlStates(player, controlsContainer) {
  /** @type {number | null} */
  let frame = null

  function updatePointerStates() {
    for (const [attribute, selector] of Object.entries(POINTER_STATES)) {
      player.toggleAttribute(attribute, controlsContainer.querySelector(selector) !== null)
    }
  }

  // Update at once: a press right after the pointer moves onto a dock action
  // must find the dock raised again. Check once more in the next frame for
  // states that settle after their event.
  const syncPointerStates = () => {
    updatePointerStates()
    frame ??= requestAnimationFrame(() => {
      frame = null
      updatePointerStates()
    })
  }

  function updateMenuButtons() {
    const open = controlsContainer.querySelector(OPEN_MENU) !== null
    for (const button of controlsContainer.querySelectorAll('.shaka-overflow-menu-button')) {
      button.toggleAttribute(MENU_BUTTON_STATE, open)
    }
  }
  // Menus also close on timers and clicks elsewhere, so follow their classes.
  const menuObserver = new MutationObserver(updateMenuButtons)

  for (const event of POINTER_EVENTS) {
    // Capturing, as the controls stop some events from reaching their container.
    controlsContainer.addEventListener(event, syncPointerStates, { capture: true, passive: true })
  }
  for (const event of RELEASE_EVENTS) {
    controlsContainer.ownerDocument.addEventListener(event, syncPointerStates, { capture: true, passive: true })
  }
  menuObserver.observe(controlsContainer, { attributes: true, attributeFilter: ['class'], subtree: true })
  updatePointerStates()
  updateMenuButtons()

  return () => {
    for (const event of POINTER_EVENTS) {
      controlsContainer.removeEventListener(event, syncPointerStates, { capture: true })
    }
    for (const event of RELEASE_EVENTS) {
      controlsContainer.ownerDocument.removeEventListener(event, syncPointerStates, { capture: true })
    }
    menuObserver.disconnect()
    if (frame !== null) cancelAnimationFrame(frame)
    for (const attribute of Object.keys(POINTER_STATES)) player.removeAttribute(attribute)
    for (const button of controlsContainer.querySelectorAll('.shaka-overflow-menu-button')) {
      button.removeAttribute(MENU_BUTTON_STATE)
    }
  }
}
