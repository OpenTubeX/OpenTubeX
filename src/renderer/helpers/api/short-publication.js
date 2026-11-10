import { extractAssignedJsonObject } from '../assigned-json.js'
import { mapConcurrently } from '../concurrent-map.js'

/** Shorts tabs omit publication dates required by subscription ordering and New badges. */
export async function enrichShortPublicationDates(entries, fetchHtml, cachedEntries = []) {
  const cached = new Map(cachedEntries.map(entry => [entry.videoId, entry.published]))
  return mapConcurrently(entries, 3, async entry => {
    if (Number.isFinite(entry.published)) return entry
    let published = cached.get(entry.videoId)
    if (!Number.isFinite(published)) {
      const html = await fetchHtml(entry.videoId)
      const player = JSON.parse(extractAssignedJsonObject(html, 'ytInitialPlayerResponse') ?? 'null')
      published = Date.parse(player?.microformat?.playerMicroformatRenderer?.publishDate)
      if (player?.videoDetails?.videoId !== entry.videoId || !Number.isFinite(published)) {
        throw new Error(`Could not load the publication date for Short ${entry.videoId}`)
      }
    }
    return { ...entry, published }
  })
}
