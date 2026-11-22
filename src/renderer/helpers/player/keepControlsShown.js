/** @type {WeakMap<object, Set<string>>} */
const reasonsByControls = new WeakMap()

/**
 * Keeps Shaka's controls shown while any reason holds, so one reason ending
 * does not hide the controls another one still needs. Shaka's configure()
 * starts from a copy of the current config, so the flag survives rebuilds.
 * @param {{ getConfig: () => { showUIAlways: boolean } }} controls
 * @param {string} reason
 * @param {boolean} keep
 */
export function keepControlsShown(controls, reason, keep) {
  let reasons = reasonsByControls.get(controls)
  if (!reasons) {
    reasons = new Set()
    reasonsByControls.set(controls, reasons)
  }
  if (keep) reasons.add(reason)
  else reasons.delete(reason)
  controls.getConfig().showUIAlways = reasons.size > 0
}
