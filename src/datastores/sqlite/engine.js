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

function deserialize(data) {
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
  const compile = (value, currentAlias) => {
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
      const clauses = []
      const args = []
      let exact = indexedId && !(condition instanceof RegExp)
      if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
        args.push(bind(condition))
        clauses.push(`${expression} IS ?`)
      } else {
        for (const [operator, argument] of Object.entries(condition)) {
          if (operator === '$exists') { clauses.push(`${type} IS ${argument ? 'NOT ' : ''}NULL`); continue }
          if (operator === '$in' || operator === '$nin') {
            if (!Array.isArray(argument) || argument.some(item => item && typeof item === 'object')) { clauses.push('1'); exact = false; continue }
            args.push(serialize(argument.map(bind)))
            clauses.push(`coalesce(${expression} ${operator === '$nin' ? 'NOT ' : ''}IN (SELECT value FROM json_each(?)), ${operator === '$nin' ? '1' : '0'})`)
            continue
          }
          const operators = { $ne: 'IS NOT', $lt: '<', $lte: '<=', $gt: '>', $gte: '>=' }
          if (operators[operator]) { args.push(bind(argument)); clauses.push(`${expression} ${operators[operator]} ?`); continue }
          clauses.push('1')
          exact = false
        }
      }
      const sql = clauses.join(' AND ') || '1'
      // NeDB matches array elements and traverses documents differently from
      // JSON1. Keep these as candidates and use its original exact verifier.
      const guaranteedScalar = field === '_id' && currentAlias === 'r'
      // History's numeric sort column falls back for legacy non-number values.
      // Keep those candidates for NeDB verification instead of dropping them.
      const fallbackTypes = field === 'timeWatched' && currentAlias === 'r' && collection === 'history' ? "NOT IN ('integer', 'real')" : "IN ('array', 'object')"
      add({ sql: guaranteedScalar ? sql : indexedId ? `((${sql}) OR (${expression} IS NULL AND ${type} IN ('array', 'object')))` : `((${sql}) OR ${type} ${fallbackTypes} OR ${type} IS NULL)`, parameters: args, verify: !exact || !guaranteedScalar })
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

function queryReferencesFields(query, fields) {
  return Object.entries(query).some(([field, condition]) => {
    if (field === '$and' || field === '$or') return condition.some(part => queryReferencesFields(part, fields))
    if (field === '$not') return queryReferencesFields(condition, fields)
    // Opaque predicates such as $where can inspect any stored field.
    return field.startsWith('$') || fields.includes(field.split('.')[0])
  })
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
  const included = Object.entries(projection).filter(([key, value]) => key !== '_id' && value === 1)
  if (included.length || projection._id === 1) {
    const result = projection._id === 0 ? {} : { _id: record._id }
    for (const [key] of included) {
      const value = model.getDotValue(record, key)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  const result = { ...record }
  for (const [key, value] of Object.entries(projection)) if (value === 0) delete result[key]
  return result
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
    this.database.exec('CREATE TEMP TABLE playlist_orders (view_id TEXT NOT NULL, rank INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(view_id, rank)) WITHOUT ROWID')
    this.database.function('history_watched', data => Number(data ? isHistoryEntryWatched(deserialize(data)) : false))
    this.collections = Object.fromEntries(Object.keys(COLLECTIONS).map(name => [name, new Collection(this, name)]))
  }

  prepare(sql) {
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
    const context = this.transactionContext.getStore()
    if (!context?.active) {
      // Only async descendants of the active owner may join its transaction.
      // Independent requests wait even when that owner yields to a handler.
      const result = this.pendingTransaction.then(() => this.transactionContext.run({ active: true }, () => this.transaction(operation)))
      this.pendingTransaction = result.then(() => {}, () => {})
      return result
    }
    const outermost = this.transactionDepth === 0
    if (outermost) this.database.exec('BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const result = await operation()
      if (outermost) this.database.exec('COMMIT')
      return result
    } catch (error) {
      if (outermost) this.database.exec('ROLLBACK')
      throw error
    } finally {
      this.transactionDepth--
      if (outermost) context.active = false
    }
  }

  touch(collection) {
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
    const serializedInput = serialize(input)
    const record = deserialize(serializedInput)
    record._id ??= randomUUID()
    if (typeof record._id !== 'string' || !record._id) throw new TypeError('A record must have a nonempty string ID')
    // Validate before changing any rows, including members and blob values.
    serialize(record)
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
    const sql = 'INSERT INTO records(collection, id, data, video_id, sort_time, continue_candidate, unwatched_candidate, watchable_after, repair_candidate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)' +
      (replace ? ' ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, video_id = excluded.video_id, sort_time = excluded.sort_time, continue_candidate = excluded.continue_candidate, unwatched_candidate = excluded.unwatched_candidate, watchable_after = excluded.watchable_after, repair_candidate = excluded.repair_candidate' : '')
    this.prepare(sql).run(collection, record._id, serialize(record), typeof record.videoId === 'string' ? record.videoId : null,
      Number.isFinite(record.timeWatched) ? record.timeWatched : Number.isFinite(record.cachedAt) ? record.cachedAt : 0, ...historyColumns(collection, record))
    if (replace) {
      this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field NOT IN (SELECT value FROM json_each(?))').run(collection, record._id, JSON.stringify([...arrays.keys()]))
      this.prepare('DELETE FROM record_blobs WHERE collection = ? AND record_id = ?').run(collection, record._id)
    }
    for (const [field, entries] of arrays) this.replaceArray(collection, record._id, field, entries, record[field + 'Timestamp'])
    for (const [field, data] of blobs) this.prepare('INSERT INTO record_blobs VALUES (?, ?, ?, ?, ?)').run(collection, record._id, field, serialize(data), createHash('sha256').update(data).digest('hex'))
    if (collection === 'history') this.indexSearch(record)
    return { ...deserialize(serializedInput), _id: record._id }
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
    for (const [operator, values] of Object.entries(update)) if (!['$set', '$unset', '$push', '$pull'].includes(operator) && Object.keys(values).some(field => normalized.includes(field))) throw new Error('Unsupported normalized array modifier')
    const scalarUpdate = Object.fromEntries(Object.entries(update).map(([operator, values]) => [operator,
      Object.fromEntries(Object.entries(values).filter(([field]) => !normalized.includes(field)))
    ]).filter(([, values]) => Object.keys(values).length))
    const previous = this.materialize(collection, row, { arrays: false })
    const record = Object.keys(scalarUpdate).length ? safeModify(previous, scalarUpdate) : previous
    for (const field of normalized) {
      if (Object.hasOwn(update.$set ?? {}, field)) {
        const value = update.$set[field]
        if (Array.isArray(value)) { this.replaceArray(collection, row.id, field, value, record[field + 'Timestamp']); record[field] = [] } else { this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').run(collection, row.id, field); record[field] = value }
      }
      if (Object.hasOwn(update.$unset ?? {}, field)) {
        this.prepare('DELETE FROM record_arrays WHERE collection = ? AND record_id = ? AND field = ?').run(collection, row.id, field)
        delete record[field]
      }
      if (Object.hasOwn(update.$push ?? {}, field)) {
        const value = update.$push[field]
        if (value?.$slice !== undefined || value?.$position !== undefined || value?.$sort !== undefined) throw new Error('Unsupported playlist array modifier')
        this.appendArray(collection, row.id, field, value?.$each ?? [value], record[field + 'Timestamp'])
        record[field] = []
      }
      if (Object.hasOwn(update.$pull ?? {}, field)) {
        const predicate = update.$pull[field]
        const compiled = compileQuery(predicate, 'm')
        if (!compiled.verify) this.prepare(`DELETE FROM members AS m WHERE collection = ? AND record_id = ? AND field = ? AND (${compiled.sql})`).run(collection, row.id, field, ...compiled.parameters)
        else {
          for (const entry of this.prepare('SELECT position, data FROM members WHERE collection = ? AND record_id = ? AND field = ?').iterate(collection, row.id, field)) {
            if (match(deserialize(entry.data), predicate)) this.prepare('DELETE FROM members WHERE collection = ? AND record_id = ? AND field = ? AND position = ?').run(collection, row.id, field, entry.position)
          }
        }
      }
    }
    let thumbnail = null
    if (collection === 'videoMetadataCache' && typeof record.thumbnail === 'string') { thumbnail = record.thumbnail; record.thumbnail = null }
    this.prepare('UPDATE records SET data = ?, video_id = ?, sort_time = ?, continue_candidate = ?, unwatched_candidate = ?, watchable_after = ?, repair_candidate = ? WHERE collection = ? AND id = ?').run(serialize(record), typeof record.videoId === 'string' ? record.videoId : null, Number.isFinite(record.timeWatched) ? record.timeWatched : Number.isFinite(record.cachedAt) ? record.cachedAt : 0, ...historyColumns(collection, record), collection, row.id)
    if (collection === 'videoMetadataCache') {
      this.prepare('DELETE FROM record_blobs WHERE collection = ? AND record_id = ?').run(collection, row.id)
      if (thumbnail !== null) this.prepare('INSERT INTO record_blobs VALUES (?, ?, ?, ?, ?)').run(collection, row.id, 'thumbnail', serialize(thumbnail), createHash('sha256').update(thumbnail).digest('hex'))
    }
    if (collection === 'history' && (Object.hasOwn(update.$set ?? {}, 'title') || Object.hasOwn(update.$set ?? {}, 'author') || Object.hasOwn(update.$unset ?? {}, 'title') || Object.hasOwn(update.$unset ?? {}, 'author'))) this.indexSearch(record)
  }

  historyPage({ cursor = null, limit = 100, oldest = false, query = '', caseSensitive = false, locale = 'en-US' } = {}) {
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 100))
    const revision = this.revision('history')
    const spec = JSON.stringify([oldest, query, caseSensitive, locale])
    if (cursor && (cursor.revision !== revision || cursor.spec !== spec)) return { stale: true, revision, records: [], cursor: null }
    const comparator = oldest ? '>' : '<'
    const direction = oldest ? 'ASC' : 'DESC'
    const parameters = cursor ? [cursor.time, cursor.id] : []
    const after = cursor ? `AND (sort_time, id) ${comparator} (?, ?)` : ''
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
    const statement = this.prepare(`SELECT id, data, sort_time FROM records WHERE collection = 'history' ${after} ${where} ORDER BY sort_time ${direction}, id ${direction}`)
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
    return this.prepare("SELECT r.id, r.data, coalesce(a.length, 0) AS count FROM records r LEFT JOIN record_arrays a ON a.collection = r.collection AND a.record_id = r.id AND a.field = 'videos' WHERE r.collection = 'playlists' ORDER BY r.id").all()
      .map(row => {
        const first = this.prepare("SELECT data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position LIMIT 1").get(row.id)
        return { ...deserialize(row.data), videoCount: row.count, firstVideo: first ? deserialize(first.data) : null, videos: [] }
      })
  }

  playlistStatistics({ id }) {
    const validDuration = "json_type(data, '$.lengthSeconds') IN ('integer', 'real') AND json_extract(data, '$.lengthSeconds') > 0"
    const counts = this.prepare(`SELECT count(*) AS total, count(DISTINCT video_id) AS uniqueCount, coalesce(sum(CASE WHEN ${validDuration} THEN json_extract(data, '$.lengthSeconds') ELSE 0 END), 0) AS duration, coalesce(sum(CASE WHEN ${validDuration} THEN 0 ELSE 1 END), 0) AS missingDuration FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos'`).get(id)
    let watchedCount = 0
    for (const row of this.prepare("SELECT m.video_id, count(*) AS count, sum(CASE WHEN json_type(m.data, '$.lengthSeconds') IN ('integer', 'real') AND json_extract(m.data, '$.lengthSeconds') > 0 THEN 0 ELSE 1 END) AS missing, (SELECT data FROM records h WHERE h.collection = 'history' AND h.video_id = m.video_id ORDER BY sort_time DESC, id DESC LIMIT 1) AS history FROM members m WHERE m.collection = 'playlists' AND m.record_id = ? AND m.field = 'videos' GROUP BY m.video_id").iterate(id)) {
      if (row.history && isHistoryEntryWatched(deserialize(row.history))) watchedCount += row.count
      const duration = row.history ? deserialize(row.history).lengthSeconds : null
      if (Number.isFinite(duration) && duration > 0) { counts.duration += duration * row.missing; counts.missingDuration -= row.missing }
    }
    return { ...counts, watchedCount }
  }

  playlistSnapshot({ id }) { return this.collections.playlists.findOneAsync({ _id: id }) }

  async videoState({ ids }) {
    if (!Array.isArray(ids) || ids.length > MAX_PAGE_SIZE || ids.some(id => typeof id !== 'string')) throw new TypeError('Invalid video state query')
    const history = ids.flatMap(id => { const row = this.prepare("SELECT data FROM records WHERE collection = 'history' AND video_id = ? ORDER BY sort_time DESC, id DESC LIMIT 1").get(id); return row ? [migrateLegacyHistoryRecord(deserialize(row.data))] : [] })
    const memberships = this.prepare("SELECT video_id AS videoId, record_id AS playlistId, count(*) AS count FROM members WHERE collection = 'playlists' AND field = 'videos' AND video_id IN (SELECT value FROM json_each(?)) GROUP BY video_id, record_id").all(JSON.stringify(ids))
    return { history, memberships }
  }

  historySummary() {
    const now = Date.now()
    const continued = this.prepare("SELECT data FROM records WHERE collection = 'history' AND continue_candidate = 1 AND watchable_after <= ? ORDER BY sort_time DESC, id DESC LIMIT 50").all(now).map(row => migrateLegacyHistoryRecord(deserialize(row.data)))
    const unwatched = !!this.prepare("SELECT 1 FROM records WHERE collection = 'history' AND unwatched_candidate = 1 AND watchable_after <= ? LIMIT 1").get(now)
    return { total: this.collections.history.count(), unwatched, continued }
  }

  playlistPage({ id, cursor = null, limit = 100, sort = 'custom', locale = 'en-US', reverse = false, query = '' } = {}) {
    const revision = this.revision('playlists')
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 100))
    const key = JSON.stringify([id, revision, this.revision('history'), sort, locale, reverse, query])
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
        if (sort.startsWith('video_duration_')) {
          for (const entry of entries) {
            if (Number.isFinite(entry.lengthSeconds) && entry.lengthSeconds > 0) continue
            const history = this.prepare("SELECT data FROM records WHERE collection = 'history' AND video_id = ? ORDER BY sort_time DESC LIMIT 1").get(entry.videoId)
            if (history) entry.lengthSeconds = deserialize(history.data).lengthSeconds
          }
        }
        const search = query.trim().toLowerCase()
        const ordered = getSortedPlaylistItems(entries, sort, locale, reverse).filter(entry => !search || entry.title?.toLowerCase().includes(search) || entry.author?.toLowerCase().includes(search))
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
    return { records: rows.map(row => ({ ...deserialize(row.data), _libraryMemberId: row.membership_id })), revision, cursor: more ? { position: rows.at(-1).position, revision, key } : null }
  }

  playlistWindow({ id, sort = 'custom', locale = 'en-US', reverse = false, shuffleSeed = '', shuffleAnchor = null, anchor = null, offset = null, limit = 100 }) {
    limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit) || 100))
    const revision = this.revision('playlists')
    const key = JSON.stringify(['window', id, revision, this.revision('history'), sort, locale, reverse, shuffleSeed, shuffleAnchor])
    let viewId = this.playlistOrders.get(key)
    if (!viewId) {
      const source = this.prepare("SELECT position, membership_id, data FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' ORDER BY position").all(id)
      const sortedSource = sort === 'custom' && !shuffleSeed ? null : source.map(row => ({ ...deserialize(row.data), position: row.position, membership_id: row.membership_id }))
      if (sort.startsWith('video_duration_')) {
        for (const entry of sortedSource) {
          if (Number.isFinite(entry.lengthSeconds) && entry.lengthSeconds > 0) continue
          const history = this.prepare("SELECT data FROM records WHERE collection = 'history' AND video_id = ? ORDER BY sort_time DESC, id DESC LIMIT 1").get(entry.videoId)
          if (history) entry.lengthSeconds = deserialize(history.data).lengthSeconds
        }
      }
      const entries = sortedSource ? getSortedPlaylistItems(sortedSource, sort, locale, reverse) : reverse ? source.toReversed() : source
      if (shuffleSeed) {
        let seed = createHash('sha256').update(shuffleSeed).digest().readUInt32LE(0)
        const random = () => { seed += 0x6D2B79F5; let value = Math.imul(seed ^ seed >>> 15, seed | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296 }
        const matches = row => {
          const entry = row.data ? deserialize(row.data) : row
          return shuffleAnchor?.memberId ? row.membership_id === shuffleAnchor.memberId : shuffleAnchor?.itemId ? entry.playlistItemId === shuffleAnchor.itemId && entry.videoId === shuffleAnchor.videoId : entry.videoId === shuffleAnchor?.videoId
        }
        const first = entries.findIndex(matches)
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
    const current = anchor ? this.prepare(`SELECT o.rank ${joined} AND ${anchor.memberId ? 'm.membership_id = ?' : anchor.itemId ? 'm.item_id = ? AND m.video_id = ?' : 'm.video_id = ?'} ORDER BY o.rank LIMIT 1`).get(id, viewId, ...(anchor.memberId ? [anchor.memberId] : anchor.itemId ? [anchor.itemId, anchor.videoId] : [anchor.videoId])) : null
    const index = current?.rank ?? -1
    offset = offset === null ? Math.max(0, index - 20) : Math.max(0, Math.min(Math.max(0, total - 1), Math.trunc(offset)))
    const materialize = row => row ? { ...deserialize(row.data), _libraryMemberId: row.membership_id } : null
    const at = rank => materialize(this.prepare(`SELECT m.data, m.membership_id ${joined} AND o.rank = ?`).get(id, viewId, rank))
    const records = this.prepare(`SELECT m.data, m.membership_id ${joined} AND o.rank >= ? ORDER BY o.rank LIMIT ?`).all(id, viewId, offset, limit).map(materialize)
    return { records, offset, index, total, revision, next: at(index < 0 || index === total - 1 ? 0 : index + 1), previous: at(index <= 0 ? total - 1 : index - 1) }
  }

  async movePlaylistMember({ id, memberId, direction, revision, excludedMemberIds = [] }) {
    return this.transaction(async () => {
      if (![-1, 1, 'top', 'bottom'].includes(direction)) throw new Error('Invalid playlist move')
      if (revision !== this.revision('playlists')) throw new Error('The playlist changed; reload it before reordering')
      const current = this.prepare("SELECT position FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND membership_id = ?").get(id, memberId)
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
      const neighbor = this.prepare(`SELECT position, membership_id FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND position ${direction < 0 ? '<' : '>'} ? AND membership_id NOT IN (SELECT value FROM json_each(?)) ORDER BY position ${direction < 0 ? 'DESC' : 'ASC'} LIMIT 1`).get(id, current.position, JSON.stringify(excludedMemberIds))
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
      if (mode === 'duplicates') condition = "m.position NOT IN (SELECT min(position) FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' GROUP BY video_id)"
      else if (mode === 'watched') condition = "history_watched((SELECT h.data FROM records h WHERE h.collection = 'history' AND h.video_id = m.video_id ORDER BY h.sort_time DESC LIMIT 1)) = 1"
      else throw new Error('Unknown playlist cleanup mode')
      const removed = this.prepare(`SELECT m.position, m.video_id FROM members m WHERE m.collection = 'playlists' AND m.record_id = ? AND m.field = 'videos' AND (${condition})`).all(...(mode === 'duplicates' ? [id, id] : [id]))
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
    const ids = JSON.stringify([...new Set(videoIds)])
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
        const survives = this.prepare("SELECT 1 FROM members WHERE collection = 'playlists' AND record_id = ? AND field = 'videos' AND video_id = ?" + (itemId == null ? '' : ' AND item_id = ?') + ' LIMIT 1')
          .get(id, history.videoId, ...(itemId == null ? [] : [itemId]))
        if (survives) continue
        this.update('history', row, { $unset: { lastViewedPlaylistId: true, lastViewedPlaylistType: true, lastViewedPlaylistItemId: true } })
        changed = true
      }
      if (rows.length < 250) break
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

  rows(query = {}, limit = null, latest = false) {
    const compiled = compileQuery(query, 'r', ARRAY_FIELDS[this.name] ?? [], this.name)
    const statement = this.engine.prepare(`SELECT r.id, r.data FROM records r WHERE r.collection = ? AND (${compiled.sql})${latest ? ' ORDER BY sort_time DESC, id DESC' : ' ORDER BY id'}${!compiled.verify && limit !== null ? ' LIMIT ?' : ''}`)
    const args = [this.name, ...compiled.parameters, ...(!compiled.verify && limit !== null ? [limit] : [])]
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
      then: (resolve, reject) => Promise.resolve().then(() => {
        const compiled = compileQuery(query, 'r', ARRAY_FIELDS[this.name] ?? [], this.name)
        const order = Object.entries(options.sort).map(([field, direction]) => `${scalar(field, 'r', this.name)} ${direction < 0 ? 'DESC' : 'ASC'}`).join(', ')
        const sql = `SELECT r.id, r.data FROM records r WHERE r.collection = ? AND (${compiled.sql})` + (order ? ` ORDER BY ${order}, r.id` : ' ORDER BY r.id') +
          (!compiled.verify ? ' LIMIT ? OFFSET ?' : '')
        const args = [this.name, ...compiled.parameters, ...(!compiled.verify ? [options.limit ?? -1, options.skip] : [])]
        let records = this.engine.prepare(sql).all(...args).map(row => this.engine.materialize(this.name, row, {
          arrays: !projection || Object.keys(projection).every(key => projection[key] !== 1) || (ARRAY_FIELDS[this.name] ?? []).some(field => projection[field] === 1),
          blobs: !projection || projection.thumbnail === 1,
        }))
        if (compiled.verify) {
          records = records.filter(record => match(record, query)).slice(options.skip, options.limit === null ? undefined : options.skip + options.limit)
        }
        return records.map(record => project(record, projection))
      }).then(resolve, reject)
    }
    return cursor
  }

  async findOneAsync(query, projection) {
    const rows = this.rows(query, 1, this.name === 'history' && Object.hasOwn(query ?? {}, 'videoId'))
    return rows.length
      ? project(this.engine.materialize(this.name, rows[0], {
          arrays: !projection || Object.keys(projection).every(key => projection[key] !== 1) || (ARRAY_FIELDS[this.name] ?? []).some(field => projection[field] === 1),
          blobs: !projection || projection.thumbnail === 1
        }), projection)
      : null
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

  async countAsync(query = {}) { return this.count(query) }

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
        const base = Object.fromEntries(Object.entries(query).filter(([key, value]) => !key.startsWith('$') && (value === null || typeof value !== 'object')))
        const record = this.engine.write(this.name, Object.keys(update).some(key => key.startsWith('$')) ? safeModify(base, update) : update)
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
      if (!compiled.verify) {
        const { changes } = this.engine.prepare(`DELETE FROM records WHERE collection = ? AND id IN (SELECT r.id FROM records r WHERE r.collection = ? AND (${compiled.sql})${multi ? '' : ' LIMIT 1'})`).run(this.name, this.name, ...compiled.parameters)
        if (changes) this.engine.touch(this.name)
        return changes
      }
      const rows = this.rows(query).slice(0, multi ? undefined : 1)
      for (const row of rows) this.engine.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(this.name, row.id)
      if (rows.length) this.engine.touch(this.name)
      return rows.length
    })
  }
}
