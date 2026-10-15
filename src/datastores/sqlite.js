import Datastore from '@seald-io/nedb'
import Cursor from '@seald-io/nedb/lib/cursor.js'
import model from '@seald-io/nedb/lib/model.js'
import { uid } from '@seald-io/nedb/lib/customUtils.js'

const SCHEMA_VERSION = 1
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
// Statements per committed batch while importing a legacy datastore. Keeps
// each bridge or worker message bounded on mobile and web.
const MIGRATION_BATCH_SIZE = 2000

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS docs (id PRIMARY KEY NOT NULL, data TEXT NOT NULL, has_children INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS children (parent NOT NULL, pos INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (parent, pos)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value) WITHOUT ROWID',
  // Hash of each legacy document as imported, to find what an older version
  // changed in the legacy file after this database was created.
  'CREATE TABLE IF NOT EXISTS legacy_base (id PRIMARY KEY NOT NULL, hash TEXT NOT NULL) WITHOUT ROWID',
]

const SELECT_DOCS = 'SELECT id, data, has_children FROM docs'
const SQL = {
  all: SELECT_DOCS,
  byId: `${SELECT_DOCS} WHERE id = ?`,
  byIds: `${SELECT_DOCS} WHERE id IN (SELECT value FROM json_each(?))`,
  existingIds: 'SELECT id FROM docs WHERE id IN (SELECT value FROM json_each(?))',
  upsert: 'INSERT INTO docs (id, data, has_children) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, has_children = excluded.has_children',
  insert: 'INSERT INTO docs (id, data, has_children) VALUES (?, ?, ?)',
  remove: 'DELETE FROM docs WHERE id = ?',
  children: 'SELECT pos, data FROM children WHERE parent = ? ORDER BY pos',
  childrenOf: 'SELECT parent, data FROM children WHERE parent IN (SELECT value FROM json_each(?)) ORDER BY parent, pos',
  nextChild: 'SELECT coalesce(max(pos) + 1, 0) FROM children WHERE parent = ?',
  insertChild: 'INSERT INTO children (parent, pos, data) VALUES (?, ?, ?)',
  removeChild: 'DELETE FROM children WHERE parent = ? AND pos = ?',
  removeChildren: 'DELETE FROM children WHERE parent = ?',
  getMeta: 'SELECT value FROM meta WHERE key = ?',
  setMeta: 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  setBase: 'INSERT INTO legacy_base (id, hash) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET hash = excluded.hash',
  removeBase: 'DELETE FROM legacy_base WHERE id = ?',
}

/**
 * Primary keys keep strings and numbers as native SQLite values, so `'5'` and
 * `5` stay distinct like in NeDB. Other types use a prefixed serialization;
 * the prefix is not NUL, which native string APIs would truncate.
 */
function keyOf(id) {
  return typeof id === 'string' || typeof id === 'number' ? id : `\u0001${model.serialize({ id })}`
}

function isPrimitiveKey(value) {
  return typeof value === 'string' || typeof value === 'number'
}

// NeDB's reviver costs more than the parse itself. Only dates need it.
function deserialize(text) {
  return text.includes('"$$date"') ? model.deserialize(text) : JSON.parse(text)
}

/** True when a query or modifier can read or write `field`. */
function references(value, field) {
  if (typeof value === 'function') return true
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => references(item, field))
  return Object.entries(value).some(([key, item]) => (
    key === field || key.startsWith(`${field}.`) || key === '$where' || references(item, field)
  ))
}

/**
 * True when `update` only appends to `field` with `$push`. Matching documents
 * then need neither their stored members loaded nor rewritten.
 */
function isAppend(update, field) {
  const push = update.$push?.[field]
  if (push === undefined) return false
  if (push !== null && typeof push === 'object' && Object.keys(push).some(key => key.startsWith('$') && key !== '$each')) return false
  const others = { ...update, $push: { ...update.$push } }
  delete others.$push[field]
  return !references(others, field)
}

function isModifierUpdate(update) {
  return Object.keys(update).some(key => key.startsWith('$'))
}

function uniqueViolation(key) {
  const error = new Error(`Can't insert key ${key}, it violates the unique constraint`)
  error.errorType = 'uniqueViolated'
  error.key = key
  return error
}

/**
 * Parses a legacy NeDB datafile exactly as NeDB loads it: deleted documents,
 * repeated updates and corrupted lines resolve the same way.
 * @param {string | null} raw
 */
