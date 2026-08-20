/**
 * Sorts search history in place from the most recent entry to the oldest.
 * @param {{ lastUpdatedAt: number }[]} historyItems
 * @returns {{ lastUpdatedAt: number }[]}
 */
export function sortSearchHistoryByLastUpdatedAt(historyItems) {
  return historyItems.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
}
