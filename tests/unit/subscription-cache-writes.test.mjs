import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { ensureSubscriptionFeedEntryState } from '../../src/renderer/helpers/subscription-entries.js'
import * as seenData from '../../src/subscriptionSeenVideos.js'
import * as feedState from '../../src/subscriptionFeedState.js'
import { applySubscriptionSeenVideosToCache, applySubscriptionSeenPostsToCache } from '../../src/renderer/helpers/subscription-seen-videos.js'

// The handlers module imports the platform datastore singleton through webpack.
// Run the actual cache class with an isolated real NeDB for each interleaving.
const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const start = source.indexOf('class SubscriptionCache {')
const cacheSource = source.slice(start, source.indexOf('\nclass ', start + 1))
const storeSource = await readFile(new URL('../../src/renderer/store/modules/subscription-cache.js', import.meta.url), 'utf8')
const moduleSource = storeSource.slice(storeSource.indexOf('const MAX_CONCURRENT_CACHE_WRITES'))
  .replace('export default', 'globalThis.cacheModule =')

for (const [tab, field, cacheKey, update, mark] of [
  ['videos', 'videos', 'videoCache', 'updateVideosByChannelId', 'markSubscriptionVideoAsSeen'],
  ['shorts', 'shorts', 'shortsCache', 'updateShortsByChannelId', 'markSubscriptionVideoAsSeen'],
  ['live', 'liveStreams', 'liveCache', 'updateLiveStreamsByChannelId', 'markSubscriptionVideoAsSeen'],
  ['posts', 'communityPosts', 'postsCache', 'updateCommunityPostsByChannelId', 'markSubscriptionPostAsSeen'],
]) {
  test(`marking ${tab} seen tolerates a malformed persisted feed`, async () => {
    const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
    const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db, ...feedState })
    const idKey = tab === 'posts' ? 'postId' : 'videoId'
    for (const malformed of [{}, 'invalid', 1, true]) {
      await db.subscriptionCache.updateAsync({ _id: 'channel' }, {
        _id: 'channel', [field]: malformed, [`${field}Timestamp`]: new Date(1000),
      }, { upsert: true })
      await Cache.markEntriesAsSeen('channel', tab, [{ [idKey]: 'displayed', isNewInSubscriptionFeed: false }])
      const saved = (await Cache.find())[0]
      assert.deepEqual(saved[field], [])
      assert.equal(new Date(saved[`${field}Timestamp`]).getTime(), 1000)
    }
  })
  for (const bulk of [false, true]) {
    test(`${bulk ? 'bulk' : 'individual'} seen action survives a concurrent ${tab} refresh and sync`, async () => {
      const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
      const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db, ...seenData, ...feedState })
      const idKey = tab === 'posts' ? 'postId' : 'videoId'
      const entriesKey = tab === 'posts' ? 'posts' : 'videos'
      const old = { [idKey]: 'displayed', title: 'Old metadata', isNewInSubscriptionFeed: true }
      const fresh = [
        { ...old, title: 'Fresh metadata' },
        { [idKey]: 'arrived-during-mark', isNewInSubscriptionFeed: true },
      ]
      await Cache[update]('channel', [old], new Date(1000))
      const context = vm.createContext({
        console, ...seenData, ...feedState, applySubscriptionSeenVideosToCache, applySubscriptionSeenPostsToCache,
        DBSubscriptionCacheHandlers: Cache,
      })
      vm.runInContext(moduleSource, context)
      const { actions, mutations, state } = context.cacheModule
      state[cacheKey].channel = { [entriesKey]: [old], timestamp: new Date(1000) }
      let marks = []
      const actionContext = {
        state,
        rootGetters: { getSubscriptionSeenVideos: [] },
        commit: (type, payload) => mutations[type](state, payload),
        dispatch: async (type, payload) => {
          if (type === 'mergeSubscriptionSeenPosts') {
            assert.deepEqual(structuredClone(payload), { posts: [{ postId: 'displayed' }] })
            return
          }
          assert.equal(type, 'mergeSubscriptionSeenVideos')
          marks = seenData.mergeSubscriptionSeenVideos(marks,
            payload.videos.map(video => ({ ...video, seenAt: 3000 })))
        },
      }
      // The database receives the refresh before its acknowledgement reaches
      // the renderer. The clicked card still carries the earlier timestamp.
      await Cache[update]('channel', fresh, new Date(2000))
      await (bulk
        ? actions.markSubscriptionEntriesAsSeen(actionContext, { tab, channelIds: ['channel'] })
        : actions[mark](actionContext, 'displayed'))
      assert.equal(old.isNewInSubscriptionFeed, false, 'feed cards retaining the original object must update too')
      // A delayed refresh reply must not restore the dismissed card.
      const mutation = { videos: 'updateVideoCacheByChannel', shorts: 'updateShortsCacheByChannel',
        live: 'updateLiveCacheByChannel', posts: 'updatePostsCacheByChannel' }[tab]
      mutations[mutation](state, { channelId: 'channel', entries: fresh, timestamp: new Date(2000) })
      const saved = (await Cache.find())[0]
      assert.deepEqual(saved[field].map(entry => entry.isNewInSubscriptionFeed), [false, true])
      assert.equal(saved[field][0].title, 'Fresh metadata')
      assert.equal(new Date(saved[`${field}Timestamp`]).getTime(), 2000)
      assert.deepEqual(state[cacheKey].channel[entriesKey].map(entry => entry.isNewInSubscriptionFeed), [false, true])
      if (tab !== 'posts') {
        // Replay the uploaded marks on another device with its own stale feed.
        const remote = applySubscriptionSeenVideosToCache({ channel: { videos: fresh } }, marks)
        assert.deepEqual(remote.channel.videos.map(entry => entry.isNewInSubscriptionFeed), [false, true])
      }
      // A response already computed before the click can arrive after it too.
      await Cache[update]('channel', fresh, new Date(4000))
      assert.deepEqual((await Cache.find())[0][field].map(entry => entry.isNewInSubscriptionFeed), [false, true])
    })
  }
}

