import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadPreloadInterface() {
  const ipcRenderer = new EventEmitter()
  ipcRenderer.invoke = () => Promise.resolve()
  ipcRenderer.send = () => {}
  const userActivation = { isActive: false }

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
    DBActions: { GENERAL: { UPSERT: 2 } },
    ipcRenderer,
    navigator: { userActivation },
    process: {
      argv: [],
      env: {},
      versions: { electron: '', chrome: '', node: '', v8: '' }
    },
    webFrame: {}
  })
  context.globalThis = context
  vm.runInContext(source, context)
  return { api: context.preloadInterface, ipcRenderer, IpcChannels, userActivation }
}

test('queued automatic rule writes require activation and authorize only one fixed-setting write', async () => {
  const { api, ipcRenderer, IpcChannels, userActivation } = await loadPreloadInterface()
  const writes = []
  ipcRenderer.invoke = (...args) => {
    writes.push(JSON.parse(JSON.stringify(args)))
    return Promise.resolve(null)
  }
  assert.equal(api.prepareAutomaticDownloadRulesWrite(), null)
  assert.equal(await api.dbSettings(2, { _id: 'ytDlpAutomaticDownloadRules', value: '{}' }), null)
  assert.equal(writes.length, 0)

  userActivation.isActive = true
  const persist = api.prepareAutomaticDownloadRulesWrite()
  userActivation.isActive = false
  await persist('{"channel":{"includeVideos":true}}')
  assert.deepEqual(writes, [[IpcChannels.DB_SETTINGS, {
    action: 2,
    data: { _id: 'ytDlpAutomaticDownloadRules', value: '{"channel":{"includeVideos":true}}' }
  }]])
  await assert.rejects(persist('{}'), /already used/)
  assert.equal(writes.length, 1)
  assert.equal(api.prepareAutomaticDownloadRulesWrite(), null)
})

test('queued automatic rule writers reject invalid values without invoking IPC', async () => {
  const { api, ipcRenderer, userActivation } = await loadPreloadInterface()
  let writes = 0
  ipcRenderer.invoke = () => { writes++; return Promise.resolve(null) }
  userActivation.isActive = true
  const persist = api.prepareAutomaticDownloadRulesWrite()
  await assert.rejects(persist({ _id: 'other-setting', value: '{}' }), /must be a string/)
  await assert.rejects(persist('{}'), /already used/)
  assert.equal(writes, 0)
})

test('Cast start checks activation before asynchronous payload preparation and invokes IPC once', async () => {
  const { api, ipcRenderer, IpcChannels, userActivation } = await loadPreloadInterface()
  const invocations = []
  const cancellations = []
  ipcRenderer.send = (...args) => cancellations.push(args)
  ipcRenderer.invoke = (...args) => {
    invocations.push(args)
    return Promise.resolve(args[0] === IpcChannels.CAST_PREPARE ? { preparationId: 'grant' } : { castId: 'cast-1' })
  }
  let complete
  let preparations = 0
  userActivation.isActive = true
  const pending = api.chromecast.start(() => {
    preparations++
    return new Promise(resolve => { complete = resolve })
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(preparations, 1)
  assert.deepEqual(invocations, [[IpcChannels.CAST_PREPARE]])
  userActivation.isActive = false
  const payload = { deviceId: 'tv', captions: [{ url: 'data:text/vtt;charset=utf-8,WEBVTT' }], startSeconds: 18 }
  complete(payload)
  assert.equal((await pending).castId, 'cast-1')
  assert.deepEqual(invocations, [[IpcChannels.CAST_PREPARE], [IpcChannels.CAST_START, payload, 'grant']])
  assert.deepEqual(cancellations, [[IpcChannels.CAST_CANCEL_PREPARATION, 'grant']])
})

test('unauthorized, cancelled and failed Cast preparation never sends a start request', async () => {
  const { api, ipcRenderer, IpcChannels, userActivation } = await loadPreloadInterface()
  const cancellations = []
  ipcRenderer.send = (...args) => cancellations.push(args)
  ipcRenderer.invoke = channel => {
    assert.equal(channel, IpcChannels.CAST_PREPARE, 'Preparation must not start a receiver')
    return Promise.resolve({ preparationId: 'grant' })
  }
  let preparations = 0
  assert.match((await api.chromecast.start(() => { preparations++; return {} })).error, /user action/)
  assert.equal(preparations, 0)
  userActivation.isActive = true
  assert.match((await api.chromecast.start(() => null)).error, /cancelled/)
  await assert.rejects(api.chromecast.start(async () => { throw new Error('Caption failed') }), /Caption failed/)
  assert.deepEqual(cancellations, [[IpcChannels.CAST_CANCEL_PREPARATION, 'grant'], [IpcChannels.CAST_CANCEL_PREPARATION, 'grant']])
})

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
