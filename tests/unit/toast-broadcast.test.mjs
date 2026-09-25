import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { registerToastIpc } from '../../src/main/toastIpc.js'

function fixture() {
  const sent = []
  let receive
  registerToastIpc({
    ipcMain: { on: (_channel, handler) => { receive = handler } },
    isTrustedUrl: url => url === 'app://opentubex',
    getWindows: () => [1, 2].map(id => ({ webContents: {
      isDestroyed: () => false,
      getURL: () => 'app://opentubex',
      send: (...args) => sent.push({ id, args })
    } }))
  })
  return { sent, receive }
}

const sender = { senderFrame: { url: 'app://opentubex' } }

test('broadcasts the sync settings action to both windows', () => {
  const { sent, receive } = fixture()
  receive(sender, 'Sync stopped', 15000, ['fas', 'triangle-exclamation'], 'open-sync-settings')
  assert.deepEqual(sent.map(({ id }) => id), [1, 2])
  for (const { args } of sent) {
    assert.deepEqual(args, ['show-toast', 'Sync stopped', 15000, ['fas', 'triangle-exclamation'], 'open-sync-settings'])
  }
})

test('rejects unknown toast actions and malformed or untrusted messages', () => {
  const { sent, receive } = fixture()
  for (const action of ['open-url', '', {}, [], true]) {
    receive(sender, 'Sync stopped', 15000, null, action)
  }
  receive(sender, { message: 'Sync stopped' }, 15000, null, 'open-sync-settings')
  receive({ senderFrame: { url: 'https://untrusted.example' } }, 'Sync stopped', 15000, null, 'open-sync-settings')
  assert.equal(sent.length, 0)
})

test('preserves ordinary broadcasts without an action', () => {
  const { sent, receive } = fixture()
  receive(sender, 'Finished', null, null)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[0].args, ['show-toast', 'Finished', null, null, null])
})

test('keeps the sync shortcut in the non-Electron toast fallback', async () => {
  const source = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
  const helperSource = source.slice(
    source.indexOf('export function showToastOnAllTabs('),
    source.indexOf('/** @returns {Promise<string>} */')
  ).replace('export function', 'function')
  const notifications = []
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: false } },
    showToast: options => notifications.push(structuredClone(options)),
  })
  vm.runInContext(helperSource, context)
  context.showToastOnAllTabs('Sync stopped', 15000, ['fas', 'triangle-exclamation'], 'open-sync-settings')
  assert.deepEqual(notifications, [{
    message: 'Sync stopped', time: 15000, icon: ['fas', 'triangle-exclamation'], buttonAction: 'open-sync-settings',
  }])
})
