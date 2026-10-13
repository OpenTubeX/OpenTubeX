import model from '@seald-io/nedb/lib/model.js'
import { createHash } from 'node:crypto'
const MAX_TITLE_LENGTH = 10_000
const MAX_DESCRIPTION_LENGTH = 1_000_000
const MAX_THUMBNAIL_DATA_URL_LENGTH = 8_000_000
const EMPTY_THUMBNAIL_DIGEST = createHash('sha256').update('').digest('hex')
const METADATA_FIELD_SQL = new Map([
  ['title', { value: "json_extract(s.data, '$.title')", type: "json_type(s.data, '$.title')" }],
  ['description', { value: "json_extract(s.data, '$.description')", type: "json_type(s.data, '$.description')" }],
  ['thumbnail', { value: "coalesce(b.digest, json_extract(s.data, '$.thumbnailUrl'))", type: "CASE WHEN b.digest IS NOT NULL THEN 'text' ELSE json_type(s.data, '$.thumbnailUrl') END" }]
])

function normalizeText(value, maximumLength) {
  if (typeof value !== 'string') return ''
  const end = value.length > maximumLength && value.codePointAt(maximumLength - 1) > 0xFFFF
    ? maximumLength - 1
    : maximumLength
  return value.slice(0, end)
}

function normalizeThumbnailDataUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_THUMBNAIL_DATA_URL_LENGTH ||
    !/^data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/i.test(value)
  ) {
    return null
  }

  return value
}

function thumbnailChanged(previous, current) {
  if (previous.thumbnailDigest && current.thumbnailDigest) {
    return previous.thumbnailDigest !== current.thumbnailDigest
  }

  return previous.thumbnailUrl !== current.thumbnailUrl
}

function compareRevisions(previous, current) {
  const changedFields = []

  if (previous.title !== current.title) changedFields.push('title')
  if (thumbnailChanged(previous, current)) changedFields.push('thumbnail')
  if (previous.description !== current.description) changedFields.push('description')

  return changedFields
}

function legacyMetadataOrder(engine, videoId) {
  const revision = engine.revision('videoMetadataCache')
  const cached = engine.legacyMetadataOrders.get(videoId)
  if (cached?.revision === revision) return cached.ids
  const legacy = engine.prepare("SELECT 1 FROM records r JOIN metadata_order o ON o.collection = r.collection AND o.record_id = r.id WHERE r.collection = 'videoMetadataCache' AND o.video_id = ? AND json_type(r.data, '$.cachedAt') NOT IN ('integer', 'real') LIMIT 1").get(videoId)
  const tied = engine.prepare("SELECT 1 FROM metadata_order WHERE collection = 'videoMetadataCache' AND video_id = ? GROUP BY sort_time HAVING count(*) > 1 LIMIT 1").get(videoId)
  // Distinct numeric observations keep their indexed path. Retained values and ties need
  // NeDB ordering before slicing; read only sort keys, never thumbnail blobs
  // or unrelated title/description data.
  let ids = null
  if (legacy || tied) {
    const rows = engine.prepare("SELECT r.id, r.data -> '$._id' AS original_id, r.data -> '$.cachedAt' AS cached_at FROM records r JOIN metadata_order o ON o.collection = r.collection AND o.record_id = r.id WHERE r.collection = 'videoMetadataCache' AND o.video_id = ? AND json_type(r.data, '$.cachedAt') IS NOT NULL").all(videoId)
      .map(row => ({ id: row.id, recordId: model.deserialize(row.original_id), cachedAt: model.deserialize(row.cached_at) }))
    ids = rows.toSorted((left, right) => model.compareThings(left.cachedAt, right.cachedAt) || model.compareThings(left.recordId, right.recordId)).map(row => row.id)
  }
  if (engine.legacyMetadataOrders.size >= 2) engine.legacyMetadataOrders.delete(engine.legacyMetadataOrders.keys().next().value)
  engine.legacyMetadataOrders.set(videoId, { revision, ids })
  return ids
}

