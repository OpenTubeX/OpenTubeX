import store from '../store/index'
import { MAIN_PROFILE_ID } from '../../constants'
import { normalizeChannelHandle } from './feed-metadata'
import { normalizeSubscriptionChannelSettings } from './subscription-channels'
import { showToast } from './utils'
import { mirrorYouTubeSubscription } from './youtube-sync'

/**
 * @param {{ subscriptions: { id: string }[] }} profile
 * @param {string} channelId
 */
export function isProfileSubscribed(profile, channelId) {
  return profile.subscriptions.some(channel => channel.id === channelId)
}

/**
 * Subscribes a profile, and All Channels when it lacks the channel.
 * @param {{ _id: string, subscriptions: { id: string }[] }} profile
 * @param {{ id: string, name: string, thumbnail?: string | null, handle?: string | null }} channel
 * @param {(key: string, ...args: unknown[]) => string} t
 * @param {ReturnType<typeof normalizeSubscriptionChannelSettings>} [settings]
 */
export function subscribeToChannel(profile, { id, name, thumbnail = null, handle = null }, t, settings) {
  const profileIds = [profile._id]
  if (profile._id !== MAIN_PROFILE_ID) {
    const primaryProfile = store.getters.getProfileList.find(prof => prof._id === MAIN_PROFILE_ID)
    if (!isProfileSubscribed(primaryProfile, id)) profileIds.push(MAIN_PROFILE_ID)
  }

  const saved = store.getters.getSubscribedChannelsById.get(id)
  const { feedTypes, notificationFeedTypes, showMembersOnly, dailyVideoLimit } = settings ?? normalizeSubscriptionChannelSettings(saved)
  const channel = {
    id,
    name,
    thumbnail,
    feedTypes: [...feedTypes],
    notificationFeedTypes: [...notificationFeedTypes],
    showMembersOnly
  }
  if (dailyVideoLimit !== undefined) channel.dailyVideoLimit = dailyVideoLimit
  // A saved handle can be newer than the one from a cached result.
  const channelHandle = saved?.handle ?? normalizeChannelHandle(handle)
  if (channelHandle !== null) channel.handle = channelHandle

  store.dispatch('addChannelToProfiles', { channel, profileIds })
  // Profiles that already had the channel saved it without a handle.
  if (channelHandle !== null && saved?.handle === undefined && !profileIds.includes(MAIN_PROFILE_ID)) {
    store.dispatch('updateSubscriptionDetails', { channelId: id, channelHandle })
  }

  showToast({ message: t('Channel.Added channel to your subscriptions'), icon: ['fas', 'subscriptions'] })
  // Only the first profile to subscribe adds the channel to All Channels.
  if (profileIds.includes(MAIN_PROFILE_ID)) mirrorYouTubeSubscription(id, true)
}

/**
 * Unsubscribes a profile. Unsubscribing All Channels unsubscribes every profile.
 * @param {{ _id: string }} profile
 * @param {string} channelId
 * @param {(key: string, ...args: unknown[]) => string} t
 */
export function unsubscribeFromChannel(profile, channelId, t) {
  const profileIds = profile._id === MAIN_PROFILE_ID
    ? store.getters.getProfileList.filter(prof => prof._id === MAIN_PROFILE_ID || isProfileSubscribed(prof, channelId)).map(prof => prof._id)
    : [profile._id]

  store.dispatch('removeChannelFromProfiles', { channelIds: [channelId], profileIds })
  if (profile._id === MAIN_PROFILE_ID) mirrorYouTubeSubscription(channelId, false)

  showToast({ message: t('Channel.Channel has been removed from your subscriptions'), icon: ['fas', 'trash'] })

  if (profileIds.length > 1) {
    showToast({
      message: t('Channel.Removed subscription from {count} other channel(s)', { count: profileIds.length - 1 }, profileIds.length - 1),
      icon: ['fas', 'trash'],
    })
  }
}
