import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const handlers = new Map()
const listeners = new Map()
const windows = []
let visibilityUpdates = 0

const [refresh, { IpcChannels }] = await importWithStubs(
  [sourceUrl('src/main/subscriptionAutoRefresh.js'), sourceUrl('src/constants.js')],
  {
    electron: {
      BrowserWindow: { getAllWindows: () => windows },
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
        on: (channel, listener) => listeners.set(channel, listener),
      },
    },
    [sourceUrl('src/main/ipBlockRecovery.js')]: { getIpBlockRecoveryScriptRun: () => null },
    [sourceUrl('src/main/tabs/TabManager.js')]: { TabManager: { getFromWebContents: webContents => webContents.tabManager } },
    [sourceUrl('src/main/utils.js')]: { isOpenTubeXUrl: url => url.startsWith('app://') },
  }
)

let setBackground = async () => {}
refresh.setupSubscriptionAutoRefreshIpc({
  backgroundSubscriptions: { setBackground: background => setBackground(background) },
  updateBackgroundSubscriptionVisibility: () => visibilityUpdates++,
})

let nextId = 1
function createWindow() {
  const webContents = new EventEmitter()
  Object.assign(webContents, {
    id: nextId++,
    sent: [],
    tabManager: { activeTabId: 'tab' },
    isDestroyed: () => false,
    getURL: () => 'app://bundle/index.html',
    send: (channel, payload) => webContents.sent.push([channel, payload]),
  })
  windows.push({ webContents })
  return webContents
}

const eventFrom = webContents => ({ sender: webContents, senderFrame: { url: 'app://bundle/index.html' } })
const acquire = webContents => handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_ACQUIRE)(eventFrom(webContents), 'tab', 'videos')
const release = webContents => handlers.get(IpcChannels.SUBSCRIPTION_AUTO_REFRESH_RELEASE)(eventFrom(webContents), 'tab')
const lastState = webContents => webContents.sent.findLast(([channel]) => channel === IpcChannels.SUBSCRIPTION_AUTO_REFRESH_STATE_CHANGED)?.[1]

for (const [name, lose] of [
  ['reloads', webContents => webContents.emit('did-start-navigation', {}, 'app://bundle/index.html', false, true)],
  ['crashes', webContents => webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })],
]) {
  test(`a refresh ends when the renderer running it ${name}`, async () => {
    const owner = createWindow()
    const other = createWindow()
    assert.equal(await acquire(owner), true)
    assert.equal(await acquire(other), false)

    const updatesBefore = visibilityUpdates
    lose(owner)

    assert.equal(refresh.isSubscriptionAutoRefreshInProgress(), false)
    assert.deepEqual(lastState(other), { inProgress: false, percentage: 0, tab: null })
    assert.equal(visibilityUpdates, updatesBefore + 1)
    assert.equal(await acquire(other), true)
    await release(other)
  })
}

for (const [name, lose] of [
  ['reloads', webContents => webContents.emit('did-start-navigation', {}, 'app://bundle/index.html', false, true)],
  ['crashes', webContents => webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })],
]) {
  test(`a renderer that ${name} while acquiring a refresh does not own it`, async () => {
    const owner = createWindow()
    let leaveForeground
    setBackground = () => new Promise(resolve => { leaveForeground = resolve })
    const acquiring = acquire(owner)
    await new Promise(resolve => setImmediate(resolve))
    setBackground = async () => {}

    lose(owner)
    const updatesBefore = visibilityUpdates
    leaveForeground()

    assert.equal(await acquiring, false)
    assert.equal(refresh.isSubscriptionAutoRefreshInProgress(), false)
    // Acquiring left the background, and no refresh will restore it
    assert.equal(visibilityUpdates, updatesBefore + 1)
    assert.equal(await acquire(owner), true)
    await release(owner)
  })
}

test('in-page navigation keeps the refresh running', async () => {
  const owner = createWindow()
  assert.equal(await acquire(owner), true)

  owner.emit('did-start-navigation', {}, 'app://bundle/index.html#/subscriptions', true, true)
  owner.emit('did-start-navigation', {}, 'app://bundle/frame.html', false, false)

  assert.equal(refresh.isSubscriptionAutoRefreshInProgress(), true)
  await release(owner)
})

test('repeated refreshes do not add lifecycle listeners', async () => {
  const owner = createWindow()
  assert.equal(await acquire(owner), true)
  await release(owner)
  const counts = () => owner.eventNames().map(name => owner.listenerCount(name))
  const initial = counts()

  for (let i = 0; i < 20; i++) {
    assert.equal(await acquire(owner), true)
    await release(owner)
  }

  assert.deepEqual(counts(), initial)
})
