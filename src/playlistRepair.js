import { historyRepairPatch, needsHistoryRepair } from './historyRepair.js'

export function needsPlaylistRepair(video) {
  return needsHistoryRepair(video) || (!video.isStation && /^[\w-]{11}$/.test(video.videoId) && video.title === video.videoId)
}

export function playlistRepairRecords(playlists) {
  const records = new Map()
  for (const playlist of playlists) {
    for (const video of playlist.videos) {
      if (needsPlaylistRepair(video) && !records.has(video.videoId)) records.set(video.videoId, video)
    }
  }
  return [...records.values()]
}

export function playlistRepairPatch(video, metadata) {
  if (!needsPlaylistRepair(video)) return null
  const patch = historyRepairPatch(video.title === video.videoId ? { ...video, title: '' } : video, metadata)
  if (!patch) return null
  delete patch.description
  delete patch.liveNow
  return Object.keys(patch).length > 1 ? patch : null
}

export function applyPlaylistRepairUpdate(playlists, update) {
  const playlist = playlists.find(item => item._id === update._id)
  if (!playlist) return
  const changesById = new Map()
  for (const change of update.changes) {
    const changes = changesById.get(change.videoId) ?? []
    changes.push(change)
    changesById.set(change.videoId, changes)
  }
  for (const video of playlist.videos) {
    for (const change of changesById.get(video.videoId) ?? []) {
      if (change.playlistItemId != null && video.playlistItemId !== change.playlistItemId) continue
      for (const [key, value] of Object.entries(change.fields)) {
        // A newer edit or a duplicate delivery must not be overwritten. Missing
        // values survive IPC serialization as absent keys in previous.
        if (Object.is(video[key], change.previous[key])) video[key] = value
      }
    }
  }
}
