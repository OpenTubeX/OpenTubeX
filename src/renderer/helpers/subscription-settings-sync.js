import { isValidSubscriptionSettingsTimestamp, normalizeSubscriptionChannelSettings } from './subscription-channels.js'
import { areJsonValuesEqual } from './jsonValues.js'

// Stored in the existing encrypted settings collection; channel records remain
// the local source of truth.
export const SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY = 'subscriptionChannelSettings'

function getChannelSettingsEntry(channel) {
  const settings = normalizeSubscriptionChannelSettings(channel)
  // Untouched subscriptions inherit defaults without needing a sync record.
  // Keep explicit resets so they can overwrite older custom values elsewhere.
  if (channel.subscriptionSettingsUpdatedAt === undefined &&
      areJsonValuesEqual(settings, normalizeSubscriptionChannelSettings())) return undefined
  // JSON has no undefined value. Omission means "use the global limit".
  if (settings.dailyVideoLimit === undefined) delete settings.dailyVideoLimit
  return { value: settings, updatedAt: channel.subscriptionSettingsUpdatedAt }
}

export function getSubscriptionSettingsForSync(store) {
  return Object.fromEntries(store.state.profiles.profileList[0].subscriptions.flatMap(channel => {
    const entry = getChannelSettingsEntry(channel)
    return entry ? [[channel.id, entry]] : []
  }))
}

// `merged` holds the local settings the merge used, by default the current ones.
export async function applySubscriptionSettingsSync(store, value, merged = getSubscriptionSettingsForSync(store)) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  for (const channel of store.state.profiles.profileList[0].subscriptions) {
    if (!Object.hasOwn(value, channel.id)) continue
    const updatedAt = value[channel.id]?.updatedAt
    if (!isValidSubscriptionSettingsTimestamp(updatedAt)) {
      throw new Error('Invalid subscription settings timestamp')
    }
    const remote = value[channel.id].value ?? {}
    // Older clients omit notification choices; keep this device's choice for them.
    const settings = normalizeSubscriptionChannelSettings(Array.isArray(remote.notificationFeedTypes)
      ? remote
      : { ...remote, notificationFeedTypes: channel.notificationFeedTypes })
    if (channel.subscriptionSettingsUpdatedAt === updatedAt &&
        areJsonValuesEqual(normalizeSubscriptionChannelSettings(channel), settings)) continue
    // An edit made after the merge read the settings would be overwritten.
    if (!areJsonValuesEqual(getChannelSettingsEntry(channel), merged[channel.id])) {
      throw new Error('Subscription settings changed during sync. Try again.')
    }
    const saved = await store.dispatch('updateChannelSettings', { channelId: channel.id, settings, fromSync: true, updatedAt })
    if (!saved) throw new Error('Failed to apply synced subscription settings')
  }
}
