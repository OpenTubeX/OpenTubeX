import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerWindowPowerSaveIpc } from '../../src/main/windowPowerSaveIpc.js'

function setup() {
  const registrations = new Map()
  const starts = []
  const stops = []
  const window = { id: 7 }
  const event = { senderFrame: { url: 'app://bundle/index.html' }, sender: {} }
  const controller = registerWindowPowerSaveIpc({
    ipcMain: { on: (channel, handler) => registrations.set(channel, handler) },
    BrowserWindow: { fromWebContents: () => window },
    powerSaveBlocker: {
      start: reason => { starts.push(reason); return 42 },
      stop: id => stops.push(id)
    },
    isTrustedUrl: url => url === 'app://bundle/index.html'
  })
  return { registrations, starts, stops, window, event, controller }
}

test('one display blocker is started per window and close cleanup stops it', () => {
  const { registrations, starts, stops, window, event, controller } = setup()
  registrations.get(IpcChannels.START_POWER_SAVE_BLOCKER)(event)
  registrations.get(IpcChannels.START_POWER_SAVE_BLOCKER)(event)
  assert.deepEqual(starts, ['prevent-display-sleep'])

  controller.stopForWindow(window)
  controller.stopForWindow(window)
  assert.deepEqual(stops, [42])

  registrations.get(IpcChannels.START_POWER_SAVE_BLOCKER)(event)
  registrations.get(IpcChannels.STOP_POWER_SAVE_BLOCKER)(event)
  assert.deepEqual(stops, [42, 42])
})

test('untrusted frames cannot start or stop a window blocker', () => {
  const { registrations, starts, stops, event } = setup()
  event.senderFrame.url = 'https://example.com'
  registrations.get(IpcChannels.START_POWER_SAVE_BLOCKER)(event)
  registrations.get(IpcChannels.STOP_POWER_SAVE_BLOCKER)(event)
  assert.deepEqual(starts, [])
  assert.deepEqual(stops, [])
})
