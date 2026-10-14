import { randomUUID } from 'node:crypto'
import { mkdtempSync, openSync, readSync, writeSync, closeSync, rmSync, fstatSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Unzip, UnzipInflate } from 'fflate'
import model from '@seald-io/nedb/lib/model.js'
import { decodeBackupValue, BACKUP_SECTIONS, validateUnifiedBackup, mergeBackupHistoryRecord, mergeBackupPlaylist, mergeBackupProfile } from '../../renderer/helpers/unifiedBackup.js'
import { migrateLegacyHistoryRecord } from '../../history.js'
import { previewBackupImport } from '../../renderer/helpers/import-preview.js'
import { importPreviewState } from './operations.js'
import { mergeSearchHistoryEntries, getSearchHistoryEntryKeyFromEntry } from '../../search-history.js'

const MAX_ARCHIVE = 1024 * 1024 * 1024
const MAX_EXPANDED = 8 * 1024 * 1024 * 1024
const MAX_RECORD = 128 * 1024 * 1024
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = index & 1 ? 0xEDB88320 ^ index >>> 1 : index >>> 1
  return index >>> 0
})
const crc = (value, data) => { for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return value >>> 0 }

/** Split a root JSON array into records without collecting the entire section. */
class ArrayReader {
  constructor(record) { this.record = record; this.buffer = ''; this.start = 0; this.depth = 0; this.string = false; this.escape = false; this.open = false; this.closed = false; this.expect = 'value'; this.position = 0 }
  push(text, final) {
    this.buffer += text
    for (; this.position < this.buffer.length; this.position++) {
      const c = this.buffer[this.position]
      if (this.string) { if (this.escape) this.escape = false; else if (c === '\\') this.escape = true; else if (c === '"') this.string = false; continue }
      if (this.depth) {
        if (c === '"') this.string = true
        else if (c === '{' || c === '[') this.depth++
        else if (c === '}' || c === ']') {
          this.depth--
          if (!this.depth) {
            if (this.position + 1 - this.start > MAX_RECORD) throw new Error('Individual backup record is too large')
            this.record(JSON.parse(this.buffer.slice(this.start, this.position + 1)))
            this.expect = 'comma'
            this.start = this.position + 1
          }
        }
        continue
      }
      if (/\s/.test(c)) continue
      if (!this.open) { if (c !== '[') throw new Error('Backup section must be an array'); this.open = true; this.start = this.position + 1; continue }
      if (this.closed) throw new Error('Unexpected data after backup array')
      if (c === ']') { if (this.expect === 'afterComma') throw new Error('Trailing comma in backup'); this.closed = true; this.start = this.position + 1; continue }
      if (this.expect === 'comma') { if (c !== ',') throw new Error('Missing backup separator'); this.expect = 'afterComma'; this.start = this.position + 1; continue }
      if (c !== '{') throw new Error('Backup record must be an object')
      this.start = this.position
      this.depth = 1
    }
    if (!this.depth) { this.buffer = ''; this.position = 0; this.start = 0 } else if (this.start) { this.buffer = this.buffer.slice(this.start); this.position -= this.start; this.start = 0 }
    if (this.buffer.length > MAX_RECORD) throw new Error('Individual backup record is too large')
    if (final && (!this.closed || this.string || this.depth)) throw new Error('Truncated backup section')
  }
}

function emptyBackup() { return { settings: {}, profiles: [], playlists: [], history: [], searchHistory: [], watchStats: { records: [], adjustment: null } } }

