import assert from 'node:assert/strict'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import * as secretSettings from '../../src/datastores/secretSettings.js'
import { getSecretCipher } from '../../src/datastores/secretCipher.js'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { toRaw } from 'vue'
import * as seenSync from '../../src/renderer/helpers/subscription-seen-videos.js'
import * as seenData from '../../src/subscriptionSeenVideos.js'
import * as postData from '../../src/subscriptionSeenPosts.js'
import * as feedState from '../../src/subscriptionFeedState.js'
import * as historyHelpers from '../../src/history.js'
import { EncryptedSyncAdapter, createEmptySyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import * as seenMarkSettings from '../../src/subscriptionSeenMarkSettings.js'

const source = await readFile(new URL('../../src/renderer/store/modules/subscription-cache.js', import.meta.url), 'utf8')
const seenVideos = { ...seenSync, ...seenData, ...postData }

test('marking a community post as seen records a durable mark for sync', async () => {
  const fixture = cacheFixture()
  await fixture.actions.markSubscriptionPostAsSeen(fixture.context, 'post')
  assert.equal(fixture.recorded.length, 1)
  assert.equal(fixture.recorded[0][0], 'mergeSubscriptionSeenPosts')
  assert.deepEqual(fixture.recorded[0][1], { posts: [{ postId: 'post' }] })
})

test('two devices merge persisted post marks without changing video marks or watch history', async () => {
  const document = createEmptySyncDocument()
  document.history = [{ video: { id: 'attached-video' }, metadata: { position_millis: 42000 } }]
  document.seenVideos = [{ videoId: 'first', seenAt: 500 }]
  const client = new EncryptedSyncAdapter(document)
  const device = async postId => {
    const { Settings } = await settingsFixture()
    return {
      state: { settings: { subscriptionSeenPosts: await Settings.mergeSeenPosts({ posts: [{ postId }] }) } },
      async dispatch(action, remote) {
        assert.equal(action, 'mergeSubscriptionSeenPosts')
        this.state.settings.subscriptionSeenPosts = await Settings.mergeSeenPosts(remote)
      },
    }
  }
  const first = await device('first')
  const second = await device('second')
  await seenSync.syncSubscriptionSeenPosts(client, first)
  await seenSync.syncSubscriptionSeenPosts(client, second)
  await seenSync.syncSubscriptionSeenPosts(client, first)
  assert.equal(first.state.settings.subscriptionSeenPosts, second.state.settings.subscriptionSeenPosts)
  assert.deepEqual(document.seenPosts.map(entry => entry.postId), ['first', 'second'])
  assert.deepEqual(document.seenVideos, [{ videoId: 'first', seenAt: 500 }])
  assert.deepEqual(document.history, [{ video: { id: 'attached-video' }, metadata: { position_millis: 42000 } }])
  const post = {
    postId: 'first',
    isNewInSubscriptionFeed: true,
    postContent: { type: 'video', content: { videoId: 'attached-video', isNewInSubscriptionFeed: true } }
  }
  const cache = { channel: { posts: [post, { postId: 'unseen', isNewInSubscriptionFeed: true }] } }
  const filtered = seenSync.applySubscriptionSeenPostsToCache(cache, second.state.settings.subscriptionSeenPosts)
  assert.deepEqual(filtered.channel.posts.map(entry => entry.isNewInSubscriptionFeed), [false, true])
  assert.equal(filtered.channel.posts[0].postContent.content.isNewInSubscriptionFeed, true)
})

test('post marks ignore malformed data, merge deterministically, and retain the newest 10,000', () => {
  assert.deepEqual(postData.mergeSubscriptionSeenPosts('invalid', [null, {}, { postId: 'post', seenAt: 'bad' },
    { postId: 'post', seenAt: 1000 }]), [{ postId: 'post', seenAt: 1000 }])
  const marks = Array.from({ length: 10002 }, (_, index) => ({ postId: `post-${index}`, seenAt: index + 1 }))
  const merged = postData.mergeSubscriptionSeenPosts(marks, [])
  assert.equal(merged.length, 10000)
  assert.ok(!merged.some(entry => ['post-0', 'post-1'].includes(entry.postId)))
  const ties = marks.map(entry => ({ ...entry, seenAt: 1000 }))
  assert.deepEqual(postData.mergeSubscriptionSeenPosts(ties, []),
    postData.mergeSubscriptionSeenPosts([], ties.toReversed()))
})

test('malformed local post marks do not discard valid dismissals', async () => {
  const { Settings } = await settingsFixture()
  const result = await Settings.mergeSeenPosts({ posts: [null, {}, { postId: 'valid' }] })
  assert.deepEqual(JSON.parse(result).map(entry => entry.postId), ['valid'])
})

test('concurrent post marks persist together and delayed window replies retain newer marks', async () => {
  const { Settings } = await settingsFixture()
  const [older, latest] = await Promise.all([
    Settings.mergeSeenPosts({ posts: [{ postId: 'first' }] }),
    Settings.mergeSeenPosts({ posts: [{ postId: 'second' }] }),
  ])
  assert.deepEqual(JSON.parse(latest).map(entry => entry.postId), ['first', 'second'])
  const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const context = vm.createContext({ ...seenVideos, ANDROID_PROXY_SETTING_KEYS: [] })
  vm.runInContext(source.slice(source.indexOf('const customActions ='), source.indexOf('  saveSyncSettingEdit:')) +
    '\n}\nglobalThis.actions = customActions', context)
  const state = { subscriptionSeenPosts: latest }
  context.actions.applySubscriptionSeenPosts({ state, commit(type, value) { state.subscriptionSeenPosts = value } }, older)
  assert.equal(state.subscriptionSeenPosts, latest)
})

test('failed post persistence prevents a stale sync upload', async () => {
  const failure = new Error('Post persistence failed')
  let uploads = 0
  await assert.rejects(seenSync.syncSubscriptionSeenPosts({
    getSeenPosts: async () => [], putSeenPosts: async () => { uploads++ },
  }, { dispatch: async () => { throw failure } }), failure)
  assert.equal(uploads, 0)
})

test('mark all still dismisses displayed videos when a refresh wins the cache write race', async () => {
  const fixture = cacheFixture(false)
  fixture.context.rootGetters = { getSubscriptionSeenVideos: [] }
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: ['videos', 'shorts', 'live'], channelIds: ['channel'],
  })
  assert.equal(fixture.recorded.length, 1, 'The explicit seen action must survive a newer cache timestamp')
})