export async function parseLegacyDatafile(raw) {
  if (!raw) return { data: [], indexes: [] }
  const loader = new Datastore({ inMemoryOnly: true, corruptAlertThreshold: 1 })
  const { data, indexes } = await loader.persistence.treatRawData(raw)
  return { data, indexes: Object.keys(indexes) }
}

/**
 * @typedef {[sql: string, params?: unknown[]]} Statement
 * @typedef {object} SqliteDriver
 * @property {(statements: Statement[], transaction?: boolean) => Promise<unknown[][][]>} execute
 *   Runs statements in order and returns each statement's rows as arrays. With
 *   `transaction`, either every statement commits or none does.
 * @property {() => Promise<void>} drop Deletes the database.
 * @property {() => Promise<string>} [backup] Copies the database, returning the copy's name.
 *
 * @typedef {object} LegacySource The NeDB datastore this database replaces.
 * @property {() => Promise<{ data: object[], indexes: string[] }>} read
 * @property {() => Promise<string | null>} [fingerprint] Changes whenever the legacy data is written.
 * @property {(text: string) => string} [hash]
 * @property {() => Promise<void>} [remove]
 */

/**
 * Persists NeDB documents in SQLite, one row per document, and exposes the
 * subset of NeDB's async API the datastore handlers use. Matching, modifiers,
 * sorting and projection run through NeDB's own implementation, so queries
 * keep their exact semantics. Operations run one at a time, as in NeDB.
 *
 * `childField` stores one array per document (playlist videos) as separate
 * rows. Metadata edits then rewrite one small row instead of every member, and
 * array edits write only the members they add or remove.
 *
 * On first use, the legacy NeDB datastore is imported. It is left in place, so
 * an older version still opens it. When the legacy data changes afterwards and
 * the source can detect that, documents an older version changed, added or
 * deleted are applied here; documents it did not touch keep their newer state.
 */
export class SqliteDatastore {
  /**
   * @param {object} options
   * @param {SqliteDriver} options.driver
   * @param {LegacySource} [options.legacy]
   * @param {string} [options.childField]
   * @param {string[]} [options.indexes] scalar fields used for indexed equality lookups
   * @param {(result: { changed: number, deleted: number, backup?: string }) => void} [options.onLegacyChanges]
   */
  constructor({ driver, legacy, childField, indexes = [], onLegacyChanges }) {
    this.driver = driver
    this.legacy = legacy
    this.childField = childField
    this.indexes = new Set(indexes)
    this.onLegacyChanges = onLegacyChanges
    this.openPromise = null
    this.pending = Promise.resolve()
    // After dropDatabaseAsync, reads find nothing without recreating the database.
    this.dropped = false
    this.executor = { pushAsync: operation => this._exclusive(operation, true) }
  }

  get autoloadPromise() {
    return this.loadDatabaseAsync()
  }

  loadDatabaseAsync() {
    this.openPromise ??= this._open().catch(error => {
      this.openPromise = null
      throw error
    })
    return this.openPromise
  }

  /** Runs operations one at a time, so each sees the previous one's result. */
  _exclusive(operation, read = false) {
    const result = this.pending.then(() => (read && this.dropped) ? undefined : this.loadDatabaseAsync()).then(operation)
    this.pending = result.catch(() => {})
    return result
  }

  async _execute(statements, transaction = false) {
    return statements.length ? this.driver.execute(statements, transaction) : []
  }

  async _query(sql, params = []) {
    return (await this.driver.execute([[sql, params]]))[0]
  }

  async _meta(key) {
    return (await this._query(SQL.getMeta, [key]))[0]?.[0] ?? null
  }

  async _open() {
    this.dropped = false
    await this._execute(SCHEMA.map(sql => [sql]), true)
    const [[[version]]] = await this.driver.execute([['PRAGMA user_version']])
    if (version > SCHEMA_VERSION) {
      throw new Error(`This library was created by a newer version of OpenTubeX (schema ${version})`)
    }
    if (await this._meta('state') !== 'ready') {
      await this._import()
    } else if (this.legacy?.fingerprint) {
      await this._applyLegacyChanges()
    }
    await this._execute([...this.indexes].flatMap(field => this._indexStatements(field)))
  }

  async _readLegacy() {
    const legacy = await this.legacy.read()
    for (const field of legacy.indexes) {
      if (field !== '_id' && FIELD_NAME.test(field)) this.indexes.add(field)
    }
    return legacy.data
  }

