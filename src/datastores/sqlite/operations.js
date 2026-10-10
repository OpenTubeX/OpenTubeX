import model from '@seald-io/nedb/lib/model.js'
import { randomUUID } from 'node:crypto'
import { isHistoryEntryWatched, migrateLegacyHistoryRecord } from '../../history.js'
import { parseSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'
import { getRecommendationLearningEntries } from '../../renderer/helpers/recommendations.js'
import { isVideoHiddenByPreferences } from '../../renderer/helpers/subscription-visibility.js'
import { syncSnapshotPreview } from '../../syncSnapshot.js'
import { updateHistorySnapshot } from '../../renderer/helpers/sync-history-merge.js'

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

export async function syncSnapshotHistory(engine, { account, changes }) {
  const keys = ['syncServerUrl', 'syncServerToken', 'syncServerPrivacyMode', 'syncServerPrivacyKey', 'syncServerPrivacySalt']
  for (let index = 0; index < keys.length; index++) {
    const current = await engine.collections.settings.findOneAsync({ _id: keys[index] })
    const value = current?.value ?? (keys[index] === 'syncServerPrivacyMode' ? 'legacy' : '')
    if (value !== account[index]) return { updated: false }
  }
  const value = updateHistorySnapshot({ snapshot: await syncSnapshotRead(engine), ...changes })
  await engine.collections.settings.updateAsync({ _id: 'syncServerSnapshot' }, { _id: 'syncServerSnapshot', value }, { upsert: true })
  return { updated: true, value: syncSnapshotPreview(value) }
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
        if (title?.toLowerCase().includes(search) || author?.toLowerCase().includes(search)) {
          matched.add(id)
          break
        }
      }
    }
  }
  return { counts: counts.map(row => ({ ...row })), matches: [...matched] }
}

export async function addSelectedPlaylistVideos(engine, { ids, videos, allowDuplicates = false }) {
  let count = 0
  for (const id of ids) {
    if (!await engine.collections.playlists.countAsync({ _id: id })) throw new Error('The playlist no longer exists')
    const existing = allowDuplicates ? new Set() : new Set(engine.prepare("SELECT DISTINCT video_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IN (SELECT value FROM json_each(?))").all(id, JSON.stringify(videos.map(video => video.videoId))).map(row => row.video_id))
    const added = videos.filter(video => {
      if (allowDuplicates) return true
      if (existing.has(video.videoId)) return false
      return true
    }).map(video => {
      const result = { ...video, playlistItemId: randomUUID(), timeAdded: video.timeAdded ?? Date.now(), type: video.type ?? 'video' }
      delete result._libraryMemberId
      return result
    })
    if (added.length) await engine.collections.playlists.updateAsync({ _id: id }, { $push: { videos: { $each: added } }, $set: { lastUpdatedAt: Date.now() } })
    count++
  }
  return count
}

export async function removePlaylistMember(engine, { id, memberId, revision }) {
  if (revision !== undefined && revision !== engine.revision('playlists')) throw new Error('The playlist changed; reload it before removing this member')
  const row = engine.prepare("SELECT data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id = ?").get(id, memberId)
  if (!row) return false
  engine.prepare("DELETE FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id = ?").run(id, memberId)
  await engine.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
  const video = model.deserialize(row.data)
  engine.clearRemovedPlaylistContext(id, [video.videoId])
  return true
}

export async function removePlaylistMembers(engine, { id, memberIds }) {
  if (!Array.isArray(memberIds) || memberIds.some(member => typeof member !== 'string')) throw new TypeError('Invalid playlist members')
  let count = 0
  for (const memberId of memberIds) count += Number(await removePlaylistMember(engine, { id, memberId }))
  return count
}

export function recommendationInputs(engine, { preferences = {} } = {}) {
  preferences = { ...preferences, hiddenChannelNames: new Set(preferences.hiddenChannelNames ?? []) }
  const visible = video => !(video.isMembersOnly === true && !preferences.restrictedPlaybackConfigured) && !isVideoHiddenByPreferences(video, preferences)
  function * records(sql, ...args) { for (const row of engine.prepare(sql).iterate(...args)) yield model.deserialize(row.data) }
  return {
    history: getRecommendationLearningEntries(records("SELECT data FROM records WHERE collection = 'history' ORDER BY sort_time DESC, id DESC"), visible).map(migrateLegacyHistoryRecord),
    favorites: getRecommendationLearningEntries(records("SELECT data FROM members WHERE collection = 'playlists' AND record_id = 'favorites' AND field = 'videos' ORDER BY position"), visible, 500),
    saved: getRecommendationLearningEntries(records("SELECT data FROM members WHERE collection = 'playlists' AND record_id <> 'favorites' AND field = 'videos' ORDER BY record_id, position"), visible, 500)
  }
}

export function recommendationSubscriptionCandidates(engine, { channelIds }) {
  if (!Array.isArray(channelIds) || channelIds.length > 12 || channelIds.some(id => typeof id !== 'string')) throw new TypeError('Invalid recommendation channels')
  const query = engine.prepare("SELECT data FROM members WHERE collection = 'subscriptionCache' AND record_id = ? AND field = 'videos' ORDER BY position LIMIT 30")
  // Home learns from the first cached candidates, independently of feed-only
  // channel preferences. Its shared visibility check applies authentication.
  return channelIds.flatMap(id => query.all(id).map(row => ({ ...model.deserialize(row.data), recommendationSources: [{ type: 'subscription', id }] })))
}