function inheritedThumbnail(engine, videoId, record, sequence, order = null, id = record._id) {
  const row = order
    ? engine.prepare("SELECT r.data, b.digest FROM json_each(?) j JOIN records r ON r.collection = 'videoMetadataCache' AND r.id = j.value LEFT JOIN record_blobs b ON b.collection = r.collection AND b.record_id = r.id AND b.field = 'thumbnail' WHERE CAST(j.key AS INTEGER) <= ? AND json_extract(r.data, '$.hasThumbnailChange') = 1 ORDER BY CAST(j.key AS INTEGER) DESC LIMIT 1").get(JSON.stringify(order), order.indexOf(id))
    : engine.prepare("SELECT r.data, b.digest FROM records r JOIN metadata_order o ON o.collection = r.collection AND o.record_id = r.id LEFT JOIN record_blobs b ON b.collection = r.collection AND b.record_id = r.id AND b.field = 'thumbnail' WHERE r.collection = 'videoMetadataCache' AND o.video_id = ? AND (o.sort_time < ? OR (o.sort_time = ? AND o.sequence <= ?)) AND json_extract(r.data, '$.hasThumbnailChange') = 1 ORDER BY o.sort_time DESC, o.sequence DESC LIMIT 1").get(videoId, record.cachedAt, record.cachedAt, sequence)
  // Empty legacy strings were falsy in byte comparisons. Nonempty legacy
  // strings remain present even if they are not valid current data URLs.
  return row ? { record: model.deserialize(row.data), digest: row.digest === EMPTY_THUMBNAIL_DIGEST ? null : row.digest } : { record: null, digest: null }
}

async function metadataSummary(engine, videoId) {
  const order = legacyMetadataOrder(engine, videoId)
  const rows = order
    ? engine.prepare("SELECT r.id, r.data FROM json_each(?) j JOIN records r ON r.collection = 'videoMetadataCache' AND r.id = j.value ORDER BY CAST(j.key AS INTEGER) DESC LIMIT 2").all(JSON.stringify(order))
    : engine.prepare("SELECT r.id, r.data, o.sequence FROM records r JOIN metadata_order o ON o.collection = r.collection AND o.record_id = r.id WHERE r.collection = 'videoMetadataCache' AND o.video_id = ? AND json_type(r.data, '$.cachedAt') IS NOT NULL ORDER BY o.sort_time DESC, o.sequence DESC LIMIT 2").all(videoId)
  if (rows.length < 2) return null
  const revisions = rows.map(row => { const record = model.deserialize(row.data); return { ...record, thumbnailDigest: inheritedThumbnail(engine, videoId, record, row.sequence, order, row.id).digest } })
  return compareRevisions(revisions[1], revisions[0]).length ? { videoId, revisionCount: await engine.collections.videoMetadataCache.countAsync({ videoId, cachedAt: { $exists: true } }) } : null
}

/**
 * Keeps every distinct metadata revision for a video. The current thumbnail
 * bytes are supplied by the main process so a replacement is detected even when
 * YouTube reuses the same thumbnail URL.
 *
 * @param {import("./engine.js").LibraryEngine} engine
 * @param {{ videoId: string, title: string, description: string, thumbnailUrl: string, thumbnail: string | null, observedAt?: number }} input
 */
export async function updateVideoMetadataCache(engine, input) {
  if (typeof input?.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId)) throw new TypeError('Invalid video ID')
  const collection = engine.collections.videoMetadataCache
  const order = legacyMetadataOrder(engine, input.videoId)
  const row = order
    ? engine.prepare("SELECT id, data FROM records WHERE collection = 'videoMetadataCache' AND id = ?").get(order.at(-1))
    : engine.prepare("SELECT r.id, r.data, o.sequence FROM records r JOIN metadata_order o ON o.collection = r.collection AND o.record_id = r.id WHERE r.collection = 'videoMetadataCache' AND o.video_id = ? AND json_type(r.data, '$.cachedAt') IS NOT NULL ORDER BY o.sort_time DESC, o.sequence DESC LIMIT 1").get(input.videoId)
  let previous = row ? model.deserialize(row.data) : null
  const inherited = previous ? inheritedThumbnail(engine, input.videoId, previous, row.sequence, order, row.id) : { record: null, digest: null }
  if (previous) previous = { ...previous, thumbnailDigest: inherited.digest }
  const thumbnailUrl = normalizeText(input.thumbnailUrl, 20_000)
  const thumbnail = normalizeThumbnailDataUrl(input.thumbnail)
  let thumbnailDigest = thumbnail && previous ? createHash('sha256').update(thumbnail).digest('hex') : null
  if (!thumbnail && previous && (!thumbnailUrl || thumbnailUrl === previous.thumbnailUrl)) thumbnailDigest = previous.thumbnailDigest
  const current = {
    title: normalizeText(input.title, MAX_TITLE_LENGTH),
    description: normalizeText(input.description, MAX_DESCRIPTION_LENGTH),
    thumbnailUrl,
    thumbnail,
    cachedAt: Number.isSafeInteger(input.observedAt) && input.observedAt > 0 ? Math.min(input.observedAt, Date.now()) : Date.now()
  }
  if (!current.title) return null
  if (previous && !previous.thumbnailDigest && thumbnail && previous.thumbnailUrl === thumbnailUrl && inherited.record) {
    await collection.updateAsync({ _id: inherited.record._id }, { $set: { thumbnail } })
    previous.thumbnailDigest = thumbnailDigest
  }
  // Preserve the released guard's coercion. Type ordering here would discard
  // future numeric observations after retained string or Date timestamps.
  if (previous?.cachedAt > current.cachedAt) return metadataSummary(engine, input.videoId)
  if (!previous) {
    await collection.insertAsync({ videoId: input.videoId, ...current, hasThumbnailChange: true })
    return null
  }
  const changedFields = compareRevisions(previous, { ...current, thumbnailDigest })
  if (changedFields.length) await collection.insertAsync({ videoId: input.videoId, ...current, thumbnail: changedFields.includes('thumbnail') ? current.thumbnail : null, hasThumbnailChange: changedFields.includes('thumbnail') })
  return metadataSummary(engine, input.videoId)
}

