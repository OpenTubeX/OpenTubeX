import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppTabShortcuts } from '../../src/renderer/helpers/appTabShortcuts.js'

function fixture (overrides = {}) {
  const calls = []
  const shortcuts = {
    SWITCH_TO_TAB: 'switch',
    TOGGLE_TAB_ORIENTATION: 'layout',
    NEW_TAB: 'new',
    RESTORE_CLOSED_WINDOW: 'restoreWindow',
    RESTORE_CLOSED_TAB: 'restoreTab',
    CLOSE_TAB: 'close',
    NEXT_TAB: 'next',
    PREV_TAB: 'previous',
    RELOAD_TAB: 'reload',
    RELOAD_TAB_ALT: 'reloadAlt',
  }
  const controller = createAppTabShortcuts({
    shortcuts,
    matchesShortcut: (event, shortcut) => event.shortcut === shortcut,
    isTypingTarget: target => target === 'input',
    tabs: () => [{ id: 'first' }, { id: 'second' }],
    routePath: () => '/watch/123',
    activateTab: id => calls.push(['activate', id]),
    cycleLayout: () => calls.push(['layout']),
    createTab: () => calls.push(['new']),
    restoreClosedWindow: () => calls.push(['restoreWindow']),
    restoreClosedTab: () => calls.push(['restoreTab']),
    closeTabs: async () => { calls.push(['close']); return true },
    closeWindow: () => calls.push(['closeWindow']),
    cycleSwitcher: direction => calls.push(['switcher', direction]),
    tabIdsToReload: () => ['first'],
    reloadTab: id => calls.push(['reload', id]),
    ...overrides,
  })
  const event = (shortcut, options = {}) => ({
    shortcut, key: '2', target: null, preventDefault: () => calls.push(['prevent']), ...options,
  })
  return { controller, calls, event }
}

test('tab shortcuts switch by number only outside typing fields', () => {
  const { controller, calls, event } = fixture()
  assert.equal(controller.handle(event('switch', { target: 'input' })), false)
  assert.deepEqual(calls, [])
  assert.equal(controller.handle(event('switch')), true)
  assert.deepEqual(calls, [['prevent'], ['activate', 'second']])
})

test('tab shortcuts retain close, cycle, and reload behavior', async () => {
  const { controller, calls, event } = fixture()
  controller.handle(event('next'))
  controller.handle(event('previous'))
  controller.handle(event('close'))
  controller.handle(event('reload'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [
    ['prevent'], ['switcher', 1], ['prevent'], ['switcher', -1],
    ['prevent'], ['close'], ['prevent'], ['reload', 'first'],
  ])
})

test('subscriptions route reserves single-tab reload for its own refresh', () => {
  const { controller, calls, event } = fixture({ routePath: () => '/subscriptions' })
  assert.equal(controller.handle(event('reloadAlt')), true)
  assert.deepEqual(calls, [['prevent']])
})
