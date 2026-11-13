import { getUploadTarget } from '../../notificationHistory'
import { takeAndroidUploadNotifications } from './androidSubscriptionRefresh'
import { capacitorNotificationHistory } from './capacitorNotificationHistory'
import { collectFiredCapacitorReminders } from './liveReminders'
import { getVideoThumbnailUrl, openInternalPath, showToast } from './utils'
import i18n from '../i18n/index'
import store from '../store/index'

/** Only the desktop and mobile apps show system notifications. */
export const supportsNotificationHistory = !!(process.env.IS_ELECTRON || process.env.IS_CAPACITOR)

export const notificationHistory = process.env.IS_ELECTRON
  ? window.ftElectron.notificationHistory
  : capacitorNotificationHistory

export const NOTIFICATION_KIND_ICONS = {
  'live-reminder': ['fas', 'tower-broadcast'],
  live: ['fas', 'tower-broadcast'],
  video: ['fas', 'video'],
  short: ['fas', 'film'],
  post: ['fas', 'message'],
  'download-started': ['fas', 'download'],
  'download-completed': ['fas', 'download'],
  'download-failed': ['fas', 'circle-exclamation']
}

/**
 * Whether notifications may show thumbnails. Toasts and system notifications
 * cannot blur images, so blurred thumbnails leave them out too.
 */
export function notificationThumbnailsAllowed() {
  return store.getters.getThumbnailPreference !== 'hidden' && !store.getters.getBlurThumbnails
}

/**
 * The thumbnail for a notification about a video, following the thumbnail
 * settings. Some videos lack the default maximum resolution image, so this
 * uses the medium one, which is large enough for notifications.
 * @param {string} videoId
 * @returns {string | null}
 */
export function getNotificationThumbnailUrl(videoId) {
  if (!notificationThumbnailsAllowed()) return null
  const url = getVideoThumbnailUrl(videoId, store.getters.getBackendPreference,
    store.getters.getCurrentInvidiousInstanceUrl, store.getters.getThumbnailPreference)
  return url?.replace(/\/maxresdefault\.jpg$/, '/mqdefault.jpg') ?? null
}

/**
 * The thumbnail field of a notification about a video, empty with hidden thumbnails.
 * @param {string} videoId
 */
export function withThumbnail(videoId) {
  const thumbnail = getNotificationThumbnailUrl(videoId)
  return thumbnail ? { thumbnail } : {}
}

/** @param {import('../../notificationHistory').NotificationHistoryEntry} entry */
export function openNotificationEntry(entry) {
  if (!entry.read) notificationHistory.markRead(entry.id)
  if (entry.path === '/downloads') {
    store.dispatch('showSettingsWindow', 'downloads')
  } else {
    // A toast can be opened while settings cover the page it navigates.
    store.dispatch('hideSettingsWindow')
    openInternalPath({ path: entry.path, query: entry.query })
  }
}

/**
 * Shows a notification that arrived while the app is in use.
 * @param {import('../../notificationHistory').NotificationHistoryEntry} entry
 */
export function showInAppNotification(entry) {
  showToast({
    message: i18n.global.t('Display Label', { label: entry.title, value: entry.body }),
    icon: NOTIFICATION_KIND_ICONS[entry.kind],
    // The entry may predate hiding or blurring thumbnails.
    image: notificationThumbnailsAllowed() ? entry.thumbnail ?? null : null,
    // Notifications the user turned on stay when only important ones are shown.
    important: true,
    action: () => openNotificationEntry(entry)
  })
}

let collecting = null
let collectAgain = false

async function collectOnce() {
  collectFiredCapacitorReminders()
  const { notifications, dismissed } = await takeAndroidUploadNotifications()
  const additions = notifications.flatMap(({ feedType, id, live, title, body, createdAt, inApp, thumbnail }) => {
    const target = getUploadTarget(feedType, id, live === true)
    return target && typeof title === 'string' && typeof body === 'string' && Number.isFinite(createdAt)
      ? [{ title, body, createdAt, ...target, thumbnail, inApp: inApp === true }]
      : []
  })
  const inApp = new Set(additions.filter(addition => addition.inApp).map(({ path, createdAt }) => `${path} ${createdAt}`))
  const entries = capacitorNotificationHistory.add(additions)
  // Android records system notifications the user opened or dismissed after
  // showing them, so their entries exist by now.
  const handled = dismissed.flatMap(({ feedType, id, live }) => getUploadTarget(feedType, id, live === true) ?? [])
  if (handled.length > 0) capacitorNotificationHistory.markTargetsRead(handled)
  // Notifications may have changed mode while Android handed the uploads over.
  if (store.getters.getNotificationMode !== 'both') return
  for (const entry of entries) {
    // Read entries were dismissed on another device.
    if (!entry.read && inApp.has(`${entry.path} ${entry.createdAt}`)) showInAppNotification(entry)
  }
}

/**
 * Adds the notifications the mobile system showed without the app, such as
 * reminders and uploads found by closed-app refreshes, shows the uploads
 * Android left to the app because it was visible, and marks the ones the
 * user opened or dismissed in the system read.
 */
export function collectNotificationHistory() {
  if (!process.env.IS_CAPACITOR) return Promise.resolve()
  if (collecting) {
    // Android may have queued more since the running pass took its queue.
    collectAgain = true
    return collecting
  }
  collecting = (async () => {
    do {
      collectAgain = false
      await collectOnce()
    } while (collectAgain)
  })()
    .catch(error => console.error('Failed to collect shown notifications', error))
    .finally(() => { collecting = null })
  return collecting
}
