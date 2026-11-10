import assert from 'node:assert/strict'
import test from 'node:test'

import { LiveReminderManager } from '../../src/main/LiveReminderManager.js'

const VIDEO_ID = 'abcdefghijk'

function createHarness(initialRecords = []) {
  let now = 1_000
  const records = new Map(initialRecords.map(record => [record._id, { ...record }]))
  const scheduledTimers = []
  const clearedTimers = []
  const notifications = []
  const changes = []
  let nextTimerId = 1

  const datastore = {
    async findAsync() {
      return [...records.values()]
    },
    async updateAsync(query, record) {
      records.set(query._id, { ...record })
    },
    async removeAsync(query) {
      const removed = records.delete(query._id)
      return removed ? 1 : 0
    }
  }

  const manager = new LiveReminderManager({
    datastore,
    now: () => now,
    notify: reminder => notifications.push(reminder),
    onChange: (videoId, scheduled) => changes.push({ videoId, scheduled }),
    setTimer: (callback, delay) => {
      const timer = { id: nextTimerId++, callback, delay }
      scheduledTimers.push(timer)
      return timer.id
    },
    clearTimer: timer => clearedTimers.push(timer)
  })

  return {
    manager,
    records,
    scheduledTimers,
    clearedTimers,
    notifications,
    changes,
    setNow: value => { now = value }
  }
}

function reminder(startTimestamp, videoId = VIDEO_ID) {
  return {
    _id: videoId,
    videoId,
    startTimestamp,
    notificationTitle: 'Scheduled video starting',
    notificationBody: 'A video is starting now'
  }
}

test('loads future reminders, notifies recently missed ones and removes expired ones', async () => {
  const now = 3 * 60 * 60 * 1000
  const future = reminder(now + 4_000)
  const missed = reminder(now - 10 * 60 * 1000, 'missed12345')
  const expired = reminder(now - 2 * 60 * 60 * 1000, 'expired1234')
  const harness = createHarness([future, missed, expired])
  harness.setNow(now)

  await harness.manager.initialize()

  assert.deepEqual([...harness.records.keys()].sort(), [VIDEO_ID, 'missed12345'].sort())
  assert.deepEqual(harness.scheduledTimers.map(timer => timer.delay), [4_000, 0])
  assert.deepEqual(await harness.manager.get(VIDEO_ID), future)

  // A stream that started while the app was closed is announced right away.
  harness.scheduledTimers[1].callback()
  await harness.manager.pendingOperation
  assert.deepEqual(harness.notifications.map(notification => notification.videoId), ['missed12345'])
  assert.deepEqual([...harness.records.keys()], [VIDEO_ID])
})

test('rescheduling replaces the timer and persisted timestamp', async () => {
  const harness = createHarness()

  await harness.manager.schedule(reminder(5_000))
  await harness.manager.schedule(reminder(8_000))

  assert.equal(harness.records.get(VIDEO_ID).startTimestamp, 8_000)
  assert.deepEqual(harness.clearedTimers, [1])
  assert.equal(harness.scheduledTimers[1].delay, 7_000)
  assert.deepEqual(harness.changes, [
    { videoId: VIDEO_ID, scheduled: true },
    { videoId: VIDEO_ID, scheduled: true }
  ])
})

test('fires and removes a reminder at its scheduled time', async () => {
  const harness = createHarness()
  const scheduledReminder = reminder(5_000)

  await harness.manager.schedule(scheduledReminder)
  harness.setNow(5_000)
  harness.scheduledTimers[0].callback()
  await harness.manager.pendingOperation

  assert.equal(harness.records.has(VIDEO_ID), false)
  assert.deepEqual(harness.notifications, [{ ...scheduledReminder, _id: VIDEO_ID }])
  assert.deepEqual(harness.changes.at(-1), { videoId: VIDEO_ID, scheduled: false })
})

test('chunks delays beyond the platform timer limit', async () => {
  const harness = createHarness()

  await harness.manager.schedule(reminder(5_000_000_000))

  assert.equal(harness.scheduledTimers[0].delay, 2_147_483_647)
})

test('cancels a persisted reminder and its timer', async () => {
  const harness = createHarness()

  await harness.manager.schedule(reminder(5_000))
  assert.equal(await harness.manager.cancel(VIDEO_ID), true)

  assert.equal(harness.records.has(VIDEO_ID), false)
  assert.deepEqual(harness.clearedTimers, [1])
  assert.deepEqual(harness.changes.at(-1), { videoId: VIDEO_ID, scheduled: false })
})
