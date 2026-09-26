import { AndroidSubscriptionRefreshPayloadError, normalizeAndroidSubscriptionRefreshPayload, processAndroidSubscriptionRefreshChannelResult } from './androidSubscriptionRefreshData'
import { acknowledgeAndroidSubscriptionRefreshResult, getNextAndroidSubscriptionRefreshResult } from './androidSubscriptionRefresh'
import { formatRequestDiagnostic } from './api/requestDiagnostics'
import { shouldHideMembersOnlyContent } from './restricted-playback'
import { normalizeLocalSubscriptionFeed } from './api/local'
import { normalizeInvidiousSubscriptionFeed } from './api/invidious'
import { reconcileFetchedSubscriptionEntries } from './subscription-entries'
import { parseSubscriptionRss } from './api/feed-rss'
import { enrichSubscriptionRssEntries, enrichSubscriptionShortDates } from './subscriptions'
import { SUBSCRIPTION_FEED_TYPES } from './subscription-channels.js'

/** Reconcile a saved closed-app channel result with the current subscription cache. */
export function createSubscriptionBackgroundReconciler({ store, locks, onCompleted, onFailure }) {
  let reconcilingAndroidSubscriptionRefreshResults = null

  function reconcileAndroidSubscriptionRefreshResults() {
    if (reconcilingAndroidSubscriptionRefreshResults) return reconcilingAndroidSubscriptionRefreshResults
    const importing = locks
      ? locks.request('opentubex-background-subscription-import', importAndroidSubscriptionRefreshResults)
      : importAndroidSubscriptionRefreshResults()
    reconcilingAndroidSubscriptionRefreshResults = importing.finally(() => {
      reconcilingAndroidSubscriptionRefreshResults = null
    })
    return reconcilingAndroidSubscriptionRefreshResults
  }

  async function importAndroidSubscriptionRefreshResults() {
    try {
      while (true) {
        const result = await getNextAndroidSubscriptionRefreshResult()
        if (result === null) return

        if (
          typeof result.id !== 'string' ||
          typeof result.profileId !== 'string' ||
          !SUBSCRIPTION_FEED_TYPES.includes(result.feedType)
        ) {
          await acknowledgeAndroidSubscriptionRefreshResult(result.id)
          continue
        }

        if (result.kind === 'channel') {
          await processAndroidSubscriptionRefreshChannelResult(
            result,
            reconcileAndroidSubscriptionRefreshChannelResult,
            acknowledgeAndroidSubscriptionRefreshResult
          )
          continue
        } else if (result.kind === 'completion' && store.getters.profileById(result.profileId)) {
          onCompleted({
            tab: result.feedType,
            profileId: result.profileId,
            timestamp: Number(result.timestamp) || Date.now()
          })
        } else if (
          result.kind === 'failure' &&
          result.diagnostic &&
          store.getters.profileById(result.profileId)
        ) {
          const diagnostic = formatRequestDiagnostic(result.diagnostic)
          onFailure(diagnostic)
        }

        await acknowledgeAndroidSubscriptionRefreshResult(result.id)
      }
    } catch (error) {
      console.error('Failed to reconcile closed-app subscription refresh data', error)
    }
  }

  async function reconcileAndroidSubscriptionRefreshChannelResult(result) {
    if (
      typeof result.channelId !== 'string' ||
      !store.getters.getSubscribedChannelIdSet.has(result.channelId)
    ) {
      return
    }

    const feedType = result.feedType
    const timestamp = new Date(Number(result.timestamp) || Date.now())
    const config = getAndroidSubscriptionCacheConfig(feedType)
    const previousCache = config.getCache()[result.channelId]
    if (previousCache?.timestamp > timestamp) return
    let entries = result.payload?.backgroundFormat === 'entries'
      ? result.payload.entries
      : result.payload?.backgroundFormat === 'rss'
        ? (() => {
            try { return parseSubscriptionRss(result.payload.text, result.channelId).videos } catch (error) {
              throw new AndroidSubscriptionRefreshPayloadError(error)
            }
          })()
        : normalizeAndroidSubscriptionRefreshPayload(
            result.payload?.backgroundFormat?.startsWith('local')
              ? (type, payload, id) => normalizeLocalSubscriptionFeed(type, payload, id, timestamp.getTime())
              : normalizeInvidiousSubscriptionFeed,
            feedType,
            result.payload,
            result.channelId
          )
    if (!Array.isArray(entries)) throw new AndroidSubscriptionRefreshPayloadError(new Error('Invalid saved entries'))
    entries = entries.filter(entry => !shouldHideMembersOnlyContent(entry.isMembersOnly, store.getters))
    if (feedType !== 'posts') {
      const channel = store.getters.getSubscribedChannelsById.get(result.channelId)
      const cachedThumbnails = new Map((previousCache?.videos ?? []).map(video => [video.videoId, video.thumbnailUrl]))
      for (const entry of entries) {
        if (!entry.author || entry.author === 'N/A') entry.author = channel?.name
        if (!entry.authorId || entry.authorId === 'N/A') entry.authorId = result.channelId
        if (feedType === 'shorts') {
          entry.isShort = true
          // RSS has no selected portrait image; keep the last known Shorts thumbnail.
          entry.thumbnailUrl ||= cachedThumbnails.get(entry.videoId)
        }
      }
    }
    if (feedType === 'shorts') entries = await enrichSubscriptionShortDates(entries, result.channelId)
    entries = await enrichSubscriptionRssEntries(entries)
    const reconciledEntries = reconcileFetchedSubscriptionEntries(
      entries,
      previousCache?.[config.entriesKey],
      config.idKey,
      previousCache?.timestamp,
      feedType === 'posts' ? undefined : store.getters.getHistoryCacheById
    )

    const applied = await store.dispatch(config.action, {
      channelId: result.channelId,
      [config.entriesKey]: reconciledEntries,
      timestamp
    })
    if (applied === false) return

    const committedTimestamp = config.getCache()[result.channelId]?.timestamp
    if (!(committedTimestamp instanceof Date) || committedTimestamp.getTime() < timestamp.getTime()) {
      throw new Error(`The ${feedType} cache write did not complete`)
    }
  }

  function getAndroidSubscriptionCacheConfig(feedType) {
    switch (feedType) {
      case 'shorts':
        return {
          action: 'updateSubscriptionShortsCacheByChannel',
          entriesKey: 'videos',
          idKey: 'videoId',
          getCache: () => store.getters.getShortsCache
        }
      case 'live':
        return {
          action: 'updateSubscriptionLiveCacheByChannel',
          entriesKey: 'videos',
          idKey: 'videoId',
          getCache: () => store.getters.getLiveCache
        }
      case 'posts':
        return {
          action: 'updateSubscriptionPostsCacheByChannel',
          entriesKey: 'posts',
          idKey: 'postId',
          getCache: () => store.getters.getPostsCache
        }
      default:
        return {
          action: 'updateSubscriptionVideosCacheByChannel',
          entriesKey: 'videos',
          idKey: 'videoId',
          getCache: () => store.getters.getVideoCache
        }
    }
  }

  return { reconcileResults: reconcileAndroidSubscriptionRefreshResults, reconcileChannelResult: reconcileAndroidSubscriptionRefreshChannelResult }
}
