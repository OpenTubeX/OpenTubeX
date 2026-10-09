import { SyncServerDataLossError } from './sync-server-errors.js'

export const DEFAULT_CHANNEL_AVATAR = 'https://yt3.googleusercontent.com/ytc/default'
const YOUTUBE_VIDEO_THUMBNAIL_REGEX = /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\//

function mapBy(items, getId) {
  return new Map(items.map(item => [getId(item), item]))
}

export function mergeIds(
  localIds,
  remoteIds,
  previousIds = [],
  { allowDataLoss = false, collection = 'data', getItemName = () => null } = {}
) {
  const local = new Set(localIds)
  const remote = new Set(remoteIds)
  const previous = new Set(previousIds)
  const allIds = new Set([...local, ...remote, ...previous])

  const merged = new Set(Array.from(allIds).filter(id => {
    if (!previous.has(id)) {
      return local.has(id) || remote.has(id)
    }

    // Once both sides have seen an item, a deletion on either side wins.
    return local.has(id) && remote.has(id)
  }))
  const deletedIds = Array.from(previous).filter(id => !merged.has(id))
  const deleted = deletedIds.length
  const oneSideWasEmptied = previous.size > 0 && (
    (local.size === 0 && remote.size > 0) ||
    (remote.size === 0 && local.size > 0)
  )
  const isMassDeletion = deleted >= 10 && deleted / previous.size >= 0.5

  if (!allowDataLoss && deleted > 0 && (oneSideWasEmptied || isMassDeletion)) {
    throw new SyncServerDataLossError(collection, deleted, previous.size, deletedIds.map(id => ({
      id,
      name: getItemName(id) || id,
    })))
  }

  return merged
}

export function normalizeChannelAvatar(avatar) {
  if (!avatar || avatar === DEFAULT_CHANNEL_AVATAR || YOUTUBE_VIDEO_THUMBNAIL_REGEX.test(avatar)) {
    return null
  }

  return avatar
}

export function videoToRemote(video) {
  const videoId = video.videoId
  const uploaderId = video.authorId

  if (!videoId || !uploaderId) {
    return null
  }

  return {
    id: videoId,
    title: video.title || videoId,
    upload_date: Number.isFinite(video.published) ? video.published : 0,
    uploader: {
      id: uploaderId,
      name: video.author || uploaderId,
      avatar: normalizeChannelAvatar(video.authorThumbnail) || DEFAULT_CHANNEL_AVATAR,
      verified: false,
    },
    thumbnail_url: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: Number.isFinite(video.lengthSeconds) ? Math.round(video.lengthSeconds) : 0,
  }
}

function historyToRemote(record) {
  const video = videoToRemote(record)
  if (!video) return null

  const watchProgress = Number.isFinite(record.watchProgress) ? record.watchProgress : 0
  return {
    video,
    metadata: {
      added_date: Number.isFinite(record.timeWatched) ? record.timeWatched : Date.now(),
      watched_state: record.isWatched ? 'completed' : watchProgress > 0 ? 'watching' : 'planned',
      position_millis: Math.max(0, Math.round(watchProgress * 1000)),
    },
  }
}

function historyToLocal(entry, local) {
  return {
    ...local,
    videoId: entry.video.id,
    title: entry.video.title,
    author: entry.video.uploader.name,
    authorId: entry.video.uploader.id,
    published: entry.video.upload_date,
    description: local?.description ?? '',
    lengthSeconds: entry.video.duration > 0 ? entry.video.duration : (local?.lengthSeconds ?? 0),
    watchProgress: (entry.metadata.position_millis ?? 0) / 1000,
    isWatched: entry.metadata.watched_state === 'completed',
    timeWatched: entry.metadata.added_date,
    // Sync stores unknown durations as zero and does not carry live status.
    isLive: entry.video.duration > 0 ? false : local?.isLive === true,
    isUpcoming: entry.video.duration > 0 ? false : local?.isUpcoming === true,
    type: 'video',
  }
}

function historyStateEquals(localPayload, remote) {
  return localPayload.metadata.added_date === remote.metadata.added_date &&
    localPayload.metadata.watched_state === remote.metadata.watched_state &&
    localPayload.metadata.position_millis === remote.metadata.position_millis
}

