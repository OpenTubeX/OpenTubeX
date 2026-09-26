import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerContextMenuIpc } from '../../src/main/contextMenuIpc.js'

function setup () {
  const handlers = new Map()
  const copied = []
  registerContextMenuIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    TabManager: { getFromWebContents: () => null },
    BrowserWindow: {},
    clipboard: { writeText: value => copied.push(value) },
    shell: {},
    isTrustedUrl: url => url === 'app://bundle/index.html',
    isShareableOpenTubeXRoute: () => false,
    getConfiguredSearchEngines: async () => [],
    rootAppUrl: 'app://bundle/index.html'
  })
  const event = {
    sender: { id: 7 },
    senderFrame: { url: 'app://bundle/index.html' }
  }
  const open = handlers.get(IpcChannels.CONTEXT_MENU_OPEN)
  const execute = handlers.get(IpcChannels.CONTEXT_MENU_EXECUTE)
  return { copied, event, open, execute }
}

test('context menu IPC rejects opens from untrusted frames', async () => {
  const { event, open } = setup()
  event.senderFrame.url = 'https://example.com'
  assert.equal(await open(event, { mediaType: 'image', srcURL: 'https://example.com/image.png' }), undefined)
})

test('context menu IPC cannot execute an earlier trusted session after navigation', async () => {
  const { copied, event, open, execute } = setup()
  const session = await open(event, { mediaType: 'image', srcURL: 'https://example.com/image.png' })
  const actionId = session.items.find(item => item.label === 'Copy Image Address').actionId
  assert.ok(actionId)

  event.senderFrame.url = 'https://example.com'
  await execute(event, { sessionId: session.sessionId, actionId })
  assert.deepEqual(copied, [])

  event.senderFrame.url = 'app://bundle/index.html'
  await execute(event, { sessionId: session.sessionId, actionId })
  assert.deepEqual(copied, ['https://example.com/image.png'])
})
