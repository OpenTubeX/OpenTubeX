/** Cast's Default Media Receiver accepts progressive MP4, DASH and HLS. */
export function selectCastSource(formats, manifestUrl, manifestType) {
  const progressive = formats.filter(format => !format.requiresSeparateAudio &&
    /^video\/mp4(?:;|$)/i.test(format.mimeType ?? '') && /^https?:\/\//i.test(format.url ?? '') &&
    (!format.mimeType.includes('codecs=') || /avc1/i.test(format.mimeType)))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
  if (progressive) return { url: progressive.url, contentType: 'video/mp4' }
  if (typeof manifestUrl !== 'string' || !/^https?:\/\/|^data:application\/dash\+xml(?:;charset=UTF-8)?,/i.test(manifestUrl)) return null
  if (!['application/dash+xml', 'application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(manifestType)) return null
  return { url: manifestUrl, contentType: manifestType }
}
