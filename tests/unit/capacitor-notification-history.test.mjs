import assert from 'node:assert/strict'
import test from 'node:test'
import { NOTIFICATION_HISTORY_LIMIT } from '../../src/notificationHistory.js'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
}
const closed = []
const [{ capacitorNotificationHistory: history }] = await importWithStubs([sourceUrl('src/renderer/helpers/capacitorNotificationHistory.js')], {
  [sourceUrl('src/renderer/helpers/capacitorSystemNotifications.js')]: {
    closeCapacitorSystemNotifications: targets => { closed.push(...targets.map(({ path }) => path)) }
  }
})

let dismissed = 0
history.onDismissed(() => { dismissed++ })

const video = (id, createdAt) => ({ kind: 'video', title: id, body: '', path: `/watch/${id}`, createdAt })

test('the mobile history keeps dismissals for other devices and closes outdated system notifications', async () => {
  const [first, second] = history.add([video('a', 2), video('b', 1)])
  await history.markRead(first.id)
  assert.deepEqual(closed, ['/watch/a'])
  await history.remove(second.id)
  assert.deepEqual(closed, ['/watch/a', '/watch/b'])
  assert.equal(dismissed, 2)
  assert.deepEqual((await history.getDismissals()).dismissals.map(({ key, removedAt }) => [key, removedAt !== undefined]).sort(),
    [['video:/watch/a', false], ['video:/watch/b', true]])

  // Android reports a notification the user opened or dismissed.
  history.add([video('c', 3)])
  history.markTargetsRead([{ kind: 'video', path: '/watch/c' }, { kind: 'video', path: '/watch/unknown' }])
  assert.deepEqual((await history.list()).map(entry => [entry.title, entry.read]), [['c', true], ['a', true]])
  assert.equal(dismissed, 3)
})

test('dismissals from other devices apply to existing and later entries without being reported as new', async () => {
  closed.length = 0
  history.add([video('d', 4), video('e', 4)])
  const now = Date.now()
  await history.mergeDismissals({
    readThrough: 0,
    clearedThrough: 0,
    dismissals: [{ key: 'video:/watch/d', at: now, removedAt: now }, { key: 'video:/watch/f', at: now }]
  })
  assert.deepEqual(closed, ['/watch/d'])
  assert.equal(dismissed, 3)

  // Collected later, such as an upload Android showed while the app was closed.
  const added = history.add([video('d', 5), video('f', 5), video('g', 5)])
  assert.deepEqual(added.map(entry => [entry.title, entry.read]), [['f', true], ['g', false]])
  assert.deepEqual(closed, ['/watch/d', '/watch/d', '/watch/f'])

  await history.clear()
  assert.deepEqual(await history.list(), [])
  assert.ok((await history.getDismissals()).clearedThrough >= now)
  assert.equal(dismissed, 4)
})

test('entries that make room for new ones keep their system notifications', async () => {
  await history.clear()
  history.add(Array.from({ length: NOTIFICATION_HISTORY_LIMIT }, (_, index) => video(`full${index}`, Date.now() + index)))
  closed.length = 0
  history.add([video('newest', Date.now() + NOTIFICATION_HISTORY_LIMIT)])
  assert.equal((await history.list()).length, NOTIFICATION_HISTORY_LIMIT)
  assert.deepEqual(closed, [])
})

test('opening or dismissing a reminder the system showed alone still reaches other devices', async () => {
  await history.clear()
  const before = dismissed
  // In the system-only mode, this device keeps no entry for the reminder.
  history.markTargetsRead([{ kind: 'live-reminder', path: '/watch/premiere' }])
  assert.deepEqual(await history.list(), [])
  assert.equal(dismissed, before + 1)
  const dismissal = (await history.getDismissals()).dismissals.find(({ key }) => key === 'live-reminder:/watch/premiere')
  assert.ok(dismissal && dismissal.removedAt === undefined)
})
