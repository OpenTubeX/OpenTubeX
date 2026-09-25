import { watch } from 'vue'
import { isAppHidden } from './appVisibility.js'
import { SUBSCRIPTION_FEED_TYPES } from './subscription-channels.js'
import { createSubscriptionRefreshStorage } from './subscriptionRefreshStorage.js'
import { SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY } from './subscriptionRefreshPlatform.js'
import {
  cancelSubscriptionRefresh,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY,
} from './subscriptions'

/** @typedef {'videos' | 'shorts' | 'live' | 'posts'} SubscriptionRefreshTab */
/** @type {readonly SubscriptionRefreshTab[]} */
export const subscriptionAutoRefreshTabs = SUBSCRIPTION_FEED_TYPES

/**
 * Owns refresh timers, queues, deadlines, and cross-window state.
 * All browser and platform dependencies come from the root composition layer.
 *
 * @param {object} dependencies
 * @param {object} dependencies.store Vuex store with subscription getters and actions.
 * @param {(key: string) => string} dependencies.t
 * @param {import('vue').Ref<boolean>} dependencies.dataReady
 * @param {import('vue').ComputedRef<string | null>} dependencies.activeSubscriptionProfileId
 * @param {import('vue').ComputedRef<boolean>} dependencies.subscriptionCacheReady
 * @param {import('vue').ComputedRef<string>} dependencies.subscriptionFeedAutoRefreshInterval
 * @param {import('vue').ComputedRef<string>} dependencies.subscriptionShortsAutoRefreshInterval
 * @param {import('vue').ComputedRef<string>} dependencies.subscriptionLiveAutoRefreshInterval
 * @param {import('vue').ComputedRef<string>} dependencies.subscriptionPostsAutoRefreshInterval
 * @param {import('vue').ComputedRef<boolean>} dependencies.hideSubscriptionsVideos
 * @param {import('vue').ComputedRef<boolean>} dependencies.hideSubscriptionsShorts
 * @param {import('vue').ComputedRef<boolean>} dependencies.hideSubscriptionsLive
 * @param {import('vue').ComputedRef<boolean>} dependencies.hideSubscriptionsPosts
 * @param {ReturnType<typeof import('./subscriptionRefreshPlatform.js').createSubscriptionRefreshPlatform>} dependencies.subscriptionRefreshPlatform
 * @param {() => Promise<unknown>} dependencies.reconcileAndroidSubscriptionRefreshResults
 * @param {(state: {inProgress: boolean, percentage: number, tab?: string | null}) => void} dependencies.applySubscriptionAutoRefreshState
 * @param {(value: string | null) => {percentage: number, tab?: string} | null} dependencies.getSubscriptionRefreshProgressState
 * @param {boolean} dependencies.canReconcileBackground
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} dependencies.storage
 * @param {Pick<Navigator, 'onLine'>} dependencies.navigatorObject
 */
