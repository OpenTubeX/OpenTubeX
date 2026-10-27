import { computed, watch } from 'vue'
import store from '../store/index'
import { isAppHidden } from '../helpers/appVisibility.js'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'
import { parseAutomaticDownloadRules } from '../helpers/automaticDownloadRules'
import { getInvidiousApiErrorMessage, showApiErrorToast, showToast } from '../helpers/utils'
import { openNotificationSettings } from '../helpers/capacitorUi'
import {
  acknowledgeAndroidSubscriptionRefreshResult,
  addAndroidSubscriptionRefreshCancelledListener,
  configureAndroidSubscriptionRefresh,
  getAndroidSubscriptionRefreshState,
  getNextAndroidSubscriptionRefreshResult,
  requestAndroidSubscriptionRefreshNotificationPermission,
  startAndroidSubscriptionRefresh,
  updateAndroidSubscriptionRefresh
} from '../helpers/androidSubscriptionRefresh'
import { configureUploadNotifications } from '../helpers/uploadNotifications'
import { createUploadNotificationConfiguration } from '../../newUploadNotifications'
import {
  AndroidSubscriptionRefreshPayloadError,
  createAndroidSubscriptionRefreshConfiguration,
  createSubscriptionRefreshStartGuard,
  normalizeAndroidSubscriptionRefreshPayload,
  processAndroidSubscriptionRefreshChannelResult
} from '../helpers/androidSubscriptionRefreshData'
import { hasConfiguredRestrictedPlaybackAuthentication, shouldHideMembersOnlyContent } from '../helpers/restricted-playback'
import { normalizeLocalSubscriptionFeed } from '../helpers/api/local'
import { invidiousGetVideoInformation, normalizeInvidiousSubscriptionFeed } from '../helpers/api/invidious'
import { fillYatteeShortDates } from '../helpers/api/yattee'
import { formatRequestDiagnostic } from '../helpers/api/requestDiagnostics'
import { reconcileFetchedSubscriptionEntries } from '../helpers/subscription-entries'
import { parseSubscriptionRss } from '../helpers/api/feed-rss'
import {
  enrichSubscriptionRssEntries,
  enrichSubscriptionShortDates,
  cancelSubscriptionRefresh,
  notifySubscriptionChannelRefreshed,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY,
  SUBSCRIPTION_REFRESH_CANCELLED_EVENT,
  SUBSCRIPTION_REFRESH_COMPLETED_EVENT,
  SUBSCRIPTION_REFRESH_FINISHED_EVENT,
  SUBSCRIPTION_REFRESH_LOCK_NAME,
  SUBSCRIPTION_REFRESH_PROGRESS_EVENT,
  SUBSCRIPTION_REFRESH_STARTED_EVENT
} from '../helpers/subscriptions'

const isElectron = process.env.IS_ELECTRON
const isCapacitor = process.env.IS_CAPACITOR

const SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL = 60 * 1000
const SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL = 1000
const LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.'
const SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.completed.'
const SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.deadline.'
const SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.inProgress'
const subscriptionAutoRefreshTabs = ['videos', 'shorts', 'live', 'posts']

/**
 * Refreshes the subscription feeds on their configured intervals while the
 * app is open, configures and imports the refreshes that the desktop main
 * process or the Android worker run while it is closed, and shares refresh
 * progress and deadlines between windows and tabs.
 *
 * It owns its timers, its listeners and its localStorage keys. Call `start`
 * once the app can handle refresh events, `listenForNativeCancellation` in the
 * mobile app once the library has loaded, and `stop` when the app unmounts.
 * @param {object} options
 * @param {import('vue').Ref<boolean>} options.dataReady Whether settings and the library have loaded
 * @param {(key: string, values?: object) => string} options.t
 */
