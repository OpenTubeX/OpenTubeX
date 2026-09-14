const TABS = { videos: 'EgZ2aWRlb3PyBgQKAjoA', shorts: 'EgZzaG9ydHPyBgUKA5oBAA%3D%3D', live: 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D', posts: 'EgVwb3N0c_IGBAoCSgA%3D' }
const RESOURCES = { videos: 'videos', shorts: 'shorts', live: 'streams', posts: 'community' }
const PLAYLIST_PREFIXES = { videos: 'UULF', shorts: 'UUSH', live: 'UULV' }

/** The same ordered requests are used by Electron and Android native jobs. */
export function createBackgroundSubscriptionRequests({ backend = 'local', useRss = true, fallback = false, instanceUrl = '', authorization = null, clientVersion, region = 'US' }) {
  const instance = instanceUrl.replace(/\/+$/, '')
  return Object.fromEntries(Object.keys(TABS).map(feed => {
    const localApi = {
      format: 'local',
      url: 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
      method: 'POST',
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: region } }, browseId: '%CHANNEL%', params: TABS[feed] })
    }
    const localPlaylist = { ...localApi, format: 'localPlaylist', body: JSON.stringify({ ...JSON.parse(localApi.body), browseId: 'VL%PLAYLIST%', params: undefined }) }
    const invidiousApi = { format: 'invidious', url: `${instance}/api/v1/channels/%CHANNEL%/${RESOURCES[feed]}`, authorization }
    const localRss = { format: 'rss', url: 'https://www.youtube.com/feeds/videos.xml?playlist_id=%PLAYLIST%' }
    const invidiousRss = { format: 'rss', url: `${instance}/feed/playlist/%PLAYLIST%`, authorization }
    const local = feed === 'posts' ? [localApi] : feed === 'shorts' ? [localRss, localPlaylist, localApi] : [...(useRss ? [localRss, localApi] : [localApi, localRss]), ...(feed === 'videos' ? [localPlaylist] : [])]
    const invidious = feed === 'posts' ? [invidiousApi] : ((useRss || feed === 'shorts') ? [invidiousRss, invidiousApi] : [invidiousApi, invidiousRss])
    return [feed, backend === 'invidious' ? [...invidious, ...(fallback ? local : [])] : [...local, ...(fallback ? invidious : [])]]
  }))
}

export function resolveBackgroundSubscriptionRequest(plan, feedType, channelId) {
  if (!/^[A-Za-z0-9_-]+$/.test(channelId)) throw new Error('Invalid subscription channel ID')
  const replace = value => value.replaceAll('%CHANNEL%', channelId).replaceAll('%PLAYLIST%', channelId.replace(/^UC/, PLAYLIST_PREFIXES[feedType]))
  return { ...plan, url: replace(plan.url), ...(plan.body ? { body: replace(plan.body) } : {}) }
}

export function parseBackgroundSubscriptionResponse(format, text, feedType) {
  if (format === 'rss') {
    if (!/<feed[\s>]/.test(text) || !text.includes('</feed>')) throw new Error('Invalid subscription RSS response')
    return { backgroundFormat: 'rss', text }
  }
  const data = JSON.parse(text)
  if (data.error) {
    if (feedType === 'posts' && data.error === "This channel hasn't posted yet") return { comments: [] }
    throw new Error('Subscription API returned an error')
  }
  if (format === 'local' || format === 'localPlaylist') {
    if (!data.contents || data.alerts?.some(alert => alert.alertRenderer?.type === 'ERROR')) throw new Error('Channel unavailable')
    if (format === 'local' && feedType === 'videos' && data.metadata?.channelMetadataRenderer?.musicArtistName) {
      const tabs = data.contents.twoColumnBrowseResultsRenderer?.tabs ?? []
      const selected = tabs.find(tab => tab.tabRenderer?.selected)?.tabRenderer
      if (!selected?.endpoint?.commandMetadata?.webCommandMetadata?.url?.endsWith('/videos')) throw new Error('Topic channel requires its uploads playlist')
    }
    return { backgroundFormat: format, data }
  }
  if (!Array.isArray(data[feedType === 'posts' ? 'comments' : 'videos'])) throw new Error('Invalid subscription API response')
  return data
}

export async function fetchBackgroundSubscriptionChannel(configuration, feedType, channelId, signal, fetchText, normalize = payload => payload) {
  let lastError
  for (const plan of configuration.requests[feedType]) {
    signal.throwIfAborted()
    try {
      const request = resolveBackgroundSubscriptionRequest(plan, feedType, channelId)
      const payload = parseBackgroundSubscriptionResponse(plan.format, await fetchText(request, signal), feedType)
      if (plan.format === 'local' && feedType === 'live') {
        let page = payload.data
        for (let count = 0; ; count++) {
          const token = getEmptyLiveContinuation(page)
          if (!token) break
          if (count >= 20) throw new Error('Too many empty live feed pages')
          const body = { ...JSON.parse(request.body), browseId: undefined, params: undefined, continuation: token }
          page = JSON.parse(await fetchText({ ...request, body: JSON.stringify(body) }, signal))
          if (page.error) throw new Error('Live feed continuation failed')
          payload.continuation = page
        }
      }
      signal.throwIfAborted()
      return await normalize(payload)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('No background subscription backend configured')
}

/** YouTube sometimes returns only a continuation on the Live tab. */
export function getEmptyLiveContinuation(data) {
  let token = null
  let hasVideos = false
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (value.videoRenderer || value.gridVideoRenderer || value.lockupViewModel) hasVideos = true
    if (value.continuationCommand?.token) token = value.continuationCommand.token
    for (const child of Object.values(value)) visit(child)
  }
  visit(data.contents ?? data.onResponseReceivedActions ?? data.onResponseReceivedEndpoints)
  return hasVideos ? null : token
}
