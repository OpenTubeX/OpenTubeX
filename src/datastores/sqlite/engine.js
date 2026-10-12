import model from '@seald-io/nedb/lib/model.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { ARRAY_FIELDS, COLLECTIONS } from './schema.js'
import { filterVideosWithQuery } from '../../renderer/helpers/historySearch.js'
import { normalizeSearchText } from '../../renderer/helpers/textSearch.js'
import { isHistoryEntryWatched, migrateLegacyHistoryRecord } from '../../history.js'
import { needsHistoryRepair } from '../../historyRepair.js'
import { getSortedPlaylistItems } from '../../renderer/helpers/playlists.js'

const { serialize, modify, match } = model
const MAX_PAGE_SIZE = 250

export function deserialize(data) {
  // Engine rows use NeDB's canonical serialization. Retain its Date reviver
  // for date markers and escaped strings; plain JSON needs no per-field walk.
  return data.includes('$$date') || data.includes('\\') ? model.deserialize(data) : JSON.parse(data)
}

function jsonPath(field) {
  return '$.' + field.split('.').map(part => JSON.stringify(part)).join('.')
}

function scalar(field, alias, collection = null) {
  if (field === '_id' && alias === 'r') return `${alias}.id`
  if (field === 'videoId') return `${alias}.video_id`
  if (field === 'playlistItemId' && alias === 'm') return 'm.item_id'
  if (field === 'timeWatched' && alias === 'r' && collection === 'history') return `${alias}.sort_time`
  return `json_extract(${alias}.data, '${jsonPath(field).replaceAll("'", "''")}')`
}

function bind(value) {
  if (value instanceof Date) return serialize(value)
  if (typeof value === 'boolean') return Number(value)
  if (value !== null && typeof value === 'object') return serialize(value)
  return value ?? null
}

// Unsupported NeDB predicates retain their original verifier. The SQL
// expression is a superset, so candidate generation cannot drop a match.
function compileQuery(query, alias = 'r', normalizedFields = [], collection = null) {
  const unpaired = value => typeof value === 'string' && !value.isWellFormed()
  const compile = (value, currentAlias) => {
    // Literal pulls use NeDB's scalar matching, including arrays and Dates.
    // They must never become an unverified empty object predicate.
    if (value === null || typeof value !== 'object' || value instanceof Date || value instanceof RegExp || Array.isArray(value)) return { sql: '1', parameters: [], verify: true }
    if (currentAlias === 'm' && Object.keys(value).length === 0) return { sql: '1', parameters: [], verify: true }
    const parts = []
    const parameters = []
    let verify = false
    const add = result => { parts.push(result.sql); parameters.push(...result.parameters); verify ||= result.verify }
    for (const [field, condition] of Object.entries(value)) {
      if (field === '$and' || field === '$or') {
        const nested = condition.map(part => compile(part, currentAlias))
        add({ sql: '(' + (nested.map(part => '(' + part.sql + ')').join(field === '$and' ? ' AND ' : ' OR ') || (field === '$and' ? '1' : '0')) + ')', parameters: nested.flatMap(part => part.parameters), verify: nested.some(part => part.verify) })
        continue
      }
      if (field === '$not') {
        const nested = compile(condition, currentAlias)
        add(nested.verify ? { sql: '1', parameters: [], verify: true } : { sql: `NOT (${nested.sql})`, parameters: nested.parameters, verify: false })
        continue
      }
      if (field.startsWith('$') || field.includes('.')) { add({ sql: '1', parameters: [], verify: true }); continue }
      // SQLite replaces unpaired UTF-16 surrogates when binding TEXT. Keep
      // the original NeDB comparison so a query cannot target another value.
      if (unpaired(field) || unpaired(condition) || (condition && typeof condition === 'object' && Object.values(condition).some(argument => unpaired(argument) || (Array.isArray(argument) && argument.some(unpaired))))) {
        add({ sql: '1', parameters: [], verify: true }); continue
      }
      // Normalized thumbnails are represented by null in records.data.
      if (currentAlias === 'r' && collection === 'videoMetadataCache' && field === 'thumbnail') {
        add({ sql: '1', parameters: [], verify: true }); continue
      }
      if (condition?.$elemMatch && currentAlias === 'r') {
        if (!normalizedFields.includes(field)) { add({ sql: '1', parameters: [], verify: true }); continue }
        const nested = compile(condition.$elemMatch, 'm')
        add({ sql: `EXISTS(SELECT 1 FROM members m WHERE m.collection = r.collection AND m.record_id = r.id AND m.field = ? AND (${nested.sql}))`, parameters: [field, ...nested.parameters], verify: nested.verify })
        continue
      }
      const expression = scalar(field, currentAlias, collection)
      const path = jsonPath(field).replaceAll("'", "''")
      const type = `json_type(${currentAlias}.data, '${path}')`
      if (field === 'date' && currentAlias === 'r' && typeof condition === 'string' && collection !== null) {
        // Watch-stat reconstruction probes one date per retained day. Keep
        // complex legacy values as candidates without scanning every day.
        add({ sql: `r.id IN (SELECT id FROM records INDEXED BY records_date WHERE collection = ? AND json_type(data, '${path}') IS NOT NULL AND json_extract(data, '${path}') IS ? UNION SELECT id FROM records INDEXED BY records_date_type WHERE collection = ? AND json_type(data, '${path}') IS NOT NULL AND json_type(data, '${path}') IN ('array', 'object'))`, parameters: [collection, condition, collection], verify: true })
        continue
      }
      const indexedId = (field === '_id' && currentAlias === 'r') || field === 'videoId' || (field === 'playlistItemId' && currentAlias === 'm')
      const guaranteedScalar = field === '_id' && currentAlias === 'r'
      const clauses = []
      const args = []
      let exact = indexedId && !(condition instanceof RegExp)
      if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
        // TEXT affinity can equate a numeric operand with a stored string ID.
        // Keep all candidates for NeDB whenever the operand has another type.
        if (indexedId && typeof condition !== 'string') { clauses.push('1'); exact = false } else { args.push(bind(condition)); clauses.push(`${expression} IS ?`) }
      } else {
        // Empty literal objects/arrays are NeDB values, not an empty operator
        // list that matches every indexed ID. Keep the original verifier.
        if (Object.keys(condition).length === 0) exact = false
        for (const [operator, argument] of Object.entries(condition)) {
          if (operator === '$exists') { clauses.push(`${type} IS ${argument || argument === '' ? 'NOT ' : ''}NULL`); continue }
          if (operator === '$in' || operator === '$nin') {
            if (!Array.isArray(argument) || argument.some(item => (item && typeof item === 'object') || (indexedId && typeof item !== 'string') || (operator === '$nin' && typeof item === 'boolean'))) { clauses.push('1'); exact = false; continue }
            args.push(serialize(argument.map(bind)))
            clauses.push(`coalesce(${expression} ${operator === '$nin' ? 'NOT ' : ''}IN (SELECT value FROM json_each(?)), ${operator === '$nin' ? '1' : '0'})`)
            continue
          }
          const operators = { $ne: 'IS NOT', $lt: '<', $lte: '<=', $gt: '>', $gte: '>=' }
          if (operators[operator]) {
            if (indexedId && typeof argument !== 'string') { clauses.push('1'); exact = false; continue }
            // SQLite compares UTF-8 bytes; NeDB compares UTF-16 code units.
            // Its verifier must see every string candidate, including members.
            // NeDB preserves operand types; SQLite treats booleans as numbers.
            if ((operator !== '$ne' && typeof argument !== 'number') || (operator === '$ne' && typeof argument === 'boolean')) { clauses.push('1'); exact = false; continue }
            args.push(bind(argument)); clauses.push(`${expression} ${operators[operator]} ?`); continue
          }
          clauses.push('1')
          exact = false
        }
      }
      const sql = clauses.join(' AND ') || '1'
      // NeDB matches array elements and traverses documents differently from
      // JSON1. Keep these as candidates and use its original exact verifier.
      // History's numeric sort column falls back for legacy non-number values.
      // Keep those candidates for NeDB verification instead of dropping them.
      const fallbackTypes = field === 'timeWatched' && currentAlias === 'r' && collection === 'history' ? "NOT IN ('integer', 'real')" : "IN ('array', 'object', 'true', 'false')"
      // Member video_id can hold postId when videoId is missing/null. Preserve
      // those candidates for the retained-field verifier, including negatives.
      const indexedFallback = field === 'videoId' && currentAlias === 'm' ? `${type} IS NOT 'text'` : `${expression} IS NULL AND ${type} IS NOT 'text'`
      add({ sql: guaranteedScalar ? sql : indexedId ? `((${sql}) OR (${indexedFallback}))` : `((${sql}) OR ${type} ${fallbackTypes} OR ${type} IS NULL)`, parameters: args, verify: !exact || !guaranteedScalar })
    }
    return { sql: parts.map(part => '(' + part + ')').join(' AND ') || '1', parameters, verify }
  }
  return compile(query, alias)
}

