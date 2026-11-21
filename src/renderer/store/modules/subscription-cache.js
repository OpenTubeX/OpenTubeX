import {
  DBProfileHandlers,
  DBSubscriptionCacheHandlers,
} from '../../../datastores/handlers/index'
import { MAIN_PROFILE_ID } from '../../../constants'
import { toRaw } from 'vue'
import { ensureSubscriptionFeedEntryState, ensureUpcomingSubscriptionFeedPublished, getUpcomingPremiereTimestamp, keepCachedSubscriptionCollaborations } from '../../helpers/subscription-entries'
import { applySubscriptionSeenVideosToCache, applySubscriptionSeenPostsToCache } from '../../helpers/subscription-seen-videos'
import { keepStoredSubscriptionCollaborations, preserveSubscriptionSeenEntries } from '../../../subscriptionFeedState'
import { getSubscriptionsForFeed } from '../../helpers/subscription-channels'
import { updateVideoListAfterProcessing } from '../../helpers/subscriptions'
import { forgetAndroidSubscriptionRefreshFingerprints } from '../../helpers/androidSubscriptionRefresh'
import { mergeSubscriptionCollaborations } from '../../helpers/subscriptionCollaborationChecks'

/**
 * Electron datastore payloads are converted to plain JSON before crossing IPC,
 * which serializes dates as ISO strings.
 * @param {Date | number | string} timestamp
 * @returns {Date}
 */
function toDate(timestamp) {
  return timestamp instanceof Date ? timestamp : new Date(timestamp)
}

const state = {
  videoCache: {},
  liveCache: {},
  shortsCache: {},
  postsCache: {},
  subscriptionVideosFeedVersion: 0,

  subscriptionCacheReady: false,
  subscriptionCacheLoadFailed: false,
  subscriptionFeedRefreshInProgress: false,
  subscriptionFeedRefreshTab: null,
  subscriptionFeedRefreshProgress: 0,
  subscriptionFeedLastRefreshTimestamp: null,
  subscriptionFeedNextAutoRefreshTimestamp: null,
  subscriptionShortsLastRefreshTimestamp: null,
  subscriptionShortsNextAutoRefreshTimestamp: null,
  subscriptionLiveLastRefreshTimestamp: null,
  subscriptionLiveNextAutoRefreshTimestamp: null,
  subscriptionPostsLastRefreshTimestamp: null,
  subscriptionPostsNextAutoRefreshTimestamp: null,
}

