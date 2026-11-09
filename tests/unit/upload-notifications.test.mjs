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
import vm from 'node:vm'

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
      thumbnailUrl: 'https://i.ytimg.com/vi/{id}/mqdefault.jpg',
      titles: { videos: 'New video from {channel}', live: '{channel} is live' },
      channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } }
    })
    await restarted.observe({
      channelId: 'UC1',
      feedType: 'videos',
      entries: [entry('m', NOW, { membersOnly: true }), entry('l', Date.now(), { live: true }), entry('b', Date.now()), entry('a')]
    })
    assert.deepEqual(shown, [
      { title: 'One is live', body: 'Title l', url: 'https://www.youtube.com/watch?v=l', silent: false, target: { kind: 'live', path: '/watch/l' }, thumbnail: 'https://i.ytimg.com/vi/l/mqdefault.jpg' },
      { title: 'New video from One', body: 'Title b', url: 'https://www.youtube.com/watch?v=b', silent: false, target: { kind: 'video', path: '/watch/b' }, thumbnail: 'https://i.ytimg.com/vi/b/mqdefault.jpg' }
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

test('the desktop notifier shows original video titles when untranslated text is preferred', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const shown = []
    const requested = []
    const notifier = createUploadNotifier({
      file: path.join(directory, 'state.json'),
      show: notification => shown.push(notification),
      fetch: async (url, init) => {
        const videoId = new URL(new URL(url).searchParams.get('url')).searchParams.get('v')
        assert.equal(init.credentials, 'omit')
        requested.push(videoId)
        if (videoId === 'missing') return new Response('Not Found', { status: 404 })
        return Response.json({ title: `Original ${videoId}` })
      }
    })
    const configure = originalTitles => notifier.configure(createUploadNotificationConfiguration({
      enabled: true,
      subscriptions: [{ id: 'UC1', name: 'One', feedTypes: ['videos', 'posts'], notificationFeedTypes: ['videos', 'posts'] }],
      showMembersOnly: false,
      titles: { videos: '{channel}', posts: '{channel}' },
      originalTitles
    }))
    await configure(true)
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a')] })
    await notifier.observe({ channelId: 'UC1', feedType: 'posts', entries: [entry('p')] })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('missing', Date.now()), entry('b', Date.now()), entry('a')] })
    await notifier.observe({ channelId: 'UC1', feedType: 'posts', entries: [entry('q', Date.now()), entry('p')] })
    await configure(false)
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('c', Date.now()), entry('missing', Date.now()), entry('b', Date.now()), entry('a')] })

    assert.deepEqual(shown.map(notification => notification.body), ['Title missing', 'Original b', 'Title q', 'Title c'])
    assert.deepEqual(requested, ['missing', 'b'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the desktop notifier drops notifications turned off during the original title lookup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const shown = []
    let requested
    const lookup = new Promise(resolve => { requested = resolve })
    let respond
    const notifier = createUploadNotifier({
      file: path.join(directory, 'state.json'),
      show: notification => shown.push(notification),
      fetch: () => {
        requested()
        return new Promise(resolve => { respond = resolve })
      }
    })
    await notifier.configure({
      enabled: true,
      originalTitles: true,
      titles: { videos: '{channel}' },
      channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } }
    })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a')] })
    const observed = notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('b', Date.now()), entry('a')] })
    await lookup
    await notifier.configure({ enabled: false })
    respond(Response.json({ title: 'Original b' }))
    await observed
    assert.deepEqual(shown, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the desktop notifier settles once alerts waiting for an original title are shown', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    const shown = []
    const responders = []
    let requested
    const nextLookup = () => new Promise(resolve => { requested = resolve })
    let lookup = nextLookup()
    const notifier = createUploadNotifier({
      file: path.join(directory, 'state.json'),
      show: notification => shown.push(notification.body),
      fetch: url => new Promise(resolve => {
        responders.push(() => resolve(Response.json({ title: `Original ${new URL(new URL(url).searchParams.get('url')).searchParams.get('v')}` })))
        requested()
      })
    })
    await notifier.configure({
      enabled: true,
      originalTitles: true,
      titles: { videos: '{channel}' },
      channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } }
    })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a')] })
    notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('b', Date.now()), entry('a')] })
    await lookup
    // The upload is already saved as notified, so quitting now must wait for its alert.
    let settled = false
    const settling = notifier.settle().then(() => { settled = true })
    // An alert that starts while settling is waited for too.
    lookup = nextLookup()
    notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('c', Date.now()), entry('b', Date.now()), entry('a')] })
    await lookup
    responders.shift()()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false)
    responders.shift()()
    await settling
    assert.deepEqual(shown, ['Original b', 'Original c'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('withheld members-first uploads notify once they become public', () => {
  const state = createUploadNotificationState()
  const ids = uploads => uploads.map(upload => upload.id)
  takeVisibleUploads(state, 'UC1', 'videos', [entry('a', NOW)], false, NOW)
  assert.deepEqual(ids(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW, { membersOnly: true }), entry('a', NOW)], false, NOW)), [])
  assert.deepEqual(ids(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW), entry('a', NOW)], false, NOW + 8 * 24 * HOUR)), ['m'])
  assert.deepEqual(ids(takeVisibleUploads(state, 'UC1', 'videos', [entry('m', NOW), entry('a', NOW)], false, NOW)), [])
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

