import { createReadStream } from 'node:fs'
import { access, chmod, open, readFile, rename, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from './engine.js'
import { COLLECTIONS, LIBRARY_FILE_NAME, LIBRARY_SCHEMA_VERSION, SCHEMA_SQL } from './schema.js'

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
async function * lines(path, offset) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
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
      yield { text: decoder.decode(line).replace(/\r$/, ''), offset }
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
    yield { text: decoder.decode(line), offset: offset + pendingLength }
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
export async function openLibrary(directory, { onCheckpoint, batchSize = 250 } = {}) {
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

  const database = new DatabaseSync(stagingPath)
  await chmod(stagingPath, 0o600)
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
      for (const [collection, filename] of Object.entries(COLLECTIONS)) {
        const path = join(directory, `${filename}.db`)
        const signature = await fingerprint(path)
        let source = engine.prepare('SELECT * FROM migration_sources WHERE collection = ?').get(collection)
        if (source && source.fingerprint !== signature) {
        // Staging has never accepted live application writes. Only this
        // collection is discarded when a retained source changed after a crash.
          await engine.transaction(() => {
            engine.prepare('DELETE FROM records WHERE collection = ?').run(collection)
            engine.prepare('DELETE FROM migration_expected WHERE collection = ?').run(collection)
            engine.prepare('DELETE FROM migration_sources WHERE collection = ?').run(collection)
          })
          source = null
        }
        if (!source) {
          engine.prepare('INSERT INTO migration_sources(collection, path, fingerprint) VALUES (?, ?, ?)').run(collection, path, signature)
          source = { offset: 0, lines: 0, complete: 0 }
        }
        if (source.complete) continue
        let lineNumber = source.lines
        let batch = []
        const commit = async () => {
          if (!batch.length) return
          await engine.transaction(() => {
            for (const line of batch) {
              lineNumber++
              if (!line.text.trim()) continue
              let record
              try {
                record = model.deserialize(line.text)
                if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Expected an object')
                if (typeof record._id === 'string' && record._id) {
                  if (record.$$deleted === true) {
                    engine.prepare('DELETE FROM records WHERE collection = ? AND id = ?').run(collection, record._id)
                    engine.prepare('DELETE FROM migration_expected WHERE collection = ? AND id = ?').run(collection, record._id)
                  } else {
                    engine.write(collection, record, true)
                    engine.prepare('INSERT INTO migration_expected VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data').run(collection, record._id, model.serialize(record))
                  }
                } else if (record.$$indexCreated || record.$$indexRemoved) {
                // Retain the original index declaration for recovery/export.
                  engine.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(`legacyIndex:${collection}:${lineNumber}`, line.text)
                } else throw new Error('Record has no valid ID or index declaration')
              } catch (error) {
                throw new Error(`Cannot migrate ${filename}.db at line ${lineNumber}: ${error.message}. The original file has not been changed.`, { cause: error })
              }
            }
            engine.prepare('UPDATE migration_sources SET offset = ?, lines = ? WHERE collection = ?').run(batch.at(-1).offset, lineNumber, collection)
          })
          batch = []
          await onCheckpoint?.({ collection, lines: lineNumber })
        }
        if (signature !== 'absent') {
          for await (const line of lines(path, source.offset)) {
            batch.push(line)
            if (batch.length >= batchSize) await commit()
          }
          await commit()
        }
        if (await fingerprint(path) !== signature) throw new Error(`Legacy datastore changed during migration: ${filename}.db. Restart to retry from the untouched source.`)
        engine.prepare('UPDATE migration_sources SET complete = 1 WHERE collection = ?').run(collection)
      }

      // Compare reconstructed documents, including every ordered member and
      // thumbnail byte, with an independent copy of the replayed source records.
      for (const expected of engine.prepare('SELECT collection, id, data FROM migration_expected').iterate()) {
        const row = engine.prepare('SELECT id, data FROM records WHERE collection = ? AND id = ?').get(expected.collection, expected.id)
        if (!row || !isDeepStrictEqual(model.deserialize(expected.data), engine.materialize(expected.collection, row))) throw new Error(`Lossless migration verification failed for ${expected.collection}/${expected.id}`)
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
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
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
