/**
 * Like Shaka's submenus, a click on empty space in a custom submenu goes back.
 * A press that starts on the scrollbar ends in a click on the menu when dragged.
 * @param {shaka.util.EventManager} eventManager
 * @param {HTMLElement} menu
 * @param {() => void} goBack
 * @param {string} [controls] Selector of further elements whose clicks stay in the menu
 */
export function goBackOnEmptyClicks(eventManager, menu, goBack, controls) {
  const selector = ['button, input, select, label, .os-scrollbar', controls].filter(Boolean).join(', ')
  let pressTarget = null
  eventManager.listen(menu, 'pointerdown', (event) => {
    pressTarget = event.target
  })
  eventManager.listen(menu, 'click', (event) => {
    const targets = [event.target, pressTarget]
    pressTarget = null
    if (!targets.some(target => target?.closest(selector))) {
      goBack()
    }
  })
}
