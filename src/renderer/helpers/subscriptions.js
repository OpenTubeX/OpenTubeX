import { parseSubscriptionRss } from './api/feed-rss'
import store from '../store/index'
import {
  getSubscriptionVideoSortTimestamp,
  updateUpcomingPremiereState,
} from './subscription-entries'
import { isUpcomingPremiere, isVideoHiddenByPreferences } from './subscription-visibility'
import { enrichSubscriptionRssEntries, enrichSubscriptionShortDates, refreshSubscriptionPremieres } from './subscription-enrichment'
import {
  SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY,
  SUBSCRIPTION_REFRESH_CANCELLED_EVENT,
  SUBSCRIPTION_REFRESH_CHANNEL_EVENT,
  SUBSCRIPTION_REFRESH_COMPLETED_EVENT,
  SUBSCRIPTION_REFRESH_FINISHED_EVENT,
  SUBSCRIPTION_REFRESH_LOCK_NAME,
  SUBSCRIPTION_REFRESH_PROGRESS_EVENT,
  SUBSCRIPTION_REFRESH_STARTED_EVENT,
  cancelSubscriptionRefresh,
  getSubscriptionRefreshCancelCount,
  notifySubscriptionChannelRefreshed,
  requestSubscriptionRefreshCancellation,
} from './subscription-refresh-state'
import {
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
} from './subscription-feed-refresh'

// OpenTubeX's refresh, enrichment, and visibility helpers live in sibling
// modules; existing importers keep using this entry point.
export {
  SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY,
  SUBSCRIPTION_REFRESH_CANCELLED_EVENT,
  SUBSCRIPTION_REFRESH_CHANNEL_EVENT,
  SUBSCRIPTION_REFRESH_COMPLETED_EVENT,
  SUBSCRIPTION_REFRESH_FINISHED_EVENT,
  SUBSCRIPTION_REFRESH_LOCK_NAME,
  SUBSCRIPTION_REFRESH_PROGRESS_EVENT,
  SUBSCRIPTION_REFRESH_STARTED_EVENT,
  cancelSubscriptionRefresh,
  enrichSubscriptionRssEntries,
  enrichSubscriptionShortDates,
  getSubscriptionRefreshCancelCount,
  isVideoHiddenByPreferences,
  notifySubscriptionChannelRefreshed,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionPremieres,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  requestSubscriptionRefreshCancellation,
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

/**
 * @param {string} rssString
 * @param {string} channelId
 */
export async function parseYouTubeRSSFeed(rssString, channelId) {
  // A body that is not a feed (consent page, bot challenge, truncated response)
  // must surface as an error so the caller keeps the cached entries and falls
  // back, instead of treating it as a channel without videos.
  const { name: channelName, videos } = process.env.IS_ELECTRON
    ? await window.ftElectron.subscriptionAutoRefresh.processFeed({ format: 'rss', text: rssString, channelId })
        .catch(() => parseSubscriptionRss(rssString, channelId))
    : parseSubscriptionRss(rssString, channelId)

  return {
    name: channelName,
    // Enrichment downloads a watch page per candidate, so cap how many of them
    // a single channel can have in flight at once.
    videos: await enrichSubscriptionRssEntries(videos)
  }
}
