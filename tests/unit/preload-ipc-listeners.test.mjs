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
  const tabsSource = (await readFile(new URL('../../src/preload/tabs.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
    .replace('export const tabs =', 'const tabs =')
  const source = tabsSource + (await readFile(new URL('../../src/preload/interface.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
    .replace('export default {', 'globalThis.preloadInterface = {')

  const context = vm.createContext({
    console,
    document: { body: { dataset: {} } },
    globalThis: null,
    IpcChannels,
    DBActions: { GENERAL: { FIND: 1, UPSERT: 2 } },
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
    return Promise.resolve({ result: null, savedSetting: null })
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

test('settings broadcasts older than a save this window already has are dropped', async () => {
  const { api, ipcRenderer, IpcChannels } = await loadPreloadInterface()
  const applied = []
  api.handleSyncSettings((_event, data) => applied.push(data.value))
  const broadcast = (value, revision) => ipcRenderer.emit(IpcChannels.SYNC_SETTINGS, {}, {
    event: 2, data: { _id: 'toastPosition', value }, revision
  })
  ipcRenderer.invoke = () => Promise.resolve({ result: null, savedSetting: { _id: 'toastPosition', revision: 2 } })

  // Another window's save 1 arrives after the reply to this window's save 2.
  await api.dbSettings(2, { _id: 'toastPosition', value: 'mine' })
  broadcast('older', 1)
  broadcast('newer', 3)
  broadcast('newer again', 3)
  assert.deepEqual(applied, ['newer'])
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
  const stages = []
  userActivation.isActive = true
  const pending = api.chromecast.start(() => {
    preparations++
    return new Promise(resolve => { complete = resolve })
  }, stage => stages.push(stage))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(preparations, 1)
  assert.equal(ipcRenderer.listenerCount(IpcChannels.CAST_PROGRESS), 1)
  ipcRenderer.emit(IpcChannels.CAST_PROGRESS, {}, { preparationId: 'other-grant', stage: 'loading' })
  ipcRenderer.emit(IpcChannels.CAST_PROGRESS, {}, { preparationId: 'grant', stage: 'connecting' })
  assert.deepEqual(stages, ['connecting'])
  assert.deepEqual(invocations, [[IpcChannels.CAST_PREPARE]])
  userActivation.isActive = false
  const payload = { deviceId: 'tv', captions: [{ url: 'data:text/vtt;charset=utf-8,WEBVTT' }], startSeconds: 18 }
  complete(payload)
  assert.equal((await pending).castId, 'cast-1')
  assert.deepEqual(invocations, [[IpcChannels.CAST_PREPARE], [IpcChannels.CAST_START, payload, 'grant', 'google']])
  assert.deepEqual(cancellations, [[IpcChannels.CAST_CANCEL_PREPARATION, 'grant']])
  assert.equal(ipcRenderer.listenerCount(IpcChannels.CAST_PROGRESS), 1)
  ipcRenderer.emit(IpcChannels.CAST_PROGRESS, {}, { preparationId: 'grant', stage: 'loading' })
  assert.deepEqual(stages, ['connecting'], 'Settled preparation must no longer receive progress')
})

test('each startup read answers only the first full read of a datastore', async () => {
  const { api, ipcRenderer, IpcChannels } = await loadPreloadInterface()
  let requests = 0
  ipcRenderer.invoke = (channel, request) => {
    const reply = { channel, request, id: ++requests }
    return Promise.resolve(channel === IpcChannels.TABS_GET_STATE ? reply : { result: reply, revision: 0 })
  }
  api.startStartupReads()
  // A repeated call must not replace reads that were not taken yet.
  api.startStartupReads()
  assert.equal(requests, 6)

  assert.deepEqual(structuredClone(await api.dbProfiles(1)), { channel: IpcChannels.DB_PROFILES, request: { action: 1 }, id: 3 })
  assert.equal((await api.dbProfiles(1)).id, 7)
  assert.equal((await api.dbSettings(1)).id, 2)
  assert.deepEqual(structuredClone(await api.tabs.getState()), { channel: IpcChannels.TABS_GET_STATE, request: undefined, id: 1 })
  assert.equal((await api.tabs.getState()).id, 8)

  // A write from this window outdates the read.
  assert.equal((await api.dbHistory(2, { _id: 'a' })).id, 9)
  assert.equal((await api.dbHistory(1)).id, 10)
})

test('changes from other windows wait until the app listens and skip those its read contains', async () => {
  const { api, ipcRenderer, IpcChannels } = await loadPreloadInterface()
  const change = revision => ipcRenderer.emit(IpcChannels.SYNC_PROFILES, {}, { event: 1, data: revision, revision })
  let replyToRead
  ipcRenderer.invoke = () => new Promise(resolve => { replyToRead = resolve })

  change(1)
  const read = api.dbProfiles(1)
  // Sent while the read runs: the main process tells which ones it contains.
  change(2)
  change(3)
  replyToRead({ result: [], revision: 2 })
  await read
  change(4)

  const applied = []
  api.handleSyncProfiles((_event, data) => applied.push(data))
  assert.deepEqual(applied, [3, 4])
  // Broadcasts can arrive after the reply to a read that contains them.
  change(2)
  change(5)
  assert.deepEqual(applied, [3, 4, 5])
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
  assert.equal(ipcRenderer.listenerCount(IpcChannels.CAST_PROGRESS), 1)
})

test('overlapping Cast preparations share one IPC listener and release their progress callbacks', async () => {
  const { api, ipcRenderer, IpcChannels, userActivation } = await loadPreloadInterface()
  const completions = []
  const stages = []
  let nextPreparation = 0
  ipcRenderer.invoke = channel => Promise.resolve(channel === IpcChannels.CAST_PREPARE
    ? { preparationId: String(++nextPreparation) }
    : { castId: 'cast-1' })
  userActivation.isActive = true
  const pending = Array.from({ length: 11 }, (_, index) => api.chromecast.start(
    () => new Promise(resolve => { completions[index] = resolve }),
    stage => stages.push([index, stage])
  ))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ipcRenderer.listenerCount(IpcChannels.CAST_PROGRESS), 1)
  ipcRenderer.emit(IpcChannels.CAST_PROGRESS, {}, { preparationId: '7', stage: 'loading' })
  assert.deepEqual(stages, [[6, 'loading']])
  completions.forEach(complete => complete(null))
  await Promise.all(pending)
  ipcRenderer.emit(IpcChannels.CAST_PROGRESS, {}, { preparationId: '7', stage: 'connecting' })
  assert.deepEqual(stages, [[6, 'loading']], 'Settled preparations must no longer receive progress')
  assert.equal(ipcRenderer.listenerCount(IpcChannels.CAST_PROGRESS), 1)
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
