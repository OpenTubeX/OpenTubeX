import { areJsonValuesEqual } from './jsonValues.js'

export function mergeSettingEntry({ key, value, old, remoteEntry, localUpdatedAt, now }) {
  const localChanged = old !== undefined && !areJsonValuesEqual(value, old.value)

  if (!old && remoteEntry) return remoteEntry
  if (localChanged && (!remoteEntry || (localUpdatedAt ?? now) >= remoteEntry.updatedAt)) {
    return { key, value, updatedAt: localUpdatedAt ?? now }
  }
  if (remoteEntry && (!old || remoteEntry.updatedAt > old.updatedAt)) return remoteEntry
  return old ?? { key, value, updatedAt: now }
}
