/** iOS keeps registered yt-dlp media requests behind its native scheme. */
export function isDlnaSourceUrl(url) {
  return /^https?:\/\//i.test(url ?? '') ||
    /^capacitor:\/\/localhost\/_opentubex_media\/[a-zA-Z0-9-]+$/.test(url ?? '')
}

/**
 * DLNA renderers need one URL with both video and audio. OpenTubeX's adaptive
 * sources often split those tracks, so use a complete MP4 format instead.
 * @param {Array<{ mimeType?: string, url?: string, height?: number, requiresSeparateAudio?: boolean }>} formats
 */
export function selectDlnaSource(formats) {
  return formats
    .filter(format => !format.requiresSeparateAudio &&
      /^video\/mp4(?:;|$)/i.test(format.mimeType ?? '') &&
      isDlnaSourceUrl(format.url))
    .sort((left, right) => (right.height ?? 0) - (left.height ?? 0))[0] ?? null
}

/** Select broadly supported H.264 + AAC tracks without recompressing either. */
export function selectDlnaTracks(formats) {
  const direct = formats.filter(format => ['http', 'https'].includes(format.protocol) && isDlnaSourceUrl(format.url))
  const video = direct.filter(format => format.ext === 'mp4' && format.acodec === 'none' &&
    /^(?:avc1|h264)/i.test(format.vcodec ?? ''))
    .sort((left, right) => (right.height ?? 0) - (left.height ?? 0) || (right.fps ?? 0) - (left.fps ?? 0))[0]
  const audio = direct.filter(format => format.vcodec === 'none' && format.ext === 'm4a' &&
    /^(?:mp4a\.40\.2|aac)$/i.test(format.acodec ?? ''))
    .sort((left, right) => Number(/-drc$/.test(left.formatId ?? '')) - Number(/-drc$/.test(right.formatId ?? '')) ||
      (right.bitrate ?? 0) - (left.bitrate ?? 0))[0]
  return video && audio ? { url: video.url, audioUrl: audio.url, height: video.height } : null
}
