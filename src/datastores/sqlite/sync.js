import { randomUUID } from 'node:crypto'
import model from '@seald-io/nedb/lib/model.js'
import { mergeHistory, mergeIds, videoToRemote } from '../../renderer/helpers/sync-history-merge.js'
import { migrateLegacyHistoryRecord } from '../../history.js'

/** Own local sync input and send only bounded transport/delta pages to windows. */
export class LibrarySync {
  constructor(engine) {
    this.engine = engine
    this.jobs = new Map()
    // Raw playlist/snapshot payloads must stay outside the lookup index.
    engine.database.exec('CREATE TEMP TABLE sync_values (job_id TEXT NOT NULL, section TEXT NOT NULL, ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(job_id, section, ordinal))')
  }

  start({ options = {}, previousIsArray = false, kind = 'history', playlistId, metadata }) {
    if (this.jobs.size >= 2) throw new Error('Finish or cancel the current library sync first')
    const id = randomUUID()
    this.jobs.set(id, { options, previousIsArray, kind, playlistId, metadata, ordinals: new Map(), ready: false })
    return { id }
  }

  job(id) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('Unknown library sync')
    return job
  }

  chunk({ id, section, records }) {
    const job = this.job(id)
    if (job.ready || !['remote', 'previous', 'acknowledgedUpserts', 'acknowledgedDeletions'].includes(section) || !Array.isArray(records) || records.length > 250) throw new Error('Invalid sync input chunk')
    const insert = this.engine.prepare('INSERT INTO sync_values VALUES (?, ?, ?, ?)')
    let ordinal = job.ordinals.get(section) ?? 0
    for (const record of records) insert.run(id, section, ordinal++, model.serialize(record))
    job.ordinals.set(section, ordinal)
    return true
  }

  read(id, section) {
    return this.engine.prepare('SELECT data FROM sync_values WHERE job_id = ? AND section = ? ORDER BY ordinal').all(id, section).map(row => model.deserialize(row.data))
  }

  async plan({ id }) {
    const job = this.job(id)
    if (job.ready) throw new Error('The sync is already planned')
    if (job.kind === 'playlist') return this.planPlaylist(id, job)
    job.revision = this.engine.revision('history')
    const localHistory = (await this.engine.collections.history.findAsync({}).sort({ timeWatched: 1 })).map(migrateLegacyHistoryRecord)
    const merged = mergeHistory({ localHistory, remoteHistory: this.read(id, 'remote'), previous: job.previousIsArray ? this.read(id, 'previous') : Object.fromEntries(this.read(id, 'previous')), acknowledged: { upserts: this.read(id, 'acknowledgedUpserts'), deletions: this.read(id, 'acknowledgedDeletions') }, options: job.options })
    this.engine.prepare('DELETE FROM sync_values WHERE job_id = ?').run(id)
    const insert = this.engine.prepare('INSERT INTO sync_values VALUES (?, ?, ?, ?)')
    const counts = {}
    for (const [section, value] of Object.entries(merged)) {
      const records = section === 'next' ? Object.entries(value) : value
      records.forEach((record, ordinal) => insert.run(id, section, ordinal, model.serialize(record)))
      counts[section] = records.length
    }
    job.ready = true
    return { revision: job.revision, counts }
  }

  page({ id, section, offset = 0 }) {
    const job = this.job(id)
    if (!job.ready || !['next', 'historyToUpload', 'remoteDeletions', 'playlistUploads', 'playlistRemovals', 'playlistIds'].includes(section)) throw new Error('Invalid sync output page')
    const rows = this.engine.prepare('SELECT data FROM sync_values WHERE job_id = ? AND section = ? AND ordinal >= ? ORDER BY ordinal LIMIT 100').all(id, section, offset)
    return { records: rows.map(row => model.deserialize(row.data)), current: job.revision === this.engine.revision(job.kind === 'playlist' ? 'playlists' : 'history') }
  }

  async apply({ id }, handlers) {
    const job = this.job(id)
    if (!job.ready) throw new Error('The sync is not planned')
    return this.engine.transaction(async () => {
      if (job.kind === 'playlist') return this.applyPlaylist(id, job)
      if (job.revision !== this.engine.revision('history')) return false
      for (const section of ['deletions', 'insertions', 'updates']) {
        // The stage is immutable while mutations update indexed live rows.
        const statement = this.engine.prepare('SELECT data FROM sync_values WHERE job_id = ? AND section = ? ORDER BY ordinal')
        let records = []
        const save = async () => { if (records.length) await handlers.history.applySyncChanges({ insertions: [], updates: [], deletions: [], [section]: records }); records = [] }
        for (const row of statement.iterate(id, section)) { records.push(model.deserialize(row.data)); if (records.length === 250) await save() }
        await save()
      }
      return true
    })
  }

  async planPlaylist(id, job) {
    job.revision = this.engine.revision('playlists')
    const local = await this.engine.collections.playlists.findOneAsync({ _id: job.playlistId })
    const videos = local?.videos ?? []
    const localById = new Map(videos.filter(video => videoToRemote(video)).map(video => [video.videoId, video]))
    const remoteById = new Map(this.read(id, 'remote').map(video => [video.id, video]))
    const merged = mergeIds(localById.keys(), remoteById.keys(), this.read(id, 'previous'), { ...job.options, collection: `videos in playlist ${job.metadata.title}`, getItemName: id => localById.get(id)?.title || remoteById.get(id)?.title })
    const desired = videos.filter(video => !videoToRemote(video) || merged.has(video.videoId))
    for (const videoId of merged) {
      if (!localById.has(videoId)) {
        const video = remoteById.get(videoId)
        desired.push({ videoId, title: video.title, author: video.uploader.name, authorId: video.uploader.id, lengthSeconds: video.duration, published: video.upload_date, timeAdded: Date.now(), playlistItemId: randomUUID(), type: 'video' })
      }
    }
    const outputs = {
      playlistUploads: [...merged].filter(videoId => !remoteById.has(videoId)).map(videoId => videoToRemote(localById.get(videoId))).filter(Boolean),
      playlistRemovals: [...remoteById.keys()].filter(videoId => !merged.has(videoId)),
      playlistIds: [...merged],
      playlistMembers: desired
    }
    const insert = this.engine.prepare('INSERT INTO sync_values VALUES (?, ?, ?, ?)')
    this.engine.prepare('DELETE FROM sync_values WHERE job_id = ?').run(id)
    for (const [section, records] of Object.entries(outputs)) records.forEach((record, ordinal) => insert.run(id, section, ordinal, model.serialize(record)))
    job.ready = true
    job.hadLocal = local !== null
    job.membersChanged = !local || model.serialize(videos) !== model.serialize(desired)
    return { revision: job.revision, counts: Object.fromEntries(Object.entries(outputs).map(([section, records]) => [section, records.length])) }
  }

  async applyPlaylist(id, job) {
    if (job.revision !== this.engine.revision('playlists')) return false
    const { title, description } = job.metadata
    if (!job.hadLocal) await this.engine.collections.playlists.insertAsync({ _id: job.playlistId, playlistName: title, description, protected: false, createdAt: Date.now(), lastUpdatedAt: Date.now(), videos: this.read(id, 'playlistMembers') })
    else {
      const existing = await this.engine.collections.playlists.findOneAsync({ _id: job.playlistId }, { playlistName: 1, description: 1 })
      const set = {}
      if (existing.playlistName !== title) set.playlistName = title
      if (existing.description !== description) set.description = description
      if (job.membersChanged) set.videos = this.read(id, 'playlistMembers')
      if (Object.keys(set).length) await this.engine.collections.playlists.updateAsync({ _id: job.playlistId }, { $set: { ...set, lastUpdatedAt: Date.now() } })
    }
    return true
  }

  cancel({ id }) {
    this.engine.prepare('DELETE FROM sync_values WHERE job_id = ?').run(id)
    this.jobs.delete(id)
    return true
  }
}
