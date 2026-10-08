import { DBWatchStatsHandlers } from '../../datastores/handlers/index.js'
import { getCurrentSyncServerDeviceInfo } from './sync-server-sessions.js'

export function containsWatchStatsDevice(device, deviceId) {
  return device.deviceId === deviceId || (device.replacedDevices ?? [])
    .some(replaced => containsWatchStatsDevice(replaced, deviceId))
}

export function combineWatchStatsDays(current, previous, overlap) {
  if (!['max', 'sum'].includes(overlap)) throw new Error('Invalid watch stats overlap rule')
  const days = { ...current }
  for (const [date, seconds] of Object.entries(previous)) {
    days[date] = overlap === 'sum' ? (days[date] ?? 0) + seconds : Math.max(days[date] ?? 0, seconds)
  }
  return days
}

// A reset from any identity clears its combined group. Raw daily baselines let
// later watching from the other identities contribute without restoring old time.
export function createWatchStatsReset(devices, currentDeviceId, at) {
  const baselines = { [currentDeviceId]: {} }
  const collect = device => {
    if (device.deviceId !== currentDeviceId) baselines[device.deviceId] = { ...device.days }
    for (const replaced of device.replacedDevices ?? []) collect(replaced)
  }
  const current = devices.find(device => containsWatchStatsDevice(device, currentDeviceId))
  if (current) collect(current)
  return { at, baselines }
}

function watchStatsGroupReset(device, currentDeviceId, localReset) {
  let reset = device.deviceId === currentDeviceId ? localReset : device.reset
  for (const replaced of device.replacedDevices ?? []) {
    const childReset = watchStatsGroupReset(replaced, currentDeviceId, localReset)
    // A reset before this history was imported belongs only to its old group.
    if (childReset?.at > replaced.replacedAt && childReset.at > (reset?.at ?? 0)) reset = childReset
  }
  return reset
}

export function watchStatsDeviceDays(device, currentDeviceId, localDays, localReset = null, groupReset = null) {
  const reset = watchStatsGroupReset(device, currentDeviceId, localReset)
  if ((reset?.at ?? 0) > (groupReset?.at ?? 0)) groupReset = reset
  const rawDays = device.deviceId === currentDeviceId ? localDays : device.days
  const baseline = groupReset?.baselines[device.deviceId] ?? {}
  let days = Object.fromEntries(Object.entries(rawDays ?? {}).flatMap(([date, seconds]) => {
    const remaining = Math.max(0, seconds - (baseline[date] ?? 0))
    return remaining > 0 ? [[date, remaining]] : []
  }))
  for (const replaced of device.replacedDevices ?? []) {
    const inheritedReset = replaced.replacedAt <= (groupReset?.at ?? 0) ? groupReset : null
    days = combineWatchStatsDays(days,
      watchStatsDeviceDays(replaced, currentDeviceId, localDays, localReset, inheritedReset), replaced.overlap)
  }
  return days
}

export function watchSecondsForDevice(localDays, devices, currentDeviceId, selectedDevice, localReset = null) {
  const current = devices.find(device => containsWatchStatsDevice(device, currentDeviceId))
  const ownDays = current ? watchStatsDeviceDays(current, currentDeviceId, localDays, localReset) : localDays
  if (selectedDevice === 'local') return ownDays
  const otherDevices = devices.filter(device => device !== current)
  if (selectedDevice !== 'all') {
    const selected = otherDevices.find(device => device.deviceId === selectedDevice)
    return selected ? watchStatsDeviceDays(selected) : {}
  }
  const days = { ...ownDays }
  for (const device of otherDevices) {
    for (const [date, seconds] of Object.entries(watchStatsDeviceDays(device))) {
      days[date] = (days[date] ?? 0) + seconds
    }
  }
  return days
}

export function mergeWatchStats(remote, localRecords, deviceId, deviceName, platform, reset = null) {
  const days = Object.fromEntries(localRecords.map(({ date, seconds }) => [date, seconds]))
  const ownDevice = { deviceId, deviceName, platform, days, ...(reset ? { reset: JSON.parse(JSON.stringify(reset)) } : {}) }
  if (!Array.isArray(remote)) return [ownDevice]
  const index = remote.findIndex(device => containsWatchStatsDevice(device, deviceId))
  if (index === -1) return [...remote, ownDevice]
  const update = device => device.deviceId === deviceId
    ? { ...device, ...ownDevice }
    : containsWatchStatsDevice(device, deviceId)
      ? { ...device, replacedDevices: device.replacedDevices.map(update) }
      : device
  return remote.map((device, position) => position === index ? update(device) : device)
}

export function replaceWatchStatsDevice(devices, currentDeviceId, sourceDeviceId, overlap, replacedAt) {
  const target = devices.find(device => containsWatchStatsDevice(device, currentDeviceId))
  const source = devices.find(device => device.deviceId === sourceDeviceId)
  if (!target || !source || source === target || !['max', 'sum'].includes(overlap)) {
    throw new Error('Invalid watch stats replacement')
  }
  return devices.filter(device => device !== source).map(device => device === target
    ? { ...target, replacedDevices: [...(target.replacedDevices ?? []), { ...source, overlap, replacedAt }] }
    : device)
}

export async function syncWatchStats(client, store) {
  const { syncServerDeviceId, syncServerDeviceName, syncServerWatchStatsReset } = store.state.settings
  const [remote, localRecords, deviceInfo] = await Promise.all([
    client.getWatchStats(),
    DBWatchStatsHandlers.find(),
    getCurrentSyncServerDeviceInfo(),
  ])
  const merged = mergeWatchStats(remote, localRecords, syncServerDeviceId, syncServerDeviceName,
    deviceInfo.platform, syncServerWatchStatsReset)
  if (JSON.stringify(remote) !== JSON.stringify(merged)) {
    await client.putWatchStats(merged)
  }
  store.commit('setSyncedWatchStats', merged)
  return merged
}
