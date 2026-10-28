// @ts-check
import { holdBackgroundSync, setPeriodicBackgroundSync } from './androidBackgroundSync.js'
import { isAppHidden } from './appVisibility.js'
import { AUTO_SYNC_INTERVAL_MS, isRecentSync, isSyncReasonEnabled } from './sync-server-scheduling'

const EVENT_SYNC_DEBOUNCE_MS = 1500
/** @type {Record<string, { delay: number, maxWait: number }>} */
const EVENT_SYNC_DELAYS = {
  sessions: { delay: 10000, maxWait: 30000 },
  history: { delay: 30000, maxWait: 60000 },
  watchStats: { delay: 30000, maxWait: 60000 },
}

/**
 * @typedef {object} SyncRequestOptions
 * @property {boolean} [automatic] Started without a user action; stopping automatic sync cancels it.
 * @property {boolean} [remoteOnly] Only checks for remote changes, so local edits stay pending.
 * @property {boolean} [skipIfRecent] Skips the sync if the last one finished recently.
 */

/**
 * Decides when to sync with the sync server; sync-server-scheduling.js
 * decides which changes need one. Runs one sync at a time, queues a full
 * sync behind a remote-only check, waits for a pause in local edits per
 * collection, checks periodically while automatic sync is on, and replays
 * edits that came due while iOS had the app hidden.
 * @param {object} options
 * @param {() => any} options.getSettings The current settings
 * @param {() => { syncServerStatus: string, syncServerLiveRemindersPending: boolean }} options.getSyncState
 * @param {(options: SyncRequestOptions & Record<string, unknown>) => Promise<unknown>} options.runSync Syncs once
 * @param {(options: SyncRequestOptions) => Promise<unknown>} options.requestSync
 *   Starts a scheduled sync. The store passes it through its actions, which stay the
 *   only entry points, and back to {@link sync}.
 * @param {(restart: boolean) => unknown} options.requestAutoSync Starts or restarts
 *   automatic sync the same way, through {@link start} or {@link restart}
 * @param {<T>(callback: () => T | Promise<T>) => Promise<T>} options.withSyncLock Excludes syncs in other windows
 * @param {() => boolean} options.isOffline
 * @param {() => Promise<boolean>} options.isLiveConnected Whether a live connection reports remote changes
 * @param {() => unknown} options.startLive
 * @param {() => unknown} options.stopLive
 */
