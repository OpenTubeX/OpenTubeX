import { createLocalFeedParsers } from './local-feed-parsers.js'
import { createInvidiousFeedParsers } from './invidious-feed-parsers.js'
import { parseSubscriptionRss, parseRssUpcomingInfo, isRssUpcomingPremiereCandidate } from './feed-rss.js'
import { mapConcurrently } from '../concurrent-map.js'
import { applyRssPremiereVerdict } from '../subscription-entries.js'

// Preserve entries here; the receiving UI applies its current authentication policy.
const local = createLocalFeedParsers(() => false)

export function parseBackgroundFeed(payload, feedType, channelId, instanceUrl, timestamp = Date.now()) {
  let entries
  if (payload.backgroundFormat === 'rss') {
    entries = parseSubscriptionRss(payload.text, channelId).videos
  } else if (payload.backgroundFormat?.startsWith('local')) {
    entries = local.normalizeLocalSubscriptionFeed(feedType, payload, channelId, timestamp)
  } else {
    entries = createInvidiousFeedParsers(() => instanceUrl).normalizeInvidiousSubscriptionFeed(feedType, payload, channelId)
  }
  if (feedType === 'shorts') entries.forEach(entry => { entry.isShort = true })
  return entries
}

/** Complete RSS metadata in the utility process before committing its cache result. */
export async function parseAndEnrichBackgroundFeed(payload, feedType, channelId, instanceUrl, fetchText, signal) {
  const entries = parseBackgroundFeed(payload, feedType, channelId, instanceUrl)
  return mapConcurrently(entries, 3, async entry => {
    signal.throwIfAborted()
    if (!entry.isRSS || !isRssUpcomingPremiereCandidate(entry.viewCount)) return entry
    try {
      const html = await fetchText({ url: `https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}` }, signal)
      return applyRssPremiereVerdict(entry, parseRssUpcomingInfo(html))
    } catch {
      signal.throwIfAborted()
      // Failed lookups must remain eligible for enrichment when the app reopens.
      return entry
    }
  })
}