function prepareHistoryTargets(engine, job) {
  engine.database.exec(`
    CREATE TEMP TABLE import_history_sources (record_id TEXT, video_id TEXT);
    CREATE INDEX import_history_source_ids ON import_history_sources(record_id);
    CREATE INDEX import_history_source_videos ON import_history_sources(video_id);
    CREATE TEMP TABLE import_history_targets (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, available INTEGER NOT NULL) WITHOUT ROWID;
    CREATE INDEX import_history_target_videos ON import_history_targets(video_id, available);
  `)
  const insert = engine.prepare("INSERT INTO import_history_sources VALUES (?, json_extract(?, '$'))")
  for (const row of job.database.prepare(`
    SELECT data -> '$._id' AS id_key,
      CASE WHEN json_type(data, '$.videoId') = 'text' THEN data -> '$.videoId' END AS video_key,
      CASE WHEN json_type(data, '$.$$backupObject') = 'array' THEN data END AS escaped
    FROM incoming WHERE section = 'history'
  `).iterate()) {
    const source = row.escaped ? job.decode(row.escaped) : { _id: JSON.parse(row.id_key ?? 'null'), videoId: JSON.parse(row.video_key ?? 'null') }
    // Reserve every exact ID, even if its incoming video identity is not a string.
    // JSON keys avoid converting retained surrogate bytes at the JS/TEXT boundary.
    insert.run(source._id ?? null, JSON.stringify(typeof source.videoId === 'string' ? source.videoId : null))
  }
  // Freeze the eligible destinations before writing. Reserve exact IDs first,
  // so an earlier fallback cannot consume a later row's exact match. Only
  // projected keys are copied; escaped records are decoded one at a time.
  // An ID-less source cannot reserve its prior copy on a later restore. Avoid
  // fallback for that entire video so identified rows cannot consume those copies.
  engine.database.exec(`
    INSERT INTO import_history_targets
    SELECT r.id, r.video_id, NOT EXISTS (SELECT 1 FROM import_history_sources s WHERE s.record_id = r.id)
    FROM records r WHERE r.collection = 'history' AND r.video_id IN (SELECT video_id FROM import_history_sources)
    AND r.video_id NOT IN (SELECT video_id FROM import_history_sources WHERE video_id IS NOT NULL AND (record_id IS NULL OR record_id = ''));
  `)
}

function removeAbandonedImports(prefix) {
  for (const entry of readdirSync(dirname(prefix), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(basename(prefix))) continue
    const suffix = entry.name.slice(basename(prefix).length)
    if (!/^[1-9]\d*-[A-Za-z0-9]{6}$/.test(suffix)) continue
    const pid = Number(suffix.split('-')[0])
    if (!Number.isSafeInteger(pid) || pid > 2147483647) continue
    try { process.kill(pid, 0) } catch (error) {
      // EPERM and other errors do not establish that the owner has exited.
      if (error.code !== 'ESRCH') continue
      try { rmSync(join(dirname(prefix), entry.name), { recursive: true, force: true }) } catch (error) {
        // A leftover temporary stage must not prevent opening the live library.
        console.error('Failed to remove an abandoned library import:', error)
      }
    }
  }
}

/** Incomplete, corrupt or unselected imports never write to the active library. */
export class LibraryImports {
  constructor(engine) {
    this.engine = engine
    this.jobs = new Map()
    this.stagePrefix = engine.database.prepare('PRAGMA database_list').get().file + '.imports-'
    removeAbandonedImports(this.stagePrefix)
  }

