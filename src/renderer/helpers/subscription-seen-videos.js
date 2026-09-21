import { computed, isReactive } from 'vue'
import { parseSubscriptionSeenVideos, mergeSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'
import { isHistoryEntryWatched } from '../../history.js'
import { parseSubscriptionSeenPosts, mergeSubscriptionSeenPosts } from '../../subscriptionSeenPosts.js'

const cacheSelectors = new WeakMap()

export function applySubscriptionSeenVideosToCache(cache, seenVideos) {
  return applySubscriptionSeenEntriesToCache(cache, seenVideos, 'videos', 'videoId', mergeSubscriptionSeenVideos)
}

export function applySubscriptionSeenPostsToCache(cache, seenPosts) {
  return applySubscriptionSeenEntriesToCache(cache, seenPosts, 'posts', 'postId', mergeSubscriptionSeenPosts)
}

function applySubscriptionSeenEntriesToCache(cache, seenEntries, entriesKey, idKey, merge) {
  const indexSeenEntries = () => new Map(merge([], seenEntries).map(entry => [entry[idKey], entry]))
  // Plain mutable inputs cannot invalidate computed results. Keep those calls
  // uncached, as with the feed's entry snapshots.
  const canCache = isReactive(cache) && (typeof seenEntries === 'string' || isReactive(seenEntries))
  let selectors
  if (canCache) {
    selectors = cacheSelectors.get(cache)
    if (!selectors || selectors.seenEntries !== seenEntries || selectors.entriesKey !== entriesKey) {
      selectors = { seenEntries, entriesKey, index: computed(indexSeenEntries), channels: new WeakMap() }
      cacheSelectors.set(cache, selectors)
    }
  }
  const byId = selectors ? selectors.index.value : indexSeenEntries()
  if (byId.size === 0) return cache

  return Object.fromEntries(Object.entries(cache).map(([channelId, cached]) => {
    if (!cached?.[entriesKey]) return [channelId, cached]
    if (!selectors || !isReactive(cached)) return [channelId, applySeenEntriesToChannel(cached, byId, entriesKey, idKey)]
    let channel = selectors.channels.get(cached)
    if (!channel) {
      channel = computed(() => applySeenEntriesToChannel(cached, selectors.index.value, entriesKey, idKey))
      selectors.channels.set(cached, channel)
    }
    return [channelId, channel.value]
  }))
}

function applySeenEntriesToChannel(cached, byId, entriesKey, idKey) {
  const entries = cached[entriesKey].map(video => {
    const seen = byId.get(video[idKey])
    if (!seen) return video
    if (seen.unseenAt >= seen.seenAt) {
      return video.isNewInSubscriptionFeed ? video : { ...video, isNewInSubscriptionFeed: true }
    }
    // A members-only upload becoming public is new content again.
    if (!video.isNewInSubscriptionFeed ||
        (seen.isMembersOnly && video.isMembersOnly === false)) return video
    return { ...video, isNewInSubscriptionFeed: false }
  })
  return entries.every((video, index) => video === cached[entriesKey][index])
    ? cached
    : { ...cached, [entriesKey]: entries }
}

export async function syncSubscriptionSeenVideos(client, store) {
  const remote = await client.getSeenVideos()
  await store.dispatch('mergeSubscriptionSeenVideos', remote)
  const merged = parseSubscriptionSeenVideos(store.state.settings.subscriptionSeenVideos)
  const unseenById = new Map(merged.filter(entry => entry.unseenAt >= entry.seenAt)
    .map(entry => [entry.videoId, entry.unseenAt]))
  if (unseenById.size > 0) {
    // History sync runs first. An older completed record must not undo the
    // reverse action, while watching again after it still counts as watched.
    for (const history of store.state.history.historyCacheSorted) {
      if (isHistoryEntryWatched(history) &&
          unseenById.get(history.videoId) > (history.timeWatched ?? 0)) {
        await store.dispatch('updateHistory', { ...history, isWatched: false })
      }
    }
    for (const history of await client.getWatchHistory() ?? []) {
      if (history.metadata.watched_state === 'completed' &&
          unseenById.get(history.video.id) > (history.metadata.added_date ?? 0)) {
        await client.putWatchHistory({
          ...history,
          metadata: {
            ...history.metadata,
            watched_state: history.metadata.position_millis > 0 ? 'watching' : 'planned'
          }
        })
      }
    }
  }
  await client.putSeenVideos(merged)
  return merged.length
}

export async function syncSubscriptionSeenPosts(client, store) {
  const remote = await client.getSeenPosts()
  await store.dispatch('mergeSubscriptionSeenPosts', remote)
  const merged = parseSubscriptionSeenPosts(store.state.settings.subscriptionSeenPosts)
  await client.putSeenPosts(merged)
  return merged.length
}
