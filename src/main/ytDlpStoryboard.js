const MAX_STORYBOARD_CUES = 50000

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finitePositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * @param {number} seconds
 */
function formatVttTimestamp(seconds) {
  const totalMilliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const remainingSeconds = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}

/**
 * Converts yt-dlp's image-grid fragments into the WebVTT thumbnail track Shaka expects.
 * @param {unknown[]} formats
 * @param {number | null} videoDuration
 * @returns {string | null}
 */
export function buildYtDlpStoryboardVtt(formats, videoDuration) {
  const storyboards = formats.flatMap((format) => {
    if (format === null || typeof format !== 'object' || format.protocol !== 'mhtml') return []

    const width = finitePositiveNumber(format.width)
    const height = finitePositiveNumber(format.height)
    const fps = finitePositiveNumber(format.fps)
    const rows = finitePositiveNumber(format.rows)
    const columns = finitePositiveNumber(format.columns)
    if (width === null || height === null || fps === null || rows === null || columns === null || !Array.isArray(format.fragments)) {
      return []
    }

    const fragments = format.fragments.flatMap((fragment) => {
      if (fragment === null || typeof fragment !== 'object' || typeof fragment.url !== 'string' || fragment.url === '') {
        return []
      }

      return [{
        url: fragment.url,
        duration: finitePositiveNumber(fragment.duration)
      }]
    })

    return fragments.length === 0
      ? []
      : [{ width, height, fps, rows: Math.floor(rows), columns: Math.floor(columns), fragments }]
  })

  const storyboard = storyboards.sort((left, right) =>
    (right.width * right.height) - (left.width * left.height)
  )[0]
  if (storyboard === undefined) return null

  const interval = 1 / storyboard.fps
  const cellsPerFragment = storyboard.rows * storyboard.columns
  const durationLimit = finitePositiveNumber(videoDuration) ?? Number.POSITIVE_INFINITY
  let currentTime = 0
  let generatedCueCount = 0
  let vtt = 'WEBVTT\n\n'

  for (const fragment of storyboard.fragments) {
    if (generatedCueCount >= MAX_STORYBOARD_CUES) break

    const fragmentDuration = fragment.duration ?? cellsPerFragment * interval
    const cueCount = Math.min(cellsPerFragment, Math.ceil((fragmentDuration / interval) - 1e-6))

    for (
      let index = 0;
      index < cueCount && currentTime < durationLimit && generatedCueCount < MAX_STORYBOARD_CUES;
      index++
    ) {
      const endTime = Math.min(currentTime + interval, durationLimit)
      const x = (index % storyboard.columns) * storyboard.width
      const y = Math.floor(index / storyboard.columns) * storyboard.height

      vtt += `${formatVttTimestamp(currentTime)} --> ${formatVttTimestamp(endTime)}\n`
      vtt += `${fragment.url}#xywh=${x},${y},${storyboard.width},${storyboard.height}\n\n`
      currentTime = endTime
      generatedCueCount++
    }
  }

  return currentTime > 0 ? vtt : null
}
