/**
 * @typedef {object} SubscriptionRefreshCapabilities
 * @property {boolean} storageBroadcast Progress is shared through storage events.
 * @property {boolean} electronProgress Progress is sent to the Electron coordinator.
 * @property {boolean} androidNotifications Native Android refresh notifications are available.
 */

/**
 * @param {{ isElectron: boolean, isCapacitor: boolean }} platform
 * @returns {SubscriptionRefreshCapabilities}
 */
export function resolveSubscriptionRefreshCapabilities({ isElectron, isCapacitor }) {
  return {
    storageBroadcast: !isElectron,
    electronProgress: Boolean(isElectron),
    androidNotifications: Boolean(isCapacitor),
  }
}