function historyColumns(collection, input) {
  if (collection !== 'history') return [0, 0, null, 0]
  const record = migrateLegacyHistoryRecord(input)
  const progress = Number(record.watchProgress)
  const duration = Number(record.lengthSeconds)
  const continued = record.isWatched !== true && Number.isFinite(progress) && progress > 0 && (!Number.isFinite(duration) || duration <= 0 || progress < duration)
  const premiere = Number(record.premiereTimestamp) * 1000
  const after = record.isLive === true ? null : record.isUpcoming !== true ? 0 : record.premiereTimestamp != null && Number.isFinite(premiere) ? premiere : null
  return [Number(continued), Number(record.isWatched !== true), after, Number(needsHistoryRepair(record))]
}

function legacyHistoryRows(engine, ids) {
  const identities = new Set(ids)
  if (!identities.size) return new Map()
  const newest = new Map()
  // Filter and scan legacy history once, comparing original timestamp types
  // and UTF-16 ID ties. Fetch full documents only for the selected winners.
  for (const row of engine.prepare("SELECT id, data -> '$.videoId' AS legacy_id, data -> '$.timeWatched' AS watched FROM records WHERE collection = 'history' AND video_id IS NULL AND (data -> '$.videoId' IN (SELECT value FROM json_each(?)) OR (? AND data -> '$.videoId' IS NULL))").iterate(JSON.stringify([...identities].filter(id => id !== null)), Number(identities.has(null)))) {
    const time = row.watched === null ? undefined : deserialize(row.watched)
    const previous = newest.get(row.legacy_id)
    if (!previous || (model.compareThings(time, previous.time) || model.compareThings(row.id, previous.id)) > 0) newest.set(row.legacy_id, { id: row.id, time })
  }
  const select = engine.prepare("SELECT data FROM records WHERE collection = 'history' AND id = ?")
  return new Map([...newest].map(([identity, row]) => [identity, select.get(row.id).data]))
}

function hydratePlaylistDurations(engine, entries) {
  const missing = entries.filter(entry => !(Number.isFinite(entry.lengthSeconds) && entry.lengthSeconds > 0))
  const legacy = legacyHistoryRows(engine, missing.filter(entry => typeof entry.videoId !== 'string' && (entry.videoId == null || ['number', 'boolean'].includes(typeof entry.videoId))).map(entry => entry.videoId === undefined ? null : serialize(entry.videoId)))
  for (let offset = 0; offset < missing.length; offset += MAX_PAGE_SIZE) {
    const batch = missing.slice(offset, offset + MAX_PAGE_SIZE)
    const latest = engine.latestHistoryRows(batch.map(entry => entry.videoId))
    for (const entry of batch) {
      const data = typeof entry.videoId === 'string'
        ? latest.get(entry.videoId)?.data
        : legacy.get(entry.videoId === undefined ? null : serialize(entry.videoId))
      if (data) entry.lengthSeconds = deserialize(data).lengthSeconds
    }
  }
}

function queryReferencesFields(query, fields) {
  return Object.entries(query).some(([field, condition]) => {
    if (field === '$and' || field === '$or') return condition.some(part => queryReferencesFields(part, fields))
    if (field === '$not') return queryReferencesFields(condition, fields)
    // Opaque predicates such as $where can inspect any stored field.
    return field.startsWith('$') || fields.includes(field.split('.')[0])
  })
}

function upsertQueryDocument(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value) || value instanceof Date) return value
  if (Array.isArray(value)) return value.map(upsertQueryDocument)
  if (typeof value !== 'object') return undefined
  // Match NeDB's strict query copy, preserving own prototype keys before
  // safeModify handles the modifier. Operators and dotted query keys are omitted.
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith('$') && !key.includes('.'))
    .map(([key, child]) => [key, upsertQueryDocument(child)]))
}

// NeDB's modifier clones objects into `{}` and can lose an own __proto__
// property. Encode prototype keys before using its update semantics, then
// restore them as own data properties. Never mutate the shared model module.
function safeModify(record, update) {
  const keys = new Set()
  const scan = value => {
    if (!value || typeof value !== 'object' || value instanceof Date) return
    for (const [key, child] of Object.entries(value)) { keys.add(key); scan(child) }
  }
  scan(record); scan(update)
  const dangerous = ['__proto__', 'constructor', 'prototype']
  if (!dangerous.some(key => keys.has(key) || [...keys].some(path => path.split('.').includes(key)))) return modify(record, update)
  const replacements = new Map()
  for (const key of dangerous) {
    let alias
    do { alias = 'library_' + randomUUID().replaceAll('-', '') } while (keys.has(alias))
    replacements.set(key, alias)
  }
  const transform = (value, names, paths = false) => {
    if (!value || typeof value !== 'object' || value instanceof Date) return value
    if (Array.isArray(value)) return value.map(child => transform(child, names))
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [paths ? key.split('.').map(part => names.get(part) ?? part).join('.') : names.get(key) ?? key, transform(child, names)]))
  }
  const encodedUpdate = Object.fromEntries(Object.entries(update).map(([operator, values]) => [operator, transform(values, replacements, true)]))
  return transform(modify(transform(record, replacements), encodedUpdate), new Map([...replacements].map(([key, alias]) => [alias, key])))
}

function project(record, projection) {
  if (!projection || Object.keys(projection).length === 0) return record
  const entries = Object.entries(projection).filter(([key]) => key !== '_id')
  const action = entries[0]?.[1]
  if (entries.some(([, value]) => value !== action)) throw new Error("Can't both keep and omit fields except for _id")
  const result = action === 1
    ? safeModify({}, { $set: Object.fromEntries(entries.map(([key]) => [key, model.getDotValue(record, key)]).filter(([, value]) => value !== undefined)) })
    : safeModify(record, { $unset: Object.fromEntries(entries.map(([key]) => [key, true])) })
  if (projection._id === 0) delete result._id
  else result._id = record._id
  return result
}

function projectionOptions(collection, projection, query = {}) {
  const included = Object.entries(projection ?? {}).filter(([key, value]) => key !== '_id' && value === 1)
  const needsField = field => included.length
    ? included.some(([key]) => key.split('.')[0] === field)
    : projection?.[field] !== 0
  const fields = ARRAY_FIELDS[collection] ?? []
  return {
    arrays: fields.some(needsField) || queryReferencesFields(query, fields),
    blobs: needsField('thumbnail') || queryReferencesFields(query, ['thumbnail']),
  }
}

export class LibraryEngine {
  constructor(database) {
    this.database = database
    this.statements = new Map()
    this.searchCharacterFolds = new Map()
    this.transactionDepth = 0
    this.transactionContext = new AsyncLocalStorage()
    this.pendingTransaction = Promise.resolve()
    this.playlistOrders = new Map()
    this.playlistStatisticsCache = new Map()
    this.legacyMetadataOrders = new Map()
    this.database.exec('CREATE TEMP TABLE playlist_orders (view_id TEXT NOT NULL, rank INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(view_id, rank)) WITHOUT ROWID')
    this.database.function('history_watched', data => Number(data ? isHistoryEntryWatched(deserialize(data)) : false))
    this.database.function('nedb_id_sort', { deterministic: true }, id => Buffer.from(id, 'utf16le').swap16())
    this.collections = Object.fromEntries(Object.keys(COLLECTIONS).map(name => [name, new Collection(this, name)]))
  }