export function createSubscriptionAutoRefreshScheduler({
  store, t, dataReady, activeSubscriptionProfileId, subscriptionCacheReady,
  subscriptionFeedAutoRefreshInterval, subscriptionShortsAutoRefreshInterval,
  subscriptionLiveAutoRefreshInterval, subscriptionPostsAutoRefreshInterval,
  hideSubscriptionsVideos, hideSubscriptionsShorts, hideSubscriptionsLive,
  hideSubscriptionsPosts, subscriptionRefreshPlatform,
  reconcileAndroidSubscriptionRefreshResults, applySubscriptionAutoRefreshState,
  getSubscriptionRefreshProgressState, canReconcileBackground, storage,
  navigatorObject,
}) {
  const navigator = navigatorObject
  const subscriptionAutoRefreshTimers = {
    videos: null,
    shorts: null,
    live: null,
    posts: null
  }
  const SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL = 60 * 1000
  const SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL = 1000
  const LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.'
  const SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.completed.'
  const SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.deadline.'
  const {
    getSubscriptionAutoRefreshStorageKey,
    setStoredSubscriptionAutoRefreshTimestamp,
    getStoredSubscriptionTabNextAutoRefreshTimestamp,
    migrateLegacySubscriptionAutoRefreshDeadlines,
    setStoredSubscriptionTabNextAutoRefreshTimestamp,
    getStoredSubscriptionTabLastRefreshTimestamp,
    parseSubscriptionAutoRefreshStorageKey,
  } = createSubscriptionRefreshStorage({
    storage,
    getProfiles: () => store.getters.getProfileList,
    tabs: subscriptionAutoRefreshTabs,
    legacyPrefix: LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX,
    deadlinePrefix: SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
    completionPrefix: SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
  })
  const pendingSubscriptionAutoRefreshes = []
  const pendingSubscriptionAutoRefreshKeys = new Set()
  const cancelledSubscriptionAutoRefreshKeys = new Set()
  let processingSubscriptionAutoRefreshes = false

  watch([dataReady, activeSubscriptionProfileId], ([ready, profileId]) => {
    clearSubscriptionFeedAutoRefreshTimer()
    if (ready && profileId) {
      migrateLegacySubscriptionAutoRefreshDeadlines()
      synchronizeSubscriptionAutoRefreshProfile(profileId)
    }
  })

  watch([subscriptionFeedAutoRefreshInterval, hideSubscriptionsVideos], () => {
    resetSubscriptionTabAutoRefreshForAllProfiles('videos')
  })

  watch([subscriptionShortsAutoRefreshInterval, hideSubscriptionsShorts], () => {
    resetSubscriptionTabAutoRefreshForAllProfiles('shorts')
  })

  watch([subscriptionLiveAutoRefreshInterval, hideSubscriptionsLive], () => {
    resetSubscriptionTabAutoRefreshForAllProfiles('live')
  })

  watch([subscriptionPostsAutoRefreshInterval, hideSubscriptionsPosts], () => {
    resetSubscriptionTabAutoRefreshForAllProfiles('posts')
  })

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function resetSubscriptionTabAutoRefreshForAllProfiles(tab) {
    if (!dataReady.value) {
      return
    }

    const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
    const enabled = isSubscriptionTabAutoRefreshEnabled(tab)
    const timestamp = enabled ? Date.now() + interval : null

    for (const profile of store.getters.getProfileList) {
      setStoredSubscriptionTabNextAutoRefreshTimestamp(profile._id, tab, timestamp)
    }

    const profileId = activeSubscriptionProfileId.value
    if (profileId) {
      scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {string} profileId
   * @param {number | null} [scheduledTimestamp]
   */
  function scheduleSubscriptionTabAutoRefresh(tab, profileId, scheduledTimestamp) {
    clearSubscriptionTabAutoRefreshTimer(tab)

    if (!dataReady.value || profileId !== activeSubscriptionProfileId.value) {
      return
    }

    if (!isSubscriptionTabAutoRefreshEnabled(tab)) {
      setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, null)
      return
    }

    const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
    const now = Date.now()
    const storedTimestamp = scheduledTimestamp === undefined
      ? getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
      : scheduledTimestamp
    const nextAutoRefreshTimestamp = storedTimestamp ?? now + interval

    setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, nextAutoRefreshTimestamp)
    subscriptionAutoRefreshTimers[tab] = setTimeout(() => {
      subscriptionAutoRefreshTimers[tab] = null
      enqueueSubscriptionAutoRefresh(tab, profileId)
    }, Math.max(0, nextAutoRefreshTimestamp - now))
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {string} profileId
   */
  function enqueueSubscriptionAutoRefresh(tab, profileId) {
    const key = `${profileId}:${tab}`
    if (pendingSubscriptionAutoRefreshKeys.has(key)) {
      return
    }

    pendingSubscriptionAutoRefreshKeys.add(key)
    pendingSubscriptionAutoRefreshes.push({ tab, profileId, key })
    processPendingSubscriptionAutoRefreshes()
  }

  async function processPendingSubscriptionAutoRefreshes() {
    if (processingSubscriptionAutoRefreshes) {
      return
    }

    processingSubscriptionAutoRefreshes = true
    try {
      while (pendingSubscriptionAutoRefreshes.length > 0) {
        const { tab, profileId, key } = pendingSubscriptionAutoRefreshes.shift()

        try {
          if (
            profileId !== activeSubscriptionProfileId.value ||
            !isSubscriptionTabAutoRefreshEnabled(tab) ||
            navigator.onLine === false ||
            isAppHidden()
          ) {
            continue
          }

          if (!await subscriptionRefreshPlatform.isActive()) {
            continue
          }

          const storedTimestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
          if (storedTimestamp !== null && storedTimestamp > Date.now()) {
            scheduleSubscriptionTabAutoRefresh(tab, profileId, storedTimestamp)
            continue
          }

          if (canReconcileBackground) {
            await reconcileAndroidSubscriptionRefreshResults()
            const refreshedTimestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
            if (refreshedTimestamp !== null && refreshedTimestamp > Date.now()) {
              scheduleSubscriptionTabAutoRefresh(tab, profileId, refreshedTimestamp)
              continue
            }
          }
          cancelledSubscriptionAutoRefreshKeys.delete(key)
          const result = await getSubscriptionTabRefreshHandler(tab)({
            t,
            showStartToast: true
          })
          const wasCancelled = cancelledSubscriptionAutoRefreshKeys.delete(key)

          if (result === null) {
            if (wasCancelled) {
              scheduleSubscriptionTabAutoRefresh(tab, profileId, Date.now() + getSubscriptionTabAutoRefreshInterval(tab))
            } else {
              scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId)
            }
          }
        } catch (error) {
          cancelledSubscriptionAutoRefreshKeys.delete(key)
          console.error(`Failed to auto refresh subscription ${tab}`, error)
          scheduleSubscriptionTabAutoRefreshRetry(
            tab,
            profileId,
            SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL
          )
        } finally {
          pendingSubscriptionAutoRefreshKeys.delete(key)
        }
      }
    } finally {
      processingSubscriptionAutoRefreshes = false
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {string} profileId
   */
  function scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId) {
    scheduleSubscriptionTabAutoRefreshRetry(tab, profileId, SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL)
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {string} profileId
   * @param {number} delay
   */
  function scheduleSubscriptionTabAutoRefreshRetry(tab, profileId, delay) {
    if (profileId !== activeSubscriptionProfileId.value) {
      return
    }

    clearSubscriptionTabAutoRefreshTimer(tab)
    subscriptionAutoRefreshTimers[tab] = setTimeout(() => {
      subscriptionAutoRefreshTimers[tab] = null
      enqueueSubscriptionAutoRefresh(tab, profileId)
    }, delay)
  }

  function refreshOverdueSubscriptionFeeds() {
    const profileId = activeSubscriptionProfileId.value
    if (!dataReady.value || !profileId) {
      return
    }

    for (const tab of subscriptionAutoRefreshTabs) {
      const timestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
      if (timestamp !== null && timestamp <= Date.now() && isSubscriptionTabAutoRefreshEnabled(tab)) {
        enqueueSubscriptionAutoRefresh(tab, profileId)
      } else {
        scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
      }
    }
  }

  async function handleSubscriptionAutoRefreshVisibilityChange() {
    if (!isAppHidden()) {
      synchronizeSubscriptionRefreshInProgress()
      if (canReconcileBackground && subscriptionCacheReady.value) {
        await reconcileAndroidSubscriptionRefreshResults()
      }
      refreshOverdueSubscriptionFeeds()
    }
  }

  async function synchronizeSubscriptionRefreshInProgress() {
    try {
      applySubscriptionAutoRefreshState(await subscriptionRefreshPlatform.readInProgress())
    } catch {
      // Live start/finish events still keep the common path synchronized.
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getSubscriptionAutoRefreshInterval(tab) {
    switch (tab) {
      case 'shorts':
        return subscriptionShortsAutoRefreshInterval
      case 'live':
        return subscriptionLiveAutoRefreshInterval
      case 'posts':
        return subscriptionPostsAutoRefreshInterval
      default:
        return subscriptionFeedAutoRefreshInterval
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getSubscriptionTabRefreshHandler(tab) {
    switch (tab) {
      case 'shorts':
        return refreshSubscriptionShortsFromRemote
      case 'live':
        return refreshSubscriptionLiveFromRemote
      case 'posts':
        return refreshSubscriptionPostsFromRemote
      default:
        return refreshSubscriptionVideosFromRemote
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getSubscriptionTabAutoRefreshInterval(tab) {
    return parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function isSubscriptionTabAutoRefreshEnabled(tab) {
    const interval = getSubscriptionTabAutoRefreshInterval(tab)

    return (
      dataReady.value &&
      !isSubscriptionTabHidden(tab) &&
      !Number.isNaN(interval) &&
      interval > 0
    )
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function isSubscriptionTabHidden(tab) {
    switch (tab) {
      case 'shorts':
        return hideSubscriptionsShorts.value
      case 'live':
        return hideSubscriptionsLive.value
      case 'posts':
        return hideSubscriptionsPosts.value
      default:
        return hideSubscriptionsVideos.value
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {string} profileId
   * @param {number | null} timestamp
   */
  function setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, timestamp) {
    setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp)

    if (profileId === activeSubscriptionProfileId.value) {
      commitSubscriptionTabNextAutoRefreshTimestamp(tab, timestamp)
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {number | null} timestamp
   */
  function commitSubscriptionTabNextAutoRefreshTimestamp(tab, timestamp) {
    switch (tab) {
      case 'shorts':
        store.commit('setSubscriptionShortsNextAutoRefreshTimestamp', timestamp)
        break
      case 'live':
        store.commit('setSubscriptionLiveNextAutoRefreshTimestamp', timestamp)
        break
      case 'posts':
        store.commit('setSubscriptionPostsNextAutoRefreshTimestamp', timestamp)
        break
      default:
        store.commit('setSubscriptionFeedNextAutoRefreshTimestamp', timestamp)
    }
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {number | null} timestamp
   */
  function commitSubscriptionTabLastRefreshTimestamp(tab, timestamp) {
    switch (tab) {
      case 'shorts':
        store.commit('setSubscriptionShortsLastRefreshTimestamp', timestamp)
        break
      case 'live':
        store.commit('setSubscriptionLiveLastRefreshTimestamp', timestamp)
        break
      case 'posts':
        store.commit('setSubscriptionPostsLastRefreshTimestamp', timestamp)
        break
      default:
        store.commit('setSubscriptionFeedLastRefreshTimestamp', timestamp)
    }
  }

  /**
   * @param {string} profileId
   */
  function synchronizeSubscriptionAutoRefreshProfile(profileId) {
    for (const tab of subscriptionAutoRefreshTabs) {
      commitSubscriptionTabLastRefreshTimestamp(
        tab,
        getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab)
      )
      scheduleSubscriptionTabAutoRefresh(tab, profileId)
    }
  }

  /**
   * @param {CustomEvent<{tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string}>} event
   */
  function handleSubscriptionRefreshCancelled(event) {
    const { tab, profileId } = event.detail
    if (
      profileId !== activeSubscriptionProfileId.value ||
      !subscriptionAutoRefreshTabs.includes(tab)
    ) {
      return
    }

    cancelledSubscriptionAutoRefreshKeys.add(`${profileId}:${tab}`)
  }

  /**
   * @param {CustomEvent<{tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string, timestamp: number}>} event
   */
  function handleSubscriptionRefreshCompleted(event) {
    const { tab, profileId, timestamp } = event.detail
    if (
      !subscriptionAutoRefreshTabs.includes(tab) ||
      typeof profileId !== 'string' ||
      !Number.isFinite(timestamp) ||
      timestamp < getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab)
    ) {
      return
    }

    subscriptionRefreshPlatform.backgroundCompleted({ profileId, feedType: tab, timestamp }).catch(console.error)
    setStoredSubscriptionAutoRefreshTimestamp(
      getSubscriptionAutoRefreshStorageKey(
        SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
        profileId,
        tab
      ),
      timestamp
    )

    const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
    const nextTimestamp = isSubscriptionTabAutoRefreshEnabled(tab) ? timestamp + interval : null
    setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, nextTimestamp)

    if (profileId === activeSubscriptionProfileId.value) {
      commitSubscriptionTabLastRefreshTimestamp(tab, timestamp)
      scheduleSubscriptionTabAutoRefresh(tab, profileId, nextTimestamp)
    }
  }

  /**
   * @param {StorageEvent} event
   */
  function handleSubscriptionAutoRefreshStorage(event) {
    if (subscriptionRefreshPlatform.handlesStorageProgress && event.key === SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY) {
      if (event.newValue !== null) {
        cancelSubscriptionRefresh()
      }
      return
    }

    if (subscriptionRefreshPlatform.handlesStorageProgress && event.key === SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY) {
      const state = getSubscriptionRefreshProgressState(event.newValue)
      applySubscriptionAutoRefreshState({
        inProgress: state !== null,
        percentage: state?.percentage ?? 0,
        tab: state?.tab ?? null
      })
      return
    }

    const deadline = parseSubscriptionAutoRefreshStorageKey(
      event.key,
      SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX
    )
    if (deadline && deadline.profileId === activeSubscriptionProfileId.value) {
      const timestamp = Number(event.newValue)
      if (event.newValue === null || !Number.isFinite(timestamp) || timestamp <= 0) {
        clearSubscriptionTabAutoRefreshTimer(deadline.tab)
        commitSubscriptionTabNextAutoRefreshTimestamp(deadline.tab, null)
      } else {
        scheduleSubscriptionTabAutoRefresh(deadline.tab, deadline.profileId, timestamp)
      }
      return
    }

    const completion = parseSubscriptionAutoRefreshStorageKey(
      event.key,
      SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX
    )
    if (completion && completion.profileId === activeSubscriptionProfileId.value) {
      const timestamp = Number(event.newValue)
      commitSubscriptionTabLastRefreshTimestamp(
        completion.tab,
        Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
      )
    }
  }

  function clearSubscriptionFeedAutoRefreshTimer() {
    clearSubscriptionTabAutoRefreshTimer('videos')
    clearSubscriptionTabAutoRefreshTimer('shorts')
    clearSubscriptionTabAutoRefreshTimer('live')
    clearSubscriptionTabAutoRefreshTimer('posts')
  }

  /**
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function clearSubscriptionTabAutoRefreshTimer(tab) {
    clearTimeout(subscriptionAutoRefreshTimers[tab])
    subscriptionAutoRefreshTimers[tab] = null
  }
  return {
    clearSubscriptionFeedAutoRefreshTimer,
    refreshOverdueSubscriptionFeeds,
    handleSubscriptionAutoRefreshVisibilityChange,
    synchronizeSubscriptionRefreshInProgress,
    handleSubscriptionRefreshCancelled,
    handleSubscriptionRefreshCompleted,
    handleSubscriptionAutoRefreshStorage,
  }
}