const getters = {
  getSubscriptionCacheReady: (state) => state.subscriptionCacheReady,
  getSubscriptionCacheLoadFailed: (state) => state.subscriptionCacheLoadFailed,
  getSubscriptionFeedRefreshInProgress: (state) => state.subscriptionFeedRefreshInProgress,
  getSubscriptionFeedRefreshTab: (state) => state.subscriptionFeedRefreshTab,
  getSubscriptionFeedRefreshProgress: (state) => state.subscriptionFeedRefreshProgress,
  getSubscriptionFeedLastRefreshTimestamp: (state) => state.subscriptionFeedLastRefreshTimestamp,
  getSubscriptionFeedNextAutoRefreshTimestamp: (state) => state.subscriptionFeedNextAutoRefreshTimestamp,
  getSubscriptionShortsLastRefreshTimestamp: (state) => state.subscriptionShortsLastRefreshTimestamp,
  getSubscriptionShortsNextAutoRefreshTimestamp: (state) => state.subscriptionShortsNextAutoRefreshTimestamp,
  getSubscriptionLiveLastRefreshTimestamp: (state) => state.subscriptionLiveLastRefreshTimestamp,
  getSubscriptionLiveNextAutoRefreshTimestamp: (state) => state.subscriptionLiveNextAutoRefreshTimestamp,
  getSubscriptionPostsLastRefreshTimestamp: (state) => state.subscriptionPostsLastRefreshTimestamp,
  getSubscriptionPostsNextAutoRefreshTimestamp: (state) => state.subscriptionPostsNextAutoRefreshTimestamp,

  getVideoCache: (state, getters) => applySubscriptionSeenVideosToCache(state.videoCache, getters.getSubscriptionSeenVideos),

  getShortsCache: (state, getters) => applySubscriptionSeenVideosToCache(state.shortsCache, getters.getSubscriptionSeenVideos),

  getLiveCache: (state, getters) => applySubscriptionSeenVideosToCache(state.liveCache, getters.getSubscriptionSeenVideos),

  getPostsCache: (state, getters) => applySubscriptionSeenPostsToCache(state.postsCache, getters.getSubscriptionSeenPosts),

  // Retain merged, sorted videos across route mounts and logical tabs. The
  // Destructuring the version tracks explicit clock invalidation, while
  // processing always uses the current clock, including backward corrections.
  getSubscriptionVideosFeed: ({ subscriptionVideosFeedVersion }, getters) => {
    const now = Date.now()
    let nextPremiereTimestamp = null
    const cache = getters.getVideoCache
    const includeCollaborations = getters.getIncludeSubscriptionCollaborations === true
    const channels = getSubscriptionsForFeed(getters.getActiveGroupSubscriptions, 'videos')
    // Collaborations can also be cached as uploads or collaborations of other channels
    const videoIds = new Set()
    if (includeCollaborations) {
      for (const channel of channels) {
        for (const video of toRaw(cache[channel.id]?.videos) ?? []) {
          if (video.isCollaboration !== true) videoIds.add(video.videoId)
        }
      }
    }
    const videos = channels.flatMap(channel => {
      const entry = cache[channel.id]
      if (entry == null) return []
      const entries = entry.videos ?? []
      const timestamp = toDate(entry.timestamp).getTime()
      return toRaw(entries).flatMap((video, index) => {
        if (video.isCollaboration === true) {
          if (!includeCollaborations || videoIds.has(video.videoId)) return []
          videoIds.add(video.videoId)
        }
        const premiereTimestamp = getUpcomingPremiereTimestamp(video)
        if (premiereTimestamp > now && (nextPremiereTimestamp === null || premiereTimestamp < nextPremiereTimestamp)) {
          nextPremiereTimestamp = premiereTimestamp
        }
        // Premiere processing copies entries. Track those source fields so
        // in-place edits (including seen marks) invalidate the copied result.
        const source = premiereTimestamp > 0 || video.isUpcoming === true || video.premiere === true
          ? entries[index]
          : video
        return [ensureUpcomingSubscriptionFeedPublished(source, timestamp, now)]
      })
    })
    return { videos: updateVideoListAfterProcessing(videos, now), nextPremiereTimestamp, processedAt: now }
  },
}

/**
 * The channels of the stored main profile and separate profiles, or `null`
 * if they can't be read.
 * @returns {Promise<string[] | null>}
 */
async function getStoredSubscribedChannelIds() {
  try {
    const profiles = await DBProfileHandlers.find()
    if (!Array.isArray(profiles)) return null
    const mainProfile = profiles.find(profile => profile._id === MAIN_PROFILE_ID)
    if (!Array.isArray(mainProfile?.subscriptions)) return null
    return profiles
      .filter(profile => profile === mainProfile || (profile.separate === true && Array.isArray(profile.subscriptions)))
      .flatMap(profile => profile.subscriptions.map(channel => channel.id))
  } catch (error) {
    console.error(error)
    return null
  }
}

// Video cache writes of a channel run one after another, each on the entries
// the previous one stored, so that an uploads write cannot drop the
// collaborations that a check stored while it was on its way.
const videoCacheWrites = new Map()

/**
 * @template T
 * @param {string} channelId
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 */
function queueVideoCacheWrite(channelId, write) {
  const pending = videoCacheWrites.get(channelId)
  const queued = pending ? pending.then(write, write) : write()
  videoCacheWrites.set(channelId, queued)
  queued.catch(() => {}).finally(() => {
    if (videoCacheWrites.get(channelId) === queued) videoCacheWrites.delete(channelId)
  })
  return queued
}

