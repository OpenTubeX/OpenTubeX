import { LocalNotifications } from '@capacitor/local-notifications'
import { cancelAndroidUploadNotifications } from './androidSubscriptionRefresh.js'

const UPLOAD_FEED_TYPES = { video: 'videos', live: 'live', short: 'shorts', post: 'posts' }

/**
 * Removes the shown notifications of these videos' reminders. Android may
 * deliver inexact alarms well after their time, so reminders already in the
 * history can still be waiting for theirs. Alarms for a later premiere of the
 * same video stay.
 * @param {Set<string>} videoIds
 */
async function closeReminders(videoIds) {
  const now = Date.now()
  const { notifications } = await LocalNotifications.getAll()
  const reminders = notifications.filter(({ extra }) => videoIds.has(extra?.videoId))
  const overdue = reminders.filter(({ schedule }) => new Date(schedule?.at ?? Number.NaN).getTime() <= now)
  await Promise.all([
    reminders.length > 0 && LocalNotifications.removeDeliveredNotificationsById({ ids: reminders.map(({ id }) => id) }),
    overdue.length > 0 && LocalNotifications.cancel({ notifications: overdue.map(({ id }) => ({ id })) })
  ])
}

/**
 * Removes the system notifications of entries that were read or removed.
 * @param {import('../../notificationHistory').NotificationHistoryTarget[]} targets
 */
export async function closeCapacitorSystemNotifications(targets) {
  if (!process.env.IS_CAPACITOR) return
  const reminders = new Set()
  const uploads = []
  for (const { kind, path } of targets) {
    const id = path.split('/').at(-1)
    if (kind === 'live-reminder') reminders.add(id)
    else if (kind in UPLOAD_FEED_TYPES) uploads.push({ feedType: UPLOAD_FEED_TYPES[kind], id })
  }
  try {
    await Promise.all([
      reminders.size > 0 && closeReminders(reminders),
      uploads.length > 0 && cancelAndroidUploadNotifications(uploads)
    ])
  } catch (error) {
    console.error('Failed to remove system notifications', error)
  }
}
