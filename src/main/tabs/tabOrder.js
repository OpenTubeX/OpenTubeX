/**
 * Validate and build a complete tab order.
 * @param {Map<string, {isPinned?: boolean}>} tabs
 * @param {string[]} tabIds
 * @returns {Map<string, {isPinned?: boolean}> | null}
 */
export function buildReorderedTabMap(tabs, tabIds) {
  const normalizedTabIds = Array.from(tabIds)
  if (
    normalizedTabIds.length !== tabs.size ||
    new Set(normalizedTabIds).size !== normalizedTabIds.length ||
    !normalizedTabIds.every(tabId => typeof tabId === 'string' && tabs.has(tabId))
  ) {
    return null
  }

  let foundUnpinnedTab = false
  for (const tabId of normalizedTabIds) {
    const tab = tabs.get(tabId)
    if (tab.isPinned) {
      if (foundUnpinnedTab) return null
    } else {
      foundUnpinnedTab = true
    }
  }

  if (Array.from(tabs.keys()).every((tabId, index) => tabId === normalizedTabIds[index])) {
    return tabs
  }

  return new Map(normalizedTabIds.map(tabId => [tabId, tabs.get(tabId)]))
}

/**
 * Find the end of the contiguous group created from an opener. Tabs moved out
 * of that group do not become its new insertion point.
 * @param {Map<string, {isPinned?: boolean, placementOpenerTabId?: string | null}>} tabs
 * @param {string} openerTabId
 * @param {boolean} isPinned
 * @returns {number | null}
 */
export function getGroupedTabInsertIndex(tabs, openerTabId, isPinned) {
  const entries = Array.from(tabs.entries())
  const openerIndex = entries.findIndex(([tabId]) => tabId === openerTabId)
  if (openerIndex === -1) return null

  const pinnedCount = entries.filter(([, tab]) => tab.isPinned).length
  const openerIsPinned = entries[openerIndex][1].isPinned
  const groupStartIndex = openerIsPinned && !isPinned
    ? pinnedCount
    : openerIndex + 1
  let insertIndex = groupStartIndex

  while (
    insertIndex < entries.length &&
    entries[insertIndex][1].placementOpenerTabId === openerTabId
  ) {
    insertIndex += 1
  }

  return insertIndex
}
