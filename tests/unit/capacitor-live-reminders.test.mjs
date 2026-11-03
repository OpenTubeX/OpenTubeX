import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const START = Date.UTC(2026, 0, 1)

async function loadCapacitorReminder(notifications, context = {}) {
  const source = await readFile(new URL('../../src/renderer/helpers/liveReminders.js', import.meta.url), 'utf8')
  const storage = new Map()
  const clock = { now: START }
  const { liveReminder, applyCapacitorNotificationMode, initializeCapacitorLiveReminderActions } = vm.runInNewContext(`${source.replace(/^import .*$/gm, '').replaceAll('export ', '')}
    ({ liveReminder, applyCapacitorNotificationMode, initializeCapacitorLiveReminderActions })`, {
    process: { env: { IS_CAPACITOR: true } },
    console: { error: () => {} },
    LocalNotifications: notifications,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Date: class extends Date { static now() { return clock.now } },
    getLiveReminderTarget: videoId => ({ kind: 'live-reminder', path: `/watch/${videoId}` }),
    ...context,
  })
  return { liveReminder, applyCapacitorNotificationMode, initializeCapacitorLiveReminderActions, storage, clock }
}

function reminder(startTimestamp) {
  return { videoId: 'premiere', startTimestamp, notificationTitle: 'Starting', notificationBody: 'Premiere is starting now' }
}

test('Capacitor reminders schedule premieres that start in the future', async () => {
  const scheduled = []
  const { liveReminder } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async () => {},
    schedule: async ({ notifications }) => scheduled.push(...notifications),
  })

  assert.equal(await liveReminder.schedule(reminder(START + 60_000)), true)
  assert.equal(scheduled.length, 1)
  assert.notEqual(await liveReminder.get('premiere'), null)
})

test('Capacitor reminders do not ask for permission once the premiere has started', async () => {
  let asked = false
  const scheduled = []
  const { liveReminder } = await loadCapacitorReminder({
    checkPermissions: async () => { asked = true; return { display: 'prompt' } },
    cancel: async () => {},
    schedule: async ({ notifications }) => scheduled.push(...notifications),
  })

  assert.equal(await liveReminder.schedule(reminder(START)), false)
  assert.equal(asked, false)
  assert.deepEqual(scheduled, [])
})

test('Capacitor reminders reject a premiere that starts while the permission prompt is open', async () => {
  const scheduled = []
  const prompt = Promise.withResolvers()
  const { liveReminder, clock } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'prompt' }),
    requestPermissions: () => prompt.promise,
    cancel: async () => {},
    schedule: async ({ notifications }) => scheduled.push(...notifications),
  })

  const result = liveReminder.schedule(reminder(START + 50))
  clock.now = START + 60
  prompt.resolve({ display: 'granted' })

  assert.equal(await result, false)
  assert.deepEqual(scheduled, [])
  assert.equal(await liveReminder.get('premiere'), null)
})

test('Capacitor reminders cancel the previous reminder when a reschedule has already started', async () => {
  const cancelled = []
  const prompt = Promise.withResolvers()
  let permission = { display: 'granted' }
  const { liveReminder, clock } = await loadCapacitorReminder({
    checkPermissions: async () => permission,
    requestPermissions: () => prompt.promise,
    cancel: async ({ notifications }) => cancelled.push(...notifications.map(notification => notification.id)),
    schedule: async () => {},
  })
  assert.equal(await liveReminder.schedule(reminder(START + 60_000)), true)
  const { notificationId } = await liveReminder.get('premiere')
  cancelled.length = 0

  // The premiere moved earlier and starts while the permission prompt is open.
  permission = { display: 'prompt' }
  const result = liveReminder.schedule(reminder(START + 50))
  clock.now = START + 60
  prompt.resolve({ display: 'granted' })

  assert.equal(await result, false)
  assert.deepEqual(cancelled, [notificationId])
  assert.equal(await liveReminder.get('premiere'), null)
})

test('turning notifications off while they resume leaves no reminder scheduled', async () => {
  const scheduled = new Map()
  let blocked = null
  const { liveReminder, applyCapacitorNotificationMode } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async ({ notifications }) => { for (const { id } of notifications) scheduled.delete(id) },
    getPending: async () => ({ notifications: [...scheduled.keys()].map(id => ({ id })) }),
    schedule: async ({ notifications }) => {
      await blocked?.promise
      for (const notification of notifications) scheduled.set(notification.id, notification)
    },
  })
  for (const videoId of ['first', 'second']) {
    assert.equal(await liveReminder.schedule({ ...reminder(START + 60_000), videoId }), true)
  }
  await applyCapacitorNotificationMode('off')
  assert.equal(scheduled.size, 0)

  // Off arrives while turning notifications on again still waits on the system.
  blocked = Promise.withResolvers()
  const resuming = applyCapacitorNotificationMode('both')
  const pausing = applyCapacitorNotificationMode('off')
  blocked.resolve()
  await Promise.all([resuming, pausing])
  assert.equal(scheduled.size, 0)
})