test('mark all limits cache and durable marks to IDs captured before an animation', async () => {
  const fixture = cacheFixture()
  fixture.context.rootGetters = { getSubscriptionSeenVideos: [], getSubscriptionSeenPosts: [] }
  const entriesByTab = {}
  for (const [tab, cacheKey, field, idKey] of [
    ['videos', 'videoCache', 'videos', 'videoId'],
    ['shorts', 'shortsCache', 'videos', 'videoId'],
    ['live', 'liveCache', 'videos', 'videoId'],
    ['posts', 'postsCache', 'posts', 'postId'],
  ]) {
    const entries = fixture.state[cacheKey].channel[field]
    entriesByTab[tab] = entries.map(entry => tab === 'posts'
      ? { postId: entry.postId }
      : { videoId: entry.videoId, isMembersOnly: entry.isMembersOnly === true })
    entries.push({ [idKey]: `arrived-${tab}`, isNewInSubscriptionFeed: true })
  }
  const writes = []
  fixture.handlers.markEntriesAsSeenMany = async marks => {
    for (const { channelId, tab, entries } of marks) writes.push([channelId, tab, structuredClone(entries)])
  }
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: Object.keys(entriesByTab), channelIds: ['channel'], entriesByTab,
  })
  assert.equal(writes.length, 4)
  for (const [channelId, tab, entries] of writes) {
    assert.equal(channelId, 'channel')
    assert.deepEqual(entries.map(entry => entry.videoId ?? entry.postId),
      entriesByTab[tab].map(entry => entry.videoId ?? entry.postId))
  }
  for (const cacheKey of ['videoCache', 'shortsCache', 'liveCache', 'postsCache']) {
    const cache = fixture.state[cacheKey].channel
    assert.deepEqual((cache.videos ?? cache.posts).map(entry => entry.isNewInSubscriptionFeed), [false, true])
  }
  assert.deepEqual(fixture.recorded, [
    ['mergeSubscriptionSeenVideos', {
      videos: [
        { videoId: 'videoCache', isMembersOnly: false },
        { videoId: 'shortsCache', isMembersOnly: false },
        { videoId: 'liveCache', isMembersOnly: false },
      ]
    }],
    ['mergeSubscriptionSeenPosts', { posts: [{ postId: 'post' }] }],
  ])
})

test('mark all leaves newly public uploads new when their captured membership changes', async () => {
  const fixture = cacheFixture()
  fixture.context.rootGetters = { getSubscriptionSeenVideos: [] }
  const entriesByTab = {}
  for (const [tab, cacheKey] of [['videos', 'videoCache'], ['shorts', 'shortsCache'], ['live', 'liveCache']]) {
    entriesByTab[tab] = [{ videoId: cacheKey, isMembersOnly: true }]
    fixture.state[cacheKey].channel.videos[0].isMembersOnly = false
  }
  let writes = 0
  fixture.handlers.markEntriesAsSeenMany = async marks => { writes += marks.length }
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: Object.keys(entriesByTab), channelIds: ['channel'], entriesByTab,
  })
  assert.equal(writes, 0)
  assert.deepEqual(fixture.recorded, [])
  for (const cacheKey of ['videoCache', 'shortsCache', 'liveCache']) {
    assert.equal(fixture.state[cacheKey].channel.videos[0].isNewInSubscriptionFeed, true)
  }
})

async function savedVideoMarks(db) {
  const saved = await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
  return JSON.parse(saved?.value ?? '[]').sort((a, b) => a.videoId.localeCompare(b.videoId))
}

async function settingsFixture(history = []) {
  const baseSource = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
  const db = {
    settings: new Datastore({ inMemoryOnly: true }),
    history: new Datastore({ inMemoryOnly: true }),
  }
  if (history.length > 0) await db.history.insertAsync(history)
  const { Settings, History } = vm.runInNewContext(baseSource.slice(baseSource.indexOf('class Settings {'),
    baseSource.indexOf('\nclass WatchStats {')) + '\n({ Settings, History })', { db, ...seenVideos, ...seenMarkSettings, ...historyHelpers, ...secretSettings, getSecretCipher, migrateStoredSettings })
  // The saved marks after a merge, by video ID
  const mergeVideos = async update => {
    await Settings.mergeSeenVideos(update)
    return savedVideoMarks(db)
  }
  return { db, Settings, History, mergeVideos }
}

