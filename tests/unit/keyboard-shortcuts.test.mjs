import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getConfiguredKeyboardShortcuts,
  sanitizeKeyboardShortcutOverrides,
} from '../../src/constants.js'
import {
  keyboardShortcutFromEvent,
  keyboardShortcutsOverlap,
  matchesKeyboardShortcut,
} from '../../src/renderer/helpers/keyboardShortcuts.js'

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

test('opens downloads with Ctrl or Command+J by default', () => {
  assert.equal(getConfiguredKeyboardShortcuts().APP.GENERAL.NAVIGATE_TO_DOWNLOADS, 'ctrl+J')
})

test('copies the current URL with Ctrl or Command+Shift+C by default', () => {
  assert.equal(getConfiguredKeyboardShortcuts().APP.GENERAL.COPY_CURRENT_URL, 'ctrl+shift+C')
})

test('reserves Ctrl or Command+Shift+C for copying the current URL', async () => {
  const source = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
  const start = source.indexOf("label: 'Enter Inspect Element Mode'")
  const menuItem = source.slice(start, source.indexOf('\n          },', start))

  assert.match(menuItem, /accelerator: 'CmdOrCtrl\+Shift\+Alt\+C'/)
  assert.doesNotMatch(menuItem, /accelerator: 'CmdOrCtrl\+Shift\+C'/)
})

test('reopens closed windows with a configurable Ctrl+Shift+N shortcut', () => {
  assert.equal(getConfiguredKeyboardShortcuts().APP.GENERAL.RESTORE_CLOSED_WINDOW, 'ctrl+shift+N')
  const overrides = { APP: { GENERAL: { RESTORE_CLOSED_WINDOW: 'alt+N' } } }
  assert.equal(getConfiguredKeyboardShortcuts(overrides).APP.GENERAL.RESTORE_CLOSED_WINDOW, 'alt+N')
})

test('reloads tabs with Ctrl or Command+R and F5 by default', () => {
  const shortcuts = getConfiguredKeyboardShortcuts().APP.GENERAL

  assert.equal(shortcuts.RELOAD_TAB, 'ctrl+R')
  assert.equal(shortcuts.RELOAD_TAB_ALT, 'f5')
})

test('does not duplicate an existing F5 reload override', () => {
  const overrides = {
    APP: {
      GENERAL: {
        RELOAD_TAB: 'F5',
      }
    }
  }
  const shortcuts = getConfiguredKeyboardShortcuts(overrides).APP.GENERAL

  assert.equal(shortcuts.RELOAD_TAB, 'F5')
  assert.equal(shortcuts.RELOAD_TAB_ALT, '')
  assert.deepEqual(JSON.parse(sanitizeKeyboardShortcutOverrides(overrides)), {
    APP: {
      GENERAL: {
        RELOAD_TAB: 'F5',
        RELOAD_TAB_ALT: '',
      }
    }
  })
})

test('allows the tab organizer shortcut to be configured', () => {
  assert.equal(getConfiguredKeyboardShortcuts().APP.GENERAL.OPEN_TAB_ORGANIZER, '')
  assert.equal(getConfiguredKeyboardShortcuts({
    APP: {
      GENERAL: {
        OPEN_TAB_ORGANIZER: 'ctrl+shift+o',
      }
    }
  }).APP.GENERAL.OPEN_TAB_ORGANIZER, 'ctrl+shift+o')
})

test('allows A-B repeat shortcuts to be configured', () => {
  const shortcuts = getConfiguredKeyboardShortcuts({
    VIDEO_PLAYER: {
      PLAYBACK: {
        SET_AB_REPEAT_START: 'alt+a',
        SET_AB_REPEAT_END: 'alt+b',
        CLEAR_AB_REPEAT: '',
      }
    }
  })

  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_START, 'alt+a')
  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.SET_AB_REPEAT_END, 'alt+b')
  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.CLEAR_AB_REPEAT, '')
})

test('persists SponsorBlock shortcut assignments and allows clearing them', () => {
  const overrides = {
    VIDEO_PLAYER: {
      SPONSORBLOCK: {
        START_SPONSORBLOCK_SEGMENT: 'alt+a',
        END_SPONSORBLOCK_SEGMENT: 'alt+b',
        OPEN_SPONSORBLOCK_SUBMISSION_MENU: 'alt+s',
        CANCEL_SPONSORBLOCK_SEGMENT: 'alt+x',
        CLEAR_SPONSORBLOCK_SEGMENTS: 'alt+c',
      }
    }
  }
  const sanitized = sanitizeKeyboardShortcutOverrides(JSON.stringify(overrides))
  assert.deepEqual(getConfiguredKeyboardShortcuts(sanitized).VIDEO_PLAYER.SPONSORBLOCK, overrides.VIDEO_PLAYER.SPONSORBLOCK)
  assert.equal(getConfiguredKeyboardShortcuts({
    VIDEO_PLAYER: { SPONSORBLOCK: { START_SPONSORBLOCK_SEGMENT: '' } }
  }).VIDEO_PLAYER.SPONSORBLOCK.START_SPONSORBLOCK_SEGMENT, '')
})

test('uses the SponsorBlock extension defaults for segment boundaries and the submission menu', () => {
  assert.deepEqual(getConfiguredKeyboardShortcuts().VIDEO_PLAYER.SPONSORBLOCK, {
    START_SPONSORBLOCK_SEGMENT: ';',
    END_SPONSORBLOCK_SEGMENT: ';',
    OPEN_SPONSORBLOCK_SUBMISSION_MENU: "'",
    CANCEL_SPONSORBLOCK_SEGMENT: '',
    CLEAR_SPONSORBLOCK_SEGMENTS: '',
  })
})

test('recognizes semicolons that require Shift on the keyboard layout', () => {
  const event = { key: ';', code: 'Comma', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }
  assert.equal(matchesKeyboardShortcut(event, ';'), true)
  assert.equal(keyboardShortcutFromEvent(event), ';')
  assert.equal(keyboardShortcutsOverlap('shift+;', ';'), true)
  assert.equal(matchesKeyboardShortcut({ ...event, key: ',', shiftKey: false }, ';'), false)
  assert.equal(matchesKeyboardShortcut({ ...event, ctrlKey: true }, ';'), false)
})
