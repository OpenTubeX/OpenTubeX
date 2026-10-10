import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { subscriptionPage, subscriptionShortsWindow, subscriptionSummaries, updateSubscriptionFeed, updateSubscriptionShortsMetadata, markSubscriptionEntries } from '../../src/datastores/sqlite/subscriptions.js'
import { buildSubscriptionShortsFeed } from '../../src/renderer/helpers/player/shorts.js'
import { isVideoHiddenByPreferences } from '../../src/renderer/helpers/subscription-visibility.js'
import { isHistoryEntryWatched } from '../../src/history.js'
import { updateVideoMetadataCache, metadataPage, metadataThumbnail } from '../../src/datastores/sqlite/metadata.js'
import { removePlaylistMembers, addSelectedPlaylistVideos, playlistSelection, historyRepairPage, markAllHistory, applySubscriptionUnseenHistory, storageUsage, rendererSettings, syncSnapshotRead, syncSnapshotHistory } from '../../src/datastores/sqlite/operations.js'

function withoutMemberIdentity({ _libraryMemberId, ...entry }) { return entry }

test('unseen history reconciliation completes bounded reads before changing every duplicate across pages', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 600 }, (_, index) => ({ _id: String(index).padStart(4, '0'), videoId: 'video',
    isWatched: true, timeWatched: index % 3 === 0 ? 3000 : 1000, watchProgress: 123, unknown: { index } }))
  await engine.collections.history.insertAsync(records)
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: 'video', seenAt: 2000, unseenAt: 2000 }]) })
  let activeReads = 0
  const prepare = engine.prepare.bind(engine)
  t.mock.method(engine, 'prepare', sql => {
    const statement = prepare(sql)
    if (!sql.startsWith('SELECT id, data FROM records') || !sql.includes("collection = 'history'")) return statement
    return {
      all(...args) {
        const rows = statement.all(...args)
        assert.ok(rows.length <= 250, 'a duplicate video must not load an unbounded set of history rows')
        return rows
      },
      * iterate(...args) {
        activeReads++
        try { yield * statement.iterate(...args) } finally { activeReads-- }
      },
    }
  })
  const update = engine.update.bind(engine)
  t.mock.method(engine, 'update', (...args) => {
    assert.equal(activeReads, 0, 'history must not be changed while its SELECT is still being stepped')
    return update(...args)
  })
  assert.equal(await engine.transaction(() => applySubscriptionUnseenHistory(engine)), 400)
  assert.deepEqual(await engine.collections.history.findAsync({}), records.map(record => ({ ...record, isWatched: record.timeWatched >= 2000 })))
  const revision = engine.revision('history')
  assert.equal(await engine.transaction(() => applySubscriptionUnseenHistory(engine)), 0)
  assert.equal(engine.revision('history'), revision)
})

test('unseen history reconciliation rolls back partial writes and rereads newer persisted marks', async t => {
  const engine = memory(t)
  const records = Array.from({ length: 600 }, (_, index) => ({ _id: String(index).padStart(4, '0'), videoId: 'video', isWatched: true, timeWatched: 1000, watchProgress: 123, unknown: { retained: true } }))
  await engine.collections.history.insertAsync(records)
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: 'video', seenAt: 2000, unseenAt: 2000 }]) })
  const revision = engine.revision('history')
  const update = engine.update.bind(engine)
  let writes = 0
  const failure = new Error('History persistence failed')
  const mock = t.mock.method(engine, 'update', (...args) => {
    if (++writes === 251) throw failure
    return update(...args)
  })
  await assert.rejects(engine.transaction(() => applySubscriptionUnseenHistory(engine)), failure)
  assert.deepEqual(await engine.collections.history.findAsync({}), records)
  assert.equal(engine.revision('history'), revision)
  mock.mock.restore()
  // A later seen action committed in another window wins over a stale renderer.
  await engine.collections.settings.updateAsync({ _id: 'subscriptionSeenVideos' }, { $set: { value: JSON.stringify([{ videoId: 'video', seenAt: 3000, unseenAt: 2000 }]) } })
  assert.equal(await engine.transaction(() => applySubscriptionUnseenHistory(engine)), 0)
  assert.deepEqual(await engine.collections.history.findAsync({}), records)
  assert.equal(engine.revision('history'), revision)
})

test('live storage byte counters include Unicode members and blobs and survive updates and cascading deletion', async t => {
  const engine = memory(t)
  const actual = collection => ['records', 'members', 'record_blobs'].reduce((total, table) => total + engine.prepare(`SELECT coalesce(sum(length(CAST(data AS BLOB))), 0) AS bytes FROM ${table} WHERE collection = ?`).get(collection).bytes, 0)
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: '雪😀', videos: [{ videoId: 'v', title: '日本語' }] })
  assert.equal(storageUsage(engine).playlists, actual('playlists'))
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: { videoId: 'other' } }, $set: { playlistName: 'Renamed' } })
  assert.equal(storageUsage(engine).playlists, actual('playlists'))
  await engine.collections.videoMetadataCache.insertAsync({ _id: 'm', videoId: 'v', thumbnail: 'large thumbnail bytes' })
  assert.equal(storageUsage(engine).videoMetadataCache, actual('videoMetadataCache'))
  await engine.collections.playlists.removeAsync({}, { multi: true })
  await engine.collections.videoMetadataCache.removeAsync({}, { multi: true })
  assert.equal(storageUsage(engine).playlists, 0)
  assert.equal(storageUsage(engine).videoMetadataCache, 0)
})

test('renderer settings omit large sync baselines while durable snapshots and atomic acknowledgement retain them', async t => {
  const engine = memory(t)
  const snapshot = { history: Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`v${i}`, { position_millis: i }])), playlists: { p: { videos: ['a', 'b'] } }, subscriptions: ['channel'] }
  await engine.collections.settings.insertAsync({ _id: 'syncServerSnapshot', value: JSON.stringify(snapshot) })
  assert.deepEqual(JSON.parse((await rendererSettings(engine))[0].value), { subscriptions: ['channel'] })
  assert.deepEqual(JSON.parse(await syncSnapshotRead(engine)), snapshot)
  const account = ['server', 'token', 'legacy', '', '']
  await engine.collections.settings.insertAsync([{ _id: 'syncServerUrl', value: account[0] }, { _id: 'syncServerToken', value: account[1] }])
  const result = await engine.transaction(() => syncSnapshotHistory(engine, { account, changes: { previous: snapshot.history, acknowledged: { upserts: [['new', { added_date: 1 }]], deletions: ['v0'] } } }))
  assert.equal(result.updated, true)
  const saved = JSON.parse(await syncSnapshotRead(engine))
  assert.equal(saved.history.v0, undefined)
  assert.deepEqual(saved.history.new, { added_date: 1 })
  assert.deepEqual(saved.playlists, snapshot.playlists)
  assert.equal(JSON.parse(result.value).history, undefined)
  await engine.collections.settings.updateAsync({ _id: 'syncServerToken' }, { $set: { value: 'changed-account' } })
  assert.equal((await syncSnapshotHistory(engine, { account, changes: { next: {} } })).updated, false)
  assert.deepEqual(JSON.parse(await syncSnapshotRead(engine)), saved)
})

