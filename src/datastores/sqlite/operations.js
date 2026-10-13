import model from '@seald-io/nedb/lib/model.js'
import { randomUUID } from 'node:crypto'
import { MAIN_PROFILE_ID } from '../../constants.js'
import { isHistoryEntryWatched, migrateLegacyHistoryRecord } from '../../history.js'
import { parseSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'
import { getRecommendationLearningEntries } from '../../renderer/helpers/recommendations.js'
import { isVideoHiddenByPreferences } from '../../renderer/helpers/subscription-visibility.js'
import { syncSnapshotPreview } from '../../syncSnapshot.js'
import { updateHistorySnapshot, updatePlaylistSnapshot } from '../../renderer/helpers/sync-history-merge.js'

export async function rendererSettings(engine, _options, handlers) {
  const records = handlers ? await handlers.settings.find() : await engine.collections.settings.findAsync({})
  return records.map(record => record._id === 'syncServerSnapshot'
    ? { ...record, value: syncSnapshotPreview(record.value) }
    : record)
}

export async function syncSnapshotRead(engine) {
  return (await engine.collections.settings.findOneAsync({ _id: 'syncServerSnapshot' }))?.value ?? '{}'
}

export async function syncSnapshotSummary(engine) {
  return syncSnapshotPreview(await syncSnapshotRead(engine))
}

async function snapshotAccountMatches(engine, account) {
  if (!Array.isArray(account) || account.length !== 5) throw new TypeError('Invalid sync account')
  const keys = ['syncServerUrl', 'syncServerToken', 'syncServerPrivacyMode', 'syncServerPrivacyKey', 'syncServerPrivacySalt']
  for (let index = 0; index < keys.length; index++) {
    const current = await engine.collections.settings.findOneAsync({ _id: keys[index] })
    const value = current?.value ?? (keys[index] === 'syncServerPrivacyMode' ? 'legacy' : '')
    if (value !== account[index]) return false
  }
  return true
}

export async function syncSnapshotHistory(engine, { account, changes }) {
  return engine.transaction(async () => {
    if (!await snapshotAccountMatches(engine, account)) return { updated: false }
    const value = updateHistorySnapshot({ snapshot: await syncSnapshotRead(engine), ...changes })
    await engine.collections.settings.updateAsync({ _id: 'syncServerSnapshot' }, { _id: 'syncServerSnapshot', value }, { upsert: true })
    return { updated: true, value: syncSnapshotPreview(value) }
  })
}

export async function syncSnapshotSection(engine, { account, collection, value, remove = false }) {
  if (!['sessionsV2', 'watchStats', 'playlists'].includes(collection) || typeof remove !== 'boolean' || (remove && collection !== 'watchStats')) throw new TypeError('Invalid sync snapshot section')
  if (collection === 'playlists' && (typeof value?.id !== 'string' || !Array.isArray(value.acknowledged?.upserts) || !Array.isArray(value.acknowledged?.deletions))) throw new TypeError('Invalid playlist sync acknowledgement')
  return engine.transaction(async () => {
    if (!await snapshotAccountMatches(engine, account) || (collection !== 'playlists' && (await engine.collections.settings.findOneAsync({ _id: 'syncServerEnabled' }))?.value !== true)) return { updated: false }
    if (collection === 'watchStats' && !remove) {
      const preference = await engine.collections.settings.findOneAsync({ _id: 'syncServerSyncWatchStats' })
      // An absent preference uses the renderer's enabled-by-default setting.
      if (preference && preference.value !== true) return { updated: false }
    }
    const current = await syncSnapshotRead(engine)
    const snapshot = JSON.parse(current)
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('Invalid sync snapshot')
    if (collection === 'playlists') {
      const updated = updatePlaylistSnapshot({ snapshot: current, ...value })
      await engine.collections.settings.updateAsync({ _id: 'syncServerSnapshot' }, { _id: 'syncServerSnapshot', value: updated }, { upsert: true })
      return { updated: true, value: syncSnapshotPreview(updated) }
    }
    if (remove) delete snapshot[collection]
    else snapshot[collection] = value
    const updated = JSON.stringify(snapshot)
    await engine.collections.settings.updateAsync({ _id: 'syncServerSnapshot' }, { _id: 'syncServerSnapshot', value: updated }, { upsert: true })
    return { updated: true, value: syncSnapshotPreview(updated) }
  })
}

export async function importSubscriptionProfiles(engine, { profiles }) {
  if (!Array.isArray(profiles) || profiles.some(profile => !profile || typeof profile._id !== 'string' || (typeof profile.name !== 'string' && profile.name !== null) || !Array.isArray(profile.subscriptions))) throw new TypeError('Invalid subscription profiles')
  return engine.transaction(async () => {
    const collection = engine.collections.profiles
    const current = await collection.findAsync({})
    const primary = current.find(profile => profile._id === MAIN_PROFILE_ID)
    if (!primary) throw new Error('The primary subscription profile is missing')
    const mergeChannels = (previous, incoming) => {
      const ids = new Set()
      return [...previous, ...incoming].filter(channel => {
        if (ids.has(channel.id)) return false
        ids.add(channel.id)
        return true
      })
    }
    const primaryChannels = []
    const primaryPatch = {}
    for (const imported of profiles) {
      for (const channel of imported.subscriptions) primaryChannels.push(channel)
      if (imported._id === MAIN_PROFILE_ID) {
        if (Object.hasOwn(imported, 'icon')) primaryPatch.icon = imported.icon
        continue
      }
      const existing = current.find(profile => profile._id !== MAIN_PROFILE_ID && (imported.name === null ? profile._id === imported._id : profile.name === imported.name))
      if (existing) {
        const patch = { subscriptions: mergeChannels(existing.subscriptions, imported.subscriptions) }
        if (Object.hasOwn(imported, 'icon')) patch.icon = imported.icon
        await collection.updateAsync({ _id: existing._id }, { $set: patch })
        Object.assign(existing, patch)
      } else {
        const profile = { ...imported }
        if (current.some(existing => existing._id === profile._id)) delete profile._id
        current.push(await collection.insertAsync(profile))
      }
    }
    primaryPatch.subscriptions = mergeChannels(primary.subscriptions, primaryChannels)
    await collection.updateAsync({ _id: MAIN_PROFILE_ID }, { $set: primaryPatch })
    return true
  })
}

export function storageUsage(engine) {
  return Object.fromEntries(engine.prepare('SELECT collection, bytes FROM collection_counts').all().map(row => [row.collection, row.bytes]))
}

export function historyRepairPage(engine, { cursor = null, limit = 100 } = {}) {
  limit = Math.max(1, Math.min(250, limit))
  const rows = engine.prepare("SELECT id, data FROM records WHERE collection = 'history' AND repair_candidate = 1 AND id > ? ORDER BY id LIMIT ?").all(cursor?.id ?? '', limit + 1)
  const more = rows.length > limit
  if (more) rows.pop()
  const total = cursor?.total ?? engine.prepare("SELECT count(*) AS count FROM records WHERE collection = 'history' AND repair_candidate = 1").get().count
  return { records: rows.map(row => migrateLegacyHistoryRecord(model.deserialize(row.data))), cursor: more ? { id: rows.at(-1).id, total } : null, total }
}

export function historyRepairRecord(engine, { id, videoId }) {
  if (typeof id !== 'string' || !id || typeof videoId !== 'string' || !videoId) throw new TypeError('Invalid history repair record')
  const row = engine.prepare("SELECT data FROM records WHERE collection = 'history' AND id = ? AND video_id = ?").get(id, videoId)
  return row ? migrateLegacyHistoryRecord(model.deserialize(row.data)) : null
}

export async function markAllHistory(engine, options, handlers) {
  engine.database.exec('CREATE TEMP TABLE IF NOT EXISTS marked_history (id TEXT PRIMARY KEY, video_id TEXT) WITHOUT ROWID; DELETE FROM marked_history; CREATE INDEX IF NOT EXISTS marked_history_video ON marked_history(video_id)')
  engine.prepare("INSERT INTO marked_history SELECT id, video_id FROM records WHERE collection = 'history' AND unwatched_candidate = 1 AND watchable_after <= ?").run(Date.now())
  let count = 0
  for (const { id } of engine.prepare('SELECT id FROM marked_history ORDER BY id').iterate()) {
    const row = engine.prepare("SELECT id, data FROM records WHERE collection = 'history' AND id = ?").get(id)
    engine.update('history', row, { $set: { isWatched: true } })
    count++
  }
  if (count) engine.touch('history')
  const saved = await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
  const videos = parseSubscriptionSeenVideos(saved?.value).filter(mark => mark.unseenAt >= mark.seenAt && engine.prepare('SELECT 1 FROM marked_history WHERE video_id = ? LIMIT 1').get(mark.videoId))
  const seenVideos = videos.length ? await handlers.settings.mergeSeenVideos({ videos }) : null
  engine.database.exec('DELETE FROM marked_history; CREATE INDEX IF NOT EXISTS marked_history_video ON marked_history(video_id)')
  return { count, seenVideos }
}

export async function applySubscriptionUnseenHistory(engine) {
  const saved = await engine.collections.settings.findOneAsync({ _id: 'subscriptionSeenVideos' })
  const firstPage = engine.prepare("SELECT id, data FROM records WHERE collection = 'history' AND video_id = ? ORDER BY id LIMIT 250")
  const nextPage = engine.prepare("SELECT id, data FROM records WHERE collection = 'history' AND video_id = ? AND id > ? ORDER BY id LIMIT 250")
  const now = Date.now()
  let count = 0
  // Read current durable marks and each duplicate's own timestamp in the
  // worker transaction, so a later watch or seen action cannot be overwritten.
  for (const mark of parseSubscriptionSeenVideos(saved?.value)) {
    if (!(mark.unseenAt >= mark.seenAt)) continue
    let cursor = null
    while (true) {
      // Complete each bounded SELECT before writing to the same table. SQLite
      // does not define live cursor results when that connection changes rows.
      const rows = cursor === null ? firstPage.all(mark.videoId) : nextPage.all(mark.videoId, cursor)
      if (!rows.length) break
      cursor = rows.at(-1).id
      for (const row of rows) {
        const history = migrateLegacyHistoryRecord(model.deserialize(row.data))
        if (mark.unseenAt > (history.timeWatched ?? 0) && isHistoryEntryWatched(history, now)) {
          engine.update('history', row, { $set: { isWatched: false } })
          count++
        }
      }
      if (rows.length < 250) break
    }
  }
  if (count) engine.touch('history')
  return count
}

export function playlistSelection(engine, { ids, query = '' }) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new TypeError('Invalid playlist selection')
  const counts = engine.prepare(`WITH selected AS (
    SELECT value AS video_id, count(*) AS multiplicity FROM json_each(?) GROUP BY value
  ), existing AS (
    SELECT m.record_id, m.video_id, count(*) AS occurrences FROM members m JOIN selected s ON s.video_id = m.video_id
    WHERE m.collection = 'playlists' AND m.field = 'videos' GROUP BY m.record_id, m.video_id
  ) SELECT e.record_id AS id, count(*) AS count, sum(e.occurrences) AS occurrences, sum(s.multiplicity) AS matchingCount
    FROM existing e JOIN selected s ON s.video_id = e.video_id GROUP BY e.record_id`).all(JSON.stringify(ids))
  const search = query.toLowerCase()
  const matched = new Set()
  if (search) {
    const fields = engine.prepare("SELECT json_extract(data, '$.title', '$.author') AS fields FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position")
    for (const { id } of engine.prepare("SELECT id FROM records WHERE collection = 'playlists' ORDER BY id").iterate()) {
      // Project only the searchable fields and stop at each playlist's first
      // match. SQLite lower() is ASCII-only; retain JS Unicode case conversion.
      for (const row of fields.iterate(id)) {
        const [title, author] = JSON.parse(row.fields)
        if ((typeof title === 'string' && title.toLowerCase().includes(search)) || (typeof author === 'string' && author.toLowerCase().includes(search))) {
          matched.add(id)
          break
        }
      }
    }
  }
  return { counts: counts.map(row => ({ ...row })), matches: [...matched] }
}

