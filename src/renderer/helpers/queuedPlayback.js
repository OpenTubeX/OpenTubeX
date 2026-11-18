// @ts-check
// The queue starts its next item even where media doesn't start automatically.
// YouTube videos and other media play on different pages, so the page that
// opens the item takes the request when it loads.
const requests = new Set()

/**
 * @param {string | null | undefined} tabId
 * @param {string} fullPath
 */
function requestKey(tabId, fullPath) {
  return `${tabId ?? 'web'}\n${fullPath}`
}

/**
 * @param {string | null | undefined} tabId
 * @param {string} fullPath the route that plays the queued item
 */
export function requestQueuedPlayback(tabId, fullPath) {
  requests.add(requestKey(tabId, fullPath))
}

/**
 * @param {string | null | undefined} tabId
 * @param {string} fullPath
 * @returns {boolean} whether the queue opened this route, once per request
 */
export function takeQueuedPlayback(tabId, fullPath) {
  return requests.delete(requestKey(tabId, fullPath))
}
