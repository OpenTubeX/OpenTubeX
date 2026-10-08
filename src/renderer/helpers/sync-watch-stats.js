import { DBWatchStatsHandlers } from '../../datastores/handlers/index.js'
import { getCurrentSyncServerDeviceInfo } from './sync-server-sessions.js'

function findWatchStatsDevice(device, deviceId) {
  if (device.deviceId === deviceId) return device
  return (device.replacedDevices ?? []).map(replaced => findWatchStatsDevice(replaced, deviceId)).find(Boolean)
}

export function containsWatchStatsDevice(device, deviceId) {
  return Boolean(findWatchStatsDevice(device, deviceId))
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
  const epochs = {}
  let generation = 0
  const collect = device => {
    epochs[device.deviceId] = device.reset?.id ?? null
    generation = Math.max(generation, device.reset?.generation ?? 0)
    if (device.deviceId !== currentDeviceId) baselines[device.deviceId] = { ...device.days }
    for (const replaced of device.replacedDevices ?? []) collect(replaced)
  }
  const current = devices.find(device => containsWatchStatsDevice(device, currentDeviceId))
  if (current) collect(current)
  return { id: crypto.randomUUID(), at, epochs, generation: generation + 1, origin: currentDeviceId, baselines, ...(!current ? { pending: true } : {}) }
}

function newerWatchStatsReset(reset, previous) {
  return reset && (!previous || reset.generation > previous.generation ||
    (reset.generation === previous.generation && reset.origin > previous.origin))
}

function resolveWatchStatsReset(devices, deviceId, reset) {
  if (!reset?.pending) return reset
  const current = devices.map(device => findWatchStatsDevice(device, deviceId)).find(Boolean)
  if (current?.reset?.id === reset.id && !current.reset.pending) return current.reset
  // A disconnected reset has no repaired tree. Complete its baselines once the
  // encrypted collection is available, keeping new local watching untouched.
  const { pending, ...completed } = createWatchStatsReset(devices, deviceId, reset.at)
  return { ...completed, id: reset.id }
}

function watchStatsGroupReset(device, currentDeviceId, localReset) {
  let reset = device.deviceId === currentDeviceId ? localReset : device.reset
  for (const replaced of device.replacedDevices ?? []) {
    const childReset = watchStatsGroupReset(replaced, currentDeviceId, localReset)
    // Membership captured at reset determines its scope, independent of clocks.
    if (childReset && Object.hasOwn(childReset.baselines, device.deviceId) && newerWatchStatsReset(childReset, reset)) reset = childReset
  }
  return reset
}

export function watchStatsDeviceDays(device, currentDeviceId, localDays, localReset = null, groupReset = null) {
  localReset = resolveWatchStatsReset([device], currentDeviceId, localReset)
  const reset = watchStatsGroupReset(device, currentDeviceId, localReset)
  if (newerWatchStatsReset(reset, groupReset)) groupReset = reset
  const own = device.deviceId === currentDeviceId
  const rawDays = own ? localDays : device.days
  const ownReset = own ? localReset : device.reset
  // A physical reset starts a new raw counter; a baseline from its prior epoch
  // cannot be subtracted from freshly recorded time after a concurrent reset.
  const baseline = (groupReset?.epochs?.[device.deviceId] ?? null) === (ownReset?.id ?? null)
    ? groupReset?.baselines[device.deviceId] ?? {}
    : {}
  let days = Object.fromEntries(Object.entries(rawDays ?? {}).flatMap(([date, seconds]) => {
    const remaining = Math.max(0, seconds - (baseline[date] ?? 0))
    return remaining > 0 ? [[date, remaining]] : []
  }))
  for (const replaced of device.replacedDevices ?? []) {
    const inheritedReset = groupReset && Object.hasOwn(groupReset.baselines, replaced.deviceId) ? groupReset : null
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
  reset = resolveWatchStatsReset(Array.isArray(remote) ? remote : [], deviceId, reset)
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
  const reset = resolveWatchStatsReset(remote, syncServerDeviceId, syncServerWatchStatsReset)
  const merged = mergeWatchStats(remote, localRecords, syncServerDeviceId, syncServerDeviceName,
    deviceInfo.platform, reset)
  if (JSON.stringify(remote) !== JSON.stringify(merged)) {
    await client.putWatchStats(merged)
  }
  store.commit('setSyncedWatchStats', merged)
  return merged
}

// EncryptedSyncAdapter.putWatchStats only stages data. Persist completion after
// the server accepts the collection, so failed uploads and revision retries
// keep the offline reset pending against the refreshed remote history.
export async function persistUploadedWatchStatsReset(devices, store) {
  const { syncServerDeviceId, syncServerWatchStatsReset } = store.state.settings
  if (!syncServerWatchStatsReset?.pending) return
  const uploaded = devices.map(device => findWatchStatsDevice(device, syncServerDeviceId)).find(Boolean)?.reset
  if (uploaded?.id === syncServerWatchStatsReset.id && !uploaded.pending) {
    await store.dispatch('updateSyncServerWatchStatsReset', uploaded)
  }
}
