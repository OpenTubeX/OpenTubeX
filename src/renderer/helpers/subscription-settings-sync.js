import { normalizeSubscriptionChannelSettings } from './subscription-channels.js'
import { areJsonValuesEqual } from './jsonValues.js'
import { mergeSettingEntry } from './sync-settings-conflict.js'

// Stored in the existing encrypted settings collection; channel records remain
// the local source of truth.
export const SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY = 'subscriptionChannelSettings'

export function getSubscriptionSettingsForSync(store) {
  return Object.fromEntries(store.state.profiles.profileList[0].subscriptions.flatMap(channel => {
    const settings = normalizeSubscriptionChannelSettings(channel)
    // Untouched subscriptions inherit defaults without needing a sync record.
    // Keep explicit resets so they can overwrite older custom values elsewhere.
    if (channel.subscriptionSettingsUpdatedAt === undefined &&
        areJsonValuesEqual(settings, normalizeSubscriptionChannelSettings())) return []
    // JSON has no undefined value. Omission means "use the global limit".
    if (settings.dailyVideoLimit === undefined) delete settings.dailyVideoLimit
    return [[channel.id, { value: settings, updatedAt: channel.subscriptionSettingsUpdatedAt }]]
  }))
}

export function mergeSubscriptionSettingsEntry(options) {
  const remote = options.remoteEntry?.value ?? {}
  // Keep channels absent from this device, and merge each subscribed channel
  // independently so edits to different channels never overwrite one another.
  const value = { ...remote }
  let updatedAt = options.remoteEntry?.updatedAt ?? options.old?.updatedAt ?? 0
  for (const [channelId, local] of Object.entries(options.value)) {
    const localUpdatedAt = local.updatedAt
    const entry = mergeSettingEntry({
      key: channelId,
      value: local.value,
      old: localUpdatedAt === undefined ? undefined : options.old?.value?.[channelId],
      remoteEntry: remote[channelId],
      localUpdatedAt,
      now: options.now
    })
    value[channelId] = { value: entry.value, updatedAt: entry.updatedAt }
    updatedAt = Math.max(updatedAt, entry.updatedAt)
  }
  return { key: options.key, value, updatedAt }
}

export async function applySubscriptionSettingsSync(store, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  for (const channel of store.state.profiles.profileList[0].subscriptions) {
    if (!Object.hasOwn(value, channel.id)) continue
    const updatedAt = value[channel.id]?.updatedAt
    if (!Number.isFinite(updatedAt) || updatedAt < 0) {
      throw new Error('Invalid subscription settings timestamp')
    }
    const settings = normalizeSubscriptionChannelSettings(value[channel.id].value)
    if (channel.subscriptionSettingsUpdatedAt === updatedAt &&
        areJsonValuesEqual(normalizeSubscriptionChannelSettings(channel), settings)) continue
    const saved = await store.dispatch('updateChannelSettings', { channelId: channel.id, settings, fromSync: true, updatedAt })
    if (!saved) throw new Error('Failed to apply synced subscription settings')
  }
}
