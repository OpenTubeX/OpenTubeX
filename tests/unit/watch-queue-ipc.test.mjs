import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const handlerSource = source.slice(source.indexOf('  ipcMain.on(IpcChannels.WATCH_QUEUE_UPDATE,'), source.indexOf('\n\n  ipcMain.handle(IpcChannels.CONTEXT_MENU_EXECUTE,'))

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

test('queue broadcasts skip destroyed and non-app windows without losing the canonical reply', () => {
  const windows = [windowFixture({ destroyed: true }), windowFixture({ contentsDestroyed: true }), windowFixture({ url: 'https://example.com' }), windowFixture({ failSend: true }), windowFixture()]
  const snapshot = { revision: 1, items: [{ videoId: 'one', queueItemId: 1 }] }
  let handle
  const warnings = []
  runInNewContext(handlerSource, {
    ipcMain: { on: (_channel, handler) => { handle = handler } },
    IpcChannels: { WATCH_QUEUE_UPDATE: 'update', WATCH_QUEUE_UPDATED: 'updated' },
    BrowserWindow: { getAllWindows: () => windows },
    isOpenTubeXUrl: url => url.startsWith('app://bundle/'),
    updateWatchQueue: () => snapshot,
    console: { warn: (...warning) => warnings.push(warning) },
  })
  const event = { senderFrame: { url: 'app://bundle/index.html' } }
  handle(event, { type: 'addVideoToWatchQueue' })
  assert.equal(event.returnValue, snapshot)
  for (const window of windows.slice(0, 4)) assert.deepEqual(window.messages, [])
  assert.deepEqual(windows[4].messages, [['updated', snapshot]])
  assert.equal(warnings.length, 1)
})
