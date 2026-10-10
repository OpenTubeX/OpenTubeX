import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Zip, ZipDeflate, strToU8 } from 'fflate'
import model from '@seald-io/nedb/lib/model.js'
import { LibraryEngine } from './engine.js'

const SECTIONS = ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'watchStats']

function * collectionJson(engine, collection, ndjson = false) {
  if (!ndjson) yield '['
  let first = true
  for (const row of engine.prepare("SELECT id, data FROM records WHERE collection = ? AND (? <> 'watchStats' OR json_type(data, '$.date') IS NOT NULL) ORDER BY id").iterate(collection, collection)) {
    if (!first) yield ndjson ? '\n' : ','
    first = false
    const record = engine.materialize(collection, row, { arrays: false })
    const arrays = engine.prepare('SELECT field FROM record_arrays WHERE collection = ? AND record_id = ? ORDER BY field').all(collection, row.id)
    for (const { field } of arrays) delete record[field]
    const text = JSON.stringify(record)
    yield arrays.length ? text.slice(0, -1) : text
    for (const [index, { field }] of arrays.entries()) {
      yield (Object.keys(record).length || index ? ',' : '') + JSON.stringify(field) + ':['
      let firstMember = true
      for (const member of engine.prepare('SELECT data FROM members WHERE collection = ? AND record_id = ? AND field = ? ORDER BY position').iterate(collection, row.id, field)) {
        if (!firstMember) yield ','
        firstMember = false
        yield JSON.stringify(model.deserialize(member.data))
      }
      yield ']'
    }
    if (arrays.length) yield '}'
  }
  yield ndjson ? '\n' : ']'
}

function * youtubeHistory(engine) {
  yield '['
  let first = true
  for (const row of engine.prepare("SELECT data FROM records WHERE collection = 'history' ORDER BY sort_time DESC, id DESC").iterate()) {
    if (!first) yield ','
    first = false
    const entry = model.deserialize(row.data)
    yield JSON.stringify({ header: 'YouTube', title: `Watched ${entry.title}`, titleUrl: `https://www.youtube.com/watch?v=${entry.videoId}`, subtitles: [{ name: entry.author, url: `https://www.youtube.com/channel/${entry.authorId}` }], time: new Date(entry.timeWatched).toISOString(), products: ['YouTube'], activityControls: ['YouTube watch history'] })
  }
  yield ']'
}

function * archiveInputs(engine, settings) {
  yield { entry: 'manifest.json' }
  yield JSON.stringify({ format: 'opentubex-backup', version: 1, createdAt: new Date().toISOString() })
  for (const section of SECTIONS) {
    yield { entry: `${section}.json` }
    if (section === 'settings') yield JSON.stringify(settings)
    else if (section === 'watchStats') {
      yield '{"records":'
      yield * collectionJson(engine, 'watchStats')
      const adjustment = engine.prepare("SELECT data FROM records WHERE collection = 'watchStats' AND id = 'history-watch-time-v1'").get()
      yield ',"adjustment":' + JSON.stringify(adjustment ? model.deserialize(adjustment.data).adjustment ?? null : null) + '}'
    } else yield * collectionJson(engine, section)
  }
}

/** A separate read snapshot keeps a multi-call export consistent with writes. */
export class LibraryExports {
  constructor(engine) { this.engine = engine; this.jobs = new Map() }

  start({ settings, format = 'backup', collection }) {
    if (!['backup', 'ndjson', 'youtubeHistory'].includes(format) || (format === 'ndjson' && !['history', 'playlists', 'profiles', 'searchHistory'].includes(collection))) throw new Error('Invalid export format')
    if (format === 'backup' && (!settings || typeof settings !== 'object' || Array.isArray(settings))) throw new Error('Invalid backup settings')
    if (this.jobs.size >= 2) throw new Error('Finish or cancel the current library export first')
    const path = this.engine.database.prepare('PRAGMA database_list').get().file
    const database = new DatabaseSync(path, { readOnly: true })
    database.exec('BEGIN')
    const engine = new LibraryEngine(database)
    // Pin the snapshot now, before returning control to other writers.
    engine.prepare('SELECT count FROM collection_counts LIMIT 1').get()
    const job = { database, input: format === 'backup' ? archiveInputs(engine, settings) : format === 'ndjson' ? collectionJson(engine, collection, true) : youtubeHistory(engine), output: [], finished: false, error: null, entry: null, pending: null, offset: 0, format }
    if (format === 'backup') job.zip = new Zip((error, data, final) => { if (error) job.error = error; if (data.length) job.output.push(data); job.finished ||= final })
    const id = randomUUID()
    this.jobs.set(id, job)
    return { id }
  }

  next({ id }) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('Unknown library export')
    try {
      const deadline = performance.now() + 20
      while (job.output.reduce((sum, data) => sum + data.length, 0) < 65536 && !job.finished && performance.now() < deadline) {
        if (job.pending) {
          const end = Math.min(job.pending.length, job.offset + 32768)
          if (job.zip) job.entry.push(job.pending.subarray(job.offset, end), false)
          else job.output.push(job.pending.subarray(job.offset, end))
          job.offset = end
          if (end === job.pending.length) { job.pending = null; job.offset = 0 }
        } else {
          const next = job.input.next()
          if (next.done) { if (job.zip) { job.entry?.push(new Uint8Array(), true); job.zip.end() } else job.finished = true } else if (typeof next.value === 'object') {
            job.entry?.push(new Uint8Array(), true)
            job.entry = new ZipDeflate(next.value.entry, { level: 6 })
            job.zip.add(job.entry)
          } else job.pending = strToU8(next.value)
        }
        if (job.error) throw job.error
      }
      const length = job.output.reduce((sum, data) => sum + data.length, 0)
      const data = new Uint8Array(length)
      let offset = 0
      for (const chunk of job.output) { data.set(chunk, offset); offset += chunk.length }
      job.output = []
      const done = job.finished
      if (done) this.cancel({ id })
      return { data, done }
    } catch (error) { this.cancel({ id }); throw error }
  }

  cancel({ id }) {
    const job = this.jobs.get(id)
    if (!job) return false
    job.input.return()
    job.database.close()
    this.jobs.delete(id)
    return true
  }
}
