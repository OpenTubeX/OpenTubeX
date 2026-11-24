import { isHistoryEntryWatched } from './history'
import {
  applySubscriptionVideoLimit,
  getValidSubscriptionChannels,
  isMembersOnlySubscriptionVideoVisible,
  isSubscriptionFeedTypeEnabled
} from './subscription-channels'
import { getSubscriptionVideoSortTimestamp, getUpcomingPremiereTimestamp } from './subscription-entries'
import { isVideoHiddenByPreferences } from './subscriptionFilters'
import { getNewSubscriptionEntriesSnapshot } from './subscription-entry-snapshot'

/**
 * Returns the locally cached subscription feeds enabled by the current
 * distraction-free settings.
 *
 * @param {Record<string, unknown>} getters
 */
export function getEnabledSubscriptionFeedSources(getters) {
  const feeds = []

  if (!getters.getHideSubscriptionsVideos) {
    feeds.push({ category: 'videos', cache: getters.getVideoCache, entriesKey: 'videos', includeCollaborations: getters.getIncludeSubscriptionCollaborations === true })
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
 * Premieres and scheduled streams change how entries are hidden and sorted
 * once they start. `stableUntil` is the earliest such start, so callers can
 * reuse the result until then unless its reactive sources change.
 *
 * @param {object} options
 * @param {{ category: string, cache: object, entriesKey: string, includeCollaborations?: boolean }[]} options.feeds
 * @param {unknown} options.activeSubscriptions
 * @param {Record<string, object>} options.historyCacheById
 * @param {boolean} options.hideLiveStreams
 * @param {boolean} options.hideUpcomingPremieres
 * @param {string[]} options.forbiddenTitles
 * @param {boolean} options.onlyShowLatestFromChannel
 * @param {number} options.onlyShowLatestFromChannelNumber
 * @param {boolean} options.restrictedPlaybackConfigured
 * @param {boolean} options.showScheduledLiveStreamsFirst
 * @param {'newest' | 'oldest'} options.sortBy
 * @returns {{ content: Record<'videos' | 'shorts' | 'live' | 'posts', object[]>, stableUntil: number }}
 */
export function buildNewSubscriptionFeed({
  feeds,
  activeSubscriptions,
  historyCacheById,
  hideLiveStreams,
  hideUpcomingPremieres,
  forbiddenTitles,
  onlyShowLatestFromChannel,
  onlyShowLatestFromChannelNumber,
  restrictedPlaybackConfigured,
  showScheduledLiveStreamsFirst,
  sortBy,
}) {
  const now = Date.now()
  let stableUntil = Infinity
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

  feeds.forEach(({ category, cache, entriesKey, includeCollaborations = false }) => {
    Object.entries(cache).forEach(([channelId, cacheEntry]) => {
      const subscription = subscriptionsById.get(channelId)
      if (subscription == null || !isSubscriptionFeedTypeEnabled(subscription, category)) {
        return
      }

      const source = cacheEntry?.[entriesKey] ?? []
      const newEntries = getNewSubscriptionEntriesSnapshot(source)
      newEntries.forEach(entry => {
        if (entry.isCollaboration === true && !includeCollaborations) {
          return
        }

        if (!isMembersOnlySubscriptionVideoVisible(
          entry,
          subscription,
          restrictedPlaybackConfigured
        )) {
          return
        }

        // Premiere history depends on the clock, so recheck it even when this
        // channel's entry snapshot has not changed.
        const historyEntry = entry.videoId != null ? historyCacheById[entry.videoId] : undefined
        if (historyEntry != null) {
          const premiereStart = getUpcomingHistoryPremiereStart(historyEntry, now)
          if (premiereStart < stableUntil) stableUntil = premiereStart
          if (isHistoryEntryWatched(historyEntry)) return
        }

        const id = entry.videoId ?? entry.postId
        if (id == null || seenIds.has(id)) {
          return
        }

        seenIds.add(id)
        entries[category].push(entry)
      })
    })
  })

  let mediaEntries = ['videos', 'shorts', 'live'].flatMap(category => {
    return entries[category].map(entry => {
      const scheduledStart = getUpcomingPremiereTimestamp(entry)
      if (scheduledStart > now && scheduledStart < stableUntil) stableUntil = scheduledStart
      return {
        category,
        entry,
        timestamp: getNewSubscriptionEntryTimestamp(entry, showScheduledLiveStreamsFirst, now)
      }
    })
  })

  mediaEntries = mediaEntries.filter(({ entry }) => !isVideoHiddenByPreferences(entry, {
    hideLiveStreams,
    hideUpcomingPremieres,
    forbiddenTitles,
  }))

  mediaEntries.sort((a, b) => b.timestamp - a.timestamp)

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
    content: {
      videos: applySortPreference(mediaByCategory.videos),
      shorts: applySortPreference(mediaByCategory.shorts),
      live: applySortPreference(mediaByCategory.live),
      posts: applySortPreference(entries.posts
        .sort((a, b) => getNewSubscriptionEntryTimestamp(b) - getNewSubscriptionEntryTimestamp(a))
        .filter(entry => {
          const lowerCaseAuthor = entry.author?.toLowerCase()
          return entry.postId != null &&
            !forbiddenTitles.some(text => lowerCaseAuthor?.includes(text))
        })),
    },
    stableUntil,
  }
}

/**
 * When a watched premiere's history entry starts counting as watched.
 * @param {object} historyEntry
 * @param {number} now
 */
function getUpcomingHistoryPremiereStart(historyEntry, now) {
  if (historyEntry.isUpcoming !== true || historyEntry.isLive === true) return Infinity
  const start = Number(historyEntry.premiereTimestamp) * 1000
  return Number.isFinite(start) && start > now ? start : Infinity
}

/**
 * Sorts scheduled entries like the subscription feed and posts by their
 * publication time.
 * @param {object} entry
 * @param {boolean} [showScheduledLiveStreamsFirst]
 * @param {number} [now]
 */
export function getNewSubscriptionEntryTimestamp(entry, showScheduledLiveStreamsFirst = true, now = Date.now()) {
  return getSubscriptionVideoSortTimestamp(entry, showScheduledLiveStreamsFirst, now) ?? entry.publishedTime ?? 0
}