function cacheFixture(applied = true, logger = console) {
  const recorded = []
  const context = vm.createContext({
    console: logger,
    toRaw,
    ...seenVideos,
    ...feedState,
    withDataScope: (_scope, operation) => operation(),
    DBSubscriptionCacheHandlers: {
      markEntriesAsSeenMany: async () => {},
      updateVideosByChannelId: async () => applied,
      updateShortsByChannelId: async () => applied,
      updateLiveStreamsByChannelId: async () => applied,
      updateCommunityPostsByChannelId: async () => applied,
    },
  })
  vm.runInContext(source.replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'globalThis.module ='), context)
  const { state, actions, mutations } = context.module
  for (const cache of ['videoCache', 'shortsCache', 'liveCache']) {
    state[cache].channel = {
      videos: [{ videoId: cache, isNewInSubscriptionFeed: true }],
      timestamp: new Date(1000),
    }
  }
  state.postsCache.channel = {
    posts: [{ postId: 'post', isNewInSubscriptionFeed: true }],
    timestamp: new Date(1000),
  }
  return {
    state,
    actions,
    getters: context.module.getters,
    recorded,
    handlers: context.DBSubscriptionCacheHandlers,
    context: {
      state,
      commit: (type, payload) => mutations[type](state, payload),
      dispatch: async (type, payload) => recorded.push([type, structuredClone(payload)]),
    },
  }
}

test('marking a subscription video as seen records it for history sync without watch history', async () => {
  const fixture = cacheFixture()
  await fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache')
  assert.equal(fixture.recorded.length, 1)
  assert.equal(fixture.recorded[0][0], 'mergeSubscriptionSeenVideos')
  const { mergeVideos } = await settingsFixture()
  const marks = await mergeVideos(fixture.recorded[0][1])
  assert.equal(marks[0].videoId, 'videoCache')
  assert.ok(Number.isFinite(marks[0].seenAt))
})

test('failed seen writes do not record seen videos', async () => {
  const fixture = cacheFixture(true, { error() {} })
  fixture.handlers.markEntriesAsSeenMany = async () => { throw new Error('Disk failure') }
  await fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache')
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: ['videos', 'shorts', 'live'], channelIds: ['channel'],
  })
  assert.deepEqual(fixture.recorded, [])
})

test('encrypted sync merges marks from two devices without changing history', async () => {
  const document = createEmptySyncDocument()
  document.history = [{ video: { id: 'watched' }, metadata: { position_millis: 42000 } }]
  const client = new EncryptedSyncAdapter(document)
  const device = entries => ({
    state: { settings: { subscriptionSeenVideos: JSON.stringify(entries) } },
    async dispatch(action, remote) {
      assert.equal(action, 'mergeSubscriptionSeenVideos')
      this.state.settings.subscriptionSeenVideos = JSON.stringify(seenVideos.mergeSubscriptionSeenVideos(
        this.state.settings.subscriptionSeenVideos, remote
      ))
    },
  })
  const first = device([{ videoId: 'first', seenAt: 1000 }])
  const second = device([{ videoId: 'second', seenAt: 2000 }])
  await seenVideos.syncSubscriptionSeenVideos(client, first)
  await seenVideos.syncSubscriptionSeenVideos(client, second)
  await seenVideos.syncSubscriptionSeenVideos(client, first)
  assert.equal(first.state.settings.subscriptionSeenVideos, second.state.settings.subscriptionSeenVideos)
  assert.deepEqual(document.seenVideos.map(entry => entry.videoId), ['first', 'second'])
  assert.deepEqual(document.history, [{ video: { id: 'watched' }, metadata: { position_millis: 42000 } }])
})

test('downloaded marks hide current and subsequently fetched videos in every video cache', () => {
  const fixture = cacheFixture()
  const marks = JSON.stringify(['videoCache', 'shortsCache', 'liveCache', 'later'].map(videoId => ({ videoId, seenAt: 1000 })))
  for (const getter of ['getVideoCache', 'getShortsCache', 'getLiveCache']) {
    const cache = fixture.getters[getter](fixture.state, { getSubscriptionSeenVideos: marks })
    assert.equal(cache.channel.videos[0].isNewInSubscriptionFeed, false)
  }
  fixture.state.videoCache.channel.videos = [{ videoId: 'later', isNewInSubscriptionFeed: true }]
  assert.equal(fixture.getters.getVideoCache(fixture.state, { getSubscriptionSeenVideos: marks })
    .channel.videos[0].isNewInSubscriptionFeed, false)
  assert.equal(fixture.state.postsCache.channel.posts[0].isNewInSubscriptionFeed, true)
})

test('members-only videos can become new when public, then be marked seen again', () => {
  const cache = { channel: { videos: [{ videoId: 'video', isMembersOnly: false, isNewInSubscriptionFeed: true }] } }
  const oldMark = [{ videoId: 'video', seenAt: 1000, isMembersOnly: true }]
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, oldMark).channel.videos[0].isNewInSubscriptionFeed, true)
  const merged = seenVideos.mergeSubscriptionSeenVideos([{ videoId: 'video', seenAt: 2000 }], oldMark)
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, merged).channel.videos[0].isNewInSubscriptionFeed, false)
})

test('a later mark from a stale members-only feed cannot make a seen public video new again', () => {
  const publicMark = [{ videoId: 'video', seenAt: 1000, isMembersOnly: false }]
  const staleMembersMark = [{ videoId: 'video', seenAt: 2000, isMembersOnly: true }]
  const cache = { channel: { videos: [{ videoId: 'video', isMembersOnly: false, isNewInSubscriptionFeed: true }] } }
  for (const [local, remote] of [[publicMark, staleMembersMark], [staleMembersMark, publicMark]]) {
    const merged = seenVideos.mergeSubscriptionSeenVideos(local, remote)
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, merged).channel.videos[0].isNewInSubscriptionFeed, false)
    assert.deepEqual(merged, [{ videoId: 'video', seenAt: 2000, isMembersOnly: false }])
  }
})

