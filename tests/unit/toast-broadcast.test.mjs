import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { APP_URL, createIpcMainFake, importWithElectron, ipcEvent } from '../helpers/main-process.mjs'

const ipcMain = createIpcMainFake()
let sent = []
const [{ setupToastIpc }, { IpcChannels }] = await importWithElectron([
  new URL('../../src/main/toastIpc.js', import.meta.url).href,
  new URL('../../src/constants.js', import.meta.url).href,
], {
  ipcMain,
  BrowserWindow: {
    getAllWindows: () => [1, 2].map(id => ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        getURL: () => APP_URL,
        send: (...args) => sent.push({ id, args }),
      },
    })),
  },
})
setupToastIpc()

function receive(event, ...args) {
  ipcMain.send(IpcChannels.SHOW_TOAST, event, ...args)
}

test.beforeEach(() => {
  sent = []
})

test('broadcasts the sync settings action to both windows', () => {
  receive(ipcEvent(), 'Sync stopped', 15000, ['fas', 'triangle-exclamation'], 'open-sync-settings')
  assert.deepEqual(sent.map(({ id }) => id), [1, 2])
  for (const { args } of sent) {
    assert.deepEqual(args, [IpcChannels.SHOW_TOAST, 'Sync stopped', 15000, ['fas', 'triangle-exclamation'], 'open-sync-settings'])
  }
})

test('rejects unknown toast actions and malformed or untrusted messages', () => {
  for (const action of ['open-url', '', {}, [], true]) {
    receive(ipcEvent(), 'Sync stopped', 15000, null, action)
  }
  receive(ipcEvent(), { message: 'Sync stopped' }, 15000, null, 'open-sync-settings')
  receive(ipcEvent(), 'Sync stopped', 15000, ['fas'], null)
  receive(ipcEvent('https://untrusted.example'), 'Sync stopped', 15000, null, 'open-sync-settings')
  receive({ senderFrame: null }, 'Sync stopped', 15000, null, null)
  assert.equal(sent.length, 0)
})

test('preserves ordinary broadcasts without an action', () => {
  receive(ipcEvent(), 'Finished', null, null)
  assert.equal(sent.length, 2)
  assert.deepEqual(sent[0].args, [IpcChannels.SHOW_TOAST, 'Finished', null, null, null])
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