  /** Statements that store a document and its members as new rows. */
  _insertStatements(key, doc) {
    const statements = []
    let data = doc
    const children = this.childField && Array.isArray(doc[this.childField]) ? doc[this.childField] : null
    // Keep the key in place so reassembled documents keep their key order.
    if (children) data = { ...doc, [this.childField]: [] }
    statements.push([SQL.insert, [key, model.serialize(data), children ? 1 : 0]])
    children?.forEach((child, position) => statements.push([SQL.insertChild, [key, position, model.serialize(child)]]))
    return statements
  }

  /**
   * Imports the legacy datastore. Batches commit separately, so an
   * interrupted import is discarded and repeated on the next start; the state
   * marker commits last, after every document.
   */
  async _import() {
    await this._execute([['DELETE FROM docs'], ['DELETE FROM children'], ['DELETE FROM meta'], ['DELETE FROM legacy_base']], true)
    const fingerprint = await this.legacy?.fingerprint?.() ?? null
    const docs = this.legacy ? await this._readLegacy() : []
    let batch = []
    let childCount = 0
    for (const doc of docs) {
      const key = keyOf(doc._id)
      const statements = this._insertStatements(key, doc)
      childCount += statements.length - 1
      batch.push(...statements)
      if (this.legacy.hash) batch.push([SQL.setBase, [key, this.legacy.hash(model.serialize(doc))]])
      if (batch.length >= MIGRATION_BATCH_SIZE) {
        await this._execute(batch, true)
        batch = []
      }
    }
    await this._execute(batch, true)

    const [[[storedDocs]], [[storedChildren]]] = await this.driver.execute([
      ['SELECT count(*) FROM docs'], ['SELECT count(*) FROM children']
    ])
    if (storedDocs !== docs.length || storedChildren !== childCount) {
      throw new Error(`Library import stored ${storedDocs}/${docs.length} documents and ${storedChildren}/${childCount} members`)
    }
    await this._execute([
      [SQL.setMeta, ['legacyFingerprint', fingerprint]],
      [SQL.setMeta, ['importedAt', Date.now()]],
      [`PRAGMA user_version = ${SCHEMA_VERSION}`],
      [SQL.setMeta, ['state', 'ready']],
    ], true)
  }

  /**
   * Applies what an older version changed in the legacy datastore since it was
   * imported or last checked, after backing up the database. Documents it
   * edited or deleted are replaced or deleted here. A document it added is
   * added only when no document here has that ID, so a default the older
   * version created cannot replace existing data.
   */
  async _applyLegacyChanges() {
    const fingerprint = await this.legacy.fingerprint()
    if (fingerprint === await this._meta('legacyFingerprint')) return
    const statements = []
    let changed = 0
    let deleted = 0
    if (fingerprint !== null) {
      const base = new Map(await this._query('SELECT id, hash FROM legacy_base'))
      const seen = new Set()
      const added = []
      for (const doc of await this._readLegacy()) {
        const key = keyOf(doc._id)
        const hash = this.legacy.hash(model.serialize(doc))
        seen.add(key)
        if (!base.has(key)) {
          added.push({ key, doc, hash })
        } else if (base.get(key) !== hash) {
          changed++
          statements.push([SQL.remove, [key]], [SQL.removeChildren, [key]], ...this._insertStatements(key, doc), [SQL.setBase, [key, hash]])
        }
      }
      const existing = new Set((await this._query(SQL.existingIds, [JSON.stringify(added.map(({ key }) => key))])).map(([id]) => id))
      for (const { key, doc, hash } of added) {
        if (!existing.has(key)) {
          changed++
          statements.push(...this._insertStatements(key, doc))
        }
        statements.push([SQL.setBase, [key, hash]])
      }
      for (const key of base.keys()) {
        if (seen.has(key)) continue
        deleted++
        statements.push([SQL.remove, [key]], [SQL.removeChildren, [key]], [SQL.removeBase, [key]])
      }
    }
    const backup = changed || deleted ? await this.driver.backup?.() : undefined
    statements.push([SQL.setMeta, ['legacyFingerprint', fingerprint]])
    await this._execute(statements, true)
    if (changed || deleted) this.onLegacyChanges?.({ changed, deleted, backup })
  }

