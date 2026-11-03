import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

process.env.IS_CAPACITOR = 'true'

const queues = []
const added = []
const toasts = []
const dispatched = []
const opened = []
const getters = { getNotificationMode: 'both' }
let gate = null
const [{ collectNotificationHistory, openNotificationEntry }] = await importWithStubs([sourceUrl('src/renderer/helpers/notificationHistory.js')], {
  [sourceUrl('src/renderer/helpers/androidSubscriptionRefresh.js')]: {
    takeAndroidUploadNotifications: async () => {
      const notifications = queues.shift() ?? []
      await gate?.promise
      return notifications
    }
  },
  [sourceUrl('src/renderer/helpers/capacitorNotificationHistory.js')]: {
    capacitorNotificationHistory: { markRead: () => {}, add: additions => { added.push(...additions); return additions.map((addition, index) => ({ ...addition, id: String(index), read: false })) } }
  },
  [sourceUrl('src/renderer/helpers/liveReminders.js')]: { collectFiredCapacitorReminders: () => {} },
  [sourceUrl('src/renderer/helpers/utils.js')]: { getVideoThumbnailUrl: () => null, openInternalPath: options => { opened.push(options.path) }, showToast: (...args) => { toasts.push(args) } },
  [sourceUrl('src/renderer/i18n/index.js')]: { default: { global: { t: key => key } } },
  [sourceUrl('src/renderer/store/index.js')]: { default: { getters, dispatch: action => { dispatched.push(action) } } }
})

const upload = id => ({ feedType: 'videos', id, live: false, title: 'New video', body: id, createdAt: 1, inApp: true })

test('a collection requested while one runs also takes what Android queued meanwhile', async () => {
  queues.push([upload('first')])
  gate = Promise.withResolvers()
  const running = collectNotificationHistory()
  // The running pass already took the queue when Android adds the next upload.
  await Promise.resolve()
  queues.push([upload('second')])
  const requested = collectNotificationHistory()
  gate.resolve()
  await Promise.all([running, requested])
  assert.deepEqual(added.map(addition => addition.body), ['first', 'second'])
})

test('uploads Android left to the app show no toast once notifications are off', async () => {
  toasts.length = 0
  queues.push([upload('third')])
  gate = Promise.withResolvers()
  const running = collectNotificationHistory()
  // The user turns notifications off while the pass waits for Android.
  await Promise.resolve()
  getters.getNotificationMode = 'off'
  gate.resolve()
  await running
  assert.deepEqual(toasts, [])
  getters.getNotificationMode = 'both'
})

test('opening a notification from settings closes them, unless it leads to the downloads there', () => {
  openNotificationEntry({ id: '1', read: true, path: '/watch/abc' })
  assert.deepEqual(dispatched, ['hideSettingsWindow'])
  assert.deepEqual(opened, ['/watch/abc'])

  dispatched.length = 0
  openNotificationEntry({ id: '2', read: true, path: '/downloads' })
  assert.deepEqual(dispatched, ['showSettingsWindow'])
})
