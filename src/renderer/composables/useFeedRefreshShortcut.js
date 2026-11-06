import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

import store from '../store/index'
import { KeyboardShortcuts } from '../../constants'
import { matchesKeyboardShortcut } from '../helpers/keyboardShortcuts'
import { useTabContext } from '../tabs/TabContext'

/**
 * Refreshes a feed with the refresh shortcut, or the reload tab shortcuts in
 * a window with a single selected tab.
 * @param {() => boolean} canRefresh
 * @param {() => void} refresh
 */
export function useFeedRefreshShortcut(canRefresh, refresh) {
  const { isTabPresented } = useTabContext()

  /**
   * @param {KeyboardEvent} event
   */
  function keyboardShortcutHandler(event) {
    // Tabs stay mounted while not presented, so this document-level listener would
    // otherwise refresh the feed of a background tab. Only handle the shortcut
    // when this tab is the one currently on screen.
    if (isTabPresented && !isTabPresented.value) {
      return
    }
    const target = event.target
    if (target instanceof HTMLElement && (
      target.matches('input, textarea, select') || target.isContentEditable
    )) {
      return
    }
    // Avoid handling events due to user holding a key (not released)
    // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat
    if (event.repeat) { return }

    if (
      (
        matchesKeyboardShortcut(event, KeyboardShortcuts.APP.SITUATIONAL.REFRESH) ||
        (
          process.env.IS_ELECTRON &&
          store.getters.getSelectedTabIds.length <= 1 &&
          [
            KeyboardShortcuts.APP.GENERAL.RELOAD_TAB,
            KeyboardShortcuts.APP.GENERAL.RELOAD_TAB_ALT,
          ].some(shortcut => matchesKeyboardShortcut(event, shortcut))
        )
      ) &&
      canRefresh()
    ) {
      event.preventDefault()
      refresh()
    }
  }

  function addKeyboardShortcutListener() {
    document.addEventListener('keydown', keyboardShortcutHandler)
  }

  function removeKeyboardShortcutListener() {
    document.removeEventListener('keydown', keyboardShortcutHandler)
  }

  onMounted(addKeyboardShortcutListener)
  onActivated(addKeyboardShortcutListener)
  onDeactivated(removeKeyboardShortcutListener)
  onBeforeUnmount(removeKeyboardShortcutListener)
}