export async function addSelectedPlaylistVideos(engine, { ids, videos, allowDuplicates = false }) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || !Array.isArray(videos) || videos.some(video => !video || typeof video.videoId !== 'string')) throw new TypeError('Invalid playlist selection')
  const changedIds = []
  for (const id of ids) {
    if (!await engine.collections.playlists.countAsync({ _id: id })) throw new Error('The playlist no longer exists')
    const existing = allowDuplicates ? new Set() : new Set(engine.prepare("SELECT DISTINCT video_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IN (SELECT value FROM json_each(?))").all(id, JSON.stringify(videos.map(video => video.videoId))).map(row => row.video_id))
    const added = videos.filter(video => {
      if (allowDuplicates) return true
      return !existing.has(video.videoId)
    }).map(video => {
      const result = { ...video, playlistItemId: randomUUID(), timeAdded: video.timeAdded ?? Date.now(), type: video.type ?? 'video' }
      delete result._libraryMemberId
      return result
    })
    if (added.length) {
      await engine.collections.playlists.updateAsync({ _id: id }, { $push: { videos: { $each: added } }, $set: { lastUpdatedAt: Date.now() } })
      changedIds.push(id)
    }
  }
  return { changedIds }
}

export async function removePlaylistMember(engine, { id, memberId, revision }) {
  if (revision !== undefined && revision !== engine.revision('playlists')) throw new Error('The playlist changed; reload it before removing this member')
  const row = engine.prepare("SELECT data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id = ?").get(id, memberId)
  if (!row) return false
  engine.prepare("DELETE FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id = ?").run(id, memberId)
  await engine.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
  const video = model.deserialize(row.data)
  engine.clearRemovedPlaylistContext(id, [video?.videoId])
  return true
}

