import store from '../store/index'
import { normalizeUploadEntries } from '../../newUploadNotifications'
import { configureAndroidUploadNotifications, observeAndroidUploads } from './androidSubscriptionRefresh'

/** The desktop main process or the Android background worker shows the notifications. */
export const supportsUploadNotifications = !!(process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS))
/** @type {ReturnType<typeof import('../../newUploadNotifications').createUploadNotificationConfiguration> | null} */
let configuration = null

/**
 * @param {ReturnType<typeof import('../../newUploadNotifications').createUploadNotificationConfiguration>} value
 */
export function configureUploadNotifications(value) {
  configuration = value
  if (!supportsUploadNotifications) return Promise.resolve()
  return process.env.IS_ELECTRON
    ? window.ftElectron.subscriptionAutoRefresh.configureUploadNotifications(value)
    : configureAndroidUploadNotifications(value)
}

/**
 * Adds channels with notifications for the feed type to the set fetched for a
 * subscription feed, even when the current profile filters those channels out.
 * @param {{ id: string }[]} subscriptions
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 */
export function includeNotificationChannels(subscriptions, feedType) {
  if (!supportsUploadNotifications || !store.getters.getEnableUploadNotifications || configuration?.enabled !== true) return subscriptions
  const includedIds = new Set(subscriptions.map(channel => channel.id))
  const missing = (store.getters.getProfileList[0]?.subscriptions ?? []).filter(channel =>
    !includedIds.has(channel.id) && configuration.channels[channel.id]?.feedTypes.includes(feedType))
  return missing.length === 0 ? subscriptions : [...subscriptions, ...missing]
}

/**
 * Reports a freshly fetched channel feed, ordered newest first. Feeds without
 * notifications turned on are not sent; the receiver would discard them.
 * @param {string} channelId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {object[]} entries
 */
export function reportSubscriptionUploads(channelId, feedType, entries) {
  if (!supportsUploadNotifications || !store.getters.getEnableUploadNotifications) return
  if (configuration?.enabled !== true || !configuration.channels[channelId]?.feedTypes.includes(feedType)) return
  const value = { channelId, feedType, entries: normalizeUploadEntries(entries) }
  const request = process.env.IS_ELECTRON
    ? window.ftElectron.subscriptionAutoRefresh.observeUploads(value)
    : observeAndroidUploads(value)
  request.catch(error => console.error('Failed to check for new uploads', error))
}
