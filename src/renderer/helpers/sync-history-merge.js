import { SyncServerDataLossError } from './sync-server-errors.js'

export const DEFAULT_CHANNEL_AVATAR = 'https://yt3.googleusercontent.com/ytc/default'
// Released clients require a truthy uploader ID to preserve video membership.
export const UNKNOWN_SYNC_UPLOADER_ID = 'opentubex:unknown-uploader'
const YOUTUBE_VIDEO_THUMBNAIL_REGEX = /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\//
const knownText = (value, placeholder) => typeof value === 'string' && value.trim().length > 0 && value !== placeholder

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

export function videoToRemote(video, { allowMissingUploader = false } = {}) {
  const videoId = video.videoId
  const uploaderId = video.authorId === UNKNOWN_SYNC_UPLOADER_ID ? '' : video.authorId || ''

  if (!videoId || (!uploaderId && !allowMissingUploader)) {
    return null
  }

  return {
    id: videoId,
    title: video.title || videoId,
    upload_date: Number.isFinite(video.published) ? video.published : 0,
    uploader: {
      id: uploaderId || UNKNOWN_SYNC_UPLOADER_ID,
      name: video.authorId === UNKNOWN_SYNC_UPLOADER_ID && video.author === UNKNOWN_SYNC_UPLOADER_ID
        ? ''
        : video.author || uploaderId,
      avatar: normalizeChannelAvatar(video.authorThumbnail) || DEFAULT_CHANNEL_AVATAR,
      verified: false,
    },
    thumbnail_url: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: Number.isFinite(video.lengthSeconds) ? Math.round(video.lengthSeconds) : 0,
  }
}

export function uploaderToLocal(uploader) {
  const unknownUploader = uploader.id === UNKNOWN_SYNC_UPLOADER_ID
  return {
    author: unknownUploader && uploader.name === UNKNOWN_SYNC_UPLOADER_ID ? undefined : uploader.name || undefined,
    authorId: unknownUploader ? undefined : uploader.id || undefined,
  }
}

function historyToRemote(record, options) {
  const video = videoToRemote(record, options)
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
  const avatar = normalizeChannelAvatar(entry.video.uploader.avatar)
  const thumbnail = entry.video.thumbnail_url
  const uploader = uploaderToLocal(entry.video.uploader)
  if (uploader.author === uploader.authorId) uploader.author = undefined
  const record = {
    ...local,
    videoId: entry.video.id,
    title: entry.video.title === entry.video.id ? local?.title ?? entry.video.title : entry.video.title,
    ...uploader,
    published: entry.video.upload_date,
    ...(thumbnail && thumbnail !== `https://i.ytimg.com/vi/${entry.video.id}/hqdefault.jpg` ? { thumbnail } : {}),
    ...(avatar ? { authorThumbnail: avatar } : {}),
    description: local?.description ?? '',
    lengthSeconds: entry.video.duration > 0 ? entry.video.duration : (local?.lengthSeconds ?? 0),
    watchProgress: (entry.metadata.position_millis ?? 0) / 1000,
    isWatched: entry.metadata.watched_state === 'completed',
    timeWatched: entry.metadata.added_date,
    // Sync stores unknown durations as zero and does not carry live status.
    isLive: entry.video.duration > 0 ? false : local?.isLive === true,
    ...(entry.video.duration > 0 && local?.liveNow === true ? { liveNow: false } : {}),
    isUpcoming: entry.video.duration > 0 ? false : local?.isUpcoming === true,
    type: 'video',
  }
  return local ? fillMissingVideoMetadata(record, local) : record
}

function fillMissingVideoMetadata(record, fallback) {
  const metadata = {}
  // Watch-state timestamps do not tell us which side has richer video details.
  if (!knownText(record.title, record.videoId) && knownText(fallback.title, fallback.videoId)) {
    metadata.title = fallback.title
  }
  if ((!Number.isFinite(record.published) || record.published <= 0) && Number.isFinite(fallback.published) && fallback.published > 0) {
    metadata.published = fallback.published
  }
  const placeholderThumbnail = `https://i.ytimg.com/vi/${record.videoId}/hqdefault.jpg`
  if ((!record.thumbnail || record.thumbnail === placeholderThumbnail) && fallback.thumbnail && fallback.thumbnail !== placeholderThumbnail) {
    metadata.thumbnail = fallback.thumbnail
  }
  const uploader = uploaderToLocal({ id: fallback.authorId, name: fallback.author })
  if (uploader.author === uploader.authorId) uploader.author = undefined
  if (!knownText(record.authorId, UNKNOWN_SYNC_UPLOADER_ID) || record.authorId === uploader.authorId) {
    if (!knownText(record.authorId, UNKNOWN_SYNC_UPLOADER_ID) && knownText(uploader.authorId, UNKNOWN_SYNC_UPLOADER_ID)) metadata.authorId = uploader.authorId
    if (!knownText(record.author, record.authorId) && knownText(uploader.author, uploader.authorId)) metadata.author = uploader.author
    const avatar = normalizeChannelAvatar(fallback.authorThumbnail)
    if (!normalizeChannelAvatar(record.authorThumbnail) && avatar) metadata.authorThumbnail = avatar
  }
  return Object.keys(metadata).length > 0 ? { ...record, ...metadata } : record
}

