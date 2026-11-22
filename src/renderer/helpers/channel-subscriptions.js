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
 * The profiles that share subscriptions with a profile: only itself when it
 * keeps its data separate, otherwise the shared ones, starting with All Channels.
 * @param {{ _id: string, separate?: boolean }} profile
 */
function profilesSharingWith(profile) {
  return profile.separate === true
    ? [profile]
    : store.getters.getProfileList.filter(prof => prof.separate !== true)
}

let changes = Promise.resolve(true)

/**
 * Runs subscription changes one at a time, so each one is saved and queued
 * for YouTube before the next starts, and YouTube gets them in the same order.
 * @param {() => Promise<boolean>} change
 */
function queueChange(change) {
  const result = changes.then(change)
  changes = result.catch(() => false)
  return result
}

/** @param {(key: string, ...args: unknown[]) => string} t */
function showSaveFailedToast(t) {
  showToast({ message: t('Channel.Failed to save subscription settings'), icon: ['fas', 'circle-exclamation'] })
}

/**
 * Subscribes a profile, and All Channels when it lacks the channel. A
 * separate profile is its own root, and only All Channels mirrors YouTube.
 * @param {{ _id: string, separate?: boolean, subscriptions: { id: string }[] }} profile
 * @param {{ id: string, name: string, thumbnail?: string | null, handle?: string | null }} channel
 * @param {(key: string, ...args: unknown[]) => string} t
 * @param {ReturnType<typeof normalizeSubscriptionChannelSettings>} [settings]
 * @returns {Promise<boolean>} whether the subscription was saved
 */
export function subscribeToChannel(profile, channel, t, settings) {
  return queueChange(() => saveSubscription(profile, channel, t, settings))
}

/** @type {typeof subscribeToChannel} */
async function saveSubscription(profile, { id, name, thumbnail = null, handle = null }, t, settings) {
  const root = profilesSharingWith(profile)[0]
  const profileIds = [profile._id]
  if (profile._id !== root._id && !isProfileSubscribed(root, id)) profileIds.push(root._id)

  const saved = store.getters.getSubscribedChannelsById.get(id)
  const { feedTypes, notificationFeedTypes, showMembersOnly, showRefreshErrors, dailyVideoLimit } = settings ?? normalizeSubscriptionChannelSettings(saved)
  const channel = {
    id,
    name,
    thumbnail,
    feedTypes: [...feedTypes],
    notificationFeedTypes: [...notificationFeedTypes],
    showMembersOnly,
    showRefreshErrors
  }
  if (dailyVideoLimit !== undefined) channel.dailyVideoLimit = dailyVideoLimit
  // A saved handle can be newer than the one from a cached result.
  const channelHandle = saved?.handle ?? normalizeChannelHandle(handle)
  if (channelHandle !== null) channel.handle = channelHandle

  if (!await store.dispatch('addChannelToProfiles', { channel, profileIds })) {
    showSaveFailedToast(t)
    return false
  }
  // Profiles that already had the channel saved it without a handle.
  if (channelHandle !== null && saved?.handle === undefined && !profileIds.includes(root._id)) {
    store.dispatch('updateSubscriptionDetails', { channelId: id, channelHandle })
  }

  showToast({ message: t('Channel.Added channel to your subscriptions'), icon: ['fas', 'subscriptions'] })
  // Only the first profile to subscribe adds the channel to All Channels.
  if (profileIds.includes(MAIN_PROFILE_ID)) mirrorYouTubeSubscription(id, true)
  return true
}

/**
 * Unsubscribes a profile. Unsubscribing the root profile, All Channels or a
 * separate profile, unsubscribes every profile that shares its data.
 * @param {{ _id: string, separate?: boolean }} profile
 * @param {string} channelId
 * @param {(key: string, ...args: unknown[]) => string} t
 * @returns {Promise<boolean>} whether the removal was saved
 */
export function unsubscribeFromChannel(profile, channelId, t) {
  return queueChange(() => saveUnsubscription(profile, channelId, t))
}

/** @type {typeof unsubscribeFromChannel} */
async function saveUnsubscription(profile, channelId, t) {
  const profiles = profilesSharingWith(profile)
  const rootId = profiles[0]._id
  const profileIds = profile._id === rootId
    ? profiles.filter(prof => prof._id === rootId || isProfileSubscribed(prof, channelId)).map(prof => prof._id)
    : [profile._id]

  if (!await store.dispatch('removeChannelFromProfiles', { channelIds: [channelId], profileIds })) {
    showSaveFailedToast(t)
    return false
  }
  if (profile._id === MAIN_PROFILE_ID) mirrorYouTubeSubscription(channelId, false)

  showToast({ message: t('Channel.Channel has been removed from your subscriptions'), icon: ['fas', 'trash'] })

  if (profileIds.length > 1) {
    showToast({
      message: t('Channel.Removed subscription from {count} other channel(s)', { count: profileIds.length - 1 }, profileIds.length - 1),
      icon: ['fas', 'trash'],
    })
  }
  return true
}
