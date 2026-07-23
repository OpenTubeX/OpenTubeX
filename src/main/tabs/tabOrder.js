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
