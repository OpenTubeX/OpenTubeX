/** Resolve queue shortcuts against current state without changing menu/button behavior. */
export function queueSwipeAction(actionId, videos, queue, { t, commit, add }) {
  if (!['addToQueue', 'playNext'].includes(actionId) || videos.length === 0) return null
  const matches = item => videos.some(video => item.videoId === video.videoId &&
    (item.route?.query?.downloadId ?? null) === (video.route?.query?.downloadId ?? null) &&
    (item.route?.query?.downloadFilePath ?? null) === (video.route?.query?.downloadFilePath ?? null))
  const queued = queue.filter(matches)
  const remove = actionId === 'playNext' ? matches(queue[0] ?? {}) : queued.length > 0
  return {
    label: remove ? t('Video.Remove from Queue', { title: videos[0].title }) : actionId === 'playNext' ? t('Video.Play Next') : t('Video.Add to Queue'),
    icon: ['fas', remove ? 'trash' : actionId === 'playNext' ? 'step-forward' : 'add-to-queue'],
    run: () => {
      if (remove) {
        for (const item of queued) commit('removeVideoFromWatchQueue', item.queueItemId)
      } else if (actionId === 'playNext' && queued.length > 0) {
        commit('moveVideoInWatchQueue', { queueItemId: queued[0].queueItemId, targetQueueItemId: queue[0].queueItemId })
      } else {
        add(actionId === 'playNext')
      }
    }
  }
}

export function findSwipeDownload(downloads, videoId) {
  // A playlist download owns multiple files; a feed gesture must never delete
  // the entire playlist because one of its videos happens to match.
  return Object.values(downloads).find(download => download.videoId === videoId && !download.playlistId &&
    ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused', 'completed'].includes(download.status))
}

export function downloadSwipeAction(download, { t, cancel, remove }) {
  if (!download) return null
  const active = ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused'].includes(download.status)
  if (!active && !(download.destination && download.availability !== 'missing')) return null
  return {
    label: active ? t('Downloads.Cancel Download') : t('Downloads.Remove File'),
    icon: ['fas', active ? 'times' : 'trash'],
    run: () => active ? cancel(download) : remove(download),
  }
}
