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

test('queue broadcasts skip destroyed and non-app windows without losing the canonical reply', async t => {
  windows = [windowFixture({ destroyed: true }), windowFixture({ contentsDestroyed: true }), windowFixture({ url: 'https://example.com' }), windowFixture({ failSend: true }), windowFixture()]
  const snapshot = { revision: 1, items: [{ videoId: 'one', queueItemId: 1 }] }
  const warn = t.mock.method(console, 'warn', () => {})
  setupWatchQueueIpc(() => snapshot)
  assert.equal(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), { type: 'addVideoToWatchQueue' }), snapshot)
  for (const window of windows.slice(0, 4)) assert.deepEqual(window.messages, [])
  assert.deepEqual(windows[4].messages, [[IpcChannels.WATCH_QUEUE_UPDATED, snapshot]])
  assert.equal(warn.mock.callCount(), 1)
})

test('unchanged queue replies are not broadcast again', async () => {
  const window = windowFixture()
  windows = [window]
  setupWatchQueueIpc(async () => ({ revision: 1, items: [] }))
  for (let index = 0; index < 3; index++) {
    await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), { type: 'removeYtDlpDownload', payload: 42 })
  }
  assert.equal(window.messages.length, 1)
})

test('rejects other senders and reports failed updates', async () => {
  let updates = 0
  setupWatchQueueIpc(async () => {
    updates++
    throw new Error('Disk full')
  })
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent('https://example.com/'), {}), { error: 'Invalid watch queue sender' })
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, { senderFrame: null }, {}), { error: 'Invalid watch queue sender' })
  assert.equal(updates, 0)
  assert.deepEqual(await ipcMain.invoke(IpcChannels.WATCH_QUEUE_UPDATE, ipcEvent(), {}), { error: 'Disk full' })
})
