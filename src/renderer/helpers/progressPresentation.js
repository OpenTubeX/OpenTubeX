/**
 * Capacitor shows native progress while a subscription refresh runs in the
 * background and keeps the global bottom progress bar visible in the app.
 *
 * @param {boolean} showAsNotification
 * @param {boolean} isCapacitor
 * @returns {boolean}
 */
export function shouldUseProgressToast(
  showAsNotification,
  isCapacitor = Boolean(process.env.IS_CAPACITOR)
) {
  return !isCapacitor && showAsNotification
}

/**
 * Desktop shows a short start toast when the persistent notification is turned
 * off. Capacitor keeps the view clear because it has native and in-app progress.
 *
 * @param {boolean} showAsNotification
 * @param {boolean} isCapacitor
 * @returns {boolean}
 */
export function shouldShowProgressStartToast(
  showAsNotification,
  isCapacitor = Boolean(process.env.IS_CAPACITOR)
) {
  return !isCapacitor && !showAsNotification
}
