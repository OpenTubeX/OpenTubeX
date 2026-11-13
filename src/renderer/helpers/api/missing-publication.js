import { mapConcurrently } from '../concurrent-map.js'

/** YouTube omits publication dates from some search results, such as auto-generated Topic videos. */
function lacksPublicationDate(entry) {
  return entry.type === 'video' && !Number.isFinite(entry.published) && !entry.liveNow && !entry.isUpcoming && !entry.isShort
}

function parsePlayerPublicationDate(player, videoId) {
  if (player?.videoDetails?.videoId !== videoId) return NaN
  return Date.parse(player.microformat?.playerMicroformatRenderer?.publishDate)
}

function parseWatchNextPublicationDate(next, videoId) {
  if (next?.currentVideoEndpoint?.watchEndpoint?.videoId !== videoId) return NaN
  const primaryInfo = next.contents?.twoColumnWatchNextResults?.results?.results?.contents
    ?.find(content => content.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer
  // Text date such as "Sep 23, 2019", less accurate than the player's timestamp.
  return Date.parse(primaryInfo?.dateText?.simpleText)
}

async function tryParse(videoId, fetchResponse, parse) {
  try {
    return parse(await fetchResponse(videoId), videoId)
  } catch (error) {
    console.warn(`Could not load the publication date for ${videoId}`, error)
    return NaN
  }
}

/**
 * @param {any[]} entries
 * @param {(videoId: string) => Promise<any>} fetchPlayer
 * @param {(videoId: string) => Promise<any>} fetchWatchNext
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchMissingPublicationDates(entries, fetchPlayer, fetchWatchNext) {
  const dates = new Map()
  await mapConcurrently(entries.filter(lacksPublicationDate), 3, async ({ videoId }) => {
    let published = await tryParse(videoId, fetchPlayer, parsePlayerPublicationDate)
    if (!Number.isFinite(published)) {
      // Bot checks, e.g. on VPNs, strip the player metadata but still serve the watch page.
      published = await tryParse(videoId, fetchWatchNext, parseWatchNextPublicationDate)
    }
    if (Number.isFinite(published)) {
      dates.set(videoId, published)
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
