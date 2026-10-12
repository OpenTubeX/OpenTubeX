import { createReadStream } from 'node:fs'
import { access, open, readFile, rename, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { setImmediate as yieldToRequests } from 'node:timers/promises'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine, deserialize } from './engine.js'
import { COLLECTIONS, LIBRARY_FILE_NAME, LIBRARY_SCHEMA_VERSION, MEMBER_ACCOUNTING_SQL, MEMBER_INDEX_SQL, SCHEMA_SQL } from './schema.js'

async function exists(path) {
  try { await access(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function fingerprint(path) {
  if (!await exists(path)) return 'absent'
  const info = await stat(path, { bigint: true })
  if (!info.isFile()) throw new Error(`Legacy datastore is not a regular file: ${path}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${hash.digest('hex')}`
}

// Byte offsets, including CRLF and UTF-8 multibyte characters, make chunk
// commits resumable without reparsing the already migrated append log.
async function * lines(path, offset, lineNumber) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = line => {
    lineNumber++
    try { return decoder.decode(line) } catch (error) {
      throw new Error(`Cannot migrate ${path} at line ${lineNumber}: ${error.message}. The original file has not been changed.`, { cause: error })
    }
  }
  let fragments = []
  let pendingLength = 0
  for await (const chunk of createReadStream(path, { start: offset })) {
    let start = 0
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      fragments.push(chunk.subarray(start, end))
      pendingLength += end - start
      const line = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments, pendingLength)
      offset += pendingLength + 1
      fragments = []
      pendingLength = 0
      yield { text: decode(line).replace(/\r$/, ''), offset }
      start = end + 1
    }
    if (start < chunk.length) {
      fragments.push(chunk.subarray(start))
      pendingLength += chunk.length - start
    }
  }
  if (pendingLength) {
    const line = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments, pendingLength)
    fragments.length = 0
    yield { text: decode(line), offset: offset + pendingLength }
  }
}

function configure(database) {
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000; PRAGMA temp_store = FILE; PRAGMA cache_size = -16384;')
}

function verifyDatabase(database) {
  if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed')
  if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed')
  if (database.prepare('SELECT 1 FROM record_arrays a WHERE length <> (SELECT count(*) FROM members m WHERE m.collection = a.collection AND m.record_id = a.record_id AND m.field = a.field) LIMIT 1').get()) throw new Error('SQLite member counts do not match')
}