// Repairs fill missing shared fields while keeping populated values and
// server-only metadata on their side of the merge.
export function enrichSyncVideo(video, source) {
  const fields = {}
  const uploader = { ...video.uploader }
  if (!knownText(video.title, video.id) && knownText(source.title, source.id)) fields.title = source.title
  for (const key of ['upload_date', 'duration']) {
    if ((!Number.isFinite(video[key]) || video[key] <= 0) && Number.isFinite(source[key]) && source[key] > 0) {
      fields[key] = source[key]
    }
  }
  if (!knownText(uploader.id, UNKNOWN_SYNC_UPLOADER_ID) && knownText(source.uploader.id, UNKNOWN_SYNC_UPLOADER_ID)) {
    uploader.id = source.uploader.id
  }
  if ((!knownText(video.uploader.name, video.uploader.id) || video.uploader.name === uploader.id) && knownText(source.uploader.name, source.uploader.id) && uploader.id === source.uploader.id) {
    uploader.name = source.uploader.name
  }
  return Object.keys(fields).length || ['id', 'name'].some(key => uploader[key] !== video.uploader[key])
    ? { ...video, ...fields, uploader }
    : video
}

function enrichHistoryVideo(video, source) {
  const enriched = enrichSyncVideo(video, source)
  const fields = {}
  const uploader = { ...enriched.uploader }
  if (uploader.id === source.uploader.id && !normalizeChannelAvatar(uploader.avatar) && normalizeChannelAvatar(source.uploader.avatar)) uploader.avatar = source.uploader.avatar
  const placeholder = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
  if ((!video.thumbnail_url || video.thumbnail_url === placeholder) && source.thumbnail_url !== placeholder) fields.thumbnail_url = source.thumbnail_url
  // Only improvements cause uploads. Conflicting populated fields, server-only
  // fields, and harmless serialization differences cannot bounce between devices.
  return Object.keys(fields).length || uploader.avatar !== enriched.uploader.avatar
    ? { ...enriched, ...fields, uploader }
    : enriched
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

export function updatePlaylistSnapshot({ snapshot, id, remoteId, metadata, previousVideos, acknowledged, next }) {
  let saved
  try { saved = JSON.parse(snapshot) } catch { saved = {} }
  const previous = saved?.playlists?.[id] ?? {}
  const videos = new Set(Array.isArray(previous.videos) ? previous.videos : Array.isArray(previousVideos) ? previousVideos : [])
  for (const videoId of acknowledged.deletions) videos.delete(videoId)
  for (const videoId of acknowledged.upserts) videos.add(videoId)
  return JSON.stringify({ ...saved, playlists: { ...saved?.playlists, [id]: { ...previous, remoteId, metadata, videos: next?.videos ?? [...videos] } } })
}

export function mergeHistory({ localHistory, remoteHistory, previous = {}, acknowledged = {}, options = {} }) {
  const previousStates = historyBaseline(previous, acknowledged)
  const previousIds = previousStates.keys()
  const next = {}
  const syncableLocalHistory = localHistory.filter(record => historyToRemote(record, options) !== null)
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
    const baseline = previousStates.get(id)
    const localState = local && historyToRemote(local, options)
    const localDuration = localState?.video.duration
    // Explicit corrections upload once; ordinary stale metadata does not. Both
    // devices may have a pending repair, but each stops uploading when accepted.
    const repairedDuration = local?.pendingDurationRepair === true && localDuration > 0 && localDuration !== remote?.video.duration
    let useLocal = local && (!remote || local.timeWatched > remote.metadata.added_date)
    if (local && remote && local.timeWatched === remote.metadata.added_date) {
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
    if (useLocal && local.authorId === UNKNOWN_SYNC_UPLOADER_ID) {
      merged = { ...local, ...uploaderToLocal({ id: local.authorId, name: local.author }) }
    }
    if (useLocal && remote) merged = fillMissingVideoMetadata(merged, historyToLocal(remote))
    // Watch time orders progress, not metadata completeness. Fill an unknown
    // local duration before uploading so it cannot erase a known server value.
    // Equal timestamps also refresh metadata without replacing local progress.
    if (repairedDuration && merged.lengthSeconds !== local.lengthSeconds) {
      merged = { ...merged, lengthSeconds: local.lengthSeconds, isLive: false, isUpcoming: false }
    }
    if (useLocal && remote && !repairedDuration &&
        (local.timeWatched === remote.metadata.added_date ||
          !Number.isFinite(local.lengthSeconds) || local.lengthSeconds <= 0) &&
        Number.isFinite(remote.video.duration) && remote.video.duration > 0 &&
        (local.lengthSeconds !== remote.video.duration || local.isLive === true || local.liveNow === true || local.isUpcoming === true)) {
      merged = { ...merged, lengthSeconds: remote.video.duration, isLive: false, isUpcoming: false }
      if (local.liveNow === true) merged.liveNow = false
    }
    if (local?.pendingDurationRepair === true && !options.deferRepairAcknowledgement) {
      // syncHistory persists these updates only after successful uploads. Clear
      // accepted repairs; failed writes keep the marker. Encrypted staging waits
      // until the store confirms the collection upload.
      merged = { ...merged }
      delete merged.pendingDurationRepair
    }
    if (useLocal && merged !== local) localUpdates.push(merged)
    const localPayload = merged === local ? localState : local && historyToRemote(merged, options)
    const watchStateChanged = useLocal && (
      !remote ||
      local.timeWatched > remote.metadata.added_date ||
      !historyStateEquals(localPayload, remote)
    )
    let enrichedVideo = remote && local ? enrichHistoryVideo(remote.video, localPayload.video) : remote?.video
    if (repairedDuration) enrichedVideo = { ...enrichedVideo, duration: localDuration }
    const payload = watchStateChanged ? localPayload : { ...remote, video: enrichedVideo }
    next[id] = { ...payload.metadata }
    if (watchStateChanged || (remote && enrichedVideo !== remote.video)) historyToUpload.push(payload)
    if (!useLocal) {
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
