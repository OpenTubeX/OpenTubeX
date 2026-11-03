import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
}

const scheduled = new Map()
let nativeDelay = Promise.resolve()
const LocalNotifications = {
  async checkPermissions() { return { display: 'granted' } },
  async requestPermissions() { return { display: 'granted' } },
  async cancel({ notifications }) {
    await nativeDelay
    for (const { id } of notifications) scheduled.delete(id)
  },
  async schedule({ notifications }) {
    await nativeDelay
    for (const notification of notifications) scheduled.set(notification.id, notification)
  },
  async addListener() { return { remove() {} } },
}

process.env.IS_CAPACITOR = 'true'
const [{ liveReminder }] = await importWithStubs(
  [sourceUrl('src/renderer/helpers/liveReminders.js')],
  { '@capacitor/local-notifications': { LocalNotifications } }
)

const reminder = (videoId, startTimestamp = Date.now() + 60_000) => ({
  videoId,
  startTimestamp,
  notificationTitle: 'Starting soon',
  notificationBody: videoId,
})

test.beforeEach(() => {
  storage.clear()
  scheduled.clear()
  nativeDelay = Promise.resolve()
})

test('concurrent schedules keep every reminder that was scheduled natively', async () => {
  await Promise.all(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(id => liveReminder.schedule(reminder(id))))
  const saved = await liveReminder.list()
  assert.equal(scheduled.size, 3)
  assert.deepEqual(saved.map(record => record.videoId).sort(), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
  assert.deepEqual(new Set(saved.map(record => record.notificationId)), new Set(scheduled.keys()))
})

test('a cancel issued while scheduling the same video wins', async () => {
  const scheduling = liveReminder.schedule(reminder('aaaaaaaaaaa'))
  const cancelling = liveReminder.cancel('aaaaaaaaaaa')
  assert.equal(await scheduling, true)
  assert.equal(await cancelling, true)
  assert.equal(scheduled.size, 0)
  assert.deepEqual(await liveReminder.list(), [])
})

test('a failed native call does not block later reminder updates', async () => {
  nativeDelay = Promise.reject(new Error('native failure'))
  nativeDelay.catch(() => {})
  await assert.rejects(liveReminder.schedule(reminder('aaaaaaaaaaa')))
  nativeDelay = Promise.resolve()
  assert.equal(await liveReminder.schedule(reminder('bbbbbbbbbbb')), true)
  assert.deepEqual((await liveReminder.list()).map(record => record.videoId), ['bbbbbbbbbbb'])
})

test('reminders that already started are rejected without a notification', async () => {
  assert.equal(await liveReminder.schedule(reminder('aaaaaaaaaaa', Date.now() - 1000)), false)
  assert.equal(scheduled.size, 0)
  assert.deepEqual(await liveReminder.list(), [])
})
