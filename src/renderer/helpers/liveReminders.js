import { LocalNotifications } from '@capacitor/local-notifications'

const STORAGE_KEY = 'opentubex-capacitor-live-reminders'
const CHANNEL_ID = 'live-reminders'
const listeners = new Set()

export const supportsLiveReminders = Boolean(process.env.IS_ELECTRON || process.env.IS_CAPACITOR)

function readCapacitorReminders() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(records)
      ? records.filter(record => (
          typeof record?.videoId === 'string' &&
          Number.isInteger(record.notificationId) &&
          Number.isFinite(record.startTimestamp) &&
          record.startTimestamp > Date.now()
        ))
      : []
  } catch {
    return []
  }
}

function writeCapacitorReminders(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
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

function emitUpdated(videoId, scheduled) {
  for (const listener of listeners) listener(videoId, scheduled)
}

async function requestNotificationPermission() {
  let status = await LocalNotifications.checkPermissions()
  if (status.display !== 'granted') {
    status = await LocalNotifications.requestPermissions()
  }
  return status.display === 'granted'
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

  async schedule(reminder) {
    if (!await requestNotificationPermission()) return false

    const records = readCapacitorReminders()
    const notificationId = notificationIdForVideo(reminder.videoId, records)
    await LocalNotifications.cancel({ notifications: [{ id: notificationId }] })
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationId,
        title: reminder.notificationTitle,
        body: reminder.notificationBody,
        channelId: CHANNEL_ID,
        isExactNotification: false,
        foreground: true,
        schedule: {
          at: new Date(reminder.startTimestamp),
          allowWhileIdle: true,
        },
        extra: { videoId: reminder.videoId },
      }]
    })

    const record = { ...reminder, notificationId }
    writeCapacitorReminders([
      ...records.filter(item => item.videoId !== reminder.videoId),
      record,
    ])
    emitUpdated(reminder.videoId, true)
    return true
  },

  async cancel(videoId) {
    const records = readCapacitorReminders()
    const record = records.find(item => item.videoId === videoId)
    if (record) {
      await LocalNotifications.cancel({ notifications: [{ id: record.notificationId }] })
    }
    writeCapacitorReminders(records.filter(item => item.videoId !== videoId))
    emitUpdated(videoId, false)
    return record !== undefined
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

export async function initializeCapacitorLiveReminderActions(openVideo) {
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
    ({ extra }) => {
      const videoId = extra?.videoId
      if (typeof videoId !== 'string') return
      const records = readCapacitorReminders()
      writeCapacitorReminders(records.filter(item => item.videoId !== videoId))
      emitUpdated(videoId, false)
    }
  )

  return () => {
    actionHandle.remove()
    receivedHandle.remove()
  }
}
