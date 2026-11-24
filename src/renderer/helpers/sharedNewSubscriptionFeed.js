import { computed, shallowRef, toRaw } from 'vue'

import store from '../store/index'
import {
  buildNewSubscriptionFeed,
  getEnabledSubscriptionFeedSources,
  getNewSubscriptionEntryTimestamp,
} from './newSubscriptionFeed'
import { hasConfiguredRestrictedPlaybackAuthentication } from './restricted-playback'
import { keepComputedLinked } from './keepComputedLinked'

// Home and the Subscriptions page remount on every navigation. Building the
// New feed scans the whole subscription cache, so these computeds outlive the
// pages and rebuild only when the cache, settings, profile, group, history or
// seen marks change. They stay linked to their sources between mounts, see
// keepComputedLinked.

/** Invalidates the feeds once a premiere or scheduled stream in them starts. */
const clock = shallowRef(0)
let stableUntil = Infinity

/**
 * The settings that decide the New feed, apart from the enabled feeds.
 * @param {unknown} activeSubscriptions
 */
export function getNewSubscriptionFeedOptions(activeSubscriptions) {
  const getters = store.getters
  return {
    activeSubscriptions,
    historyCacheById: getters.getHistoryCacheById,
    hideLiveStreams: getters.getHideLiveStreams,
    hideUpcomingPremieres: getters.getHideUpcomingPremieres,
    forbiddenTitles: getters.getForbiddenTitlesToRemove,
    onlyShowLatestFromChannel: getters.getOnlyShowLatestFromChannel,
    onlyShowLatestFromChannelNumber: getters.getOnlyShowLatestFromChannelNumber,
    restrictedPlaybackConfigured: hasConfiguredRestrictedPlaybackAuthentication(getters),
    showScheduledLiveStreamsFirst: getters.getShowScheduledLiveStreamsFirst,
    sortBy: getters.getNewSubscriptionFeedSortBy === 'oldest' ? 'oldest' : 'newest',
  }
}

/** @param {() => unknown} getSubscriptions */
function createFeed(getSubscriptions) {
  let feedStableUntil = Infinity
  const feed = computed(() => {
    // eslint-disable-next-line no-unused-expressions
    clock.value
    const result = buildNewSubscriptionFeed({
      feeds: getEnabledSubscriptionFeedSources(store.getters),
      ...getNewSubscriptionFeedOptions(getSubscriptions()),
    })
    feedStableUntil = result.stableUntil
    stableUntil = Math.min(stableUntil, feedStableUntil)
    return result.content
  })
  return { feed, stableUntil: () => feedStableUntil }
}

const profile = createFeed(() => store.getters.getActiveProfile.subscriptions)
const group = createFeed(() => store.getters.getActiveGroupSubscriptions)

// Without an active group, the Subscriptions page lists the same channels as Home.
const groupFeed = computed(() => (
  store.getters.getActiveSubscriptionGroup == null ? profile.feed.value : group.feed.value
))

/**
 * Pages read the feed when they mount. A page that stays mounted keeps the
 * clock it mounted with, as it did when each page built its own feed.
 */
function expireStartedEntries() {
  const now = Date.now()
  if (now < stableUntil) return
  stableUntil = Math.min(profile.stableUntil(), group.stableUntil())
  if (now >= stableUntil) {
    stableUntil = Infinity
    clock.value++
  }
}

/** Every New entry of the active profile, newest first, for Home's shelf. */
const homeEntries = computed(() => {
  const showScheduledLiveStreamsFirst = store.getters.getShowScheduledLiveStreamsFirst
  const now = Date.now()
  return Object.entries(profile.feed.value)
    .flatMap(([category, entries]) => entries.map(entry => ({
      category,
      entry,
      timestamp: getNewSubscriptionEntryTimestamp(entry, showScheduledLiveStreamsFirst, now)
    })))
    .toSorted((a, b) => b.timestamp - a.timestamp)
})

// The Subscriptions page paginates raw entries and makes only rendered cards
// reactive. The builder already tracked the fields used for selection and order.
const subscriptionsPageContent = computed(() => {
  const { videos, shorts, live, posts } = groupFeed.value
  return {
    videos: videos.map(toRaw),
    shorts: shorts.map(toRaw),
    live: live.map(toRaw),
    posts: posts.map(toRaw),
  }
})

/** Home's New shelf entries, across categories and newest first. */
export function useHomeNewSubscriptionEntries() {
  expireStartedEntries()
  keepComputedLinked(homeEntries)
  return homeEntries
}

/** The New feed of the active subscription group, with raw entries. */
export function useSubscriptionsNewFeedContent() {
  expireStartedEntries()
  keepComputedLinked(subscriptionsPageContent)
  return subscriptionsPageContent
}
