import assert from 'node:assert/strict'
import test from 'node:test'
import { createIpcMainFake, importWithElectron, ipcEvent } from '../helpers/main-process.mjs'

const ipcMain = createIpcMainFake()
let notificationsSupported = true
const [{ isValidLiveReminder, setupLiveReminderIpc }, { IpcChannels }] = await importWithElectron([
  new URL('../../src/main/liveReminderIpc.js', import.meta.url).href,
  new URL('../../src/constants.js', import.meta.url).href,
], { ipcMain, Notification: { isSupported: () => notificationsSupported } })

const calls = []
setupLiveReminderIpc({
  get: videoId => { calls.push(['get', videoId]); return { videoId } },
  list: () => { calls.push(['list']); return ['reminder'] },
  schedule: reminder => { calls.push(['schedule', reminder.videoId]); return true },
  cancel: videoId => { calls.push(['cancel', videoId]); return true },
})

const now = 1_000_000
const reminder = { videoId: 'dQw4w9WgXcQ', startTimestamp: now + 1, notificationTitle: 'Live soon', notificationBody: 'Channel' }

test.beforeEach(() => {
  calls.length = 0
  notificationsSupported = true
})

test('accepts only complete reminders for future streams', () => {
  assert.equal(isValidLiveReminder(reminder, now), true)
  for (const invalid of [
    null,
    { ...reminder, videoId: 'short' },
    { ...reminder, videoId: '../../etc/pa' },
    { ...reminder, startTimestamp: now },
    { ...reminder, startTimestamp: Number.NaN },
    { ...reminder, notificationTitle: '' },
    { ...reminder, notificationTitle: 'x'.repeat(201) },
    { ...reminder, notificationBody: 'x'.repeat(501) },
    { ...reminder, notificationBody: 42 },
  ]) {
    assert.equal(isValidLiveReminder(invalid, now), false, JSON.stringify(invalid))
  }
})

test('forwards valid requests from OpenTubeX pages', async () => {
  const future = { ...reminder, startTimestamp: Date.now() + 60_000 }
  assert.deepEqual(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_GET, ipcEvent(), reminder.videoId), { videoId: reminder.videoId })
  assert.deepEqual(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_LIST, ipcEvent()), ['reminder'])
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_SCHEDULE, ipcEvent(), future), true)
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_CANCEL, ipcEvent(), reminder.videoId), true)
  assert.deepEqual(calls.map(([method]) => method), ['get', 'list', 'schedule', 'cancel'])
})

test('ignores other senders and invalid video IDs', async () => {
  for (const event of [ipcEvent('https://example.com/'), { senderFrame: null }]) {
    assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_GET, event, reminder.videoId), null)
    assert.deepEqual(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_LIST, event), [])
    assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_SCHEDULE, event, reminder), false)
    assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_CANCEL, event, reminder.videoId), false)
  }
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_GET, ipcEvent(), { toString: () => reminder.videoId }), null)
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_CANCEL, ipcEvent(), 'invalid'), false)
  assert.deepEqual(calls, [])
})

test('hides reminders without notification support but still allows cancelling them', async () => {
  notificationsSupported = false
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_GET, ipcEvent(), reminder.videoId), null)
  assert.deepEqual(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_LIST, ipcEvent()), [])
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_SCHEDULE, ipcEvent(), { ...reminder, startTimestamp: Date.now() + 60_000 }), false)
  assert.equal(await ipcMain.invoke(IpcChannels.LIVE_REMINDER_CANCEL, ipcEvent(), reminder.videoId), true)
  assert.deepEqual(calls, [['cancel', reminder.videoId]])
})
