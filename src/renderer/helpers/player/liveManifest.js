const MINIMUM_LIVE_DVR_WINDOW_SECONDS = 30

/**
 * Preserve missing DVR metadata instead of coercing it to false, as YouTube.js does.
 * @param {object | null | undefined} videoDetails
 * @returns {boolean | undefined}
 */
export function getLiveDvrEnabled(videoDetails) {
  return typeof videoDetails?.isLiveDvrEnabled === 'boolean'
    ? videoDetails.isLiveDvrEnabled
    : undefined
}

/**
 * @param {string | null} url
 * @returns {boolean}
 */
export function hasLimitedLiveDvrWindow(url) {
  const duration = getLiveDvrWindowSeconds(url)
  return duration != null && duration <= MINIMUM_LIVE_DVR_WINDOW_SECONDS
}

/**
 * @param {string | null} url
 * @returns {number | null}
 */
export function getLiveDvrWindowSeconds(url) {
  const match = url?.match(/\/(?:manifest|playlist)_duration\/(\d+)\//)
  return match != null ? parseInt(match[1], 10) : null
}

/**
 * The WEB player response occasionally omits live manifests while the
 * parallel ANDROID response still contains one.
 * @param {unknown} response
 * @returns {string | null}
 */
export function getAndroidLiveHlsManifestUrl(response) {
  return getAndroidLiveManifestUrl(response, 'hlsManifestUrl')
}

/**
 * Android can supply a DASH fallback for recently ended streams.
 * @param {unknown} response
 * @returns {string | null}
 */
export function getAndroidLiveDashManifestUrl(response) {
  return getAndroidLiveManifestUrl(response, 'dashManifestUrl')
}

/**
 * @param {unknown} response
 * @param {'hlsManifestUrl' | 'dashManifestUrl'} field
 * @returns {string | null}
 */
function getAndroidLiveManifestUrl(response, field) {
  const manifestUrl = response?.data?.streamingData?.[field]
  if (typeof manifestUrl !== 'string') return null

  try {
    const url = new URL(manifestUrl)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

// Matches the rewind range of YouTube's own live DASH manifests. YouTube serves
// these segments even when a stream's DVR is disabled.
const LIVE_DASH_TIME_SHIFT_BUFFER_SECONDS = 4 * 60 * 60

/**
 * @typedef {object} LiveHeadSegment
 * @property {number} sequenceNumber the newest available `sq` segment
 * @property {number} mediaTimeMs the media timestamp at which that segment starts
 * @property {number} wallTimeMs when that segment was reported to be the newest
 */

/**
 * Reads the newest segment of an ongoing stream from a googlevideo response.
 * @param {Headers} headers
 * @param {number} wallTimeMs
 * @returns {LiveHeadSegment | null}
 */
export function getLiveHeadSegment(headers, wallTimeMs) {
  const sequenceNumber = Number(headers.get('X-Head-Seqnum') ?? NaN)
  const mediaTimeMs = Number(headers.get('X-Head-Time-Millis') ?? NaN)
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0 ||
    !Number.isSafeInteger(mediaTimeMs) || mediaTimeMs < 0) {
    return null
  }
  return { sequenceNumber, mediaTimeMs, wallTimeMs }
}

/**
 * Turns youtubei.js's Post-Live-DVR manifest of `sq` segmented formats into a
 * live one. A segment timeline can only grow by refreshing the manifest, which
 * a data URL cannot do. A duration template lets shaka-player derive the newest
 * segment number from the clock instead, anchored so the head segment ends now.
 * @param {string} manifest
 * @param {LiveHeadSegment} head
 * @param {number} segmentDurationSeconds
 * @returns {string | null} null when the manifest does not have the expected shape
 */
export function toLiveDashManifest(manifest, head, segmentDurationSeconds) {
  const durationMs = Math.round(segmentDurationSeconds * 1000)
  if (!(durationMs > 0)) return null

  const segmentCount = Math.max(1, Math.min(
    head.sequenceNumber + 1,
    Math.floor(LIVE_DASH_TIME_SHIFT_BUFFER_SECONDS * 1000 / durationMs)
  ))
  const startNumber = head.sequenceNumber + 1 - segmentCount
  const presentationTimeOffset = Math.max(0, head.mediaTimeMs - (segmentCount - 1) * durationMs)
  const seconds = (/** @type {number} */ ms) => `PT${(ms / 1000).toFixed(3)}S`

  let templates = 0
  const live = manifest
    .replace(/ type="static"(?: mediaPresentationDuration="[^"]*")?/, () => [
      ' type="dynamic"',
      `availabilityStartTime="${new Date(head.wallTimeMs - segmentCount * durationMs).toISOString()}"`,
      `publishTime="${new Date(head.wallTimeMs).toISOString()}"`,
      // The full window, as the manifest is not refreshed while a young stream grows
      `timeShiftBufferDepth="${seconds(LIVE_DASH_TIME_SHIFT_BUFFER_SECONDS * 1000)}"`,
      `maxSegmentDuration="${seconds(durationMs)}"`,
      // Two segments, like the delay given to YouTube's own live manifests
      `suggestedPresentationDelay="${seconds(2 * durationMs)}"`
    ].join(' '))
    .replace('<Period>', '<Period start="PT0S">')
    .replaceAll(/<SegmentTemplate startNumber="\d+" timescale="1000"( media="[^"]*")><SegmentTimeline>.*?<\/SegmentTimeline><\/SegmentTemplate>/g, (_, media) => {
      templates++
      return `<SegmentTemplate startNumber="${startNumber}" timescale="1000" duration="${durationMs}" presentationTimeOffset="${presentationTimeOffset}"${media}/>`
    })

  return templates > 0 && live.includes(' type="dynamic"') && live.includes('<Period start="PT0S">') && !live.includes('<SegmentTimeline')
    ? live
    : null
}
