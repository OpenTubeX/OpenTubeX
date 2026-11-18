/** @type {Map<string, Set<string>>} */
const reasonsByTabId = new Map()

/**
 * Keeps a background tab loaded when memory pressure unloads old tabs, for as
 * long as unloading it would interrupt something: Picture-in-Picture, the mini
 * player, casting, or unsaved edits. Explicitly unloading a tab still works.
 * @param {string | null | undefined} tabId
 * @param {string} reason
 * @param {boolean} active
 */
export function keepTabLoaded(tabId, reason, active) {
  if (!tabId) return
  const reasons = reasonsByTabId.get(tabId)
  if (active) {
    if (reasons) reasons.add(reason)
    else reasonsByTabId.set(tabId, new Set([reason]))
  } else if (reasons?.delete(reason) && reasons.size === 0) {
    reasonsByTabId.delete(tabId)
  }
}

/** @returns {string[]} */
export function getTabsKeptLoaded() {
  return [...reasonsByTabId.keys()]
}