  start({ format = 'backup' } = {}) {
    if (this.jobs.size >= 2) throw new Error('Finish or cancel the current library import first')
    if (!['backup', 'records'].includes(format)) throw new Error('Unknown import format')
    const directory = mkdtempSync(`${this.stagePrefix}${process.pid}-`)
    let database
    let fd
    try {
      database = new DatabaseSync(join(directory, 'staging.sqlite'))
      database.exec('CREATE TABLE incoming(section TEXT NOT NULL, ordinal INTEGER PRIMARY KEY, data TEXT NOT NULL); PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
      const insert = database.prepare('INSERT INTO incoming(section, data) VALUES (?, ?)')
      fd = openSync(join(directory, 'source.zip'), 'wx+', 0o600)
      const job = { directory, database, insert, format, fd, bytes: 0, expanded: 0, entries: new Map(), roots: new Map(), error: null, ready: false }
      const unzip = new Unzip(entry => {
        try {
          const section = entry.name.replace(/\.json$/, '')
          if (entry.name !== section + '.json' || !['manifest', ...BACKUP_SECTIONS].includes(section) || job.entries.has(section)) throw new Error('Backup has duplicate or unexpected entries')
          const state = { name: entry.name, crc: 0xFFFFFFFF, size: 0, final: false }
          job.entries.set(section, state)
          const decoder = new TextDecoder('utf-8', { fatal: true })
          let root = ''
          const reader = ['profiles', 'playlists', 'history', 'searchHistory'].includes(section)
            ? new ArrayReader(record => {
                // The manifest may follow the records; validate after its codec is known.
                insert.run(section, JSON.stringify(record))
              })
            : null
          entry.ondata = (error, data, final) => {
            if (job.error) return
            try {
              if (error) throw error
              state.crc = crc(state.crc, data); state.size += data.length; job.expanded += data.length
              if (job.expanded > MAX_EXPANDED) throw new Error('Backup exceeds the import size limit')
              const text = decoder.decode(data, { stream: !final })
              if (reader) reader.push(text, final)
              else {
                root += text
                if (root.length > MAX_RECORD) throw new Error('Backup metadata is too large')
                if (final) {
                  const value = JSON.parse(root)
                  job.roots.set(section, value)
                }
              }
              state.final = final
            } catch (error) { job.error = error }
          }
          entry.start()
        } catch (error) { job.error = error }
      })
      unzip.register(UnzipInflate)
      job.unzip = unzip
      const id = randomUUID()
      this.jobs.set(id, job)
      return { id }
    } catch (error) {
      for (const cleanup of [() => { if (fd !== undefined) closeSync(fd) }, () => database?.close(), () => rmSync(directory, { recursive: true, force: true })]) {
        try { cleanup() } catch (cleanupError) { console.error('Unable to clean up failed import setup:', cleanupError) }
      }
      throw error
    }
  }

  chunk({ id, data, section, records }) {
    const job = this.jobs.get(id)
    if (!job || job.ready) throw new Error('Unknown or completed library import')
    if (job.format === 'records') {
      if (!['history', 'playlists', 'profiles', 'searchHistory'].includes(section) || !Array.isArray(records) || records.length > 250) throw new Error('Invalid record import chunk')
      try {
        job.database.exec('BEGIN')
        for (const record of records) {
          const check = emptyBackup(); check[section] = [record]; validateUnifiedBackup(check)
          const encoded = model.serialize(record)
          job.expanded += Buffer.byteLength(encoded)
          if (job.expanded > MAX_EXPANDED) throw new Error('Import exceeds the size limit')
          job.insert.run(section, encoded)
        }
        job.database.exec('COMMIT')
      } catch (error) { this.abortChunk(id, job, error) }
      return true
    }
    if (!(data instanceof Uint8Array) || data.length > 65536) throw new Error('Invalid import chunk')
    job.bytes += data.length
    if (job.bytes > MAX_ARCHIVE) this.abortChunk(id, job, new Error('Backup archive is too large'))
    try {
      let offset = 0
      while (offset < data.length) offset += writeSync(job.fd, data, offset, data.length - offset)
      job.database.exec('BEGIN')
      job.unzip.push(data)
      if (job.error) throw job.error
      job.database.exec('COMMIT')
    } catch (error) { this.abortChunk(id, job, error) }
    return true
  }

  abortChunk(id, job, error) {
    try {
      try { if (job.database.isTransaction) job.database.exec('ROLLBACK') } finally { this.cancel({ id }) }
    } catch (cleanupError) {
      console.error('Failed to clean up an interrupted library import:', cleanupError)
    }
    throw error
  }

  finish({ id }) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('Unknown library import')
    try {
      if (job.format === 'records') {
        job.ready = true
        return { id, counts: Object.fromEntries(job.database.prepare('SELECT section, count(*) AS count FROM incoming GROUP BY section').all().map(row => [row.section, row.count])) }
      }
      job.unzip.push(new Uint8Array(), true)
      if (job.error) throw job.error
      const manifest = job.roots.get('manifest')
      if (manifest?.format !== 'opentubex-backup' || manifest.version !== 1) throw new Error('Unsupported backup version')
      if (manifest.encoding !== undefined && manifest.encoding !== 'opentubex-json-v1') throw new Error('Unsupported backup encoding')
      const sections = manifest.sections ?? BACKUP_SECTIONS
      if (!Array.isArray(sections) || !sections.length || new Set(sections).size !== sections.length || sections.some(section => !BACKUP_SECTIONS.includes(section))) throw new Error('Invalid backup sections')
      if (job.entries.size !== sections.length + 1 || sections.some(section => !job.entries.has(section)) || [...job.entries.values()].some(entry => !entry.final)) throw new Error('Backup has missing or truncated entries')
      job.decode = manifest.encoding ? decodeBackupValue : JSON.parse
      if (manifest.encoding) for (const section of ['settings', 'watchStats']) if (sections.includes(section)) job.roots.set(section, decodeBackupValue(JSON.stringify(job.roots.get(section))))
      this.verifyChecksums(job)
      // Validate decoded values before making the stage available. Iterate the
      // staging database so even a large archive needs only one record in memory.
      for (const row of job.database.prepare('SELECT section, data FROM incoming').iterate()) {
        const check = emptyBackup(); check[row.section] = [job.decode(row.data)]; validateUnifiedBackup(check)
      }
      for (const section of ['settings', 'watchStats']) {
        if (sections.includes(section)) {
          const check = emptyBackup(); check[section] = job.roots.get(section); validateUnifiedBackup(check)
        }
      }
      job.sections = sections
      job.ready = true
      return { id, sections, counts: Object.fromEntries(job.database.prepare('SELECT section, count(*) AS count FROM incoming GROUP BY section').all().map(row => [row.section, row.count])) }
    } catch (error) { this.cancel({ id }); throw error }
  }

