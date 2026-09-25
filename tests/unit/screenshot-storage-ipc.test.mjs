import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerScreenshotStorageIpc } from '../../src/main/screenshotStorageIpc.js'

async function setup(t, savedFolder) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-screenshot-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const handlers = new Map()
  const writes = []
  const broadcasts = []
  const settings = {
    _findOne: async () => ({ value: savedFolder }),
    upsert: async (...args) => writes.push(args)
  }
  registerScreenshotStorageIpc({
    ipcMain: {
      on: (channel, handler) => handlers.set(channel, handler),
      handle: (channel, handler) => handlers.set(channel, handler)
    },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    settings,
    app: { getPath: () => directory },
    BrowserWindow: {
      fromWebContents: () => null,
      getAllWindows: () => [{ webContents: { getURL: () => 'app://bundle/index.html', send: (...args) => broadcasts.push(args) } }]
    },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [directory] }) }
  })
  return { directory, handlers, writes, broadcasts }
}

const event = { senderFrame: { url: 'app://bundle/index.html' }, sender: {} }

test('screenshot storage writes inside the selected folder and syncs its setting', async t => {
  const { directory, handlers, writes, broadcasts } = await setup(t)
  const bytes = Uint8Array.from([1, 2, 3]).buffer
  assert.equal(await handlers.get(IpcChannels.WRITE_TO_DEFAULT_FOLDER)(event, 'capture.png', bytes), true)
  assert.deepEqual([...await readFile(path.join(directory, 'capture.png'))], [1, 2, 3])
  assert.deepEqual(writes, [['screenshotFolderPath', directory]])
  assert.equal(broadcasts[0][0], IpcChannels.SYNC_SETTINGS)
})

test('screenshot storage rejects path traversal and untrusted writes', async t => {
  const { directory, handlers } = await setup(t, '/nonexistent/opentubex-screenshot-folder')
  const bytes = Uint8Array.from([1]).buffer
  assert.equal(await handlers.get(IpcChannels.WRITE_TO_DEFAULT_FOLDER)(
    { senderFrame: { url: 'https://example.com' } }, 'capture.png', bytes
  ), undefined)
  await assert.rejects(handlers.get(IpcChannels.WRITE_TO_DEFAULT_FOLDER)(event, '../escape.png', bytes), /Invalid save location/)
  assert.equal(await readFile(path.join(directory, 'escape.png')).catch(() => null), null)
})
