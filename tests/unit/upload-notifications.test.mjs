import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createUploadNotificationConfiguration,
  createUploadNotificationState,
  getUploadUrl,
  normalizeUploadEntries,
  takeNewUploads,
  takeVisibleUploads
} from '../../src/newUploadNotifications.js'
import { createUploadNotifier } from '../../src/main/uploadNotifications.js'

const NOW = Date.UTC(2026, 9, 19)
const HOUR = 3_600_000

function entry(id, published = NOW - HOUR, extra = {}) {
  return { id, title: `Title ${id}`, published, live: false, upcoming: false, membersOnly: false, ...extra }
}

test('the first observation of a feed only records a baseline', () => {
  const state = createUploadNotificationState()
  assert.deepEqual(takeNewUploads(state, 'UC1', 'videos', [entry('b'), entry('a')], NOW), [])
  assert.deepEqual(state.known['UC1:videos'], ['b', 'a'])
})

test('entries ahead of the newest known entry are new uploads, once', () => {
  const state = createUploadNotificationState()
  takeNewUploads(state, 'UC1', 'videos', [entry('b'), entry('a')], NOW)

  const uploads = takeNewUploads(state, 'UC1', 'videos', [entry('d'), entry('c'), entry('b'), entry('a')], NOW)
  assert.deepEqual(uploads.map(upload => upload.id), ['d', 'c'])
  assert.deepEqual(takeNewUploads(state, 'UC1', 'videos', [entry('d'), entry('c'), entry('b')], NOW), [])
})

test('responses without overlap, old entries, and upcoming entries do not notify', () => {
  const state = createUploadNotificationState()
  takeNewUploads(state, 'UC1', 'live', [entry('a')], NOW)

  assert.deepEqual(takeNewUploads(state, 'UC1', 'live', [entry('x'), entry('y')], NOW), [])
  assert.deepEqual(takeNewUploads(state, 'UC1', 'live', [entry('old', NOW - 8 * 24 * HOUR), entry('a')], NOW), [])

  const scheduled = entry('stream', NOW + HOUR, { upcoming: true })
  assert.deepEqual(takeNewUploads(state, 'UC1', 'live', [scheduled, entry('a')], NOW), [])
  const live = entry('stream', NOW + HOUR, { live: true })
  assert.deepEqual(takeNewUploads(state, 'UC1', 'live', [live, entry('a')], NOW).map(upload => upload.id), ['stream'])
})

test('a feed that was empty notifies its first entries, and other feeds do not repeat them', () => {
  const state = createUploadNotificationState()
  takeNewUploads(state, 'UC1', 'shorts', [], NOW)
  takeNewUploads(state, 'UC1', 'videos', [entry('a')], NOW)

  assert.deepEqual(takeNewUploads(state, 'UC1', 'shorts', [entry('s', 0)], NOW).map(upload => upload.id), ['s'])
  assert.deepEqual(takeNewUploads(state, 'UC1', 'videos', [entry('s', 0), entry('a')], NOW), [])
})

test('feed entries are normalized for videos and posts', () => {
  assert.deepEqual(normalizeUploadEntries([
    { videoId: 'v', title: 'Video', published: 5, liveNow: true, isMembersOnly: true },
    { postId: 'p', postText: 'Hello <a href="x">world</a> &amp; more', publishedTime: 6 },
    { title: 'missing id' }
  ]), [
    { id: 'v', title: 'Video', published: 5, live: true, upcoming: false, membersOnly: true },
    { id: 'p', title: 'Hello world & more', published: 6, live: false, upcoming: false, membersOnly: false }
  ])
  assert.equal(getUploadUrl('posts', 'p1'), 'https://www.youtube.com/post/p1')
  assert.equal(getUploadUrl('shorts', 's1'), 'https://www.youtube.com/shorts/s1')
  assert.equal(getUploadUrl('live', 'v1'), 'https://www.youtube.com/watch?v=v1')
})

