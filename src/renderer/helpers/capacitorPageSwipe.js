export function findLoadedSwipeTab(tabs, activeTabId, direction) {
  const index = tabs.findIndex(tab => tab.id === activeTabId)
  if (index < 0 || !tabs[index] || tabs[index].loadState !== 'loaded') return null

  for (let next = index + direction; next >= 0 && next < tabs.length; next += direction) {
    if (tabs[next].loadState === 'loaded') return tabs[next]
  }
  return null
}

export function shouldFinishPageSwipe(distance, width, elapsed) {
  return Math.abs(distance) >= width * 0.25 ||
    (Math.abs(distance) >= 32 && Math.abs(distance) / Math.max(elapsed, 1) >= 0.5)
}
