import { shallowReactive } from 'vue'
import { subscriptionRefreshErrors } from './subscriptionRefreshErrors'
import store from '../store/index'
import { usesInvidiousApi } from '../../apiBackends'
import {
  showInvidiousFallbackToast,
  showApiErrorToast,
  showToast,
} from './utils'
import { mapConcurrently } from './concurrent-map'
import { cancelAndroidSubscriptionRefresh, finishAndroidSubscriptionRefresh, isAndroidSubscriptionRefreshActive } from './androidSubscriptionRefresh'
import { isRecoverableNetworkError } from './networkRecovery'
import { createSubscriptionNetworkRecovery, SubscriptionNetworkError } from './subscriptionNetworkRecovery'
import { buildRequestDiagnostic, formatRequestDiagnostic } from './api/requestDiagnostics'

export const SUBSCRIPTION_REFRESH_CHANNEL_EVENT = 'opentubex-subscription-refresh-channel'
export const SUBSCRIPTION_REFRESH_CANCELLED_EVENT = 'opentubex-subscription-refresh-cancelled'
export const SUBSCRIPTION_REFRESH_COMPLETED_EVENT = 'opentubex-subscription-refresh-completed'
export const SUBSCRIPTION_REFRESH_FINISHED_EVENT = 'opentubex-subscription-refresh-finished'
export const SUBSCRIPTION_REFRESH_LOCK_NAME = 'opentubex-subscription-refresh'
export const SUBSCRIPTION_REFRESH_PROGRESS_EVENT = 'opentubex-subscription-refresh-progress'
export const SUBSCRIPTION_REFRESH_STARTED_EVENT = 'opentubex-subscription-refresh-started'
export const SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.cancel'

// The tab id the Electron refresh lock was acquired with. Progress reports to the
// main process must use this id, as the active tab may change during the refresh.
// The other subscription refresh modules read it; only this module assigns it.
export let electronRefreshOwnerTabId = null

/**
 * Cancellation state of the refresh this renderer is running, if any. The
 * other subscription refresh modules read it; only this module assigns it.
 * @type {{ cancelled: boolean, tab: string, profileId: string, refreshId: number, controller: AbortController, errors: Map<string, Map<string, string>>, errorSummary: ReturnType<typeof createSubscriptionErrorSummary>, networkRecovery: ReturnType<typeof createSubscriptionNetworkRecovery> | null } | null}
 */
export let activeRefresh = null
let nextRefreshId = 0
let rendererRefreshReserved = false

// Incremented on every cancellation request, so that a cancellation is not
// missed when it arrives between two feed refreshes.
let cancelCount = 0

const SUBSCRIPTION_FETCH_BATCH_SIZE = 80
const SUBSCRIPTION_FETCH_BATCH_DELAY_MS = 2000
const SUBSCRIPTION_FETCH_CONCURRENCY = 8

/**
 * Stops the refresh running in this renderer after the channels that are
 * currently being fetched. Already fetched channels stay cached.
 */
export function cancelSubscriptionRefresh() {
  cancelCount++
  markActiveSubscriptionRefreshCancelled()
  // Native notifications also use this path, without requesting cancellation
  // again. A reopened renderer still needs to postpone its automatic refresh.
  if (process.env.IS_CAPACITOR && !activeRefresh && store.getters.getSubscriptionFeedRefreshInProgress) {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, {
      detail: { tab: store.getters.getSubscriptionFeedRefreshTab, profileId: store.getters.getActiveProfile._id }
    }))
  }
}

function markActiveSubscriptionRefreshCancelled() {
  if (activeRefresh !== null && !activeRefresh.cancelled) {
    activeRefresh.cancelled = true
    activeRefresh.controller.abort()
    activeRefresh.networkRecovery?.cancel()
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, {
      detail: {
        tab: activeRefresh.tab,
        profileId: activeRefresh.profileId
      }
    }))
  }
}

/**
 * Cancels the refresh wherever it is running, as another window may own it.
 */
