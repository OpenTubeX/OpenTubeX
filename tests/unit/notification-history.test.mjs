import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  NOTIFICATION_DISMISSAL_LIMIT,
  NOTIFICATION_HISTORY_LIMIT,
  addNotificationHistoryEntries,
  applyNotificationDismissals,
  getDismissedNotificationEntries,
  getNotificationKey,
  mergeNotificationDismissals,
  normalizeNotificationDismissals,
  recordNotificationDismissals,
  getAutomaticDownloadTarget,
  getUploadTarget,
  isThumbnailUrl,
  markNotificationHistoryRead,
  normalizeNotificationHistory,
  removeNotificationHistoryEntry
} from '../../src/notificationHistory.js'
import { createNotificationHistory, createNotifier, createSystemNotificationLinks } from '../../src/main/notificationHistory.js'
import { getUploadThumbnailUrl } from '../../src/newUploadNotifications.js'

const input = (title, createdAt) => ({ kind: 'video', title, body: 'Body', path: '/watch/abc', createdAt })

test('new entries are unread, newest first, and limited', () => {
  let entries = []
  for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 5; index++) {
    entries = addNotificationHistoryEntries(entries, [input(`Entry ${index}`, index)])
  }
  assert.equal(entries.length, NOTIFICATION_HISTORY_LIMIT)
  assert.equal(entries[0].title, `Entry ${NOTIFICATION_HISTORY_LIMIT + 4}`)
  assert.equal(entries.at(-1).title, 'Entry 5')
  assert.ok(entries.every(entry => entry.read === false && typeof entry.id === 'string'))
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length)

  // Late arrivals, such as Android uploads collected when the app opens, sort by when they were shown.
  entries = addNotificationHistoryEntries(entries, [input('Older', 50.5)])
  assert.equal(entries.findIndex(entry => entry.title === 'Older'), NOTIFICATION_HISTORY_LIMIT + 4 - 50)

  const one = markNotificationHistoryRead(entries, entries[1].id)
  assert.deepEqual(one.filter(entry => entry.read).map(entry => entry.id), [entries[1].id])
  assert.ok(markNotificationHistoryRead(one).every(entry => entry.read))
  // Unchanged histories stay the same array, so they are not saved again.
  assert.equal(markNotificationHistoryRead(one, entries[1].id), one)
  assert.equal(markNotificationHistoryRead(one, 'unknown'), one)

  const removed = removeNotificationHistoryEntry(one, entries[1].id)
  assert.deepEqual(removed.map(entry => entry.id), one.filter(entry => entry.id !== entries[1].id).map(entry => entry.id))
  assert.equal(removeNotificationHistoryEntry(removed, entries[1].id), removed)
})

test('saved histories keep only valid entries', () => {
  const [valid] = addNotificationHistoryEntries([], [input('Valid', 1)])
  assert.deepEqual(normalizeNotificationHistory([
    valid,
    { ...valid, id: 'external', path: 'https://example.com' },
    { ...valid, id: 'kind', kind: 'unknown' },
    { ...valid, id: 'query', query: { downloadId: 1 } },
    null
  ]), [valid])
  assert.deepEqual(normalizeNotificationHistory({}), [])
})

test('entries lead to the uploaded item or the download', () => {
  assert.deepEqual(getUploadTarget('videos', 'abc'), { kind: 'video', path: '/watch/abc' })
  assert.deepEqual(getUploadTarget('live', 'abc', true), { kind: 'live', path: '/watch/abc' })
  assert.deepEqual(getUploadTarget('shorts', 'abc'), { kind: 'short', path: '/watch/abc', query: { short: 'true' } })
  assert.deepEqual(getUploadTarget('posts', 'Ugk-x_1'), { kind: 'post', path: '/post/Ugk-x_1' })
  assert.equal(getUploadTarget('videos', '../settings'), null)
  assert.equal(getUploadTarget('videos', undefined), null)

  assert.deepEqual(getAutomaticDownloadTarget('completed', 'abc', 4), { kind: 'download-completed', path: '/watch/abc', query: { downloadId: '4' } })
  assert.deepEqual(getAutomaticDownloadTarget('completed', undefined, 4), { kind: 'download-started', path: '/downloads' })
  assert.deepEqual(getAutomaticDownloadTarget('started', 'abc', null), { kind: 'download-started', path: '/downloads' })
  assert.deepEqual(getAutomaticDownloadTarget('failed', 'abc', null), { kind: 'download-failed', path: '/downloads' })
})