function historyBaseline(previous, acknowledged) {
  // Older snapshots contain only IDs, without a baseline for watch-state edits.
  const previousStates = new Map(Array.isArray(previous)
    ? previous.map(id => [id, null])
    : Object.entries(previous))
  // A retry must distinguish our completed writes from new remote edits.
  // Remote-only arrivals remain outside the baseline until applied locally.
  for (const id of acknowledged.deletions ?? []) previousStates.delete(id)
  for (const [id, metadata] of acknowledged.upserts ?? []) previousStates.set(id, metadata)
  return previousStates
}

export function updateHistorySnapshot({ snapshot, previous, acknowledged, next }) {
  let saved
  try { saved = JSON.parse(snapshot) } catch { saved = {} }
  return JSON.stringify({ ...saved, history: next ?? Object.fromEntries(historyBaseline(previous, acknowledged)) })
}

export function mergeHistory({ localHistory, remoteHistory, previous = {}, acknowledged = {}, options = {} }) {
  const previousStates = historyBaseline(previous, acknowledged)
  const previousIds = previousStates.keys()
  const next = {}
  const syncableLocalHistory = localHistory.filter(record => historyToRemote(record) !== null)
  const localById = mapBy(syncableLocalHistory, record => record.videoId)
  const remoteById = mapBy(remoteHistory, entry => entry.video.id)
  const mergedIds = mergeIds(localById.keys(), remoteById.keys(), previousIds, {
    ...options,
    collection: 'history',
    getItemName: id => localById.get(id)?.title || remoteById.get(id)?.video.title,
  })
  const historyToUpload = []
  const localInsertions = []
  const localUpdates = []
  const localDeletions = []

  const remoteDeletions = []
  for (const id of remoteById.keys()) {
    if (!mergedIds.has(id)) {
      remoteDeletions.push(id)
    }
  }

  for (const id of localById.keys()) {
    if (!mergedIds.has(id)) {
      localDeletions.push(id)
    }
  }

  for (const id of mergedIds) {
    const local = localById.get(id)
    const remote = remoteById.get(id)
    let useLocal = local && (!remote || local.timeWatched > remote.metadata.added_date)
    if (local && remote && local.timeWatched === remote.metadata.added_date) {
      const localState = historyToRemote(local)
      const baseline = previousStates.get(id)
      const localChanged = !baseline || !historyStateEquals(localState, { metadata: baseline })
      const remoteChanged = !baseline || !historyStateEquals(remote, { metadata: baseline })
      // A sole local edit can move progress backwards or clear watched status.
      // Concurrent/unknown edits need a stable tie-break, never local-wins on
      // both devices. Prefer farther progress, then completed watch state.
      useLocal = localChanged && (!remoteChanged ||
        localState.metadata.position_millis > remote.metadata.position_millis ||
        (localState.metadata.position_millis === remote.metadata.position_millis &&
          localState.metadata.watched_state === 'completed'))
      if (historyStateEquals(localState, remote)) useLocal = true
    }
    let merged = useLocal ? local : historyToLocal(remote, local)
    // Watch time orders progress, not metadata completeness. Fill an unknown
    // local duration before uploading so it cannot erase a known server value.
    // Equal timestamps also refresh metadata without replacing local progress.
    if (useLocal && remote &&
        (local.timeWatched === remote.metadata.added_date ||
          !Number.isFinite(local.lengthSeconds) || local.lengthSeconds <= 0) &&
        Number.isFinite(remote.video.duration) && remote.video.duration > 0 &&
        (local.lengthSeconds !== remote.video.duration || local.isLive === true || local.isUpcoming === true)) {
      merged = { ...local, lengthSeconds: remote.video.duration, isLive: false, isUpcoming: false }
      localUpdates.push(merged)
    }
    const localPayload = useLocal ? historyToRemote(merged) : null
    next[id] = { ...(localPayload ?? remote).metadata }

    if (useLocal && localPayload && (
      !remote ||
      local.timeWatched > remote.metadata.added_date ||
      !historyStateEquals(localPayload, remote)
    )) {
      historyToUpload.push(localPayload)
    } else if (!useLocal) {
      if (local) localUpdates.push(merged)
      else localInsertions.push(merged)
    }
  }

  return { next, historyToUpload, remoteDeletions, insertions: localInsertions, updates: localUpdates, deletions: localDeletions }
}

export function applyRemoteHistoryChanges({ history, upserts, deletions }) {
  const byId = new Map()
  for (const entry of upserts) {
    byId.delete(entry.video.id)
    byId.set(entry.video.id, entry)
  }
  const deleted = new Set(deletions)
  return history.filter(entry => !deleted.has(entry.video.id) && !byId.has(entry.video.id)).concat([...byId.values()])
}