test('malformed records cannot replace valid marks', () => {
  assert.deepEqual(seenVideos.mergeSubscriptionSeenVideos('invalid', [
    null, {}, { videoId: 'video', seenAt: 'bad' }, { videoId: 'video', seenAt: 1000 },
  ]), [{ videoId: 'video', seenAt: 1000, isMembersOnly: false }])
})

test('two windows persist both marks and delayed replies cannot overwrite newer marks', async () => {
  const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const { db, Settings } = await settingsFixture()
  let releaseReply
  const delayedReply = new Promise(resolve => { releaseReply = resolve })
  const windows = []
  const makeWindow = (delayReply = false) => {
    const window = {}
    const context = vm.createContext({
      ...seenVideos,
      ANDROID_PROXY_SETTING_KEYS: [],
      getDataScope: () => null,
      DBSettingHandlers: {
        async mergeSeenVideos(entries) {
          const changes = await Settings.mergeSeenVideos(entries)
          // The main process sends the changes to the other windows before it replies.
          for (const other of windows) if (other !== window) other.receive(structuredClone(changes))
          if (delayReply) await delayedReply
          return changes
        },
      },
    })
    vm.runInContext(settingsSource.slice(
      settingsSource.indexOf('const customActions ='),
      settingsSource.indexOf('  saveSyncSettingEdit:'),
    ) + '\n}\nglobalThis.actions = customActions', context)
    const state = { subscriptionSeenVideos: seenVideos.subscriptionSeenVideosState('[]') }
    const actionContext = {
      state,
      commit(type, changes) {
        assert.equal(type, 'applySubscriptionSeenVideoChanges')
        state.subscriptionSeenVideos = seenVideos.withSubscriptionSeenVideoChanges(state.subscriptionSeenVideos, changes)
      },
      dispatch: (type, value) => context.actions[type](actionContext, value),
    }
    Object.assign(window, {
      shown: () => [...state.subscriptionSeenVideos.byId.values()].sort((a, b) => a.videoId.localeCompare(b.videoId)),
      mark: entry => actionContext.dispatch('mergeSubscriptionSeenVideos', [entry]),
      receive: changes => actionContext.commit('applySubscriptionSeenVideoChanges', changes),
    })
    windows.push(window)
    return window
  }
  const first = makeWindow(true)
  const second = makeWindow()
  const firstMark = first.mark({ videoId: 'first', seenAt: 1000 })
  await second.mark({ videoId: 'second', seenAt: 2000 })
  const saved = await savedVideoMarks(db)
  assert.deepEqual(saved.map(entry => entry.videoId), ['first', 'second'])
  // The second write's changes reached the first window before its own older
  // IPC reply. Applying that reply must retain the second mark.
  assert.deepEqual(first.shown().map(entry => entry.videoId), ['second'])
  releaseReply()
  await firstMark
  assert.deepEqual(first.shown(), saved)
  assert.deepEqual(second.shown(), saved)
})

test('windows end with the same marks whatever order changes arrive in', () => {
  const kept = { videoId: 'kept', seenAt: 1000, isMembersOnly: false }
  const dropped = { videoId: 'video', seenAt: 1000, isMembersOnly: false }
  const remarked = { videoId: 'video', seenAt: 3000, isMembersOnly: false }
  // A merge drops a mark as its video was watched, and a later one marks it again.
  const changes = [
    { upserts: [kept, dropped], removals: [] },
    { upserts: [], removals: [dropped] },
    { upserts: [remarked], removals: [] },
  ]
  const shown = []
  for (const order of [[0, 1, 2], [0, 2, 1], [2, 1, 0], [1, 2, 0], [0, 1, 2, 1, 0]]) {
    const byId = new Map()
    for (const index of order) seenVideos.applySubscriptionSeenVideoChanges(byId, structuredClone(changes[index]))
    shown.push([...byId.values()].sort((a, b) => a.videoId.localeCompare(b.videoId)))
  }
  for (const marks of shown) assert.deepEqual(marks, [kept, remarked])
})

test('mark all records videos, Shorts, live streams and community posts', async () => {
  const fixture = cacheFixture()
  await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
    tabs: ['videos', 'shorts', 'live', 'posts'], channelIds: ['channel'],
  })
  assert.equal(fixture.recorded.length, 2)
  assert.deepEqual(fixture.recorded[1], ['mergeSubscriptionSeenPosts', { posts: [{ postId: 'post' }] }])
  assert.equal(fixture.recorded[0][0], 'mergeSubscriptionSeenVideos')
  assert.deepEqual(fixture.recorded[0][1].videos.map(entry => entry.videoId).sort(),
    ['liveCache', 'shortsCache', 'videoCache'])
})

test('seen mark retention keeps the newest 10,000 videos with deterministic timestamp ties', () => {
  const marks = Array.from({ length: 10002 }, (_, index) => ({
    videoId: `video-${String(index).padStart(5, '0')}`,
    seenAt: Math.max(1, index),
  }))
  const merged = seenVideos.mergeSubscriptionSeenVideos(marks.slice(0, 5000), marks.slice(5000))
  assert.equal(merged.length, 10000)
  assert.equal(merged[0].videoId, 'video-00002')
  assert.equal(merged.at(-1).videoId, 'video-10001')
  const tied = marks.map(mark => ({ ...mark, seenAt: 1000 }))
  assert.deepEqual(seenVideos.mergeSubscriptionSeenVideos(tied, []),
    seenVideos.mergeSubscriptionSeenVideos([], tied.toReversed()))
  assert.equal(seenVideos.mergeSubscriptionSeenVideos(tied, []).length, 10000)
})

