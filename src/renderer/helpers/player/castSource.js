import { getInlineCastManifestType } from '../../../castManifest.js'

/** Cast's Default Media Receiver accepts progressive MP4, DASH and HLS. */
export function selectCastSource(formats, manifestUrl, manifestType) {
  const progressive = formats.filter(format => !format.requiresSeparateAudio &&
    /^video\/mp4(?:;|$)/i.test(format.mimeType ?? '') && /^https?:\/\//i.test(format.url ?? '') &&
    (!format.mimeType.includes('codecs=') || /avc1/i.test(format.mimeType)))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
  let manifestHasVideo = true
  const inlineType = getInlineCastManifestType(manifestUrl)
  if (inlineType === 'application/dash+xml') {
    try {
      manifestHasVideo = /\b(?:mimeType=["']video\/|contentType=["']video["'])/i.test(decodeURIComponent(manifestUrl.slice(manifestUrl.indexOf(',') + 1)))
    } catch { manifestHasVideo = false }
  }
  if (manifestHasVideo && typeof manifestUrl === 'string' && (/^https?:\/\//i.test(manifestUrl) || inlineType === manifestType) &&
    ['application/dash+xml', 'application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(manifestType)) {
    return { url: manifestUrl, contentType: manifestType }
  }
  return progressive ? { url: progressive.url, contentType: 'video/mp4' } : null
}
