import { LocalNotifications } from '@capacitor/local-notifications'
import { cancelAndroidUploadNotifications } from './androidSubscriptionRefresh.js'

/**
 * The system notification ID of a video's reminder. Scheduling moves to the
 * next free ID in the rare case that another reminder has it.
 * @param {string} videoId
 */
export function getLiveReminderNotificationId(videoId) {
  let id = 0x811c9dc5
  for (const character of videoId) {
    id ^= character.codePointAt(0)
    id = Math.imul(id, 0x01000193)
  }
  return id >>> 1
}

const UPLOAD_FEED_TYPES = { video: 'videos', live: 'live', short: 'shorts', post: 'posts' }

/**
 * Removes the system notifications of entries that were read or removed.
 * @param {import('../../notificationHistory').NotificationHistoryTarget[]} targets
 */
export async function closeCapacitorSystemNotifications(targets) {
  if (!process.env.IS_CAPACITOR) return
  const reminderIds = []
  const uploads = []
  for (const { kind, path } of targets) {
    const id = path.split('/').at(-1)
    if (kind === 'live-reminder') reminderIds.push(getLiveReminderNotificationId(id))
    else if (kind in UPLOAD_FEED_TYPES) uploads.push({ feedType: UPLOAD_FEED_TYPES[kind], id })
  }
  try {
    await Promise.all([
      reminderIds.length > 0 && LocalNotifications.removeDeliveredNotificationsById({ ids: reminderIds }),
      uploads.length > 0 && cancelAndroidUploadNotifications(uploads)
    ])
  } catch (error) {
    console.error('Failed to remove system notifications', error)
  }
}