export function requestSubscriptionRefreshCancellation() {
  cancelSubscriptionRefresh()

  if (process.env.IS_CAPACITOR) {
    cancelAndroidSubscriptionRefresh()
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.subscriptionAutoRefresh.cancel()
    return
  }

  try {
    localStorage.setItem(SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY, `${Date.now()}-${cancelCount}`)
  } catch {
    // Only the refresh of this browser tab can be cancelled then.
  }
}

/**
 * Lets callers that refresh several feeds in a row notice a cancellation that
 * happened between two feeds, when no refresh was running.
 */
export function getSubscriptionRefreshCancelCount() {
  return cancelCount
}

export function isRefreshCancelled() {
  return activeRefresh?.cancelled === true
}

/**
 * @template T
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {() => Promise<T>} refresh
 * @returns {Promise<T | null>}
 */
export async function withSubscriptionRefreshLock(tab, profileId, refresh, t) {
  if (rendererRefreshReserved || store.getters.getSubscriptionFeedRefreshInProgress) {
    return null
  }

  rendererRefreshReserved = true
  try {
    return await runWithSubscriptionRefreshLock(tab, profileId, refresh, t)
  } finally {
    rendererRefreshReserved = false
  }
}

async function runWithSubscriptionRefreshLock(tab, profileId, refresh, t) {
  if (process.env.IS_CAPACITOR && await isAndroidSubscriptionRefreshActive()) {
    return null
  }

  const cancelCountAtStart = cancelCount
  const refreshId = ++nextRefreshId
  const runRefresh = async () => {
    const controller = new AbortController()
    activeRefresh = {
      cancelled: false,
      errors: new Map(),
      errorSummary: createSubscriptionErrorSummary(t),
      controller,
      tab,
      profileId,
      refreshId,
      networkRecovery: createSubscriptionNetworkRecovery({
        signal: controller.signal,
        allowFallback: process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback
      })
    }
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_STARTED_EVENT, {
      detail: { tab, profileId, refreshId }
    }))

    if (cancelCount !== cancelCountAtStart) {
      markActiveSubscriptionRefreshCancelled()
    }

    try {
      return await refresh()
    } finally {
      activeRefresh.networkRecovery?.cancel()
      activeRefresh.errorSummary.finish()
      activeRefresh = null
      window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_FINISHED_EVENT, {
        detail: { tab, profileId, refreshId }
      }))
      if (process.env.IS_CAPACITOR) {
        // Finish native ownership before the next feed checks whether work is busy.
        await finishAndroidSubscriptionRefresh(refreshId)
      }
    }
  }

  if (process.env.IS_ELECTRON) {
    const ownerTabId = store.getters.getActiveTabId
    const acquired = await window.ftElectron.subscriptionAutoRefresh.acquire(ownerTabId, tab)
    if (!acquired) {
      return null
    }

    electronRefreshOwnerTabId = ownerTabId
    try {
      return await runRefresh()
    } finally {
      electronRefreshOwnerTabId = null
      await window.ftElectron.subscriptionAutoRefresh.release(ownerTabId)
    }
  }

  if (navigator.locks) {
    return navigator.locks.request(
      SUBSCRIPTION_REFRESH_LOCK_NAME,
      { ifAvailable: true },
      lock => lock ? runRefresh() : null
    )
  }

  return runRefresh()
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
export function completeSubscriptionRefresh(tab, profileId) {
  const timestamp = Date.now()
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, {
    detail: { tab, profileId, timestamp }
  }))
}

/**
 * @param {number} percentage
 */
export function setSubscriptionRefreshProgress(percentage) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, {
    detail: {
      percentage,
      ownerTabId: electronRefreshOwnerTabId,
      refreshId: activeRefresh?.refreshId
    }
  }))
}