test('a reminder scheduled while notifications turn off is cancelled too', async () => {
  const scheduled = new Map()
  let permission = null
  const { liveReminder, applyCapacitorNotificationMode } = await loadCapacitorReminder({
    checkPermissions: async () => { await permission?.promise; return { display: 'granted' } },
    cancel: async ({ notifications }) => { for (const { id } of notifications) scheduled.delete(id) },
    getPending: async () => ({ notifications: [...scheduled.keys()].map(id => ({ id })) }),
    schedule: async ({ notifications }) => { for (const notification of notifications) scheduled.set(notification.id, notification) },
  })
  await applyCapacitorNotificationMode('both')

  permission = Promise.withResolvers()
  const scheduling = liveReminder.schedule(reminder(START + 60_000))
  const pausing = applyCapacitorNotificationMode('off')
  permission.resolve()
  await Promise.all([scheduling, pausing])
  assert.equal(scheduled.size, 0)
})

test('turning notifications off again retries a cancellation that failed', async () => {
  const scheduled = new Map()
  let failCancel = false
  const { liveReminder, applyCapacitorNotificationMode } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async ({ notifications }) => {
      if (failCancel) throw new Error('Cancellation failed')
      for (const { id } of notifications) scheduled.delete(id)
    },
    getPending: async () => ({ notifications: [...scheduled.keys()].map(id => ({ id })) }),
    schedule: async ({ notifications }) => { for (const notification of notifications) scheduled.set(notification.id, notification) },
  })
  assert.equal(await liveReminder.schedule(reminder(START + 60_000)), true)

  failCancel = true
  await applyCapacitorNotificationMode('off')
  assert.equal(scheduled.size, 1)
  failCancel = false
  await applyCapacitorNotificationMode('off')
  assert.equal(scheduled.size, 0)
})

test('turning notifications off cancels alarms that a failed resume left scheduled', async () => {
  const scheduled = new Map()
  let failSchedule = false
  const { liveReminder, applyCapacitorNotificationMode } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async ({ notifications }) => { for (const { id } of notifications) scheduled.delete(id) },
    getPending: async () => ({ notifications: [...scheduled.keys()].map(id => ({ id })) }),
    schedule: async ({ notifications }) => {
      if (failSchedule && scheduled.size > 0) throw new Error('Scheduling failed')
      for (const notification of notifications) scheduled.set(notification.id, notification)
    },
  })
  for (const videoId of ['first', 'second']) {
    assert.equal(await liveReminder.schedule({ ...reminder(START + 60_000), videoId }), true)
  }
  await applyCapacitorNotificationMode('off')
  failSchedule = true
  // The first reminder is scheduled again before the second fails.
  await applyCapacitorNotificationMode('both')
  assert.equal(scheduled.size, 1)
  await applyCapacitorNotificationMode('off')
  assert.equal(scheduled.size, 0)
})

/** Sets up foreground reminders whose history writes fail. */
async function loadForegroundReminders(alarm) {
  const calls = []
  const listeners = {}
  const timers = []
  const loaded = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    addListener: async (name, listener) => { listeners[name] = listener; return { remove() {} } },
    getAll: async () => ({ notifications: alarm ? [alarm] : [] }),
    cancel: async ({ notifications }) => calls.push(['cancel', notifications[0].id]),
    removeDeliveredNotifications: async ({ notifications }) => calls.push(['removeDelivered', notifications[0].id]),
  }, {
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    setTimeout: callback => { timers.push(callback); return timers.length },
    clearTimeout() {},
    capacitorNotificationHistory: { add() { throw new Error('Storage is full') }, list: async () => [] },
  })
  loaded.storage.set('opentubex-capacitor-live-reminders', JSON.stringify([
    { videoId: 'premiere00a', startTimestamp: START, notificationId: 7, notificationTitle: 'Starting', notificationBody: 'Premiere' }
  ]))
  const shown = []
  await loaded.initializeCapacitorLiveReminderActions(() => {}, entry => shown.push(entry))
  return { ...loaded, calls, listeners, timers, shown }
}

test('a reminder the app cannot record keeps its system notification', async () => {
  const alarm = { id: 7, title: 'Starting', body: 'Premiere', schedule: { at: new Date(START + 1000).toISOString() }, extra: { videoId: 'premiere00a' } }
  const { calls, timers, listeners } = await loadForegroundReminders(alarm)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers.length, 1)
  await timers[0]()
  assert.deepEqual(calls, [])

  // The system delivers it later, and the app leaves that notification alone too.
  await listeners.localNotificationReceived({ id: 7, extra: { videoId: 'premiere00a' } })
  assert.deepEqual(calls, [])
})