export async function removePlaylistMembers(engine, { id, memberIds }) {
  if (!Array.isArray(memberIds) || memberIds.some(member => typeof member !== 'string')) throw new TypeError('Invalid playlist members')
  return engine.transaction(async () => {
    const removed = engine.prepare("DELETE FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id IN (SELECT value FROM json_each(?)) RETURNING data -> '$.videoId' AS video_id").all(id, JSON.stringify(memberIds))
    if (!removed.length) return 0
    await engine.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
    engine.clearRemovedPlaylistContext(id, removed.map(row => model.deserialize(row.video_id ?? 'null')))
    return removed.length
  })
}

export function recommendationInputs(engine, { preferences = {}, revisionsOnly = false } = {}) {
  if (revisionsOnly) return { history: engine.revision('history'), playlists: engine.revision('playlists') }
  preferences = { ...preferences, hiddenChannelNames: new Set(preferences.hiddenChannelNames ?? []) }
  const visible = video => !(video.isMembersOnly === true && !preferences.restrictedPlaybackConfigured) && !isVideoHiddenByPreferences(video, preferences)
  function * records(source, ...args) { for (const row of typeof source === 'string' ? engine.prepare(source).iterate(...args) : source) yield model.deserialize(row.data) }
  const learningEntries = (sql, limit) => {
    const seen = new Set()
    return getRecommendationLearningEntries(records(sql), video => {
      if (seen.has(video.videoId) || !visible(video)) return false
      seen.add(video.videoId)
      return true
    }, limit)
  }
  return {
    history: learningEntries(engine.orderedHistoryRows({ idDirection: 1 }), 1000).map(migrateLegacyHistoryRecord),
    favorites: learningEntries("SELECT data FROM members WHERE collection = 'playlists' AND record_id = 'favorites' AND field = 'videos' ORDER BY position", 500),
    saved: learningEntries("SELECT data FROM members WHERE collection = 'playlists' AND record_id <> 'favorites' AND field = 'videos' ORDER BY record_id, position", 500)
  }
}