  prepare(sql) {
    if (this.failure) throw this.failure
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.database.prepare(sql)
      // Queries vary with sort/projection. Bound the prepared statement cache.
      if (this.statements.size >= 128) this.statements.delete(this.statements.keys().next().value)
      this.statements.set(sql, statement)
    }
    return statement
  }

  compact() {
    if (this.transactionDepth) throw new Error('Cannot compact the library inside a transaction')
    const checkpoint = () => {
      const { busy } = this.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
      if (busy) throw new Error('The library is in use; retry storage compaction when the reader has finished')
    }
    // Flush and release the existing WAL before VACUUM needs temporary space.
    // SQLite commits the rebuild through its WAL; never replace files by hand.
    checkpoint()
    if (this.prepare('PRAGMA freelist_count').get().freelist_count > 0) this.database.exec('VACUUM')
    checkpoint()
    return true
  }

  async transaction(operation) {
    if (this.failure) throw this.failure
    const context = this.transactionContext.getStore()
    if (!context?.active) {
      // Only async descendants of the active owner may join its transaction.
      // Independent requests wait even when that owner yields to a handler.
      const result = this.pendingTransaction.then(() => this.transactionContext.run({ active: true }, () => this.transaction(operation)))
      this.pendingTransaction = result.then(() => {}, () => {})
      return result
    }
    const outermost = this.transactionDepth === 0
    if (outermost) {
      try { this.database.exec('BEGIN IMMEDIATE') } catch (error) { context.active = false; throw error }
    }
    this.transactionDepth++
    try {
      const result = await operation()
      if (outermost) this.database.exec('COMMIT')
      return result
    } catch (error) {
      if (outermost) {
        try { this.database.exec('ROLLBACK') } catch {
          // Automatic rollback leaves no active transaction. If rollback really
          // failed, prevent later requests from observing or committing it.
          if (this.database.isTransaction !== false) this.failure = error
        } finally {
          if (!this.failure) {
            try {
              // Rollback restores older TEMP rows, including ones evicted by
              // the aborted operation. Remove them before losing their IDs.
              this.database.exec('DELETE FROM playlist_orders')
              // A table first created inside the transaction may roll back too.
              if (this.subscriptionViews && this.database.prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'subscription_views'").get()) this.database.exec('DELETE FROM subscription_views')
            } catch { this.failure = error }
          }
          this.playlistOrders.clear()
          this.playlistStatisticsCache.clear()
          this.legacyMetadataOrders.clear()
          this.subscriptionViews?.clear()
          this.legacyHistoryPage = null
          this.legacyOrderedHistory = null
        }
      }
      throw error
    } finally {
      this.transactionDepth--
      if (outermost) context.active = false
    }
  }

  async read(operation) {
    if (this.failure) throw this.failure
    if (this.transactionContext.getStore()?.active) return operation()
    // Collection reads finish synchronously. Queue independent readers with
    // writers so they cannot see a suspended owner's uncommitted changes,
    // without opening an extra SQLite transaction for each read.
    const result = this.pendingTransaction.then(() => { if (this.failure) throw this.failure; return operation() })
    this.pendingTransaction = result.then(() => {}, () => {})
    return result
  }

  touch(collection) {
    if (collection === 'history') {
      this.legacyHistoryPage = null
      this.legacyOrderedHistory = null
    }
    if (collection === 'videoMetadataCache') this.legacyMetadataOrders.clear()
    this.prepare('INSERT INTO revisions(collection, revision) VALUES (?, 1) ON CONFLICT(collection) DO UPDATE SET revision = revision + 1').run(collection)
  }

  revision(collection) {
    return this.prepare('SELECT revision FROM revisions WHERE collection = ?').get(collection)?.revision ?? 0
  }

  materialize(collection, row, { arrays = true, blobs = true } = {}) {
    const record = deserialize(row.data)
    if (arrays) {
      for (const { field } of this.prepare('SELECT field FROM record_arrays WHERE collection = ? AND record_id = ?').all(collection, row.id)) {
        record[field] = this.prepare('SELECT data FROM members WHERE collection = ? AND record_id = ? AND field = ? ORDER BY position').all(collection, row.id, field).map(entry => deserialize(entry.data))
      }
    }
    if (blobs) {
      for (const { field, data } of this.prepare('SELECT field, data FROM record_blobs WHERE collection = ? AND record_id = ?').all(collection, row.id)) record[field] = deserialize(data)
    }
    return record
  }

  write(collection, input, replace = false) {
    // Serialization validates every field before any persisted row changes.
    return this.writeSerialized(collection, serialize(input), replace)
  }

  writeSerialized(collection, serializedInput, replace = false, replayArrays = false) {
    const record = deserialize(serializedInput)
    record._id ??= randomUUID()
    if (typeof record._id !== 'string' || !record._id) throw new TypeError('A record must have a nonempty string ID')
    if (!record._id.isWellFormed()) throw new TypeError('A record ID contains an unpaired UTF-16 surrogate and cannot be safely stored in SQLite')
    const arrays = new Map()
    for (const field of ARRAY_FIELDS[collection] ?? []) {
      if (Array.isArray(record[field])) {
        arrays.set(field, record[field])
        record[field] = []
      }
    }
    const blobs = new Map()
    if (collection === 'videoMetadataCache' && typeof record.thumbnail === 'string') {
      blobs.set('thumbnail', record.thumbnail)
      record.thumbnail = null
    }
    // A member can fit SQLite's JSON depth limit while its enclosing legacy
    // document cannot. Retain the per-member codec for that valid input.
    const canReplayArrays = replayArrays && arrays.size > 0 && this.prepare('SELECT json_valid(?) AS valid').get(serializedInput).valid === 1
    const videoId = typeof record.videoId === 'string' ? record.videoId : null
    const encodedVideoId = videoId !== null && !videoId.isWellFormed()
    // Keep retained surrogate bytes in the index; normal IDs keep their direct bind.
    const sql = `INSERT INTO records(collection, id, data, video_id, sort_time, continue_candidate, unwatched_candidate, watchable_after, repair_candidate) VALUES (?, ?, ?, ${encodedVideoId ? "json_extract(?, '$')" : '?'}, ?, ?, ?, ?, ?)` +
      (replace ? ' ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, video_id = excluded.video_id, sort_time = excluded.sort_time, continue_candidate = excluded.continue_candidate, unwatched_candidate = excluded.unwatched_candidate, watchable_after = excluded.watchable_after, repair_candidate = excluded.repair_candidate' : '')
    this.prepare(sql).run(collection, record._id, serialize(record), encodedVideoId ? JSON.stringify(videoId) : videoId,
      Number.isFinite(record.timeWatched) ? record.timeWatched : Number.isFinite(record.cachedAt) ? record.cachedAt : 0, ...historyColumns(collection, record))
    if (replace) {
      this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field NOT IN (SELECT value FROM json_each(?))').run(collection, record._id, JSON.stringify([...arrays.keys()]))
      this.prepare('DELETE FROM record_blobs WHERE collection = ? AND record_id = ?').run(collection, record._id)
    }
    for (const [field, entries] of arrays) {
      if (canReplayArrays && entries.every(entry => entry !== null && typeof entry === 'object')) this.replayArray(collection, record._id, field, serializedInput, record[field + 'Timestamp'], entries.length === 0)
      else this.replaceArray(collection, record._id, field, entries, record[field + 'Timestamp'])
    }
    for (const [field, data] of blobs) this.prepare('INSERT INTO record_blobs VALUES (?, ?, ?, ?, ?)').run(collection, record._id, field, serialize(data), createHash('sha256').update(data).digest('hex'))
    if (collection === 'history') this.indexSearch(record)
    for (const [field, entries] of arrays) record[field] = entries
    for (const [field, data] of blobs) record[field] = data
    return record
  }

  replayArray(collection, id, field, serializedInput, timestamp, empty) {
    // Staging has no externally visible membership IDs. Split its validated
    // NeDB JSON directly in SQLite instead of encoding every member again.
    // JSONB avoids reparsing each member for its indexed fields; json(value)
    // retains the same NeDB JSON text on disk and its independent verification.
    this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').run(collection, id, field)
    this.prepare('INSERT INTO record_arrays(collection, record_id, field) VALUES (?, ?, ?)').run(collection, id, field)
    // Empty shorts beside a large videos array need no second source parse.
    // Keep the array marker and deletion above for exact empty-array restores.
    if (empty) return
    const time = collection === 'subscriptionCache' ? new Date(timestamp).getTime() : 0
    this.prepare(`INSERT INTO members SELECT ?, ?, ?, CAST(key AS INTEGER), ? || ':' || key,
      CASE WHEN type = 'object' AND json_type(value, '$.playlistItemId') = 'text' THEN json_extract(value, '$.playlistItemId') END,
      CASE WHEN type = 'object' THEN CASE
        WHEN json_type(value, '$.videoId') = 'text' THEN json_extract(value, '$.videoId')
        WHEN json_type(value, '$.videoId') IS NULL OR json_type(value, '$.videoId') = 'null' THEN
          CASE WHEN json_type(value, '$.postId') = 'text' THEN json_extract(value, '$.postId') END
      END END,
      json(value),
      ? FROM jsonb_each(?, ?)`)
      .run(collection, id, field, randomUUID(), Number.isFinite(time) ? time : 0, serializedInput, '$.' + JSON.stringify(field))
  }

  indexSearch(record) {
    this.prepare("DELETE FROM search_characters WHERE collection = 'history' AND record_id = ?").run(record._id)
    // Include default and Turkic folding. Other locale folds use the same
    // characters; verification always uses the requested locale and case rule.
    const text = [record.title, record.author].filter(value => typeof value === 'string').join(' ')
    const foldCharacter = character => {
      let folded = this.searchCharacterFolds.get(character)
      if (folded === undefined) {
        folded = normalizeSearchText(character, 'en-US')
        if (this.searchCharacterFolds.size >= 1024) this.searchCharacterFolds.delete(this.searchCharacterFolds.keys().next().value)
        this.searchCharacterFolds.set(character, folded)
      }
      return folded
    }
    const characters = new Set(normalizeSearchText(text, 'en-US') + normalizeSearchText(text, 'tr-TR') + [...text].map(foldCharacter).join(''))
    const insert = this.prepare("INSERT INTO search_characters VALUES ('history', ?, ?)")
    for (const character of characters) if (character.trim()) insert.run(record._id, character)
  }

  replaceArray(collection, id, field, entries, timestamp) {
    const identity = entry => serialize([entry?.playlistItemId ?? null, entry?.videoId ?? entry?.postId ?? null, entry?.playlistItemId == null ? entry?.timeAdded ?? null : null])
    const previous = new Map()
    for (const row of this.prepare('SELECT membership_id, created_at, data FROM members WHERE collection = ? AND record_id = ? AND field = ? ORDER BY position').iterate(collection, id, field)) {
      const key = identity(deserialize(row.data))
      if (!previous.has(key)) previous.set(key, { ids: [], offset: 0 })
      previous.get(key).ids.push({ id: row.membership_id, createdAt: row.created_at })
    }
    this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').run(collection, id, field)
    this.prepare('INSERT INTO record_arrays(collection, record_id, field) VALUES (?, ?, ?)').run(collection, id, field)
    this.appendArray(collection, id, field, entries, timestamp, entry => { const old = previous.get(identity(entry)); return old?.ids[old.offset++] })
  }

  appendArray(collection, id, field, entries, timestamp, previousMembership = () => undefined) {
    this.prepare('INSERT OR IGNORE INTO record_arrays(collection, record_id, field) VALUES (?, ?, ?)').run(collection, id, field)
    let position = this.prepare('SELECT next_position FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').get(collection, id, field).next_position
    const statement = this.prepare("INSERT INTO members SELECT ?, ?, ?, ? + CAST(key AS INTEGER), json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[4]') FROM json_each(?)")
    const time = collection === 'subscriptionCache' ? new Date(timestamp).getTime() : 0
    const createdAt = Number.isFinite(time) ? time : 0
    for (let offset = 0; offset < entries.length; offset += 250) {
      const rows = entries.slice(offset, offset + 250).map(entry => {
        const videoId = entry?.videoId ?? entry?.postId
        const previous = previousMembership(entry)
        return [previous?.id ?? randomUUID(), typeof entry?.playlistItemId === 'string' ? entry.playlistItemId : null,
          typeof videoId === 'string' ? videoId : null, serialize(entry), previous?.createdAt ?? createdAt]
      })
      statement.run(collection, id, field, position, JSON.stringify(rows))
      position += rows.length
    }
  }

  update(collection, row, update) {
    // Apply scalar modifiers to just the metadata row. Array operators use
    // indexed member rows and preserve positions and duplicate membership IDs.
    const normalized = ARRAY_FIELDS[collection] ?? []
    for (const [operator, values] of Object.entries(update)) {
      for (const field of Object.keys(values)) {
        const root = field.split('.')[0]
        if (!normalized.includes(root)) continue
        if (field !== root || !['$set', '$unset', '$push', '$pull'].includes(operator)) throw new Error('Unsupported normalized array modifier')
      }
    }
    const scalarUpdate = Object.fromEntries(Object.entries(update).map(([operator, values]) => [operator,
      Object.fromEntries(Object.entries(values).filter(([field]) => !normalized.includes(field)))
    ]).filter(([, values]) => Object.keys(values).length))
    const previous = this.materialize(collection, row, { arrays: false })
    const record = Object.keys(scalarUpdate).length ? safeModify(previous, scalarUpdate) : previous
    for (const [operator, values] of Object.entries(update)) {
      for (const field of normalized) {
        if (!Object.hasOwn(values, field)) continue
        if (operator === '$set') {
          const value = values[field]
          if (Array.isArray(value)) { this.replaceArray(collection, row.id, field, value, record[field + 'Timestamp']); record[field] = [] } else { this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').run(collection, row.id, field); record[field] = value }
        }
        if (operator === '$unset') {
          this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').run(collection, row.id, field)
          delete record[field]
        }
        if (operator === '$push') {
          if (Object.hasOwn(record, field) && !Array.isArray(record[field])) throw new Error("Can't $push an element on non-array values")
          const value = values[field]
          if (value?.$slice !== undefined || value?.$position !== undefined || value?.$sort !== undefined) throw new Error('Unsupported playlist array modifier')
          this.appendArray(collection, row.id, field, value?.$each ?? [value], record[field + 'Timestamp'])
          record[field] = []
        }
        if (operator === '$pull') {
          if (Object.hasOwn(record, field) && !Array.isArray(record[field])) throw new Error("Can't $pull an element from non-array values")
          const predicate = values[field]
          const compiled = compileQuery(predicate, 'm')
          if (!compiled.verify) this.prepare(`DELETE FROM members AS m WHERE collection = ? AND record_id = ? AND field = ? AND (${compiled.sql})`).run(collection, row.id, field, ...compiled.parameters)
          else {
            const positions = []
            for (const entry of this.prepare('SELECT position, data FROM members WHERE collection = ? AND record_id = ? AND field = ?').iterate(collection, row.id, field)) {
              if (match(deserialize(entry.data), predicate)) positions.push(entry.position)
            }
            const remove = this.prepare('DELETE FROM members WHERE collection = ? AND record_id = ? AND field = ? AND position = ?')
            for (const position of positions) remove.run(collection, row.id, field, position)
          }
        }
      }
    }
    let thumbnail = null
    if (collection === 'videoMetadataCache' && typeof record.thumbnail === 'string') { thumbnail = record.thumbnail; record.thumbnail = null }
    const videoId = typeof record.videoId === 'string' ? record.videoId : null
    const encodedVideoId = videoId !== null && !videoId.isWellFormed()
    this.prepare(`UPDATE records SET data = ?, video_id = ${encodedVideoId ? "json_extract(?, '$')" : '?'}, sort_time = ?, continue_candidate = ?, unwatched_candidate = ?, watchable_after = ?, repair_candidate = ? WHERE collection = ? AND id = ?`).run(serialize(record), encodedVideoId ? JSON.stringify(videoId) : videoId, Number.isFinite(record.timeWatched) ? record.timeWatched : Number.isFinite(record.cachedAt) ? record.cachedAt : 0, ...historyColumns(collection, record), collection, row.id)
    if (collection === 'videoMetadataCache') {
      this.prepare('DELETE FROM record_blobs WHERE collection = ? AND record_id = ?').run(collection, row.id)
      if (thumbnail !== null) this.prepare('INSERT INTO record_blobs VALUES (?, ?, ?, ?, ?)').run(collection, row.id, 'thumbnail', serialize(thumbnail), createHash('sha256').update(thumbnail).digest('hex'))
    }
    if (collection === 'history' && ['title', 'author'].some(field => {
      const before = typeof previous[field] === 'string' ? previous[field] : ''
      const after = typeof record[field] === 'string' ? record[field] : ''
      return before !== after
    })) this.indexSearch(record)
  }

  historyPage({ cursor = null, limit = 100, oldest = false, query = '', caseSensitive = false, locale = 'en-US' } = {}) {
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 100))
    const revision = this.revision('history')
    const spec = JSON.stringify([oldest, query, caseSensitive, locale])
    if (cursor && (cursor.revision !== revision || cursor.spec !== spec)) return { stale: true, revision, records: [], cursor: null }
    const comparator = oldest ? '>' : '<'
    const direction = oldest ? 'ASC' : 'DESC'
    const parameters = []
    const tokens = normalizeSearchText(query, locale).split(/\s+/).filter(Boolean)
    // The existing matcher compares UTF-16 units, which can match surrogate
    // halves across distinct characters. Whole-character anchors
    // cannot safely narrow those tokens; retain the matcher for verification.
    const candidates = tokens.filter(token => !/[\uD800-\uDFFF]/.test(token)).map(token => {
      // A fuzzy match may delete/substitute at most two query characters.
      // Any of k+1 anchors must survive; subsequence and substring matches
      // retain all anchors. This index only narrows the candidate superset.
      const edits = caseSensitive ? 0 : token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0
      const anchors = [...new Set([...token].slice(0, edits + 1))]
      parameters.push(JSON.stringify(anchors))
      return "id IN (SELECT record_id FROM search_characters WHERE collection = 'history' AND character IN (SELECT value FROM json_each(?)))"
    })
    const where = candidates.length ? `AND (${candidates.join(' AND ')})` : ''
    const legacy = this.prepare('SELECT 1 FROM records r WHERE r.collection = \'history\' AND (json_type(r.data, \'$."timeWatched"\') IS NULL OR json_type(r.data, \'$."timeWatched"\') NOT IN (\'integer\', \'real\')) = 1 LIMIT 1').get()
    if (legacy) {
      // Legacy timestamps retain their original types. Cache only ordered IDs
      // for one revision/view, so subsequent pages avoid reparsing and sorting
      // the entire history while returned documents remain fresh copies.
      const key = JSON.stringify([revision, spec])
      if (this.legacyHistoryPage?.key !== key) {
        const ordered = []
        for (const row of this.prepare(`SELECT id, data FROM records WHERE collection = 'history' ${where}`).iterate(...parameters)) {
          const record = deserialize(row.data)
          if (query.trim() && filterVideosWithQuery([record], query, caseSensitive, locale).length === 0) continue
          ordered.push({ id: row.id, time: record.timeWatched })
        }
        const direction = oldest ? 1 : -1
        ordered.sort((a, b) => direction * (model.compareThings(a.time, b.time) || model.compareThings(a.id, b.id)))
        this.legacyHistoryPage = { key, ids: ordered.map(row => row.id) }
      }
      const offset = cursor?.offset ?? 0
      const ids = this.legacyHistoryPage.ids
      const statement = this.prepare("SELECT data FROM records WHERE collection = 'history' AND id = ?")
      const records = ids.slice(offset, offset + limit).map(id => migrateLegacyHistoryRecord(deserialize(statement.get(id).data)))
      return { records, revision, total: this.collections.history.count(), cursor: offset + limit < ids.length ? { offset: offset + limit, revision, spec } : null }
    }
    const after = cursor ? `AND (sort_time, nedb_id_sort(id)) ${comparator} (?, nedb_id_sort(?))` : ''
    if (cursor) parameters.unshift(cursor.time, cursor.id)
    const statement = this.prepare(`SELECT id, data, sort_time FROM records WHERE collection = 'history' ${after} ${where} ORDER BY sort_time ${direction}, nedb_id_sort(id) ${direction}`)
    const records = []
    let last = null
    let more = false
    for (const row of statement.iterate(...parameters)) {
      const record = migrateLegacyHistoryRecord(deserialize(row.data))
      if (query.trim() && filterVideosWithQuery([record], query, caseSensitive, locale).length === 0) continue
      if (records.length === limit) { more = true; break }
      records.push(record)
      last = row
    }
    return { records, revision, total: this.collections.history.count(), cursor: more ? { time: last.sort_time, id: last.id, revision, spec } : null }
  }

  playlistSummaries() {
    return this.prepare("SELECT r.id, r.data, coalesce(a.length, 0) AS count, (a.record_id IS NOT NULL) AS array_backed FROM records r LEFT JOIN record_arrays a ON a.collection = r.collection AND a.record_id = r.id AND a.field = 'videos' WHERE r.collection = 'playlists' ORDER BY r.id").all()
      .map(row => {
        const first = this.prepare("SELECT data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position LIMIT 1").get(row.id)
        const record = deserialize(row.data)
        return { ...record, videoCount: row.count, firstVideo: first ? deserialize(first.data) : null, videos: row.array_backed ? [] : record.videos }
      })
  }

  playlistStatistics({ id, includeExpiry = false }) {
    // Metadata reloads can request the same full-library statistics repeatedly.
    // Reuse unchanged revisions only until the next watchable premiere.
    // Rollback discards aborted snapshots; backwards clock changes expire them.
    const key = JSON.stringify([id, this.revision('playlists'), this.revision('history')])
    const now = Date.now()
    const snapshot = entry => includeExpiry
      ? { ...entry.result, refreshAt: Number.isFinite(entry.expiresAt) ? entry.expiresAt : null }
      : { ...entry.result }
    const cached = this.playlistStatisticsCache.get(key)
    if (cached && now >= cached.createdAt && now < cached.expiresAt) return snapshot(cached)
    const validDuration = "json_type(data, '$.lengthSeconds') IN ('integer', 'real') AND json_extract(data, '$.lengthSeconds') > 0"
    const counts = this.prepare(`SELECT count(*) AS total, count(DISTINCT video_id) AS uniqueCount, coalesce(sum(CASE WHEN ${validDuration} THEN json_extract(data, '$.lengthSeconds') ELSE 0 END), 0) AS duration, coalesce(sum(CASE WHEN ${validDuration} THEN 0 ELSE 1 END), 0) AS missingDuration FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos'`).get(id)
    let watchedCount = 0
    let expiresAt = Infinity
    const applyHistory = row => {
      const history = row.history ? deserialize(row.history) : null
      if (history && isHistoryEntryWatched(history, now)) watchedCount += row.count
      if (history?.isUpcoming === true && history.premiereTimestamp != null) {
        const premiere = Number(history.premiereTimestamp) * 1000
        if (Number.isFinite(premiere) && premiere > now && isHistoryEntryWatched(history, premiere)) expiresAt = Math.min(expiresAt, premiere)
      }
      const duration = history?.lengthSeconds
      if (Number.isFinite(duration) && duration > 0) { counts.duration += duration * row.missing; counts.missingDuration -= row.missing }
    }
    const applyBatch = rows => {
      const latest = this.latestHistoryRows(rows.map(row => row.video_id))
      for (const row of rows) applyHistory({ ...row, history: latest.get(row.video_id)?.data })
    }
    let batch = []
    for (const row of this.prepare("SELECT coalesce(nullif(m.data -> '$.videoId', 'null'), m.data -> '$.postId') AS original_video_id, m.video_id, count(*) AS count, sum(CASE WHEN json_type(m.data, '$.lengthSeconds') IN ('integer', 'real') AND json_extract(m.data, '$.lengthSeconds') > 0 THEN 0 ELSE 1 END) AS missing FROM members m WHERE m.collection = 'playlists' AND m.record_id = ? AND m.field = 'videos' AND m.video_id IS NOT NULL GROUP BY m.video_id").iterate(id)) {
      batch.push({ ...row, video_id: deserialize(row.original_video_id) })
      if (batch.length === MAX_PAGE_SIZE) { applyBatch(batch); batch = [] }
    }
    applyBatch(batch)
    // Retained legacy scalar IDs cannot populate the text index. Preserve their
    // JSON types without loading full members, arrays or thumbnails. Object IDs
    // have distinct reference identity, as in the portable Set/Map contract.
    const legacyMembers = new Map()
    for (const row of this.prepare(`SELECT data -> '$.videoId' AS legacy_id, count(*) AS count, sum(CASE WHEN ${validDuration} THEN 0 ELSE 1 END) AS missing FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IS NULL GROUP BY legacy_id`).iterate(id)) {
      const videoId = row.legacy_id === null ? undefined : deserialize(row.legacy_id)
      const objectId = videoId !== null && typeof videoId === 'object'
      counts.uniqueCount += objectId ? row.count : 1
      if (!objectId) legacyMembers.set(row.legacy_id, row)
    }
    for (const [identity, history] of legacyHistoryRows(this, legacyMembers.keys())) applyHistory({ ...legacyMembers.get(identity), history })
    const result = { ...counts, watchedCount }
    if (this.playlistStatisticsCache.size >= 2) this.playlistStatisticsCache.delete(this.playlistStatisticsCache.keys().next().value)
    const entry = { result, createdAt: now, expiresAt }
    this.playlistStatisticsCache.set(key, entry)
    return snapshot(entry)
  }

  playlistSnapshot({ id }) { return this.collections.playlists.findOneAsync({ _id: id }) }

  latestHistoryRows(videoIds) {
    const ids = [...new Set(videoIds.filter(id => typeof id === 'string'))]
    if (!ids.length) return new Map()
    const parameter = JSON.stringify(ids)
    const compiled = { sql: 'r.video_id IN (SELECT value FROM json_each(?))', parameters: [parameter] }
    if (!this.collections.history.hasLegacyHistoryTimestamps(compiled)) {
      // Keep the bounded requested IDs outside the correlated winner lookup;
      // reversing the join would run it once for every history row.
      return new Map(this.prepare("SELECT videos.key AS requested_position, h.id, h.video_id, h.data FROM json_each(?) AS videos CROSS JOIN records h ON h.collection = 'history' AND h.id = (SELECT id FROM records WHERE collection = 'history' AND video_id = videos.value ORDER BY sort_time DESC, nedb_id_sort(id) DESC LIMIT 1)").all(parameter).map(row => [ids[Number(row.requested_position)], row]))
    }
    const newest = new Map()
    for (const row of this.prepare(`SELECT r.id, r.video_id, r.data -> '$.videoId' AS original_video_id, r.data -> '$.timeWatched' AS watched FROM records r WHERE r.collection = 'history' AND (${compiled.sql})`).iterate(parameter)) {
      const time = row.watched === null ? undefined : deserialize(row.watched)
      const videoId = deserialize(row.original_video_id)
      const previous = newest.get(videoId)
      if (!previous || (model.compareThings(time, previous.time) || model.compareThings(row.id, previous.id)) > 0) newest.set(videoId, { id: row.id, time })
    }
    const select = this.prepare("SELECT id, video_id, data FROM records WHERE collection = 'history' AND id = ?")
    return new Map([...newest].map(([videoId, row]) => [videoId, select.get(row.id)]))
  }

  * orderedHistoryRows({ where = '1', parameters = [], idDirection = -1, offset = 0, limit = null, watchableAt = null } = {}) {
    if (this.collections.history.hasLegacyHistoryTimestamps({ sql: where, parameters })) {
      const key = JSON.stringify(['ordered', this.revision('history'), where, parameters, idDirection])
      if (this.legacyOrderedHistory?.key !== key) {
        const rows = this.prepare(`SELECT r.id, r.watchable_after, r.data -> '$.timeWatched' AS watched FROM records r WHERE r.collection = 'history' AND (${where})`).all(...parameters)
          .map(row => ({ ...row, time: row.watched === null ? undefined : deserialize(row.watched) }))
        rows.sort((left, right) => model.compareThings(right.time, left.time) || idDirection * model.compareThings(left.id, right.id))
        this.legacyOrderedHistory = { key, rows }
      }
      const rows = watchableAt === null ? this.legacyOrderedHistory.rows : this.legacyOrderedHistory.rows.filter(row => row.watchable_after !== null && row.watchable_after <= watchableAt)
      const select = this.prepare("SELECT id, data FROM records WHERE collection = 'history' AND id = ?")
      for (const row of rows.slice(offset, limit === null ? undefined : offset + limit)) yield select.get(row.id)
      return
    }
    const gate = watchableAt === null ? '' : 'AND r.watchable_after <= ?'
    const bounded = limit !== null || offset > 0
    const bound = bounded ? 'LIMIT ? OFFSET ?' : ''
    const direction = idDirection < 0 ? 'DESC' : 'ASC'
    yield * this.prepare(`SELECT r.id, r.data FROM records r WHERE r.collection = 'history' AND (${where}) ${gate} ORDER BY r.sort_time DESC, nedb_id_sort(r.id) ${direction} ${bound}`).iterate(...parameters, ...(watchableAt === null ? [] : [watchableAt]), ...(bounded ? [limit ?? -1, offset] : []))
  }

  async videoState({ ids }) {
    return this.read(() => {
      if (!Array.isArray(ids) || ids.length > MAX_PAGE_SIZE || ids.some(id => typeof id !== 'string')) throw new TypeError('Invalid video state query')
      const latest = this.latestHistoryRows(ids)
      const history = ids.flatMap(id => { const row = latest.get(id); return row ? [migrateLegacyHistoryRecord(deserialize(row.data))] : [] })
      const memberships = this.prepare("WITH requested AS (SELECT min(key) AS position, value FROM json_each(?) GROUP BY value) SELECT requested.position, m.record_id AS playlistId, count(*) AS count FROM requested CROSS JOIN members m ON m.collection = 'playlists' AND m.field = 'videos' AND m.video_id = requested.value GROUP BY requested.position, m.record_id ORDER BY requested.position, m.record_id").all(JSON.stringify(ids))
        .map(row => ({ videoId: ids[Number(row.position)], playlistId: row.playlistId, count: row.count }))
      return { history, memberships }
    })
  }

  historySummary() {
    const now = Date.now()
    const continued = this.continuedHistoryPage({ limit: 50 })
    const unwatched = !!this.prepare("SELECT 1 FROM records WHERE collection = 'history' AND unwatched_candidate = 1 AND watchable_after <= ? LIMIT 1").get(now)
    return { total: this.collections.history.count(), unwatched, continued: continued.records, continuedTotal: continued.total, revision: continued.revision }
  }

  continuedHistoryPage({ offset = 0, limit = 100, revision = this.revision('history') } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new TypeError('Invalid Continue Watching page')
    const current = this.revision('history')
    if (revision !== current) return { stale: true, records: [], revision: current }
    const now = Date.now()
    const total = this.prepare("SELECT count(*) AS total FROM records WHERE collection = 'history' AND continue_candidate = 1 AND watchable_after <= ?").get(now).total
    const records = [...this.orderedHistoryRows({ where: 'r.continue_candidate = 1', watchableAt: now, idDirection: 1, offset, limit })].map(row => migrateLegacyHistoryRecord(deserialize(row.data)))
    return { stale: false, records, total, revision: current }
  }

  playlistPage({ id, cursor = null, limit = 100, sort = 'custom', locale = 'en-US', reverse = false, query = '' } = {}) {
    if (!this.prepare("SELECT 1 FROM records WHERE collection = 'playlists' AND id = ?").get(id)) throw new Error('The playlist no longer exists')
    const revision = this.revision('playlists')
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 100))
    const key = JSON.stringify([id, revision, sort.startsWith('video_duration_') ? this.revision('history') : null, sort, locale, reverse, query])
    if (cursor && cursor.key !== key) return { stale: true, revision, records: [], cursor: null }
    let viewId = this.playlistOrders.get(key)
    let rows
    const plain = sort === 'custom' && !query.trim()
    if (plain) {
      rows = this.prepare(`SELECT position, membership_id, data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND position ${reverse ? '<' : '>'} ? ORDER BY position ${reverse ? 'DESC' : 'ASC'} LIMIT ?`).all(id, cursor?.position ?? (reverse ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER), limit + 1)
    } else {
      if (!viewId) {
        if (this.playlistOrders.size >= 2) {
          const [oldKey, oldId] = this.playlistOrders.entries().next().value
          this.prepare('DELETE FROM playlist_orders WHERE view_id = ?').run(oldId)
          this.playlistOrders.delete(oldKey)
        }
        viewId = randomUUID()
        const entries = this.prepare("SELECT position, membership_id, data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position").all(id).map(row => ({ ...deserialize(row.data), _libraryPosition: row.position, _libraryMemberId: row.membership_id }))
        if (sort.startsWith('video_duration_')) hydratePlaylistDurations(this, entries)
        const search = query.trim().toLowerCase()
        const ordered = getSortedPlaylistItems(entries, sort, locale, reverse).filter(entry => !search || (typeof entry.title === 'string' && entry.title.toLowerCase().includes(search)) || (typeof entry.author === 'string' && entry.author.toLowerCase().includes(search)))
        const insert = this.prepare('INSERT INTO playlist_orders VALUES (?, ?, ?)')
        this.database.exec('SAVEPOINT playlist_order')
        try {
          ordered.forEach((entry, rank) => insert.run(viewId, rank, entry._libraryPosition))
          this.database.exec('RELEASE playlist_order')
        } catch (error) { this.database.exec('ROLLBACK TO playlist_order; RELEASE playlist_order'); throw error }
        this.playlistOrders.set(key, viewId)
      }
      rows = this.prepare("SELECT o.rank AS position, m.membership_id, m.data FROM playlist_orders o JOIN members m ON m.collection = 'playlists' AND m.record_id = ? AND m.field = 'videos' AND m.position = o.position WHERE o.view_id = ? AND o.rank > ? ORDER BY o.rank LIMIT ?").all(id, viewId, cursor?.position ?? -1, limit + 1)
    }
    const more = rows.length > limit
    if (more) rows.pop()
    const records = rows.map(row => ({ ...deserialize(row.data), _libraryMemberId: row.membership_id }))
    if (sort.startsWith('video_duration_')) hydratePlaylistDurations(this, records)
    return { records, revision, cursor: more ? { position: rows.at(-1).position, revision, key } : null }
  }

  playlistWindow({ id, playableOnly = false, sort = 'custom', locale = 'en-US', reverse = false, shuffleSeed = '', shuffleAnchor = null, anchor = null, offset = null, limit = 100 }) {
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 100))
    const revision = this.revision('playlists')
    const key = JSON.stringify(['window', id, playableOnly, revision, sort.startsWith('video_duration_') ? this.revision('history') : null, sort, locale, reverse, shuffleSeed, shuffleAnchor])
    let viewId = this.playlistOrders.get(key)
    if (!viewId) {
      const source = this.prepare("SELECT position, membership_id, data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos'" + (playableOnly ? " AND json_type(data, '$.videoId') = 'text' AND video_id != ''" : '') + ' ORDER BY position').all(id)
      const sortedSource = sort === 'custom' && !shuffleSeed ? null : source.map(row => ({ ...deserialize(row.data), position: row.position, membership_id: row.membership_id }))
      if (sort.startsWith('video_duration_')) hydratePlaylistDurations(this, sortedSource)
      const entries = sortedSource ? getSortedPlaylistItems(sortedSource, sort, locale, reverse) : reverse ? source.toReversed() : source
      if (shuffleSeed) {
        let seed = createHash('sha256').update(shuffleSeed).digest().readUInt32LE(0)
        const random = () => { seed += 0x6D2B79F5; let value = Math.imul(seed ^ seed >>> 15, seed | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296 }
        const matches = row => {
          const entry = row.data ? deserialize(row.data) : row
          return shuffleAnchor?.memberId ? row.membership_id === shuffleAnchor.memberId : shuffleAnchor?.itemId != null ? entry.playlistItemId === shuffleAnchor.itemId && entry.videoId === shuffleAnchor.videoId : entry.videoId === shuffleAnchor?.videoId
        }
        const first = shuffleAnchor ? entries.findIndex(matches) : -1
        const head = first >= 0 ? entries.splice(first, 1)[0] : null
        for (let index = entries.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [entries[index], entries[target]] = [entries[target], entries[index]] }
        if (head) entries.unshift(head)
      }
      if (this.playlistOrders.size >= 2) { const [oldKey, oldId] = this.playlistOrders.entries().next().value; this.prepare('DELETE FROM playlist_orders WHERE view_id = ?').run(oldId); this.playlistOrders.delete(oldKey) }
      viewId = randomUUID()
      const insert = this.prepare('INSERT INTO playlist_orders VALUES (?, ?, ?)')
      this.database.exec('SAVEPOINT playlist_window')
      try { entries.forEach((entry, rank) => insert.run(viewId, rank, entry.position)); this.database.exec('RELEASE playlist_window') } catch (error) { this.database.exec('ROLLBACK TO playlist_window; RELEASE playlist_window'); throw error }
      this.playlistOrders.set(key, viewId)
    }
    const total = this.prepare('SELECT count(*) AS count FROM playlist_orders WHERE view_id = ?').get(viewId).count
    const joined = "FROM playlist_orders o JOIN members m ON m.collection = 'playlists' AND m.record_id = ? AND m.field = 'videos' AND m.position = o.position WHERE o.view_id = ?"
    const current = anchor ? this.prepare(`SELECT o.rank ${joined} AND ${anchor.memberId ? 'm.membership_id = ?' : anchor.itemId != null ? "m.item_id = json_extract(?, '$') AND m.video_id = json_extract(?, '$')" : "m.video_id = json_extract(?, '$')"} ORDER BY o.rank LIMIT 1`).get(id, viewId, ...(anchor.memberId ? [anchor.memberId] : anchor.itemId != null ? [JSON.stringify(anchor.itemId), JSON.stringify(anchor.videoId)] : [JSON.stringify(anchor.videoId)])) : null
    const index = current?.rank ?? -1
    offset = offset === null ? Math.max(0, index - 20) : Math.max(0, Math.min(Math.max(0, total - 1), Math.trunc(offset)))
    const materialize = row => row ? { ...deserialize(row.data), _libraryMemberId: row.membership_id } : null
    const at = rank => materialize(this.prepare(`SELECT m.data, m.membership_id ${joined} AND o.rank = ?`).get(id, viewId, rank))
    const records = this.prepare(`SELECT m.data, m.membership_id ${joined} AND o.rank >= ? ORDER BY o.rank LIMIT ?`).all(id, viewId, offset, limit).map(materialize)
    const next = at(index < 0 || index === total - 1 ? 0 : index + 1)
    const previous = at(index <= 0 ? total - 1 : index - 1)
    if (sort.startsWith('video_duration_')) hydratePlaylistDurations(this, [...records, next, previous].filter(Boolean))
    return { records, offset, index, total, revision, next, previous }
  }

  async movePlaylistMember({ id, memberId, direction, revision, excludedMemberIds = [], playableOnly = false }) {
    return this.transaction(async () => {
      if (![-1, 1, 'top', 'bottom'].includes(direction)) throw new Error('Invalid playlist move')
      if (revision !== this.revision('playlists')) throw new Error('The playlist changed; reload it before reordering')
      const playable = playableOnly ? " AND json_type(data, '$.videoId') = 'text' AND video_id != ''" : ''
      const current = this.prepare("SELECT position FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id = ?" + playable).get(id, memberId)
      if (!current) throw new Error('The playlist member no longer exists')
      const minimum = this.prepare("SELECT position FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position LIMIT 1").get(id).position
      const maximum = this.prepare("SELECT position FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position DESC LIMIT 1").get(id).position
      const bounds = { minimum, maximum }
      if (direction === 'top' || direction === 'bottom') {
        const position = direction === 'top' ? bounds.minimum - 1 : bounds.maximum + 1
        this.prepare("UPDATE members SET position = ? WHERE collection = 'playlists' AND membership_id = ?").run(position, memberId)
        this.prepare("UPDATE record_arrays SET next_position = max(next_position, ?) WHERE collection = 'playlists' AND record_id = ? AND field = 'videos'").run(position + 1, id)
        await this.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
        return true
      }
      const neighbor = this.prepare(`SELECT position, membership_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND position ${direction < 0 ? '<' : '>'} ? AND membership_id NOT IN (SELECT value FROM json_each(?)) ${playable} ORDER BY position ${direction < 0 ? 'DESC' : 'ASC'} LIMIT 1`).get(id, current.position, JSON.stringify(excludedMemberIds))
      if (!neighbor) return false
      const move = this.prepare("UPDATE members SET position = ? WHERE collection = 'playlists' AND membership_id = ?")
      move.run(bounds.minimum - 1, memberId)
      move.run(current.position, neighbor.membership_id)
      move.run(neighbor.position, memberId)
      await this.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
      return true
    })
  }

  async cleanupPlaylist({ id, mode }) {
    return this.transaction(async () => {
      let condition
      if (mode === 'duplicates') condition = "m.video_id IS NOT NULL AND m.position NOT IN (SELECT min(position) FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' GROUP BY video_id)"
      else if (mode === 'watched') condition = 'm.video_id IN (SELECT value FROM json_each(?))'
      else throw new Error('Unknown playlist cleanup mode')
      const watchedIds = []
      if (mode === 'watched') {
        const ids = this.prepare("SELECT DISTINCT coalesce(nullif(data -> '$.videoId', 'null'), data -> '$.postId') AS original_video_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IS NOT NULL").all(id).map(row => deserialize(row.original_video_id))
        for (let offset = 0; offset < ids.length; offset += MAX_PAGE_SIZE) {
          for (const [videoId, row] of this.latestHistoryRows(ids.slice(offset, offset + MAX_PAGE_SIZE))) if (isHistoryEntryWatched(deserialize(row.data))) watchedIds.push(videoId)
        }
      }
      const removed = this.prepare(`SELECT m.position, coalesce(nullif(m.data -> '$.videoId', 'null'), m.data -> '$.postId') AS original_video_id FROM members m WHERE m.collection = 'playlists' AND m.record_id = ? AND m.field = 'videos' AND (${condition})`).all(id, mode === 'duplicates' ? id : JSON.stringify(watchedIds)).map(row => ({ position: row.position, video_id: deserialize(row.original_video_id) }))
      if (mode === 'duplicates') {
        const seen = new Set()
        for (const row of this.prepare("SELECT position, data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IS NULL ORDER BY position").iterate(id)) {
          const videoId = deserialize(row.data)?.videoId
          // Unidentified and object-valued IDs cannot establish identity safely.
          if (!['number', 'boolean'].includes(typeof videoId)) continue
          if (seen.has(videoId)) removed.push({ position: row.position, video_id: videoId })
          else seen.add(videoId)
        }
      } else {
        const legacyMembers = this.prepare("SELECT position, data -> '$.videoId' AS legacy_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IS NULL ORDER BY position").all(id)
        const identities = new Map()
        for (const row of legacyMembers) {
          const videoId = row.legacy_id === null ? undefined : deserialize(row.legacy_id)
          // Separately decoded object IDs have no shared reference identity.
          if (videoId === null || typeof videoId !== 'object') identities.set(row.legacy_id, videoId)
        }
        const watched = new Set()
        for (const [identity, history] of legacyHistoryRows(this, identities.keys())) if (isHistoryEntryWatched(deserialize(history))) watched.add(identity)
        for (const row of legacyMembers) if (watched.has(row.legacy_id)) removed.push({ position: row.position, video_id: identities.get(row.legacy_id) })
      }
      const remove = this.prepare("DELETE FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND position = ?")
      for (const row of removed) remove.run(id, row.position)
      if (removed.length) {
        await this.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
        this.clearRemovedPlaylistContext(id, removed.map(row => row.video_id))
      }
      return removed.length
    })
  }

  clearRemovedPlaylistContext(id, videoIds) {
    const select = this.prepare("SELECT id, data FROM records WHERE collection = 'history' AND video_id IN (SELECT value FROM json_each(?)) AND json_extract(data, '$.lastViewedPlaylistId') = ? AND id > ? ORDER BY id LIMIT 250")
    const ids = JSON.stringify([...new Set(videoIds.filter(value => typeof value === 'string'))])
    let cursor = ''
    let changed = false
    while (true) {
      // Finish each bounded read before changing the selected table. The ID
      // stays fixed when context is cleared, so the next page cannot revisit it.
      const rows = select.all(ids, id, cursor)
      if (!rows.length) break
      cursor = rows.at(-1).id
      for (const row of rows) {
        const history = deserialize(row.data)
        const itemId = history.lastViewedPlaylistItemId
        // Missing legacy item IDs cannot prove the saved occurrence is gone.
        const survives = this.prepare("SELECT 1 FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id = json_extract(?, '$')" + (itemId == null ? '' : " AND (item_id = json_extract(?, '$') OR item_id IS NULL)") + ' LIMIT 1')
          .get(id, JSON.stringify(history.videoId), ...(itemId == null ? [] : [JSON.stringify(itemId)]))
        if (survives) continue
        this.update('history', row, { $unset: { lastViewedPlaylistId: true, lastViewedPlaylistType: true, lastViewedPlaylistItemId: true } })
        changed = true
      }
      if (rows.length < 250) break
    }
    const legacyIds = JSON.stringify([...new Set(videoIds.filter(value => ['number', 'boolean'].includes(typeof value)).map(serialize))])
    const legacySelect = this.prepare("SELECT id, data, data -> '$.videoId' AS legacy_id FROM records WHERE collection = 'history' AND video_id IS NULL AND data -> '$.videoId' IN (SELECT value FROM json_each(?)) AND json_extract(data, '$.lastViewedPlaylistId') = ? AND id > ? ORDER BY id LIMIT 250")
    cursor = ''
    if (legacyIds !== '[]') {
      while (true) {
        const rows = legacySelect.all(legacyIds, id, cursor)
        if (!rows.length) break
        cursor = rows.at(-1).id
        for (const row of rows) {
          const history = deserialize(row.data)
          const itemId = history.lastViewedPlaylistItemId
          const survives = this.prepare("SELECT 1 FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id IS NULL AND data -> '$.videoId' = ?" + (itemId == null ? '' : " AND (item_id = json_extract(?, '$') OR item_id IS NULL)") + ' LIMIT 1').get(id, row.legacy_id, ...(itemId == null ? [] : [JSON.stringify(itemId)]))
          if (survives) continue
          this.update('history', row, { $unset: { lastViewedPlaylistId: true, lastViewedPlaylistType: true, lastViewedPlaylistItemId: true } })
          changed = true
        }
        if (rows.length < 250) break
      }
    }
    if (changed) this.touch('history')
  }

  async reorderPlaylistMembers({ id, memberIds, revision }) {
    return this.transaction(async () => {
      if (revision !== this.revision('playlists')) throw new Error('The playlist changed; reload it before reordering')
      if (!Array.isArray(memberIds) || memberIds.some(member => typeof member !== 'string') || new Set(memberIds).size !== memberIds.length) throw new Error('Invalid playlist member order')
      const rows = this.prepare("SELECT membership_id, position FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id IN (SELECT value FROM json_each(?)) ORDER BY position").all(id, JSON.stringify(memberIds))
      if (rows.length !== memberIds.length) throw new Error('A playlist member no longer exists')
      const positions = rows.map(row => row.position)
      const minimum = this.prepare("SELECT position FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position LIMIT 1").get(id)?.position ?? 0
      const move = this.prepare("UPDATE members SET position = ? WHERE collection = 'playlists' AND membership_id = ?")
      memberIds.forEach((member, index) => move.run(minimum - index - 1, member))
      memberIds.forEach((member, index) => move.run(positions[index], member))
      if (rows.length) await this.collections.playlists.updateAsync({ _id: id }, { $set: { lastUpdatedAt: Date.now() } })
      return true
    })
  }
}

