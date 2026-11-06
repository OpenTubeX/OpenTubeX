import { registerPlugin } from '@capacitor/core'

// Android freezes a hidden app. While a hold is active, the native side keeps
// the app and its WebView running so a sync can finish out of view.
const BackgroundSync = process.env.IS_CAPACITOR && !process.env.IS_IOS
  ? registerPlugin('BackgroundSync')
  : null

let periodicSyncEnabled = null

/** @returns {() => void} Releases the hold. */
export function holdBackgroundSync() {
  if (!BackgroundSync) return () => {}
  const hold = BackgroundSync.begin().catch(error => {
    console.error('Failed to keep Android sync running', error)
    return null
  })
  return () => {
    hold.then(result => result && BackgroundSync.end(result)).catch(error => {
      console.error('Failed to release Android sync', error)
    })
  }
}

/** Schedules or cancels the periodic sync of a hidden app. */
export function setPeriodicBackgroundSync(enabled) {
  if (!BackgroundSync || periodicSyncEnabled === enabled) return
  periodicSyncEnabled = enabled
  BackgroundSync.setEnabled({ enabled }).catch(error => {
    console.error('Failed to schedule Android background sync', error)
  })
}

/** @param {() => Promise<unknown>} sync Runs when the periodic job asks for a sync. */
export function onPeriodicBackgroundSync(sync) {
  BackgroundSync?.addListener('sync', ({ id }) => {
    Promise.resolve().then(sync)
      .catch(error => console.error('Android background sync failed', error))
      .finally(() => BackgroundSync.end({ id }).catch(() => {}))
  })
}
