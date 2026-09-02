/**
 * Progress notifications cover content in the Android shell, so Capacitor
 * always uses the global bottom progress bar regardless of the desktop setting.
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
 * off. Capacitor keeps the view clear and relies on the bottom progress bar.
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
