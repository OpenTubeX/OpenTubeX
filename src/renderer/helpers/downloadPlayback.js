const IOS_PLAYABLE_EXTENSIONS = new Set(['mp4', 'm4a', 'mp3', 'mov', 'aac'])

export function isPlayableDownloadFile(file) {
  return file.available !== false &&
    (!process.env.IS_IOS || IOS_PLAYABLE_EXTENSIONS.has(file.extension?.toLowerCase()))
}

export function downloadWatchRoute(download, videoId) {
  const query = { downloadId: String(download.id) }
  if (download.playlistId) {
    query.playlistId = download.playlistId
  } else if (download.playlistKey) {
    query.playlistId = download.playlistKey
    query.playlistType = 'user'
  }

  return { path: `/watch/${videoId}`, query }
}
