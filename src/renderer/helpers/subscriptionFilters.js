import store from '../store/index'
import { isOnAiSlopList } from './aiSlopList'
import { isRssUpcomingPremiereCandidate } from './api/feed-rss'
import {
  getSubscriptionVideoSortTimestamp,
  getUpcomingPremiereTimestamp,
  updateUpcomingPremiereState
} from './subscription-entries'

/**
 * @param {{
 *  isRSS?: boolean,
 *  isUpcoming?: boolean,
 *  viewCount?: number | string | null,
 * }} video
 */
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
 *  aiSlopChannels?: Set<string>,
 *  forbiddenTitles?: string[],
 *  membersOnlyChannelIds?: Set<string> | null,
 * }} preferences
 */
export function isVideoHiddenByPreferences(video, {
  hideLiveStreams = false,
  hideUpcomingPremieres = false,
  hideChannelsBasedOnText = true,
  hiddenChannelNames = new Set(),
  aiSlopChannels = new Set(),
  forbiddenTitles = [],
  membersOnlyChannelIds = null
} = {}) {
  if (hideLiveStreams && (video.liveNow || video.isUpcoming)) {
    return true
  }

  if (
    hideUpcomingPremieres &&
    isUpcomingPremiere(video)
  ) {
    return true
  }

  if (
    hiddenChannelNames.has(video.authorId) ||
    hiddenChannelNames.has(video.author) ||
    video.collaborators?.some(({ id }) => hiddenChannelNames.has(id))
  ) {
    return true
  }

  if (isOnAiSlopList(aiSlopChannels, video)) {
    return true
  }

  if (
    membersOnlyChannelIds != null &&
    video.isMembersOnly === true &&
    !membersOnlyChannelIds.has(video.authorId) &&
    !membersOnlyChannelIds.has(video.collaborators?.[0]?.id)
  ) {
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

/**
 * Filtering and sort based on user preferences
 * @param {any[]} videos
 */
export function updateVideoListAfterProcessing(videos, now = Date.now()) {
  let videoList = videos.map(video => updateUpcomingPremiereState(video, now))

  if (store.getters.getHideLiveStreams) {
    videoList = videoList.filter(item => {
      return (!item.liveNow && !item.isUpcoming)
    })
  }

  if (store.getters.getHideUpcomingPremieres) {
    videoList = videoList.filter(item => !isUpcomingPremiere(item, now))
  }

  const showScheduledLiveStreamsFirst = store.getters.getShowScheduledLiveStreamsFirst

  videoList.sort((a, b) => {
    return getSubscriptionVideoSortTimestamp(b, showScheduledLiveStreamsFirst, now) -
      getSubscriptionVideoSortTimestamp(a, showScheduledLiveStreamsFirst, now)
  })

  return videoList
}