for (const idKey of ['videoId', 'postId']) {
  test(`malformed persisted ${idKey} feed does not prevent refresh`, () => {
    const incoming = [{ [idKey]: 'new', isNewInSubscriptionFeed: true }]
    for (const previous of [{}, 'invalid', 1, true, null, undefined]) {
      assert.equal(feedState.preserveSubscriptionSeenEntries(incoming, previous, idKey), incoming)
    }
  })
  test(`missing ${idKey} cannot dismiss an unrelated feed entry`, () => {
    const incoming = [{ isNewInSubscriptionFeed: true }, { [idKey]: '', isNewInSubscriptionFeed: true }]
    const old = incoming.map(entry => ({ ...entry, isNewInSubscriptionFeed: false }))
    assert.equal(feedState.preserveSubscriptionSeenEntries(incoming, old, idKey), incoming)
  })
}

test('duplicate and absent seen marks do not rewrite the persisted feed', async () => {
  const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
  const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db, ...feedState })
  const entry = { videoId: 'seen', isNewInSubscriptionFeed: false }
  await Cache.updateVideosByChannelId('channel', [entry], new Date(1000))
  let writes = 0
  const update = db.subscriptionCache.updateAsync.bind(db.subscriptionCache)
  db.subscriptionCache.updateAsync = (...args) => { writes++; return update(...args) }
  await Cache.markEntriesAsSeen('channel', 'videos', [entry])
  await Cache.markEntriesAsSeen('channel', 'videos', [{ ...entry, videoId: 'absent' }])
  assert.equal(writes, 0)
})

test('a stale members-only seen action leaves a newly public upload new', async () => {
  const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
  const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db, ...feedState })
  const privateVideo = { videoId: 'video', isMembersOnly: true, isNewInSubscriptionFeed: false }
  await Cache.updateVideosByChannelId('channel', [privateVideo], new Date(1000))
  const publicVideo = { ...privateVideo, isMembersOnly: false, isNewInSubscriptionFeed: true }
  await Cache.updateVideosByChannelId('channel', [publicVideo], new Date(2000))
  await Cache.markEntriesAsSeen('channel', 'videos', [privateVideo])
  assert.equal((await Cache.find())[0].videos[0].isNewInSubscriptionFeed, true)
  await Cache.markEntriesAsSeen('channel', 'videos', [{ ...publicVideo, isNewInSubscriptionFeed: false }])
  assert.equal((await Cache.find())[0].videos[0].isNewInSubscriptionFeed, false)
})

for (const enrichmentFirst of [false, true]) {
  test(`Shorts refresh preserves new entries when enrichment starts ${enrichmentFirst ? 'first' : 'second'}`, async () => {
    const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
    const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db, ...feedState })
    await Cache.updateShortsByChannelId('channel', [{ videoId: 'old', title: 'Old title' }], new Date(1000))

    const refresh = () => Cache.updateShortsByChannelId('channel', [
      { videoId: 'old', title: 'Refreshed title' },
      { videoId: 'new', title: 'New title' },
    ], new Date(2000))
    const enrich = () => Cache.updateShortsWithChannelPageShortsByChannelId('channel', [
      { videoId: 'old', title: 'Enriched title', viewCount: 2000 },
    ])
    const first = enrichmentFirst ? enrich() : refresh()
    // Let the first read enter NeDB's queue before starting the other writer.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.all([first, enrichmentFirst ? refresh() : enrich()])

    const result = await db.subscriptionCache.findOneAsync({ _id: 'channel' })
    assert.deepEqual(result.shorts.map(video => video.videoId), ['old', 'new'])
    assert.equal(new Date(result.shortsTimestamp).getTime(), 2000)
    assert.equal(result.shorts[0].title, enrichmentFirst ? 'Refreshed title' : 'Enriched title')
  })
}

