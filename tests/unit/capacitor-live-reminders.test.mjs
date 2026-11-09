import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const systemNotifications = { calls: [], all: [] }
const [{ closeCapacitorSystemNotifications }] = await importWithStubs([sourceUrl('src/renderer/helpers/capacitorSystemNotifications.js')], {
  '@capacitor/local-notifications': {
    LocalNotifications: {
      getAll: async () => ({ notifications: systemNotifications.all }),
      cancel: async ({ notifications }) => { systemNotifications.calls.push(['cancel', notifications.map(({ id }) => id)]) },
      removeDeliveredNotificationsById: async ({ ids }) => { systemNotifications.calls.push(['removeDelivered', ids]) },
    }
  },
  [sourceUrl('src/renderer/helpers/androidSubscriptionRefresh.js')]: { cancelAndroidUploadNotifications: async () => {} }
})

const START = Date.UTC(2026, 0, 1)

test('closing reminder entries removes their notifications and overdue alarms by their own IDs', async () => {
  process.env.IS_CAPACITOR = 'true'
  const at = offset => ({ at: new Date(Date.now() + offset).toISOString() })
  systemNotifications.all = [
    // Android has not delivered the inexact alarm the app already moved to the history.
    { id: 7, schedule: at(-60_000), extra: { videoId: 'premiere00a' } },
    { id: 8, schedule: at(-7_200_000), extra: { videoId: 'premiere00b' } },
    // The same video premieres again later.
    { id: 10, schedule: at(3_600_000), extra: { videoId: 'premiere00b' } },
    // iOS lists delivered notifications without their schedule.
    { id: 11, extra: { videoId: 'premiere00d' } },
    { id: 9, schedule: at(-60_000), extra: { videoId: 'premiere00c' } },
  ]
  try {
    await closeCapacitorSystemNotifications([
      { kind: 'live-reminder', path: '/watch/premiere00a', createdAt: Date.now() - 63_000 },
      // Its earlier premiere, which the history dates a little late.
      { kind: 'live-reminder', path: '/watch/premiere00b', createdAt: Date.now() - 7_000_000 },
      { kind: 'live-reminder', path: '/watch/premiere00d', createdAt: Date.now() - 60_000 },
    ])
  } finally {
    delete process.env.IS_CAPACITOR
  }
  assert.deepEqual(systemNotifications.calls.find(([name]) => name === 'cancel'), ['cancel', [7, 8]])
  assert.deepEqual(systemNotifications.calls.find(([name]) => name === 'removeDelivered'), ['removeDelivered', [7, 8, 11]])
})

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
    setTimeout,
    clearTimeout,
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

test('a reminder cancelled while notifications resume stays cancelled', async () => {
  const scheduled = new Map()
  let permission = null
  const { liveReminder, applyCapacitorNotificationMode } = await loadCapacitorReminder({
    checkPermissions: async () => { await permission?.promise; return { display: 'granted' } },
    cancel: async ({ notifications }) => { for (const { id } of notifications) scheduled.delete(id) },
    getPending: async () => ({ notifications: [...scheduled.keys()].map(id => ({ id })) }),
    schedule: async ({ notifications }) => { for (const notification of notifications) scheduled.set(notification.id, notification) },
  })
  assert.equal(await liveReminder.schedule(reminder(START + 60_000)), true)
  await applyCapacitorNotificationMode('off')

  // The user cancels the reminder while turning notifications on again waits on the system.
  permission = Promise.withResolvers()
  const resuming = applyCapacitorNotificationMode('both')
  const cancelling = liveReminder.cancel('premiere')
  permission.resolve()
  await Promise.all([resuming, cancelling])
  assert.equal(scheduled.size, 0)
  assert.equal(await liveReminder.get('premiere'), null)
})

test('scheduling a reminder keeps reminders that left the list meanwhile out of it', async () => {
  let whileScheduling = null
  const { liveReminder, storage } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async () => {},
    schedule: async () => whileScheduling?.(),
  })
  assert.equal(await liveReminder.schedule({ ...reminder(START + 60_000), videoId: 'first' }), true)

  // While the system schedules the second reminder, the app shows the first and removes its record.
  whileScheduling = () => storage.set('opentubex-capacitor-live-reminders', '[]')
  assert.equal(await liveReminder.schedule({ ...reminder(START + 120_000), videoId: 'second' }), true)
  assert.deepEqual(JSON.parse(storage.get('opentubex-capacitor-live-reminders')).map(record => record.videoId), ['second'])
})

