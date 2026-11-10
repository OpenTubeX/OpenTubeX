const unavailableReason = /(?:\bprivate video\b|\bvideo is private\b|\bvideo (?:is |has been )?(?:deleted|removed)\b|\bvideo does not exist\b)/i

export function isUnavailablePlayerResponse(response, videoId) {
  if (response?.videoDetails?.videoId === videoId && response?.playabilityStatus?.status === 'OK') return false
  const status = response?.playabilityStatus
  const errorReason = status?.errorScreen?.playerErrorMessageRenderer?.reason
  const reason = [status?.reason, errorReason?.simpleText, ...(errorReason?.runs?.map(run => run.text) ?? [])]
    .filter(Boolean).join(' ')
  if (unavailableReason.test(reason)) return true
  throw new Error(`Could not determine video availability: ${reason || status?.status || 'unknown response'}`)
}

export function isUnavailableInvidiousResponse(response, videoId) {
  if (response?.videoId === videoId) return false
  if (unavailableReason.test(response?.error ?? '')) return true
  throw new Error(`Could not determine video availability: ${response?.error ?? 'unknown response'}`)
}

/** Check each video once, but return the exact playlist items present when the scan began. */
export async function findDeadPlaylistItems(videos, checkVideo, signal, onProgress = () => {}) {
  const ids = [...new Set(videos.map(video => video.videoId))]
  const deadIds = new Set()
  let checked = 0
  let uncertain = 0
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
    while (next < ids.length && !signal.aborted) {
      const videoId = ids[next++]
      try {
        if (await checkVideo(videoId, signal)) deadIds.add(videoId)
      } catch (error) {
        if (signal.aborted) break
        console.error('Could not check playlist video', videoId, error)
        uncertain++
      }
      checked++
      onProgress({ checked, total: ids.length, uncertain })
    }
  }))
  signal.throwIfAborted()
  return {
    itemIds: new Set(videos.filter(video => deadIds.has(video.videoId)).map(video => video.playlistItemId)),
    uncertain,
  }
}