test('watched marks are removed before applying the cap while partial and live entries remain', () => {
  const marks = Array.from({ length: 10000 }, (_, index) => ({ videoId: `watched-${index}`, seenAt: 2000 }))
  const history = Object.fromEntries(marks.map(mark => [mark.videoId, { isWatched: true }]))
  const retained = ['unwatched', 'partial', 'live', 'upcoming']
    .map(videoId => ({ videoId, seenAt: 1000 }))
  Object.assign(history, {
    partial: { isWatched: false, watchProgress: 90, lengthSeconds: 100 },
    live: { isWatched: true, isLive: true },
    upcoming: { isWatched: true, isUpcoming: true },
    legacyWatched: { watchProgress: 100, lengthSeconds: 100 },
  })
  const merged = seenVideos.mergeSubscriptionSeenVideos(
    [...marks, { videoId: 'legacyWatched', seenAt: 3000 }], retained, history)
  assert.deepEqual(merged.map(mark => mark.videoId), ['live', 'partial', 'unwatched', 'upcoming'])
})

test('persistence prunes watched marks from saved and stale incoming data before capping', async () => {
  const { db, Settings } = await settingsFixture([{ videoId: 'watched', isWatched: true }])
  const marks = Array.from({ length: 10001 }, (_, index) => ({ videoId: `video-${index}`, seenAt: index + 1 }))
  await db.settings.insertAsync({
    _id: 'subscriptionSeenVideos',
    value: JSON.stringify([
      ...marks, { videoId: 'watched', seenAt: 20000 },
    ])
  })
  const changes = await Settings.mergeSeenVideos([{ videoId: 'watched', seenAt: 30000 }])
  const retained = await savedVideoMarks(db)
  assert.equal(retained.length, 10000)
  assert.ok(!retained.some(mark => ['watched', 'video-0'].includes(mark.videoId)))
  assert.deepEqual(changes.removals.map(mark => mark.videoId).sort(), ['video-0', 'watched'])
  assert.deepEqual(changes.upserts, [])
})

test('sync uploads the retained local set without restoring pruned remote marks', async () => {
  const remote = [{ videoId: 'watched', seenAt: 3000 }, { videoId: 'keep', seenAt: 2000 }]
  const retained = [{ videoId: 'keep', seenAt: 2000, isMembersOnly: false }]
  const store = {
    state: { settings: { subscriptionSeenVideos: JSON.stringify(remote) } },
    async dispatch() { this.state.settings.subscriptionSeenVideos = JSON.stringify(retained) },
  }
  let uploaded
  await seenVideos.syncSubscriptionSeenVideos({
    getSeenVideos: async () => remote,
    putSeenVideos: async entries => { uploaded = entries },
  }, store)
  assert.deepEqual(uploaded, retained)
})

test('cache filtering uses the same capped mark set as persistence and sync', () => {
  const marks = Array.from({ length: 10001 }, (_, index) => ({ videoId: `video-${index}`, seenAt: index + 1 }))
  const cache = {
    channel: {
      videos: [
        { videoId: 'video-0', isNewInSubscriptionFeed: true },
        { videoId: 'video-10000', isNewInSubscriptionFeed: true },
      ]
    }
  }
  const result = seenVideos.applySubscriptionSeenVideosToCache(cache, marks)
  assert.equal(result.channel.videos[0].isNewInSubscriptionFeed, true)
  assert.equal(result.channel.videos[1].isNewInSubscriptionFeed, false)
})

test('seen mark persistence uses the history index instead of scanning unrelated history', async () => {
  const { db, Settings } = await settingsFixture([
    { videoId: 'watched', isWatched: true },
    { videoId: 'unrelated', isWatched: true },
  ])
  await db.history.ensureIndexAsync({ fieldName: 'videoId' })
  db.history.getAllData = () => { throw new Error('Unexpected full-history scan') }
  const changes = await Settings.mergeSeenVideos([
    { videoId: 'watched', seenAt: 2000 }, { videoId: 'keep', seenAt: 1000 },
  ])
  assert.deepEqual(changes.upserts.map(mark => mark.videoId), ['keep'])
  assert.deepEqual((await savedVideoMarks(db)).map(mark => mark.videoId), ['keep'])
})

test('individual and bulk UI marking handle failed seen-mark persistence', async () => {
  const failure = new Error('Seen-mark persistence failed')
  const logged = []
  for (const bulk of [false, true]) {
    const fixture = cacheFixture(true, { error: error => logged.push(error) })
    fixture.context.dispatch = async () => { throw failure }
    await assert.doesNotReject(() => bulk
      ? fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, {
          tabs: ['videos', 'shorts', 'live'], channelIds: ['channel'],
        })
      : fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache'))
  }
  assert.deepEqual(logged, [failure, failure])
})

test('failed seen-mark persistence stops sync before uploading stale state', async () => {
  const failure = new Error('Seen-mark persistence failed')
  let uploads = 0
  await assert.rejects(seenVideos.syncSubscriptionSeenVideos({
    getSeenVideos: async () => [],
    putSeenVideos: async () => { uploads++ },
  }, {
    state: { settings: { subscriptionSeenVideos: '[]' } },
    dispatch: async () => { throw failure },
  }), failure)
  assert.equal(uploads, 0)
})