export function recommendationSubscriptionCandidates(engine, { channelIds }) {
  if (!Array.isArray(channelIds) || channelIds.length > 12 || channelIds.some(id => typeof id !== 'string')) throw new TypeError('Invalid recommendation channels')
  const query = engine.prepare("SELECT data FROM members WHERE collection = 'subscriptionCache' AND record_id = ? AND field = 'videos' ORDER BY position LIMIT 30")
  // Home learns from the first cached candidates, independently of feed-only
  // channel preferences. Its shared visibility check applies authentication.
  return channelIds.flatMap(id => query.all(id).map(row => ({ ...model.deserialize(row.data), recommendationSources: [{ type: 'subscription', id }] })))
}

export function playlistVideoIds(engine, { id }) {
  if (!engine.prepare("SELECT 1 FROM records WHERE collection = 'playlists' AND id = ?").get(id)) throw new Error('The playlist no longer exists')
  return engine.prepare("SELECT data -> '$.videoId' AS video_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND json_type(data, '$.videoId') = 'text' ORDER BY position").all(id).map(row => model.deserialize(row.video_id)).filter(Boolean)
}

export async function playlistImportCandidates(engine, { name }) {
  if (typeof name !== 'string') throw new TypeError('Invalid playlist name')
  return engine.collections.playlists.findAsync({ playlistName: name }, { _id: 1, playlistName: 1, protected: 1 })
}
