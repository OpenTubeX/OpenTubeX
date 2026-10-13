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