test('only channels with notifications turned on are configured', () => {
  const input = {
    enabled: true,
    subscriptions: [
      { id: 'UC1', name: 'One' },
      { id: 'UC2', name: 'Two', notificationFeedTypes: ['posts', 'invalid', 'videos'], showMembersOnly: true },
      { id: 'UC3', name: 'Three', notificationFeedTypes: [] }
    ],
    showMembersOnly: true,
    titles: {}
  }
  assert.deepEqual(createUploadNotificationConfiguration(input).channels, {
    UC2: { name: 'Two', feedTypes: ['videos', 'posts'], membersOnly: true }
  })
  assert.deepEqual(createUploadNotificationConfiguration({ ...input, enabled: false }), { enabled: false })
  assert.deepEqual(createUploadNotificationConfiguration({ ...input, subscriptions: [{ id: 'UC1' }] }), { enabled: false })
})

test('only feed types that refreshes fetch can notify', () => {
  const configuration = createUploadNotificationConfiguration({
    enabled: true,
    subscriptions: [
      { id: 'UC1', name: 'One', feedTypes: ['videos', 'shorts'], notificationFeedTypes: ['videos', 'shorts', 'posts'] },
      { id: 'UC2', name: 'Two', feedTypes: ['posts'], notificationFeedTypes: ['videos'] }
    ],
    hiddenFeedTypes: ['shorts'],
    showMembersOnly: false,
    titles: {}
  })
  assert.deepEqual(configuration.channels, { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } })
})

test('the desktop notifier persists state and shows localized notifications', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const file = path.join(directory, 'state.json')
    const shown = []
    const notifier = createUploadNotifier({ file, show: notification => shown.push(notification) })
    await notifier.configure({
      enabled: true,
      titles: { videos: 'New video from {channel}', live: '{channel} is live' },
      channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } }
    })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a')] })
    await notifier.observe({ channelId: 'UC1', feedType: 'posts', entries: [entry('p')] })

    const restarted = createUploadNotifier({ file, show: notification => shown.push(notification) })
    await restarted.configure({
      enabled: true,
      titles: { videos: 'New video from {channel}', live: '{channel} is live' },
      channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } }
    })
    await restarted.observe({
      channelId: 'UC1',
      feedType: 'videos',
      entries: [entry('m', NOW, { membersOnly: true }), entry('l', Date.now(), { live: true }), entry('b', Date.now()), entry('a')]
    })
    assert.deepEqual(shown, [
      { title: 'One is live', body: 'Title l', url: 'https://www.youtube.com/watch?v=l' },
      { title: 'New video from One', body: 'Title b', url: 'https://www.youtube.com/watch?v=b' }
    ])

    await restarted.configure({ enabled: false })
    await assert.rejects(readFile(file))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('turning a channel off and on again starts from a fresh baseline', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const shown = []
    const notifier = createUploadNotifier({ file: path.join(directory, 'state.json'), show: notification => shown.push(notification) })
    const configure = feedTypes => notifier.configure({
      enabled: true,
      titles: { videos: '{channel}' },
      channels: {
        UC1: { name: 'One', feedTypes, membersOnly: false },
        UC2: { name: 'Two', feedTypes: ['videos'], membersOnly: false }
      }
    })
    await configure(['videos'])
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a', Date.now())] })
    await configure([])
    await configure(['videos'])
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('b', Date.now()), entry('a', Date.now())] })
    assert.deepEqual(shown, [])
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('c', Date.now()), entry('b', Date.now()), entry('a', Date.now())] })
    assert.deepEqual(shown.map(notification => notification.body), ['Title c'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('members-only uploads seen while hidden stay known once they become visible', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const shown = []
    const notifier = createUploadNotifier({ file: path.join(directory, 'state.json'), show: notification => shown.push(notification) })
    const configure = membersOnly => notifier.configure({
      enabled: true,
      titles: { videos: '{channel}' },
      channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly } }
    })
    await configure(false)
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a', Date.now())] })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('m', Date.now(), { membersOnly: true }), entry('a', Date.now())] })
    await configure(true)
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('m', Date.now(), { membersOnly: true }), entry('a', Date.now())] })
    assert.deepEqual(shown, [])
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('n', Date.now(), { membersOnly: true }), entry('m', Date.now(), { membersOnly: true }), entry('a', Date.now())] })
    assert.deepEqual(shown.map(notification => notification.body), ['Title n'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('post text decodes named and numeric entities', () => {
  const [post] = normalizeUploadEntries([{ postId: 'p', postText: 'a&nbsp;b &#39;c&#x27; &AMP; &unknown; &#99999999;' }])
  assert.equal(post.title, "a\u00A0b 'c' & &unknown; &#99999999;")
})

test('withheld members-first uploads notify once they become public', () => {
  const state = createUploadNotificationState()
  const ids = uploads => uploads.map(upload => upload.id)
  takeVisibleUploads(state, 'UC1', 'videos', [entry('a', NOW)], false, NOW)
  assert.deepEqual(ids(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW, { membersOnly: true }), entry('a', NOW)], false, NOW)), [])
  assert.deepEqual(ids(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW), entry('a', NOW)], false, NOW + 8 * 24 * HOUR)), ['m'])
  assert.deepEqual(ids(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW), entry('a', NOW)], false, NOW)), [])
})

