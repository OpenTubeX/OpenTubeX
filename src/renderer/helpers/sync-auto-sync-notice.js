import { dismissNotice, showNoticeOnce } from './oneTimeNotice.js'

const STORAGE_KEY = 'opentubex.sync-auto-sync-notice'

// Evaluate eligibility only on the first launch containing this notice. A new
// installation must not become eligible once it saves its first app version.
export function shouldShowAutoSyncNotice(lastUsedVersion, settings, storage) {
  try {
    storage ??= localStorage
    const state = storage.getItem(STORAGE_KEY)
    if (state === 'done') return false
    const eligible = Boolean(lastUsedVersion) && settings.syncServerEnabled &&
      Boolean(settings.syncServerToken) && settings.syncServerAutoSync === false &&
      !settings.syncServerResumeAutoSync
    if (!eligible) {
      storage.setItem(STORAGE_KEY, 'done')
      return false
    }
    storage.setItem(STORAGE_KEY, 'pending')
    return true
  } catch (error) {
    console.error('Failed to read the automatic sync notice state', error)
    return false
  }
}

export function dismissAutoSyncNotice(storage) {
  dismissNotice(STORAGE_KEY, storage)
}

export function showAutoSyncNoticeOnce(showNotice) {
  return showNoticeOnce(STORAGE_KEY, showNotice)
}
