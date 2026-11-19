import { LocalNotifications } from '@capacitor/local-notifications'
import { REMINDER_EARLY_MS, parseNotificationKey } from '../../notificationHistory.js'
import { isAndroidBackgroundRenderer, suppressAndroidNotifications } from './androidBackgroundSync.js'
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
 * The ID of the system notification for a reply to a watched comment, or a heart on the account's.
 * @param {'comment-reply' | 'comment-heart'} kind
 * @param {string} commentId the reply's, or the hearted comment's
 */
export function getCommentLocalNotificationId(kind, commentId) {
  let hash = 0x811c9dc5
  for (const character of `${kind}:${commentId}`) {
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
 * The notification Android shows for a target, which announces uploads,
 * Twitch broadcasts, replies and hearts alike, or null for other news.
 * @param {{ kind: string, path: string, query?: Record<string, string> }} target
 * @returns {{ feedType: string, id: string } | null}
 */
function getAndroidNotification({ kind, path, query }) {
  const id = path.split('/').at(-1)
  const commentId = kind === 'comment-reply' || kind === 'comment-heart' ? query?.commentId : undefined
  if (commentId) return { feedType: kind, id: `${id}/${commentId}` }
  const twitchLogin = path === '/external-media' ? parseTwitchChannelLogin(query?.url) : null
  if (twitchLogin && query?.stream) return { feedType: 'twitch', id: getTwitchNotificationId(twitchLogin, query.stream) }
  return kind in UPLOAD_FEED_TYPES ? { feedType: UPLOAD_FEED_TYPES[kind], id } : null
}

/**
 * Tells Android which notifications were read or removed, here or on another
 * device, so it leaves them out and removes the shown ones, also while the app is closed.
 * @param {import('../../notificationHistory').NotificationDismissals} dismissals
 */
export function suppressDismissedAndroidNotifications({ readThrough, clearedThrough, dismissals }) {
  if (!process.env.IS_CAPACITOR || process.env.IS_IOS) return
  const dismissed = dismissals.flatMap(({ key }) => {
    const target = parseNotificationKey(key)
    return (target && getAndroidNotification(target)) ?? []
  })
  // Marking all read or clearing records no key for each notification.
  suppressAndroidNotifications({ dismissed, dismissedThrough: Math.max(readThrough, clearedThrough) })
}

/**
 * Removes the system notifications of entries that were read or removed.
 * @param {import('../../notificationHistory').NotificationHistoryEntry[]} entries
 */
export async function closeCapacitorSystemNotifications(entries) {
  // The hidden renderer lacks the notification plugins. Android removes the
  // notifications it showed once told of the dismissals, and the app removes
  // reminders when it opens.
  if (!process.env.IS_CAPACITOR || isAndroidBackgroundRenderer) return
  /** @type {Map<string, number>} */
  const reminders = new Map()
  const uploads = []
  /** @type {number[]} replies, hearts, and Twitch broadcasts that iOS announced itself */
  const localIds = []
  for (const entry of entries) {
    const { kind, path, query, createdAt } = entry
    const commentId = kind === 'comment-reply' || kind === 'comment-heart' ? query?.commentId : undefined
    const twitchLogin = path === '/external-media' ? parseTwitchChannelLogin(query?.url) : null
    if (kind === 'live-reminder') reminders.set(path.split('/').at(-1), createdAt)
    else if (commentId && process.env.IS_IOS) localIds.push(getCommentLocalNotificationId(kind, commentId))
    else if (twitchLogin && query?.stream && process.env.IS_IOS) localIds.push(getTwitchLocalNotificationId(query.stream))
    else {
      const notification = getAndroidNotification(entry)
      if (notification) uploads.push(notification)
    }
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
