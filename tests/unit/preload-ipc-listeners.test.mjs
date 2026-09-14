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
  const unsubscribers = []

  for (let index = 0; index < 11; index++) {
    unsubscribers.push(
      api.handleWindowMinimizedState(value => calls.push(['minimized', index, value])),
      api.handleWindowFocusedState(value => calls.push(['focused', index, value])),
      api.tabs.onExitFullscreen(value => calls.push(['fullscreen', index, value]), `tab-${index}`)
    )
  }

  assert.equal(ipcRenderer.listenerCount(IpcChannels.WINDOW_MINIMIZED_STATE), 1)
  assert.equal(ipcRenderer.listenerCount(IpcChannels.WINDOW_FOCUSED_STATE), 1)
  assert.equal(ipcRenderer.listenerCount(IpcChannels.TABS_EXIT_FULLSCREEN), 1)

  ipcRenderer.emit(IpcChannels.WINDOW_MINIMIZED_STATE, {}, true)
  ipcRenderer.emit(IpcChannels.WINDOW_FOCUSED_STATE, {}, false)
  ipcRenderer.emit(IpcChannels.TABS_EXIT_FULLSCREEN, {}, 'tab-7')

  assert.equal(calls.filter(([event]) => event === 'minimized').length, 11)
  assert.equal(calls.filter(([event]) => event === 'focused').length, 11)
  assert.deepEqual(calls.filter(([event]) => event === 'fullscreen'), [['fullscreen', 7, 'tab-7']])

  for (const unsubscribe of unsubscribers) unsubscribe()
  ipcRenderer.emit(IpcChannels.WINDOW_MINIMIZED_STATE, {}, false)
  ipcRenderer.emit(IpcChannels.WINDOW_FOCUSED_STATE, {}, true)
  ipcRenderer.emit(IpcChannels.TABS_EXIT_FULLSCREEN, {}, 'tab-7')
  assert.equal(calls.length, 23)
})