/**
 * Lets the feed views render the channels that have been fetched so far,
 * instead of waiting for the whole refresh to finish.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
export function notifySubscriptionChannelRefreshed(tab) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_CHANNEL_EVENT, {
    detail: { tab }
  }))
}

/** Keep confirmed channel failures visible even when another channel keeps retrying. */
function createSubscriptionErrorSummary(t) {
  const errors = shallowReactive(new Map())
  /** @type {import('./utils').ToastControl | null} */
  let toastControl = null
  let shown = false
  return {
    add(channel, messages) {
      if (!messages?.size) return
      errors.set(channel.id, {
        id: channel.id,
        name: channel.name || channel.id,
        reasons: [...new Set(messages.values())],
        trace: [...messages.keys()].join('\n')
      })
      if (shown || subscriptionRefreshErrors.value === errors) return
      shown = true
      toastControl = showToast({
        message: () => {
          const names = [...errors.values()].slice(0, 3).map(channel => channel.name).join(', ')
          const channels = errors.size > 3
            ? t('Subscriptions.Refresh Error Channels More', { channels: names, count: errors.size - 3 }, errors.size - 3)
            : names
          return t('Subscriptions.Refresh Errors', { channels })
        },
        time: Infinity,
        action: () => {
          shown = false
          subscriptionRefreshErrors.value = errors
        },
        icon: ['fas', 'circle-exclamation']
      })
    },
    finish() {
      // Keep the final details available briefly after completion or cancellation.
      if (shown) toastControl?.startTimeout(10000)
    }
  }
}

export async function fetchSubscriptionsConcurrently(channels, fetchChannel) {
  await mapConcurrently(
    channels,
    SUBSCRIPTION_FETCH_CONCURRENCY,
    async channel => {
      // Channels that haven't started yet are skipped, the ones in flight
      // still finish and are cached.
      if (isRefreshCancelled()) {
        return
      }

      if (process.env.IS_ELECTRON) {
        await window.ftElectron.waitForIpBlockRecoveryScript()
      }

      try {
        if (activeRefresh?.networkRecovery) {
          const preferredBackend = store.getters.getBackendPreference
          await activeRefresh.networkRecovery.run(useFallback => {
            if (useFallback && usesInvidiousApi(preferredBackend)) showInvidiousFallbackToast(preferredBackend)
            return fetchChannel(channel, useFallback ? (preferredBackend === 'local' ? 'invidious' : 'local') : preferredBackend)
          })
        } else {
          await fetchChannel(channel)
        }
      } catch (error) {
        if (!isRefreshCancelled()) throw error
      }

      if (!isRefreshCancelled()) {
        activeRefresh.errorSummary.add(channel, activeRefresh.errors.get(channel.id))
      }

      // Let input and navigation tasks run between parsing/cache updates.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  )
}

export async function fetchSubscriptionsInBatches(channels, fetchChannel) {
  for (let index = 0; index < channels.length; index += SUBSCRIPTION_FETCH_BATCH_SIZE) {
    if (isRefreshCancelled()) {
      break
    }

    if (index > 0) {
      await new Promise(resolve => setTimeout(resolve, SUBSCRIPTION_FETCH_BATCH_DELAY_MS))
    }

    const batch = channels.slice(index, index + SUBSCRIPTION_FETCH_BATCH_SIZE)
    await fetchSubscriptionsConcurrently(batch, fetchChannel)
  }
}

// Routine fallback notices stay quiet during bulk refreshes. Direct retries use
// showInvidiousFallbackToast so privacy warnings remain visible.
export function showSubscriptionFallbackToast(options) {
  if (!activeRefresh) showToast(options)
}

/**
 * @param {{ id: string, name?: string }} channel
 * @param {unknown} error
 * @param {string} title
 * @param {{ category: string, backend: string }} context
 */
export function handleSubscriptionFetchError(channel, error, title, context) {
  if (activeRefresh?.controller.signal.aborted) throw error
  if (activeRefresh?.networkRecovery && isRecoverableNetworkError(error)) {
    // Let the shared queue probe both enabled backends after backoff without
    // cache writes, completion timestamps, or one toast per subscribed channel.
    throw new SubscriptionNetworkError(error)
  }

  const channelLabel = channel.name ? `${channel.name} (${channel.id})` : channel.id
  const details = buildRequestDiagnostic(error, context)
  const diagnostic = formatRequestDiagnostic(details)
  const message = `${channelLabel}: ${diagnostic}`

  console.error(`Failed to fetch subscription channel ${channelLabel}: ${diagnostic}`)
  if (activeRefresh) {
    if (!activeRefresh.errors.has(channel.id)) activeRefresh.errors.set(channel.id, new Map())
    activeRefresh.errors.get(channel.id).set(message, details.message)
  } else {
    showApiErrorToast(title, message)
  }
}
