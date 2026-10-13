import { isYouTubeMediaUrl } from './externalMediaUrl.js'

const IOS_PLAYABLE_EXTENSIONS = new Set(['mp4', 'm4a', 'mp3', 'mov', 'aac'])

/** Platform and status gates shared by download actions; files are checked separately. */
export function isDownloadPlaybackSupported(download) {
  return (process.env.IS_IOS || !download.retryPayload?.externalUrl || isYouTubeMediaUrl(download.retryPayload.externalUrl)) &&
    (download.status === 'completed' || (process.env.IS_CAPACITOR && !process.env.IS_IOS && download.status === 'failed')) &&
    ['video', 'audio'].includes(download.mode)
}

export async function refreshDownloadRecords(api, store) {
  const records = await api.ytDlpListDownloads()
  for (const download of records) store.commit('upsertYtDlpDownload', download)
  return records
}

/** Refresh availability on selection, then play the chosen file with the platform's player. */
export async function playDownloadedFile(downloadId, selectedFile, { refreshDownloads, playNative, navigate, fileNotFound }) {
  const download = (await refreshDownloads()).find(record => record.id === downloadId)
  const file = download && isDownloadPlaybackSupported(download)
    ? download.files?.find(file => file.available && isPlayableDownloadFile(file) && (
        !selectedFile || (selectedFile.path ? file.path === selectedFile.path : file.videoId === selectedFile.videoId)
      ))
    : null
  if (!file) {
    fileNotFound()
    return
  }
  if (process.env.IS_IOS) {
    if (!await playNative(download.id, file.path).catch(() => false)) fileNotFound()
    return
  }
  const route = downloadWatchRoute(download, file.videoId)
  if (typeof file.isShort === 'boolean') route.query.short = String(file.isShort)
  return navigate(route)
}

export function isPlayableDownloadFile(file) {
  return file.available !== false &&
    (!process.env.IS_IOS || IOS_PLAYABLE_EXTENSIONS.has(file.extension?.toLowerCase()))
}

export function downloadFileTitle(download, file) {
  return file.title || (download.videoId && download.videoId === file.videoId ? download.title : '') ||
    file.path?.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, '') || file.videoId
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
      title: downloadFileTitle(download, file),
      author: file.author || download.author || '',
      authorId: file.authorId || download.authorId || '',
      thumbnail: download.thumbnail,
      route: downloadWatchRoute(download, file.videoId)
    }))
}
