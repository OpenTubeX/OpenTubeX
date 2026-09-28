import { TWITCH_CHAT_CLIENT_ID } from './twitchChatReplayRequest.js'

const QUALITIES = [
  ['chunked', null, 60],
  ['1440p60', '2560x1440', 60],
  ['1080p60', '1920x1080', 60],
  ['720p60', '1280x720', 60],
  ['480p30', '854x480', 30],
  ['360p30', '640x360', 30],
  ['160p30', '284x160', 30]
]

export function getTwitchVodId(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname)) return null
    return /^\/videos\/(\d{1,20})\/?$/.exec(url.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

function getVodPath(video, videoId) {
  const preview = new URL(video.seekPreviewsURL)
  if (preview.protocol !== 'https:' || preview.username || preview.password || preview.port ||
    !/(?:^|\.)(?:cloudfront\.net|jtvnw\.net|ttvnw\.net|twitch\.tv)$/.test(preview.hostname)) {
    throw new Error('Twitch VOD preview host is invalid')
  }
  const parts = preview.pathname.split('/')
  const storyboard = parts.findIndex(part => part.startsWith('storyboards'))
  const key = parts[storyboard - 1]
  if (storyboard < 2 || !/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Twitch VOD preview path is invalid')

  const type = video.broadcastType?.toLowerCase()
  if (type === 'highlight') return quality => `/${key}/${quality}/highlight-${videoId}.m3u8`
  if (type === 'upload' && new Date(video.createdAt) < new Date('2023-02-03')) {
    const login = video.owner?.login
    if (!/^[a-zA-Z0-9_]+$/.test(login)) throw new Error('Twitch VOD owner is invalid')
    return quality => `/${login}/${videoId}/${key}/${quality}/index-dvr.m3u8`
  }
  return quality => `/${key}/${quality}/index-dvr.m3u8`
}

async function probeQuality(url, fetcher) {
  try {
    const response = await fetcher(url, {
      headers: { Range: 'bytes=0-4095' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) return null
    const body = await response.text()
    if (!body.startsWith('#EXTM3U')) return null
    if (body.includes('.ts')) return 'avc1.4D001E'
    if (body.includes('.mp4')) {
      const initPath = body.match(/^#EXT-X-MAP:.*?\bURI="([^"]+)"/m)?.[1]
      if (!initPath) return null
      const initUrl = new URL(initPath, url)
      if (initUrl.origin !== new URL(url).origin) return null
      const init = await fetcher(initUrl.href, {
        headers: { Range: 'bytes=0-4095' },
        signal: AbortSignal.timeout(10_000)
      })
      if (!init.ok) return null
      const header = await init.text()
      if (header.includes('hev1') || header.includes('hvc1')) return 'hev1.1.6.L93.B0'
      if (header.includes('avc1')) return 'avc1.4D001E'
    }
  } catch { /* This quality is unavailable. */ }
  return null
}

export async function fetchTwitchSubOnlyVod(videoId, fetcher) {
  if (!/^\d{1,20}$/.test(videoId)) return null
  const response = await fetcher('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CHAT_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query { video(id: "${videoId}") { title description lengthSeconds viewCount createdAt broadcastType seekPreviewsURL previewThumbnailURL(width: 320, height: 180) owner { login displayName profileImageURL(width: 70) } } }` }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Twitch VOD metadata returned HTTP ${response.status}`)
  const video = (await response.json())?.data?.video
  if (!video?.seekPreviewsURL) throw new Error('Twitch VOD preview is unavailable')
  const preview = new URL(video.seekPreviewsURL)
  const path = getVodPath(video, videoId)
  const variants = await Promise.all(QUALITIES.map(async ([quality, resolution, frameRate]) => {
    const url = new URL(path(quality), preview).href
    const codec = await probeQuality(url, fetcher)
    if (!codec) return null
    const attributes = [
      `BANDWIDTH=${quality === 'chunked' ? 8534000 : Number.parseInt(quality) * 7000}`,
      `CODECS="${codec},mp4a.40.2"`,
      ...(resolution ? [`RESOLUTION=${resolution}`] : []),
      `FRAME-RATE=${frameRate}`
    ]
    return `#EXT-X-STREAM-INF:${attributes.join(',')}\n${url}`
  }))
  const available = variants.filter(Boolean)
  if (available.length === 0) throw new Error('Twitch VOD has no accessible qualities')

  return {
    playlist: `#EXTM3U\n${available.join('\n')}\n`,
    video: {
      title: video.title ?? null,
      description: video.description ?? null,
      duration: video.lengthSeconds ?? null,
      viewCount: video.viewCount ?? null,
      createdAt: video.createdAt ?? null,
      thumbnail: video.previewThumbnailURL ?? null,
      owner: video.owner ?? null
    }
  }
}
