const nonEmpty = value => typeof value === 'string' && value.trim().length > 0
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0

export function needsHistoryRepair(record) {
  return !record.isStation && /^[\w-]{11}$/.test(record.videoId) && (
    !nonEmpty(record.title) || !nonEmpty(record.author) || !nonEmpty(record.authorId) ||
    !positive(record.published) || !positive(record.lengthSeconds) || record.isLive === true || record.liveNow === true || record.isUpcoming === true
  )
}

// Only public video metadata belongs here. Watch state and playlist context must
// never be copied from the snapshot taken before the network request.
export function historyRepairPatch(record, metadata) {
  const patch = { videoId: record.videoId }
  for (const key of ['title', 'author', 'authorId', 'description']) {
    if (!nonEmpty(record[key]) && nonEmpty(metadata[key])) patch[key] = metadata[key]
  }
  if (!positive(record.published) && positive(metadata.published)) patch.published = metadata.published
  if (metadata.isLive === true || metadata.isUpcoming === true) {
    patch.isLive = metadata.isLive === true
    patch.liveNow = metadata.isLive === true
    patch.isUpcoming = metadata.isUpcoming === true
  } else if (metadata.isLive === false && metadata.isUpcoming === false && positive(metadata.lengthSeconds)) {
    patch.lengthSeconds = Number(metadata.lengthSeconds)
    patch.isLive = false
    patch.liveNow = false
    patch.isUpcoming = false
  }
  for (const key of Object.keys(patch)) {
    if (key !== 'videoId' && record[key] === patch[key]) delete patch[key]
  }
  return Object.keys(patch).length > 1 ? patch : null
}

export function parseHistoryRepairPlayer(response, videoId) {
  const details = response?.videoDetails
  if (details?.videoId !== videoId) throw new Error('Video metadata unavailable')
  const microformat = response.microformat?.playerMicroformatRenderer
  return {
    title: details.title,
    author: details.author,
    authorId: details.channelId,
    description: details.shortDescription,
    lengthSeconds: Number(details.lengthSeconds),
    published: Date.parse(microformat?.publishDate),
    // isLiveContent also marks ended streams and cannot identify a live video.
    isLive: details.isLive === true || microformat?.liveBroadcastDetails?.isLiveNow === true,
    isUpcoming: details.isUpcoming === true,
  }
}

export async function repairHistory({ records, getRecord, fetchMetadata, saveMetadata, signal, onProgress }) {
  const targets = records.filter(needsHistoryRepair)
  const result = { total: targets.length, checked: 0, repaired: 0, failed: 0 }
  onProgress({ ...result })
  // Bound network concurrency and save once per batch, avoiding a full history
  // sort and cross-window broadcast for every individual video.
  for (let offset = 0; offset < targets.length && !signal.aborted; offset += 4) {
    const batch = targets.slice(offset, offset + 4)
    const patches = await Promise.all(batch.map(async original => {
      try {
        const metadata = await fetchMetadata(original.videoId, signal)
        if (signal.aborted) return null
        const current = getRecord(original.videoId)
        return current && needsHistoryRepair(current) ? historyRepairPatch(current, metadata) : null
      } catch {
        if (!signal.aborted) result.failed++
        return null
      } finally {
        if (!signal.aborted) result.checked++
      }
    }))
    const updates = patches.filter(Boolean)
    if (updates.length && !signal.aborted) {
      try {
        const saved = await saveMetadata(updates)
        result.repaired += saved.repaired
        result.failed += saved.failed
      } catch {
        result.failed += updates.length
      }
    }
    onProgress({ ...result })
  }
  return result
}