export function useSubscriptionAutoRefresh({ dataReady, t }) {
  const subscriptionAutoRefreshTimers = {
    videos: null,
    shorts: null,
    live: null,
    posts: null
  }
  let removeSubscriptionAutoRefreshActiveChangedListener = null
  let removeSubscriptionAutoRefreshCancelListener = null
  let removeSubscriptionAutoRefreshStateChangedListener = null
  let removeBackgroundResultsAvailableListener = null
  let removeAndroidSubscriptionRefreshCancelledListener = null
  let androidSubscriptionRefreshStateTimer = null
  let androidExternalRefreshProgress = null
  let androidExternalRefreshReloadTime = null
  let androidSubscriptionRefreshStateVersion = 0
  const pendingSubscriptionAutoRefreshes = []
  const pendingSubscriptionAutoRefreshKeys = new Set()
  const cancelledSubscriptionAutoRefreshKeys = new Set()
  let processingSubscriptionAutoRefreshes = false

  /** @type {import('vue').ComputedRef<string>} */
  const subscriptionFeedAutoRefreshInterval = computed(() => store.getters.getSubscriptionFeedAutoRefreshInterval)

  /** @type {import('vue').ComputedRef<string>} */
  const subscriptionShortsAutoRefreshInterval = computed(() => store.getters.getSubscriptionShortsAutoRefreshInterval)

  /** @type {import('vue').ComputedRef<string>} */
  const subscriptionLiveAutoRefreshInterval = computed(() => store.getters.getSubscriptionLiveAutoRefreshInterval)

  /** @type {import('vue').ComputedRef<string>} */
  const subscriptionPostsAutoRefreshInterval = computed(() => store.getters.getSubscriptionPostsAutoRefreshInterval)

  /** @type {import('vue').ComputedRef<boolean>} */
  const enableClosedAppSubscriptionRefresh = computed(() => store.getters.getEnableClosedAppSubscriptionRefresh)

  /** @type {import('vue').ComputedRef<string | null>} */
  const activeSubscriptionProfileId = computed(() => store.getters.getActiveProfile?._id ?? null)

  /** @type {import('vue').ComputedRef<boolean>} */
  const hideSubscriptionsVideos = computed(() => store.getters.getHideSubscriptionsVideos)

  /** @type {import('vue').ComputedRef<boolean>} */
  const hideSubscriptionsShorts = computed(() => store.getters.getHideSubscriptionsShorts)

  /** @type {import('vue').ComputedRef<boolean>} */
  const hideSubscriptionsLive = computed(() => store.getters.getHideLiveStreams || store.getters.getHideSubscriptionsLive)

  /** @type {import('vue').ComputedRef<boolean>} */
  const hideSubscriptionsPosts = computed(() => store.getters.getHideSubscriptionsCommunity || store.getters.getUseRssFeeds)

  const hiddenSubscriptionFeedTypes = computed(() => [
    ...(hideSubscriptionsVideos.value ? ['videos'] : []),
    ...(hideSubscriptionsShorts.value ? ['shorts'] : []),
    ...(hideSubscriptionsLive.value ? ['live'] : []),
    ...(hideSubscriptionsPosts.value ? ['posts'] : [])
  ])

  const subscriptionCacheReady = computed(() => store.getters.getSubscriptionCacheReady)

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

  const androidSubscriptionRefreshConfiguration = computed(() => {
    if (process.env.IS_IOS || (!isCapacitor && !isElectron) || !dataReady.value) return null

    return createAndroidSubscriptionRefreshConfiguration({
      profiles: store.getters.getProfileList,
      automaticDownloadRules: supportsYtDlp && store.getters.getEnableDownloads ? parseAutomaticDownloadRules(store.getters.getYtDlpAutomaticDownloadRules) : {},
      closedAppRefreshEnabled: enableClosedAppSubscriptionRefresh.value,
      backend: store.getters.getBackendPreference,
      useRss: store.getters.getUseRssFeeds,
      fallback: store.getters.getBackendFallback,
      region: store.getters.getRegion,
      intervals: {
        videos: subscriptionFeedAutoRefreshInterval.value,
        shorts: subscriptionShortsAutoRefreshInterval.value,
        live: subscriptionLiveAutoRefreshInterval.value,
        posts: subscriptionPostsAutoRefreshInterval.value
      },
      // Yattee servers have no posts, so only the local API fallback can refresh them
      hiddenFeedTypes: store.getters.getBackendPreference === 'yattee' && !store.getters.getBackendFallback
        ? [...new Set([...hiddenSubscriptionFeedTypes.value, 'posts'])]
        : hiddenSubscriptionFeedTypes.value,
      instanceUrl: store.getters.getApiServerUrl,
      authorization: store.getters.getApiServerAuthorization,
      titles: Object.fromEntries(subscriptionAutoRefreshTabs.map(tab => [
        tab,
        getSubscriptionRefreshNotificationTitle(tab)
      ])),
      cancelLabel: t('Feed.Cancel Refresh')
    })
  })

  watch(androidSubscriptionRefreshConfiguration, async configuration => {
    if (configuration === null) return
    try {
      if (isElectron) {
        await window.ftElectron.subscriptionAutoRefresh.configureBackground({
          ...configuration, enabled: enableClosedAppSubscriptionRefresh.value
        })
        return
      }
      await configureAndroidSubscriptionRefresh(configuration)
      if (Object.values(configuration.intervals).some(interval => interval > 0)) {
        const denied = await requestAndroidSubscriptionRefreshNotificationPermission()
        if (denied) showAndroidSubscriptionRefreshNotificationWarning()
      }
    } catch (error) {
      console.error('Failed to configure closed-app subscription refreshes', error)
    }
  }, { deep: true })

  const uploadNotificationConfiguration = computed(() => {
    if (process.env.IS_IOS || (!isCapacitor && !isElectron) || !dataReady.value) return null

    return createUploadNotificationConfiguration({
      enabled: store.getters.getEnableUploadNotifications,
      subscriptions: store.getters.getProfileList[0]?.subscriptions ?? [],
      hiddenFeedTypes: hiddenSubscriptionFeedTypes.value,
      showMembersOnly: hasConfiguredRestrictedPlaybackAuthentication(store.getters),
      titles: {
        videos: t('Subscriptions.New video from {channel}', { channel: '{channel}' }),
        shorts: t('Subscriptions.New short from {channel}', { channel: '{channel}' }),
        live: t('Subscriptions.{channel} is live', { channel: '{channel}' }),
        posts: t('Subscriptions.New post from {channel}', { channel: '{channel}' })
      }
    })
  })

  watch(uploadNotificationConfiguration, async configuration => {
    if (configuration === null) return
    try {
      await configureUploadNotifications(configuration)
      if (configuration.enabled && isCapacitor && await requestAndroidSubscriptionRefreshNotificationPermission()) {
        showAndroidSubscriptionRefreshNotificationWarning()
      }
    } catch (error) {
      console.error('Failed to configure upload notifications', error)
    }
  }, { deep: true })

  watch([dataReady, subscriptionCacheReady], ([ready, cacheReady]) => {
    if ((isCapacitor || isElectron) && ready && cacheReady) {
      reconcileAndroidSubscriptionRefreshResults()
    }
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

          if (process.env.IS_ELECTRON && !await window.ftElectron.tabs.isActive()) {
            continue
          }

          const storedTimestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
          if (storedTimestamp !== null && storedTimestamp > Date.now()) {
            scheduleSubscriptionTabAutoRefresh(tab, profileId, storedTimestamp)
            continue
          }

          if (isElectron || isCapacitor) {
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
      if ((isCapacitor || isElectron) && subscriptionCacheReady.value) {
        await reconcileAndroidSubscriptionRefreshResults()
      }
      refreshOverdueSubscriptionFeeds()
    }
  }

  async function synchronizeSubscriptionRefreshInProgress() {
    const version = ++androidSubscriptionRefreshStateVersion
    clearTimeout(androidSubscriptionRefreshStateTimer)
    androidSubscriptionRefreshStateTimer = null
    try {
      let state
      if (process.env.IS_ELECTRON) {
        state = await window.ftElectron.subscriptionAutoRefresh.isInProgress()
      } else if (process.env.IS_CAPACITOR && !process.env.IS_IOS) {
        state = await getAndroidSubscriptionRefreshState()
        if (version !== androidSubscriptionRefreshStateVersion) return
        // This renderer already publishes its own start/progress/finish events.
        // In particular, an idle Refresh All batch must not block its next feed.
        if (state.ownedByRenderer) return
        applySubscriptionAutoRefreshState(state)
        if (subscriptionCacheReady.value && !isAppHidden()) {
          await reconcileAndroidSubscriptionRefreshResults()
          // A retained renderer writes directly to the shared cache rather than
          // the scheduled worker's result queue. Limit full cache/feed rebuilds
          // while progress moves, then flush the remaining writes on completion.
          // The first native read also catches writes after the startup cache load.
          const progress = state.rendererActive ? `${state.tab}:${state.percentage}` : null
          if (androidExternalRefreshReloadTime === null ||
            (progress !== androidExternalRefreshProgress &&
              (progress === null || androidExternalRefreshProgress === null ||
                performance.now() - androidExternalRefreshReloadTime >= 5000))) {
            await store.dispatch('grabAllSubscriptions')
            androidExternalRefreshProgress = progress
            androidExternalRefreshReloadTime = performance.now()
            for (const tab of subscriptionAutoRefreshTabs) notifySubscriptionChannelRefreshed(tab)
          }
        }
        if (version === androidSubscriptionRefreshStateVersion && state.inProgress && !isAppHidden()) {
          androidSubscriptionRefreshStateTimer = setTimeout(synchronizeSubscriptionRefreshInProgress, 1000)
        }
        return
      } else if (navigator.locks) {
        const { held } = await navigator.locks.query()
        const inProgress = held.some(lock => lock.name === SUBSCRIPTION_REFRESH_LOCK_NAME)
        if (!inProgress) {
          localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
        }
        const progressState = inProgress ? getStoredSubscriptionRefreshProgressState() : null
        state = {
          inProgress,
          percentage: progressState?.percentage ?? 0,
          tab: progressState?.tab ?? null
        }
      } else {
        const progressState = getStoredSubscriptionRefreshProgressState()
        state = {
          inProgress: progressState !== null,
          percentage: progressState?.percentage ?? 0,
          tab: progressState?.tab ?? null
        }
      }

      applySubscriptionAutoRefreshState(state)
    } catch {
      // Live start/finish events still keep the common path synchronized.
      if (process.env.IS_CAPACITOR && !process.env.IS_IOS && version === androidSubscriptionRefreshStateVersion && !isAppHidden()) {
        androidSubscriptionRefreshStateTimer = setTimeout(synchronizeSubscriptionRefreshInProgress, 1000)
      }
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
   * @param {string} prefix
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getSubscriptionAutoRefreshStorageKey(prefix, profileId, tab) {
    return `${prefix}${encodeURIComponent(profileId)}/${tab}`
  }

  /**
   * @param {string} key
   */
  function getStoredSubscriptionAutoRefreshTimestamp(key) {
    try {
      const timestamp = Number(localStorage.getItem(key))
      return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
    } catch {
      return null
    }
  }

  /**
   * @param {string} key
   * @param {number | null} timestamp
   */
  function setStoredSubscriptionAutoRefreshTimestamp(key, timestamp) {
    try {
      if (timestamp === null) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, String(timestamp))
      }
    } catch {
      // Auto refresh still works for the current session when storage is unavailable.
    }
  }

  /**
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab) {
    const key = getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
      profileId,
      tab
    )
    const timestamp = getStoredSubscriptionAutoRefreshTimestamp(key)
    return timestamp
  }

  function migrateLegacySubscriptionAutoRefreshDeadlines() {
    for (const tab of subscriptionAutoRefreshTabs) {
      const legacyKey = `${LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX}${tab}`
      const legacyTimestamp = getStoredSubscriptionAutoRefreshTimestamp(legacyKey)
      if (legacyTimestamp === null) {
        continue
      }

      for (const profile of store.getters.getProfileList) {
        const profileKey = getSubscriptionAutoRefreshStorageKey(
          SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
          profile._id,
          tab
        )
        if (getStoredSubscriptionAutoRefreshTimestamp(profileKey) === null) {
          setStoredSubscriptionAutoRefreshTimestamp(profileKey, legacyTimestamp)
        }
      }

      setStoredSubscriptionAutoRefreshTimestamp(legacyKey, null)
    }
  }

  /**
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   * @param {number | null} timestamp
   */
  function setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp) {
    setStoredSubscriptionAutoRefreshTimestamp(
      getSubscriptionAutoRefreshStorageKey(
        SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
        profileId,
        tab
      ),
      timestamp
    )
  }

  /**
   * @param {string} profileId
   * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
   */
  function getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab) {
    return getStoredSubscriptionAutoRefreshTimestamp(
      getSubscriptionAutoRefreshStorageKey(
        SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
        profileId,
        tab
      )
    )
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
    if (process.env.IS_CAPACITOR && !process.env.IS_IOS) {
      // A reopened renderer has no local refresh promise to reschedule. Move its
      // overdue timer now so cancelling native work does not immediately restart it.
      const storedTimestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
      const now = Date.now()
      const timestamp = !isSubscriptionTabAutoRefreshEnabled(tab)
        ? null
        : storedTimestamp === null || storedTimestamp <= now
          ? now + getSubscriptionTabAutoRefreshInterval(tab)
          : storedTimestamp
      setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp)
      scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
    }
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

    if (isElectron) {
      window.ftElectron.subscriptionAutoRefresh.backgroundCompleted({ profileId, feedType: tab, timestamp }).catch(console.error)
    }
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
   * @param {CustomEvent<{tab: string, profileId: string, refreshId: number}>} event
   */
  async function handleSubscriptionRefreshStarted(event) {
    const isCurrentStart = subscriptionRefreshStartGuard.begin()
    if (isCapacitor) {
      const { acquired, notificationsDenied } = await startAndroidSubscriptionRefresh(
        event.detail.refreshId,
        getSubscriptionRefreshNotificationTitle(event.detail.tab),
        t('Feed.Cancel Refresh'),
        event.detail.tab
      )
      if (!isCurrentStart()) return
      if (notificationsDenied) showAndroidSubscriptionRefreshNotificationWarning()
      if (!acquired) {
        cancelSubscriptionRefresh()
      }
    }
    if (!process.env.IS_ELECTRON) {
      try {
        localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify({
          ...event.detail,
          percentage: 0
        }))
      } catch {
        // The owner still has its renderer-local progress state.
      }
    }
    applySubscriptionAutoRefreshState({
      inProgress: true,
      percentage: 0,
      tab: event.detail.tab
    })
  }

  const subscriptionRefreshStartGuard = createSubscriptionRefreshStartGuard()
  let androidSubscriptionRefreshNotificationWarningShown = false

  function showAndroidSubscriptionRefreshNotificationWarning() {
    if (androidSubscriptionRefreshNotificationWarningShown) return
    androidSubscriptionRefreshNotificationWarningShown = true
    showToast({
      message: t('Video.Notification unavailable'),
      icon: ['fas', 'triangle-exclamation'],
      buttons: [{
        label: t('Settings.Settings'),
        primary: true,
        action: () => openNotificationSettings()
      }]
    })
  }

  /**
   * @param {CustomEvent<{
   *   percentage: number,
   *   ownerTabId?: string | null,
   *   refreshId?: number
   * }>} event
   */
  function handleSubscriptionRefreshProgress(event) {
    const percentage = normalizeSubscriptionRefreshProgress(event.detail.percentage)
    store.commit('setSubscriptionFeedRefreshProgress', percentage)

    if (isCapacitor) {
      updateAndroidSubscriptionRefresh(event.detail.refreshId, percentage)
    }

    if (process.env.IS_ELECTRON) {
      window.ftElectron.subscriptionAutoRefresh.setProgress(
        event.detail.ownerTabId ?? store.getters.getActiveTabId,
        percentage
      )
      return
    }

    try {
      const progressState = getStoredSubscriptionRefreshProgressState() ?? {}
      localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify({
        ...progressState,
        percentage
      }))
    } catch {
      // The owner still has its renderer-local progress state.
    }
  }

  /**
   * @param {CustomEvent<{refreshId: number}>} event
   */
  function handleSubscriptionRefreshFinished(event) {
    subscriptionRefreshStartGuard.finish()
    if (!process.env.IS_ELECTRON) {
      try {
        localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      } catch {
        // The owner still clears its renderer-local progress state.
      }
    }
    applySubscriptionAutoRefreshState({ inProgress: false, percentage: 0 })
  }

  function getSubscriptionRefreshNotificationTitle(tab) {
    switch (tab) {
      case 'shorts':
        return t('Subscriptions.Refreshing Subscription Shorts')
      case 'live':
        return t('Subscriptions.Refreshing Subscription Live Streams')
      case 'posts':
        return t('Subscriptions.Refreshing Subscription Posts')
      default:
        return t('Subscriptions.Refreshing Subscription Videos')
    }
  }

  let reconcilingAndroidSubscriptionRefreshResults = null

  function reconcileAndroidSubscriptionRefreshResults() {
    if (reconcilingAndroidSubscriptionRefreshResults) return reconcilingAndroidSubscriptionRefreshResults
    const importing = isElectron
      ? navigator.locks.request('opentubex-background-subscription-import', importAndroidSubscriptionRefreshResults)
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
          !subscriptionAutoRefreshTabs.includes(result.feedType)
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
          handleSubscriptionRefreshCompleted({
            detail: {
              tab: result.feedType,
              profileId: result.profileId,
              timestamp: Number(result.timestamp) || Date.now()
            }
          })
        } else if (
          result.kind === 'failure' &&
          result.diagnostic &&
          store.getters.profileById(result.profileId)
        ) {
          const diagnostic = formatRequestDiagnostic(result.diagnostic)
          console.error(`Closed-app subscription refresh request failed: ${diagnostic}`)
          showApiErrorToast(store.getters.getBackendPreference === 'local' ? t('Local API Error (Click to copy)') : getInvidiousApiErrorMessage(store.getters.getBackendPreference), diagnostic)
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
    if (feedType === 'shorts') {
      // Yattee Shorts are dated through the server like in foreground refreshes, not by YouTube
      entries = store.getters.getBackendPreference === 'yattee' && !result.payload?.backgroundFormat?.startsWith('local')
        ? await fillYatteeShortDates(entries, previousCache?.[config.entriesKey], invidiousGetVideoInformation)
        : await enrichSubscriptionShortDates(entries, result.channelId)
    }
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
    notifySubscriptionChannelRefreshed(feedType)
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

  /**
   * @param {StorageEvent} event
   */
  function handleSubscriptionAutoRefreshStorage(event) {
    if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY) {
      if (event.newValue !== null) {
        cancelSubscriptionRefresh()
      }
      return
    }

    if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY) {
      if (process.env.IS_CAPACITOR && !process.env.IS_IOS) {
        synchronizeSubscriptionRefreshInProgress()
        return
      }
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

  /**
   * @param {{inProgress: boolean, percentage: number, tab?: string | null}} state
   */
  function applySubscriptionAutoRefreshState(state) {
    const wasInProgress = store.getters.getSubscriptionFeedRefreshInProgress
    const previousTab = store.getters.getSubscriptionFeedRefreshTab
    const nextTab = state.inProgress ? state.tab ?? null : null
    let percentage = normalizeSubscriptionRefreshProgress(state.percentage)

    // The refresh owner updates progress locally before the main process broadcasts
    // it to every renderer. An older broadcast can therefore arrive after a newer
    // local update, so keep progress monotonic for the duration of this refresh.
    if (state.inProgress && wasInProgress && nextTab === previousTab) {
      percentage = Math.max(store.getters.getSubscriptionFeedRefreshProgress, percentage)
    }

    store.commit('setSubscriptionFeedRefreshInProgress', state.inProgress)
    store.commit('setSubscriptionFeedRefreshTab', nextTab)
    store.commit('setSubscriptionFeedRefreshProgress', percentage)
  }

  /**
   * @param {number} percentage
   */
  function normalizeSubscriptionRefreshProgress(percentage) {
    return Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0
  }

  function getStoredSubscriptionRefreshProgressState() {
    try {
      return getSubscriptionRefreshProgressState(
        localStorage.getItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      )
    } catch {
      return null
    }
  }

  /**
   * @param {string | null} value
   * @returns {{percentage: number, tab?: string} | null}
   */
  function getSubscriptionRefreshProgressState(value) {
    if (value === null) {
      return null
    }

    try {
      const state = JSON.parse(value)
      return {
        ...state,
        percentage: normalizeSubscriptionRefreshProgress(state.percentage)
      }
    } catch {
      return null
    }
  }

  /**
   * @param {string | null} key
   * @param {string} prefix
   * @returns {{profileId: string, tab: 'videos' | 'shorts' | 'live' | 'posts'} | null}
   */
  function parseSubscriptionAutoRefreshStorageKey(key, prefix) {
    if (!key?.startsWith(prefix)) {
      return null
    }

    const separatorIndex = key.lastIndexOf('/')
    const tab = key.slice(separatorIndex + 1)
    if (separatorIndex < prefix.length || !subscriptionAutoRefreshTabs.includes(tab)) {
      return null
    }

    try {
      return {
        profileId: decodeURIComponent(key.slice(prefix.length, separatorIndex)),
        tab
      }
    } catch {
      return null
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

  function start() {
    window.addEventListener('online', refreshOverdueSubscriptionFeeds)
    window.addEventListener('storage', handleSubscriptionAutoRefreshStorage)
    window.addEventListener(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, handleSubscriptionRefreshCancelled)
    window.addEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
    window.addEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
    window.addEventListener(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, handleSubscriptionRefreshProgress)
    window.addEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
    document.addEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
    if (process.env.IS_ELECTRON) {
      removeBackgroundResultsAvailableListener = window.ftElectron.subscriptionAutoRefresh.onBackgroundResultsAvailable(
        handleSubscriptionAutoRefreshVisibilityChange
      )
      removeSubscriptionAutoRefreshStateChangedListener = window.ftElectron.subscriptionAutoRefresh.onStateChanged(
        applySubscriptionAutoRefreshState
      )
      removeSubscriptionAutoRefreshCancelListener = window.ftElectron.subscriptionAutoRefresh.onCancelRequested(
        cancelSubscriptionRefresh
      )
      synchronizeSubscriptionRefreshInProgress()
      removeSubscriptionAutoRefreshActiveChangedListener = window.ftElectron.tabs.onActiveChanged((isActive) => {
        if (isActive) {
          synchronizeSubscriptionRefreshInProgress()
          refreshOverdueSubscriptionFeeds()
        }
      })
    } else {
      synchronizeSubscriptionRefreshInProgress()
    }
  }

  /** Lets the cancel action of the native refresh notification stop the refresh. */
  async function listenForNativeCancellation() {
    removeAndroidSubscriptionRefreshCancelledListener =
      await addAndroidSubscriptionRefreshCancelledListener(cancelSubscriptionRefresh)
  }

  function stop() {
    clearSubscriptionFeedAutoRefreshTimer()
    window.removeEventListener('online', refreshOverdueSubscriptionFeeds)
    window.removeEventListener('storage', handleSubscriptionAutoRefreshStorage)
    window.removeEventListener(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, handleSubscriptionRefreshCancelled)
    window.removeEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
    window.removeEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
    window.removeEventListener(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, handleSubscriptionRefreshProgress)
    window.removeEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
    document.removeEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
    removeSubscriptionAutoRefreshActiveChangedListener?.()
    removeSubscriptionAutoRefreshCancelListener?.()
    removeSubscriptionAutoRefreshStateChangedListener?.()
    removeBackgroundResultsAvailableListener?.()
    removeAndroidSubscriptionRefreshCancelledListener?.()
    clearTimeout(androidSubscriptionRefreshStateTimer)
    androidSubscriptionRefreshStateVersion++
  }

  return { start, listenForNativeCancellation, stop }
}
