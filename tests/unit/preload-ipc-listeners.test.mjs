import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadPreloadInterface() {
  const ipcRenderer = new EventEmitter()
  ipcRenderer.invoke = () => Promise.resolve()
  ipcRenderer.send = () => {}

  const IpcChannels = new Proxy({}, {
    get: (_target, property) => String(property)
  })
  const source = (await readFile(new URL('../../src/preload/interface.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
    .replace('export default {', 'globalThis.preloadInterface = {')

  const context = vm.createContext({
    console,
    document: { body: { dataset: {} } },
    globalThis: null,
    IpcChannels,
    DBActions: {},
    ipcRenderer,
    process: {
      argv: [],
      env: {},
      versions: { electron: '', chrome: '', node: '', v8: '' }
    },
    webFrame: {}
  })
  context.globalThis = context
  vm.runInContext(source, context)
  return { api: context.preloadInterface, ipcRenderer, IpcChannels }
}

test('player IPC subscriptions share one Electron listener per channel', async () => {
  const { api, ipcRenderer, IpcChannels } = await loadPreloadInterface()
  const calls = []
  const subscriptions = []

  for (let index = 0; index < 11; index++) {
    subscriptions.push({
      unsubscribeMinimized: api.handleWindowMinimizedState(value => calls.push(['minimized', index, value])),
      unsubscribeFocused: api.handleWindowFocusedState(value => calls.push(['focused', index, value])),
      unsubscribeFullscreen: api.tabs.onExitFullscreen(value => calls.push(['fullscreen', index, value]), `tab-${index}`)
    })
  }

  assert.equal(ipcRenderer.listenerCount(IpcChannels.WINDOW_MINIMIZED_STATE), 1)
  assert.equal(ipcRenderer.listenerCount(IpcChannels.WINDOW_FOCUSED_STATE), 1)
  assert.equal(ipcRenderer.listenerCount(IpcChannels.TABS_EXIT_FULLSCREEN), 1)

  ipcRenderer.emit(IpcChannels.WINDOW_MINIMIZED_STATE, {}, true)
  ipcRenderer.emit(IpcChannels.WINDOW_FOCUSED_STATE, {}, false)
  ipcRenderer.emit(IpcChannels.TABS_EXIT_FULLSCREEN, {}, 'tab-7')

  assert.deepEqual(calls.filter(([event]) => event === 'minimized'),
    Array.from({ length: 11 }, (_, index) => ['minimized', index, true]))
  assert.deepEqual(calls.filter(([event]) => event === 'focused'),
    Array.from({ length: 11 }, (_, index) => ['focused', index, false]))
  assert.deepEqual(calls.filter(([event]) => event === 'fullscreen'), [['fullscreen', 7, 'tab-7']])

  for (const subscription of subscriptions.slice(0, 5)) {
    subscription.unsubscribeMinimized()
    subscription.unsubscribeFocused()
    subscription.unsubscribeFullscreen()
  }
  calls.length = 0
  ipcRenderer.emit(IpcChannels.WINDOW_MINIMIZED_STATE, {}, false)
  ipcRenderer.emit(IpcChannels.WINDOW_FOCUSED_STATE, {}, true)
  ipcRenderer.emit(IpcChannels.TABS_EXIT_FULLSCREEN, {}, 'tab-7')

  assert.deepEqual(calls.filter(([event]) => event === 'minimized'),
    Array.from({ length: 6 }, (_, index) => ['minimized', index + 5, false]))
  assert.deepEqual(calls.filter(([event]) => event === 'focused'),
    Array.from({ length: 6 }, (_, index) => ['focused', index + 5, true]))
  assert.deepEqual(calls.filter(([event]) => event === 'fullscreen'), [['fullscreen', 7, 'tab-7']])

  for (const subscription of subscriptions.slice(5)) {
    subscription.unsubscribeMinimized()
    subscription.unsubscribeFocused()
    subscription.unsubscribeFullscreen()
  }
  calls.length = 0
  ipcRenderer.emit(IpcChannels.WINDOW_MINIMIZED_STATE, {}, false)
  ipcRenderer.emit(IpcChannels.WINDOW_FOCUSED_STATE, {}, true)
  ipcRenderer.emit(IpcChannels.TABS_EXIT_FULLSCREEN, {}, 'tab-7')
  assert.equal(calls.length, 0)
})
