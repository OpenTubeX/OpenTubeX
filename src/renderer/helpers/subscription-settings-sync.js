import { isValidSubscriptionSettingsTimestamp, normalizeSubscriptionChannelSettings } from './subscription-channels.js'
import { areJsonValuesEqual } from './jsonValues.js'
import { syncScopeKey } from './sync-data-scope.js'

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

/**
 * The settings entry that holds the channel settings of a separate profile,
 * which keeps its own channels. The shared entry holds those of the All
 * Channels profile.
 * @param {string} profileId
 */
export function scopedSubscriptionSettingsSyncKey(profileId) {
  return `${SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY}.${syncScopeKey(profileId)}`
}

/** @param {unknown} key A settings entry's key, which comes from the server */
export function isScopedSubscriptionSettingsSyncKey(key) {
  return typeof key === 'string' && key.startsWith(`${SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY}.`)
}

/**
 * The channel settings of a profile that holds its own channels: the All
 * Channels profile, or a separate profile.
 * @param {{ subscriptions: any[] }} profile
 */
export function getSubscriptionSettingsForSync(profile) {
  return Object.fromEntries(profile.subscriptions.flatMap(channel => {
    const entry = getChannelSettingsEntry(channel)
    return entry ? [[channel.id, entry]] : []
  }))
}

// `merged` holds the local settings the merge used, by default the current ones.
export async function applySubscriptionSettingsSync(store, value, profile, merged = getSubscriptionSettingsForSync(profile)) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  for (const channel of profile.subscriptions) {
    if (!Object.hasOwn(value, channel.id)) continue
    const updatedAt = value[channel.id]?.updatedAt
    if (!isValidSubscriptionSettingsTimestamp(updatedAt)) {
      throw new Error('Invalid subscription settings timestamp')
    }
    const remote = value[channel.id].value ?? {}
    // Older clients omit notification and refresh error choices; keep this device's choices for them.
    const settings = normalizeSubscriptionChannelSettings({
      ...remote,
      ...(!Array.isArray(remote.notificationFeedTypes) && { notificationFeedTypes: channel.notificationFeedTypes }),
      ...(typeof remote.showRefreshErrors !== 'boolean' && { showRefreshErrors: channel.showRefreshErrors })
    })
    if (channel.subscriptionSettingsUpdatedAt === updatedAt &&
        areJsonValuesEqual(normalizeSubscriptionChannelSettings(channel), settings)) continue
    // An edit made after the merge read the settings would be overwritten.
    if (!areJsonValuesEqual(getChannelSettingsEntry(channel), merged[channel.id])) {
      throw new Error('Subscription settings changed during sync. Try again.')
    }
    const saved = await store.dispatch('updateChannelSettings', {
      channelId: channel.id, settings, fromSync: true, updatedAt, profileId: profile._id
    })
    if (!saved) throw new Error('Failed to apply synced subscription settings')
  }
}