  _indexStatements(field) {
    if (!FIELD_NAME.test(field)) throw new Error(`Unsupported index field: ${field}`)
    return [
      [`CREATE INDEX IF NOT EXISTS "docs_${field}" ON docs (json_extract(data, '$.${field}'))`],
      [`CREATE INDEX IF NOT EXISTS "docs_${field}_arrays" ON docs (json_type(data, '$.${field}')) WHERE json_type(data, '$.${field}') = 'array'`],
    ]
  }

  _indexQuery(field, multiple) {
    // NeDB also matches members of array values, so include those documents.
    return `${SELECT_DOCS} WHERE json_extract(data, '$.${field}') ${multiple ? 'IN (SELECT value FROM json_each(?))' : '= ?'}
      UNION ALL ${SELECT_DOCS} WHERE json_type(data, '$.${field}') = 'array'`
  }

  /** Rows that can match `query`, using an index for simple equality lookups. */
  _candidateRows(query) {
    for (const field of ['_id', ...this.indexes]) {
      if (!Object.hasOwn(query, field)) continue
      const value = query[field]
      const values = value?.$in
      const multiple = Array.isArray(values) && Object.keys(value).length === 1
      // Strings only for secondary indexes, as json_extract returns numbers as numbers.
      const usable = field === '_id' ? isPrimitiveKey : item => typeof item === 'string'
      if (multiple ? !values.every(usable) : !usable(value)) continue
      const param = multiple ? JSON.stringify(values) : value
      if (field === '_id') return this._query(multiple ? SQL.byIds : SQL.byId, [param])
      return this._query(this._indexQuery(field, multiple), [param])
    }
    return this._query(SQL.all)
  }

  /** @returns {Promise<{ id: unknown, doc: object, hasChildren: boolean }[]>} */
  async _candidates(query, withChildren) {
    const candidates = (await this._candidateRows(query)).map(([id, data, hasChildren]) => ({
      id, doc: deserialize(data), hasChildren: hasChildren === 1
    }))
    const parents = withChildren ? candidates.filter(candidate => candidate.hasChildren) : []
    if (parents.length) {
      const byParent = new Map()
      for (const { id, doc } of parents) {
        doc[this.childField] = []
        byParent.set(id, doc[this.childField])
      }
      for (const [parent, data] of await this._query(SQL.childrenOf, [JSON.stringify([...byParent.keys()])])) {
        byParent.get(parent).push(deserialize(data))
      }
    }
    return candidates
  }

  async _matches(query, withChildren, multi) {
    const matches = []
    for (const candidate of await this._candidates(query, withChildren)) {
      if (!model.match(candidate.doc, query)) continue
      matches.push(candidate)
      if (!multi) break
    }
    return matches
  }

  // Used by NeDB's Cursor
  async _getCandidatesAsync(query) {
    if (this.dropped) return []
    return (await this._candidates(query, Boolean(this.childField))).map(candidate => candidate.doc)
  }

  /**
   * Statements that replace a document row. Members of `childField` are
   * written only when `childrenChanged`, and then only the members that
   * differ. With 'append', the document's members are added after the stored ones.
   */
  async _writeStatements(id, doc, childrenChanged) {
    let children = null
    let data = doc
    if (this.childField && Array.isArray(doc[this.childField])) {
      children = doc[this.childField]
      data = { ...doc, [this.childField]: [] }
    }
    const statements = [[SQL.upsert, [id, model.serialize(data), children ? 1 : 0]]]
    if (!this.childField || !childrenChanged) return statements

    const serialized = (children ?? []).map(child => model.serialize(child))
    let position = 0
    if (childrenChanged === 'append') {
      position = (await this._query(SQL.nextChild, [id]))[0][0]
    } else {
      // Keep stored members that remain in order, delete the others, and
      // append the remainder. Adding or removing members writes only those.
      let next = 0
      for (const [pos, stored] of await this._query(SQL.children, [id])) {
        if (next < serialized.length && stored === serialized[next]) {
          next++
          position = pos + 1
        } else {
          statements.push([SQL.removeChild, [id, pos]])
        }
      }
      serialized.splice(0, next)
    }
    for (const child of serialized) statements.push([SQL.insertChild, [id, position++, child]])
    return statements
  }

