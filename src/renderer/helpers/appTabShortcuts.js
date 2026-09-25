/**
 * Handle shortcuts owned by Electron tab navigation. The root component keeps
 * modal and findbar shortcuts, while these callbacks own tab lifecycle.
 *
 * @param {{
 *   shortcuts: Record<string, unknown>,
 *   matchesShortcut: (event: KeyboardEvent, shortcut: unknown) => boolean,
 *   isTypingTarget: (target: EventTarget | null) => boolean,
 *   tabs: () => Array<{id: string}>,
 *   routePath: () => string,
 *   activateTab: (id: string) => unknown,
 *   cycleLayout: () => unknown,
 *   createTab: () => unknown,
 *   restoreClosedWindow: () => unknown,
 *   restoreClosedTab: () => unknown,
 *   closeTabs: () => Promise<boolean>,
 *   closeWindow: () => unknown,
 *   cycleSwitcher: (direction: number) => unknown,
 *   tabIdsToReload: () => string[],
 *   reloadTab: (id: string) => unknown,
 * }} dependencies
 */
export function createAppTabShortcuts({
  shortcuts, matchesShortcut, isTypingTarget, tabs, routePath, activateTab,
  cycleLayout, createTab, restoreClosedWindow, restoreClosedTab,
  closeTabs, closeWindow, cycleSwitcher, tabIdsToReload, reloadTab,
}) {
  /** @param {KeyboardEvent} event */
  function handle(event) {
    if (matchesShortcut(event, shortcuts.SWITCH_TO_TAB)) {
      if (!isTypingTarget(event.target)) {
        const index = parseInt(event.key, 10) - 1
        const currentTabs = tabs()
        if (index < currentTabs.length) {
          event.preventDefault()
          activateTab(currentTabs[index].id)
          return true
        }
      }
    }

    if (matchesShortcut(event, shortcuts.TOGGLE_TAB_ORIENTATION) && !isTypingTarget(event.target)) {
      event.preventDefault()
      cycleLayout()
      return true
    }
    if (matchesShortcut(event, shortcuts.NEW_TAB)) {
      event.preventDefault()
      createTab()
      return true
    }
    if (matchesShortcut(event, shortcuts.RESTORE_CLOSED_WINDOW)) {
      event.preventDefault()
      restoreClosedWindow()
      return true
    }
    if (matchesShortcut(event, shortcuts.RESTORE_CLOSED_TAB)) {
      event.preventDefault()
      restoreClosedTab()
      return true
    }
    if (matchesShortcut(event, shortcuts.CLOSE_TAB)) {
      event.preventDefault()
      closeTabs().then((hasRemainingTabs) => {
        if (!hasRemainingTabs) closeWindow()
      })
      return true
    }
    if (matchesShortcut(event, shortcuts.NEXT_TAB)) {
      event.preventDefault()
      cycleSwitcher(1)
      return true
    }
    if (matchesShortcut(event, shortcuts.PREV_TAB)) {
      event.preventDefault()
      cycleSwitcher(-1)
      return true
    }
    if ([shortcuts.RELOAD_TAB, shortcuts.RELOAD_TAB_ALT]
      .some(shortcut => matchesShortcut(event, shortcut))) {
      const tabIds = tabIdsToReload()
      if (tabIds.length === 1 && routePath().startsWith('/subscriptions')) {
        event.preventDefault()
        return true
      }
      event.preventDefault()
      for (const tabId of tabIds) reloadTab(tabId)
      return true
    }
    return false
  }

  return { handle }
}