test('cancelling a reminder that became due while it waited still cancels its alarm', async () => {
  const cancelled = []
  const history = []
  const { liveReminder, clock } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async ({ notifications }) => { cancelled.push(...notifications.map(({ id }) => id)) },
    schedule: async () => {},
  }, { capacitorNotificationHistory: { add: entries => { history.push(...entries); return entries } } })
  assert.equal(await liveReminder.schedule(reminder(START + 60_000)), true)
  const { notificationId } = await liveReminder.get('premiere')
  cancelled.length = 0

  // Queued work delayed the cancellation until after the start, before the system delivered the alarm.
  clock.now = START + 61_000
  assert.equal(await liveReminder.cancel('premiere'), true)
  assert.deepEqual(cancelled, [notificationId])
  assert.equal(await liveReminder.get('premiere'), null)
  // The system may have shown it already, so the bell keeps it as before.
  assert.deepEqual(history.map(entry => entry.path), ['/watch/premiere'])
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

/** Sets up foreground reminders whose history writes fail. */
async function loadForegroundReminders(alarm) {
  const calls = []
  const listeners = {}
  const timers = []
  const loaded = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    registerActionTypes: async () => {},
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

test('dismissing a reminder notification marks its entry read without opening the video', async () => {
  const listeners = {}
  const read = []
  const opened = []
  const loaded = await loadCapacitorReminder({
    registerActionTypes: async () => {},
    addListener: async (name, listener) => { listeners[name] = listener; return { remove() {} } },
  }, {
    document: { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} },
    capacitorNotificationHistory: { markTargetsRead: targets => read.push(...targets.map(({ path }) => path)) },
  })
  await loaded.initializeCapacitorLiveReminderActions(videoId => opened.push(videoId), () => {})

  listeners.localNotificationActionPerformed({ actionId: 'dismiss', notification: { id: 7, extra: { videoId: 'premiere00a' } } })
  listeners.localNotificationActionPerformed({ actionId: 'tap', notification: { id: 8, extra: { videoId: 'premiere00b' } } })
  assert.deepEqual(read, ['/watch/premiere00a', '/watch/premiere00b'])
  assert.deepEqual(opened, ['premiere00b'])
})

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

test('rescheduling a reminder keeps its old foreground timer from cancelling the new alarm', async () => {
  const calls = []
  const timers = []
  const cleared = new Set()
  let blocked = null
  const loaded = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    registerActionTypes: async () => {},
    addListener: async () => ({ remove() {} }),
    getAll: async () => ({ notifications: [{ id: 7, title: 'Starting', body: 'Premiere', schedule: { at: new Date(START + 60_000).toISOString() }, extra: { videoId: 'premiere00a' } }] }),
    cancel: async ({ notifications }) => { calls.push(['cancel', notifications[0].id]) },
    schedule: async ({ notifications }) => {
      calls.push(['schedule', notifications[0].id])
      await blocked?.promise
    },
  }, {
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    setTimeout: callback => { timers.push(callback); return timers.length },
    clearTimeout: id => { cleared.add(id) },
    capacitorNotificationHistory: { add: entries => entries.map((entry, index) => ({ ...entry, id: String(index) })), list: async () => [] },
  })
  loaded.storage.set('opentubex-capacitor-live-reminders', JSON.stringify([
    { videoId: 'premiere00a', startTimestamp: START + 60_000, notificationId: 7, notificationTitle: 'Starting', notificationBody: 'Premiere' }
  ]))
  const shown = []
  await loaded.initializeCapacitorLiveReminderActions(() => {}, entry => shown.push(entry))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers.length, 1)

  // The premiere moves later. The old timer comes due while the system schedules the new alarm.
  blocked = Promise.withResolvers()
  const scheduling = loaded.liveReminder.schedule({ videoId: 'premiere00a', startTimestamp: START + 600_000, notificationTitle: 'Starting', notificationBody: 'Premiere' })
  await new Promise(resolve => setImmediate(resolve))
  if (!cleared.has(1)) await timers[0]()
  blocked.resolve()
  assert.equal(await scheduling, true)

  assert.deepEqual(calls.slice(calls.findLastIndex(([name]) => name === 'schedule')), [['schedule', 7]])
  assert.deepEqual(shown, [])
  assert.equal((await loaded.liveReminder.get('premiere00a')).startTimestamp, START + 600_000)
})