  async _insert(newDoc) {
    const docs = (Array.isArray(newDoc) ? newDoc : [newDoc]).map(doc => {
      const prepared = model.deepCopy(doc)
      prepared._id ??= uid(16)
      model.checkObject(prepared)
      return prepared
    })
    const keys = docs.map(doc => keyOf(doc._id))
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index)
    if (duplicate !== undefined) throw uniqueViolation(duplicate)
    const [existing] = await this._query(SQL.existingIds, [JSON.stringify(keys)])
    if (existing) throw uniqueViolation(existing[0])
    await this._execute(docs.flatMap((doc, index) => this._insertStatements(keys[index], doc)), true)
    return Array.isArray(newDoc) ? docs.map(doc => model.deepCopy(doc)) : model.deepCopy(docs[0])
  }

  insertAsync(newDoc) {
    return this._exclusive(() => this._insert(newDoc))
  }

  find(query = {}, projection = {}) {
    return new Cursor(this, query).projection(projection)
  }

  findAsync(query = {}, projection = {}) {
    return this.find(query, projection)
  }

  findOneAsync(query = {}, projection = {}) {
    return new Cursor(this, query, docs => docs.length === 1 ? docs[0] : null).projection(projection).limit(1)
  }

  async countAsync(query = {}) {
    return (await this.findAsync(query)).length
  }

  updateAsync(query, update, options = {}) {
    return this._exclusive(() => this._update(query, update, options))
  }

  async _update(query, update, { multi = false, upsert = false, returnUpdatedDocs = false }) {
    const modifier = isModifierUpdate(update)
    const append = modifier && Boolean(this.childField) && !returnUpdatedDocs && isAppend(update, this.childField)
    const childrenChanged = Boolean(this.childField) && (!modifier || references(update, this.childField))
    const withChildren = Boolean(this.childField) && (
      returnUpdatedDocs || references(query, this.childField) || (modifier && childrenChanged && !append)
    )

    const matches = await this._matches(query, withChildren, multi)
    if (matches.length === 0 && upsert) {
      let toBeInserted
      try {
        model.checkObject(update)
        toBeInserted = update
      } catch {
        toBeInserted = model.modify(model.deepCopy(query, true), update)
      }
      return { numAffected: 1, affectedDocuments: await this._insert(toBeInserted), upsert: true }
    }

    // Prepare every change before writing, as NeDB does, so an invalid
    // modifier leaves all documents unchanged. Without loaded children, the
    // modifier cannot reference them, and their placeholder is stored without
    // touching the member rows. When appending, the placeholder receives only
    // the new members.
    const modifications = matches.map(({ id, doc, hasChildren }) => {
      const newDoc = model.modify(append && hasChildren && withChildren ? { ...doc, [this.childField]: [] } : doc, update)
      if (keyOf(newDoc._id) !== id) throw new Error('You cannot change a document\'s _id')
      return { id, newDoc }
    })
    const statements = []
    for (const { id, newDoc } of modifications) {
      statements.push(...await this._writeStatements(id, newDoc, append ? 'append' : childrenChanged))
    }
    await this._execute(statements, true)

    if (!returnUpdatedDocs) return { numAffected: modifications.length, upsert: false, affectedDocuments: null }
    const updated = modifications.map(({ newDoc }) => model.deepCopy(newDoc))
    return { numAffected: modifications.length, affectedDocuments: multi ? updated : updated[0], upsert: false }
  }

  removeAsync(query, options = {}) {
    return this._exclusive(async () => {
      const matches = await this._matches(query, Boolean(this.childField) && references(query, this.childField), options.multi === true)
      await this._execute(matches.flatMap(({ id }) => [[SQL.remove, [id]], [SQL.removeChildren, [id]]]), true)
      return matches.length
    })
  }

  ensureIndexAsync({ fieldName }) {
    return this._exclusive(async () => {
      if (fieldName === '_id' || this.indexes.has(fieldName)) return
      await this._execute(this._indexStatements(fieldName))
      this.indexes.add(fieldName)
    })
  }

  /** Returns freed pages to the file system and truncates the write-ahead log. */
  compactDatafileAsync() {
    return this._exclusive(async () => {
      if (this.dropped) return
      await this._execute([['PRAGMA incremental_vacuum'], ['PRAGMA wal_checkpoint(TRUNCATE)']])
    }, true)
  }

  /**
   * Deletes the database together with its legacy datastore, which would
   * otherwise be imported again. The next write starts an empty database.
   */
  dropDatabaseAsync() {
    return this._exclusive(async () => {
      await this.driver.drop()
      await this.legacy?.remove?.()
      this.dropped = true
      this.openPromise = null
    }, true)
  }
}