class Collection {
  constructor(engine, name) { this.engine = engine; this.name = name }
  loadDatabaseAsync() { return Promise.resolve() }
  ensureIndexAsync() { return Promise.resolve() }
  compactDatafileAsync() { return Promise.resolve() }

  hasLegacyHistoryTimestamps(compiled) {
    return !!this.engine.prepare(`SELECT 1 FROM records r WHERE r.collection = 'history' AND (${compiled.sql}) AND (json_type(r.data, '$."timeWatched"') IS NULL OR json_type(r.data, '$."timeWatched"') NOT IN ('integer', 'real')) = 1 LIMIT 1`).get(...compiled.parameters)
  }

  rows(query = {}, limit = null, latest = false) {
    const compiled = compileQuery(query, 'r', ARRAY_FIELDS[this.name] ?? [], this.name)
    const legacyLatest = latest && limit === 1 && this.hasLegacyHistoryTimestamps(compiled)
    const bounded = !compiled.verify && !legacyLatest && limit !== null
    const statement = this.engine.prepare(`SELECT r.id, r.data FROM records r WHERE r.collection = ? AND (${compiled.sql})${latest ? ' ORDER BY sort_time DESC, nedb_id_sort(r.id) DESC' : ' ORDER BY nedb_id_sort(r.id)'}${bounded ? ' LIMIT ?' : ''}`)
    const args = [this.name, ...compiled.parameters, ...(bounded ? [limit] : [])]
    if (legacyLatest) {
      let newest
      let newestRecord
      // Compare stored timestamp types before applying the one-row limit.
      // Stream the matching duplicates, retaining only the selected record.
      for (const row of statement.iterate(...args)) {
        const record = compiled.verify ? this.engine.materialize(this.name, row) : deserialize(row.data)
        if (compiled.verify && !match(record, query)) continue
        if (!newest || (model.compareThings(record.timeWatched, newestRecord.timeWatched) || model.compareThings(record._id, newestRecord._id)) > 0) {
          newest = row
          newestRecord = record
        }
      }
      return newest ? [newest] : []
    }
    if (!compiled.verify) return statement.all(...args)
    const rows = []
    for (const row of statement.iterate(...args)) {
      if (!match(this.engine.materialize(this.name, row), query)) continue
      rows.push(row)
      if (limit !== null && rows.length >= limit) break
    }
    return rows
  }