test('the desktop history persists changes and reports each one', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-history-'))
  try {
    const file = path.join(directory, 'history.json')
    const reported = []
    const history = createNotificationHistory({ file, dismissalsFile: path.join(directory, 'dismissals.json'), onChange: entries => reported.push(entries) })
    assert.deepEqual(await history.list(), [])

    history.add({ kind: 'live-reminder', title: 'Live', body: 'Stream', path: '/watch/abc' })
    await history.add({ kind: 'video', title: 'Upload', body: 'Video', path: '/watch/def' })
    assert.deepEqual((await history.list()).map(entry => [entry.title, entry.read]), [['Upload', false], ['Live', false]])

    const [upload] = await history.list()
    await history.markRead(upload.id)
    assert.deepEqual((await history.list()).map(entry => entry.read), [true, false])
    await history.markRead()
    // Nothing changed, so nothing is reported or written.
    await history.markRead()
    assert.equal(reported.length, 4)
    assert.ok(reported.at(-1).every(entry => entry.read))

    await history.remove(upload.id)
    await history.remove(upload.id)
    assert.equal(reported.length, 5)
    assert.deepEqual((await history.list()).map(entry => entry.title), ['Live'])

    const restarted = createNotificationHistory({ file, dismissalsFile: path.join(directory, 'dismissals.json'), onChange: () => {} })
    assert.deepEqual(await restarted.list(), await history.list())

    await history.clear()
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a corrupt desktop history starts empty', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-history-'))
  try {
    const file = path.join(directory, 'history.json')
    await writeFile(file, '{')
    const history = createNotificationHistory({ file, dismissalsFile: path.join(directory, 'dismissals.json'), onChange: () => {} })
    assert.deepEqual(await history.list(), [])
    await history.add({ kind: 'video', title: 'Upload', body: 'Video', path: '/watch/def' })
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the mode decides between the system, the app, and the bell', async () => {
  const added = []
  const inApp = []
  let systemShown = 0
  let mode = 'both'
  let foreground = null
  const notify = createNotifier({
    history: { add: async entry => { added.push(entry); return { ...entry, id: String(added.length), createdAt: 0, read: false } } },
    getMode: () => mode,
    getForegroundWindow: () => foreground,
    showInApp: (window, entry) => inApp.push([window, entry.title])
  })
  const notification = title => ({
    title,
    body: 'Body',
    target: { kind: 'video', path: '/watch/abc' },
    showSystemNotification: () => { systemShown++ }
  })

  // In the background, the system shows it and the bell keeps it.
  await notify(notification('Background'))
  assert.equal(systemShown, 1)
  assert.deepEqual(added.map(entry => entry.title), ['Background'])

  // A focused window shows it instead of the system.
  foreground = 'window'
  await notify(notification('Foreground'))
  assert.equal(systemShown, 1)
  assert.deepEqual(inApp, [['window', 'Foreground']])
  assert.deepEqual(added.map(entry => entry.title), ['Background', 'Foreground'])

  // System only keeps no history and never shows notifications in the app.
  mode = 'system'
  await notify(notification('System'))
  assert.equal(systemShown, 2)
  assert.equal(added.length, 2)
  assert.equal(inApp.length, 1)

  mode = 'off'
  await notify(notification('Off'))
  assert.equal(systemShown, 2)
  assert.equal(added.length, 2)
  assert.equal(inApp.length, 1)
})

