import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const START = Date.UTC(2026, 0, 1)

async function loadCapacitorReminder(notifications) {
  const source = await readFile(new URL('../../src/renderer/helpers/liveReminders.js', import.meta.url), 'utf8')
  const storage = new Map()
  const clock = { now: START }
  const { liveReminder, applyCapacitorNotificationMode } = vm.runInNewContext(`${source.replace(/^import .*$/gm, '').replaceAll('export ', '')}
    ({ liveReminder, applyCapacitorNotificationMode })`, {
    process: { env: { IS_CAPACITOR: true } },
    LocalNotifications: notifications,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Date: class extends Date { static now() { return clock.now } },
  })
  return { liveReminder, applyCapacitorNotificationMode, clock }
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
