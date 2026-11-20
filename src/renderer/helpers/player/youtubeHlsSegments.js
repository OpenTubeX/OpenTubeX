// @ts-check

const TS_SEGMENT_SUFFIX = /\/file\/seg\.ts(?=$|[?#])/gm

/**
 * YouTube names every HLS segment `/file/seg.ts`, including the fragmented MP4
 * segments of its VP9 renditions. Shaka takes the container from that extension
 * and creates an MPEG-TS SourceBuffer for VP9, which Chromium rejects (3015).
 * An `EXT-X-MAP` init segment marks fragmented MP4, so name those segments `.mp4`.
 * @param {string} playlist an HLS media playlist
 * @returns {string | null} the renamed playlist, or null when nothing changed
 */
export function renameYouTubeFmp4HlsSegments(playlist) {
  if (!playlist.includes('#EXT-X-MAP:')) return null
  const renamed = playlist.replaceAll(TS_SEGMENT_SUFFIX, '/file/seg.mp4')
  return renamed === playlist ? null : renamed
}
