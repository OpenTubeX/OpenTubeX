import store from '../store/index'
import { normalizeUploadEntries } from '../../newUploadNotifications'
import { configureAndroidUploadNotifications, observeAndroidUploads } from './androidSubscriptionRefresh'

const supported = process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS)

/**
 * @param {ReturnType<typeof import('../../newUploadNotifications').createUploadNotificationConfiguration>} configuration
 */
export function configureUploadNotifications(configuration) {
  if (!supported) return Promise.resolve()
  return process.env.IS_ELECTRON
    ? window.ftElectron.subscriptionAutoRefresh.configureUploadNotifications(configuration)
    : configureAndroidUploadNotifications(configuration)
}

/**
 * Reports a freshly fetched channel feed, ordered newest first.
 * @param {string} channelId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {object[]} entries
 */
export function reportSubscriptionUploads(channelId, feedType, entries) {
  if (!supported || !store.getters.getEnableUploadNotifications) return
  const value = { channelId, feedType, entries: normalizeUploadEntries(entries) }
  const request = process.env.IS_ELECTRON
    ? window.ftElectron.subscriptionAutoRefresh.observeUploads(value)
    : observeAndroidUploads(value)
  request.catch(error => console.error('Failed to check for new uploads', error))
}
