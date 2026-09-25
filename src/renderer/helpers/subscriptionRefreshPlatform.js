export const SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.inProgress'

/**
 * Platform side effects for a subscription refresh. Storage broadcasts are
 * shared by web and Android; Electron uses its main-process coordinator.
 *
 * @param {object} dependencies
 * @param {'web' | 'android' | 'electron'} dependencies.runtime
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} dependencies.storage
 * @param {{ setProgress?: (tabId: string, percentage: number) => unknown, backgroundCompleted?: (result: {profileId: string, feedType: string, timestamp: number}) => Promise<unknown>, configureBackground?: (configuration: object) => Promise<unknown>, isInProgress?: () => Promise<object> }} [dependencies.electron]
 * @param {{ isActive: () => Promise<boolean> }} [dependencies.electronTabs]
 * @param {{ start?: (id: number, title: string, cancelLabel: string) => Promise<{acquired: boolean, notificationsDenied: boolean}>, update?: (id: number, percentage: number) => unknown, configure?: (configuration: object) => Promise<unknown>, requestPermission?: () => Promise<boolean> }} [dependencies.android]
 * @param {{ query: () => Promise<{held: Array<{name: string}>}> }} [dependencies.locks]
 * @param {string} [dependencies.lockName]
 */
export function createSubscriptionRefreshPlatform({ runtime, storage, electron, electronTabs, android, locks, lockName }) {
  const handlesStorageProgress = runtime !== 'electron'

  function readProgress() {
    try {
      const value = storage.getItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      if (value === null) return null
      const state = JSON.parse(value)
      return {
        ...state,
        percentage: Number.isFinite(state.percentage)
          ? Math.min(100, Math.max(0, state.percentage))
          : 0,
      }
    } catch {
      return null
    }
  }

  function writeProgress(state) {
    try {
      storage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // The owner still has its renderer-local progress state.
    }
  }

  return {
    progressKey: SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY,
    handlesStorageProgress,
    startNotification: (id, title, cancelLabel) => android?.start(id, title, cancelLabel) ??
      Promise.resolve({ acquired: true, notificationsDenied: false }),
    publishStarted(detail) {
      if (handlesStorageProgress) writeProgress({ ...detail, percentage: 0 })
    },
    publishProgress(detail, percentage, fallbackTabId) {
      android?.update?.(detail.refreshId, percentage)
      if (runtime === 'electron') {
        electron.setProgress(detail.ownerTabId ?? fallbackTabId, percentage)
      } else {
        writeProgress({ ...readProgress(), percentage })
      }
    },
    publishFinished() {
      if (!handlesStorageProgress) return
      try {
        storage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      } catch {
        // The owner still clears its renderer-local progress state.
      }
    },
    backgroundCompleted(result) {
      return electron?.backgroundCompleted?.(result) ?? Promise.resolve()
    },
    async configureBackground(configuration, enabled) {
      if (runtime === 'electron') {
        await electron.configureBackground({ ...configuration, enabled })
        return false
      }
      if (runtime !== 'android') return false
      await android.configure(configuration)
      if (Object.values(configuration.intervals).some(interval => interval > 0)) {
        return android.requestPermission()
      }
      return false
    },
    isActive: () => runtime === 'electron' ? electronTabs.isActive() : Promise.resolve(true),
    async readInProgress() {
      if (runtime === 'electron') return electron.isInProgress()
      if (locks) {
        const { held } = await locks.query()
        const inProgress = held.some(lock => lock.name === lockName)
        if (!inProgress) storage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
        const progressState = inProgress ? readProgress() : null
        return {
          inProgress,
          percentage: progressState?.percentage ?? 0,
          tab: progressState?.tab ?? null,
        }
      }
      const progressState = readProgress()
      return {
        inProgress: progressState !== null,
        percentage: progressState?.percentage ?? 0,
        tab: progressState?.tab ?? null,
      }
    },
  }
}