function memory(t) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
  t.after(() => db.close())
  return new LibraryEngine(db)
}
const video = (index, fields = {}) => ({ videoId: String(index).padStart(11, '0'), authorId: 'channel', title: `Video ${index}`, author: 'Author', published: 1000 + index, lengthSeconds: 100, isNewInSubscriptionFeed: true, ...fields })

for (const onlyNew of [false, true]) {
  test(`${onlyNew ? 'New-prepared' : 'classic'} subscription views invalidate hidden-channel changes and canonicalize equivalent Sets`, async t => {
    const engine = memory(t)
    const subscriptions = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]
    const persisted = subscriptions.map((channel, index) => ({
      _id: channel.id, videos: [video(index + 1, { authorId: channel.id, author: channel.name })], videosTimestamp: new Date(3000),
    }))
    await engine.collections.subscriptionCache.insertAsync(persisted)
    const options = { subscriptions, category: 'videos', onlyNew, limit: 1, now: 10000, enabledCategories: ['videos'] }
    const page = async hiddenChannelNames => {
      // New keeps the released helper's filtering rules, and also primes the
      // classic view. Both keys must preserve the Set for the later tab switch.
      if (onlyNew) await subscriptionPage(engine, { ...options, preferences: { hiddenChannelNames } })
      return subscriptionPage(engine, { ...options, onlyNew: false, preferences: { hiddenChannelNames } })
    }
    assert.deepEqual((await page(new Set(['Alpha']))).records.map(entry => entry.author), ['Beta'])
    assert.deepEqual((await page(new Set(['Beta']))).records.map(entry => entry.author), ['Alpha'])
    const visible = await page(new Set(['Unrelated 1', 'Unrelated 2']))
    assert.equal(visible.total, 2)
    assert.ok(visible.cursor)
    const equivalent = await page(new Set(['Unrelated 2', 'Unrelated 1']))
    assert.deepEqual(equivalent.cursor, visible.cursor, 'equivalent memberships should retain the existing view')
    assert.equal(engine.revision('subscriptionCache'), 1)
    assert.deepEqual(await engine.collections.subscriptionCache.findAsync({}), persisted)
  })
}

test('playlist selection searches projected fields with Unicode and literal substring semantics without deserializing members', async t => {
  const engine = memory(t)
  const records = [
    { _id: 'a', videos: [video(1, { title: 'İSTANBUL ÉLODIE 雪 100%_literal', author: null, unknown: { date: new Date(0), text: 'unsearched needle' } }), video(1, { title: 'Duplicate', author: null })] },
    { _id: 'b', videos: Array.from({ length: 350 }, (_, index) => video(index + 100, { title: null, author: index === 349 ? 'ÉLODIE İSTANBUL' : undefined, unknown: { date: new Date(index), text: 'unsearched needle' } })) },
    { _id: 'empty', videos: [] },
  ]
  await engine.collections.playlists.insertAsync(records)
  const before = await engine.collections.playlists.findAsync({})
  const revision = engine.revision('playlists')
  const deserialize = t.mock.method(model, 'deserialize', () => { throw new Error('Search must not deserialize complete playlist members') })
  try {
    for (const [query, matches] of [['i\u0307stanbul', ['a', 'b']], ['élodie', ['a', 'b']], ['雪', ['a']], ['100%_literal', ['a']], ['no-match', []], ['unsearched needle', []], ['', []]]) {
      assert.deepEqual(playlistSelection(engine, { ids: [video(1).videoId, video(1).videoId], query }), {
        counts: [{ id: 'a', count: 1, occurrences: 2, matchingCount: 2 }], matches,
      })
    }
  } finally { deserialize.mock.restore() }
  assert.equal(engine.revision('playlists'), revision)
  assert.deepEqual(await engine.collections.playlists.findAsync({}), before)
})

test('Shorts filtering uses one clock reading across a premiere boundary', async t => {
  const engine = memory(t)
  const shorts = [video(1), video(2), video(3)].map(entry => ({ ...entry, premiereTimestamp: 1.001 }))
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', shorts })
  await engine.collections.history.insertAsync(shorts.map(entry => ({ _id: entry.videoId, videoId: entry.videoId, isUpcoming: true, premiereTimestamp: 1.001, isWatched: true })))
  let reads = 0
  t.mock.method(Date, 'now', () => 1000 + reads++)
  for (const preferences of [{ hideUpcomingPremieres: true }, { hideWatched: true }]) {
    reads = 0
    const result = await subscriptionShortsWindow(engine, {
      subscriptions: [{ id: 'channel' }], currentVideoId: '', preferences,
    })
    assert.deepEqual(result, preferences.hideWatched ? shorts.toReversed() : [])
    assert.equal(reads, 1)
  }
})

test('Shorts playback reads only selected Shorts and batches latest watched history without changing feed semantics', async t => {
  const engine = memory(t)
  const subscriptions = [{ id: 'second', showMembersOnly: true }, { id: 'channel' }, { id: 'disabled', feedTypes: ['videos'] }]
  const shorts = Array.from({ length: 180 }, (_, index) => video(index, { unknown: { date: new Date(index) } }))
  const second = [video(179, { authorId: 'second', title: 'Duplicate' }), video(999, { authorId: 'second', published: 1179, isMembersOnly: true })]
  const cache = { channel: { videos: shorts }, second: { videos: second }, disabled: { videos: [video(1000)] } }
  const history = [
    { _id: 'older', videoId: video(178).videoId, timeWatched: 1, isWatched: true },
    { _id: 'newer', videoId: video(178).videoId, timeWatched: 2, isWatched: false },
    { _id: 'a', videoId: video(177).videoId, timeWatched: 3, isWatched: false },
    { _id: 'z', videoId: video(177).videoId, timeWatched: 3, isWatched: true },
    { _id: 'current', videoId: video(175).videoId, timeWatched: 4, isWatched: true },
  ]
  const historyById = Object.fromEntries(history.map(record => [record.videoId, record]))
  await engine.collections.subscriptionCache.insertAsync(Object.entries(cache).map(([id, source]) => ({
    _id: id, shorts: source.videos,
    videos: Array.from({ length: 1000 }, (_, index) => video(index + 2000)),
    liveStreams: [video(4000)], communityPosts: [{ postId: 'unrelated', text: 'Unrelated cached posts' }],
  })))
  await engine.collections.history.insertAsync(history)
  t.mock.method(engine, 'materialize', () => { throw new Error('Playback must not hydrate complete channel cache documents') })
  const prepare = engine.prepare.bind(engine)
  const queries = []
  t.mock.method(engine, 'prepare', sql => { queries.push(sql); return prepare(sql) })
  for (const preferences of [{}, { hideWatched: true }, { hideWatched: true, onlyShowLatestFromChannel: true, onlyShowLatestFromChannelNumber: 2, restrictedPlaybackConfigured: true }]) {
    queries.length = 0
    const currentVideoId = video(175).videoId
    const feed = buildSubscriptionShortsFeed({
      cache, subscriptions, currentVideoId,
      isHidden: entry => isVideoHiddenByPreferences(entry, preferences),
      isWatched: entry => isHistoryEntryWatched(historyById[entry.videoId]),
      hideWatched: preferences.hideWatched,
      restrictedPlaybackConfigured: preferences.restrictedPlaybackConfigured,
      maxPerChannel: preferences.onlyShowLatestFromChannel ? preferences.onlyShowLatestFromChannelNumber : null,
    })
    const start = Math.max(0, feed.findIndex(entry => entry.videoId === currentVideoId) - 20)
    assert.deepEqual(await subscriptionShortsWindow(engine, { subscriptions, preferences, currentVideoId }), feed.slice(start, start + 100))
    assert.equal(queries.filter(sql => sql.includes("collection = 'history'")).length, preferences.hideWatched ? 1 : 0)
    assert.equal(queries.filter(sql => sql.includes("field = 'shorts'")).length, 1)
  }
})

