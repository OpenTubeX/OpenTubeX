/**
 * Marks a one-time notice as handled on this device.
 * @param {string} storageKey
 * @param {Storage} [storage]
 */
export function dismissNotice(storageKey, storage) {
  try {
    storage ??= localStorage
    storage.setItem(storageKey, 'done')
  } catch (error) {
    console.error(`Failed to dismiss ${storageKey}`, error)
  }
}

/**
 * Shows a notice in one window at a time until it is dismissed. Keep the lock
 * until the notice is handled. Closing or reloading its renderer releases the
 * lock automatically, leaving an undismissed notice for next time.
 * @param {string} storageKey
 * @param {(release: () => void) => void} showNotice
 */
export async function showNoticeOnce(storageKey, showNotice) {
  const show = () => {
    // Another window may have dismissed it since startup.
    if (localStorage.getItem(storageKey) === 'done') return
    return new Promise(resolve => showNotice(resolve))
  }
  try {
    if (navigator.locks) {
      await navigator.locks.request(storageKey, { ifAvailable: true }, lock => {
        if (lock) return show()
      })
    } else {
      await show()
    }
  } catch (error) {
    console.error(`Failed to show ${storageKey}`, error)
  }
}