test('turning a feed off also forgets its withheld members-only uploads', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const shown = []
    const notifier = createUploadNotifier({ file: path.join(directory, 'state.json'), show: notification => shown.push(notification) })
    const configure = feedTypes => notifier.configure({
      enabled: true,
      titles: { videos: '{channel}' },
      channels: {
        UC1: { name: 'One', feedTypes, membersOnly: false },
        UC2: { name: 'Two', feedTypes: ['videos'], membersOnly: false }
      }
    })
    await configure(['videos'])
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a', Date.now())] })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('m', Date.now(), { membersOnly: true }), entry('a', Date.now())] })
    await configure([])
    await configure(['videos'])
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('m', Date.now()), entry('a', Date.now())] })
    assert.deepEqual(shown, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('withheld uploads are released when they turn public in another feed of the channel', () => {
  const state = createUploadNotificationState()
  takeVisibleUploads(state, 'UC1', 'videos', [entry('a', NOW)], false, NOW)
  takeVisibleUploads(state, 'UC1', 'live', [entry('b', NOW)], false, NOW)
  takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW, { membersOnly: true }), entry('a', NOW)], false, NOW)
  assert.deepEqual(takeVisibleUploads(state, 'UC1', 'live', [entry('m', NOW), entry('b', NOW)], false, NOW).map(upload => upload.id), ['m'])
})

test('a failed save keeps detected uploads for the next refresh', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const file = path.join(directory, 'state.json')
    const shown = []
    const notifier = createUploadNotifier({ file, show: notification => shown.push(notification) })
    await notifier.configure({ enabled: true, titles: { videos: '{channel}' }, channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } } })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a', Date.now())] })
    const saved = await readFile(file, 'utf8')
    await rm(file)
    // A directory in place of the file makes the rename fail.
    await mkdir(file)
    const feed = [entry('b', Date.now()), entry('a', Date.now())]
    await assert.rejects(notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: feed }))
    await rm(file, { recursive: true })
    await writeFile(file, saved)
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: feed })
    assert.deepEqual(shown.map(notification => notification.body), ['Title b'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('withheld uploads are forgotten once members-only content is shown', () => {
  const state = createUploadNotificationState()
  takeVisibleUploads(state, 'UC1', 'videos', [entry('a', NOW)], false, NOW)
  takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW, { membersOnly: true }), entry('a', NOW)], false, NOW)
  assert.deepEqual(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW, { membersOnly: true }), entry('a', NOW)], true, NOW), [])
  assert.deepEqual(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW), entry('a', NOW)], false, NOW), [])
})

test('entries another feed of the channel already recorded are not new', () => {
  const state = createUploadNotificationState()
  takeNewUploads(state, 'UC1', 'videos', [entry('s', NOW), entry('a', NOW)], NOW)
  takeNewUploads(state, 'UC1', 'shorts', [], NOW)
  takeNewUploads(state, 'UC2', 'shorts', [], NOW)
  assert.deepEqual(takeNewUploads(state, 'UC1', 'shorts', [entry('s', NOW)], NOW), [])
  assert.deepEqual(takeNewUploads(state, 'UC2', 'shorts', [entry('s', NOW)], NOW).map(upload => upload.id), ['s'])
})
