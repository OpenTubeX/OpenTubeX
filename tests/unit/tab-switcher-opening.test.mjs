import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const handlers = source.slice(source.indexOf('function handleKeyboardShortcutKeyup('), source.indexOf('async function prepareAndReloadTab('))

function createSwitcher() {
  const timers = new Map()
  const ticks = []
  const work = { previews: 0, capturePause: [], scroll: 0, activated: [] }
  const visible = { value: false }
  const tabs = { value: [{ id: 'first' }, { id: 'second' }, { id: 'third' }] }
  const context = {
    tabSwitcherVisible: visible,
    tabSwitcherTabs: tabs,
    tabSwitcherSelectedIndex: { value: -1 },
    tabSwitcherSelectedTabId: { value: 'selected' },
    tabSwitcherPreviewUrls: { value: {} },
    tabSwitcherPreviewPending: { value: {} },
    tabSwitcherFailedAvatarUrls: { value: {} },
    tabSwitcherFailedPreviewUrls: { value: {} },
    tabSwitcherPointerActive: { value: false },
    showTabPreviews: { value: true },
    process: { env: { IS_ELECTRON: true } },
    store: { getters: { getActiveTabId: 'first' }, dispatch: (_, id) => work.activated.push(id) },
    window: { ftElectron: { tabs: {
      setPreviewCapturePaused: paused => work.capturePause.push(paused),
      getCachedPreviews: async () => { work.previews++; return {} }
    } } },
    nextTick: callback => ticks.push(callback),
    document: { getElementById: () => ({ scrollIntoView: () => work.scroll++ }) },
    setTimeout: callback => { timers.set(callback, callback); return callback },
    clearTimeout: id => timers.delete(id)
  }
  const api = vm.runInNewContext(`
    ${source.slice(source.indexOf('let tabSwitcherPreviewRequestId'), source.indexOf('let findbarMatches'))}
    ${handlers}
    ;({ cycleTabSwitcher, cancelTabSwitcher, handleKeyboardShortcutKeyup })`, context)
  return {
    ...api, visible, work, tabs, timers,
    flushRender() { for (const callback of ticks.splice(0)) callback() },
    release() { api.handleKeyboardShortcutKeyup({ key: 'Control', ctrlKey: false, preventDefault() {} }) },
    openMenu() { for (const callback of [...timers.values()]) { timers.delete(callback); callback() } }
  }
}

for (const [direction, target] of [[1, 'second'], [-1, 'third']]) {
  test(`quick Ctrl+${direction < 0 ? 'Shift+' : ''}Tab skips menu rendering and preview work`, () => {
    const switcher = createSwitcher()
    switcher.cycleTabSwitcher(direction)
    assert.equal(switcher.visible.value, false, 'A quick switch must not mount the menu')
    switcher.release()
    switcher.openMenu()
    assert.deepEqual(switcher.work, { previews: 0, capturePause: [], scroll: 0, activated: [target] })
    assert.equal(switcher.visible.value, false)
  })
}

test('repeated presses accumulate and reverse before opening without restarting the delay', () => {
  const switcher = createSwitcher()
  switcher.cycleTabSwitcher(1)
  const timer = [...switcher.timers.keys()][0]
  switcher.cycleTabSwitcher(1)
  switcher.cycleTabSwitcher(-1)
  assert.deepEqual([...switcher.timers.keys()], [timer])
  switcher.release()
  switcher.openMenu()
  switcher.flushRender()
  assert.deepEqual(switcher.work, { previews: 0, capturePause: [], scroll: 0, activated: ['second'] })
})

test('holding Control opens once and commits the latest selection on release', () => {
  const switcher = createSwitcher()
  switcher.cycleTabSwitcher(-1)
  switcher.handleKeyboardShortcutKeyup({ key: 'Tab', ctrlKey: true, preventDefault() {} })
  switcher.openMenu()
  assert.equal(switcher.visible.value, true)
  switcher.cycleTabSwitcher(-1)
  switcher.cycleTabSwitcher(1)
  switcher.flushRender()
  assert.deepEqual(switcher.work, { previews: 1, capturePause: [true], scroll: 1, activated: [] })
  switcher.release()
  assert.deepEqual(switcher.work.activated, ['third'])
  assert.deepEqual(switcher.work.capturePause, [true, false])
  assert.equal(switcher.visible.value, false)
})

for (const opened of [false, true]) {
  test(`cancelling a ${opened ? 'visible' : 'pending'} switch never activates or reopens it`, () => {
    const switcher = createSwitcher()
    switcher.cycleTabSwitcher(1)
    if (opened) switcher.openMenu()
    switcher.cancelTabSwitcher()
    switcher.openMenu()
    switcher.release()
    switcher.flushRender()
    assert.equal(switcher.visible.value, false)
    assert.deepEqual(switcher.work.activated, [])
    assert.equal(switcher.work.scroll, 0)
    assert.deepEqual(switcher.work.capturePause, opened ? [true, false] : [])
    // A new gesture starts from the active tab, not the cancelled selection.
    switcher.cycleTabSwitcher(-1)
    switcher.release()
    assert.deepEqual(switcher.work.activated, ['third'])
  })
}

test('a single tab does not schedule a menu or activate itself', () => {
  const switcher = createSwitcher()
  switcher.tabs.value = [{ id: 'first' }]
  switcher.cycleTabSwitcher(1)
  switcher.release()
  switcher.openMenu()
  assert.deepEqual(switcher.work, { previews: 0, capturePause: [], scroll: 0, activated: [] })
})