test('a window that loses focus while the bell saves gets a system notification instead', async () => {
  let foreground = 'window'
  let systemShown = 0
  const inApp = []
  const notify = createNotifier({
    history: {
      add: async entry => {
        foreground = null
        return { ...entry, id: '1', createdAt: 0, read: false }
      }
    },
    getMode: () => 'both',
    getForegroundWindow: () => foreground,
    showInApp: window => inApp.push(window)
  })

  await notify({
    title: 'Title',
    body: 'Body',
    target: { kind: 'video', path: '/watch/abc' },
    showSystemNotification: () => { systemShown++ }
  })
  assert.equal(systemShown, 1)
  assert.deepEqual(inApp, [])
})

test('turning notifications off while the bell saves shows no system notification', async () => {
  let mode = 'both'
  let systemShown = 0
  const notify = createNotifier({
    history: {
      add: async entry => {
        mode = 'off'
        return { ...entry, id: '1', createdAt: 0, read: false }
      }
    },
    getMode: () => mode,
    getForegroundWindow: () => null,
    showInApp: () => {}
  })

  await notify({
    title: 'Title',
    body: 'Body',
    target: { kind: 'video', path: '/watch/abc' },
    showSystemNotification: () => { systemShown++ }
  })
  assert.equal(systemShown, 0)
})

test('entries keep web thumbnails, and uploads get theirs from the configured template', () => {
  assert.equal(isThumbnailUrl('https://i.ytimg.com/vi/abc/mqdefault.jpg'), true)
  // Invidious instances can be local servers.
  assert.equal(isThumbnailUrl('http://192.168.1.2:3000/vi/abc/mqdefault.jpg'), true)
  assert.equal(isThumbnailUrl('file:///etc/passwd'), false)
  assert.equal(isThumbnailUrl('javascript:alert(1)'), false)
  assert.equal(isThumbnailUrl(undefined), false)

  const [withThumbnail, withoutThumbnail] = addNotificationHistoryEntries([], [
    { ...input('Valid', 2), thumbnail: 'https://i.ytimg.com/vi/abc/mqdefault.jpg' },
    { ...input('Invalid', 1), thumbnail: 'file:///etc/passwd' }
  ])
  assert.equal(withThumbnail.thumbnail, 'https://i.ytimg.com/vi/abc/mqdefault.jpg')
  assert.equal('thumbnail' in withoutThumbnail, false)
  assert.deepEqual(normalizeNotificationHistory([{ ...withoutThumbnail, thumbnail: 'file:///etc/passwd' }]), [])

  const configuration = { thumbnailUrl: 'https://invidious.example/vi/{id}/mqdefault.jpg' }
  assert.equal(getUploadThumbnailUrl(configuration, 'videos', 'a b'), 'https://invidious.example/vi/a%20b/mqdefault.jpg')
  assert.equal(getUploadThumbnailUrl(configuration, 'shorts', 'abc'), 'https://invidious.example/vi/abc/mqdefault.jpg')
  // Posts have no video thumbnail, and hidden thumbnails leave the template out.
  assert.equal(getUploadThumbnailUrl(configuration, 'posts', 'abc'), undefined)
  assert.equal(getUploadThumbnailUrl({}, 'videos', 'abc'), undefined)
})

