const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused'])

/** Resolve queue shortcuts against current state without changing menu/button behavior. */
export function queueSwipeAction(actionId, videos, queue, { t, commit, add }) {
  if (!['addToQueue', 'playNext'].includes(actionId) || videos.length === 0) return null
  const matchesVideo = (item, video) => item.videoId === video.videoId &&
    (item.route?.query?.downloadId ?? null) === (video.route?.query?.downloadId ?? null) &&
    (item.route?.query?.downloadFilePath ?? null) === (video.route?.query?.downloadFilePath ?? null)
  const matches = item => videos.some(video => matchesVideo(item, video))
  const queued = queue.filter(matches)
  const remove = actionId === 'playNext' ? matches(queue[0] ?? {}) : queued.length > 0
  return {
    label: remove ? t('Video.Remove from Queue', { title: videos[0].title }) : actionId === 'playNext' ? t('Video.Play Next') : t('Video.Add to Queue'),
    icon: ['fas', remove ? 'trash' : actionId === 'playNext' ? 'step-forward' : 'add-to-queue'],
    run: () => {
      if (remove) {
        for (const item of queued) commit('removeVideoFromWatchQueue', item.queueItemId)
      } else if (actionId === 'playNext' && queued.length > 0) {
        const ordered = videos.flatMap(video => {
          const existing = queued.filter(item => matchesVideo(item, video))
          if (existing.length > 0) return existing
          const queueItemId = crypto.randomUUID()
          commit('addVideoToWatchQueue', { video, queueItemId })
          return [{ queueItemId }]
        })
        let targetQueueItemId = queue[0].queueItemId
        for (const item of ordered.toReversed()) {
          commit('moveVideoInWatchQueue', { queueItemId: item.queueItemId, targetQueueItemId })
          targetQueueItemId = item.queueItemId
        }
      } else {
        add(actionId === 'playNext')
      }
    }
  }
}

export function findSwipeDownload(downloads, videoId) {
  // A playlist download owns multiple files; a feed gesture must never delete
  // the entire playlist because one of its videos happens to match.
  return Object.values(downloads)
    .filter(download => download.videoId === videoId && !download.playlistId &&
      (ACTIVE_DOWNLOAD_STATUSES.has(download.status) ||
        (download.status === 'completed' && download.destination && download.availability !== 'missing')))
    .sort((a, b) => Number(ACTIVE_DOWNLOAD_STATUSES.has(b.status)) - Number(ACTIVE_DOWNLOAD_STATUSES.has(a.status)) || b.id - a.id)[0]
}

export function downloadSwipeAction(download, { t, cancel, remove }) {
  if (!download) return null
  const active = ACTIVE_DOWNLOAD_STATUSES.has(download.status)
  if (!active && !(download.destination && download.availability !== 'missing')) return null
  return {
    label: active ? t('Downloads.Cancel Download') : t('Downloads.Remove File'),
    icon: ['fas', active ? 'times' : 'trash'],
    run: () => active ? cancel(download) : remove(download),
  }
}