  async preview({ id, settingKeys = [] }) {
    const job = this.jobs.get(id)
    if (!job?.ready || job.format !== 'backup') throw new Error('Unknown or incomplete backup preview')
    if (!Array.isArray(settingKeys) || settingKeys.length > 1000 || settingKeys.some(key => typeof key !== 'string')) throw new TypeError('Invalid preview settings')
    const data = {}
    const fields = { profiles: ['_id', 'subscriptions'], playlists: ['_id'], history: ['videoId'], searchHistory: ['_id', 'query', 'searchSettings'] }
    for (const section of job.sections) {
      if (section === 'settings') data.settings = job.roots.get(section)
      else if (section === 'watchStats') data.watchStats = job.roots.get(section)
      else {
        const projection = fields[section].map(field => `'${field}', json(data -> '$.${field}')`).join(', ')
        const rows = job.database.prepare(`SELECT CASE WHEN json_type(data, '$.$$backupObject') = 'array' THEN data ELSE json_object(${projection}) END AS data FROM incoming WHERE section = ? ORDER BY ordinal`)
        data[section] = []
        for (const row of rows.iterate(section)) {
          const record = job.decode(row.data)
          const projected = Object.fromEntries(fields[section].map(field => [field, record[field]]))
          if (section === 'profiles') projected.subscriptions = Array.isArray(record.subscriptions) ? record.subscriptions.map(channel => ({ id: channel?.id })) : []
          data[section].push(projected)
        }
      }
    }
    const current = await importPreviewState(this.engine, { sections: job.sections.filter(section => section !== 'settings') })
    current.settings = Object.fromEntries(settingKeys.map(key => [key, null]))
    return previewBackupImport(data, current)
  }

  verifyChecksums(job) {
    const size = fstatSync(job.fd).size
    const tail = Buffer.alloc(Math.min(size, 65557))
    readSync(job.fd, tail, 0, tail.length, size - tail.length)
    let end = -1
    for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054B50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw new Error('Invalid ZIP directory')
    const count = tail.readUInt16LE(end + 10)
    const directorySize = tail.readUInt32LE(end + 12)
    let offset = tail.readUInt32LE(end + 16)
    if (count !== job.entries.size || offset + directorySize !== size - tail.length + end) throw new Error('Invalid ZIP entry count or directory bounds')
    const seen = new Set()
    for (let index = 0; index < count; index++) {
      const header = Buffer.alloc(46)
      if (readSync(job.fd, header, 0, header.length, offset) !== header.length || header.readUInt32LE(0) !== 0x02014B50) throw new Error('Invalid ZIP entry')
      const filename = Buffer.alloc(header.readUInt16LE(28))
      if (readSync(job.fd, filename, 0, filename.length, offset + 46) !== filename.length) throw new Error('Truncated ZIP entry')
      const name = filename.toString('utf8')
      const state = [...job.entries.values()].find(entry => entry.name === name)
      if (!state || seen.has(name) || state.size !== header.readUInt32LE(24) || (state.crc ^ 0xFFFFFFFF) >>> 0 !== header.readUInt32LE(16)) throw new Error('Backup ZIP checksum or size mismatch')
      seen.add(name)
      offset += 46 + filename.length + header.readUInt16LE(30) + header.readUInt16LE(32)
    }
  }

