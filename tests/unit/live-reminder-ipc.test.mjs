import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerLiveReminderIpc } from '../../src/main/liveReminderIpc.js'

test('live reminder IPC validates sender, video IDs, and schedule payloads', async () => {
  const handlers = new Map()
  const calls = []
  registerLiveReminderIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    canNotify: () => true,
    manager: {
      get: id => { calls.push(['get', id]); return { videoId: id } },
      list: () => [],
      schedule: reminder => { calls.push(['schedule', reminder]); return true },
      cancel: id => { calls.push(['cancel', id]); return true }
    }
  })
  const trusted = { senderFrame: { url: 'app://bundle/index.html' } }
  const untrusted = { senderFrame: { url: 'https://example.com' } }
  assert.equal(handlers.get(IpcChannels.LIVE_REMINDER_GET)(untrusted, 'abcdefghijk'), null)
  assert.equal(handlers.get(IpcChannels.LIVE_REMINDER_GET)(trusted, 'invalid'), null)
  assert.deepEqual(handlers.get(IpcChannels.LIVE_REMINDER_GET)(trusted, 'abcdefghijk'), { videoId: 'abcdefghijk' })
  assert.equal(handlers.get(IpcChannels.LIVE_REMINDER_SCHEDULE)(trusted, {
    videoId: 'abcdefghijk', startTimestamp: Date.now() - 1,
    notificationTitle: 'Title', notificationBody: 'Body'
  }), false)
  const reminder = {
    videoId: 'abcdefghijk', startTimestamp: Date.now() + 60_000,
    notificationTitle: 'Title', notificationBody: 'Body'
  }
  assert.equal(handlers.get(IpcChannels.LIVE_REMINDER_SCHEDULE)(trusted, reminder), true)
  assert.deepEqual(calls, [['get', 'abcdefghijk'], ['schedule', reminder]])
})
