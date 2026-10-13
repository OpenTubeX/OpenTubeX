import { randomUUID } from 'node:crypto'
import model from '@seald-io/nedb/lib/model.js'
import { mergeHistory, mergeIds, enrichSyncVideo, enrichLocalPlaylistVideo, videoToRemote, uploaderToLocal } from '../../renderer/helpers/sync-history-merge.js'
import { migrateLegacyHistoryRecord } from '../../history.js'

const playlistMetadata = record => record ? { playlistName: record.playlistName, description: record.description } : null

/** Own local sync input and send only bounded transport/delta pages to windows. */
export class LibrarySync {
  constructor(engine) {
    this.engine = engine
    // Job state and staged rows must roll back together, including when a
    // caller owns the enclosing transaction or COMMIT itself fails.
    engine.database.exec('CREATE TEMP TABLE sync_jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    // Raw playlist/snapshot payloads must stay outside the lookup index.
    engine.database.exec('CREATE TEMP TABLE sync_values (job_id TEXT NOT NULL, section TEXT NOT NULL, ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(job_id, section, ordinal))')
  }

  async start({ options = {}, previousIsArray = false, kind = 'history', playlistId, metadata, expectedMetadata }) {
    return this.engine.transaction(async () => {
      if (this.engine.prepare('SELECT count(*) AS count FROM sync_jobs').get().count >= 2) throw new Error('Finish or cancel the current library sync first')
      const id = randomUUID()
      if (kind === 'playlist' && expectedMetadata === undefined) expectedMetadata = playlistMetadata(await this.engine.collections.playlists.findOneAsync({ _id: playlistId }, { playlistName: 1, description: 1 }))
      this.engine.prepare('INSERT INTO sync_jobs VALUES (?, ?)').run(id, model.serialize({ options, previousIsArray, kind, playlistId, metadata, expectedMetadata, ready: false }))
      return { id }
    })
  }

  job(id) {
    const job = this.engine.prepare('SELECT data FROM sync_jobs WHERE id = ?').get(id)
    if (!job) throw new Error('Unknown library sync')
    return model.deserialize(job.data)
  }

  async chunk({ id, section, records }) {
    return this.engine.transaction(() => {
      const job = this.job(id)
      if (job.ready || !['remote', 'previous', 'acknowledgedUpserts', 'acknowledgedDeletions'].includes(section) || !Array.isArray(records) || records.length > 250) throw new Error('Invalid sync input chunk')
      // Derive the next ordinal from staged rows so an enclosing rollback
      // cannot leave an in-memory counter ahead of the durable input.
      let { ordinal } = this.engine.prepare('SELECT coalesce(max(ordinal) + 1, 0) AS ordinal FROM sync_values WHERE job_id = ? AND section = ?').get(id, section)
      const insert = this.engine.prepare('INSERT INTO sync_values VALUES (?, ?, ?, ?)')
      for (const record of records) insert.run(id, section, ordinal++, model.serialize(record))
      return true
    })
  }

  read(id, section) {
    return this.engine.prepare('SELECT data FROM sync_values WHERE job_id = ? AND section = ? ORDER BY ordinal').all(id, section).map(row => model.deserialize(row.data))
  }

  async plan({ id }) {
    // Planning owns a transaction too: direct callers must wait for another
    // writer to commit or roll back before capturing local rows and revision.
    return this.engine.transaction(async () => {
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
      this.engine.prepare('UPDATE sync_jobs SET data = ? WHERE id = ?').run(model.serialize(job), id)
      return { revision: job.revision, counts }
    })
  }

  page({ id, section, offset = 0 }) {
    return this.engine.read(() => {
      const job = this.job(id)
      if (!job.ready || !['next', 'historyToUpload', 'remoteDeletions', 'playlistUploads', 'playlistRemovals', 'playlistIds'].includes(section)) throw new Error('Invalid sync output page')
      const rows = this.engine.prepare('SELECT data FROM sync_values WHERE job_id = ? AND section = ? AND ordinal >= ? ORDER BY ordinal LIMIT 100').all(id, section, offset)
      return { records: rows.map(row => model.deserialize(row.data)), current: job.revision === this.engine.revision(job.kind === 'playlist' ? 'playlists' : 'history') }
    })
  }

  async apply({ id }, handlers) {
    return this.engine.transaction(async () => {
      const job = this.job(id)
      if (!job.ready) throw new Error('The sync is not planned')
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
    if (model.serialize(playlistMetadata(local)) !== model.serialize(job.expectedMetadata)) throw new Error('The playlist changed during sync. Try again.')
    if (local && !Array.isArray(local.videos)) {
      // An unsupported saved shape cannot represent an empty remote playlist:
      // leave both memberships and its previous sync baseline untouched.
      this.engine.prepare('DELETE FROM sync_values WHERE job_id = ?').run(id)
      job.ready = true
      job.skipped = true
      this.engine.prepare('UPDATE sync_jobs SET data = ? WHERE id = ?').run(model.serialize(job), id)
      return { revision: job.revision, skipped: true, counts: { playlistUploads: 0, playlistRemovals: 0, playlistIds: 0, playlistMembers: 0 } }
    }
    const videos = local?.videos ?? []
    const localById = new Map(videos.filter(video => video !== null && videoToRemote(video, job.options)).map(video => [video.videoId, video]))
    const remoteById = new Map(this.read(id, 'remote').map(video => [video.id, video]))
    const localMetadataById = new Map()
    for (const video of videos) {
      const payload = videoToRemote(video, job.options)
      if (!payload) continue
      const previous = localMetadataById.get(video.videoId)
      localMetadataById.set(video.videoId, previous ? enrichSyncVideo(previous, payload) : payload)
    }
    const merged = mergeIds(localById.keys(), remoteById.keys(), this.read(id, 'previous'), { ...job.options, collection: `videos in playlist ${job.metadata.title}`, getItemName: id => localById.get(id)?.title || remoteById.get(id)?.title })
    const uploads = []
    for (const videoId of merged) {
      const localMetadata = localMetadataById.get(videoId)
      if (!localMetadata) continue
      const remote = remoteById.get(videoId)
      const enriched = remote ? enrichSyncVideo(remote, localMetadata) : localMetadata
      if (JSON.stringify(remote) !== JSON.stringify(enriched)) uploads.push(enriched)
      remoteById.set(videoId, enriched)
    }
    const desired = videos.filter(video => video === null || !videoToRemote(video, job.options) || merged.has(video.videoId)).map(video => enrichLocalPlaylistVideo(video, remoteById.get(video?.videoId), job.options))
    for (const videoId of merged) {
      if (!localById.has(videoId)) {
        const video = remoteById.get(videoId)
        desired.push({ videoId, title: video.title, ...uploaderToLocal(video.uploader), lengthSeconds: video.duration, published: video.upload_date, timeAdded: Date.now(), playlistItemId: randomUUID(), type: 'video' })
      }
    }
    const outputs = {
      playlistUploads: uploads,
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
    this.engine.prepare('UPDATE sync_jobs SET data = ? WHERE id = ?').run(model.serialize(job), id)
    return { revision: job.revision, counts: Object.fromEntries(Object.entries(outputs).map(([section, records]) => [section, records.length])) }
  }

  async applyPlaylist(id, job) {
    if (job.revision !== this.engine.revision('playlists')) return false
    if (job.skipped) return true
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

  async cancel({ id }) {
    return this.engine.transaction(() => {
      this.engine.prepare('DELETE FROM sync_values WHERE job_id = ?').run(id)
      this.engine.prepare('DELETE FROM sync_jobs WHERE id = ?').run(id)
      return true
    })
  }
}
