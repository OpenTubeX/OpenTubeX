import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getConfiguredKeyboardShortcuts,
  sanitizeKeyboardShortcutOverrides,
} from '../../src/constants.js'

test('keeps contextual app shortcuts fixed', () => {
  const overrides = {
    APP: {
      GENERAL: {
        FOCUS_SEARCH: 'ctrl+k',
        FOCUS_SEARCH_ALT_SLASH: 'ctrl+shift+f',
        SEARCH_IN_NEW_WINDOW: 'ctrl+enter',
        FIND_NEXT_ALT_ENTER: 'ctrl+down',
        FIND_PREVIOUS_ALT_ENTER: 'ctrl+up',
        NEXT_TAB: 'alt+arrowright',
        PREV_TAB: 'alt+arrowleft',
      }
    }
  }

  const shortcuts = getConfiguredKeyboardShortcuts(overrides)
  const persistedShortcuts = getConfiguredKeyboardShortcuts(JSON.stringify(overrides))
  assert.equal(shortcuts.APP.GENERAL.FOCUS_SEARCH, 'ctrl+k')
  assert.equal(shortcuts.APP.GENERAL.FOCUS_SEARCH_ALT_SLASH, '/')
  assert.equal(shortcuts.APP.GENERAL.SEARCH_IN_NEW_WINDOW, 'shift+enter')
  assert.equal(shortcuts.APP.GENERAL.FIND_NEXT_ALT_ENTER, 'enter')
  assert.equal(shortcuts.APP.GENERAL.FIND_PREVIOUS_ALT_ENTER, 'shift+enter')
  assert.equal(shortcuts.APP.GENERAL.NEXT_TAB, 'control+tab')
  assert.equal(shortcuts.APP.GENERAL.PREV_TAB, 'control+shift+tab')
  assert.deepEqual(persistedShortcuts, shortcuts)

  const sanitizedOverrides = {
    APP: {
      GENERAL: {
        FOCUS_SEARCH: 'ctrl+k',
      }
    }
  }
  assert.deepEqual(JSON.parse(sanitizeKeyboardShortcutOverrides(overrides)), sanitizedOverrides)
  assert.deepEqual(
    JSON.parse(sanitizeKeyboardShortcutOverrides(JSON.stringify(overrides))),
    sanitizedOverrides
  )
})
