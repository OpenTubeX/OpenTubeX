import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  NOTIFICATION_HISTORY_LIMIT,
  addNotificationHistoryEntries,
  getAutomaticDownloadTarget,
  getUploadTarget,
  isThumbnailUrl,
  markNotificationHistoryRead,
  normalizeNotificationHistory
} from '../../src/notificationHistory.js'
import { createNotificationHistory, createNotifier } from '../../src/main/notificationHistory.js'
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
    const history = createNotificationHistory({ file, onChange: entries => reported.push(entries) })
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

    const restarted = createNotificationHistory({ file, onChange: () => {} })
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
    const history = createNotificationHistory({ file, onChange: () => {} })
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
