import { liveReminder } from './liveReminders.js'

function validReminder(record, now) {
  return record && /^[\w-]{11}$/.test(record.videoId) &&
    Number.isFinite(record.startTimestamp) && record.startTimestamp > now &&
    typeof record.notificationTitle === 'string' && record.notificationTitle.length > 0 &&
    record.notificationTitle.length <= 200 &&
    typeof record.notificationBody === 'string' && record.notificationBody.length > 0 &&
    record.notificationBody.length <= 500
}

function byVideoId(records, now) {
  return new Map((Array.isArray(records) ? records : [])
    .filter(record => validReminder(record, now))
    .map(({ videoId, startTimestamp, notificationTitle, notificationBody }) => [
      videoId, { videoId, startTimestamp, notificationTitle, notificationBody }
    ]))
}

export function mergeLiveReminders(localRecords, remoteRecords, previousRecords, now = Date.now()) {
  const local = byVideoId(localRecords, now)
  const remote = byVideoId(remoteRecords, now)
  const previous = byVideoId(previousRecords, now)
  const merged = []
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const localRecord = local.get(id)
    const remoteRecord = remote.get(id)
    const prior = previous.get(id)
    if (!localRecord && !remoteRecord) continue
    if (!localRecord || !remoteRecord) {
      const survivor = localRecord ?? remoteRecord
      // Preserve a reschedule made concurrently with a cancellation.
      if (!prior || JSON.stringify(survivor) !== JSON.stringify(prior)) merged.push(survivor)
      continue
    }
    const localChanged = JSON.stringify(localRecord) !== JSON.stringify(prior)
    merged.push(localChanged ? localRecord : remoteRecord ?? localRecord)
  }
  return merged.sort((a, b) => a.videoId.localeCompare(b.videoId))
}

export async function syncLiveReminders(client, previousRecords = [], reminderService = liveReminder) {
  const [local, remote] = await Promise.all([
    reminderService.list(), client.getLiveReminders()
  ])
  const now = Date.now()
  const merged = mergeLiveReminders(local, remote, previousRecords, now)
  const localById = byVideoId(local, now)
  const mergedIds = new Set(merged.map(record => record.videoId))

  for (const reminder of merged) {
    if (JSON.stringify(localById.get(reminder.videoId)) !== JSON.stringify(reminder) &&
        !await reminderService.schedule(reminder)) {
      // Notifications may be unavailable or permission may be denied. Keep
      // this collection pending without preventing other data from syncing.
      return null
    }
  }
  for (const id of localById.keys()) {
    if (!mergedIds.has(id)) await reminderService.cancel(id)
  }
  const normalizedRemote = [...byVideoId(remote, now).values()]
    .sort((a, b) => a.videoId.localeCompare(b.videoId))
  if (JSON.stringify(normalizedRemote) !== JSON.stringify(merged)) {
    await client.putLiveReminders(merged)
  }
  return merged
}