export async function metadataPage(engine, options) {
  return engine.read(() => readMetadataPage(engine, options))
}

function readMetadataPage(engine, { videoId, field, cursor = null, limit = 25 }) {
  const definition = METADATA_FIELD_SQL.get(field)
  if (definition === undefined) throw new Error('Invalid metadata field')
  const { value, type } = definition
  if (!Number.isSafeInteger(limit)) throw new TypeError('Invalid metadata page limit')
  const revision = engine.revision('videoMetadataCache')
  if (cursor && cursor.revision !== revision) return { records: [], cursor: null, stale: true }
  const offset = cursor === null ? 0 : cursor.offset
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('Invalid metadata cursor offset')
  const order = legacyMetadataOrder(engine, videoId)
  const ordering = order ? 'CAST(j.key AS INTEGER)' : 'o.sort_time, o.sequence'
  const orderingJoin = order ? 'JOIN json_each(?) j ON j.value = r.id' : ''
  const sql = `WITH source AS (
    SELECT r.id, r.data, row_number() OVER (ORDER BY ${ordering}) AS ordinal FROM records r
      JOIN metadata_order o ON o.collection = r.collection AND o.record_id = r.id
      ${orderingJoin}
      WHERE r.collection = 'videoMetadataCache' AND o.video_id = ? AND json_type(r.data, '$.cachedAt') IS NOT NULL
  ), inherited AS (
    SELECT *, max(CASE WHEN json_extract(data, '$.hasThumbnailChange') = 1 THEN ordinal END) OVER (ORDER BY ordinal ROWS UNBOUNDED PRECEDING) AS thumbnail_ordinal FROM source
  ), values_by_revision AS (
    SELECT s.id, s.data, s.ordinal, t.id AS thumbnail_id, ${value} AS value, ${type} AS raw_type FROM inherited s
      LEFT JOIN source t ON t.ordinal = s.thumbnail_ordinal
      LEFT JOIN record_blobs b ON b.collection = 'videoMetadataCache' AND b.record_id = t.id AND b.field = 'thumbnail'
  ), typed AS (
    SELECT *, CASE WHEN raw_type IN ('integer', 'real') THEN 'number' ELSE raw_type END AS value_type FROM values_by_revision
  ), compared AS (
    SELECT *, lag(value) OVER (ORDER BY ordinal) AS previous_value, lag(value_type) OVER (ORDER BY ordinal) AS previous_type FROM typed
  ), versions AS (
    SELECT *, row_number() OVER (ORDER BY ordinal DESC) AS version FROM compared WHERE ordinal = 1 OR value IS NOT previous_value OR value_type IS NOT previous_type OR value_type IN ('array', 'object')
  ) SELECT id, data, thumbnail_id, value FROM versions WHERE version > 1 ORDER BY ordinal DESC LIMIT ? OFFSET ?`
  const boundedLimit = Math.max(1, Math.min(50, limit))
  const rows = engine.prepare(sql).all(...(order ? [JSON.stringify(order)] : []), videoId, boundedLimit + 1, offset)
  const records = rows.slice(0, boundedLimit).map(row => {
    const record = model.deserialize(row.data)
    return { _id: row.id, cachedAt: record.cachedAt, value: field === 'thumbnail' ? null : record[field], thumbnailRevisionId: field === 'thumbnail' ? row.thumbnail_id : null, thumbnailUrl: record.thumbnailUrl }
  })
  return { records, cursor: rows.length > boundedLimit ? { revision, offset: offset + boundedLimit } : null }
}

export function metadataThumbnail(engine, { id }) {
  const row = engine.prepare("SELECT data FROM record_blobs WHERE collection = 'videoMetadataCache' AND record_id = ? AND field = 'thumbnail'").get(id)
  return row ? model.deserialize(row.data) : null
}
