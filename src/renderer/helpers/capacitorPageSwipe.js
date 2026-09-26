export function findSwipeTab(tabs, activeTabId, direction) {
  const index = tabs.findIndex(tab => tab.id === activeTabId)
  if (index < 0 || !tabs[index] || tabs[index].loadState !== 'loaded') return null
  return tabs[index + direction] ?? null
}

export function shouldFinishPageSwipe(distance, width, elapsed) {
  return Math.abs(distance) >= width * 0.25 ||
    (Math.abs(distance) >= 32 && Math.abs(distance) / Math.max(elapsed, 1) >= 0.5)
}