for (const delayDatabaseReply of [false, true]) {
  test(`a premiere update cannot overwrite a full refresh when its database ${delayDatabaseReply ? 'reply' : 'write'} arrives late`, async () => {
    const db = { subscriptionCache: new Datastore({ inMemoryOnly: true }) }
    const Cache = vm.runInNewContext(`${cacheSource}\nSubscriptionCache`, { db, ...feedState })
    const cachedVideos = [{ videoId: 'premiere', viewCount: 1000, isNewInSubscriptionFeed: false }]
    await Cache.updateVideosByChannelId('channel', cachedVideos, new Date(1000))

    let releasePremiere
    let signalWaiting
    const waiting = new Promise(resolve => { signalWaiting = resolve })
    const resume = new Promise(resolve => { releasePremiere = resolve })
    const context = vm.createContext({
      console,
      ...feedState,
      ensureSubscriptionFeedEntryState,
      DBSubscriptionCacheHandlers: {
        async updateVideosByChannelId(channelId, videos, timestamp) {
          if (timestamp.getTime() !== 1000) {
            return Cache.updateVideosByChannelId(channelId, videos, timestamp)
          }
          // Model an IPC acknowledgement delayed until after a newer refresh,
          // and the inverse order where the old write itself reaches NeDB late.
          if (delayDatabaseReply) {
            const result = await Cache.updateVideosByChannelId(channelId, videos, timestamp)
            signalWaiting()
            await resume
            return result
          }
          signalWaiting()
          await resume
          return Cache.updateVideosByChannelId(channelId, videos, timestamp)
        }
      }
    })
    vm.runInContext(moduleSource, context)
    const { actions, mutations, state } = context.cacheModule
    state.videoCache.channel = { videos: cachedVideos, timestamp: new Date(1000) }
    const actionContext = {
      state,
      rootGetters: { getHistoryCacheById: {} },
      commit(type, payload) { mutations[type](state, payload) }
    }
    const premiereUpdate = actions.updateSubscriptionVideosCacheByChannel(actionContext, {
      channelId: 'channel',
      videos: [{ ...cachedVideos[0], viewCount: 2500 }],
      timestamp: new Date(1000)
    })
    await waiting

    const refreshedVideos = [
      { videoId: 'premiere', viewCount: 3000, isNewInSubscriptionFeed: false },
      { videoId: 'new-video', isNewInSubscriptionFeed: true }
    ]
    await actions.updateSubscriptionVideosCacheByChannel(actionContext, {
      channelId: 'channel', videos: refreshedVideos, timestamp: new Date(2000)
    })
    releasePremiere()
    await premiereUpdate

    assert.equal(state.videoCache.channel.videos, refreshedVideos)
    assert.equal(state.videoCache.channel.timestamp.getTime(), 2000)
    const persisted = await db.subscriptionCache.findOneAsync({ _id: 'channel' })
    assert.deepEqual(persisted.videos, refreshedVideos)
    assert.equal(new Date(persisted.videosTimestamp).getTime(), 2000)
  })
}

test('loading persisted video caches supplies feed markers without changing known seen state or embedded videos', async () => {
  const entries = [
    { videoId: 'unmarked' },
    { videoId: 'seen', isNewInSubscriptionFeed: false },
    { videoId: 'new', isNewInSubscriptionFeed: true },
  ]
  const embedded = { videoId: 'embedded' }
  const context = vm.createContext({
    console,
    DBSubscriptionCacheHandlers: {
      find: async () => [{
        _id: 'channel',
        videos: entries,
        shorts: entries,
        liveStreams: entries,
        communityPosts: [{ postId: 'post', postContent: { type: 'video', content: embedded } }],
      }],
    },
  })
  vm.runInContext(moduleSource, context)
  const { actions, mutations, state } = context.cacheModule
  await actions.grabAllSubscriptions({
    rootGetters: { getSubscribedChannelIdSet: new Set(['channel']) },
    commit: (type, payload) => mutations[type](state, payload),
  })
  for (const key of ['videoCache', 'shortsCache', 'liveCache']) {
    assert.deepEqual(structuredClone(state[key].channel.videos), [
      { videoId: 'unmarked', isNewInSubscriptionFeed: false }, entries[1], entries[2],
    ])
  }
  assert.equal(state.postsCache.channel.posts[0].postContent.content.isNewInSubscriptionFeed, undefined)
})