test('subscription aggregates preserve positional ties, duplicate winners and member identities under reversed scans', async t => {
  const engine = memory(t)
  const first = [3, 1, 2].map(index => video(index, {
    published: 1000,
    title: `Title "${index}" \\ [] 雪\n`,
    unknown: { date: new Date(index), text: '[null], {"nested": true}', array: [null, false, '雪'] },
  }))
  const second = [video(1, { published: 1000, authorId: 'second', title: 'Duplicate from second' }), video(4, { published: 1000, authorId: 'second' })]
  await engine.collections.subscriptionCache.insertAsync([
    { _id: 'channel', videos: first, shorts: first, videosTimestamp: new Date(0) },
    { _id: 'second', videos: second, shorts: second, videosTimestamp: new Date(0) },
  ])
  engine.database.exec('PRAGMA reverse_unordered_selects = ON')
  const subscriptions = [{ id: 'second' }, { id: 'channel' }]
  const options = { subscriptions, category: 'videos', limit: 2, enabledCategories: ['videos'] }
  let page = await subscriptionPage(engine, options)
  const records = [...page.records]
  while (page.cursor) {
    page = await subscriptionPage(engine, { ...options, cursor: page.cursor })
    records.push(...page.records)
  }
  assert.deepEqual(records.map(withoutMemberIdentity), [...first, ...second])
  assert.equal(new Set(records.map(entry => entry._libraryMemberId)).size, 5)
  const newPage = await subscriptionPage(engine, { ...options, onlyNew: true, limit: 100 })
  assert.deepEqual(newPage.records.map(withoutMemberIdentity), [...first, second[1]])
  assert.deepEqual(await subscriptionShortsWindow(engine, { subscriptions, currentVideoId: '' }), [second[0], second[1], first[0], first[2]])
  assert.deepEqual((await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videos, first)
  assert.deepEqual((await engine.collections.subscriptionCache.findOneAsync({ _id: 'second' })).videos, second)
})

test('watch-stat date lookups use indexes while retaining legacy array predicate semantics', async t => {
  const engine = memory(t)
  await engine.collections.watchStats.insertAsync(Array.from({ length: 2000 }, (_, index) => ({ _id: String(index), date: `day-${index}` })))
  await engine.collections.watchStats.insertAsync([{ _id: 'array', date: ['day-1999', 'other'] }, { _id: 'marker' }])
  assert.deepEqual((await engine.collections.watchStats.findAsync({ date: 'day-1999' })).map(record => record._id), ['1999', 'array'])
  const sql = [...engine.statements.keys()].find(sql => sql.startsWith('SELECT r.id, r.data') && sql.includes('UNION'))
  const plan = engine.database.prepare('EXPLAIN QUERY PLAN ' + sql).all('watchStats', 'watchStats', 'day-1999', 'watchStats').map(row => row.detail).join('\n')
  assert.match(plan, /records_date \(collection=\? AND <expr>=\?\)/)
  assert.match(plan, /records_date_type \(collection=\? AND <expr>=\?\)/)
})

test('subscription pages retain off-page watched/seen rules, channel limits and sorting without hydrating shared caches', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 350 }, (_, i) => video(i))
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos, videosTimestamp: new Date(0) })
  await engine.collections.history.insertAsync({ ...video(349), timeWatched: 1, isWatched: true })
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: video(348).videoId, seenAt: 2 }]) })
  const options = { subscriptions: [{ id: 'channel' }], onlyNew: true, category: 'videos', limit: 100 }
  let page = await subscriptionPage(engine, options)
  assert.equal(page.total, 348)
  assert.equal(page.records[0].videoId, video(347).videoId)
  assert.equal(page.records.length, 100)
  const ids = new Set(page.records.map(entry => entry.videoId))
  while (page.cursor) {
    page = await subscriptionPage(engine, { ...options, cursor: page.cursor })
    for (const record of page.records) assert.equal(ids.has(record.videoId), false, 'pages cannot repeat a membership')
    page.records.forEach(entry => ids.add(entry.videoId))
  }
  assert.equal(ids.size, 348)
  assert.deepEqual(subscriptionSummaries(engine)[0].videos, [])
  const limited = await subscriptionPage(engine, { ...options, preferences: { onlyShowLatestFromChannel: true, onlyShowLatestFromChannelNumber: 2 } })
  assert.equal(limited.total, 2)
  const old = await subscriptionPage(engine, { ...options, preferences: { sortBy: 'oldest' } })
  assert.equal(old.records[0].videoId, video(0).videoId)
})

test('refresh reconciliation and mark-all use durable off-page entries and preserve seen state across a stale refresh', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 350 }, (_, i) => video(i, { published: 2000 }))
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos, videosTimestamp: new Date(1000) })
  const marks = []
  const result = await engine.transaction(() => markSubscriptionEntries(engine, { tabs: ['videos'], channelIds: ['channel'] }, { settings: { mergeSeenVideos: async ({ videos }) => { marks.push(...videos); return JSON.stringify(videos) } } }))
  assert.equal(marks.length, 350)
  assert.ok(result.settings.subscriptionSeenVideos)
  await engine.transaction(() => updateSubscriptionFeed(engine, { channelId: 'channel', entries: videos, field: 'videos', timestamp: new Date(3000) }))
  assert.ok((await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videos.every(entry => !entry.isNewInSubscriptionFeed))
  await engine.transaction(() => updateSubscriptionFeed(engine, { channelId: 'channel', entries: [video(999, { isNewInSubscriptionFeed: true })], field: 'videos', timestamp: new Date(4000) }))
  assert.equal((await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videos[0].isNewInSubscriptionFeed, true)
})

