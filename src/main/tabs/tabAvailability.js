/**
 * @param {{ id: string, isTransferStaged?: boolean } | undefined} tab
 * @param {Set<string>} deferredCloseTabIds
 * @param {Set<string>} deferredUnloadTabIds
 * @returns {boolean}
 */
export function isTabActivatable(tab, deferredCloseTabIds, deferredUnloadTabIds) {
  return tab != null &&
    tab.isTransferStaged !== true &&
    !deferredCloseTabIds.has(tab.id) &&
    !deferredUnloadTabIds.has(tab.id)
}