test('a slow first read of the desktop history cannot undo a notification added meanwhile', async () => {
  const fsPromises = (await import('node:fs/promises')).default
  const { syncBuiltinESMExports } = await import('node:module')
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-history-'))
  const original = fsPromises.readFile
  let delayed = false
  fsPromises.readFile = async (...args) => {
    const text = await original(...args)
    if (!delayed) {
      delayed = true
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return text
  }
  syncBuiltinESMExports()
  try {
    const file = path.join(directory, 'history.json')
    await writeFile(file, '[]')
    const history = createNotificationHistory({ file, dismissalsFile: path.join(directory, 'dismissals.json'), onChange: () => {} })
    const listing = history.list()
    await history.add({ kind: 'video', title: 'Upload', body: 'Video', path: '/watch/def' })
    await listing
    assert.deepEqual((await history.list()).map(entry => entry.title), ['Upload'])
  } finally {
    fsPromises.readFile = original
    syncBuiltinESMExports()
    await rm(directory, { recursive: true, force: true })
  }
})

const none = normalizeNotificationDismissals(null)

test('dismissals match notifications about the same item on every device, except downloads', () => {
  assert.equal(getNotificationKey({ kind: 'video', path: '/watch/abc' }), 'video:/watch/abc')
  assert.equal(getNotificationKey({ kind: 'short', path: '/watch/abc', query: { short: 'true' } }), 'short:/watch/abc?short=true')
  assert.equal(getNotificationKey({ kind: 'live', path: '/watch/abc', query: { b: '2', a: '1' } }),
    getNotificationKey({ kind: 'live', path: '/watch/abc', query: { a: '1', b: '2' } }))
  // A reminder and the upload of the same stream are different notifications.
  assert.notEqual(getNotificationKey({ kind: 'live-reminder', path: '/watch/abc' }), getNotificationKey({ kind: 'live', path: '/watch/abc' }))
  assert.equal(getNotificationKey({ kind: 'download-completed', path: '/watch/abc', query: { downloadId: '1' } }), null)
  assert.equal(getNotificationKey({ kind: 'download-failed', path: '/downloads' }), null)
})

test('merged dismissals agree on every device, keep removals, and drop the oldest', () => {
  const phone = { readThrough: 5, clearedThrough: 0, dismissals: [{ key: 'video:/watch/a', at: 10 }, { key: 'video:/watch/b', at: 3, removedAt: 3 }] }
  const laptop = { readThrough: 0, clearedThrough: 7, dismissals: [{ key: 'video:/watch/a', at: 4, removedAt: 4 }, { key: 'post:/post/c', at: 8 }] }
  const merged = mergeNotificationDismissals(phone, laptop)
  assert.deepEqual(merged, {
    readThrough: 5,
    clearedThrough: 7,
    dismissals: [
      // A read on one device does not bring back an entry another removed.
      { key: 'video:/watch/a', at: 10, removedAt: 4 },
      { key: 'post:/post/c', at: 8 },
      { key: 'video:/watch/b', at: 3, removedAt: 3 }
    ]
  })
  assert.deepEqual(mergeNotificationDismissals(laptop, phone), merged)
  assert.deepEqual(mergeNotificationDismissals(merged, phone), merged)

  const many = { readThrough: 0, clearedThrough: 0, dismissals: Array.from({ length: NOTIFICATION_DISMISSAL_LIMIT + 3 }, (_, index) => ({ key: `video:/watch/${index}`, at: index + 1 })) }
  const pruned = normalizeNotificationDismissals(many)
  assert.equal(pruned.dismissals.length, NOTIFICATION_DISMISSAL_LIMIT)
  assert.equal(pruned.dismissals.at(-1).key, 'video:/watch/3')

  assert.deepEqual(normalizeNotificationDismissals({
    readThrough: 'soon',
    clearedThrough: -1,
    dismissals: [null, { key: 1, at: 1 }, { key: 'video:/watch/a', removedAt: 'yes' }, { key: 'video:/watch/a', at: Infinity, removedAt: -1 }]
  }), none)
})

test('dismissals record entries with keys, and mark all or clear all also cover entries elsewhere', () => {
  const [video, download] = addNotificationHistoryEntries([], [
    { kind: 'video', title: 'Upload', body: 'Video', path: '/watch/abc', createdAt: 1 },
    { kind: 'download-failed', title: 'Download', body: 'Failed', path: '/downloads', createdAt: 2 }
  ]).toReversed()
  assert.deepEqual(recordNotificationDismissals(none, [video, download], { removed: false, now: 5 }),
    { readThrough: 0, clearedThrough: 0, dismissals: [{ key: 'video:/watch/abc', at: 5 }] })
  assert.equal(recordNotificationDismissals(none, [download], { removed: true, now: 5 }), none)
  assert.deepEqual(recordNotificationDismissals(none, [], { removed: false, through: true, now: 5 }), { ...none, readThrough: 5 })
  assert.deepEqual(recordNotificationDismissals(none, [download], { removed: true, through: true, now: 5 }), { ...none, clearedThrough: 5 })
})

test('dismissals apply to existing entries and ones added later, but not to downloads', () => {
  const entries = addNotificationHistoryEntries([], [
    { kind: 'video', title: 'Read elsewhere', body: '', path: '/watch/a', createdAt: 20 },
    { kind: 'video', title: 'Removed elsewhere', body: '', path: '/watch/b', createdAt: 20 },
    { kind: 'post', title: 'Before mark all', body: '', path: '/post/c', createdAt: 10 },
    { kind: 'short', title: 'Before clear all', body: '', path: '/watch/d', query: { short: 'true' }, createdAt: 5 },
    { kind: 'video', title: 'New', body: '', path: '/watch/e', createdAt: 20 },
    { kind: 'download-started', title: 'Download', body: '', path: '/downloads', createdAt: 1 }
  ])
  const dismissals = {
    readThrough: 10,
    clearedThrough: 5,
    dismissals: [{ key: 'video:/watch/a', at: 30 }, { key: 'video:/watch/b', at: 30, removedAt: 30 }]
  }
  const applied = applyNotificationDismissals(entries, dismissals)
  assert.deepEqual(applied.map(entry => [entry.title, entry.read]), [
    ['Read elsewhere', true],
    ['New', false],
    ['Before mark all', true],
    ['Download', false]
  ])
  assert.equal(applyNotificationDismissals(applied, dismissals), applied)
  // Their system notifications are outdated.
  assert.deepEqual(getDismissedNotificationEntries(entries, applied).map(entry => entry.title),
    ['Read elsewhere', 'Removed elsewhere', 'Before mark all', 'Before clear all'])
  assert.deepEqual(getDismissedNotificationEntries(applied, applied), [])
})

test('entries that make room for new ones keep their system notifications', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-history-'))
  try {
    const file = path.join(directory, 'history.json')
    const full = addNotificationHistoryEntries([], Array.from({ length: NOTIFICATION_HISTORY_LIMIT }, (_, index) =>
      ({ kind: 'video', title: String(index), body: '', path: `/watch/${index}`, createdAt: index + 1 })))
    await writeFile(file, JSON.stringify(full))
    const stale = []
    const history = createNotificationHistory({ file, dismissalsFile: path.join(directory, 'dismissals.json'), onChange: () => {}, onStale: entries => stale.push(...entries) })
    await history.add({ kind: 'video', title: 'New', body: '', path: '/watch/new' })
    assert.equal((await history.list()).length, NOTIFICATION_HISTORY_LIMIT)
    assert.deepEqual(stale, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a dismissed reminder does not dismiss one for a later premiere of the same video', () => {
  const hour = 3_600_000
  const reminder = createdAt => ({ kind: 'live-reminder', title: 'Live', body: '', path: '/watch/stream', createdAt })
  const dismissals = { readThrough: 0, clearedThrough: 0, dismissals: [{ key: 'live-reminder:/watch/stream', at: hour + 100_000, removedAt: hour + 100_000 }] }
  // Another device removed the reminder for the original start, after it fired there.
  assert.deepEqual(applyNotificationDismissals(addNotificationHistoryEntries([], [reminder(hour)]), dismissals), [])
  // A phone shows a reminder a moment early, and the user removed it before the start.
  const early = { readThrough: 0, clearedThrough: 0, dismissals: [{ key: 'live-reminder:/watch/stream', at: hour - 3000, removedAt: hour - 3000 }] }
  assert.deepEqual(applyNotificationDismissals(addNotificationHistoryEntries([], [reminder(hour)]), early), [])
  // The stream moved, and its new reminder fires later.
  const later = addNotificationHistoryEntries([], [reminder(3 * hour)])
  assert.equal(applyNotificationDismissals(later, dismissals), later)
  // Reading the new reminder keeps the old removal from reaching it.
  const read = mergeNotificationDismissals(dismissals, recordNotificationDismissals(dismissals, later, { removed: false, now: 3 * hour + 100_000 }))
  assert.deepEqual(applyNotificationDismissals(later, read).map(entry => entry.read), [true])
  assert.deepEqual(applyNotificationDismissals(addNotificationHistoryEntries([], [reminder(hour)]), read), [])
})

test('the desktop history keeps dismissals for other devices and applies theirs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notification-history-'))
  try {
    const options = { file: path.join(directory, 'history.json'), dismissalsFile: path.join(directory, 'dismissals.json') }
    let dismissed = 0
    const stale = []
    const history = createNotificationHistory({
      ...options,
      onChange: () => {},
      onDismissalsChange: () => { dismissed++ },
      onStale: entries => stale.push(...entries.map(entry => entry.title))
    })
    const first = await history.add({ kind: 'video', title: 'First', body: '', path: '/watch/a' })
    await history.add({ kind: 'download-completed', title: 'Download', body: '', path: '/watch/a', query: { downloadId: '1' } })
    await history.markRead(first.id)
    assert.deepEqual((await history.getDismissals()).dismissals.map(({ key, removedAt }) => [key, removedAt !== undefined]), [['video:/watch/a', false]])
    assert.equal(dismissed, 1)
    assert.deepEqual(stale, ['First'])

    // Another device read one notification and removed another.
    const second = await history.add({ kind: 'video', title: 'Second', body: '', path: '/watch/b' })
    const third = await history.add({ kind: 'post', title: 'Third', body: '', path: '/post/c' })
    const now = Date.now()
    const merged = await history.mergeDismissals({
      readThrough: 0,
      clearedThrough: 0,
      dismissals: [{ key: 'video:/watch/b', at: now }, { key: 'post:/post/c', at: now, removedAt: now }]
    })
    assert.equal(merged.dismissals.length, 3)
    assert.deepEqual((await history.list()).map(entry => [entry.title, entry.read]), [['Second', true], ['Download', false], ['First', true]])
    assert.deepEqual(stale, ['First', 'Third', 'Second'])
    // Dismissals from other devices are not reported as new ones made here.
    assert.equal(dismissed, 1)
    assert.ok(second.id && third.id)

    // Later notifications about the same items arrive already handled.
    assert.equal(await history.add({ kind: 'post', title: 'Third again', body: '', path: '/post/c' }), null)
    assert.equal((await history.add({ kind: 'video', title: 'Second again', body: '', path: '/watch/b' })).read, true)

    const restarted = createNotificationHistory({ ...options, onChange: () => {} })
    assert.deepEqual(await restarted.getDismissals(), merged)

    await history.clear()
    const cleared = await history.getDismissals()
    assert.ok(cleared.clearedThrough >= now)
    assert.equal(dismissed, 2)
    // The cleared download is no notification for other devices.
    assert.ok(cleared.dismissals.every(dismissal => dismissal.key.startsWith('video:') || dismissal.key.startsWith('post:')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('notifications another device dismissed reach neither the app nor the system', async () => {
  let saved
  const inApp = []
  let systemShown = 0
  const notify = createNotifier({
    history: { add: async () => saved },
    getMode: () => 'both',
    getForegroundWindow: () => null,
    showInApp: (window, entry) => inApp.push(entry)
  })
  const notification = { title: 'Title', body: 'Body', target: { kind: 'video', path: '/watch/abc' }, showSystemNotification: () => { systemShown++ } }
  saved = null
  await notify(notification)
  saved = { kind: 'video', path: '/watch/abc', title: 'Title', body: 'Body', id: '1', createdAt: 0, read: true }
  await notify(notification)
  assert.equal(systemShown, 0)
  // Without a saved entry, the system still shows it.
  saved = undefined
  await notify(notification)
  assert.equal(systemShown, 1)
  assert.deepEqual(inApp, [])
})

test('system notifications and their entries stay in step', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeNotification extends EventEmitter {
    closed = false
    close() { this.closed = true }
  }
  const read = []
  const links = createSystemNotificationLinks(id => read.push(id), 'win32')
  const entries = []
  const notify = createNotifier({
    history: {
      add: async ({ title }) => {
        const entry = { kind: 'video', path: '/watch/abc', title, body: '', id: title, createdAt: 0, read: false }
        entries.push(entry)
        return entry
      },
      list: async () => entries
    },
    getMode: () => 'both',
    getForegroundWindow: () => null,
    showInApp: () => {},
    link: links.link
  })
  const shown = new Map()
  const show = title => notify({ title, body: '', target: { kind: 'video', path: '/watch/abc' }, showSystemNotification: () => {
    const notification = new FakeNotification()
    shown.set(title, notification)
    return notification
  } })
  for (const title of ['clicked', 'dismissed', 'timed out', 'read in the app']) await show(title)

  shown.get('clicked').emit('click')
  shown.get('dismissed').emit('close', { reason: 'userCanceled' })
  shown.get('timed out').emit('close', { reason: 'timedOut' })
  assert.deepEqual(read, ['clicked', 'dismissed'])

  links.close([{ id: 'read in the app' }, { id: 'clicked' }, { id: 'timed out' }])
  assert.equal(shown.get('read in the app').closed, true)
  // Windows keeps notifications that timed out in its action center.
  assert.equal(shown.get('timed out').closed, true)
  assert.equal(shown.get('clicked').closed, false)
  // Closing it does not mark the entry read again.
  shown.get('read in the app').emit('close', { reason: 'userCanceled' })
  assert.deepEqual(read, ['clicked', 'dismissed'])
})

test('reminders keep the time they were due in the history', async () => {
  const added = []
  const notify = createNotifier({
    history: { add: async entry => { added.push(entry); return null } },
    getMode: () => 'both',
    getForegroundWindow: () => null,
    showInApp: () => {}
  })
  await notify({ title: 'Live', body: '', createdAt: 42, target: { kind: 'live-reminder', path: '/watch/stream' }, showSystemNotification: () => {} })
  assert.equal(added[0].createdAt, 42)
})

test('a notification whose entry was read while it loaded closes instead of staying', async () => {
  const { EventEmitter } = await import('node:events')
  const linked = []
  const entries = []
  const notify = createNotifier({
    history: {
      add: async ({ title }) => {
        const entry = { kind: 'video', path: `/watch/${title}`, title, body: '', id: title, createdAt: 0, read: false }
        entries.push(entry)
        return entry
      },
      list: async () => entries
    },
    getMode: () => 'both',
    getForegroundWindow: () => null,
    showInApp: () => {},
    link: entry => linked.push(entry.id)
  })
  const shown = {}
  const show = (title, whileLoading) => notify({ title, body: '', target: { kind: 'video', path: `/watch/${title}` }, showSystemNotification: async () => {
    // Another device or the bell dismisses the entry while the thumbnail loads.
    whileLoading()
    shown[title] = Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true } })
    return shown[title]
  } })
  await show('read', () => { entries[0] = { ...entries[0], read: true } })
  await show('removed', () => { entries.pop() })
  await show('unread', () => {})
  assert.deepEqual(linked, ['unread'])
  assert.deepEqual(Object.entries(shown).map(([title, notification]) => [title, notification.closed]),
    [['read', true], ['removed', true], ['unread', false]])
})

test('only dismissals mark entries read, which Linux cannot tell from expired notifications', async () => {
  const { EventEmitter } = await import('node:events')
  for (const [platform, expected] of [['darwin', ['1']], ['linux', []]]) {
    const read = []
    const links = createSystemNotificationLinks(id => read.push(id), platform)
    const notification = Object.assign(new EventEmitter(), { close() {} })
    links.link({ id: '1' }, notification)
    notification.emit('close', {})
    assert.deepEqual(read, expected, platform)
  }
})
