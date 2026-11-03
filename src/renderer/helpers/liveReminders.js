import { LocalNotifications } from '@capacitor/local-notifications'
import { getLiveReminderTarget } from '../../notificationHistory.js'
import { capacitorNotificationHistory } from './capacitorNotificationHistory.js'

const STORAGE_KEY = 'opentubex-capacitor-live-reminders'
// Whether the system schedule is paused because notifications are off.
const PAUSED_STORAGE_KEY = 'opentubex-capacitor-live-reminders-paused'
const CHANNEL_ID = 'live-reminders'
const listeners = new Set()
/** @type {import('../../main/notificationHistory').NotificationMode} */
let notificationMode = 'both'

export const supportsLiveReminders = Boolean(process.env.IS_ELECTRON || process.env.IS_CAPACITOR)

/** Every stored reminder, including those that are due. */
function readStoredReminders() {
  let records
  try {
    records = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
  return Array.isArray(records)
    ? records.filter(record => (
        typeof record?.videoId === 'string' &&
        Number.isInteger(record.notificationId) &&
        Number.isFinite(record.startTimestamp)
      ))
    : []
}

/**
 * Returns the reminders that have yet to fire. The system shows the others
 * without the app, so they move to the notification history here.
 */
function readCapacitorReminders() {
  const valid = readStoredReminders()
  const now = Date.now()
  const pending = valid.filter(record => record.startTimestamp > now)
  if (pending.length < valid.length) {
    recordFiredReminders(valid.filter(record => record.startTimestamp <= now))
    writeCapacitorReminders(pending)
  }
  return pending
}

function writeCapacitorReminders(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

function recordFiredReminders(records) {
  if (notificationMode !== 'both') return []
  return capacitorNotificationHistory.add(records
    .filter(record => typeof record.notificationTitle === 'string' && typeof record.notificationBody === 'string')
    .map(record => ({
      title: record.notificationTitle,
      body: record.notificationBody,
      thumbnail: record.thumbnail,
      createdAt: record.startTimestamp,
      ...getLiveReminderTarget(record.videoId)
    })))
}

/** Moves the reminders the system has shown since the app last checked to the notification history. */
export function collectFiredCapacitorReminders() {
  if (process.env.IS_CAPACITOR) readCapacitorReminders()
}

function notificationIdForVideo(videoId, records) {
  const existing = records.find(record => record.videoId === videoId)
  if (existing) return existing.notificationId

  let id = 0x811c9dc5
  for (const character of videoId) {
    id ^= character.codePointAt(0)
    id = Math.imul(id, 0x01000193)
  }
  id = id >>> 1
  const usedIds = new Set(records.map(record => record.notificationId))
  while (usedIds.has(id)) id = (id + 1) & 0x7fffffff
  return id
}

async function scheduleSystemReminder(record) {
  await LocalNotifications.cancel({ notifications: [{ id: record.notificationId }] })
  await LocalNotifications.schedule({
    notifications: [{
      id: record.notificationId,
      title: record.notificationTitle,
      body: record.notificationBody,
      channelId: CHANNEL_ID,
      isExactNotification: false,
      foreground: true,
      schedule: {
        at: new Date(record.startTimestamp),
        allowWhileIdle: true,
      },
      extra: { videoId: record.videoId },
    }]
  })
}

function isPaused() {
  return localStorage.getItem(PAUSED_STORAGE_KEY) === 'true'
}

let modeChange = Promise.resolve()

/**
 * Applies the notification mode to the reminders the system schedules. Turning
 * notifications off pauses them; turning them on again schedules them again.
 * @param {import('../../main/notificationHistory').NotificationMode} mode
 */
export function applyCapacitorNotificationMode(mode) {
  notificationMode = mode
  if (!process.env.IS_CAPACITOR) return Promise.resolve()
  // One change at a time, so turning notifications off waits for a resume to
  // finish scheduling and then cancels everything it scheduled.
  modeChange = modeChange.then(() => applyPausedState(mode))
    .catch(error => console.error('Failed to apply the notification mode', error))
  return modeChange
}

/** @param {import('../../main/notificationHistory').NotificationMode} mode */
async function applyPausedState(mode) {
  const paused = mode === 'off'
  // Off always cancels, since a resume that failed partway can leave alarms scheduled.
  if (paused || isPaused()) {
    const stored = readStoredReminders()
    // Reminders that expired while paused never fired, so they leave without a history entry.
    const pending = stored.filter(record => record.startTimestamp > Date.now())
    writeCapacitorReminders(pending)
    try {
      if (paused) {
        // Reminders are the only scheduled notifications. Cancelling every pending one also
        // covers alarms that are overdue but undelivered, whose records may be gone.
        const { notifications } = await LocalNotifications.getPending()
        if (notifications.length > 0) await LocalNotifications.cancel({ notifications: notifications.map(({ id }) => ({ id })) })
      } else if (pending.length > 0 && (await LocalNotifications.checkPermissions()).display === 'granted') {
        for (const record of pending) await scheduleSystemReminder(record)
      }
      // Saved only once the system accepted the change, so a failed one is tried again.
      localStorage.setItem(PAUSED_STORAGE_KEY, String(paused))
    } catch (error) {
      console.error('Failed to update the live reminder schedule', error)
    }
  }
  armForegroundReminders()
}

// While the app is visible with notifications in the app, it shows reminders
// itself shortly before the system would, and cancels the system's.
// Generous, since a busy page runs its timers late.
const FOREGROUND_LEAD_MS = 3000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const foregroundTimers = new Map()
/** @type {((entry: import('../../notificationHistory').NotificationHistoryEntry) => void) | null} */
let showForegroundReminder = null

function isAppVisible() {
  return document.visibilityState === 'visible'
}

let armGeneration = 0
// Alarms already shown, so the timer and a late system delivery show each only once.
// Scheduling a reminder again clears its ID.
const handledAlarms = new Set()

// Follows the system's scheduled alarms. Once an alarm's time passed, the
// plugin cannot tell whether it was delivered, so the received handler covers
// alarms the system delivers late.
async function armForegroundReminders() {
  const generation = ++armGeneration
  for (const timer of foregroundTimers.values()) clearTimeout(timer)
  foregroundTimers.clear()
  if (!showForegroundReminder || notificationMode !== 'both' || !isAppVisible()) return
  let pending
  try {
    ({ notifications: pending } = await LocalNotifications.getAll({ state: 'SCHEDULED' }))
  } catch (error) {
    console.error('Failed to read scheduled reminders', error)
    return
  }
  if (generation !== armGeneration) return
  for (const notification of pending) {
    const at = new Date(notification.schedule?.at ?? Number.NaN).getTime()
    if (typeof notification.extra?.videoId !== 'string' || !Number.isFinite(at) || handledAlarms.has(notification.id)) continue
    const delay = at - Date.now() - FOREGROUND_LEAD_MS
    if (delay > MAX_TIMER_DELAY_MS) continue
    foregroundTimers.set(notification.id, setTimeout(() => showReminderInApp(notification), Math.max(0, delay)))
  }
}

/** @param {import('@capacitor/local-notifications').LocalNotificationSchema} notification */
async function showReminderInApp({ id, title, body, extra }) {
  foregroundTimers.delete(id)
  if (!showForegroundReminder || notificationMode !== 'both' || !isAppVisible() || handledAlarms.has(id)) return
  handledAlarms.add(id)
  let entry
  try {
    entry = await takeFiredReminderEntry(extra.videoId, Date.now(), { title, body })
  } catch (error) {
    // Without an entry, the system notification is the only way to show the reminder.
    handledAlarms.delete(id)
    console.error('Failed to record a reminder shown in the app', error)
    return
  }
  await LocalNotifications.cancel({ notifications: [{ id }] })
    .catch(error => console.error('Failed to cancel a reminder shown in the app', error))
  emitUpdated(extra.videoId, false)
  if (entry) showForegroundReminder(entry)
}

/**
 * Moves a reminder the app shows itself to the history. Reading the reminders
 * after they are due may have moved it already, so that entry is reused.
 * @param {string} videoId
 * @param {number} due
 * @param {{ title?: string, body?: string }} [notification] the system notification, for reminders without a record
 */
async function takeFiredReminderEntry(videoId, due, notification = {}) {
  const stored = readStoredReminders()
  const record = stored.find(item => item.videoId === videoId)
  if (record) {
    // Recorded first, so a failed history write keeps the reminder.
    const [entry] = recordFiredReminders([{ ...record, startTimestamp: Math.min(record.startTimestamp, due) }])
    writeCapacitorReminders(stored.filter(item => item !== record))
    return entry
  }
  if (notificationMode !== 'both') return undefined
  const target = getLiveReminderTarget(videoId)
  const existing = (await capacitorNotificationHistory.list())
    .find(item => item.kind === 'live-reminder' && item.path === target.path)
  if (existing || typeof notification.title !== 'string' || typeof notification.body !== 'string') return existing
  return capacitorNotificationHistory.add([{ title: notification.title, body: notification.body, createdAt: due, ...target }])[0]
}

function emitUpdated(videoId, scheduled) {
  for (const listener of listeners) listener(videoId, scheduled)
}

async function requestNotificationPermission() {
  let status = await LocalNotifications.checkPermissions()
  // Only prompt while the system still allows it; a denied permission would
  // otherwise be requested again by every automatic sync of remote reminders.
  if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
    status = await LocalNotifications.requestPermissions()
  }
  return status.display === 'granted'
}

async function scheduleReminder(reminder) {
  // The premiere may have started before the reminder was toggled or while the
  // permission prompt was open, and a past start cannot be scheduled. A reminder
  // being rescheduled would otherwise still fire at its old time.
  const started = async () => {
    if (reminder.startTimestamp > Date.now()) return false
    await cancelReminder(reminder.videoId)
    return true
  }
  // Synced reminders are kept while notifications are off, and scheduled once they are on again.
  const paused = isPaused()
  if (await started() || (!paused && !await requestNotificationPermission()) || await started()) return false

  const records = readCapacitorReminders()
  const record = { ...reminder, notificationId: notificationIdForVideo(reminder.videoId, records) }
  handledAlarms.delete(record.notificationId)
  if (!paused) await scheduleSystemReminder(record)
  // Read again, since the app may have shown another reminder meanwhile and removed its record.
  writeCapacitorReminders([
    ...readStoredReminders().filter(item => item.videoId !== reminder.videoId),
    record,
  ])
  emitUpdated(reminder.videoId, true)
  return true
}

/**
 * @template T
 * @param {() => Promise<T>} task
 */
function afterModeChange(task) {
  const result = modeChange.then(task)
  modeChange = result.then(() => {}, () => {})
  return result
}

/** @param {string} videoId */
async function cancelReminder(videoId) {
  const records = readCapacitorReminders()
  const record = records.find(item => item.videoId === videoId)
  if (record) {
    await LocalNotifications.cancel({ notifications: [{ id: record.notificationId }] })
  }
  writeCapacitorReminders(records.filter(item => item.videoId !== videoId))
  emitUpdated(videoId, false)
  return record !== undefined
}

const capacitorLiveReminder = {
  async get(videoId) {
    const records = readCapacitorReminders()
    writeCapacitorReminders(records)
    return records.find(record => record.videoId === videoId) ?? null
  },

  async list() {
    const records = readCapacitorReminders()
      .sort((left, right) => left.startTimestamp - right.startTimestamp)
    writeCapacitorReminders(records)
    return records
  },

  /**
   * Runs between mode changes, so turning notifications off also cancels a
   * reminder that was being scheduled meanwhile.
   */
  schedule(reminder) {
    return afterModeChange(() => scheduleReminder(reminder))
  },
  /** Runs between mode changes, so a resume cannot schedule the reminder again. */
  cancel(videoId) {
    return afterModeChange(() => cancelReminder(videoId))
  },
  onUpdated(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

const unavailableLiveReminder = {
  async get() { return null },
  async list() { return [] },
  async schedule() { return false },
  async cancel() { return false },
  onUpdated() { return () => {} },
}

export const liveReminder = process.env.IS_ELECTRON
  ? window.ftElectron.liveReminder
  : process.env.IS_CAPACITOR ? capacitorLiveReminder : unavailableLiveReminder

/**
 * @param {(videoId: string) => void} openVideo
 * @param {(entry: import('../../notificationHistory').NotificationHistoryEntry) => void} showInApp
 *   shows a reminder that arrives while the app is in use
 */
export async function initializeCapacitorLiveReminderActions(openVideo, showInApp) {
  if (!process.env.IS_CAPACITOR) return () => {}

  const actionHandle = await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    ({ notification }) => {
      const videoId = notification.extra?.videoId
      if (typeof videoId === 'string') openVideo(videoId)
    }
  )
  const receivedHandle = await LocalNotifications.addListener(
    'localNotificationReceived',
    async ({ id, extra }) => {
      const videoId = extra?.videoId
      if (typeof videoId !== 'string') return
      const due = Date.now()
      if (notificationMode === 'system' || (notificationMode === 'both' && !isAppVisible())) {
        // The system notification stays, including for deliveries Android
        // reports while the app is in the background.
        readCapacitorReminders()
        emitUpdated(videoId, false)
        return
      }
      // The app is in use, so it shows the reminder instead of the system.
      const removeDelivered = () => LocalNotifications.removeDeliveredNotifications({ notifications: [{ id, title: '', body: '' }] })
        .catch(error => console.error('Failed to remove a delivered reminder', error))
      if (handledAlarms.has(id)) {
        await removeDelivered()
        return
      }
      handledAlarms.add(id)
      let entry
      try {
        entry = await takeFiredReminderEntry(videoId, due)
      } catch (error) {
        // Keep the system notification when the app cannot record the reminder.
        handledAlarms.delete(id)
        console.error('Failed to record a delivered reminder', error)
        return
      }
      // Without an entry to show in the app, the system notification stays.
      if (notificationMode === 'both' && !entry) {
        handledAlarms.delete(id)
        emitUpdated(videoId, false)
        return
      }
      await removeDelivered()
      try {
        readCapacitorReminders()
      } catch (error) {
        console.error('Failed to collect fired reminders', error)
      }
      emitUpdated(videoId, false)
      if (entry && notificationMode === 'both') showInApp(entry)
    }
  )

  showForegroundReminder = showInApp
  const removeUpdateListener = capacitorLiveReminder.onUpdated(armForegroundReminders)
  document.addEventListener('visibilitychange', armForegroundReminders)
  armForegroundReminders()

  return () => {
    actionHandle.remove()
    receivedHandle.remove()
    removeUpdateListener()
    document.removeEventListener('visibilitychange', armForegroundReminders)
    showForegroundReminder = null
    armForegroundReminders()
  }
}
