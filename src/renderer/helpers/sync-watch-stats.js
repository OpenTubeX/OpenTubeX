import { DBWatchStatsHandlers } from '../../datastores/handlers/index.js'
import { getCurrentSyncServerDeviceInfo } from './sync-server-sessions.js'

export function watchSecondsForDevice(localDays, devices, currentDeviceId, selectedDevice) {
  if (selectedDevice === 'local') return localDays
  const otherDevices = devices.filter(device => device.deviceId !== currentDeviceId)
  if (selectedDevice !== 'all') {
    return otherDevices.find(device => device.deviceId === selectedDevice)?.days ?? {}
  }
  const days = { ...localDays }
  for (const device of otherDevices) {
    for (const [date, seconds] of Object.entries(device.days ?? {})) {
      days[date] = (days[date] ?? 0) + seconds
    }
  }
  return days
}

export function mergeWatchStats(remote, localRecords, deviceId, deviceName, platform) {
  const days = Object.fromEntries(localRecords.map(({ date, seconds }) => [date, seconds]))
  const ownDevice = { deviceId, deviceName, platform, days }
  if (!Array.isArray(remote)) return [ownDevice]
  const index = remote.findIndex(device => device?.deviceId === deviceId)
  if (index === -1) return [...remote, ownDevice]
  return remote.map((device, position) => position === index ? ownDevice : device)
}

export async function syncWatchStats(client, store) {
  const { syncServerDeviceId, syncServerDeviceName } = store.state.settings
  const [remote, localRecords, deviceInfo] = await Promise.all([
    client.getWatchStats(),
    DBWatchStatsHandlers.find(),
    getCurrentSyncServerDeviceInfo(),
  ])
  const merged = mergeWatchStats(remote, localRecords, syncServerDeviceId, syncServerDeviceName, deviceInfo.platform)
  if (JSON.stringify(remote) !== JSON.stringify(merged)) {
    await client.putWatchStats(merged)
  }
  store.commit('setSyncedWatchStats', merged)
  return merged
}
