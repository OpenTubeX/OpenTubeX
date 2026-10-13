import { downloadFileTitle, isPlayableDownloadFile } from './downloadPlayback.js'

/**
 * Builds searchable video actions from metadata already held in the local
 * library. Keep source entries separate so playlist and download playback
 * retain their context even when the same video is also in history.
 * @param {object} context
 * Yields actions one at a time so searching never builds the full registry.
 */
export function * iterateLocalVideoCommands(context) {
  const { history, playlists, downloads, queue, group, sources, navigate, playQueuedVideo, removeQueuedVideo } = context
  let index = 0
  function entry(video, source, icon, run) {
    if (!video?.videoId) return null
    const author = video.author || video.channelName || ''
    return {
      id: `videos.local.${index++}`,
      label: video.title || video.videoId,
      group,
      detail: [source, author].filter(Boolean).join(' · '),
      aliases: [source, author, video.videoId],
      icon,
      searchOnly: true,
      localVideo: true,
      run,
    }
  }

  for (const video of history) {
    const command = entry(video, sources.history, ['fas', 'history'], () => navigate(videoRoute(video,
      context.saveVideoHistoryWithLastViewedPlaylist && video.lastViewedPlaylistId
        ? {
            playlistId: video.lastViewedPlaylistId,
            playlistType: video.lastViewedPlaylistType,
            playlistItemId: video.lastViewedPlaylistItemId,
          }
        : {}
    )))
    if (command) yield command
  }
  for (const playlist of playlists) {
    for (const video of playlist.videos) {
      const command = entry(video, `${sources.playlists}: ${playlist.playlistName}`, ['fas', 'bookmark'], () => navigate(videoRoute(video, {
        playlistId: playlist._id,
        playlistType: 'user',
        ...(video.playlistItemId ? { playlistItemId: video.playlistItemId } : {}),
      })))
      if (command) yield command
    }
  }
  for (const download of Object.values(downloads)) {
    if (download.status !== 'completed' && !(process.env.IS_CAPACITOR && !process.env.IS_IOS && download.status === 'failed')) continue
    if (!['video', 'audio'].includes(download.mode)) continue
    const query = { downloadId: String(download.id) }
    if (download.playlistId) {
      query.playlistId = download.playlistId
    } else if (download.playlistKey) {
      query.playlistId = download.playlistKey
      query.playlistType = 'user'
    }
    for (const file of download.files ?? []) {
      if (!isPlayableDownloadFile(file)) continue
      const command = entry({ ...file, title: downloadFileTitle(download, file), author: file.author || download.author },
        sources.downloads, ['fas', 'download'], () => navigate(videoRoute(file, query)))
      if (command) yield command
    }
  }
  for (const video of queue) {
    const command = entry(video, sources.queue, ['fas', 'list'], () => {
      removeQueuedVideo(video.queueItemId)
      return playQueuedVideo(video.route ?? videoRoute(video))
    })
    if (command) yield command
  }
}

// Search metadata changes; playback progress and download byte counts do not.
const LOCAL_VIDEO_MUTATIONS = new Set([
  'setHistoryCacheSorted', 'upsertToHistoryCache', 'removeFromHistoryCacheById',
  'removeMultipleFromHistoryCache', 'applyHistorySyncChanges',
  'applyPlaylistMetadataRepairs', 'addPlaylist', 'addPlaylists', 'upsertPlaylistToList',
  'addVideo', 'addVideos', 'removeAllPlaylists', 'removeAllVideos', 'removeVideo',
  'removeVideos', 'removePlaylist', 'removePlaylists', 'setAllPlaylists',
  'upsertYtDlpDownload', 'removeYtDlpDownload', 'addVideoToWatchQueue',
  'removeVideoFromWatchQueue', 'moveVideoInWatchQueue', 'clearWatchQueue',
])

/** Whether a store mutation changes locally searchable video metadata. */
export function isLocalVideoMutation(type) {
  return LOCAL_VIDEO_MUTATIONS.has(type)
}

/** Ignore download progress updates that leave locally searchable files unchanged. */
export function hasDownloadSearchChanged(previous, next) {
  if (!previous) return true
  if (['id', 'videoId', 'title', 'author', 'status', 'mode', 'playlistId', 'playlistKey'].some(key => previous[key] !== next[key])) return true
  const previousFiles = previous.files ?? []
  const nextFiles = next.files ?? []
  return previousFiles.length !== nextFiles.length || previousFiles.some((file, index) => (
    ['videoId', 'title', 'author', 'isShort', 'available', 'extension', 'path'].some(key => file[key] !== nextFiles[index][key])
  ))
}

function videoRoute(video, query = {}) {
  return {
    path: `/watch/${encodeURIComponent(video.videoId)}`,
    query: {
      ...query,
      ...(typeof video.isShort === 'boolean' ? { short: String(video.isShort) } : {}),
    },
  }
}