  findAsync(query = {}, projection) {
    const options = { sort: {}, skip: 0, limit: null }
    const cursor = {
      sort: value => { options.sort = value; return cursor },
      skip: value => { options.skip = value; return cursor },
      limit: value => { options.limit = value; return cursor },
      then: (resolve, reject) => this.engine.read(() => {
        const compiled = compileQuery(query, 'r', ARRAY_FIELDS[this.name] ?? [], this.name)
        const criteria = Object.entries(options.sort)
        // Keep numeric history windows indexed. Other sorts need NeDB's type,
        // Date and Unicode ordering before applying the requested window.
        const numericHistorySort = this.name === 'history' && criteria.length === 1 && criteria[0][0] === 'timeWatched' && !this.hasLegacyHistoryTimestamps(compiled)
        const legacySort = criteria.length > 0 && !numericHistorySort
        const verify = compiled.verify || legacySort
        const order = numericHistorySort ? `r.sort_time ${criteria[0][1] < 0 ? 'DESC' : 'ASC'}, nedb_id_sort(r.id)` : 'r.id'
        const sql = `SELECT r.id, r.data FROM records r WHERE r.collection = ? AND (${compiled.sql}) ORDER BY ${order}` +
          (!verify ? ' LIMIT ? OFFSET ?' : '')
        const args = [this.name, ...compiled.parameters, ...(!verify ? [options.limit ?? -1, options.skip] : [])]
        const outputOptions = projectionOptions(this.name, projection)
        const requiredFields = { $and: [compiled.verify ? query : {}, legacySort ? options.sort : {}] }
        const materialization = verify
          ? {
              arrays: queryReferencesFields(requiredFields, ARRAY_FIELDS[this.name] ?? []),
              blobs: queryReferencesFields(requiredFields, ['thumbnail']),
            }
          : outputOptions
        let records = this.engine.prepare(sql).all(...args).map(row => ({ row, record: this.engine.materialize(this.name, row, materialization) }))
        if (compiled.verify) records = records.filter(({ record }) => match(record, query))
        if (legacySort) {
          records.sort((a, b) => {
            for (const [field, direction] of criteria) {
              const compared = model.compareThings(model.getDotValue(a.record, field), model.getDotValue(b.record, field))
              if (compared) return compared * (direction < 0 ? -1 : 1)
            }
            return model.compareThings(a.record._id, b.record._id)
          })
        }
        if (verify) records = records.slice(options.skip, options.limit === null ? undefined : options.skip + options.limit)
        // Arrays and thumbnails unrelated to filtering/sorting are only read
        // for the final page, rather than for every candidate document.
        return records.map(({ row, record }) => project(verify ? this.engine.materialize(this.name, row, outputOptions) : record, projection))
      }).then(resolve, reject)
    }
    return cursor
  }

