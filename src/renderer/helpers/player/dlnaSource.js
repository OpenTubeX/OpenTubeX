/**
 * DLNA renderers need one URL with both video and audio. OpenTubeX's adaptive
 * sources often split those tracks, so use a complete MP4 format instead.
 * @param {Array<{ mimeType?: string, url?: string, height?: number, requiresSeparateAudio?: boolean }>} formats
 */
export function selectDlnaSource(formats) {
  return formats
    .filter(format => !format.requiresSeparateAudio &&
      /^video\/mp4(?:;|$)/i.test(format.mimeType ?? '') &&
      /^https?:\/\//i.test(format.url ?? ''))
    .sort((left, right) => (right.height ?? 0) - (left.height ?? 0))[0] ?? null
}