async function writeVideoCache({ commit, state, rootGetters }, { channelId, videos, collaborationsFetched = false, collaborationsCheckedAt, timestamp = new Date() }) {
  const previousCache = state.videoCache[channelId]
  const include = rootGetters.getIncludeSubscriptionCollaborations === true
  videos = ensureSubscriptionFeedEntryState(
    keepCachedSubscriptionCollaborations(videos, previousCache?.videos, { include, fetched: collaborationsFetched }),
    previousCache?.videos,
    'videoId',
    previousCache?.timestamp,
    rootGetters.getHistoryCacheById
  )
  // Without the setting the collaborations are dropped, so turning it on
  // again checks the channel soon. A write without a check time keeps the
  // stored collaborations instead.
  if (!include) collaborationsCheckedAt = null

  try {
    if (await DBSubscriptionCacheHandlers.updateVideosByChannelId(channelId, videos, timestamp, collaborationsCheckedAt) === false) return false
    // Including those another window stored meanwhile, as the datastore did
    if (collaborationsCheckedAt === undefined) videos = keepStoredSubscriptionCollaborations(videos, state.videoCache[channelId]?.videos)
    commit('updateVideoCacheByChannel', { channelId, entries: videos, timestamp, collaborationsCheckedAt })
  } catch (errMessage) {
    console.error(errMessage)
  }
}

