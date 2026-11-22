import assert from 'node:assert/strict'
import test from 'node:test'
import { createIpcMainFake, importWithElectron, ipcEvent } from '../helpers/main-process.mjs'

const ipcMain = createIpcMainFake()
let windows = []
const [{ setupWatchQueueIpc }, { IpcChannels }] = await importWithElectron([
  new URL('../../src/main/watchQueueIpc.js', import.meta.url).href,
  new URL('../../src/constants.js', import.meta.url).href,
], { ipcMain, BrowserWindow: { getAllWindows: () => windows } })

function windowFixture({ destroyed = false, contentsDestroyed = false, url = 'app://bundle/index.html', failSend = false } = {}) {
  const messages = []
  return {
    messages,
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => contentsDestroyed,
      getURL: () => url,
      send(...message) {
        if (failSend) throw new Error('Object has been destroyed')
        messages.push(message)
      },
    },
  }
}

const sharedScope = async scope => ({ scope: scope ?? null })

test('queue broadcasts skip destroyed and non-app windows without losing the canonical reply', async t => {
  windows = [windowFixture({ destroyed: true }), windowFixture({ contentsDestroyed: true }), windowFixture({ url: 'https://example.com' }), windowFixture({ failSend: true }), windowFixture()]
  const snapshot = { revision: 1, items: [{ videoId: 'one', queueItemId: 1 }] }
  const warn = t.mock.method(console, 'warn', () => {})
  setupWatchQueueIpc(() => snapshot, sharedScope)
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), { type: 'addVideoToWatchQueue' }), { ...snapshot, scope: null })
  for (const window of windows.slice(0, 4)) assert.deepEqual(window.messages, [])
  assert.deepEqual(windows[4].messages, [[IpcChannels.WATCH_QUEUE_UPDATED, { ...snapshot, scope: null }]])
  assert.equal(warn.mock.callCount(), 1)
})

test('the window that changed the queue gets the snapshot only as its reply', async () => {
  const sender = windowFixture()
  const other = windowFixture()
  windows = [sender, other]
  const snapshot = { revision: 1, items: [] }
  setupWatchQueueIpc(async () => snapshot, sharedScope)
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(undefined, sender.webContents), { type: 'clearWatchQueue' }), { ...snapshot, scope: null })
  assert.deepEqual(sender.messages, [])
  assert.deepEqual(other.messages, [[IpcChannels.WATCH_QUEUE_UPDATED, { ...snapshot, scope: null }]])
})

test('changes to a separate profile’s queue reach only that queue, and unknown profiles are refused', async () => {
  windows = [windowFixture()]
  const updates = []
  setupWatchQueueIpc(async (request, scope) => {
    updates.push([request, scope])
    return { revision: 1, items: [] }
  }, async scope => {
    if (scope != null && scope !== 'separate') throw new Error('Unknown separate profile')
    return { scope: scope ?? null }
  })
  assert.deepEqual(
    await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), { type: 'clearWatchQueue', scope: 'separate' }),
    { revision: 1, items: [], scope: 'separate' }
  )
  assert.deepEqual(updates, [[{ type: 'clearWatchQueue' }, 'separate']])
  assert.deepEqual(windows[0].messages, [[IpcChannels.WATCH_QUEUE_UPDATED, { revision: 1, items: [], scope: 'separate' }]])
  assert.deepEqual(
    await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), { type: 'clearWatchQueue', scope: 'deleted' }),
    { error: 'Unknown separate profile' }
  )
  assert.equal(updates.length, 1)
})

test('rejects other senders and reports failed updates', async () => {
  let updates = 0
  setupWatchQueueIpc(async () => {
    updates++
    throw new Error('Disk full')
  }, sharedScope)
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent('https://example.com/'), {}), { error: 'Invalid watch queue sender' })
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, { senderFrame: null }, {}), { error: 'Invalid watch queue sender' })
  assert.equal(updates, 0)
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), {}), { error: 'Disk full' })
})
