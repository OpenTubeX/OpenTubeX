import { processToBeAddedPlaylistVideo } from './playlists.js'

export async function importTakeoutPlaylist(incoming, storage) {
  const playlist = structuredClone(incoming)
  // CSV has no saved playlist ID. Match only editable custom playlists;
  // namesakes must never replace a built-in or another protected list.
  const existing = (await storage.find()).find(item => item.playlistName === playlist.playlistName && Array.isArray(item.videos) && !item.protected && !['favorites', 'watchLater'].includes(item._id))

  if (storage.importRecords) {
    // Assign membership IDs only after the importer matches retained members.
    playlist.videos.forEach(video => { video.type ??= 'video' })
    playlist._id = existing?._id ?? crypto.randomUUID()
    await storage.importRecords('playlists', [playlist])
    return
  }

  if (existing === undefined) {
    await storage.create(playlist)
  } else {
    const videos = structuredClone(existing.videos)
    const known = new Map()
    for (const video of videos) {
      const key = `${video?.videoId}:${video?.timeAdded}`
      known.set(key, (known.get(key) ?? 0) + 1)
    }
    for (const video of playlist.videos) {
      const key = `${video?.videoId}:${video?.timeAdded}`
      const count = known.get(key) ?? 0
      if (count > 0) known.set(key, count - 1)
      else {
        processToBeAddedPlaylistVideo(video)
        videos.push(video)
      }
    }
    await storage.update({ ...existing, ...playlist, _id: existing._id, videos })
  }
}
