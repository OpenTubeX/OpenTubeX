// @ts-check
import { Notification } from 'electron'

import { IpcChannels } from '../constants'
import { handleTrusted } from './ipc'
import { supportsNativeNotifications } from './nativeNotifications'

/**
 * @typedef {object} LiveReminderRequest
 * @property {string} videoId
 * @property {number} startTimestamp
 * @property {string} notificationTitle
 * @property {string} notificationBody
 */

/** @param {unknown} videoId @returns {videoId is string} */
function isValidVideoId(videoId) {
  return typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId)
}

/**
 * @param {unknown} text
 * @param {number} maxLength
 * @returns {text is string}
 */
function isNotificationText(text, maxLength) {
  return typeof text === 'string' && text.length > 0 && text.length <= maxLength
}

/**
 * @param {any} reminder Untrusted renderer input
 * @param {number} [now]
 * @returns {reminder is LiveReminderRequest}
 */
export function isValidLiveReminder(reminder, now = Date.now()) {
  return isValidVideoId(reminder?.videoId) &&
    Number.isFinite(reminder.startTimestamp) &&
    reminder.startTimestamp > now &&
    isNotificationText(reminder.notificationTitle, 200) &&
    isNotificationText(reminder.notificationBody, 500)
}

/**
 * Lets OpenTubeX pages schedule native notifications for upcoming streams.
 * Without notification support, they see no reminders and cannot add any.
 * @param {import('./LiveReminderManager').LiveReminderManager} liveReminderManager
 */
export function setupLiveReminderIpc(liveReminderManager) {
  const canNotify = () => supportsNativeNotifications(Notification)

  handleTrusted(IpcChannels.LIVE_REMINDER_GET, (_event, videoId) =>
    isValidVideoId(videoId) && canNotify() ? liveReminderManager.get(videoId) : null, null)

  handleTrusted(IpcChannels.LIVE_REMINDER_LIST, () =>
    canNotify() ? liveReminderManager.list() : [], [])

  handleTrusted(IpcChannels.LIVE_REMINDER_SCHEDULE, (_event, reminder) =>
    canNotify() && isValidLiveReminder(reminder) ? liveReminderManager.schedule(reminder) : false, false)

  handleTrusted(IpcChannels.LIVE_REMINDER_CANCEL, (_event, videoId) =>
    isValidVideoId(videoId) ? liveReminderManager.cancel(videoId) : false, false)
}