for (const field of ['videos', 'shorts', 'liveStreams', 'communityPosts']) {
  test(`${field} refresh reconciles raw entries against durable dates and seen state`, async t => {
    const engine = memory(t)
    const idKey = field === 'communityPosts' ? 'postId' : 'videoId'
    const dateKey = field === 'communityPosts' ? 'publishedTime' : 'published'
    const entries = [
      { [idKey]: 'new', [dateKey]: 1000, isNewInSubscriptionFeed: true },
      { [idKey]: 'seen', [dateKey]: 1100, isNewInSubscriptionFeed: false },
      { [idKey]: 'watched', [dateKey]: 1200, isNewInSubscriptionFeed: true }
    ]
    const companionField = field === 'videos' ? 'shorts' : 'videos'
    const previous = { _id: 'channel', [field]: entries, [field + 'Timestamp']: new Date(2000),
      [companionField]: [{ videoId: 'companion', published: 100, isNewInSubscriptionFeed: true }],
      [companionField + 'Timestamp']: new Date(500), unknown: { date: new Date(1), keep: true }
    }
    await engine.collections.subscriptionCache.insertAsync(previous)
    await engine.collections.history.insertAsync({ _id: 'watched-history', videoId: 'watched', timeWatched: 3000, isWatched: true })
    const raw = [
      { [idKey]: 'leading-new', [dateKey]: 5000, title: 'Fresh' },
      ...entries.map((entry, index) => ({ [idKey]: entry[idKey], [dateKey]: 9000 + index, title: `Updated ${index}` }))
    ]
    const identities = engine.prepare("SELECT video_id, membership_id, created_at FROM members WHERE collection = 'subscriptionCache' AND record_id = 'channel' AND field = ? ORDER BY position").all(field)
    assert.equal(await engine.transaction(() => updateSubscriptionFeed(engine, { channelId: 'channel', entries: raw, field, timestamp: new Date(4000) })), true)
    const expected = { ...previous, [field + 'Timestamp']: new Date(4000), [field]: [
      { ...raw[0], isNewInSubscriptionFeed: true },
      ...raw.slice(1).map((entry, index) => ({ ...entry, [dateKey]: entries[index][dateKey],
        isNewInSubscriptionFeed: index === 0 || (index === 2 && idKey === 'postId') }))
    ] }
    assert.deepEqual(await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' }), expected)
    assert.deepEqual(engine.prepare("SELECT video_id, membership_id, created_at FROM members WHERE collection = 'subscriptionCache' AND record_id = 'channel' AND field = ? ORDER BY position LIMIT -1 OFFSET 1").all(field), identities)
    assert.equal(raw.some(entry => Object.hasOwn(entry, 'isNewInSubscriptionFeed')), false)
    const revision = engine.revision('subscriptionCache')
    assert.equal(await engine.transaction(() => updateSubscriptionFeed(engine, { channelId: 'channel', entries: [], field, timestamp: new Date(3000) })), false)
    assert.deepEqual(await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' }), expected)
    assert.equal(engine.revision('subscriptionCache'), revision)
  })
}

test('subscription pages use one query clock and invalidate cached premiere state after backward clock corrections', async t => {
  const engine = memory(t)
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: [video(1, { isUpcoming: true, premiereTimestamp: 200 })], videosTimestamp: new Date(1000) })
  const options = { subscriptions: [{ id: 'channel' }], preferences: { hideUpcomingPremieres: true } }
  assert.equal((await subscriptionPage(engine, { ...options, now: 100000 })).total, 0)
  assert.equal((await subscriptionPage(engine, { ...options, now: 300000 })).total, 1)
  assert.equal((await subscriptionPage(engine, { ...options, now: 100000 })).total, 0)
})

test('expired subscription cursors restart safely with unchanged revisions and a premiere transition', async t => {
  const engine = memory(t)
  const entries = [video(1, { published: 1000 }), video(2, { published: 2000 }), video(3, { isUpcoming: true, premiereTimestamp: 200 })]
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: entries, videosTimestamp: new Date(1000) })
  const options = { subscriptions: [{ id: 'channel' }], preferences: { hideUpcomingPremieres: true }, limit: 1 }
  const original = await subscriptionPage(engine, { ...options, now: 100000 })
  const nearExpiry = await subscriptionPage(engine, { ...options, now: 159999 })
  assert.equal(nearExpiry.cursor.view, original.cursor.view)
  assert.deepEqual(await subscriptionPage(engine, { ...options, now: 160000, cursor: nearExpiry.cursor }), { records: [], cursor: null, stale: true })
  const renewed = await subscriptionPage(engine, { ...options, now: 160000 })
  assert.equal(renewed.cursor.revision, original.cursor.revision)
  assert.notEqual(renewed.cursor.view, original.cursor.view)
  const nearPremiere = await subscriptionPage(engine, { ...options, now: 199999 })
  assert.equal(nearPremiere.total, 2)
  assert.deepEqual(await subscriptionPage(engine, { ...options, now: 200001, cursor: nearPremiere.cursor }), { records: [], cursor: null, stale: true })
  let page = await subscriptionPage(engine, { ...options, now: 200001 })
  const records = [...page.records]
  while (page.cursor) {
    page = await subscriptionPage(engine, { ...options, now: 200001, cursor: page.cursor })
    records.push(...page.records)
  }
  assert.equal(page.total, 3)
  assert.equal(new Set(records.map(record => record._libraryMemberId)).size, 3)
  assert.deepEqual(records, (await subscriptionPage(engine, { ...options, now: 200001, limit: 250 })).records)
  assert.deepEqual((await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videos, entries)
})

test('subscription view references retain unknown fields and dates while display overrides leave durable entries unchanged', async t => {
  const engine = memory(t)
  const entries = [
    video(1, { unknown: JSON.parse('{"__proto__":{"retained":true}}') }),
    video(2, { unknown: { date: new Date(0), text: '$$date' }, isUpcoming: true, premiereTimestamp: 200 }),
    video(3, { isNewInSubscriptionFeed: false }),
  ]
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: entries, videosTimestamp: new Date(1000) })
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: entries[2].videoId, seenAt: 1, unseenAt: 2 }]) })
  const before = engine.prepare('SELECT data FROM members ORDER BY position').all()
  const options = { subscriptions: [{ id: 'channel' }], now: 100000 }
  const page = await subscriptionPage(engine, options)
  assert.deepEqual(withoutMemberIdentity(page.records.find(entry => entry.videoId === entries[0].videoId)), entries[0])
  assert.deepEqual(withoutMemberIdentity(page.records.find(entry => entry.videoId === entries[1].videoId)), { ...entries[1], subscriptionFeedPublished: 1000 })
  assert.deepEqual(withoutMemberIdentity(page.records.find(entry => entry.videoId === entries[2].videoId)), { ...entries[2], isNewInSubscriptionFeed: true })
  assert.deepEqual(engine.prepare('SELECT data FROM members ORDER BY position').all(), before)
  await engine.collections.subscriptionCache.updateAsync({ _id: 'channel' }, { $set: { videos: [video(4)] } })
  assert.deepEqual((await subscriptionPage(engine, options)).records.map(withoutMemberIdentity), [video(4)])
})

