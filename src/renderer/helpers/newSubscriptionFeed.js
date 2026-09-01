import { isHistoryEntryWatched } from './history'
import {
  applySubscriptionVideoLimit,
  getValidSubscriptionChannels,
  isMembersOnlySubscriptionVideoVisible,
  isSubscriptionFeedTypeEnabled
} from './subscription-channels'
import { isVideoHiddenByPreferences } from './subscriptions'

/**
 * Returns the locally cached subscription feeds enabled by the current
 * distraction-free settings.
 *
 * @param {Record<string, unknown>} getters
 */
export function getEnabledSubscriptionFeedSources(getters) {
  const feeds = []

  if (!getters.getHideSubscriptionsVideos) {
    feeds.push({ category: 'videos', cache: getters.getVideoCache, entriesKey: 'videos' })
  }
  if (!getters.getHideSubscriptionsShorts) {
    feeds.push({ category: 'shorts', cache: getters.getShortsCache, entriesKey: 'videos' })
  }
  if (!getters.getHideLiveStreams && !getters.getHideSubscriptionsLive) {
    feeds.push({ category: 'live', cache: getters.getLiveCache, entriesKey: 'videos' })
  }
  if (!getters.getHideSubscriptionsCommunity && !getters.getUseRssFeeds) {
    feeds.push({ category: 'posts', cache: getters.getPostsCache, entriesKey: 'posts' })
  }

  return feeds
}

/**
 * Applies the New feed's seen, history, filtering, deduplication, per-channel,
 * and sorting rules to cached subscription entries.
 *
 * @param {object} options
 * @param {{ category: string, cache: object, entriesKey: string }[]} options.feeds
 * @param {unknown} options.activeSubscriptions
 * @param {Record<string, object>} options.historyCacheById
 * @param {boolean} options.hideLiveStreams
 * @param {boolean} options.hideUpcomingPremieres
 * @param {string[]} options.forbiddenTitles
 * @param {boolean} options.onlyShowLatestFromChannel
 * @param {number} options.onlyShowLatestFromChannelNumber
 * @param {boolean} options.restrictedPlaybackConfigured
 * @param {'newest' | 'oldest'} options.sortBy
 */
export function getNewSubscriptionFeedEntries({
  feeds,
  activeSubscriptions,
  historyCacheById,
  hideLiveStreams,
  hideUpcomingPremieres,
  forbiddenTitles,
  onlyShowLatestFromChannel,
  onlyShowLatestFromChannelNumber,
  restrictedPlaybackConfigured,
  sortBy,
}) {
  const entries = {
    videos: [],
    shorts: [],
    live: [],
    posts: [],
  }
  const seenIds = new Set()
  const subscriptionsById = new Map(
    getValidSubscriptionChannels(activeSubscriptions).map(channel => [channel.id, channel])
  )

  feeds.forEach(({ category, cache, entriesKey }) => {
    Object.entries(cache).forEach(([channelId, cacheEntry]) => {
      const subscription = subscriptionsById.get(channelId)
      if (subscription == null || !isSubscriptionFeedTypeEnabled(subscription, category)) {
        return
      }

      cacheEntry?.[entriesKey]?.forEach(entry => {
        if (!isMembersOnlySubscriptionVideoVisible(
          entry,
          subscription,
          restrictedPlaybackConfigured
        )) {
          return
        }

        if (entry.isNewInSubscriptionFeed !== true) {
          return
        }

        if (entry.videoId != null && isHistoryEntryWatched(historyCacheById[entry.videoId])) {
          return
        }

        const id = entry.videoId ?? entry.postId
        if (id == null || seenIds.has(id)) {
          return
        }

        seenIds.add(id)
        entries[category].push({
          ...entry,
          hideNewSubscriptionFeedIndicator: true,
          isInNewSubscriptionFeed: true,
        })
      })
    })
  })

  let mediaEntries = ['videos', 'shorts', 'live'].flatMap(category => {
    return entries[category].map(entry => ({ category, entry }))
  })

  mediaEntries = mediaEntries.filter(({ entry }) => !isVideoHiddenByPreferences(entry, {
    hideLiveStreams,
    hideUpcomingPremieres,
    forbiddenTitles,
  }))

  mediaEntries.sort((a, b) => entryTimestamp(b.entry) - entryTimestamp(a.entry))

  const hasPerChannelLimit = [...subscriptionsById.values()].some(subscription => (
    Number.isInteger(subscription.dailyVideoLimit) && subscription.dailyVideoLimit > 0
  ))
  if (onlyShowLatestFromChannel || hasPerChannelLimit) {
    const categoriesByVideoId = new Map(
      mediaEntries.map(({ category, entry }) => [entry.videoId, category])
    )
    mediaEntries = applySubscriptionVideoLimit(
      mediaEntries.map(({ entry }) => entry),
      activeSubscriptions,
      onlyShowLatestFromChannel ? onlyShowLatestFromChannelNumber : null
    ).map(entry => ({
      category: categoriesByVideoId.get(entry.videoId),
      entry
    }))
  }

  const mediaByCategory = mediaEntries.reduce((result, { category, entry }) => {
    result[category].push(entry)
    return result
  }, {
    videos: [],
    shorts: [],
    live: [],
  })

  const applySortPreference = categoryEntries => (
    sortBy === 'oldest' ? categoryEntries.toReversed() : categoryEntries
  )

  return {
    videos: applySortPreference(mediaByCategory.videos),
    shorts: applySortPreference(mediaByCategory.shorts),
    live: applySortPreference(mediaByCategory.live),
    posts: applySortPreference(entries.posts
      .sort((a, b) => entryTimestamp(b) - entryTimestamp(a))
      .filter(entry => {
        const lowerCaseAuthor = entry.author?.toLowerCase()
        return entry.postId != null &&
          !forbiddenTitles.some(text => lowerCaseAuthor?.includes(text))
      })),
  }
}

function entryTimestamp(entry) {
  return entry.published ?? entry.publishedTime ?? 0
}
