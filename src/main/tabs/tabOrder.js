/**
 * Validate and build a complete tab order.
 * @param {Map<string, {isPinned?: boolean}>} tabs
 * @param {string[]} tabIds
 * @returns {Map<string, {isPinned?: boolean}> | null}
 */
export function buildReorderedTabMap(tabs, tabIds) {
  if (
    tabIds.length !== tabs.size ||
    new Set(tabIds).size !== tabIds.length ||
    tabIds.some(tabId => !tabs.has(tabId))
  ) {
    return null
  }

  let foundUnpinnedTab = false
  for (const tabId of tabIds) {
    const tab = tabs.get(tabId)
    if (tab.isPinned) {
      if (foundUnpinnedTab) return null
    } else {
      foundUnpinnedTab = true
    }
  }

  if (Array.from(tabs.keys()).every((tabId, index) => tabId === tabIds[index])) {
    return tabs
  }

  return new Map(tabIds.map(tabId => [tabId, tabs.get(tabId)]))
}