test('subscription pages keep distinct durable membership keys through ordering, refresh and display overrides', async t => {
  const engine = memory(t)
  const shared = video(1, { authorId: 'collaborator', isUpcoming: true, premiereTimestamp: 200, isNewInSubscriptionFeed: false, unknown: { date: new Date(0) } })
  await engine.collections.subscriptionCache.insertAsync([
    { _id: 'a', videos: [shared, shared], videosTimestamp: new Date(1000) },
    { _id: 'b', videos: [shared], videosTimestamp: new Date(1000) },
  ])
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: shared.videoId, seenAt: 1, unseenAt: 2 }]) })
  const options = { subscriptions: [{ id: 'a' }, { id: 'b' }], now: 100000 }
  const before = engine.prepare('SELECT membership_id, data FROM members ORDER BY record_id, position').all()
  const first = await subscriptionPage(engine, options)
  assert.deepEqual(first.records.map(entry => entry._libraryMemberId), before.map(row => row.membership_id))
  assert.equal(new Set(first.records.map(entry => entry._libraryMemberId)).size, 3)
  assert.ok(first.records.every(entry => entry.subscriptionFeedPublished === 1000 && entry.isNewInSubscriptionFeed))
  assert.deepEqual(engine.prepare('SELECT membership_id, data FROM members ORDER BY record_id, position').all(), before)
  assert.equal(first.records[0].unknown.date.getTime(), 0)

  // Insert a newer entry ahead of unchanged occurrences and edit their display metadata.
  await engine.collections.subscriptionCache.updateAsync({ _id: 'a' }, { $set: { videos: [video(2, { published: 90000 }), { ...shared, title: 'Updated' }, shared] } })
  const refreshed = await subscriptionPage(engine, options)
  assert.equal(refreshed.records[0].videoId, video(2).videoId)
  assert.ok(refreshed.records.every(entry => typeof entry._libraryMemberId === 'string'))
  const occurrences = refreshed.records.filter(entry => entry.videoId === shared.videoId)
  assert.deepEqual(occurrences.map(entry => entry._libraryMemberId), before.map(row => row.membership_id))
  assert.equal(occurrences[0].title, 'Updated')
  assert.equal(new Set(refreshed.records.map(entry => entry._libraryMemberId)).size, 4)
  assert.ok(engine.prepare('SELECT data FROM members').all().every(row => !row.data.includes('_libraryMemberId')))
  const same = await engine.collections.subscriptionCache.findOneAsync({ _id: 'a' })
  await engine.collections.subscriptionCache.updateAsync({ _id: 'a' }, { $set: { videos: same.videos } })
  assert.deepEqual((await subscriptionPage(engine, options)).records.map(entry => entry._libraryMemberId), refreshed.records.map(entry => entry._libraryMemberId))
})

test('New prepares equivalent classic pages from one snapshot across categories and channel settings', async t => {
  const engine = memory(t)
  const cold = memory(t)
  const sources = ['channel', 'other'].map((id, index) => ({
    _id: id,
    videos: Array.from({ length: 1050 }, (_, i) => video(index * 2000 + i, { authorId: id, isMembersOnly: i % 2 === 0 })),
    shorts: [video(index + 5000, { authorId: id })],
    liveStreams: [video(index + 6000, { authorId: id, isUpcoming: true, premiereTimestamp: 300 })],
    communityPosts: [{ postId: `post-${id}`, author: id, publishedTime: 1000, isNewInSubscriptionFeed: true }],
    videosTimestamp: new Date(0),
  }))
  for (const target of [engine, cold]) await target.collections.subscriptionCache.insertAsync(sources)
  const options = { subscriptions: [{ id: 'channel', showMembersOnly: true }, { id: 'other', feedTypes: ['videos', 'posts'] }], now: 100000, preferences: { forbiddenTitles: [], restrictedPlaybackConfigured: true }, limit: 100 }
  await subscriptionPage(engine, { ...options, onlyNew: true })
  assert.equal(engine.subscriptionViews.size, 5)
  for (const category of ['videos', 'shorts', 'live', 'posts']) {
    const cached = await subscriptionPage(engine, { ...options, category })
    const fresh = await subscriptionPage(cold, { ...options, category })
    assert.deepEqual(cached.records.map(withoutMemberIdentity), fresh.records.map(withoutMemberIdentity))
    assert.equal(cached.total, fresh.total)
    assert.equal(cached.hasNew, fresh.hasNew)
    if (cached.cursor) {
      assert.deepEqual((await subscriptionPage(engine, { ...options, category, cursor: cached.cursor })).records.map(withoutMemberIdentity), (await subscriptionPage(cold, { ...options, category, cursor: fresh.cursor })).records.map(withoutMemberIdentity))
    }
  }
})

test('marking a reverse seen action uses effective durable state without changing watch progress', async t => {
  const engine = memory(t)
  const entry = video(1, { isNewInSubscriptionFeed: false })
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: [entry] })
  await engine.collections.history.insertAsync({ ...entry, isWatched: false, watchProgress: 80 })
  await engine.collections.settings.insertAsync({ _id: 'subscriptionSeenVideos', value: JSON.stringify([{ videoId: entry.videoId, seenAt: 1, unseenAt: 2 }]) })
  const marks = []
  await engine.transaction(() => markSubscriptionEntries(engine, { videoId: entry.videoId, tabs: ['videos'] }, { settings: { mergeSeenVideos: async ({ videos }) => { marks.push(...videos); return 'updated' } } }))
  assert.deepEqual(marks, [{ videoId: entry.videoId, isMembersOnly: false }])
  assert.equal((await engine.collections.history.findOneAsync({ videoId: entry.videoId })).watchProgress, 80)
})

