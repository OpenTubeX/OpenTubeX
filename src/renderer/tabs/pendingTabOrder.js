/**
 * Keep the newest local reorder visible while older main-process snapshots
 * arrive. New tabs are appended and closed tabs are removed from the pending
 * order until the matching snapshot acknowledges it.
 * @template {{id: string}} T
 * @param {T[]} tabs
 * @param {string[] | null} pendingTabOrder
 * @returns {{tabs: T[], pendingTabOrder: string[] | null}}
 */
export function reconcilePendingTabOrder(tabs, pendingTabOrder) {
  const tabIds = tabs.map(tab => tab.id)
  if (
    pendingTabOrder != null &&
    tabIds.length === pendingTabOrder.length &&
    tabIds.every((tabId, index) => tabId === pendingTabOrder[index])
  ) {
    return { tabs, pendingTabOrder: null }
  }
  if (pendingTabOrder == null) {
    return { tabs, pendingTabOrder: null }
  }

  const tabsById = new Map(tabs.map(tab => [tab.id, tab]))
  const pendingTabIds = new Set(pendingTabOrder)
  const reconciledOrder = [
    ...pendingTabOrder.filter(tabId => tabsById.has(tabId)),
    ...tabIds.filter(tabId => !pendingTabIds.has(tabId))
  ]
  return {
    tabs: reconciledOrder.map(tabId => tabsById.get(tabId)),
    pendingTabOrder: reconciledOrder
  }
}
