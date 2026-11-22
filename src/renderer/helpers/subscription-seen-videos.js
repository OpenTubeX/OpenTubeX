import { computed, isReactive, shallowRef } from 'vue'
import { parseSubscriptionSeenVideos, mergeSubscriptionSeenVideos } from '../../subscriptionSeenVideos.js'
import { isHistoryEntryWatched } from '../../history.js'
import { parseSubscriptionSeenPosts, mergeSubscriptionSeenPosts } from '../../subscriptionSeenPosts.js'
import { feedEntryInScope } from '../../subscriptionFeedState.js'

const cacheSelectors = new WeakMap()

/**
 * The cached feeds as a data scope shows them, with its seen marks.
 * @param {Record<string, any>} cache
 * @param {unknown} seenVideos
 * @param {string | null} [scope] A separate profile's ID, or null for the shared data
 */
export function applySubscriptionSeenVideosToCache(cache, seenVideos, scope = null) {
  return applySubscriptionSeenEntriesToCache(cache, seenVideos, 'videos', 'videoId', mergeSubscriptionSeenVideos, scope)
}

/**
 * @param {Record<string, any>} cache
 * @param {unknown} seenPosts
 * @param {string | null} [scope] see {@link applySubscriptionSeenVideosToCache}
 */
export function applySubscriptionSeenPostsToCache(cache, seenPosts, scope = null) {
  return applySubscriptionSeenEntriesToCache(cache, seenPosts, 'posts', 'postId', mergeSubscriptionSeenPosts, scope)
}

function applySubscriptionSeenEntriesToCache(cache, seenEntries, entriesKey, idKey, merge, scope) {
  const indexSeenEntries = () => new Map(merge([], seenEntries).map(entry => [entry[idKey], entry]))
  // Plain mutable inputs cannot invalidate computed results. Keep those calls
  // uncached, as with the feed's entry snapshots.
  const canCache = isReactive(cache) && (typeof seenEntries === 'string' || isReactive(seenEntries))
  let selectors
  if (canCache) {
    selectors = cacheSelectors.get(cache)
    if (!selectors || selectors.entriesKey !== entriesKey || selectors.scope !== scope) {
      const source = shallowRef(seenEntries)
      selectors = {
        source,
        entriesKey,
        scope,
        index: computed(() => new Map(merge([], source.value).map(entry => [entry[idKey], entry]))),
        channels: new WeakMap()
      }
      cacheSelectors.set(cache, selectors)
    }
    selectors.source.value = seenEntries
  }
  const byId = selectors ? selectors.index.value : indexSeenEntries()
  // A separate profile's feeds show its own state even without marks.
  if (byId.size === 0 && scope === null) return cache

  if (selectors) {
    if (!selectors.view) {
      selectors.view = new Proxy(cache, {
        get(target, channelId) {
          const cached = Reflect.get(target, channelId)
          if (!cached?.[entriesKey]) return cached
          if (!isReactive(cached)) return applySeenEntriesToChannel(cached, selectors.index.value, entriesKey, idKey, undefined, scope)
          let channel = selectors.channels.get(cached)
          if (!channel) {
            // Retain each channel's ID list and effective marks across edits to
            // the shared seen list. Opening one video must not reprocess every
            // cached video or recreate unchanged channel objects.
            const ids = computed(() => cached[entriesKey].map(entry => entry[idKey]))
            const marks = computed(previous => {
              const index = selectors.index.value
              const relevant = new Map()
              for (const id of ids.value) {
                const seen = index.get(id)
                if (seen) relevant.set(id, seen)
              }
              if (previous?.size === relevant.size && [...relevant].every(([id, seen]) => {
                const old = previous.get(id)
                return old && old.seenAt === seen.seenAt && old.unseenAt === seen.unseenAt &&
                  old.isMembersOnly === seen.isMembersOnly
              })) return previous
              return relevant
            })
            channel = computed(() => applySeenEntriesToChannel(cached, marks.value, entriesKey, idKey, ids.value, scope))
            selectors.channels.set(cached, channel)
          }
          return channel.value
        }
      })
    }
    return selectors.view
  }

  return Object.fromEntries(Object.entries(cache).map(([channelId, cached]) => {
    if (!cached?.[entriesKey]) return [channelId, cached]
    return [channelId, applySeenEntriesToChannel(cached, byId, entriesKey, idKey, undefined, scope)]
  }))
}

function applySeenEntriesToChannel(cached, byId, entriesKey, idKey, ids, scope = null) {
  if (byId.size === 0 && scope === null) return cached
  const entries = cached[entriesKey].map((cachedVideo, index) => {
    const video = feedEntryInScope(cachedVideo, scope)
    const seen = byId.get(ids ? ids[index] : video[idKey])
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

// Merges the marks of the data scope the store shows, whose history the
// videos marked unseen leave.
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