  async findOneAsync(query, projection) {
    return this.engine.read(() => {
      const rows = this.rows(query, 1, this.name === 'history' && Object.hasOwn(query ?? {}, 'videoId'))
      return rows.length
        ? project(this.engine.materialize(this.name, rows[0], projectionOptions(this.name, projection)), projection)
        : null
    })
  }

  count(query = {}) {
    if (Object.keys(query).length === 0) return this.engine.prepare('SELECT count FROM collection_counts WHERE collection = ?').get(this.name)?.count ?? 0
    const compiled = compileQuery(query, 'r', ARRAY_FIELDS[this.name] ?? [], this.name)
    if (!compiled.verify) return this.engine.prepare(`SELECT count(*) AS count FROM records r WHERE r.collection = ? AND (${compiled.sql})`).get(this.name, ...compiled.parameters).count
    const options = {
      arrays: queryReferencesFields(query, ARRAY_FIELDS[this.name] ?? []),
      blobs: queryReferencesFields(query, ['thumbnail'])
    }
    let count = 0
    for (const row of this.engine.prepare(`SELECT r.id, r.data FROM records r WHERE r.collection = ? AND (${compiled.sql}) ORDER BY r.id`).iterate(this.name, ...compiled.parameters)) {
      if (match(this.engine.materialize(this.name, row, options), query)) count++
    }
    return count
  }