test('a profile switch during seen-mark sync stops it before the other profile’s marks are used', async () => {
  const switched = new Error('Switched profiles')
  for (const sync of [seenVideos.syncSubscriptionSeenVideos, seenVideos.syncSubscriptionSeenPosts]) {
    let profile = 'first'
    const dispatched = []
    let uploads = 0
    const marks = [{ videoId: 'video', postId: 'post', seenAt: 2000, unseenAt: 3000 }]
    await assert.rejects(sync({
      getSeenVideos: async () => marks,
      getSeenPosts: async () => marks,
      getWatchHistory: async () => [],
      putSeenVideos: async () => { uploads++ },
      putSeenPosts: async () => { uploads++ },
    }, {
      state: {
        settings: { subscriptionSeenVideos: JSON.stringify(marks), subscriptionSeenPosts: JSON.stringify(marks) },
        history: { historyCacheSorted: [{ videoId: 'video', timeWatched: 1000, isWatched: true }] },
      },
      dispatch: async (type) => {
        dispatched.push(type)
        profile = 'second'
      },
    }, () => { if (profile !== 'first') throw switched }), switched)
    assert.deepEqual(dispatched, [sync === seenVideos.syncSubscriptionSeenVideos ? 'mergeSubscriptionSeenVideos' : 'mergeSubscriptionSeenPosts'])
    assert.equal(uploads, 0)
  }
})

test('marking a video unseen preserves watch progress and restores a seen video', async () => {
  const fixture = cacheFixture()
  fixture.state.videoCache.channel.videos[0].isNewInSubscriptionFeed = false
  const history = { videoId: 'videoCache', isWatched: true, watchProgress: 123, lengthSeconds: 200 }
  fixture.context.rootGetters = { getHistoryCacheById: { videoCache: history }, getSubscriptionSeenVideos: [] }
  await fixture.actions.markSubscriptionVideoAsUnseen(fixture.context, 'videoCache')
  assert.equal(fixture.recorded.length, 1)
  const [action, update] = fixture.recorded[0]
  assert.equal(action, 'updateSubscriptionHistory')
  const { History } = await settingsFixture([history])
  const result = await History.updateSubscriptionState(update)
  assert.equal(result.records[0].isWatched, false)
  assert.equal(result.records[0].watchProgress, 123)
  const restored = seenVideos.applySubscriptionSeenVideosToCache(fixture.state.videoCache, result.seenVideos.upserts)
  assert.equal(restored.channel.videos[0].isNewInSubscriptionFeed, true)
})

test('unseen marks survive stale sync, cache refresh and a later mark as seen', () => {
  const cache = { channel: { videos: [{ videoId: 'video', isNewInSubscriptionFeed: false }] } }
  const old = { videoId: 'video', seenAt: 1000 }
  const unseen = { videoId: 'video', seenAt: 1000, unseenAt: 2000 }
  for (const [local, remote] of [[[old], [unseen]], [[unseen], [old]]]) {
    const marks = seenVideos.mergeSubscriptionSeenVideos(local, remote)
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, marks).channel.videos[0].isNewInSubscriptionFeed, true)
    const seen = seenVideos.mergeSubscriptionSeenVideos(marks, [{ videoId: 'video', seenAt: 3000 }])
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(cache, seen).channel.videos[0].isNewInSubscriptionFeed, false)
  }
})

for (const bulk of [false, true]) {
  test(`${bulk ? 'bulk' : 'individual'} marking handles unseen overrides on previously seen caches`, async () => {
    const fixture = cacheFixture()
    fixture.state.videoCache.channel.videos[0].isNewInSubscriptionFeed = false
    const timestamp = Date.now() + 1000
    const unseen = [{ videoId: 'videoCache', seenAt: timestamp, unseenAt: timestamp }]
    fixture.context.rootGetters = { getSubscriptionSeenVideos: unseen }
    if (bulk) {
      await fixture.actions.markSubscriptionEntriesAsSeen(fixture.context, { tab: 'videos', channelIds: ['channel'] })
    } else {
      await fixture.actions.markSubscriptionVideoAsSeen(fixture.context, 'videoCache')
    }
    assert.equal(fixture.recorded.length, 1)
    const { Settings, mergeVideos } = await settingsFixture()
    await Settings.mergeSeenVideos(unseen)
    const marks = await mergeVideos(fixture.recorded[0][1])
    assert.ok(marks[0].seenAt > timestamp)
    assert.equal(seenVideos.applySubscriptionSeenVideosToCache(fixture.state.videoCache, marks).channel.videos[0].isNewInSubscriptionFeed, false)
  })
}

test('unseen marks persist without creating history for an unwatched video', async () => {
  const fixture = cacheFixture()
  fixture.context.rootGetters = { getHistoryCacheById: {}, getSubscriptionSeenVideos: [] }
  await fixture.actions.markSubscriptionVideoAsUnseen(fixture.context, 'videoCache')
  assert.equal(fixture.recorded.length, 1)
  assert.equal(fixture.recorded[0][0], 'updateSubscriptionHistory')
  const { Settings, History, db } = await settingsFixture()
  await History.updateSubscriptionState(fixture.recorded[0][1])
  assert.equal(await db.history.countAsync({}), 0)
  const saved = await savedVideoMarks(db)
  await Settings.mergeSeenVideos([{ videoId: 'videoCache', seenAt: 1 }])
  assert.deepEqual(await savedVideoMarks(db), saved)
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache({
    channel: {
      videos: [{ videoId: 'videoCache', isNewInSubscriptionFeed: false }],
    }
  }, saved).channel.videos[0].isNewInSubscriptionFeed, true)
})