const actions = {
  async grabAllSubscriptions({ commit, dispatch, state, rootState, rootGetters }) {
    try {
      const payload = await DBSubscriptionCacheHandlers.find()

      const videos = {}
      const liveStreams = {}
      const shorts = {}
      const communityPosts = {}

      const toBeRemovedChannelIds = []
      // Separate profiles' feeds stay cached while another profile is active.
      let subscribedChannelIdSet = new Set(rootGetters.getAllRootSubscriptions.map(channel => channel.id))
      // Without loaded profiles every channel looks unsubscribed, so keep the data.
      let canRemoveUnsubscribed = rootState.profiles.profilesLoaded
      if (canRemoveUnsubscribed && payload.some(entry => !subscribedChannelIdSet.has(entry._id))) {
        // Another window may have changed the subscriptions and cached a feed
        // before this window received the profile change. The cache read above
        // came after that change was saved, so the stored profile has it.
        const storedChannelIds = await getStoredSubscribedChannelIds()
        if (storedChannelIds === null) {
          canRemoveUnsubscribed = false
        } else {
          subscribedChannelIdSet = new Set(storedChannelIds)
        }
      }
      const withFeedState = entries => entries.map(entry => ({
        ...entry,
        isNewInSubscriptionFeed: entry.isNewInSubscriptionFeed === true
      }))

      for (const dataEntry of payload) {
        const channelId = dataEntry._id
        if (!subscribedChannelIdSet.has(channelId)) {
          // Clean up cache data for unsubscribed channels
          if (canRemoveUnsubscribed) toBeRemovedChannelIds.push(channelId)
          // No need to load data for unsubscribed channels
          continue
        }

        let hasData = false

        if (Array.isArray(dataEntry.videos)) {
          videos[channelId] = {
            videos: withFeedState(dataEntry.videos),
            timestamp: toDate(dataEntry.videosTimestamp),
            ...(typeof dataEntry.collaborationsCheckedAt === 'number' ? { collaborationsCheckedAt: dataEntry.collaborationsCheckedAt } : {})
          }
          hasData = true
        }
        if (Array.isArray(dataEntry.liveStreams)) {
          liveStreams[channelId] = { videos: withFeedState(dataEntry.liveStreams), timestamp: toDate(dataEntry.liveStreamsTimestamp) }
          hasData = true
        }
        if (Array.isArray(dataEntry.shorts)) {
          shorts[channelId] = { videos: withFeedState(dataEntry.shorts), timestamp: toDate(dataEntry.shortsTimestamp) }
          hasData = true
        }
        if (Array.isArray(dataEntry.communityPosts)) {
          communityPosts[channelId] = { posts: dataEntry.communityPosts, timestamp: toDate(dataEntry.communityPostsTimestamp) }
          hasData = true
        }

        if (!hasData) { toBeRemovedChannelIds.push(channelId) }
      }

      if (toBeRemovedChannelIds.length > 0) {
        // Delete channels with no data
        dispatch('clearSubscriptionsCacheForManyChannels', toBeRemovedChannelIds)
      }
      commit('setCaches', { videos, liveStreams, shorts, communityPosts })
      commit('setSubscriptionCacheReady', true)
      commit('setSubscriptionCacheLoadFailed', false)
    } catch (errMessage) {
      console.error(errMessage)
      // A failed reload keeps the loaded cache. Without one, the feeds offer a retry.
      if (!state.subscriptionCacheReady) commit('setSubscriptionCacheLoadFailed', true)
    }
  },

  updateSubscriptionVideosCacheByChannel(context, payload) {
    return queueVideoCacheWrite(payload.channelId, () => writeVideoCache(context, payload))
  },

  /**
   * Stores the collaborations a check of the channel's Home tab found with
   * the channel's uploads cached now, and when the check happened.
   * @returns {Promise<object[] | null>} the stored entries, or null when
   * nothing was stored
   */
  updateSubscriptionCollaborationsByChannel(context, { channelId, collaborations }) {
    return queueVideoCacheWrite(channelId, async () => {
      const cacheEntry = context.state.videoCache[channelId]
      if (!Array.isArray(cacheEntry?.videos) || context.rootGetters.getIncludeSubscriptionCollaborations !== true) return null
      const checkedAt = Date.now()
      const videos = mergeSubscriptionCollaborations(cacheEntry, collaborations, context.rootGetters.getHistoryCacheById)
      // The uploads' timestamp tells when they need their next full fetch
      await writeVideoCache(context, { channelId, videos, collaborationsFetched: true, collaborationsCheckedAt: checkedAt, timestamp: cacheEntry.timestamp })
      return context.state.videoCache[channelId]?.collaborationsCheckedAt === checkedAt ? videos : null
    })
  },

  async updateSubscriptionShortsCacheByChannel({ commit }, { channelId, videos, timestamp = new Date() }) {
    try {
      if (await DBSubscriptionCacheHandlers.updateShortsByChannelId(channelId, videos, timestamp) === false) return false
      commit('updateShortsCacheByChannel', { channelId, entries: videos, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionShortsCacheWithChannelPageShorts({ commit }, { channelId, videos }) {
    try {
      await DBSubscriptionCacheHandlers.updateShortsWithChannelPageShortsByChannelId(channelId, videos)
      commit('updateShortsCacheWithChannelPageShorts', { channelId, entries: videos })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionLiveCacheByChannel({ commit, state, rootGetters }, { channelId, videos, timestamp = new Date() }) {
    const previousCache = state.liveCache[channelId]
    videos = ensureSubscriptionFeedEntryState(
      videos,
      previousCache?.videos,
      'videoId',
      previousCache?.timestamp,
      rootGetters.getHistoryCacheById
    )

    try {
      if (await DBSubscriptionCacheHandlers.updateLiveStreamsByChannelId(channelId, videos, timestamp) === false) return false
      commit('updateLiveCacheByChannel', { channelId, entries: videos, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async updateSubscriptionPostsCacheByChannel({ commit, state }, { channelId, posts, timestamp = new Date() }) {
    const previousCache = state.postsCache[channelId]
    posts = ensureSubscriptionFeedEntryState(
      posts,
      previousCache?.posts,
      'postId',
      previousCache?.timestamp
    )

    try {
      if (await DBSubscriptionCacheHandlers.updateCommunityPostsByChannelId(channelId, posts, timestamp) === false) return false
      commit('updatePostsCacheByChannel', { channelId, entries: posts, timestamp })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async markSubscriptionEntriesAsSeen({ commit, dispatch, state, rootGetters }, {
    tab,
    tabs = [tab],
    channelIds = [],
    channelIdsByTab = {},
    entriesByTab
  }) {
    const cacheConfigs = {
      videos: {
        cache: applySubscriptionSeenVideosToCache(state.videoCache, rootGetters?.getSubscriptionSeenVideos),
        entriesKey: 'videos'
      },
      shorts: {
        cache: applySubscriptionSeenVideosToCache(state.shortsCache, rootGetters?.getSubscriptionSeenVideos),
        entriesKey: 'videos'
      },
      live: {
        cache: applySubscriptionSeenVideosToCache(state.liveCache, rootGetters?.getSubscriptionSeenVideos),
        entriesKey: 'videos'
      },
      posts: {
        cache: applySubscriptionSeenPostsToCache(state.postsCache, rootGetters?.getSubscriptionSeenPosts),
        entriesKey: 'posts'
      }
    }

    const marks = []
    const seenVideos = []
    const seenPosts = []

    for (const feedTab of tabs) {
      const channelIdSet = new Set(channelIdsByTab[feedTab] ?? channelIds)
      const capturedMembership = entriesByTab == null
        ? null
        : new Map((entriesByTab[feedTab] ?? [])
            .map(entry => [feedTab === 'posts' ? entry.postId : entry.videoId, entry.isMembersOnly === true]))
      const config = cacheConfigs[feedTab]
      if (config == null) {
        continue
      }

      for (const [channelId, cacheEntry] of Object.entries(config.cache)) {
        if (!channelIdSet.has(channelId)) {
          continue
        }

        const entries = cacheEntry?.[config.entriesKey]
        if (!entries?.some(entry => entry.isNewInSubscriptionFeed === true)) {
          continue
        }

        const seenEntries = entries.filter(entry => entry.isNewInSubscriptionFeed === true &&
          (capturedMembership === null || (feedTab === 'posts'
            ? capturedMembership.has(entry.postId)
            : capturedMembership.get(entry.videoId) === (entry.isMembersOnly === true)))).map(entry => ({
          ...(feedTab === 'posts' ? { postId: entry.postId } : { videoId: entry.videoId, isMembersOnly: entry.isMembersOnly === true }),
          isNewInSubscriptionFeed: false
        }))
        if (seenEntries.length === 0) continue

        marks.push({ tab: feedTab, channelId, entries: seenEntries })
        if (feedTab !== 'posts') {
          seenVideos.push(...seenEntries.map(({ videoId, isMembersOnly }) => ({ videoId, isMembersOnly })))
        } else {
          seenPosts.push(...seenEntries.map(({ postId }) => ({ postId })))
        }
      }
    }

    if (marks.length === 0) return
    // One write stores every channel in one transaction, and one mutation
    // gives Vue one render, so all cards leave together regardless of feed size.
    try {
      await DBSubscriptionCacheHandlers.markEntriesAsSeenMany(marks)
    } catch (errMessage) {
      console.error(errMessage)
      return
    }
    commit('markSubscriptionEntriesAsSeenInCache', marks)
    if (seenVideos.length > 0) {
      await dispatch('mergeSubscriptionSeenVideos', { videos: seenVideos }).catch(error => console.error(error))
    }
    if (seenPosts.length > 0) {
      await dispatch('mergeSubscriptionSeenPosts', { posts: seenPosts }).catch(error => console.error(error))
    }
  },

  async markSubscriptionVideoAsSeen({ commit, dispatch, state, rootGetters }, videoId) {
    const cacheConfigs = [
      {
        cache: state.videoCache,
        tab: 'videos'
      },
      {
        cache: state.shortsCache,
        tab: 'shorts'
      },
      {
        cache: state.liveCache,
        tab: 'live'
      }
    ]

    const marks = []
    const seenVideos = []
    for (const { cache, tab } of cacheConfigs) {
      for (const [channelId, cacheEntry] of Object.entries(toRaw(cache))) {
        if (!cacheEntry?.videos?.some(video => video.videoId === videoId)) continue
        const effectiveCache = applySubscriptionSeenVideosToCache(cache, rootGetters?.getSubscriptionSeenVideos)
        const entry = effectiveCache[channelId]?.videos?.find(video => video.videoId === videoId)
        if (entry?.isNewInSubscriptionFeed !== true) {
          continue
        }

        const seenEntries = [{ videoId, isMembersOnly: entry.isMembersOnly === true, isNewInSubscriptionFeed: false }]
        marks.push({ tab, channelId, entries: seenEntries })
        seenVideos.push({ videoId, isMembersOnly: seenEntries[0].isMembersOnly })
      }
    }
    if (marks.length === 0) return
    try {
      await DBSubscriptionCacheHandlers.markEntriesAsSeenMany(marks)
    } catch (errMessage) {
      console.error(errMessage)
      return
    }
    commit('markSubscriptionEntriesAsSeenInCache', marks)
    await dispatch('mergeSubscriptionSeenVideos', { videos: seenVideos }).catch(error => console.error(error))
  },

  async markSubscriptionVideoAsUnseen({ dispatch, state }, videoId) {
    const video = [state.videoCache, state.shortsCache, state.liveCache]
      .flatMap(cache => Object.values(cache))
      .flatMap(entry => entry?.videos ?? [])
      .find(video => video.videoId === videoId)
    if (!video) return

    await dispatch('updateSubscriptionHistory', {
      unseenVideo: { videoId, isMembersOnly: video.isMembersOnly === true }
    }).catch(error => console.error(error))
  },

  async markSubscriptionPostAsSeen({ commit, dispatch, state, rootGetters }, postId) {
    const marks = []
    const cache = applySubscriptionSeenPostsToCache(state.postsCache, rootGetters?.getSubscriptionSeenPosts)
    for (const [channelId, cacheEntry] of Object.entries(cache)) {
      const entry = cacheEntry?.posts?.find(post => post.postId === postId)
      if (entry?.isNewInSubscriptionFeed !== true) {
        continue
      }

      marks.push({ tab: 'posts', channelId, entries: [{ postId, isNewInSubscriptionFeed: false }] })
    }
    if (marks.length === 0) return
    try {
      await DBSubscriptionCacheHandlers.markEntriesAsSeenMany(marks)
    } catch (errMessage) {
      console.error(errMessage)
      return
    }
    commit('markSubscriptionEntriesAsSeenInCache', marks)
    await dispatch('mergeSubscriptionSeenPosts', { posts: [{ postId }] }).catch(error => console.error(error))
  },

  async clearSubscriptionsCacheForManyChannels({ commit }, channelIds) {
    try {
      // Forget first: a failure keeps the cache rows, so the cleanup is retried.
      await forgetAndroidSubscriptionRefreshFingerprints(channelIds)
      await DBSubscriptionCacheHandlers.deleteMultipleChannels(channelIds)
      commit('clearCachesForManyChannels', channelIds)
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async clearSubscriptionsCache({ commit }) {
    try {
      await forgetAndroidSubscriptionRefreshFingerprints()
      await DBSubscriptionCacheHandlers.deleteAll()
      commit('clearCaches')
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },
}

const mutations = {
  invalidateSubscriptionVideosFeed(state) {
    state.subscriptionVideosFeedVersion++
  },
  markSubscriptionEntriesAsSeenInCache(state, cacheEntries) {
    for (const { tab, channelId, entries: marked } of cacheEntries) {
      const cache = tab === 'videos'
        ? state.videoCache
        : tab === 'shorts'
          ? state.shortsCache
          : tab === 'live'
            ? state.liveCache
            : state.postsCache
      const cacheEntry = cache[channelId]
      if (!cacheEntry) continue
      const key = tab === 'posts' ? 'posts' : 'videos'
      const entries = cacheEntry[key] ?? []
      // Existing feed panels retain entry references. Update those objects so
      // their indicators and menus change along with the New feed.
      preserveSubscriptionSeenEntries(entries, marked, tab === 'posts' ? 'postId' : 'videoId')
        .forEach((entry, index) => {
          if (entry !== entries[index]) entries[index].isNewInSubscriptionFeed = false
        })
    }
  },

  updateVideoCacheByChannel(state, { channelId, entries, timestamp = new Date(), collaborationsCheckedAt }) {
    const existingObject = state.videoCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { videos: null }
    if (entries != null) { newObject.videos = preserveSubscriptionSeenEntries(entries, existingObject?.videos) }
    newObject.timestamp = toDate(timestamp)
    if (collaborationsCheckedAt !== undefined) newObject.collaborationsCheckedAt = collaborationsCheckedAt
    state.videoCache[channelId] = newObject
  },
  updateShortsCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.shortsCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { videos: null }
    if (entries != null) { newObject.videos = preserveSubscriptionSeenEntries(entries, existingObject?.videos) }
    newObject.timestamp = toDate(timestamp)
    state.shortsCache[channelId] = newObject
  },
  updateShortsCacheWithChannelPageShorts(state, { channelId, entries }) {
    const cachedObject = state.shortsCache[channelId]

    if (cachedObject && cachedObject.videos.length > 0) {
      cachedObject.videos.forEach(cachedVideo => {
        const channelVideo = entries.find(short => cachedVideo.videoId === short.videoId)

        if (channelVideo) {
          // authorId probably never changes, so we don't need to update that

          cachedVideo.title = channelVideo.title
          cachedVideo.author = channelVideo.author
          cachedVideo.thumbnailUrl = channelVideo.thumbnailUrl ?? cachedVideo.thumbnailUrl

          // as the channel shorts page only has compact view counts for numbers above 1000 e.g. 12k
          // and the RSS feeds include an exact value, we only want to overwrite it when the number is larger than the cached value
          // 12345 vs 12000 => 12345
          // 12345 vs 15000 => 15000

          if (channelVideo.viewCount > cachedVideo.viewCount) {
            cachedVideo.viewCount = channelVideo.viewCount
          }
        }
      })
    }
  },
  updateLiveCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.liveCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { videos: null }
    if (entries != null) { newObject.videos = preserveSubscriptionSeenEntries(entries, existingObject?.videos) }
    newObject.timestamp = toDate(timestamp)
    state.liveCache[channelId] = newObject
  },
  updatePostsCacheByChannel(state, { channelId, entries, timestamp = new Date() }) {
    const existingObject = state.postsCache[channelId]
    if (toDate(existingObject?.timestamp).getTime() > toDate(timestamp).getTime()) return
    const newObject = existingObject ?? { posts: null }
    if (entries != null) { newObject.posts = preserveSubscriptionSeenEntries(entries, existingObject?.posts, 'postId') }
    newObject.timestamp = toDate(timestamp)
    state.postsCache[channelId] = newObject
  },

  clearCaches(state) {
    state.videoCache = {}
    state.shortsCache = {}
    state.liveCache = {}
    state.postsCache = {}
  },

  clearCachesForManyChannels(state, channelIds) {
    channelIds.forEach((channelId) => {
      state.videoCache[channelId] = null
      state.liveCache[channelId] = null
      state.shortsCache[channelId] = null
      state.postsCache[channelId] = null
    })
  },

  setCaches(state, { videos, liveStreams, shorts, communityPosts }) {
    state.videoCache = videos
    state.liveCache = liveStreams
    state.shortsCache = shorts
    state.postsCache = communityPosts
  },

  setSubscriptionCacheReady(state, payload) {
    state.subscriptionCacheReady = payload
  },
  setSubscriptionCacheLoadFailed(state, payload) {
    state.subscriptionCacheLoadFailed = payload
  },
  setSubscriptionFeedRefreshInProgress(state, payload) {
    state.subscriptionFeedRefreshInProgress = payload
  },
  setSubscriptionFeedRefreshTab(state, payload) {
    state.subscriptionFeedRefreshTab = payload
  },
  setSubscriptionFeedRefreshProgress(state, payload) {
    state.subscriptionFeedRefreshProgress = payload
  },
  setSubscriptionFeedLastRefreshTimestamp(state, payload) {
    state.subscriptionFeedLastRefreshTimestamp = payload
  },
  setSubscriptionFeedNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionFeedNextAutoRefreshTimestamp = payload
  },
  setSubscriptionShortsLastRefreshTimestamp(state, payload) {
    state.subscriptionShortsLastRefreshTimestamp = payload
  },
  setSubscriptionShortsNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionShortsNextAutoRefreshTimestamp = payload
  },
  setSubscriptionLiveLastRefreshTimestamp(state, payload) {
    state.subscriptionLiveLastRefreshTimestamp = payload
  },
  setSubscriptionLiveNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionLiveNextAutoRefreshTimestamp = payload
  },
  setSubscriptionPostsLastRefreshTimestamp(state, payload) {
    state.subscriptionPostsLastRefreshTimestamp = payload
  },
  setSubscriptionPostsNextAutoRefreshTimestamp(state, payload) {
    state.subscriptionPostsNextAutoRefreshTimestamp = payload
  },
}

export default {
  state,
  getters,
  actions,
  mutations
}
