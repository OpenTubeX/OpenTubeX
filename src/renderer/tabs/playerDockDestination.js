export function getPreviousBrowsingRoute(tab) {
  const previous = tab?.history[tab.historyIndex - 1]?.route
  return previous && !previous.path.startsWith('/watch/') ? previous : null
}
