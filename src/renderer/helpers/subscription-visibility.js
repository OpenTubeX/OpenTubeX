import { getUpcomingPremiereTimestamp } from './subscription-entries.js'
import { isRssUpcomingPremiereCandidate } from './api/feed-rss.js'

export function isRssUpcomingPremiere(video) {
  if (!video?.isRSS) {
    return false
  }

  if (video.isUpcoming === true) {
    return true
  }

  if (video.isUpcoming === false) {
    return false
  }

  // Fallback for cached RSS entries before enrichment.
  return isRssUpcomingPremiereCandidate(video.viewCount)
}

/**
 * @param {object} video
 * @param {number} [now]
 */
export function isUpcomingPremiere(video, now = Date.now()) {
  const premiereTimestamp = getUpcomingPremiereTimestamp(video)

  if (premiereTimestamp != null) {
    return premiereTimestamp > now
  }

  return isRssUpcomingPremiere(video)
}

/**
 * @param {object} video
 * @param {{
 *  hideLiveStreams?: boolean,
 *  hideUpcomingPremieres?: boolean,
 *  hideChannelsBasedOnText?: boolean,
 *  hiddenChannelNames?: Set<string>,
 *  forbiddenTitles?: string[],
 * }} preferences
 */
export function isVideoHiddenByPreferences(video, {
  hideLiveStreams = false,
  hideUpcomingPremieres = false,
  hideChannelsBasedOnText = true,
  hiddenChannelNames = new Set(),
  forbiddenTitles = []
} = {}, now = Date.now()) {
  if (hideLiveStreams && (video.liveNow || video.isUpcoming)) {
    return true
  }

  if (
    hideUpcomingPremieres &&
    isUpcomingPremiere(video, now)
  ) {
    return true
  }

  if (hiddenChannelNames.has(video.authorId) || hiddenChannelNames.has(video.author)) {
    return true
  }

  if (forbiddenTitles.length === 0) return false

  const lowerCaseAuthor = video.author?.toLowerCase()
  const lowerCaseTitle = video.title?.toLowerCase()

  return forbiddenTitles.some(text =>
    lowerCaseTitle?.includes(text) ||
      (hideChannelsBasedOnText && lowerCaseAuthor?.includes(text))
  )
}
