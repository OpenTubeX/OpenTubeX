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

export function downloadQueueVideos(download) {
  return (download.files ?? [])
    .filter(file => file.videoId && isPlayableDownloadFile(file))
    .map(file => ({
      videoId: file.videoId,
      title: file.title || (download.videoId === file.videoId ? download.title : '') ||
        file.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') || file.videoId,
      author: file.author || download.author || '',
      authorId: file.authorId || download.authorId || '',
      thumbnail: download.thumbnail,
      route: downloadWatchRoute(download, file.videoId)
    }))
}
