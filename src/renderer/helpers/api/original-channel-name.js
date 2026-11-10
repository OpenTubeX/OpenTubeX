import { parseSubscriptionRss } from './feed-rss.js'

const CACHE_LIMIT = 500
const REQUEST_TIMEOUT_MS = 5000

/**
 * RSS retains the channel's original name when search returns a translated one.
 * Share requests and keep a bounded session cache, just like original video titles.
 * @param {(input: string, init: RequestInit & { nativeTimeoutMs: number }) => Promise<Response>} fetchFeed
 */
export function createOriginalChannelNameResolver(fetchFeed) {
  const requests = new Map()

  /** @param {string} channelId @returns {Promise<string | null>} */
  return function getOriginalChannelName(channelId) {
    if (!/^UC[\w-]{22}$/.test(channelId)) return Promise.resolve(null)
    if (requests.has(channelId)) return requests.get(channelId)

    const request = (async () => {
      try {
        const response = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
          credentials: 'omit',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          nativeTimeoutMs: REQUEST_TIMEOUT_MS
        })
        if (!response.ok) return null
        const { name } = parseSubscriptionRss(await response.text(), channelId)
        return name.trim().length > 0 ? name : null
      } catch {
        // Keep the search name when the feed is missing, malformed or blocked.
        return null
      }
    })()

    if (requests.size >= CACHE_LIMIT) requests.delete(requests.keys().next().value)
    requests.set(channelId, request)
    request.then(name => {
      // A later render can retry a failed lookup.
      if (name === null && requests.get(channelId) === request) requests.delete(channelId)
    })
    return request
  }
}
