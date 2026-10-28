import { mapConcurrently } from '../concurrent-map.js'

/** YouTube omits publication dates from some search results, such as auto-generated Topic videos. */
function lacksPublicationDate(entry) {
  return entry.type === 'video' && !Number.isFinite(entry.published) && !entry.liveNow && !entry.isUpcoming && !entry.isShort
}

/**
 * @param {any[]} entries
 * @param {(videoId: string) => Promise<any>} fetchPlayer
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchMissingPublicationDates(entries, fetchPlayer) {
  const dates = new Map()
  await mapConcurrently(entries.filter(lacksPublicationDate), 3, async ({ videoId }) => {
    try {
      const player = await fetchPlayer(videoId)
      const published = Date.parse(player?.microformat?.playerMicroformatRenderer?.publishDate)
      if (player?.videoDetails?.videoId === videoId && Number.isFinite(published)) {
        dates.set(videoId, published)
      }
    } catch (error) {
      console.warn(`Could not load the publication date for ${videoId}`, error)
    }
  })
  return dates
}

/**
 * @param {any[]} entries
 * @param {Map<string, number>} dates
 */
export function applyPublicationDates(entries, dates) {
  return entries.map(entry => lacksPublicationDate(entry) && dates.has(entry.videoId)
    ? { ...entry, published: dates.get(entry.videoId) }
    : entry)
}