test('concurrent windows marking unseen then seen in one millisecond keep the last persisted action', async (t) => {
  t.mock.method(Date, 'now', () => 2000)
  const { db, Settings, History } = await settingsFixture()
  const first = cacheFixture()
  const second = cacheFixture()
  for (const fixture of [first, second]) {
    fixture.context.rootGetters = { getHistoryCacheById: {}, getSubscriptionSeenVideos: [] }
    fixture.context.dispatch = async (type, update) => {
      if (type === 'updateSubscriptionHistory') return History.updateSubscriptionState(update)
      assert.equal(type, 'mergeSubscriptionSeenVideos')
      return Settings.mergeSeenVideos(update)
    }
  }
  await Promise.all([
    first.actions.markSubscriptionVideoAsUnseen(first.context, 'videoCache'),
    second.actions.markSubscriptionVideoAsSeen(second.context, 'videoCache'),
  ])
  const saved = await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
  const marks = JSON.parse(saved.value)
  assert.ok(marks[0].seenAt > marks[0].unseenAt)
  assert.equal(seenVideos.applySubscriptionSeenVideosToCache(first.state.videoCache, marks)
    .channel.videos[0].isNewInSubscriptionFeed, false)
})

test('watched history does not prune reverse marks or their newer seen half', async () => {
  const unseen = { videoId: 'video', seenAt: 2000, unseenAt: 2000 }
  const laterSeen = { videoId: 'video', seenAt: 3000 }
  const history = { videoId: 'video', isWatched: true, timeWatched: 1000 }
  for (const [local, remote] of [[[unseen], [laterSeen]], [[laterSeen], [unseen]]]) {
    assert.deepEqual(seenVideos.mergeSubscriptionSeenVideos(local, remote, { video: history }), [{
      videoId: 'video', seenAt: 3000, unseenAt: 2000, isMembersOnly: false,
    }])
  }
  const { mergeVideos } = await settingsFixture([history])
  const saved = await mergeVideos([unseen])
  assert.equal(saved[0]?.unseenAt, 2000)
  assert.deepEqual(seenVideos.mergeSubscriptionSeenVideos([], [{
    videoId: 'video', seenAt: 2000, unseenAt: 'invalid',
  }], { video: history }), [])
})

for (const timeWatched of [1000, 2000]) {
  test(`unseen sync reconciles watched history at ${timeWatched} without changing progress`, async () => {
    const document = createEmptySyncDocument()
    const client = new EncryptedSyncAdapter(document)
    document.seenVideos = [{ videoId: 'video', seenAt: 2000, unseenAt: 2000 }]
    document.history = [{
      video: { id: 'video' },
      metadata: { added_date: timeWatched, watched_state: 'completed', position_millis: 123000 },
    }]
    // Model history sync running first and importing an older completed record.
    const history = { videoId: 'video', isWatched: true, timeWatched, watchProgress: 123, lengthSeconds: 200 }
    const { Settings } = await settingsFixture([history])
    const store = {
      state: {
        settings: { subscriptionSeenVideos: seenSync.subscriptionSeenVideosState('[]') },
        history: { historyCacheSorted: [history] },
      },
      async dispatch(type, value) {
        if (type === 'mergeSubscriptionSeenVideos') {
          this.state.settings.subscriptionSeenVideos = seenSync.withSubscriptionSeenVideoChanges(
            this.state.settings.subscriptionSeenVideos, await Settings.mergeSeenVideos(value))
        } else {
          assert.equal(type, 'updateHistory')
          this.state.history.historyCacheSorted = [value]
        }
      },
    }
    await seenVideos.syncSubscriptionSeenVideos(client, store)
    assert.equal(store.state.settings.subscriptionSeenVideos.byId.get('video')?.unseenAt, 2000)
    assert.equal(store.state.history.historyCacheSorted[0].isWatched, timeWatched >= 2000)
    assert.equal(store.state.history.historyCacheSorted[0].watchProgress, 123)
    assert.equal(store.state.history.historyCacheSorted[0].timeWatched, timeWatched)
    assert.equal(document.history[0].metadata.watched_state, timeWatched >= 2000 ? 'completed' : 'watching')
    assert.equal(document.history[0].metadata.position_millis, 123000)
    assert.equal(document.history[0].metadata.added_date, timeWatched)

    // A device that has not received the reverse mark can upload completed
    // history again; the persisted marker must still correct that replay.
    document.history[0].metadata.watched_state = 'completed'
    store.state.history.historyCacheSorted = [history]
    await seenVideos.syncSubscriptionSeenVideos(client, store)
    assert.equal(store.state.history.historyCacheSorted[0].isWatched, timeWatched >= 2000)
    assert.equal(document.history[0].metadata.watched_state, timeWatched >= 2000 ? 'completed' : 'watching')
  })
}

test('a later seen action prevents an old reverse mark from clearing watched history', async () => {
  const document = createEmptySyncDocument()
  const client = new EncryptedSyncAdapter(document)
  document.seenVideos = [{ videoId: 'video', seenAt: 2000, unseenAt: 2000 }]
  document.history = [{
    video: { id: 'video' },
    metadata: { added_date: 1000, watched_state: 'completed', position_millis: 123000 },
  }]
  const history = { videoId: 'video', timeWatched: 1000, isWatched: true, watchProgress: 123 }
  const store = {
    state: {
      settings: { subscriptionSeenVideos: JSON.stringify([{ videoId: 'video', seenAt: 3000 }]) },
      history: { historyCacheSorted: [history] },
    },
    async dispatch(type, value) {
      assert.equal(type, 'mergeSubscriptionSeenVideos')
      this.state.settings.subscriptionSeenVideos = JSON.stringify(seenVideos.mergeSubscriptionSeenVideos(
        this.state.settings.subscriptionSeenVideos, value, { video: history }
      ))
    },
  }
  await seenVideos.syncSubscriptionSeenVideos(client, store)
  assert.equal(store.state.history.historyCacheSorted[0].isWatched, true)
  assert.equal(store.state.history.historyCacheSorted[0].watchProgress, 123)
  assert.equal(document.history[0].metadata.watched_state, 'completed')
  assert.equal(document.history[0].metadata.position_millis, 123000)
  assert.equal(document.seenVideos[0].seenAt, 3000)
  assert.equal(document.seenVideos[0].unseenAt, 2000)
})