async function loadArmedReminder(nativeCancel = async () => {}, history = {}) {
  const calls = []
  const timers = []
  const cleared = new Set()
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  const loaded = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    registerActionTypes: async () => {},
    addListener: async () => ({ remove() {} }),
    getAll: async () => ({ notifications: [{ id: 7, title: 'Starting', body: 'Premiere', schedule: { at: new Date(START + 60_000).toISOString() }, extra: { videoId: 'premiere00a' } }] }),
    cancel: async ({ notifications }) => {
      calls.push(['cancel', notifications[0].id])
      await nativeCancel()
    },
    schedule: async ({ notifications }) => { calls.push(['schedule', notifications[0].id]) },
  }, {
    document,
    setTimeout: callback => { timers.push(callback); return timers.length },
    clearTimeout: id => { cleared.add(id) },
    capacitorNotificationHistory: { add: entries => entries.map((entry, index) => ({ ...entry, id: String(index) })), list: async () => [], ...history },
  })
  loaded.storage.set('opentubex-capacitor-live-reminders', JSON.stringify([
    { videoId: 'premiere00a', startTimestamp: START + 60_000, notificationId: 7, notificationTitle: 'Starting', notificationBody: 'Premiere' }
  ]))
  const shown = []
  await loaded.initializeCapacitorLiveReminderActions(() => {}, entry => shown.push(entry))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers.length, 1)
  return { ...loaded, calls, timers, cleared, document, shown }
}

test('a reminder cancelled as its foreground timer comes due stays hidden', async () => {
  let blocked = Promise.withResolvers()
  const { liveReminder, timers, cleared, shown } = await loadArmedReminder(() => blocked?.promise)
  const cancelling = liveReminder.cancel('premiere00a')
  await new Promise(resolve => setImmediate(resolve))
  // The timer comes due while the system cancels the alarm.
  if (!cleared.has(1)) {
    const firing = timers[0]()
    blocked.resolve()
    blocked = null
    await firing
  }
  blocked?.resolve()
  assert.equal(await cancelling, true)
  assert.deepEqual(shown, [])
})

test('a reminder another device removed cancels its alarm instead of showing it', async () => {
  // The history leaves out reminders removed elsewhere.
  const { timers, calls, shown } = await loadArmedReminder(undefined, { add: () => [] })
  await timers[0]()
  assert.deepEqual(new Set(calls.map(String)), new Set(['cancel,7']))
  assert.deepEqual(shown, [])
})

for (const [dismissal, add, list] of [
  ['removed', () => [], async () => []],
  ['read', entries => entries.map(entry => ({ ...entry, id: '0', read: true })), async () => [{ id: '0', kind: 'live-reminder', path: '/watch/premiere00a', read: true }]],
]) {
  test(`collecting a due reminder another device ${dismissal} cancels its alarm`, async () => {
    const { liveReminder, calls, clock } = await loadArmedReminder(undefined, { add })
    // The app resumes after the start, before the system delivered the inexact alarm.
    clock.now = START + 120_000
    assert.equal(await liveReminder.get('premiere00a'), null)
    assert.deepEqual(calls, [['cancel', 7]])
  })

  test(`a reminder another device ${dismissal} after the app collected it cancels its alarm`, async () => {
    const { timers, calls, shown, storage } = await loadArmedReminder(undefined, { add, list })
    // The app moved the reminder to the history before the dismissal arrived.
    storage.set('opentubex-capacitor-live-reminders', '[]')
    await timers[0]()
    assert.deepEqual(calls, [['cancel', 7]])
    assert.deepEqual(shown, [])
  })
}

test('a reminder synced while turning notifications off failed waits for them to come back on', async () => {
  const scheduled = new Map()
  let failCancel = false
  const { liveReminder, applyCapacitorNotificationMode } = await loadCapacitorReminder({
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async ({ notifications }) => {
      if (failCancel) throw new Error('Cancel failed')
      for (const { id } of notifications) scheduled.delete(id)
    },
    getPending: async () => ({ notifications: [...scheduled.keys()].map(id => ({ id })) }),
    schedule: async ({ notifications }) => { for (const notification of notifications) scheduled.set(notification.id, notification) },
  })
  assert.equal(await liveReminder.schedule({ ...reminder(START + 60_000), videoId: 'first' }), true)
  failCancel = true
  await applyCapacitorNotificationMode('off')
  failCancel = false

  // Sync adds a reminder while notifications are off.
  assert.equal(await liveReminder.schedule({ ...reminder(START + 60_000), videoId: 'second' }), true)
  assert.deepEqual([...scheduled.values()].map(notification => notification.extra.videoId), ['first'])

  await applyCapacitorNotificationMode('both')
  assert.deepEqual([...scheduled.values()].map(notification => notification.extra.videoId).sort(), ['first', 'second'])
})
