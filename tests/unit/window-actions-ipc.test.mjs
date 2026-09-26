import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerWindowActionsIpc } from '../../src/main/windowActionsIpc.js'

test('window actions validate renderer payloads and construct the startup route', () => {
  const handlers = new Map()
  const created = []
  registerWindowActionsIpc({
    ipcMain: { on: (channel, handler) => handlers.set(channel, handler), handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    BrowserWindow: { fromWebContents: () => null },
    TabManager: { getFromWebContents: () => null },
    appShortcutBlockedWindows: new WeakSet(),
    reopenClosedWindow: () => {},
    createWindow: options => created.push(options),
    rootAppUrl: 'app://bundle/index.html'
  })
  const trusted = { senderFrame: { url: 'app://bundle/index.html' } }
  const untrusted = { senderFrame: { url: 'https://example.com' } }
  handlers.get(IpcChannels.CREATE_NEW_WINDOW)(untrusted, '/search', { q: 'hello' })
  handlers.get(IpcChannels.CREATE_NEW_WINDOW)(trusted, '/search', 'invalid')
  assert.deepEqual(created, [])
  handlers.get(IpcChannels.CREATE_NEW_WINDOW)(trusted, 'search', { q: 'hello world', tag: ['a', 'b'] }, 'hello')
  assert.deepEqual(created, [{
    replaceMainWindow: false,
    showWindowNow: true,
    windowStartupUrl: 'app://bundle/index.html#/search?q=hello+world&tag=a&tag=b',
    searchQueryText: 'hello'
  }])
})