test('bulk seen gestures exclude concurrent new arrivals while retaining existing membership identities', async t => {
  const engine = memory(t)
  const existing = video(1, { unknown: { retained: true } })
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', videos: [existing, existing], videosTimestamp: new Date(1000) })
  const before = engine.prepare("SELECT membership_id, created_at FROM members ORDER BY position").all()
  await engine.transaction(() => updateSubscriptionFeed(engine, { channelId: 'channel', entries: [existing, existing, video(2)], field: 'videos', timestamp: new Date(2000) }))
  assert.deepEqual(engine.prepare('SELECT membership_id, created_at FROM members ORDER BY position LIMIT 2').all(), before)
  const marked = []
  const handlers = { settings: { mergeSeenVideos: async ({ videos }) => { marked.push(...videos); return JSON.stringify(videos) } } }
  await engine.transaction(() => markSubscriptionEntries(engine, { tabs: ['videos'], channelIds: ['channel'], timestampsByTab: { videos: { channel: 1000 } } }, handlers))
  const entries = (await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' })).videos
  assert.deepEqual(entries.map(entry => entry.isNewInSubscriptionFeed), [false, false, true])
  assert.deepEqual(entries[0].unknown, existing.unknown)
  assert.equal(marked.length, 2)
  await engine.transaction(() => markSubscriptionEntries(engine, { tabs: ['videos'], channelIds: ['channel'], timestampsByTab: { videos: { channel: 2000 } } }, handlers))
  assert.equal(marked.at(-1).videoId, video(2).videoId)
})

test('channel Shorts metadata edits update only matching members and preserve identity, flags and unknown data', async t => {
  const engine = memory(t)
  const shorts = Array.from({ length: 20000 }, (_, index) => video(index, { viewCount: 100, unknown: { retained: true } }))
  await engine.collections.subscriptionCache.insertAsync({ _id: 'channel', shorts })
  const before = engine.prepare("SELECT membership_id FROM members WHERE video_id = ?").get(shorts[19999].videoId)
  const changes = engine.database.prepare('SELECT total_changes() AS count')
  const start = changes.get().count
  await engine.transaction(() => updateSubscriptionShortsMetadata(engine, { channelId: 'channel', entries: [{ videoId: shorts[19999].videoId, title: 'Updated', viewCount: 42 }] }))
  assert.equal(changes.get().count - start, 3, 'one member, its byte counter and the collection revision')
  const row = engine.prepare('SELECT membership_id, data FROM members WHERE video_id = ?').get(shorts[19999].videoId)
  assert.equal(row.membership_id, before.membership_id)
  assert.deepEqual(JSON.parse(row.data), { ...shorts[19999], title: 'Updated' })
})

test('metadata changes keep thumbnail bytes durable while returning bounded summaries and field pages', async t => {
  const engine = memory(t)
  const id = 'abcdefghijk'
  const first = 'data:image/png;base64,' + 'A'.repeat(120_000)
  const second = 'data:image/png;base64,' + 'B'.repeat(120_000)
  const update = (title, thumbnail, observedAt) => engine.transaction(() => updateVideoMetadataCache(engine, { videoId: id, title, description: 'description', thumbnailUrl: 'https://example.com/image.png', thumbnail, observedAt }))
  assert.equal(await update('First', first, 1000), null)
  assert.deepEqual(await update('Second', first, 2000), { videoId: id, revisionCount: 2 })
  const summary = await update('Third', second, 3000)
  assert.ok(JSON.stringify(summary).length < 100)
  const title = await metadataPage(engine, { videoId: id, field: 'title', limit: 1 })
  assert.equal(title.records[0].value, 'Second')
  assert.equal((await metadataPage(engine, { videoId: id, field: 'title', cursor: title.cursor, limit: 1 })).records[0].value, 'First')
  const thumbnails = await metadataPage(engine, { videoId: id, field: 'thumbnail' })
  assert.equal(thumbnails.records.length, 1)
  assert.ok(JSON.stringify(thumbnails).length < 1000)
  assert.equal(metadataThumbnail(engine, { id: thumbnails.records[0].thumbnailRevisionId }), first)
  await update('Stale', first, 1500)
  assert.equal(await engine.collections.videoMetadataCache.countAsync({}), 3)
  assert.equal((await engine.collections.videoMetadataCache.findAsync({}).sort({ cachedAt: -1 }))[0].thumbnail, second)
})

test('metadata text limits preserve complete code points and leave retained legacy text unchanged', async t => {
  const engine = memory(t)
  const original = { _id: 'legacy', videoId: 'legacy00001', title: 'x'.repeat(9999) + '\uD83D', description: 'legacy', cachedAt: 1, hasThumbnailChange: true }
  await engine.collections.videoMetadataCache.insertAsync(original)
  let index = 0
  for (const [field, limit] of [['title', 10000], ['description', 1000000], ['thumbnailUrl', 20000]]) {
    for (const [prefixLength, suffix, expectedSuffix] of [[limit - 1, '😀extra', ''], [limit - 2, '😀extra', '😀'], [limit - 4, '😀x', '😀x']]) {
      const prefix = 'x'.repeat(prefixLength)
      const videoId = String(++index).padStart(11, '0')
      await updateVideoMetadataCache(engine, { videoId, title: 'Title', description: 'Description', thumbnailUrl: 'https://example.test/image', thumbnail: null, [field]: prefix + suffix })
      const record = await engine.collections.videoMetadataCache.findOneAsync({ videoId })
      assert.equal(record[field].isWellFormed(), true, `${field} must retain complete code points`)
      assert.ok(record[field].length <= limit)
      assert.equal(record[field], prefix + expectedSuffix)
    }
  }
  assert.deepEqual(await engine.collections.videoMetadataCache.findOneAsync({ _id: 'legacy' }), original)
})

test('metadata pages validate limits, offsets and fields while retaining bounded pagination and stale cursors', async t => {
  const engine = memory(t)
  const videoId = 'abcdefghijk'
  const documents = Array.from({ length: 60 }, (_, index) => ({
    _id: `revision-${index}`, videoId, title: `Title ${index}`, description: `Description ${index}`, cachedAt: index + 1,
    thumbnailUrl: 'same', thumbnail: null, hasThumbnailChange: index === 0, unknown: { date: new Date(index) },
  }))
  await engine.collections.videoMetadataCache.insertAsync(documents)
  const options = { videoId, field: 'title' }
  const first = await metadataPage(engine, options)
  assert.equal(first.records.length, 25)
  assert.equal(first.cursor.offset, 25)
  assert.equal(first.records[0].value, 'Title 58')
  for (const [limit, count] of [[-5, 1], [0, 1], [1, 1], [50, 50], [51, 50], [Number.MAX_SAFE_INTEGER, 50]]) {
    const page = await metadataPage(engine, { ...options, limit })
    assert.equal(page.records.length, count)
    assert.equal(page.cursor.offset, count)
  }
  for (const limit of [NaN, Infinity, -Infinity, 1.5, '2', 'invalid', null, {}, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(metadataPage(engine, { ...options, limit }), { name: 'TypeError', message: 'Invalid metadata page limit' })
  }
  for (const offset of [undefined, null, -1, 0.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(metadataPage(engine, { ...options, cursor: { revision: first.cursor.revision, offset } }), { name: 'TypeError', message: 'Invalid metadata cursor offset' })
  }
  for (const field of ['__proto__', 'constructor', 'toString', "title'); DROP TABLE records; --", {}, null]) {
    await assert.rejects(metadataPage(engine, { ...options, field }), /Invalid metadata field/)
  }
  assert.equal((await metadataPage(engine, { ...options, field: 'description' })).records[0].value, 'Description 58')
  assert.deepEqual((await metadataPage(engine, { ...options, field: 'thumbnail' })).records, [])
  const next = await metadataPage(engine, { ...options, cursor: first.cursor })
  assert.equal(next.records[0].value, 'Title 33')
  const last = await metadataPage(engine, { ...options, cursor: next.cursor })
  assert.equal(last.records.length, 9)
  assert.equal(last.cursor, null)
  assert.equal(new Set([...first.records, ...next.records, ...last.records].map(row => row._id)).size, 59)
  assert.deepEqual(await engine.collections.videoMetadataCache.findAsync({}).sort({ cachedAt: 1 }), documents)
  await engine.collections.videoMetadataCache.insertAsync({ ...documents.at(-1), _id: 'newest', title: 'Newest', cachedAt: 61 })
  assert.deepEqual(await metadataPage(engine, { ...options, cursor: first.cursor }), { records: [], cursor: null, stale: true })
})

test('metadata digest comparisons preserve legacy bytes, URL fallback and stale backfill without reading blob payloads', async t => {
  const first = 'data:image/png;base64,' + 'A'.repeat(6_000_000)
  const second = 'data:image/png;base64,BBBB'
  const cases = [
    { label: 'unchanged large bytes', before: first, incoming: first },
    { label: 'identical bytes at another URL', before: first, incoming: first, url: 'different' },
    { label: 'replaced bytes at the same URL', before: first, incoming: second, changed: true },
    { label: 'missing bytes at the same URL', before: first, incoming: null },
    { label: 'invalid bytes at the same URL', before: first, incoming: 'invalid' },
    { label: 'missing bytes at an empty URL', before: first, incoming: null, url: '' },
    { label: 'missing bytes at a changed URL', before: first, incoming: null, url: 'different', changed: true },
    { label: 'title-only revision inherits bytes', before: first, incoming: null, title: 'Second', changed: true, thumbnailChanged: false },
    { label: 'description-only revision inherits bytes', before: first, incoming: null, description: 'Second', changed: true, thumbnailChanged: false },
    { label: 'nonempty legacy invalid bytes remain present', before: 'legacy-invalid', incoming: null },
    { label: 'empty legacy blob remains unavailable', before: '', incoming: null, url: 'different', changed: true },
    { label: 'empty legacy blob is backfilled', before: '', incoming: second, backfill: true },
    { label: 'stale observation still backfills missing bytes', before: null, incoming: second, backfill: true, observedAt: 500 },
    { label: 'stale replaced bytes are ignored', before: first, incoming: second, observedAt: 500 },
    { label: 'missing thumbnail ancestor preserves its orphan blob across repeated observations', before: first, incoming: second, inherits: false },
  ]
  for (const item of cases) {
    const engine = memory(t)
    const seed = { _id: 'first', videoId: 'abcdefghijk', title: 'First', description: 'First', thumbnailUrl: 'same', thumbnail: item.before, hasThumbnailChange: item.inherits ?? true, cachedAt: 1000, unknown: { date: new Date(1234) } }
    await engine.collections.videoMetadataCache.insertAsync(seed)
    const prepare = engine.prepare.bind(engine)
    const guard = t.mock.method(engine, 'prepare', sql => {
      assert.ok(!/SELECT\s+data\s+FROM\s+record_blobs/i.test(sql), `comparison must not load stored thumbnail bytes: ${item.label}`)
      return prepare(sql)
    })
    const input = { videoId: seed.videoId, title: item.title ?? seed.title, description: item.description ?? seed.description, thumbnailUrl: item.url ?? seed.thumbnailUrl, thumbnail: item.incoming, observedAt: item.observedAt ?? 2000 }
    const expected = item.changed ? { videoId: seed.videoId, revisionCount: 2 } : null
    assert.deepEqual(await engine.transaction(() => updateVideoMetadataCache(engine, input)), expected, item.label)
    assert.deepEqual(await engine.transaction(() => updateVideoMetadataCache(engine, input)), expected, `repeated ${item.label}`)
    assert.equal(engine.collections.videoMetadataCache.count(), item.changed ? 2 : 1, item.label)
    if (item.changed) {
      const latest = engine.prepare("SELECT data FROM records WHERE collection = 'videoMetadataCache' ORDER BY sort_time DESC LIMIT 1").get()
      assert.equal(model.deserialize(latest.data).hasThumbnailChange, item.thumbnailChanged ?? true, item.label)
    }
    guard.mock.restore()
    assert.deepEqual(await engine.collections.videoMetadataCache.findOneAsync({ _id: 'first' }), { ...seed, thumbnail: item.backfill ? second : item.before }, item.label)
  }
})

test('equal-time metadata observations preserve arrival order, thumbnail inheritance and durable pagination', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-metadata-order-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'library.sqlite')
  let db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON;' + SCHEMA_SQL)
  let engine = new LibraryEngine(db)
  t.after(() => db.close())
  const collection = engine.collections.videoMetadataCache
  const insert = collection.insertAsync.bind(collection)
  const ids = ['z-first', 'y-second', 'x-third', 'w-rollback']
  t.mock.method(collection, 'insertAsync', record => insert({ ...record, _id: ids.shift() }))
  const id = 'abcdefghijk'
  const first = 'data:image/png;base64,AAAA'
  const second = 'data:image/png;base64,BBBB'
  const update = (title, thumbnail) => engine.transaction(() => updateVideoMetadataCache(engine, { videoId: id, title, description: title, thumbnailUrl: 'https://example.com/image.png', thumbnail, observedAt: 1000 }))
  await update('First', first)
  await update('Second', second)
  await update('Third', null)
  await update('Third', null)
  assert.equal(collection.count(), 3, 'the current tied revision must prevent a duplicate observation')
  const assertPages = async () => {
    const title = await metadataPage(engine, { videoId: id, field: 'title', limit: 1 })
    assert.deepEqual(title.records.map(row => [row._id, row.value, row.cachedAt]), [['y-second', 'Second', 1000]])
    assert.equal((await metadataPage(engine, { videoId: id, field: 'title', cursor: title.cursor, limit: 1 })).records[0].value, 'First')
    assert.deepEqual((await metadataPage(engine, { videoId: id, field: 'description' })).records.map(row => row.value), ['Second', 'First'])
    const thumbnails = await metadataPage(engine, { videoId: id, field: 'thumbnail' })
    assert.equal(thumbnails.records.length, 1)
    assert.equal(metadataThumbnail(engine, { id: thumbnails.records[0].thumbnailRevisionId }), first)
  }
  await assertPages()
  await assert.rejects(engine.transaction(async () => {
    await updateVideoMetadataCache(engine, { videoId: id, title: 'Rolled back', description: 'Rolled back', observedAt: 1000 })
    throw new Error('rollback')
  }), /rollback/)
  await collection.updateAsync({ _id: 'z-first' }, { $set: { unknown: { date: new Date(1234) } } })
  await assertPages()
  const secondOrder = db.prepare('SELECT * FROM metadata_order WHERE record_id = ?').get('y-second')
  await collection.updateAsync({ _id: 'y-second' }, { $set: { videoId: 'other-video', cachedAt: 2000 } })
  assert.deepEqual({ ...db.prepare('SELECT * FROM metadata_order WHERE record_id = ?').get('y-second') }, { ...secondOrder, video_id: 'other-video', sort_time: 2000 })
  assert.deepEqual((await metadataPage(engine, { videoId: id, field: 'title' })).records.map(row => row.value), ['First'])
  await collection.updateAsync({ _id: 'y-second' }, { $set: { videoId: id, cachedAt: 1000 } })
  await assertPages()
  const documents = await collection.findAsync({})
  db.close()
  db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON')
  engine = new LibraryEngine(db)
  await assertPages()
  assert.deepEqual(await engine.collections.videoMetadataCache.findAsync({}), documents)
  await update('Third', null)
  assert.equal(engine.collections.videoMetadataCache.count(), 3)
  const latest = await engine.collections.videoMetadataCache.findOneAsync({ _id: 'x-third' })
  await engine.collections.videoMetadataCache.removeAsync({ _id: 'x-third' })
  await engine.collections.videoMetadataCache.insertAsync(latest)
  await assertPages()
  const backfillId = 'backfill001'
  const backfill = engine.collections.videoMetadataCache
  await backfill.insertAsync([
    { _id: 'backfill-z', videoId: backfillId, title: 'First', description: '', cachedAt: 1000, thumbnail: null, thumbnailUrl: 'same', hasThumbnailChange: true },
    { _id: 'backfill-a', videoId: backfillId, title: 'Second', description: '', cachedAt: 1000, thumbnail: null, thumbnailUrl: 'same', hasThumbnailChange: false },
  ])
  const order = db.prepare('SELECT * FROM metadata_order ORDER BY sequence').all()
  await engine.transaction(() => updateVideoMetadataCache(engine, { videoId: backfillId, title: 'Second', thumbnail: second, thumbnailUrl: 'same', observedAt: 1000 }))
  assert.deepEqual(db.prepare('SELECT * FROM metadata_order ORDER BY sequence').all(), order, 'thumbnail backfill must retain arrival order without inserting a revision')
  assert.equal(metadataThumbnail(engine, { id: 'backfill-z' }), second)
  assert.deepEqual((await metadataPage(engine, { videoId: backfillId, field: 'title' })).records.map(row => row.value), ['First'])
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('member removal, duplicate prevention and repair/mark-all include records outside the first page', async t => {
  const engine = memory(t)
  const videos = Array.from({ length: 350 }, (_, i) => video(i, { playlistItemId: 'duplicated-id' }))
  await engine.collections.playlists.insertAsync({ _id: 'p', videos })
  const tail = engine.playlistPage({ id: 'p', reverse: true, limit: 1 }).records[0]
  await engine.transaction(() => removePlaylistMembers(engine, { id: 'p', memberIds: [tail._libraryMemberId] }))
  assert.equal(engine.playlistStatistics({ id: 'p' }).total, 349)
  assert.equal((await engine.collections.playlists.findOneAsync({ _id: 'p' })).videos[0].videoId, videos[0].videoId)
  await engine.transaction(() => addSelectedPlaylistVideos(engine, { ids: ['p'], videos: [videos[0]] }))
  assert.equal(engine.playlistStatistics({ id: 'p' }).total, 349)
  await engine.transaction(() => addSelectedPlaylistVideos(engine, { ids: ['p'], videos: [{ videoId: 'fresh', title: 'First copy' }, { videoId: 'fresh', title: 'Second copy' }] }))
  assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos.slice(-2).map(video => video.title), ['First copy', 'Second copy'])
  assert.deepEqual(playlistSelection(engine, { ids: [videos[0].videoId], query: 'Video 340' }), { counts: [{ id: 'p', count: 1, occurrences: 1, matchingCount: 1 }], matches: ['p'] })
  await engine.collections.history.insertAsync(videos.map((entry, index) => ({ ...entry, _id: String(index).padStart(4, '0'), author: '', isWatched: false })))
  const page = historyRepairPage(engine, { limit: 100 })
  assert.equal(page.total, 350)
  assert.equal(page.records.length, 100)
  const result = await engine.transaction(() => markAllHistory(engine, {}, { settings: {} }))
  assert.equal(result.count, 350)
  assert.equal(engine.historySummary().unwatched, false)
})

test('disk-full failures roll back a normalized feed transaction and checkpointed feeds reopen intact', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-cache-checkpoint-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'library.sqlite')
  let db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;' + SCHEMA_SQL)
  let engine = new LibraryEngine(db)
  const record = { _id: 'channel', videos: [video(1, { isNewInSubscriptionFeed: false })] }
  await engine.collections.subscriptionCache.insertAsync(record)
  const pages = db.prepare('PRAGMA page_count').get().page_count
  db.exec(`PRAGMA max_page_count=${pages}`)
  await assert.rejects(engine.collections.subscriptionCache.updateAsync({ _id: 'channel' }, { $set: { videos: [video(2, { title: 'x'.repeat(1_000_000) })] } }), /full/i)
  assert.deepEqual(await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' }), record)
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()
  db = new DatabaseSync(path)
  engine = new LibraryEngine(db)
  assert.deepEqual(await engine.collections.subscriptionCache.findOneAsync({ _id: 'channel' }), record)
  db.close()
})

test('metadata edits preserve own prototype-named fields and reject unsupported array operators without changing data', async t => {
  const engine = memory(t)
  const record = JSON.parse('{"_id":"p","playlistName":"Before","__proto__":{"private":"preserve"},"future":{"constructor":{"value":1}},"videos":[]}')
  await engine.collections.playlists.insertAsync(record)
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $set: { playlistName: 'After' } })
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'p' }), { ...record, playlistName: 'After' })
  await assert.rejects(engine.collections.playlists.updateAsync({ _id: 'p' }, { $pop: { videos: 1 } }), /Unsupported/)
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: 'p' }), { ...record, playlistName: 'After' })
})

