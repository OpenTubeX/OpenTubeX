import { LocalNotifications } from '@capacitor/local-notifications'
import { REMINDER_EARLY_MS } from '../../notificationHistory.js'
import { cancelAndroidUploadNotifications } from './androidSubscriptionRefresh.js'
import { getTwitchNotificationId, parseTwitchChannelLogin } from '../../twitchFollows.js'

const UPLOAD_FEED_TYPES = { video: 'videos', live: 'live', short: 'shorts', post: 'posts' }

/**
 * The ID of the system notification for a Twitch broadcast on iOS, where the
 * app announces streams itself.
 * @param {string} streamId
 */
export function getTwitchLocalNotificationId(streamId) {
  let hash = 0x811c9dc5
  for (const character of `twitch:${streamId}`) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 1
}

/**
 * The ID of the system notification for a reply to the account's comment.
 * @param {string} replyId
 */
export function getCommentReplyLocalNotificationId(replyId) {
  let hash = 0x811c9dc5
  for (const character of `comment-reply:${replyId}`) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 1
}

/**
 * Removes the shown notifications of these reminders. Android may deliver
 * inexact alarms well after their time, so reminders already in the history can
 * still be waiting for theirs. Reminders for another premiere of the same video stay.
 * @param {Map<string, number>} dueTimes when each video's reminder was due
 */
async function closeReminders(dueTimes) {
  const now = Date.now()
  const { notifications } = await LocalNotifications.getAll()
  const reminders = notifications.filter(({ extra, schedule }) => {
    const due = dueTimes.get(extra?.videoId)
    const at = new Date(schedule?.at ?? Number.NaN).getTime()
    // A later premiere is due after the entry. Delivered notifications may come without their schedule.
    return due !== undefined && (Number.isNaN(at) || at <= due + REMINDER_EARLY_MS)
  })
  const overdue = reminders.filter(({ schedule }) => new Date(schedule?.at ?? Number.NaN).getTime() <= now)
  await Promise.all([
    reminders.length > 0 && LocalNotifications.removeDeliveredNotificationsById({ ids: reminders.map(({ id }) => id) }),
    overdue.length > 0 && LocalNotifications.cancel({ notifications: overdue.map(({ id }) => ({ id })) })
  ])
}

/**
 * Removes the system notifications of entries that were read or removed.
 * @param {import('../../notificationHistory').NotificationHistoryEntry[]} entries
 */
export async function closeCapacitorSystemNotifications(entries) {
  if (!process.env.IS_CAPACITOR) return
  /** @type {Map<string, number>} */
  const reminders = new Map()
  const uploads = []
  /** @type {number[]} replies and Twitch broadcasts that iOS announced itself */
  const localIds = []
  for (const { kind, path, query, createdAt } of entries) {
    const id = path.split('/').at(-1)
    const twitchLogin = path === '/external-media' ? parseTwitchChannelLogin(query?.url) : null
    if (kind === 'live-reminder') reminders.set(id, createdAt)
    else if (kind === 'comment-reply' && query?.commentId && process.env.IS_IOS) localIds.push(getCommentReplyLocalNotificationId(query.commentId))
    // Android announces replies like uploads
    else if (kind === 'comment-reply' && query?.commentId) uploads.push({ feedType: 'comment-reply', id: `${id}/${query.commentId}` })
    else if (twitchLogin && query?.stream && process.env.IS_IOS) localIds.push(getTwitchLocalNotificationId(query.stream))
    else if (twitchLogin && query?.stream) uploads.push({ feedType: 'twitch', id: getTwitchNotificationId(twitchLogin, query.stream) })
    else if (kind in UPLOAD_FEED_TYPES) uploads.push({ feedType: UPLOAD_FEED_TYPES[kind], id })
  }
  try {
    await Promise.all([
      reminders.size > 0 && closeReminders(reminders),
      uploads.length > 0 && cancelAndroidUploadNotifications(uploads),
      localIds.length > 0 && LocalNotifications.removeDeliveredNotificationsById({ ids: localIds })
    ])
  } catch (error) {
    console.error('Failed to remove system notifications', error)
  }
}
