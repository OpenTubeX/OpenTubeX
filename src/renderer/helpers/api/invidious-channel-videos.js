const FALLBACK_PUBLICATION_DATE_MAX_AGE_MS = 5 * 60 * 1000
const PUBLICATION_DATE_ENRICHMENT_CONCURRENCY = 3
const publicationDateEnrichmentQueue = []
let activePublicationDateEnrichments = 0

async function withPublicationDateEnrichmentLimit(task) {
  if (activePublicationDateEnrichments >= PUBLICATION_DATE_ENRICHMENT_CONCURRENCY) {
    await new Promise(resolve => publicationDateEnrichmentQueue.push(resolve))
  } else {
    activePublicationDateEnrichments++
  }

  try {
    return await task()
  } finally {
    const next = publicationDateEnrichmentQueue.shift()

    if (next) {
      next()
    } else {
      activePublicationDateEnrichments--
    }
  }
}

/**
 * YouTube sometimes omits publication and view metadata from channel cards.
 * Invidious represents those missing values as the current time and zero views.
 * @param {object} video
 * @param {number} fetchedAt
 */
export function usesFallbackInvidiousPublicationDate(video, fetchedAt) {
  return video.liveNow !== true &&
    video.isUpcoming !== true &&
    video.viewCount === 0 &&
    Number.isFinite(video.published) &&
    Math.abs(fetchedAt - video.published) <= FALLBACK_PUBLICATION_DATE_MAX_AGE_MS
}

/**
 * Fetches exact video metadata only for channel entries using Invidious' fallback.
 * @param {object[]} videos
 * @param {(videoId: string) => Promise<object>} fetchVideoDetails
 * @param {number} [fetchedAt]
 */
export async function enrichFallbackInvidiousPublicationDates(
  videos,
  fetchVideoDetails,
  fetchedAt = Date.now()
) {
  return await Promise.all(videos.map(async video => {
    if (!usesFallbackInvidiousPublicationDate(video, fetchedAt)) return video

    const fallbackVideo = {
      ...video,
      isInvidiousPublicationDateFallback: true
    }

    try {
      const details = await withPublicationDateEnrichmentLimit(
        async () => await fetchVideoDetails(video.videoId)
      )

      if (typeof details.published !== 'number') return fallbackVideo

      return {
        ...video,
        published: details.published * 1000,
        publishedText: details.publishedText,
        viewCount: details.viewCount,
        viewCountText: details.viewCountText,
        isInvidiousPublicationDateEnriched: true
      }
    } catch {
      return fallbackVideo
    }
  }))
}