test('modifier edits round-trip prototype-named fields nested inside scalar and normalized arrays', async t => {
  const engine = memory(t)
  const dangerous = () => JSON.parse('{"__proto__":{"private":"preserve"},"constructor":{"value":1},"prototype":[{"__proto__":"nested"}]}')
  const original = { _id: 'nested', playlistName: 'Before', future: { entries: [[dangerous()]], date: new Date(123) }, videos: [{ videoId: 'original', extra: [dangerous()] }] }
  await engine.collections.playlists.insertAsync(original)
  await engine.collections.playlists.updateAsync({ _id: original._id }, { $set: { playlistName: 'After' } })
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: original._id }), { ...original, playlistName: 'After' })
  const added = { entries: [[dangerous()]], date: new Date(456) }
  await engine.collections.playlists.updateAsync({ _id: original._id }, { $set: { added }, $push: { videos: { videoId: 'added', extra: [[dangerous()]] } } })
  const expected = { ...original, playlistName: 'After', added, videos: [...original.videos, { videoId: 'added', extra: [[dangerous()]] }] }
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: original._id }), expected)
  await engine.collections.playlists.updateAsync({ _id: original._id }, { $set: { 'added.entries.0.0.__proto__.private': 'edited', 'added.entries.0.0.constructor.value': 2 } })
  expected.added.entries[0][0].__proto__.private = 'edited'
  expected.added.entries[0][0].constructor.value = 2
  assert.deepEqual(await engine.collections.playlists.findOneAsync({ _id: original._id }), expected)
  assert.equal(Object.hasOwn(Object.prototype, 'private'), false)
})
