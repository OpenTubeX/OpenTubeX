import { RECOMMENDATION_RECORD_LIMIT, RECOMMENDATION_RETENTION_MS, updateRecommendationRecord } from '../recommendation-learning.js'

/** Local evidence store, shared by Electron windows through its main process. */
export function createRecommendationStore(db, createEpoch = () => crypto.randomUUID()) {
  let pending = Promise.resolve()
  let pendingBatch = null
  const queue = operation => {
    pendingBatch = null
    const result = pending.catch(() => {}).then(operation)
    pending = result
    return result
  }
  async function meta() {
    let record = await db.findOneAsync({ _id: 'meta' })
    if (!record) {
      record = { _id: 'meta', version: 1, epoch: createEpoch(), revision: 0 }
      await db.insertAsync(record)
    }
    return record
  }
  async function snapshot() {
    const { epoch, revision } = await meta()
    return { epoch, revision, records: await db.findAsync({ _id: { $ne: 'meta' } }) }
  }
  return {
    find: () => queue(async () => {
      await db.removeAsync({ _id: { $ne: 'meta' }, updatedAt: { $lt: Date.now() - RECOMMENDATION_RETENTION_MS } }, { multi: true })
      return snapshot()
    }),
    record(event) {
      if (!pendingBatch) {
        const batch = { events: [], result: null }
        batch.result = queue(async () => {
          if (pendingBatch === batch) pendingBatch = null
          const { epoch, revision } = await meta()
          const changed = new Map()
          const existing = new Set()
          for (const entry of batch.events) {
            if (entry?.epoch !== epoch) continue
            const id = entry.video?.videoId ?? ''
            const previous = changed.get(id) ?? await db.findOneAsync({ _id: id })
            if (previous && !changed.has(id)) existing.add(id)
            const record = updateRecommendationRecord(previous, entry)
            if (record && record !== previous) changed.set(id, record)
          }
          let removed = []
          if (changed.size) {
            const inserted = [...changed.values()].filter(record => !existing.has(record._id))
            if (inserted.length) await db.insertAsync(inserted)
            for (const record of changed.values()) {
              if (existing.has(record._id)) await db.updateAsync({ _id: record._id }, record)
            }
            const excess = await db.findAsync({ _id: { $ne: 'meta' } }, { _id: 1 }).sort({ updatedAt: -1 }).skip(RECOMMENDATION_RECORD_LIMIT)
            removed = excess.map(entry => entry._id)
            if (removed.length) await db.removeAsync({ _id: { $in: removed } }, { multi: true })
            await db.updateAsync({ _id: 'meta' }, { $set: { revision: revision + 1 } })
          }
          return batch.events.map(entry => entry?.epoch !== epoch
            ? { epoch, revision, stale: true }
            : { epoch, revision: revision + Number(changed.size > 0), record: changed.get(entry.video?.videoId), removed })
        })
        pendingBatch = batch
      }
      const batch = pendingBatch
      const index = batch.events.push(event) - 1
      return batch.result.then(results => results[index])
    },
    remove: videoIds => queue(async () => {
      const { revision } = await meta()
      await db.removeAsync({ _id: { $in: videoIds } }, { multi: true })
      await db.updateAsync({ _id: 'meta' }, { _id: 'meta', version: 1, epoch: createEpoch(), revision: revision + 1 }, { upsert: true })
      return snapshot()
    }),
    reset: () => queue(async () => {
      const { revision } = await meta()
      await db.removeAsync({ _id: { $ne: 'meta' } }, { multi: true })
      await db.updateAsync({ _id: 'meta' }, { _id: 'meta', version: 1, epoch: createEpoch(), revision: revision + 1 })
      return snapshot()
    }),
  }
}
