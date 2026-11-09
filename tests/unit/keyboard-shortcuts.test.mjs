import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getConfiguredKeyboardShortcuts,
  sanitizeKeyboardShortcutOverrides,
} from '../../src/constants.js'

test('keeps contextual app and playback shortcuts fixed', () => {
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
    },
    VIDEO_PLAYER: {
      PLAYBACK: {
        PLAY_ALT: 'alt+p',
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
  assert.equal(shortcuts.VIDEO_PLAYER.PLAYBACK.PLAY_ALT, 'space')
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
