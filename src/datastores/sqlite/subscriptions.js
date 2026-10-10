import { randomUUID } from 'node:crypto'
import model from '@seald-io/nedb/lib/model.js'
import { getNewSubscriptionFeedEntries } from '../../renderer/helpers/newSubscriptionFeed.js'
import { isVideoHiddenByPreferences } from '../../renderer/helpers/subscription-visibility.js'
import { applySubscriptionVideoLimit, filterMembersOnlySubscriptionVideos, getSubscriptionsForFeed } from '../../renderer/helpers/subscription-channels.js'
import { ensureUpcomingSubscriptionFeedPublished, getSubscriptionVideoSortTimestamp, updateUpcomingPremiereState, ensureSubscriptionFeedEntryState, getUpcomingPremiereTimestamp } from '../../renderer/helpers/subscription-entries.js'
import { applySubscriptionSeenVideosToCache, applySubscriptionSeenPostsToCache } from '../../renderer/helpers/subscription-seen-videos.js'
import { preserveSubscriptionSeenEntries, subscriptionFeedField } from '../../subscriptionFeedState.js'
import { isHistoryEntryWatched, migrateLegacyHistoryRecord } from '../../history.js'
import { shouldRefreshSubscriptionPremiere } from '../../renderer/helpers/subscription-premieres.js'
import { buildSubscriptionShortsFeed } from '../../renderer/helpers/player/shorts.js'
import { parseSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'
import { parseSubscriptionSeenPosts } from '../../subscriptionSeenPosts.js'

// Enumerable symbols survive display-only object spreads but are omitted by
// NeDB/JSON serialization, keeping this membership identity out of stored data.
const memberIdentity = Symbol('subscriptionMember')

function deserializeEntry(data) {
  // Member rows were serialized by NeDB's model on write. Most feed entries
  // have no Date values, so avoid running its reviver for every scalar field.
  return data.includes('$$date') ? model.deserialize(data) : JSON.parse(data)
}

export function subscriptionEntries(engine, { channelId, field = 'videos', ids }) {
  if (!['videos', 'shorts', 'liveStreams', 'communityPosts'].includes(field) || !Array.isArray(ids) || ids.length > 250) throw new TypeError('Invalid subscription entry query')
  return engine.prepare("SELECT data FROM members WHERE collection = 'subscriptionCache' AND record_id = ? AND field = ? AND video_id IN (SELECT value FROM json_each(?)) ORDER BY position").all(channelId, field, JSON.stringify(ids)).map(row => model.deserialize(row.data))
}

export function subscriptionPremieres(engine, { channelId, cursor = -1, now = Date.now() }) {
  const records = []
  let last = null
  for (const row of engine.prepare("SELECT position, membership_id, data FROM members WHERE collection = 'subscriptionCache' AND record_id = ? AND field = 'videos' AND position > ? ORDER BY position").iterate(channelId, cursor)) {
    const video = model.deserialize(row.data)
    if (!shouldRefreshSubscriptionPremiere(video, now)) continue
    if (records.length === 100) return { records, cursor: last }
    records.push({ video, memberId: row.membership_id }); last = row.position
  }
  return { records, cursor: null }
}

export function updateSubscriptionPremieres(engine, { updates }) {
  if (!Array.isArray(updates) || updates.length > 100) throw new TypeError('Invalid premiere update')
  let changed = false
  for (const { memberId, previous, update } of updates) {
    const row = engine.prepare("SELECT data FROM members WHERE collection = 'subscriptionCache' AND membership_id = ?").get(memberId)
    // A full refresh or another window may have replaced this exact entry.
    if (!row || row.data !== model.serialize(previous)) continue
    const allowed = Object.fromEntries(['isUpcoming', 'isLive', 'liveNow', 'isPremiere', 'premiere', 'premiereDate', 'premiereTimestamp', 'published', 'viewCount', 'lengthSeconds'].filter(key => Object.hasOwn(update, key)).map(key => [key, update[key]]))
    engine.prepare("UPDATE members SET data = ? WHERE collection = 'subscriptionCache' AND membership_id = ?").run(model.serialize({ ...previous, ...allowed }), memberId)
    changed = true
  }
  if (changed) engine.touch('subscriptionCache')
  return changed
}

export async function subscriptionShortsWindow(engine, { subscriptions, preferences = {}, currentVideoId }) {
  const ids = getSubscriptionsForFeed(subscriptions, 'shorts').map(channel => channel.id)
  const cache = Object.fromEntries(engine.prepare("SELECT record_id, json_group_array(json(data) ORDER BY position) AS entries FROM members WHERE collection = 'subscriptionCache' AND field = 'shorts' AND record_id IN (SELECT value FROM json_each(?)) GROUP BY record_id").all(JSON.stringify(ids)).map(row => [row.record_id, { videos: deserializeEntry(row.entries) }]))
  const historyById = new Map()
  if (preferences.hideWatched) {
    const videoIds = [...new Set(Object.values(cache).flatMap(source => source.videos.map(video => video.videoId)).filter(id => typeof id === 'string'))]
    // Resolve the latest duplicate once per video in one indexed query, rather
    // than loading unrelated feed arrays or issuing a query for each Short.
    for (const row of engine.prepare("SELECT h.data FROM json_each(?) AS videos JOIN records AS h ON h.collection = 'history' AND h.id = (SELECT id FROM records WHERE collection = 'history' AND video_id = videos.value ORDER BY sort_time DESC, id DESC LIMIT 1)").all(JSON.stringify(videoIds))) {
      const record = model.deserialize(row.data)
      historyById.set(record.videoId, record)
    }
  }
  const feed = buildSubscriptionShortsFeed({
    cache,
    subscriptions,
    isHidden: video => isVideoHiddenByPreferences(video, preferences),
    isWatched: video => isHistoryEntryWatched(historyById.get(video.videoId)),
    hideWatched: preferences.hideWatched,
    restrictedPlaybackConfigured: preferences.restrictedPlaybackConfigured,
    maxPerChannel: preferences.onlyShowLatestFromChannel ? preferences.onlyShowLatestFromChannelNumber : null,
    currentVideoId
  })
  const index = feed.findIndex(video => video.videoId === currentVideoId)
  return feed.slice(Math.max(0, index - 20), Math.max(0, index - 20) + 100)
}

export function subscriptionSummaries(engine) {
  const counts = new Map()
  for (const row of engine.prepare("SELECT record_id, field, length FROM record_arrays WHERE collection = 'subscriptionCache'").iterate()) {
    if (!counts.has(row.record_id)) counts.set(row.record_id, {})
    counts.get(row.record_id)[row.field] = row.length
  }
  return engine.prepare("SELECT id, data FROM records WHERE collection = 'subscriptionCache' ORDER BY id").all().map(row => ({ ...model.deserialize(row.data), _libraryFeedCounts: counts.get(row.id) ?? {} }))
}

function classicSubscriptionEntries(caches, category, subscriptions, preferences, historyById, now) {
  const channelIds = new Set(getSubscriptionsForFeed(subscriptions, category).map(channel => channel.id))
  let records = Object.entries(caches[category]).filter(([id]) => channelIds.has(id)).flatMap(([, cache]) => (cache[category === 'posts' ? 'posts' : 'videos'] ?? []).map(video => category === 'videos' ? ensureUpcomingSubscriptionFeedPublished(video, cache.timestamp.getTime(), now) : video))
  if (category === 'posts') records = records.toSorted((a, b) => b.publishedTime - a.publishedTime)
  if (category !== 'posts') records = records.map(video => updateUpcomingPremiereState(video, now)).toSorted((a, b) => getSubscriptionVideoSortTimestamp(b, preferences.showScheduledLiveStreamsFirst, now) - getSubscriptionVideoSortTimestamp(a, preferences.showScheduledLiveStreamsFirst, now))
  records = records.filter(video => !isVideoHiddenByPreferences(video, preferences, now))
  if (category !== 'posts') {
    records = filterMembersOnlySubscriptionVideos(records, subscriptions, preferences.restrictedPlaybackConfigured)
    if (preferences.hideWatched) records = records.filter(video => !isHistoryEntryWatched(historyById[video.videoId], now))
    records = applySubscriptionVideoLimit(records, subscriptions, preferences.onlyShowLatestFromChannel ? preferences.onlyShowLatestFromChannelNumber : null)
  }
  return records
}

export async function subscriptionPage(engine, options) {
  const { subscriptions, category = 'videos', onlyNew = false, cursor = null, limit = 100, preferences = {}, enabledCategories = ['videos', 'shorts', 'live', 'posts'] } = options
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const revisions = [engine.revision('subscriptionCache'), engine.revision('history'), engine.revision('settings')]
  const keyPreferences = { ...preferences, hiddenChannelNames: preferences.hiddenChannelNames instanceof Set ? [...preferences.hiddenChannelNames].toSorted() : preferences.hiddenChannelNames }
  const revisionFor = (isNew, tab) => JSON.stringify([...revisions, subscriptions, isNew, isNew ? null : tab, keyPreferences, enabledCategories])
  const revision = revisionFor(onlyNew, category)
  if (cursor && cursor.revision !== revision) return { records: [], cursor: null, stale: true }
  const channels = getSubscriptionsForFeed(subscriptions, category)
  const ids = (onlyNew ? subscriptions : channels).map(channel => channel.id)
  engine.subscriptionViews ??= new Map()
  engine.database.exec('CREATE TEMP TABLE IF NOT EXISTS subscription_views (view_id TEXT NOT NULL, category TEXT NOT NULL, ordinal INTEGER NOT NULL, membership_id TEXT, data TEXT, PRIMARY KEY(view_id, category, ordinal)) WITHOUT ROWID')
  let view = engine.subscriptionViews.get(revision)
  if (view && (view.expiresAt <= now || now < view.createdAt)) {
    engine.prepare('DELETE FROM subscription_views WHERE view_id = ?').run(view.id)
    engine.subscriptionViews.delete(revision)
    view = null
  }
  if (!view) {
    const field = { videos: 'videos', shorts: 'shorts', live: 'liveStreams', posts: 'communityPosts' }
    const fields = (onlyNew ? enabledCategories : [category]).map(category => field[category])
    // Fetch the requested member fields in one pass. Classic category tabs do
    // not need to hydrate the other arrays of every subscribed channel.
    const sources = engine.prepare("SELECT id, data FROM records WHERE collection = 'subscriptionCache' AND id IN (SELECT value FROM json_each(?)) ORDER BY id").all(JSON.stringify(ids)).map(row => model.deserialize(row.data))
    const sourcesById = new Map(sources.map(source => [source._id, source]))
    const memberIds = new WeakMap()
    // Group each channel array before crossing into JS. The schema validates
    // member JSON on write, so concatenate it without parsing it again here.
    // Quote identities and order inside the aggregate to preserve exact ties.
    for (const row of engine.prepare("SELECT record_id, field, '[' || group_concat('[' || json_quote(membership_id) || ',' || data || ']' ORDER BY position) || ']' AS entries FROM members WHERE collection = 'subscriptionCache' AND record_id IN (SELECT value FROM json_each(?)) AND field IN (SELECT value FROM json_each(?)) GROUP BY record_id, field ORDER BY record_id, field").iterate(JSON.stringify(ids), JSON.stringify(fields))) {
      const entries = deserializeEntry(row.entries)
      const source = sourcesById.get(row.record_id)
      for (const [memberId, entry] of entries) {
        memberIds.set(entry, memberId)
        entry[memberIdentity] = memberId
        source[row.field].push(entry)
      }
    }
    const videoIds = [...new Set(sources.flatMap(source => fields.filter(field => field !== 'communityPosts').flatMap(key => (source[key] ?? []).map(video => video.videoId))).filter(id => typeof id === 'string'))]
    const historyById = {}
    for (const row of engine.prepare("SELECT data FROM records WHERE collection = 'history' AND video_id IN (SELECT value FROM json_each(?)) ORDER BY sort_time, id").iterate(JSON.stringify(videoIds))) {
      const record = model.deserialize(row.data)
      historyById[record.videoId] = migrateLegacyHistoryRecord(record)
    }
    const seenVideos = await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
    const seenPosts = await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenPosts' })
    const caches = Object.fromEntries(Object.keys(field).map(category => [category, Object.fromEntries(sources.filter(source => Array.isArray(source[field[category]])).map(source => [source._id, {
      [category === 'posts' ? 'posts' : 'videos']: source[field[category]], timestamp: new Date(source[field[category] + 'Timestamp']),
    }]))]))
    for (const category of ['videos', 'shorts', 'live']) caches[category] = applySubscriptionSeenVideosToCache(caches[category], seenVideos?.value)
    caches.posts = applySubscriptionSeenPostsToCache(caches.posts, seenPosts?.value)
    const categories = onlyNew
      ? getNewSubscriptionFeedEntries({ feeds: enabledCategories.map(category => ({ category, cache: caches[category], entriesKey: category === 'posts' ? 'posts' : 'videos' })), activeSubscriptions: subscriptions, historyCacheById: historyById, ...preferences, now })
      : { [category]: classicSubscriptionEntries(caches, category, subscriptions, preferences, historyById, now) }
    const insert = engine.prepare("INSERT INTO subscription_views SELECT ?, ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)")
    const insertReferences = engine.prepare('INSERT INTO subscription_views SELECT ?, ?, ? + CAST(key AS INTEGER), value, NULL FROM json_each(?)')
    let nextPremiereTimestamp = null
    for (const source of sources) {
      for (const field of ['videos', 'shorts', 'liveStreams']) {
        for (const entry of source[field] ?? []) {
          const timestamp = getUpcomingPremiereTimestamp(entry)
          if (timestamp > now && (nextPremiereTimestamp === null || timestamp < nextPremiereTimestamp)) nextPremiereTimestamp = timestamp
        }
      }
    }
    const cacheView = (key, allCategories) => {
      const previous = engine.subscriptionViews.get(key)
      if (previous) {
        engine.prepare('DELETE FROM subscription_views WHERE view_id = ?').run(previous.id)
        engine.subscriptionViews.delete(key)
      }
      const id = randomUUID()
      for (const [name, entries] of Object.entries(allCategories)) {
        for (let offset = 0; offset < entries.length; offset += 1000) {
          const chunk = entries.slice(offset, offset + 1000)
          const references = chunk.map(entry => {
            // Keep only an ordered member reference unless a shared feed helper
            // added a display override. Revisions invalidate this view on edits.
            const memberId = entry[memberIdentity]
            const timestamp = getUpcomingPremiereTimestamp(entry)
            if (timestamp > now && (nextPremiereTimestamp === null || timestamp < nextPremiereTimestamp)) nextPremiereTimestamp = timestamp
            return memberIds.has(entry) ? memberId : null
          })
          if (references.every(memberId => typeof memberId === 'string')) {
            // Most entries retain their durable data. Avoid triple JSON
            // extraction for every row when only its order and identity vary.
            insertReferences.run(id, name, offset, JSON.stringify(references))
          } else {
            const rows = chunk.map((entry, index) => [offset + index, entry[memberIdentity], references[index] === null ? model.serialize(entry) : null])
            insert.run(id, name, JSON.stringify(rows))
          }
        }
      }
      const cached = { id, createdAt: now, counts: Object.fromEntries(Object.entries(allCategories).map(([name, entries]) => [name, entries.length])), hasNew: Object.fromEntries(Object.entries(allCategories).map(([name, entries]) => [name, entries.some(entry => entry.isNewInSubscriptionFeed === true && !isHistoryEntryWatched(historyById[entry.videoId], now))])), nextPremiereTimestamp, expiresAt: Math.min(now + 60_000, nextPremiereTimestamp ?? Infinity) }
      if (engine.subscriptionViews.size >= 5) {
        const oldest = engine.subscriptionViews.keys().next().value
        engine.prepare('DELETE FROM subscription_views WHERE view_id = ?').run(engine.subscriptionViews.get(oldest).id)
        engine.subscriptionViews.delete(oldest)
      }
      engine.subscriptionViews.set(key, cached)
    }
    if (onlyNew) {
      // New already reads every enabled feed. Prepare their classic ordering
      // from the same transient snapshot so switching tabs does not repeat it.
      for (const tab of enabledCategories) cacheView(revisionFor(false, tab), { [tab]: classicSubscriptionEntries(caches, tab, subscriptions, preferences, historyById, now) })
    }
    cacheView(revision, categories)
    view = engine.subscriptionViews.get(revision)
  }
  if (cursor && cursor.view !== view.id) return { records: [], cursor: null, stale: true }
  const offset = cursor?.offset ?? 0
  const end = offset + Math.max(1, Math.min(250, limit))
  const total = view.counts[category] ?? 0
  const records = engine.prepare("SELECT v.membership_id, coalesce(v.data, m.data) AS data FROM subscription_views v LEFT JOIN members m ON m.collection = 'subscriptionCache' AND m.membership_id = v.membership_id WHERE v.view_id = ? AND v.category = ? AND v.ordinal >= ? AND v.ordinal < ? ORDER BY v.ordinal").all(view.id, category, offset, end).map(row => ({ ...model.deserialize(row.data), _libraryMemberId: row.membership_id }))
  return { records, cursor: end < total ? { revision, view: view.id, offset: end } : null, total, hasNew: view.hasNew[category] ?? false, categoryCounts: onlyNew ? view.counts : null, nextPremiereTimestamp: view.nextPremiereTimestamp }
}

export async function subscriptionEntry(engine, { videoId, postId }) {
  const row = videoId
    ? engine.prepare("SELECT data FROM members WHERE collection = 'subscriptionCache' AND video_id = ? LIMIT 1").get(videoId)
    : engine.prepare("SELECT data FROM members WHERE collection = 'subscriptionCache' AND json_extract(data, '$.postId') = ? LIMIT 1").get(postId)
  return row ? model.deserialize(row.data) : null
}

export async function updateSubscriptionFeed(engine, { channelId, entries, timestamp, field }) {
  const previous = await engine.collections.subscriptionCache.findOneAsync({ _id: channelId })
  if (new Date(previous?.[field + 'Timestamp']).getTime() > new Date(timestamp).getTime()) return false
  const historyById = {}
  const ids = [...new Set(entries.map(entry => entry.videoId).filter(id => typeof id === 'string'))]
  for (let index = 0; index < ids.length; index += 250) {
    for (const record of await engine.collections.history.findAsync({ videoId: { $in: ids.slice(index, index + 250) } }).sort({ timeWatched: 1 })) historyById[record.videoId] = migrateLegacyHistoryRecord(record)
  }
  const reconciled = ensureSubscriptionFeedEntryState(entries, previous?.[field], field === 'communityPosts' ? 'postId' : 'videoId', previous?.[field + 'Timestamp'], historyById)
  await engine.collections.subscriptionCache.updateAsync({ _id: channelId }, { $set: { [field]: preserveSubscriptionSeenEntries(reconciled, previous?.[field], field === 'communityPosts' ? 'postId' : 'videoId'), [field + 'Timestamp']: timestamp } }, { upsert: true })
  return true
}

export function updateSubscriptionShortsMetadata(engine, { channelId, entries }) {
  const byId = new Map(entries.filter(entry => typeof entry.videoId === 'string').map(entry => [entry.videoId, entry]))
  const ids = [...byId.keys()]
  let changed = false
  for (let offset = 0; offset < ids.length; offset += 250) {
    const rows = engine.prepare("SELECT membership_id, data FROM members WHERE collection = 'subscriptionCache' AND record_id = ? AND field = 'shorts' AND video_id IN (SELECT value FROM json_each(?))").all(channelId, JSON.stringify(ids.slice(offset, offset + 250)))
    for (const row of rows) {
      const cached = model.deserialize(row.data)
      const incoming = byId.get(cached.videoId)
      for (const field of ['title', 'author', 'thumbnailUrl']) if (incoming[field] !== undefined) cached[field] = incoming[field]
      if (incoming.viewCount > cached.viewCount) cached.viewCount = incoming.viewCount
      const data = model.serialize(cached)
      if (data === row.data) continue
      engine.prepare("UPDATE members SET data = ? WHERE collection = 'subscriptionCache' AND membership_id = ?").run(data, row.membership_id)
      changed = true
    }
  }
  if (changed) engine.touch('subscriptionCache')
  return changed
}

export async function markSubscriptionEntries(engine, { tabs = ['videos', 'shorts', 'live', 'posts'], channelIds = [], channelIdsByTab = {}, timestampsByTab = {}, videoId, postId }, handlers) {
  const videos = []
  const posts = []
  const videoMarks = new Map(parseSubscriptionSeenVideos((await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenVideos' }))?.value).map(mark => [mark.videoId, mark]))
  const postMarks = new Map(parseSubscriptionSeenPosts((await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenPosts' }))?.value).map(mark => [mark.postId, mark]))
  for (const tab of tabs) {
    const field = subscriptionFeedField(tab)
    const ids = channelIdsByTab[tab] ?? channelIds
    const rows = engine.prepare(`SELECT record_id, position, created_at, data FROM members WHERE collection = 'subscriptionCache' AND field = ? AND ${videoId ? 'video_id = ?' : postId ? "json_extract(data, '$.postId') = ?" : 'record_id IN (SELECT value FROM json_each(?))'}`).all(field, videoId ?? postId ?? JSON.stringify(ids))
    for (const row of rows) {
      // Bulk actions belong to the feed known at the gesture, even when a
      // concurrent refresh reaches the worker before this transaction.
      const cutoff = timestampsByTab[tab]?.[row.record_id]
      if (!videoId && !postId && Number.isFinite(cutoff) && row.created_at > cutoff) continue
      const entry = model.deserialize(row.data)
      const mark = tab === 'posts' ? postMarks.get(entry.postId) : videoMarks.get(entry.videoId)
      const isNew = mark
        ? mark.unseenAt >= mark.seenAt || (tab !== 'posts' && mark.isMembersOnly && entry.isMembersOnly === false && entry.isNewInSubscriptionFeed === true)
        : entry.isNewInSubscriptionFeed === true
      if (!isNew) continue
      entry.isNewInSubscriptionFeed = false
      engine.prepare("UPDATE members SET data = ? WHERE collection = 'subscriptionCache' AND record_id = ? AND field = ? AND position = ?").run(model.serialize(entry), row.record_id, field, row.position)
      if (tab === 'posts') posts.push({ postId: entry.postId })
      else videos.push({ videoId: entry.videoId, isMembersOnly: entry.isMembersOnly === true })
    }
  }
  const settings = {}
  if (videos.length) settings.subscriptionSeenVideos = await handlers.settings.mergeSeenVideos({ videos })
  if (posts.length) settings.subscriptionSeenPosts = await handlers.settings.mergeSeenPosts({ posts })
  if (videos.length || posts.length) engine.touch('subscriptionCache')
  return { settings }
}
