import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import store from '../store/index'
import { DBLibraryHandlers } from '../../datastores/handlers/index'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../helpers/restricted-playback'
import { getSubscriptionsForFeed, MAX_INCREMENTAL_SUBSCRIPTION_CHANNELS, MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES } from '../helpers/subscription-channels'
import { useTabContext } from '../tabs/TabContext'

// IPC returns fresh objects. Reuse unchanged visible entries so channel refreshes
// do not reparse every card; compare all fields, including legacy Date values.
function equalEntryValue(left, right) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime())
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && left.length !== right.length) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalEntryValue(left[key], right[key]))
}

function retainPageEntries(previous, next) {
  const byId = new Map()
  const key = entry => JSON.stringify([entry.type, entry.videoId, entry.postId, entry.authorId])
  for (const entry of previous) {
    const id = key(entry)
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push(entry)
  }
  const retained = next.map(entry => {
    const old = byId.get(key(entry))?.shift()
    return equalEntryValue(old, entry) ? old : entry
  })
  return previous.length === retained.length && retained.every((entry, index) => entry === previous[index]) ? previous : retained
}

export function useSubscriptionPage(category, onlyNew = () => false, enabled = () => true, limit = () => 100, initialExtent = limit) {
  const { isTabPresented } = useTabContext()
  const records = shallowRef([])
  const cursor = ref(null)
  const total = ref(0)
  const hasNew = ref(false)
  const categoryCounts = shallowRef({})
  const busy = ref(false)
  const nextPremiereTimestamp = ref(null)
  let generation = 0
  let timer = null
  let channelTimer = null
  let premiereTimer = null
  let active = true
  let dirty = true
  let initialized = false
  let expiresAt = 0
  const presented = () => active && isTabPresented?.value !== false
  const options = computed(() => ({
    subscriptions: store.getters.getActiveProfile.subscriptions,
    category: category(),
    onlyNew: onlyNew(),
    limit: limit(),
    enabledCategories: [
      !store.getters.getHideSubscriptionsVideos && 'videos',
      !store.getters.getHideSubscriptionsShorts && 'shorts',
      !store.getters.getHideLiveStreams && !store.getters.getHideSubscriptionsLive && 'live',
      !store.getters.getHideSubscriptionsCommunity && !store.getters.getUseRssFeeds && 'posts'
    ].filter(Boolean),
    preferences: {
      hideLiveStreams: store.getters.getHideLiveStreams,
      hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
      forbiddenTitles: store.getters.getActiveForbiddenTitles,
      hideWatched: store.getters.getHideWatchedSubs,
      onlyShowLatestFromChannel: store.getters.getOnlyShowLatestFromChannel,
      onlyShowLatestFromChannelNumber: store.getters.getOnlyShowLatestFromChannelNumber,
      restrictedPlaybackConfigured: hasConfiguredRestrictedPlaybackAuthentication(store.getters),
      showScheduledLiveStreamsFirst: store.getters.getShowScheduledLiveStreamsFirst,
      sortBy: store.getters.getNewSubscriptionFeedSortBy === 'oldest' ? 'oldest' : 'newest'
    }
  }))
  async function load(append = false, extent = null) {
    if (!process.env.IS_ELECTRON || !active || !enabled() || (initialized && !presented()) || !store.getters.getSubscriptionCacheReady) return
    const current = ++generation
    busy.value = true
    try {
      const desired = extent ?? (append ? records.value.length + limit() : Math.max(records.value.length, initialExtent()))
      const next = append ? [...records.value] : []
      let nextCursor = append ? cursor.value : null
      let restarts = 0
      let page
      while (true) {
        page = await DBLibraryHandlers.query('subscriptionPage', { ...options.value, limit: Math.min(250, Math.max(1, desired - next.length)), now: Date.now(), cursor: nextCursor })
        if (current !== generation || !active || (initialized && !presented())) return
        if (page.stale) {
          dirty = true
          // A changing revision can invalidate every attempt. Keep the last
          // complete page and retry on a later update or presentation instead
          // of repeatedly restarting IPC work while the feed is changing.
          if (++restarts > 2) return
          next.length = 0
          nextCursor = null
          continue
        }
        next.push(...page.records)
        nextCursor = page.cursor
        if (page.records.length === 0 || !nextCursor || next.length >= desired) break
      }
      records.value = retainPageEntries(records.value, next)
      cursor.value = page.cursor
      total.value = page.total
      hasNew.value = page.hasNew
      categoryCounts.value = page.categoryCounts ?? {}
      nextPremiereTimestamp.value = page.nextPremiereTimestamp
      dirty = false
      initialized = true
      expiresAt = Math.min(Date.now() + 60_000, page.nextPremiereTimestamp ?? Infinity)
      clearTimeout(premiereTimer)
      if (presented() && page.nextPremiereTimestamp !== null) premiereTimer = setTimeout(() => load().catch(console.error), Math.min(2 ** 31 - 1, Math.max(0, page.nextPremiereTimestamp - Date.now())))
    } finally { if (current === generation) busy.value = false }
  }
  if (process.env.IS_ELECTRON) {
    const schedule = () => {
      clearTimeout(channelTimer)
      channelTimer = null
      ++generation
      dirty = true
      clearTimeout(timer)
      if (!active || !enabled() || (initialized && !presented())) { busy.value = false; return }
      if (!initialized) {
        busy.value = true
        load().catch(console.error)
      } else timer = setTimeout(() => load().catch(console.error), 100)
    }
    watch([options, enabled, () => store.getters.getSubscriptionCacheReady, () => store.state.history.historyRevision, () => store.getters.getSubscriptionSeenVideos, () => store.getters.getSubscriptionSeenPosts], schedule, { immediate: true })
    let deferChannelUpdates = false
    watch([() => store.getters.getSubscriptionFeedRefreshInProgress, () => store.getters.getSubscriptionFeedRefreshTab], ([refreshing], previous) => {
      const caches = { videos: store.state.subscriptionCache.videoCache, shorts: store.state.subscriptionCache.shortsCache, live: store.state.subscriptionCache.liveCache, posts: store.state.subscriptionCache.postsCache }
      const categories = onlyNew() ? options.value.enabledCategories : [category()]
      const count = categories.reduce((count, tab) => count + options.value.subscriptions.reduce((sum, channel) => sum + (caches[tab]?.[channel.id]?.count ?? 0), 0), 0)
      // Match the existing feed's large-profile policy, including a first
      // refresh whose initially empty cache cannot indicate the coming work.
      deferChannelUpdates = refreshing && (count > MAX_INCREMENTAL_SUBSCRIPTION_FEED_ENTRIES ||
        categories.some(tab => getSubscriptionsForFeed(options.value.subscriptions, tab).length > MAX_INCREMENTAL_SUBSCRIPTION_CHANNELS))
      if (previous.length > 0) {
        if (deferChannelUpdates && initialized) {
          // Cancel pending and in-flight page publication before an early
          // channel response can replace the last completed large feed.
          ++generation
          clearTimeout(timer)
          clearTimeout(channelTimer)
          channelTimer = null
          busy.value = false
          dirty = true
        } else schedule()
      }
    }, { immediate: true })
    watch(() => store.state.subscriptionCache.subscriptionVideosFeedVersion, () => {
      // Local filtering and seen/watch edits above remain responsive while
      // large network refreshes publish once per completed feed.
      if (deferChannelUpdates) return
      if (!store.getters.getSubscriptionFeedRefreshInProgress) { schedule(); return }
      dirty = true
      if (!active || !enabled() || (initialized && !presented()) || channelTimer !== null) return
      // Publish during network refreshes, but coalesce channel responses rather
      // than making visible cards compete with every response for renderer time.
      channelTimer = setTimeout(schedule, 1000)
    })
    const suspend = () => {
      if (channelTimer !== null) dirty = true
      clearTimeout(channelTimer)
      channelTimer = null
      clearTimeout(timer)
      clearTimeout(premiereTimer)
      if (busy.value) { ++generation; busy.value = false; dirty = true }
    }
    const resume = () => {
      if (!busy.value && (dirty || Date.now() >= expiresAt)) load().catch(console.error)
      else if (nextPremiereTimestamp.value !== null && presented()) {
        clearTimeout(premiereTimer)
        premiereTimer = setTimeout(() => load().catch(console.error), Math.min(2 ** 31 - 1, Math.max(0, nextPremiereTimestamp.value - Date.now())))
      }
    }
    if (isTabPresented) watch(isTabPresented, () => { if (presented()) resume(); else suspend() })
    onActivated(() => { active = true; if (presented()) resume() })
    onDeactivated(() => { active = false; suspend() })
  }
  onBeforeUnmount(() => { ++generation; clearTimeout(channelTimer); clearTimeout(timer); clearTimeout(premiereTimer) })
  return { records, cursor, total, hasNew, categoryCounts, busy, nextPremiereTimestamp, load: () => load(false), more: () => load(true) }
}
