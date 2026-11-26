import { getUploadTarget } from '../../notificationHistory'
import { parseTwitchChannelLogin } from '../../twitchFollows'
import { isAndroidBackgroundRenderer } from './androidBackgroundSync'
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
  'comment-reply': ['fas', 'reply'],
  'comment-heart': ['fas', 'heart'],
  'download-started': ['fas', 'download'],
  'download-completed': ['fas', 'download'],
  'download-failed': ['fas', 'circle-exclamation'],
  'app-update': ['fas', 'arrows-rotate'],
  'sync-blocked': ['fas', 'triangle-exclamation'],
  'youtube-signed-out': ['fas', 'circle-user'],
  'youtube-subscriptions': ['fas', 'subscriptions'],
  'tool-update-failed': ['fas', 'circle-exclamation']
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

// These notifications show the title of what they lead to as their body.
const BODY_IS_TITLE_KINDS = new Set(['video', 'short', 'live'])

/**
 * The title for a tab opened from the entry, which keeps it while unloaded.
 * @param {import('../../notificationHistory').NotificationHistoryEntry} entry
 * @returns {string | undefined}
 */
export function getNotificationTabTitle(entry) {
  return BODY_IS_TITLE_KINDS.has(entry.kind) ? entry.body || undefined : undefined
}

/**
 * Keeps news the app shows only as a toast in the bell, without a system
 * notification. The bell already holding it, for example because several
 * tabs report the same news, keeps it once.
 * @param {import('../../notificationHistory').NotificationHistoryInput} notification
 */
export function recordNotification(notification) {
  // Android's hidden renderer cannot update the app's bell.
  if (!supportsNotificationHistory || isAndroidBackgroundRenderer || store.getters.getNotificationMode !== 'both') return
  Promise.resolve(notificationHistory.record(notification))
    .catch(error => console.error('Failed to record a notification', error))
}

/**
 * @param {(entry: import('../../notificationHistory').NotificationHistoryEntry) => boolean} matches
 * @param {(id: string) => unknown} update
 */
async function updateNotifications(matches, update) {
  if (!supportsNotificationHistory || isAndroidBackgroundRenderer) return
  try {
    const entries = await notificationHistory.list()
    await Promise.all(entries.filter(matches).map(entry => update(entry.id)))
  } catch (error) {
    console.error('Failed to update the notification history', error)
  }
}

/**
 * Removes the entries about news that no longer applies, like an installed update.
 * @param {(entry: import('../../notificationHistory').NotificationHistoryEntry) => boolean} isOver
 */
export function removeOverNotifications(isOver) {
  return updateNotifications(isOver, id => notificationHistory.remove(id))
}

/**
 * Marks the unread entries about news the user has seen read, also on other devices.
 * @param {(entry: import('../../notificationHistory').NotificationHistoryEntry) => boolean} isSeen
 */
function markSeenNotificationsRead(isSeen) {
  return updateNotifications(entry => !entry.read && isSeen(entry), id => notificationHistory.markRead(id))
}

// News about something to watch, which the user has seen once it plays.
const WATCH_KINDS = ['video', 'short', 'live', 'live-reminder']

/** @param {string} videoId */
export function markVideoNotificationsRead(videoId) {
  return markSeenNotificationsRead(entry => WATCH_KINDS.includes(entry.kind) && entry.path === `/watch/${videoId}`)
}

/** @param {string} login the Twitch channel whose live stream plays */
export function markTwitchLiveNotificationsRead(login) {
  return markSeenNotificationsRead(entry => entry.kind === 'live' && entry.path === '/external-media' &&
    parseTwitchChannelLogin(entry.query?.url) === login)
}

/**
 * Removes the entries about downloads that were played or removed.
 * @param {number[]} downloadIds
 */
export function removeDownloadNotifications(downloadIds) {
  const ids = new Set(downloadIds.map(String))
  return removeOverNotifications(entry => entry.kind.startsWith('download-') && ids.has(entry.query?.downloadId ?? ''))
}

/**
 * The settings section a notification leads to.
 * @param {string} section
 * @returns {{ path: string, query: Record<string, string> }}
 */
export function getSettingsNotificationTarget(section) {
  return { path: '/settings', query: { section } }
}

/** @type {((tagName: string | undefined) => void) | null} */
let showUpdate = null

/** @param {typeof showUpdate} handler shows the update an entry announces */
export function setUpdateNotificationHandler(handler) {
  showUpdate = handler
}

/**
 * Opens the entry's view, or its page in a new tab, so it does not replace
 * the page in use.
 * @param {import('../../notificationHistory').NotificationHistoryEntry} entry
 */
export function openNotificationEntry(entry) {
  if (!entry.read) notificationHistory.markRead(entry.id)
  if (entry.path === '/downloads') {
    store.dispatch('showSettingsWindow', 'downloads')
  } else if (entry.path === '/settings') {
    store.commit('setSettingsWindowSection', entry.query?.section ?? null)
    store.dispatch('showSettingsWindow')
  } else if (entry.path === '/update') {
    showUpdate?.(entry.query?.version)
  } else {
    // A toast can be opened while settings cover the page it navigates.
    store.dispatch('hideSettingsWindow')
    openInternalPath({
      path: entry.path,
      query: entry.query,
      title: getNotificationTabTitle(entry),
      doCreateNewTab: true
    })
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
