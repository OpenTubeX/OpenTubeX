import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { DOWNLOAD_HANDLERS, registerDownloadIpc } from '../../src/main/downloadIpc.js'

test('download IPC passes automatic authorization only for the refresh owner', () => {
  const handlers = new Map()
  const calls = []
  registerDownloadIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: (channel, handler) => handlers.set(channel, handler)
    },
    download: (...args) => { calls.push(args); return 42 },
    cancelDownload: () => {},
    handlers: Object.fromEntries(Object.keys(DOWNLOAD_HANDLERS).map(name => [name, () => {}])),
    isAutomaticDownloadAuthorized: (_, payload) => payload.refreshOwnerTabId === 'owner'
  })
  const event = { sender: { id: 1 } }
  const payload = { refreshOwnerTabId: 'owner' }
  assert.equal(handlers.get(IpcChannels.YT_DLP_DOWNLOAD)(event, payload, 7), 42)
  assert.deepEqual(calls, [[event, payload, 7, true]])
  assert.equal(handlers.get(IpcChannels.YT_DLP_DOWNLOAD)(event, { refreshOwnerTabId: 'other' }, 8), 42)
  assert.equal(calls[1][3], false)
  assert.equal(handlers.has(IpcChannels.YT_DLP_CANCEL_DOWNLOAD), true)
})
