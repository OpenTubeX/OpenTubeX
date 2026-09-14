import sax from 'sax'
import { extractAssignedJsonObject } from '../assigned-json.js'
import { getLocalPremiereState } from '../premiere.js'

/** Parse feed entries without DOM access or network enrichment. */
export function parseSubscriptionRss(rss, channelId) {
  const parser = sax.parser(true, { xmlns: true })
  const stack = []
  const videos = []
  let entry = null
  let name = null
  let feed = false
  parser.onopentag = node => {
    stack.push({ ...node, text: '' })
    if (stack.length === 1) {
      if (node.local !== 'feed') throw new Error('Invalid subscription RSS root')
      feed = true
    }
    if (node.local === 'entry' && stack.length === 2) entry = { viewCount: null }
    if (entry && node.local === 'statistics') {
      const views = Number.parseInt(node.attributes.views?.value, 10)
      if (Number.isFinite(views)) entry.viewCount = views
    }
  }
  parser.ontext = parser.oncdata = text => {
    if (stack.length) stack.at(-1).text += text
  }
  parser.onclosetag = () => {
    const node = stack.pop()
    if (entry) {
      if (node.local === 'videoId') entry.videoId = node.text.trim()
      if (node.local === 'title' && stack.at(-1)?.local === 'entry') entry.title = node.text
      if (node.local === 'published') entry.published = Date.parse(node.text)
      if (node.local === 'entry' && stack.length === 1) {
        if (!entry.videoId || typeof entry.title !== 'string' || !Number.isFinite(entry.published)) throw new Error('Invalid subscription RSS entry')
        videos.push(entry)
        entry = null
      }
    } else if (node.local === 'name' && stack.at(-1)?.local === 'author') name = node.text
  }
  parser.write(rss).close()
  if (!feed || name === null) throw new Error('Invalid subscription RSS feed')
  return {
    name,
    videos: videos.map(video => ({ ...video, authorId: channelId, author: name, type: 'video', lengthSeconds: '0:00', isRSS: true }))
  }
}

/** RSS does not identify upcoming videos; inspect the same watch-page fields in either process. */
export function parseRssUpcomingInfo(html) {
  if (!/"isUpcoming"\s*:\s*true/.test(html)) return { isUpcoming: false }
  const scheduledStart = html.match(/"scheduledStartTime"\s*:\s*"(\d+)"/)
  const playerResponse = extractAssignedJsonObject(html, 'ytInitialPlayerResponse')
  let isPremiere
  if (playerResponse) {
    try { isPremiere = getLocalPremiereState(JSON.parse(playerResponse).videoDetails) } catch {
      // The upcoming flag remains useful when the embedded player data is malformed.
    }
  }
  return {
    isUpcoming: true,
    isPremiere,
    premiereDate: scheduledStart ? new Date(Number(scheduledStart[1]) * 1000) : undefined
  }
}

export function isRssUpcomingPremiereCandidate(viewCount) {
  const count = typeof viewCount === 'string' ? Number.parseInt(viewCount, 10) : viewCount
  return count != null && Number.isFinite(count) && count <= 1
}
