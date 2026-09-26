import { IpcChannels } from '../constants.js'
import { isValidVideoId } from './utils.js'

/**
 * @typedef {{ videoId: string, startTimestamp: number, notificationTitle: string, notificationBody: string }} LiveReminderPayload
 * @typedef {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle'>,
 *   isTrustedUrl: (url: string) => boolean,
 *   canNotify: () => boolean,
 *   manager: Pick<import('./LiveReminderManager').LiveReminderManager, 'get' | 'list' | 'schedule' | 'cancel'>
 * }} LiveReminderIpcDependencies
 */

/** @param {LiveReminderIpcDependencies} dependencies */
export function registerLiveReminderIpc({ ipcMain, isTrustedUrl, canNotify, manager }) {
  const isValidLiveReminderSender = event => isTrustedUrl(event.senderFrame.url)

  /**
   * @param {unknown} value
   * @returns {value is LiveReminderPayload}
   */
  function isValidReminder(value) {
    if (value === null || typeof value !== 'object') return false
    const reminder = /** @type {Partial<LiveReminderPayload>} */ (value)
    return isValidVideoId(reminder.videoId) &&
      Number.isFinite(reminder.startTimestamp) &&
      reminder.startTimestamp > Date.now() &&
      typeof reminder.notificationTitle === 'string' &&
      reminder.notificationTitle.length > 0 &&
      reminder.notificationTitle.length <= 200 &&
      typeof reminder.notificationBody === 'string' &&
      reminder.notificationBody.length > 0 &&
      reminder.notificationBody.length <= 500
  }

  ipcMain.handle(IpcChannels.LIVE_REMINDER_GET, (event, videoId) => {
    if (!isValidLiveReminderSender(event) || !isValidVideoId(videoId) || !canNotify()) {
      return null
    }
    return manager.get(videoId)
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_LIST, (event) => {
    if (!isValidLiveReminderSender(event) || !canNotify()) {
      return []
    }
    return manager.list()
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_SCHEDULE, (event, reminder) => {
    if (!isValidLiveReminderSender(event) || !canNotify() || !isValidReminder(reminder)) {
      return false
    }
    return manager.schedule(reminder)
  })

  ipcMain.handle(IpcChannels.LIVE_REMINDER_CANCEL, (event, videoId) => {
    if (!isValidLiveReminderSender(event) || !isValidVideoId(videoId)) {
      return false
    }
    return manager.cancel(videoId)
  })
}