async function syncDirectory(directory) {
  // Windows does not allow opening directories for fsync. SQLite and the
  // completed file are still flushed before the atomic rename there.
  if (process.platform === 'win32') return
  const handle = await open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function writeIdentityMarker(directory, markerPath, identity) {
  // Publish only a complete, flushed marker. An interrupted write leaves a
  // disposable pending file, so the validated active database can reopen.
  const pendingPath = `${markerPath}.pending`
  const marker = await open(pendingPath, 'w', 0o600)
  try { await marker.writeFile(identity); await marker.sync() } finally { await marker.close() }
  await rename(pendingPath, markerPath)
  await syncDirectory(directory)
}

function libraryError(code, message) {
  return Object.assign(new Error(message), { code })
}

/**
 * Never opens a legacy file through NeDB: its loader compacts the source and
 * can discard malformed lines. Originals remain byte-for-byte untouched.
 * `onCheckpoint` is also the fault-injection seam for recovery tests.
 */
export async function openLibrary(directory, { onCheckpoint, onStartupReady, batchSize = 250 } = {}) {
  const activePath = join(directory, LIBRARY_FILE_NAME)
  const markerPath = join(directory, `${LIBRARY_FILE_NAME}.initialized`)
  const stagingPath = join(directory, `${LIBRARY_FILE_NAME}.migrating`)
  if (await exists(activePath)) {
    const database = new DatabaseSync(activePath)
    try {
      configure(database)
      if (database.prepare('PRAGMA user_version').get().user_version !== LIBRARY_SCHEMA_VERSION) throw new Error('Unsupported library schema version')
      const identity = database.prepare("SELECT value FROM metadata WHERE key = 'identity'").get()?.value
      if (database.prepare("SELECT value FROM metadata WHERE key = 'migrationComplete'").get()?.value !== 'true' || !identity) throw new Error('Library migration has not been validated')
      if (await exists(markerPath) && (await readFile(markerPath, 'utf8')) !== identity) throw libraryError('LIBRARY_IDENTITY_MISMATCH', 'The library identity does not match this installation')
      if (!await exists(markerPath)) {
        await writeIdentityMarker(directory, markerPath, identity)
      }
      return new LibraryEngine(database)
    } catch (error) {
      // Read recovery preferences directly; normal handlers would reopen the
      // failed library. A malformed setting must not hide another readable one.
      for (const [id, key] of [['currentLocale', 'locale'], ['useAITranslationCompletions', 'useAITranslationCompletions']]) {
        try {
          const settings = database.prepare("SELECT data FROM records WHERE collection = 'settings' AND id = ?").get(id)
          if (settings) error[key] = model.deserialize(settings.data).value
        } catch { /* A corrupt database may not have readable settings. */ }
      }
      database.close()
      throw error
    }
  }
  if (await exists(markerPath)) throw libraryError('LIBRARY_MISSING', 'The active library is missing. Restore library.sqlite; legacy files are retained snapshots and must not replace newer data.')

  // Create privately before SQLite opens it. SQLite gives WAL/SHM sidecars
  // the database's mode; tightening an existing stage also protects resume.
  const stagingFile = await open(stagingPath, 'a', 0o600)
  try { await stagingFile.chmod(0o600) } finally { await stagingFile.close() }
  const database = new DatabaseSync(stagingPath)
  try {
    configure(database)
    const version = database.prepare('PRAGMA user_version').get().user_version
    if (version === 0) {
      database.exec('BEGIN IMMEDIATE')
      database.exec(SCHEMA_SQL)
      // Whole legacy playlists can be megabytes. A rowid table keeps their
      // payload out of the primary-key index used for every replayed record.
      database.exec('CREATE TABLE migration_expected (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection, id))')
      database.prepare('INSERT INTO metadata VALUES (?, ?)').run('identity', randomUUID())
      database.exec('COMMIT')
    } else if (version !== LIBRARY_SCHEMA_VERSION) throw new Error('Unsupported staging library schema')
    const engine = new LibraryEngine(database)
    const alreadyValidated = engine.prepare("SELECT value FROM metadata WHERE key = 'migrationComplete'").get()?.value === 'true'
    if (!alreadyValidated) {
      // No live reads/writes can reach staging. Avoid updating the same two
      // counters for every replayed member; derive them once before validation.
      // The source log, constraints and independent record copy stay intact.
      database.exec('DROP TRIGGER IF EXISTS members_insert; DROP TRIGGER IF EXISTS members_delete; DROP TRIGGER IF EXISTS members_update;')
      // Uniqueness and foreign keys remain enforced during replay. The two
      // lookup-only indexes are faster to build after the bulk inserts.
      database.exec('DROP INDEX IF EXISTS members_video; DROP INDEX IF EXISTS members_item;')
      // Prepare windows from verified copies of these small collections while
      // bulk migration continues. Live access still waits for full activation.
      const startupCollections = ['settings', 'tabSession']
      const collections = [...startupCollections, ...Object.keys(COLLECTIONS).filter(name => !startupCollections.includes(name))]
      const publishStartup = async () => {
        if (!onStartupReady) return
        const snapshot = {}
        for (const name of startupCollections) {
          const expected = engine.prepare('SELECT id, data FROM migration_expected WHERE collection = ? ORDER BY id').all(name)
          const records = await engine.collections[name].findAsync({})
          if (!isDeepStrictEqual(expected.map(row => deserialize(row.data)), records)) throw new Error(`Lossless startup verification failed for ${name}`)
          snapshot[name] = records
        }
        await onStartupReady(snapshot)
      }
      for (const collection of collections) {
        const filename = COLLECTIONS[collection]
        const path = join(directory, `${filename}.db`)
        const signature = await fingerprint(path)
        let source = engine.prepare('SELECT * FROM migration_sources WHERE collection = ?').get(collection)
        if (source && source.fingerprint !== signature) {
        // Staging has never accepted live application writes. Only this
        // collection is discarded when a retained source changed after a crash.
          await engine.transaction(() => {
            engine.prepare('DELETE FROM records WHERE collection = ?').run(collection)
            engine.prepare('DELETE FROM migration_expected WHERE collection = ?').run(collection)
            engine.prepare('DELETE FROM metadata WHERE substr(key, 1, length(?)) = ?').run(`legacyIndex:${collection}:`, `legacyIndex:${collection}:`)
            engine.prepare('DELETE FROM migration_sources WHERE collection = ?').run(collection)
          })
          source = null
        }
        if (!source) {
          engine.prepare('INSERT INTO migration_sources(collection, path, fingerprint) VALUES (?, ?, ?)').run(collection, path, signature)
          source = { offset: 0, lines: 0, complete: 0 }
        }
        if (source.complete) {
          if (collection === 'tabSession') await publishStartup()
          continue
        }
        let lineNumber = source.lines
        let batch = []
        const commit = async () => {
          if (!batch.length) return
          await engine.transaction(async () => {
            let yieldAt = performance.now() + 2
            for (const line of batch) {
              lineNumber++
              if (!line.text.trim()) continue
              let record
              try {
                record = deserialize(line.text)
                if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Expected an object')
                if (typeof record._id === 'string' && record._id) {
                  if (!record._id.isWellFormed()) throw new Error('A record ID contains an unpaired UTF-16 surrogate and cannot be safely migrated to SQLite')
                  if (record.$$deleted === true) {
                    engine.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(collection, record._id)
                    engine.prepare('DELETE FROM migration_expected WHERE collection = ? AND id = ?').run(collection, record._id)
                  } else {
                    // Canonical serialization validates each key once. NeDB's
                    // checkObject visits arrays twice; keep its date/key codec
                    // without that extra recursive traversal of large members.
                    const serialized = model.serialize(record)
                    engine.writeSerialized(collection, serialized, true, true)
                    engine.prepare('INSERT INTO migration_expected VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data').run(collection, record._id, serialized)
                  }
                } else if (record.$$indexCreated || record.$$indexRemoved) {
                // Retain the original index declaration for recovery/export.
                  engine.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(`legacyIndex:${collection}:${lineNumber}`, line.text)
                } else throw new Error('Record has no valid ID or index declaration')
              } catch (error) {
                throw new Error(`Cannot migrate ${filename}.db at line ${lineNumber}: ${error.message}. The original file has not been changed.`, { cause: error })
              }
              // Startup reads use a separate verified database; let their IPC
              // messages run between replay slices while live writes stay gated.
              if (onStartupReady && performance.now() >= yieldAt) {
                await yieldToRequests()
                yieldAt = performance.now() + 2
              }
            }
            engine.prepare('UPDATE migration_sources SET offset = ?, lines = ? WHERE collection = ?').run(batch.at(-1).offset, lineNumber, collection)
          })
          batch = []
          await onCheckpoint?.({ collection, lines: lineNumber })
        }
        if (signature !== 'absent') {
          for await (const line of lines(path, source.offset, source.lines)) {
            batch.push(line)
            if (batch.length >= batchSize) await commit()
          }
          await commit()
        }
        if (await fingerprint(path) !== signature) throw new Error(`Legacy datastore changed during migration: ${filename}.db. Restart to retry from the untouched source.`)
        engine.prepare('UPDATE migration_sources SET complete = 1 WHERE collection = ?').run(collection)
        if (collection === 'tabSession') await publishStartup()
      }

      await engine.transaction(() => {
        database.exec(`
          UPDATE record_arrays AS a SET
            length = (SELECT count(*) FROM members m WHERE m.collection = a.collection AND m.record_id = a.record_id AND m.field = a.field),
            next_position = coalesce((SELECT max(position) + 1 FROM members m WHERE m.collection = a.collection AND m.record_id = a.record_id AND m.field = a.field), 0);
          DELETE FROM collection_counts;
          INSERT INTO collection_counts(collection, count, bytes)
            SELECT r.collection, count(*), sum(length(CAST(r.data AS BLOB)))
              + coalesce((SELECT sum(length(CAST(m.data AS BLOB))) FROM members m WHERE m.collection = r.collection), 0)
              + coalesce((SELECT sum(length(CAST(b.data AS BLOB))) FROM record_blobs b WHERE b.collection = r.collection), 0)
            FROM records r GROUP BY r.collection;
        `)
        database.exec(MEMBER_ACCOUNTING_SQL)
        database.exec(MEMBER_INDEX_SQL)
      })

      // Compare reconstructed documents, including every ordered member and
      // thumbnail byte, with an independent copy of the replayed source records.
      for (const expected of engine.prepare('SELECT collection, id, data FROM migration_expected').iterate()) {
        const row = engine.prepare('SELECT id, data FROM records WHERE collection = ? AND id = ?').get(expected.collection, expected.id)
        const original = deserialize(expected.data)
        if (typeof original._id !== 'string' || !original._id.isWellFormed() || original._id !== expected.id || !row || !isDeepStrictEqual(original, engine.materialize(expected.collection, row))) throw new Error(`Lossless migration verification failed for ${expected.collection}/${expected.id}`)
      }
      if (engine.prepare('SELECT count(*) AS count FROM migration_expected').get().count !== engine.prepare('SELECT count(*) AS count FROM records').get().count) throw new Error('Lossless migration record counts do not match')
      verifyDatabase(database)
      for (const source of engine.prepare('SELECT * FROM migration_sources').all()) {
        if (await fingerprint(source.path) !== source.fingerprint) throw new Error('A legacy datastore changed before migration was activated')
      }
      await engine.transaction(() => {
        database.exec('DROP TABLE migration_expected')
        engine.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run('migrationComplete', 'true')
      })
    } else {
      verifyDatabase(database)
      for (const source of engine.prepare('SELECT * FROM migration_sources').all()) {
        if (await fingerprint(source.path) !== source.fingerprint) throw new Error('A legacy datastore changed after validation; retain the staging file and repair the source before retrying')
      }
    }
    const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
    if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) throw new Error('Library migration checkpoint is incomplete; close other readers and retry')
    const identity = engine.prepare("SELECT value FROM metadata WHERE key = 'identity'").get().value
    database.close()
    const handle = await open(stagingPath, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    await onCheckpoint?.({ collection: 'validated', lines: 0 })
    await rename(stagingPath, activePath)
    await syncDirectory(directory)
    await writeIdentityMarker(directory, markerPath, identity)
    return openLibrary(directory)
  } catch (error) {
    if (database.isOpen) database.close()
    throw error
  }
}