export function createSyncScheduler({
  getSettings,
  getSyncState,
  runSync,
  requestSync,
  requestAutoSync,
  withSyncLock,
  isOffline,
  isLiveConnected,
  startLive,
  stopLive,
}) {
  /** @type {Promise<unknown> | null} */
  let activeSyncPromise = null
  let activeSyncRemoteOnly = false
  /** @type {ReturnType<typeof setTimeout> | null} */
  let autoSyncTimer = null
  let autoSyncController = new AbortController()
  /** @type {Map<string, { firstChangeAt: number, timer: ReturnType<typeof setTimeout> | null, releaseHold: () => void }>} */
  const eventSyncTimers = new Map()
  // Event syncs that came due while the iOS app was hidden; replayed on resume.
  /** @type {Set<string>} */
  const hiddenEventSyncReasons = new Set()

  function clearEventSyncTimers() {
    for (const pending of eventSyncTimers.values()) {
      clearTimeout(pending.timer ?? undefined)
      pending.releaseHold()
    }
    eventSyncTimers.clear()
  }

  const isAutoSyncEnabled = settings =>
    settings.syncServerEnabled && settings.syncServerAutoSync && settings.syncServerToken

  /**
   * @param {SyncRequestOptions & Record<string, unknown>} [options]
   * @returns {Promise<unknown>}
   */
  function sync(options = {}) {
    const autoSyncSignal = autoSyncController.signal
    if (!getSettings().syncServerEnabled) {
      return Promise.reject(new Error('Enable sync first'))
    }
    if (!getSettings().syncServerToken) {
      return Promise.reject(new Error('Connect to a sync server first'))
    }
    if (isOffline() || (options.automatic && autoSyncSignal.aborted)) return Promise.resolve(null)
    // A remote-only check may skip all merges, so it cannot consume local work.
    if (activeSyncPromise && activeSyncRemoteOnly && !options.remoteOnly) {
      // The running check releases its hold before the queued sync takes one.
      const releaseHold = holdBackgroundSync()
      return activeSyncPromise.catch(() => {}).then(() => {
        if (options.automatic && autoSyncSignal.aborted) return null
        return sync(options)
      }).finally(releaseHold)
    }
    if (!activeSyncPromise) {
      activeSyncRemoteOnly = options.remoteOnly === true
      let syncStarted = false
      const releaseHold = holdBackgroundSync()
      activeSyncPromise = withSyncLock(() => {
        if (!getSettings().syncServerEnabled || isOffline() ||
            (options.automatic && autoSyncSignal.aborted)) return null
        if (options.skipIfRecent &&
            isRecentSync(getSettings().syncServerLastSyncAt)) {
          return null
        }
        syncStarted = !options.remoteOnly
        if (syncStarted) {
          // A full sync includes every collection, consuming all pending edits.
          clearEventSyncTimers()
        }
        return runSync(options)
      }).finally(() => {
        activeSyncPromise = null
        activeSyncRemoteOnly = false
        if (!autoSyncSignal.aborted) requestAutoSync(syncStarted)
        releaseHold()
      })
    }
    return activeSyncPromise
  }

  /** Waits for a running sync. Resolves to whether there was one. */
  async function waitForActiveSync() {
    const pending = activeSyncPromise
    if (!pending) return false
    await pending.catch(() => {})
    return true
  }

  function start() {
    startLive()
    if (autoSyncTimer || !isAutoSyncEnabled(getSettings())) {
      return
    }

    if (autoSyncController.signal.aborted) autoSyncController = new AbortController()
    if (!isSyncReasonEnabled(getSettings(), 'automatic')) return
    setPeriodicBackgroundSync(true)
    const { signal } = autoSyncController
    autoSyncTimer = setTimeout(async () => {
      autoSyncTimer = null
      try {
        const connected = await isLiveConnected()
        const settings = getSettings()
        if (signal.aborted || !isAutoSyncEnabled(settings) || isOffline()) return
        // A hidden mobile app has stopped its live connection on purpose; the
        // visibility handler syncs once it is shown again instead of polling
        // in the background.
        if (process.env.IS_CAPACITOR && isAppHidden()) return
        // Live notifications replace periodic downloads, but failed uploads
        // and reminders awaiting permission still need a retry.
        const syncState = getSyncState()
        const retryPending = syncState.syncServerStatus === 'error' ||
          (syncState.syncServerLiveRemindersPending &&
            isSyncReasonEnabled(settings, 'liveReminders'))
        if (!connected || retryPending) {
          await requestSync({ skipIfRecent: !retryPending, automatic: true })
        }
      } catch (error) {
        console.error('Sync server automatic sync failed', error)
      } finally {
        if (!signal.aborted) requestAutoSync(false)
      }
    }, AUTO_SYNC_INTERVAL_MS)
  }

  function restart() {
    clearTimeout(autoSyncTimer ?? undefined)
    autoSyncTimer = null
    start()
  }

  function stop() {
    autoSyncController.abort()
    stopLive()
    setPeriodicBackgroundSync(false)
    clearTimeout(autoSyncTimer ?? undefined)
    clearEventSyncTimers()
    hiddenEventSyncReasons.clear()
    autoSyncTimer = null
  }

  /** @param {string} reason the collection that changed, or `automatic` */
  function schedule(reason = 'data') {
    const settings = getSettings()
    if (autoSyncController.signal.aborted || isOffline() ||
        !isAutoSyncEnabled(settings) ||
        !isSyncReasonEnabled(settings, reason)) {
      return
    }
    const previous = eventSyncTimers.get(reason)
    const firstChangeAt = previous?.firstChangeAt ?? Date.now()
    const { delay, maxWait } = EVENT_SYNC_DELAYS[reason] ?? { delay: EVENT_SYNC_DEBOUNCE_MS, maxWait: Infinity }
    clearTimeout(previous?.timer ?? undefined)
    // Keep a hidden Android app running until the pending edits are synced.
    /** @type {{ firstChangeAt: number, timer: ReturnType<typeof setTimeout> | null, releaseHold: () => void }} */
    const pending = { firstChangeAt, timer: null, releaseHold: previous?.releaseHold ?? holdBackgroundSync() }
    eventSyncTimers.set(reason, pending)
    pending.timer = setTimeout(async () => {
      // Edits made during a sync retain their own deadline. Once due, wait for
      // that sync to finish rather than starting a second debounce period.
      for (let syncing = activeSyncPromise; syncing; syncing = activeSyncPromise) {
        await syncing.catch(() => {})
      }
      if (eventSyncTimers.get(reason) !== pending) return
      eventSyncTimers.delete(reason)
      try {
        const settings = getSettings()
        if (isOffline() ||
            !isAutoSyncEnabled(settings) ||
            !isSyncReasonEnabled(settings, reason)) return
        // iOS suspends a hidden app, which would stall the sync until it resumes.
        if (process.env.IS_IOS && isAppHidden()) {
          hiddenEventSyncReasons.add(reason)
          return
        }
        // The sync holds the app running from here on.
        requestSync({
          skipIfRecent: reason === 'automatic',
          automatic: true,
        }).catch(error => {
          console.error('Sync server event sync failed', error)
        })
      } finally {
        pending.releaseHold()
      }
    }, Math.max(0, Math.min(delay, firstChangeAt + maxWait - Date.now())))
  }

  function resumeHidden() {
    const reasons = [...hiddenEventSyncReasons]
    hiddenEventSyncReasons.clear()
    for (const reason of reasons) schedule(reason)
  }

  return { sync, waitForActiveSync, start, restart, stop, schedule, resumeHidden }
}