  async countAsync(query = {}) { return this.engine.read(() => this.count(query)) }

  async insertAsync(input) {
    return this.engine.transaction(() => {
      const records = (Array.isArray(input) ? input : [input]).map(record => this.engine.write(this.name, record))
      if (records.length) this.engine.touch(this.name)
      return Array.isArray(input) ? records : records[0]
    })
  }

  async updateAsync(query, update, { upsert = false, multi = false, returnUpdatedDocs = false } = {}) {
    return this.engine.transaction(() => {
      const target = this.name === 'history' && !multi && update._id && this.rows({ ...query, _id: update._id }, 1).length ? { ...query, _id: update._id } : query
      const rows = this.rows(target, multi ? null : 1, this.name === 'history' && !multi && Object.hasOwn(query, 'videoId'))
      const affected = []
      if (!rows.length && upsert) {
        const record = this.engine.write(this.name, Object.keys(update).some(key => key.startsWith('$')) ? safeModify(upsertQueryDocument(query), update) : update)
        if (returnUpdatedDocs) affected.push(record)
      }
      for (const row of rows) {
        if (Object.keys(update).some(key => key.startsWith('$'))) this.engine.update(this.name, row, update)
        else {
          if (update._id !== undefined && update._id !== row.id) throw new Error('Cannot change a record ID')
          this.engine.write(this.name, { ...update, _id: row.id }, true)
        }
        if (returnUpdatedDocs) affected.push(this.engine.materialize(this.name, this.engine.prepare('SELECT id, data FROM records WHERE collection = ? AND id = ?').get(this.name, row.id)))
      }
      const numAffected = rows.length || Number(upsert)
      if (numAffected) this.engine.touch(this.name)
      return { numAffected, affectedDocuments: returnUpdatedDocs ? (multi ? affected : affected[0] ?? null) : null, upsert: rows.length === 0 && upsert }
    })
  }

  async removeAsync(query = {}, { multi = false } = {}) {
    return this.engine.transaction(() => {
      const compiled = compileQuery(query, 'r', ARRAY_FIELDS[this.name] ?? [], this.name)
      const latestHistory = this.name === 'history' && !multi && Object.hasOwn(query, 'videoId')
      if (!compiled.verify && !latestHistory) {
        const { changes } = this.engine.prepare(`DELETE FROM records WHERE collection = ? AND id IN (SELECT r.id FROM records r WHERE r.collection = ? AND (${compiled.sql})${multi ? '' : ' ORDER BY nedb_id_sort(r.id) LIMIT 1'})`).run(this.name, this.name, ...compiled.parameters)
        if (changes) this.engine.touch(this.name)
        return changes
      }
      const rows = this.rows(query, multi ? null : 1, latestHistory)
      for (const row of rows) this.engine.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(this.name, row.id)
      if (rows.length) this.engine.touch(this.name)
      return rows.length
    })
  }
}
