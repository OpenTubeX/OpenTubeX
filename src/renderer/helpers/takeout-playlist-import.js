import { processToBeAddedPlaylistVideo } from './playlists.js'
import { parseTakeoutPlaylistCsv } from './youtube-takeout-zip.js'

export async function importTakeoutPlaylist(entry, playlistName, storage) {
  const name = entry.path.split('/').at(-1)
  const playlist = parseTakeoutPlaylistCsv(entry.content, name)
  if (playlist === null) throw new Error('Invalid playlist CSV')
  playlist.playlistName = playlistName

  if (storage.importRecords) {
    playlist._id = crypto.randomUUID()
    await storage.importRecords('playlists', [playlist])
    return
  }

  const existing = (await storage.find()).find(item => item.playlistName === playlist.playlistName)
  if (existing === undefined) {
    await storage.create(playlist)
  } else {
    const videos = JSON.parse(JSON.stringify(existing.videos))
    const known = new Set(videos.map(video => `${video.videoId}:${video.timeAdded}`))
    for (const video of playlist.videos) {
      const key = `${video.videoId}:${video.timeAdded}`
      if (!known.has(key)) {
        processToBeAddedPlaylistVideo(video)
        videos.push(video)
        known.add(key)
      }
    }
    await storage.update({ _id: existing._id, playlistName: existing.playlistName, videos })
  }
}
