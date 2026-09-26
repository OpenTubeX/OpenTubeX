import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerYtDlpFileDialogs } from '../../src/main/ytDlpFileDialogs.js'

function setup({ platform = 'linux', dialogResult = { canceled: false, filePaths: ['/selected'] }, window = { id: 1 } } = {}) {
  const registrations = new Map()
  const calls = []
  registerYtDlpFileDialogs({
    ipcMain: { handle: (channel, handler) => registrations.set(channel, handler) },
    app: { getPath: name => `/${name}` },
    BrowserWindow: { fromWebContents: () => window },
    dialog: { showOpenDialog: async (...args) => {
      calls.push(args)
      return dialogResult
    } },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    platform
  })
  return { registrations, calls, event: { senderFrame: { url: 'app://bundle/index.html' }, sender: {} } }
}

test('yt-dlp file dialogs keep their file filters and starting paths', async () => {
  const { registrations, calls, event } = setup({ platform: 'win32' })

  assert.equal(await registrations.get(IpcChannels.YT_DLP_CHOOSE_EXECUTABLE)(event), '/selected')
  assert.deepEqual(calls[0][1], {
    defaultPath: '/home', properties: ['openFile'],
    filters: [
      { name: 'Executable Files', extensions: ['exe'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  await registrations.get(IpcChannels.YT_DLP_CHOOSE_COOKIES)(event, '/cookies')
  assert.equal(calls[1][1].defaultPath, '/cookies')
  assert.deepEqual(calls[1][1].filters, [
    { name: 'Cookie Files', extensions: ['txt'] },
    { name: 'All Files', extensions: ['*'] }
  ])

  await registrations.get(IpcChannels.YT_DLP_CHOOSE_BROWSER_PROFILE)(event)
  assert.deepEqual(calls[2][1], { defaultPath: '/home', properties: ['openDirectory'] })

  await registrations.get(IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER)(event)
  assert.deepEqual(calls[3][1], { defaultPath: '/downloads', properties: ['openDirectory'] })
})

test('yt-dlp file dialogs reject untrusted requests and invalid paths', async () => {
  const { registrations, calls, event } = setup()
  event.senderFrame.url = 'https://example.com'
  assert.equal(await registrations.get(IpcChannels.YT_DLP_CHOOSE_EXECUTABLE)(event), undefined)
  event.senderFrame.url = 'app://bundle/index.html'
  assert.equal(await registrations.get(IpcChannels.YT_DLP_CHOOSE_DOWNLOAD_FOLDER)(event, 123), undefined)
  assert.deepEqual(calls, [])
})

test('yt-dlp file dialogs work without an owning window and return undefined on cancellation', async () => {
  const { registrations, calls, event } = setup({ window: null, dialogResult: { canceled: true, filePaths: [] } })
  assert.equal(await registrations.get(IpcChannels.YT_DLP_CHOOSE_BROWSER_PROFILE)(event), undefined)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [{ defaultPath: '/home', properties: ['openDirectory'] }])
})