test('entries another feed of the channel already recorded are not new', () => {
  const state = createUploadNotificationState()
  takeNewUploads(state, 'UC1', 'videos', [entry('s', NOW), entry('a', NOW)], NOW)
  takeNewUploads(state, 'UC1', 'shorts', [], NOW)
  takeNewUploads(state, 'UC2', 'shorts', [], NOW)
  assert.deepEqual(takeNewUploads(state, 'UC1', 'shorts', [entry('s', NOW)], NOW), [])
  assert.deepEqual(takeNewUploads(state, 'UC2', 'shorts', [entry('s', NOW)], NOW).map(upload => upload.id), ['s'])
})

test('the renderer reports only feeds with notifications turned on', async () => {
  const source = await readFile(new URL('../../src/renderer/helpers/uploadNotifications.js', import.meta.url), 'utf8')
  const reported = []
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: true } },
    store: { getters: { getEnableUploadNotifications: true } },
    normalizeUploadEntries,
    window: {
      ftElectron: {
        subscriptionAutoRefresh: {
          configureUploadNotifications: async () => {},
          observeUploads: async value => { reported.push(`${value.channelId}/${value.feedType}`) }
        }
      }
    },
    console
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/^export /gm, ''), context)
  context.reportSubscriptionUploads('UCa', 'videos', [])
  await context.configureUploadNotifications({ enabled: true, channels: { UCa: { feedTypes: ['videos'] } } })
  context.reportSubscriptionUploads('UCa', 'videos', [])
  context.reportSubscriptionUploads('UCa', 'shorts', [])
  context.reportSubscriptionUploads('UCb', 'videos', [])
  await context.configureUploadNotifications({ enabled: false })
  context.reportSubscriptionUploads('UCa', 'videos', [])
  assert.deepEqual(reported, ['UCa/videos'])
})

test('refreshes of another profile also fetch channels with notifications turned on', async () => {
  const source = await readFile(new URL('../../src/renderer/helpers/uploadNotifications.js', import.meta.url), 'utf8')
  const alpha = { id: 'UCa' }
  const beta = { id: 'UCb' }
  const gamma = { id: 'UCc' }
  const context = vm.createContext({
    process: { env: { IS_ELECTRON: true } },
    store: { getters: { getEnableUploadNotifications: true, getProfileList: [{ subscriptions: [alpha, beta, gamma] }] } },
    window: { ftElectron: { subscriptionAutoRefresh: { configureUploadNotifications: async () => {} } } },
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/^export /gm, ''), context)
  const fetched = (subscriptions, feedType) => Array.from(context.includeNotificationChannels(subscriptions, feedType), channel => channel.id)
  assert.deepEqual(fetched([alpha], 'videos'), ['UCa'])
  await context.configureUploadNotifications({ enabled: true, channels: { UCa: { feedTypes: ['videos'] }, UCb: { feedTypes: ['videos'] }, UCc: { feedTypes: ['posts'] } } })
  assert.deepEqual(fetched([alpha], 'videos'), ['UCa', 'UCb'])
  assert.deepEqual(fetched([], 'posts'), ['UCc'])
  context.store.getters.getEnableUploadNotifications = false
  assert.deepEqual(fetched([alpha], 'videos'), ['UCa'])
})

test('settling waits for notifications that are still being delivered', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upload-notifications-'))
  try {
    let delivered = false
    const notifier = createUploadNotifier({
      file: path.join(directory, 'state.json'),
      // Delivery can wait for a history write and a thumbnail.
      show: () => new Promise(resolve => setTimeout(() => { delivered = true; resolve() }, 50))
    })
    await notifier.configure({ enabled: true, titles: { videos: '{channel}' }, channels: { UC1: { name: 'One', feedTypes: ['videos'], membersOnly: false } } })
    await notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('a')] })
    notifier.observe({ channelId: 'UC1', feedType: 'videos', entries: [entry('b', Date.now()), entry('a')] })
    await notifier.settle()
    assert.equal(delivered, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
