// @ts-check

// Only YouTube's segment URLs, so other servers' segments keep their paths
const YOUTUBE_TS_SEGMENT = /(\/videoplayback\/\S*)\/file\/seg\.ts(?=$|[?#])/gm

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
  const renamed = playlist.replaceAll(YOUTUBE_TS_SEGMENT, '$1/file/seg.mp4')
  return renamed === playlist ? null : renamed
}
