import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeLiveReminders, syncLiveReminders } from '../../src/renderer/helpers/sync-live-reminders.js'

const NOW = 1_000
const first = {
  videoId: 'abcdefghijk',
  startTimestamp: 5_000,
  notificationTitle: 'Starting soon',
  notificationBody: 'Open stream',
}
const second = { ...first, videoId: 'lmnopqrstuv', startTimestamp: 6_000 }

test('merges independently scheduled reminders and strips device-specific fields', () => {
  assert.deepEqual(mergeLiveReminders(
    [{ ...first, _id: first.videoId }],
    [{ ...second, notificationId: 123 }],
    [],
    NOW
  ), [first, second])
})

test('propagates a local or remote cancellation since the last sync', () => {
  assert.deepEqual(mergeLiveReminders([], [first], [first], NOW), [])
  assert.deepEqual(mergeLiveReminders([first], [], [first], NOW), [])
})

test('a concurrent reschedule takes precedence over a cancellation', () => {
  const rescheduled = { ...first, startTimestamp: 8_000 }
  assert.deepEqual(mergeLiveReminders([], [rescheduled], [first], NOW), [rescheduled])
  assert.deepEqual(mergeLiveReminders([rescheduled], [], [first], NOW), [rescheduled])
})

test('does not restore expired or malformed reminders', () => {
  assert.deepEqual(mergeLiveReminders(
    [{ ...first, startTimestamp: NOW }, { ...second, videoId: '../bad' }],
    [first],
    [first],
    5_000
  ), [])
})

test('applies remote additions and cancellations through the local scheduler', async () => {
  const currentFirst = { ...first, startTimestamp: Date.now() + 60_000 }
  const currentSecond = { ...second, startTimestamp: Date.now() + 120_000 }
  const local = new Map([[currentFirst.videoId, currentFirst]])
  let remote = [currentSecond]
  const changes = []
  const reminderService = {
    list: async () => [...local.values()],
    cancel: async id => { changes.push(['cancel', id]); local.delete(id); return true },
    schedule: async reminder => {
      changes.push(['schedule', reminder.videoId])
      local.set(reminder.videoId, reminder)
      return true
    },
  }
  const client = {
    getLiveReminders: async () => remote,
    putLiveReminders: async reminders => { remote = reminders },
  }

  const synced = await syncLiveReminders(client, [currentFirst], reminderService)
  assert.deepEqual(synced, [currentSecond])
  assert.deepEqual(changes, [['schedule', second.videoId], ['cancel', first.videoId]])
  assert.deepEqual([...local.values()], [currentSecond])
  assert.deepEqual(remote, [currentSecond])
})

test('uploads a local reminder on first sync without scheduling it again', async () => {
  const localReminder = { ...first, startTimestamp: Date.now() + 60_000 }
  let uploaded
  const reminderService = {
    list: async () => [{ ...localReminder, _id: localReminder.videoId }],
    cancel: async () => { throw new Error('Unexpected cancellation') },
    schedule: async () => { throw new Error('Unexpected reschedule') },
  }
  const client = {
    getLiveReminders: async () => [],
    putLiveReminders: async records => { uploaded = records },
  }

  assert.deepEqual(await syncLiveReminders(client, [], reminderService), [localReminder])
  assert.deepEqual(uploaded, [localReminder])
})

test('a denied notification permission leaves reminders pending without uploading them', async () => {
  const remoteReminder = { ...first, startTimestamp: Date.now() + 60_000 }
  let uploaded = false
  const reminderService = {
    list: async () => [],
    cancel: async () => { throw new Error('Unexpected cancellation') },
    schedule: async () => false,
  }
  const client = {
    getLiveReminders: async () => [remoteReminder],
    putLiveReminders: async () => { uploaded = true },
  }

  assert.equal(await syncLiveReminders(client, [], reminderService), null)
  assert.equal(uploaded, false)
})