  async apply({ id, sections }, handlers) {
    const job = this.jobs.get(id)
    if (!job?.ready || !Array.isArray(sections) || sections.some(section => !BACKUP_SECTIONS.includes(section) || (job.sections && !job.sections.includes(section)) || (job.format === 'records' && !['profiles', 'playlists', 'history', 'searchHistory'].includes(section)))) throw new Error('Invalid library import selection')
    const selected = new Set(sections)
    const engine = this.engine
    await engine.transaction(async () => {
      const matchHistory = selected.has('history') && job.format === 'backup'
      if (matchHistory) prepareHistoryTargets(engine, job)
      if (selected.has('searchHistory')) {
        engine.database.exec('CREATE TEMP TABLE IF NOT EXISTS import_search_keys (key TEXT PRIMARY KEY, record_id TEXT NOT NULL) WITHOUT ROWID; DELETE FROM import_search_keys')
        const index = engine.prepare('INSERT OR REPLACE INTO import_search_keys VALUES (?, ?)')
        for (const row of engine.prepare("SELECT id, data FROM records WHERE collection = 'searchHistory' ORDER BY id").iterate()) index.run(getSearchHistoryEntryKeyFromEntry(model.deserialize(row.data)), row.id)
      }
      for (const row of job.database.prepare('SELECT section, data FROM incoming ORDER BY ordinal').iterate()) {
        if (!selected.has(row.section)) continue
        const incoming = (job.format === 'records' ? model.deserialize : job.decode)(row.data)
        const collection = engine.collections[row.section]
        let current
        let merged
        if (row.section === 'history') {
          current = incoming._id ? await collection.findOneAsync({ _id: incoming._id }) : null
          if (!current && matchHistory && incoming._id && typeof incoming.videoId === 'string') {
            const match = [...engine.orderedHistoryRows({
              where: "r.id IN (SELECT id FROM import_history_targets WHERE video_id = json_extract(?, '$') AND available = 1)",
              parameters: [JSON.stringify(incoming.videoId)],
              limit: 1,
            })][0]
            if (match) {
              current = await collection.findOneAsync({ _id: match.id })
              // Match at most one unidentified occurrence per video. Matching
              // several by mutable timestamps can swap them on repeat restores.
              // Preserve remaining source IDs and existing duplicates instead.
              engine.prepare("DELETE FROM import_history_targets WHERE video_id = json_extract(?, '$')").run(JSON.stringify(incoming.videoId))
            }
          }
          // Without a stable ID, an incoming row cannot be proved to replace a
          // saved visit. Keep it separate in both backup and legacy formats.
          if (current && matchHistory) engine.prepare('DELETE FROM import_history_targets WHERE id = ?').run(current._id)
          merged = mergeBackupHistoryRecord(current, migrateLegacyHistoryRecord(incoming))
        } else if (row.section === 'playlists') {
          current = await collection.findOneAsync({ _id: incoming._id })
          merged = mergeBackupPlaylist(current, incoming)
          if (job.format === 'records') {
            const now = Date.now()
            merged.createdAt ??= now
            merged.protected ??= false
            if (incoming.lastUpdatedAt == null) merged.lastUpdatedAt = now
            // Only newly appended members need IDs. Retained members, including
            // legacy records without IDs, keep their original data and identity.
            if (Array.isArray(merged.videos)) {
              for (let index = current?.videos.length ?? 0; index < merged.videos.length; index++) {
                const video = merged.videos[index]
                if (video !== null && typeof video === 'object' && !Array.isArray(video) && !(video instanceof Date)) video.playlistItemId ??= randomUUID()
              }
            }
          }
        } else if (row.section === 'profiles') {
          current = await collection.findOneAsync({ _id: incoming._id })
          merged = mergeBackupProfile(current, incoming)
        } else {
          const key = getSearchHistoryEntryKeyFromEntry(incoming)
          const match = engine.prepare('SELECT record_id FROM import_search_keys WHERE key = ?').get(key)
          current = match ? await collection.findOneAsync({ _id: match.record_id }) : null
          merged = mergeSearchHistoryEntries(current ? [current] : [], [incoming])[0]
          engine.prepare('INSERT OR REPLACE INTO import_search_keys VALUES (?, ?)').run(key, merged._id)
        }
        if (current) merged = { ...merged, _id: current._id }
        merged._id ??= randomUUID()
        await collection.updateAsync({ _id: merged._id }, merged, { upsert: true })
      }
      if (matchHistory) engine.database.exec('DROP TABLE import_history_targets; DROP TABLE import_history_sources')
      if (selected.has('watchStats')) await handlers.watchStats.mergeBackup(job.roots.get('watchStats'))
    })
    const settings = selected.has('settings') ? job.roots.get('settings') : null
    // The live transaction has committed. A leftover stage is cleaned on the
    // next startup; cleanup failure must not invite retrying a successful import.
    try { this.cancel({ id }) } catch (error) { console.warn('Unable to clean up committed library import', error) }
    return { settings }
  }

  cancel({ id }) {
    const job = this.jobs.get(id)
    if (!job) return false
    try { closeSync(job.fd) } finally {
      try { job.database.close() } finally {
        try { rmSync(job.directory, { recursive: true, force: true }) } finally { this.jobs.delete(id) }
      }
    }
    return true
  }
}
