import store from '../store/index'
import { normalizeUploadEntries } from '../../newUploadNotifications'
import { configureAndroidUploadNotifications, observeAndroidUploads } from './androidSubscriptionRefresh'

const supported = process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS)
/** @type {ReturnType<typeof import('../../newUploadNotifications').createUploadNotificationConfiguration> | null} */
let configuration = null

/**
 * @param {ReturnType<typeof import('../../newUploadNotifications').createUploadNotificationConfiguration>} value
 */
export function configureUploadNotifications(value) {
  configuration = value
  if (!supported) return Promise.resolve()
  return process.env.IS_ELECTRON
    ? window.ftElectron.subscriptionAutoRefresh.configureUploadNotifications(value)
    : configureAndroidUploadNotifications(value)
}

/**
 * Reports a freshly fetched channel feed, ordered newest first. Feeds without
 * notifications turned on are not sent; the receiver would discard them.
 * @param {string} channelId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {object[]} entries
 */
export function reportSubscriptionUploads(channelId, feedType, entries) {
  if (!supported || !store.getters.getEnableUploadNotifications) return
  if (configuration?.enabled !== true || !configuration.channels[channelId]?.feedTypes.includes(feedType)) return
  const value = { channelId, feedType, entries: normalizeUploadEntries(entries) }
  const request = process.env.IS_ELECTRON
    ? window.ftElectron.subscriptionAutoRefresh.observeUploads(value)
    : observeAndroidUploads(value)
  request.catch(error => console.error('Failed to check for new uploads', error))
}
