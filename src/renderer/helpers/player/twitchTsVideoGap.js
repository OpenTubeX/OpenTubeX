import shaka from 'shaka-player'

// Shaka transmuxes TS video and audio into separate MP4 tracks. When Twitch's
// video stops early within a segment, its final MP4 sample ends before the
// audio track, causing Shaka to seek across the gap. Hold that frame instead.
const VIDEO_TIMESCALE = 90_000
const MIN_GAP_TICKS = VIDEO_TIMESCALE / 2
const playlistPrefixes = new Map()
let registered = false

function findBox(view, bytes, start, end, type) {
  for (let offset = start; offset + 8 <= end;) {
    const size = view.getUint32(offset)
    if (size < 8 || offset + size > end) return null
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === type) {
      return { start: offset + 8, end: offset + size }
    }
    offset += size
  }
  return null
}

/** Extend Shaka's final TS video sample when the segment has a video hole. */
export function fillTsVideoGap(bytes, segmentDuration) {
  if (!Number.isFinite(segmentDuration) || segmentDuration <= 0) return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const moof = findBox(view, bytes, 0, bytes.length, 'moof')
  const traf = moof && findBox(view, bytes, moof.start, moof.end, 'traf')
  const trun = traf && findBox(view, bytes, traf.start, traf.end, 'trun')
  if (!trun || trun.start + 12 > trun.end) return bytes

  const flags = view.getUint32(trun.start) & 0xffffff
  const count = view.getUint32(trun.start + 4)
  if (!(flags & 0x100) || count === 0) return bytes
  let offset = trun.start + 8 + ((flags & 0x1) ? 4 : 0) + ((flags & 0x4) ? 4 : 0)
  let duration = 0
  let lastDurationOffset = 0
  for (let index = 0; index < count; index++) {
    const sampleSize = 4 + ((flags & 0x200) ? 4 : 0) + ((flags & 0x400) ? 4 : 0) + ((flags & 0x800) ? 4 : 0)
    if (offset + sampleSize > trun.end) return bytes
    lastDurationOffset = offset
    duration += view.getUint32(offset)
    offset += sampleSize
  }

  const missing = Math.round(segmentDuration * VIDEO_TIMESCALE) - duration
  if (missing < MIN_GAP_TICKS || view.getUint32(lastDurationOffset) + missing > 0xffffffff) return bytes
  const filled = bytes.slice()
  new DataView(filled.buffer, filled.byteOffset, filled.byteLength)
    .setUint32(lastDurationOffset, view.getUint32(lastDurationOffset) + missing)
  return filled
}

/** Apply the gap repair only to segments in an active subscriber-only VOD. */
export function enableTwitchTsVideoGap(manifestSrc) {
  const playlist = decodeURIComponent(manifestSrc.slice(manifestSrc.indexOf(',') + 1))
  const prefixes = playlist.split('\n')
    .filter(line => line.startsWith('https://'))
    .map(line => line.slice(0, line.lastIndexOf('/') + 1))
  for (const prefix of prefixes) playlistPrefixes.set(prefix, (playlistPrefixes.get(prefix) ?? 0) + 1)

  if (!registered) {
    class TwitchTsTransmuxer extends shaka.transmuxer.TsTransmuxer {
      async transmux(data, stream, reference, duration, contentType) {
        const output = await super.transmux(data, stream, reference, duration, contentType)
        if (contentType !== 'video' || !reference || !output.data) return output
        const uri = reference.getUris()[0]
        if (![...playlistPrefixes.keys()].some(prefix => uri.startsWith(prefix))) return output
        const filled = fillTsVideoGap(output.data, reference.endTime - reference.startTime)
        if (filled === output.data) return output
        const parser = new shaka.util.TsParser().parse(shaka.util.BufferUtils.toUint8(data))
        const lastAudioPts = parser.getAudioData().at(-1)?.pts
        const lastVideoPts = parser.getVideoData().at(-1)?.pts
        if (lastAudioPts != null && lastVideoPts != null && lastAudioPts - lastVideoPts >= MIN_GAP_TICKS) {
          output.data = filled
        }
        return output
      }
    }
    shaka.transmuxer.TransmuxerEngine.registerTransmuxer(
      'video/mp2t',
      () => new TwitchTsTransmuxer('video/mp2t'),
      shaka.transmuxer.TransmuxerEngine.PluginPriority.APPLICATION
    )
    registered = true
  }

  return () => {
    for (const prefix of prefixes) {
      const count = playlistPrefixes.get(prefix)
      if (count === 1) playlistPrefixes.delete(prefix)
      else playlistPrefixes.set(prefix, count - 1)
    }
  }
}