test('marking one video seen reads history for that video only until the list is full', async () => {
  const marks = count => Array.from({ length: count }, (_, index) => ({ videoId: `stored-${index}`, seenAt: 1000 + index }))
  for (const [stored, expected] of [[300, 1], [seenData.MAX_SUBSCRIPTION_SEEN_VIDEOS, seenData.MAX_SUBSCRIPTION_SEEN_VIDEOS + 1]]) {
    const { db, Settings } = await settingsFixture()
    await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify(marks(stored)) })
    let queried = 0
    const find = db.history.findAsync.bind(db.history)
    db.history.findAsync = (query, projection) => {
      queried += query.videoId.$in.length
      return find(query, projection)
    }
    await Settings.mergeSeenVideos({ videos: [{ videoId: 'clicked' }] })
    assert.equal(queried, expected)
    assert.ok(JSON.parse(await db.settings.findOneAsync({ _id: 'subscriptionSeenVideos' }).then(saved => saved.value))
      .some(entry => entry.videoId === 'clicked'))
  }
})

test('merges parse the saved list once and report only the marks they change', async () => {
  const { db, Settings } = await settingsFixture()
  const stored = Array.from({ length: 5000 }, (_, index) => ({ videoId: `stored-${index}`, seenAt: 1000 + index, isMembersOnly: false }))
  await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify(stored) })
  let indexed = 0
  const index = Settings._savedSeenVideos
  Settings._savedSeenVideos = async function (_id) {
    const before = this.seenVideosCache.get(_id)
    const marks = await index.call(this, _id)
    if (marks !== before) indexed++
    return marks
  }
  for (let mark = 0; mark < 3; mark++) {
    const changes = await Settings.mergeSeenVideos({ videos: [{ videoId: `clicked-${mark}` }] })
    assert.deepEqual(changes.upserts.map(entry => entry.videoId), [`clicked-${mark}`])
    assert.deepEqual(changes.removals, [])
  }
  // Marking a video seen again changes nothing, so nothing is saved or sent.
  db.settings.updateAsync = () => { throw new Error('Unexpected seen-mark write') }
  assert.deepEqual(await Settings.mergeSeenVideos([{ videoId: 'stored-0', seenAt: 1000 }]), { upserts: [], removals: [] })
  assert.equal(indexed, 1)
  const saved = await savedVideoMarks(db)
  assert.equal(saved.length, 5003)
  assert.deepEqual(saved.filter(entry => entry.videoId.startsWith('clicked-')).map(entry => entry.videoId),
    ['clicked-0', 'clicked-1', 'clicked-2'])
})

test('merges read the saved list again after another write or a failed save', async () => {
  const { db, Settings } = await settingsFixture()
  await Settings.mergeSeenVideos([{ videoId: 'first', seenAt: 1000 }])
  // Another write, such as an older version's, replaces the saved list.
  await db.settings.updateAsync({ _id: 'subscriptionSeenVideos' },
    { $set: { value: JSON.stringify([{ videoId: 'elsewhere', seenAt: 1500 }]) } })
  await Settings.mergeSeenVideos([{ videoId: 'second', seenAt: 2000 }])
  assert.deepEqual((await savedVideoMarks(db)).map(entry => entry.videoId), ['elsewhere', 'second'])

  const update = db.settings.updateAsync.bind(db.settings)
  db.settings.updateAsync = async () => { throw new Error('Disk full') }
  await assert.rejects(Settings.mergeSeenVideos([{ videoId: 'failed', seenAt: 3000 }]), /Disk full/)
  db.settings.updateAsync = update
  const changes = await Settings.mergeSeenVideos([{ videoId: 'third', seenAt: 4000 }])
  assert.deepEqual(changes.upserts.map(entry => entry.videoId), ['third'])
  assert.deepEqual((await savedVideoMarks(db)).map(entry => entry.videoId), ['elsewhere', 'second', 'third'])
})

test('changes of a merge at the cap evict the oldest mark from windows like from the saved list', async () => {
  const { db, Settings } = await settingsFixture([{ videoId: 'watched', isWatched: true }])
  const stored = Array.from({ length: seenData.MAX_SUBSCRIPTION_SEEN_VIDEOS }, (_, index) => ({
    videoId: `stored-${String(index).padStart(5, '0')}`, seenAt: 1000 + index, isMembersOnly: false,
  }))
  stored[5000] = { videoId: 'watched', seenAt: 9000, isMembersOnly: false }
  await db.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify(stored) })
  const shown = seenData.indexSubscriptionSeenVideos(stored)
  for (const videoId of ['first', 'second']) {
    seenData.applySubscriptionSeenVideoChanges(shown, await Settings.mergeSeenVideos({ videos: [{ videoId }] }))
  }
  const saved = await savedVideoMarks(db)
  assert.equal(saved.length, seenData.MAX_SUBSCRIPTION_SEEN_VIDEOS)
  // The watched video left first, then the oldest mark.
  assert.ok(!saved.some(entry => ['watched', 'stored-00000'].includes(entry.videoId)))
  assert.ok(saved.some(entry => entry.videoId === 'stored-00001'))
  assert.deepEqual([...shown.values()].sort((a, b) => a.videoId.localeCompare(b.videoId)), saved)
})
